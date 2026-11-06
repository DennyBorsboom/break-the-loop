(function (root) {
  'use strict';

  // Park, Waldorp & Vasconcelos (2026), Eq. 2, Table 2 (normal),
  // Table 3 (base), and Appendix A4. Matrix rows are SOURCES, columns TARGETS.
  // Independently implemented from the published equations, not the R source.
  const N = 9;
  const paperOrder = ['interest', 'mood', 'sleep', 'fatigue', 'appetite', 'worthlessness', 'concentration', 'psychomotor', 'death'];
  const gameOrder = ['mood', 'interest', 'sleep', 'fatigue', 'concentration', 'worthlessness', 'psychomotor', 'appetite', 'death'];
  const matrix = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [.33, 0, .14, .15, 0, .13, 0, 0, .15],
    [.13, .14, 0, .22, .23, 0, 0, 0, 0],
    [.21, .15, .22, 0, 0, 0, .12, 0, 0],
    [0, 0, 0, .17, 0, 0, 0, 0, 0],
    [0, .13, 0, 0, .15, 0, .20, .15, .22],
    [0, 0, 0, 0, 0, 0, 0, .17, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, .30, 0]
  ];
  const beta = [-1.37, -1.02, -.93, -1.19, -.96, -.61, -.88, -1.30, -2.30];
  // Game choices, not fitted parameters: noise strength, initial condition,
  // field dose, observation windows, numerical step, and green display band.
  const settings = Object.freeze({ dt: .02, noise: .10, initialLevel: .92,
    greenLimit: .10, nodeReduction: .25, fieldDose: .25, responseTime: 20, watchTime: 10,
    forecastTime: 40, forecastPaths: 256 });

  function createModel() {
    const edges = [];
    matrix.forEach((row, source) => row.forEach((weight, destination) => {
      if (weight) edges.push({ a: gameOrder.indexOf(paperOrder[source]),
        b: gameOrder.indexOf(paperOrder[destination]), weight, removed: false });
    }));
    return { edges, thresholds: gameOrder.map(id => beta[paperOrder.indexOf(id)]),
      fieldDoses: Array(N).fill(0), self: Array(N).fill(.30),
      boost: Array(N).fill(9.50), noise: Array(N).fill(settings.noise) };
  }
  function cloneModel(model) {
    return { edges: model.edges.map(edge => ({ ...edge })),
      thresholds: [...model.thresholds], fieldDoses: [...model.fieldDoses],
      self: [...model.self], boost: [...model.boost], noise: [...model.noise] };
  }
  const initialState = () => Array(N).fill(settings.initialLevel);
  const isOn = (state, node) => state[node] > settings.greenLimit;
  const activeCount = state => state.filter(x => x > settings.greenLimit).length;
  const isWon = state => state.every(x => x <= settings.greenLimit);
  const mean = state => state.reduce((sum, x) => sum + x, 0) / N;
  // Repeated folding also handles steps that cross more than one boundary.
  function reflect(value) {
    const folded = ((value % 2) + 2) % 2;
    return folded > 1 ? 2 - folded : folded;
  }
  function drift(model, state) {
    const incoming = Array(N).fill(0);
    for (const edge of model.edges) if (!edge.removed) incoming[edge.b] += edge.weight * state[edge.a];
    return state.map((s, i) => s * (1 - s) *
      (model.thresholds[i] + model.self[i] * s + incoming[i] * (1 + model.boost[i] * s * s)));
  }
  // Explicit RNG state makes pause, forecast, and paid undo independent of
  // browser frame timing. Box-Muller generates independent Gaussian pairs.
  function randomGenerator(seed = 271828) {
    let value = seed >>> 0;
    const random = () => {
      value = (value + 0x6D2B79F5) >>> 0;
      let t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    random.snapshot = () => value;
    random.restore = snapshot => { value = snapshot >>> 0; };
    return random;
  }
  function step(model, state, random, dt = settings.dt) {
    const change = drift(model, state);
    const next = Array(N);
    for (let i = 0; i < N; i += 2) {
      const radius = Math.sqrt(-2 * Math.log(Math.max(Number.MIN_VALUE, random())));
      const angle = 2 * Math.PI * random();
      next[i] = reflect(state[i] + change[i] * dt + model.noise[i] * Math.sqrt(dt) * radius * Math.cos(angle));
      if (i + 1 < N) next[i + 1] = reflect(state[i + 1] + change[i + 1] * dt + model.noise[i + 1] * Math.sqrt(dt) * radius * Math.sin(angle));
    }
    return next;
  }
  function intervene(model, state, type, target) {
    const next = [...state];
    if (type === 'node' && next[target] > settings.greenLimit) {
      next[target] = Math.max(settings.greenLimit, next[target] - settings.nodeReduction);
    } // one-time reduction; subsequent dynamics are never clamped
    if (type === 'self') model.self[target] = Math.min(model.self[target], .10);
    if (type === 'field') { model.thresholds[target] -= settings.fieldDose; model.fieldDoses[target]++; }
    if (type === 'edge') model.edges[target].removed = true;
    return next;
  }
  function trajectory(model, state, random, duration, stopAtGreen = false) {
    const samples = [{ time: 0, state: [...state] }];
    let next = [...state];
    const steps = Math.round(duration / settings.dt);
    let completed = 0;
    if (stopAtGreen && isWon(next)) return { state: next, elapsed: 0, samples };
    for (let i = 0; i < steps; i++) {
      next = step(model, next, random);
      completed = i + 1;
      const done = stopAtGreen && isWon(next);
      if (completed % 10 === 0 || completed === steps || done) samples.push({ time: completed * settings.dt, state: [...next] });
      if (done) break;
    }
    return { state: next, elapsed: completed * settings.dt, samples };
  }
  // A fixed-horizon Monte Carlo estimate; separate, paired seeds for the two
  // scenarios reduce comparison noise and never consume the player's RNG.
  function forecast(model, state, type, target, paths = settings.forecastPaths) {
    const altered = cloneModel(model);
    const switched = intervene(altered, state, type, target);
    let baseline = 0, projected = 0, baselineMean = 0, projectedMean = 0;
    for (let path = 0; path < paths; path++) {
      const seed = (73471 + path * 104729) >>> 0;
      let before = [...state], after = [...switched];
      const r1 = randomGenerator(seed), r2 = randomGenerator(seed);
      for (let i = 0; i < Math.round(settings.forecastTime / settings.dt); i++) {
        before = step(model, before, r1);
        after = step(altered, after, r2);
      }
      if (isWon(before)) baseline++;
      if (isWon(after)) projected++;
      baselineMean += mean(before); projectedMean += mean(after);
    }
    return { baseline: baseline / paths, projected: projected / paths,
      baselineMean: baselineMean / paths, projectedMean: projectedMean / paths, paths };
  }
  const api = { N, settings, paperOrder, gameOrder, matrix, beta, createModel,
    cloneModel, initialState, isOn, activeCount, isWon, mean, reflect, drift,
    randomGenerator, step, intervene, trajectory, forecast };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LoopDynamics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
