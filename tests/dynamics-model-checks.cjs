'use strict';
const assert = require('node:assert/strict');
const D = require('../dynamics.js');
const close = (a, b, tolerance = 1e-12) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const model = D.createModel();
assert.equal(model.edges.length, 21);
assert.equal(model.edges.filter(e => e.a === 1 || e.a === 6).length, 0, 'Anhedonia and motor are sinks in A4.');
const appetiteToEnergy = model.edges.find(e => e.a === 7 && e.b === 3);
assert.equal(appetiteToEnergy.weight, .17);
assert.ok(!model.edges.some(e => e.a === 3 && e.b === 7), 'Do not symmetrize the mechanistic network.');
assert.deepEqual(model.thresholds, [-1.02, -1.37, -.93, -1.19, -.88, -.61, -1.30, -.96, -2.30]);
// Independent hand calculation of Equation 1: fatigue .4, sleep .8.
const fixture = Array(9).fill(0); fixture[3] = .4; fixture[2] = .8;
close(D.drift(model, fixture)[3], -.1503552);
assert.ok(D.drift(model, Array(9).fill(0)).every(x => x === 0));
assert.ok(D.drift(model, D.initialState()).every(x => x > 0), 'Opening configuration has reinforcing drift.');
for (const [x, y] of [[-.3, .3], [1.3, .7], [-4.3, .3], [6.7, .7], [1, 1], [0, 0]]) close(D.reflect(x), y);
const state = D.initialState(), original = JSON.stringify(model);
const changed = D.intervene(model, state, 'node', 2);
close(changed[2], .67); assert.ok(D.isOn(changed, 2), 'Reducing a high-intensity symptom must not guarantee green.');
assert.equal(state[2], .92); assert.equal(JSON.stringify(model), original);
for (const [before, after] of [[.90, .65], [.40, .15], [.30, .10], [.11, .10], [.10, .10], [.05, .05]]) {
  const fixture = Array(9).fill(.92); fixture[2] = before;
  const reduced = D.intervene(model, fixture, 'node', 2);
  close(reduced[2], after);
  assert.ok(reduced.every((value, i) => i === 2 || value === fixture[i]), 'Only the selected intensity changes.');
}
const r = D.randomGenerator(17), snapshot = r.snapshot(), noiseStep = D.step(model, changed, r);
assert.notEqual(noiseStep[2], changed[2], 'The reduction must not clamp the symptom at its new level.');
r.restore(snapshot); assert.deepEqual(D.step(model, changed, r), noiseStep);
const pureNoise = D.cloneModel(model);
pureNoise.edges = []; pureNoise.self.fill(0); pureNoise.thresholds.fill(0);
let sum = 0, sumSquares = 0, cross = 0;
const noiseRng = D.randomGenerator(908);
for (let draw = 0; draw < 8000; draw++) {
  const next = D.step(pureNoise, Array(9).fill(.5), noiseRng);
  const x = next[0] - .5, y = next[1] - .5;
  sum += x; sumSquares += x * x; cross += x * y;
}
close(sum / 8000, 0, .0007);
close(sumSquares / 8000, .10 ** 2 * .02, .000012);
close(cross / 8000, 0, .00001);
const altered = D.cloneModel(model);
const forward = altered.edges.findIndex(e => e.a === 0 && e.b === 2);
const reverse = altered.edges.findIndex(e => e.a === 2 && e.b === 0);
D.intervene(altered, state, 'edge', forward);
assert.ok(altered.edges[forward].removed); assert.equal(altered.edges[reverse].removed, false);
const sameFieldState = D.intervene(altered, state, 'field', 0);
close(altered.thresholds[0], -1.27);
assert.deepEqual(sameFieldState, state, 'A field shift must not reset the symptom state.');
assert.equal(altered.fieldDoses[0], 1);
D.intervene(altered, state, 'field', 0); close(altered.thresholds[0], -1.52);
assert.equal(altered.fieldDoses[0], 2, 'Repeated field shifts each lower beta by another 0.25.');
const modestField = D.cloneModel(model);
D.intervene(modestField, state, 'field', 5);
assert.ok(D.drift(modestField, Array(9).fill(.99))[5] > 0, 'One field shift must not force Worthlessness to decay with all neighbours highly active.');
assert.equal(JSON.stringify(model), original, 'Scenario changes must not leak into another model.');
const weaker = D.cloneModel(model), fixtureBefore = D.drift(weaker, fixture);
const sameState = D.intervene(weaker, fixture, 'self', 3);
assert.deepEqual(sameState, fixture, 'Lowering self-feedback must not reset intensity.');
close(weaker.self[3], .10);
assert.ok(weaker.self.every((value, i) => value === (i === 3 ? .10 : .30)));
assert.deepEqual(weaker.thresholds, model.thresholds); assert.deepEqual(weaker.boost, model.boost);
assert.deepEqual(weaker.edges, model.edges);
const fixtureAfter = D.drift(weaker, fixture);
close(fixtureBefore[3] - fixtureAfter[3], .0192, 1e-12);
fixtureBefore.forEach((value, i) => { if (i !== 3) close(fixtureAfter[i], value); });
D.intervene(weaker, fixture, 'self', 3); close(weaker.self[3], .10);
const restored = D.cloneModel(weaker); restored.self[3] = .30;
assert.deepEqual(D.drift(restored, fixture), fixtureBefore);
assert.ok(D.isWon(Array(9).fill(.10))); assert.ok(!D.isWon([.100001, ...Array(8).fill(0)]));
// Numerical convergence against a much finer integration of the same ODE,
// with noise disabled to separate discretization error from random paths.
const noiseless = D.cloneModel(model); noiseless.noise.fill(0);
let coarse = Array(9).fill(.4), fine = [...coarse];
for (let i = 0; i < 500; i++) coarse = D.step(noiseless, coarse, D.randomGenerator(1), .02);
for (let i = 0; i < 10000; i++) fine = D.step(noiseless, fine, D.randomGenerator(1), .001);
assert.ok(Math.max(...coarse.map((x, i) => Math.abs(x - fine[i]))) < .002);
// Real, unmocked all-green solution within the six-coin opening budget.
const pathModel = D.createModel(), rng = D.randomGenerator();
let pathState = D.initialState();
for (const [type, target] of [['edge', 3], ['edge', 11], ['node', 3]]) {
  if (type === 'node') assert.ok(D.isOn(pathState, target), 'Winning examples must use a target eligible in the game.');
  pathState = D.intervene(pathModel, pathState, type, target);
  pathState = D.trajectory(pathModel, pathState, rng, 20, true).state;
}
assert.ok(D.isWon(pathState));
const tip = D.forecast(model, state, 'field', 5, 32);
assert.deepEqual(tip, D.forecast(model, state, 'field', 5, 32));
assert.ok(tip.projectedMean < tip.baselineMean, 'A lasting field reduction changes the forecast.');
for (const p of [tip.baseline, tip.projected]) assert.ok(p >= 0 && p <= 1);
assert.equal(JSON.stringify(model), original); assert.deepEqual(state, D.initialState());
console.log('Continuous-model checks passed: published drift, reflection, 25-point symptom reductions with a 10% floor and no clamping, self-feedback reduction, RNG restoration, intervention isolation, ODE convergence, playable all-green path and reproducible forecasts.');
