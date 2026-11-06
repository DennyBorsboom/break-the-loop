'use strict';
const assert = require('node:assert/strict');
const M = require('../model.js');
const close = (a, b, tolerance = 1e-11) => assert.ok(Math.abs(a - b) < tolerance, `${a} differs from ${b}`);
const total = values => values.reduce((a, b) => a + b, 0);
const clone = value => JSON.parse(JSON.stringify(value));

const model = M.createModel();
const baseline = clone(model);
const switched = M.intervene(model, 511, 'node', 0);
assert.equal(switched, 510);
assert.deepEqual(model, baseline, 'A one-time node switch must not change any parameters.');
assert.ok(M.probabilityOn(model, switched, 0) > 0.9, 'The switched node must remain free to reactivate.');
assert.equal(M.sampleSweep(model, switched, () => 0), 511, 'A one-time node intervention must not clamp the node.');

const kernel = M.transitionKernel(model);
for (const s of [0, 31, 256, 511]) {
  const point = new Float64Array(M.SIZE); point[s] = 1;
  const actual = M.advanceDistribution(point, kernel, 1);
  close(total(actual), 1);
  let stay = 1;
  for (let i = 0; i < M.N; i++) {
    const expected = (M.isOn(s, i) ? 1 - M.probabilityOn(model, s, i) : M.probabilityOn(model, s, i)) / M.N;
    close(actual[s ^ (1 << i)], expected);
    stay -= expected;
  }
  close(actual[s], stay);
}
const equilibrium = M.equilibrium(model);
close(total(equilibrium), 1);
const evolved = M.advanceDistribution(equilibrium, kernel, 9);
for (let s = 0; s < M.SIZE; s++) {
  close(equilibrium[s], evolved[s]);
  for (let i = 0; i < M.N; i++) {
    const t = s ^ (1 << i);
    close(equilibrium[s] * kernel[s * M.N + i], equilibrium[t] * kernel[t * M.N + i]);
  }
}
const highForecast = M.forecast(model, 511);
const switchedForecast = M.forecast(model, switched);
const notAllGreen = new Float64Array(M.SIZE); notAllGreen[3] = 1;
assert.equal(M.summarize(notAllGreen).healthyProbability, 0, 'Two active nodes must not count as an all-green outcome.');
const allGreen = new Float64Array(M.SIZE); allGreen[0] = 1;
assert.equal(M.summarize(allGreen).healthyProbability, 1);
assert.ok(switchedForecast.healthyProbability > highForecast.healthyProbability,
  'A transient node switch should affect the finite-time forecast.');
assert.deepEqual(model, baseline, 'Forecasting must not alter the model.');

const fieldModel = clone(model);
const initialOn = M.probabilityOn(fieldModel, 511, 3);
assert.equal(M.intervene(fieldModel, 511, 'field', 3), 511);
close(fieldModel.thresholds[3], model.thresholds[3] - 1.5);
assert.deepEqual(fieldModel.edges, model.edges);
assert.ok(M.probabilityOn(fieldModel, 511, 3) < initialOn);
assert.equal(fieldModel.fieldDoses[3], 1);

const edgeModel = clone(model);
M.intervene(edgeModel, 511, 'edge', 6);
const e = edgeModel.edges[6];
assert.ok(e.removed);
assert.deepEqual(edgeModel.thresholds, model.thresholds);
for (const node of [e.a, e.b]) assert.ok(M.probabilityOn(edgeModel, 511, node) < M.probabilityOn(model, 511, node));

const sequence = [['node', 3], ['node', 0], ['node', 6]];
function replay() {
  const network = M.createModel(), rng = M.randomGenerator(271828);
  let state = 511; const sweeps = [];
  for (const [type, target] of sequence) {
    if (type === 'node') assert.ok(M.isOn(state, target), 'A node intervention must target an active symptom.');
    state = M.intervene(network, state, type, target);
    for (let i = 0; i < 2 && state !== 0; i++) { state = M.sampleSweep(network, state, rng); sweeps.push(M.activeCount(state)); }
  }
  return { state, sweeps };
}
assert.deepEqual(replay(), replay());
assert.equal(replay().state, 0, 'The opening puzzle must reach an entirely green network within six treatment coins.');
console.log('Model checks passed: one-time switching and reactivation; normalized exact transitions; detailed balance and stationarity; finite-time forecasts; lasting edge/field effects; deterministic replay; solvable opening puzzle.');
