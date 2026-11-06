(function (root) {
  'use strict';

  const N = 9;
  const SIZE = 1 << N;
  const symptoms = [
    { id: 'mood', name: 'Depressed mood', short: 'Low mood', x: 350, y: 95 },
    { id: 'interest', name: 'Loss of interest or pleasure', short: 'Loss of interest', x: 530, y: 160 },
    { id: 'sleep', name: 'Sleep disturbance', short: 'Sleep problems', x: 170, y: 180 },
    { id: 'fatigue', name: 'Fatigue or loss of energy', short: 'Fatigue', x: 270, y: 300 },
    { id: 'concentration', name: 'Difficulty concentrating or deciding', short: 'Poor concentration', x: 510, y: 320 },
    { id: 'worthlessness', name: 'Worthlessness or excessive guilt', short: 'Worthlessness', x: 655, y: 255 },
    { id: 'psychomotor', name: 'Psychomotor agitation or slowing', short: 'Agitation / slowing', x: 560, y: 465 },
    { id: 'appetite', name: 'Appetite or weight change', short: 'Appetite changes', x: 170, y: 450 },
    { id: 'death', name: 'Recurrent thoughts of death', short: 'Thoughts of death', x: 365, y: 510 }
  ];
  // Illustrative weights, not an empirical fit or a reproduction of the 14-node study.
  const baseEdges = [
    [0, 1, 1.9], [0, 2, 1.6], [0, 5, 2.0], [0, 8, 1.5],
    [1, 3, 1.8], [1, 5, 1.4], [2, 3, 2.2], [2, 7, 1.5],
    [3, 4, 2.0], [3, 7, 1.6], [4, 5, 1.7], [4, 6, 1.9],
    [5, 8, 2.1], [6, 8, 1.5], [6, 7, 1.4]
  ];
  const population = new Uint8Array(SIZE);
  for (let s = 1; s < SIZE; s++) population[s] = population[s >> 1] + (s & 1);
  const logistic = x => x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
  const isOn = (state, node) => Boolean(state & (1 << node));
  const activeCount = state => population[state];

  function createModel() {
    const edges = baseEdges.map(([a, b, weight]) => ({ a, b, weight, removed: false }));
    const thresholds = Array(N).fill(-0.18);
    edges.forEach(({ a, b, weight }) => { thresholds[a] -= weight / 2; thresholds[b] -= weight / 2; });
    return { edges, thresholds, fieldDoses: Array(N).fill(0) };
  }

  function probabilityOn(model, state, node) {
    let input = model.thresholds[node];
    for (const e of model.edges) {
      if (e.removed) continue;
      if (e.a === node && isOn(state, e.b)) input += e.weight;
      else if (e.b === node && isOn(state, e.a)) input += e.weight;
    }
    return logistic(input);
  }

  // Random-scan, single-site Gibbs dynamics. This has the joint Ising law
  // exp(sum tau_i*x_i + sum w_ij*x_i*x_j)/Z as its stationary distribution.
  function transitionKernel(model) {
    const kernel = new Float64Array(SIZE * N);
    for (let s = 0; s < SIZE; s++) for (let i = 0; i < N; i++) {
      const p = probabilityOn(model, s, i);
      kernel[s * N + i] = (isOn(s, i) ? 1 - p : p) / N;
    }
    return kernel;
  }

  function advanceDistribution(distribution, kernel, updates) {
    let current = Float64Array.from(distribution);
    for (let t = 0; t < updates; t++) {
      const next = new Float64Array(SIZE);
      for (let s = 0; s < SIZE; s++) {
        const mass = current[s];
        if (!mass) continue;
        let stay = 1;
        for (let i = 0; i < N; i++) {
          const flip = kernel[s * N + i];
          next[s ^ (1 << i)] += mass * flip;
          stay -= flip;
        }
        next[s] += mass * stay;
      }
      current = next;
    }
    return current;
  }

  function summarize(distribution) {
    let healthyProbability = 0;
    let expectedActive = 0;
    const marginals = Array(N).fill(0);
    for (let s = 0; s < SIZE; s++) {
      const p = distribution[s];
      if (s === 0) healthyProbability += p;
      expectedActive += p * population[s];
      for (let i = 0; i < N; i++) if (isOn(s, i)) marginals[i] += p;
    }
    return { healthyProbability, expectedActive, marginals };
  }

  function forecast(model, state, sweeps = 6, kernel = transitionKernel(model)) {
    const distribution = new Float64Array(SIZE);
    distribution[state] = 1;
    return summarize(advanceDistribution(distribution, kernel, sweeps * N));
  }

  function equilibrium(model) {
    const logWeights = new Float64Array(SIZE);
    for (let s = 0; s < SIZE; s++) {
      let weight = 0;
      for (let i = 0; i < N; i++) if (isOn(s, i)) weight += model.thresholds[i];
      for (const e of model.edges) if (!e.removed && isOn(s, e.a) && isOn(s, e.b)) weight += e.weight;
      logWeights[s] = weight;
    }
    const max = Math.max(...logWeights);
    const probabilities = Float64Array.from(logWeights, x => Math.exp(x - max));
    const z = probabilities.reduce((sum, p) => sum + p, 0);
    return Float64Array.from(probabilities, p => p / z);
  }

  function randomGenerator(seed = 271828) {
    let value = seed >>> 0;
    return () => {
      value += 0x6D2B79F5;
      let t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function sampleSweep(model, state, random) {
    let next = state;
    for (let t = 0; t < N; t++) {
      const node = Math.floor(random() * N);
      if (random() < probabilityOn(model, next, node)) next |= 1 << node;
      else next &= ~(1 << node);
    }
    return next;
  }

  function intervene(model, state, type, target) {
    if (type === 'node') return state & ~(1 << target);
    if (type === 'edge') model.edges[target].removed = true;
    if (type === 'field') { model.thresholds[target] -= 1.5; model.fieldDoses[target]++; }
    return state;
  }

  const api = { N, SIZE, symptoms, baseEdges, logistic, isOn, activeCount, createModel,
    probabilityOn, transitionKernel, advanceDistribution, summarize, forecast,
    equilibrium, randomGenerator, sampleSweep, intervene };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LoopModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
