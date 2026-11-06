(function () {
  'use strict';
  const I = window.LoopModel;
  const D = window.LoopDynamics;
  let modelMode = window.location.hash === '#dynamics' ? 'dynamics' : 'ising';
  let M = modelMode === 'dynamics' ? D : I;
  const continuous = () => modelMode === 'dynamics';
  const $ = id => document.getElementById(id);
  const svgNS = 'http://www.w3.org/2000/svg';
  const budget = 6;
  const isingTreatmentCosts = Object.freeze({ node: 1, self: 1, edge: 3, field: 2 });
  const treatmentCost = actionType => continuous() ? 1 : isingTreatmentCosts[actionType];
  const forecastCost = 1;
  const undoCost = 1;
  const seed = 271828;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, reducedMotion ? 450 : milliseconds));
  const percent = p => `${Math.round(p * 100)}%`;
  const initialMessages = {
    node: 'Click an active symptom. Switching it off gives the system a push, but does not change its connections.',
    edge: 'Click a connection between two symptoms. Removing it breaks this direct influence in both directions for the rest of the round.',
    field: 'Click any symptom. Lowering its activation parameter makes it less likely to turn on for the rest of the round.',
    self: 'Choose a symptom or its loop. Lower self-feedback from 0.30 to 0.10 for this round.'
  };

  let model, state, random, history, ledger, purchased, treatmentVersion;
  let type = 'node';
  let target = null;
  let phase = 'playing';
  let turnAnimation = null;
  let celebrationPlayed = false;
  let celebrationTimer = null;
  let exhaustionPromptShown = false;
  let modelTime = 0;
  let timeTrace = [];
  let animationPaused = false;
  let responseProgress = 0;

  function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function svgElement(tag, attributes) {
    const el = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
    return el;
  }
  function activateWithKeyboard(el, callback) {
    el.addEventListener('click', callback);
    el.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); callback(); }
    });
  }
  function setMessage(text, title = '') {
    const message = $('turn-message').lastElementChild;
    message.replaceChildren();
    if (title) message.append(element('strong', 'message-title', title));
    message.append(element('span', 'message-detail', text));
  }
  function targetName(actionType, actionTarget) {
    if (actionType === 'wait') return 'Model time';
    if (actionType === 'edge') {
      const e = model.edges[actionTarget];
      return `${I.symptoms[e.a].short} ${continuous() ? '→' : '↔'} ${I.symptoms[e.b].short}`;
    }
    return I.symptoms[actionTarget].short;
  }
  function cacheKey() { return `${treatmentVersion}:${type}:${target}`; }
  function validTarget() {
    if (target === null) return false;
    if (type === 'node') return M.isOn(state, target);
    if (type === 'self') return continuous() && model.self[target] > .10;
    if (type === 'edge') return !model.edges[target].removed;
    return true;
  }
  function isWon() { return continuous() ? D.isWon(state) : state === 0; }
  function coinsSpent() { return ledger.reduce((sum, entry) => sum + entry.cost, 0); }
  function coinsRemaining() { return budget - coinsSpent(); }
  function coinLabel(amount) { return `${amount} ${amount === 1 ? 'coin' : 'coins'}`; }

  function routedInfluence(edge, a, b) {
    // Presentation routes only: node positions and the mechanistic graph stay
    // fixed. The two upper lanes bypass Loss of interest; the lower outer
    // lane takes Worthlessness -> Appetite below Poor concentration.
    const routes = {
      '0:5': [[530, 15], [600, 130]],
      '5:0': [[790, 120], [450, -5]],
      '5:7': [[750, 205], [760, 395], [635, 405], [500, 420], [320, 405]]
    };
    const controls = routes[`${edge.a}:${edge.b}`];
    if (!controls) return null;
    const first = controls[0], last = controls[controls.length - 1];
    const startLength = Math.hypot(first[0] - a.x, first[1] - a.y);
    const endLength = Math.hypot(b.x - last[0], b.y - last[1]);
    const start = [a.x + (first[0] - a.x) / startLength * 35, a.y + (first[1] - a.y) / startLength * 35];
    const end = [b.x - (b.x - last[0]) / endLength * 38, b.y - (b.y - last[1]) / endLength * 38];
    const points = [...controls, end];
    return `M${start.join(',')} C${points.slice(0, 3).map(p => p.join(',')).join(' ')}${points.length > 3 ? ` C${points.slice(3).map(p => p.join(',')).join(' ')}` : ''}`;
  }

  function drawNetwork(previousState = state, interventionTarget = null) {
    const svg = $('network');
    svg.replaceChildren();
    svg.dataset.state = continuous() ? JSON.stringify(state) : state;
    svg.classList.toggle('edge-mode', type === 'edge');
    if (continuous()) {
      const defs = svgElement('defs', {});
      const marker = svgElement('marker', { id: 'influence-arrow', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto', markerUnits: 'userSpaceOnUse' });
      marker.append(svgElement('path', { d: 'M0 0L10 5L0 10Z', fill: '#587b8e' }));
      const selfMarker = svgElement('marker', { id: 'self-loop-arrow', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto', markerUnits: 'userSpaceOnUse' });
      selfMarker.append(svgElement('path', { d: 'M0 0L10 5L0 10Z', fill: '#6b8564' }));
      defs.append(marker, selfMarker); svg.append(defs);
    }
    const edgesGroup = svgElement('g', { 'aria-label': 'Symptom connections' });
    model.edges.forEach((edge, index) => {
      const a = I.symptoms[edge.a], b = I.symptoms[edge.b];
      let coords = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
      const shape = continuous() ? 'path' : 'line';
      if (continuous()) {
        const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
        const ux = dx / length, uy = dy / length;
        const bend = model.edges.some(e => e.a === edge.b && e.b === edge.a) ? 22 : 0;
        const cx = (a.x + b.x) / 2 - uy * bend, cy = (a.y + b.y) / 2 + ux * bend;
        const startLength = Math.hypot(cx - a.x, cy - a.y), endLength = Math.hypot(b.x - cx, b.y - cy);
        coords = { d: routedInfluence(edge, a, b) || `M${a.x + (cx - a.x) / startLength * 35},${a.y + (cy - a.y) / startLength * 35} Q${cx},${cy} ${b.x - (b.x - cx) / endLength * 38},${b.y - (b.y - cy) / endLength * 38}` };
      }
      const active = M.isOn(state, edge.a) && M.isOn(state, edge.b);
      const line = svgElement(shape, { ...coords,
        class: `edge-visible${active ? ' edge-active' : ''}${edge.removed ? ' edge-removed' : ''}${type === 'edge' && target === index ? ' edge-selected' : ''}`,
        'stroke-width': continuous() ? 1.5 + edge.weight * 5 : 1.6 + edge.weight * 1.2,
        'data-connection': `${edge.a}:${edge.b}`,
        ...(continuous() && !edge.removed ? { 'marker-end': 'url(#influence-arrow)' } : {}) });
      edgesGroup.append(line);
      if (turnAnimation?.stage === 'applied' && turnAnimation.type === 'edge' && turnAnimation.target === index) {
        const removal = svgElement(shape, { ...coords, class: 'edge-removal', 'stroke-width': 5 });
        edgesGroup.append(removal);
        const point = continuous() ? line.getPointAtLength(line.getTotalLength() / 2) : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const cut = svgElement('g', { transform: `translate(${point.x},${point.y})`, class: 'edge-cut', 'aria-hidden': 'true' });
        cut.append(svgElement('circle', { r: 18 }));
        const symbol = svgElement('text', { x: 0, y: 1 });
        symbol.textContent = '×';
        cut.append(symbol);
        edgesGroup.append(cut);
      }
      if (!edge.removed && type === 'edge') {
        const hit = svgElement(shape, { ...coords, class: 'edge-hit', tabindex: '0', role: 'button',
          'aria-label': continuous() ? `Remove arrow: ${a.short} to ${b.short}` : `Remove connection: ${a.short} and ${b.short}`, 'aria-pressed': target === index,
          'data-edge': index });
        activateWithKeyboard(hit, () => selectTarget(index));
        hit.addEventListener('pointerenter', () => line.classList.add('edge-hover'));
        hit.addEventListener('pointerleave', () => line.classList.remove('edge-hover'));
        edgesGroup.append(hit);
      }
    });
    svg.append(edgesGroup);
    if (continuous()) {
      const loops = svgElement('g', { 'aria-label': 'Self-feedback loops' });
      // Use the free side of each existing node; its position is unchanged.
      const angles = [-145, 0, -155, 165, -90, 0, 0, 180, 180];
      I.symptoms.forEach((symptom, index) => {
        const angle = angles[index] * Math.PI / 180;
        const point = (radius, offset) => [symptom.x + Math.cos(angle + offset) * radius, symptom.y + Math.sin(angle + offset) * radius];
        const start = point(40, -.46), first = point(88, -.78), second = point(88, .78), end = point(40, .46);
        const selected = type === 'self' && target === index;
        const loop = svgElement('g', { class: `self-loop${model.self[index] <= .10 ? ' self-loop-lowered' : ''}${selected ? ' self-loop-selected' : ''}`,
          'data-self-loop': index, 'data-weight': model.self[index].toFixed(2), tabindex: '0', role: 'button',
          'aria-label': `${symptom.short}: self-feedback ${model.self[index].toFixed(2)}.${model.self[index] <= .10 ? ' Already lowered.' : ' Lower to 0.10 for 1 coin.'}`, 'aria-pressed': selected });
        const title = svgElement('title', {});
        title.textContent = `${symptom.short} · Self-feedback αᵢᵢ = ${model.self[index].toFixed(2)}${model.self[index] <= .10 ? ' · Already lowered' : ' · Lower to 0.10 for 1 coin'}`;
        loop.append(title);
        const geometry = { d: `M${start.join(',')} C${first.join(',')} ${second.join(',')} ${end.join(',')}` };
        loop.append(svgElement('path', { ...geometry, class: 'self-loop-path', 'marker-end': 'url(#self-loop-arrow)' }));
        loop.append(svgElement('path', { ...geometry, class: 'self-loop-hit' }));
        activateWithKeyboard(loop, () => {
          if (phase !== 'playing') return;
          type = 'self'; target = index; drawNetwork(); renderSelection();
        });
        loops.append(loop);
      });
      svg.append(loops);
    }
    const nodesGroup = svgElement('g', { 'aria-label': 'Nine depression symptoms' });
    I.symptoms.forEach((symptom, index) => {
      const on = M.isOn(state, index);
      const changed = on !== M.isOn(previousState, index);
      const affected = turnAnimation && turnAnimation.type !== 'edge' && turnAnimation.target === index;
      const applied = affected && turnAnimation.stage === 'applied';
      const reactivated = affected && turnAnimation.type === 'node' && !applied && (continuous() ? state[index] > turnAnimation.appliedLevel + .005 : on);
      const node = svgElement('g', { transform: `translate(${symptom.x},${symptom.y})`,
        class: `network-node${on ? '' : ' inactive'}${type !== 'edge' && target === index ? ' selected' : ''}${changed ? ' changed' : ''}${interventionTarget === index ? ' intervened' : ''}${applied ? (turnAnimation.type === 'node' ? ' node-intervention' : ' field-intervention') : ''}${reactivated ? ' reactivated' : ''}`,
        tabindex: type === 'edge' ? '-1' : '0', role: 'button', 'aria-label': `${symptom.name}: ${on ? 'active' : 'inactive'}${model.fieldDoses[index] ? `, ${model.fieldDoses[index]} field shifts` : ''}`,
        'aria-pressed': type !== 'edge' && target === index, 'data-node': index });
      const title = svgElement('title', {});
      title.textContent = `${symptom.name} · ${on ? 'Active' : 'Inactive'}`;
      node.append(title);
      node.append(svgElement('circle', { r: 36, class: 'node-halo' }));
      node.append(svgElement('circle', { r: 39, class: 'node-ring' }));
      if (applied || reactivated) node.append(svgElement('circle', { r: 44, class: 'action-wave' }));
      node.append(svgElement('circle', { r: 26, class: 'node-body' }));
      const symbol = svgElement('text', { x: 0, y: -1, class: 'node-symbol', 'aria-hidden': 'true' });
      symbol.textContent = on ? '+' : '−';
      node.append(symbol);
      const label = svgElement('text', { y: 49, class: 'node-label', 'aria-hidden': 'true' });
      label.textContent = symptom.short;
      node.append(label);
      const mini = svgElement('text', { y: 63, class: 'node-mini', 'aria-hidden': 'true' });
      mini.textContent = on ? 'ACTIVE' : 'INACTIVE';
      node.append(mini);
      if (model.fieldDoses[index]) {
        node.append(svgElement('circle', { cx: 24, cy: -20, r: 10, class: 'field-marker' }));
        const marker = svgElement('text', { x: 24, y: -20, class: 'field-marker-text', 'aria-hidden': 'true' });
        marker.textContent = `↓${model.fieldDoses[index]}`;
        node.append(marker);
      }
      if (affected && (applied || turnAnimation.type === 'node')) {
        const callout = svgElement('g', { class: `action-callout${reactivated ? ' reactivation-callout' : ''}`, 'aria-hidden': 'true' });
        callout.append(svgElement('rect', { x: -75, y: -69, width: 150, height: 25, rx: 12.5 }));
        const text = svgElement('text', { x: 0, y: -56 });
        text.textContent = applied ? (turnAnimation.type === 'node' ? continuous() ? `${percent(turnAnimation.beforeLevel)} → ${percent(turnAnimation.appliedLevel)}` : '✓ SWITCHED OFF' : turnAnimation.type === 'self' ? '↻ SELF-FEEDBACK 0.10' : '↓ FIELD LOWERED') : reactivated ? continuous() ? '↑ RISING AGAIN' : '↻ REACTIVATED' : continuous() ? 'STILL REDUCED' : 'STILL INACTIVE';
        callout.append(text);
        node.append(callout);
      }
      activateWithKeyboard(node, () => { if (type !== 'edge') selectTarget(index); });
      nodesGroup.append(node);
    });
    svg.append(nodesGroup);
    if (continuous()) updateDynamicVisuals();
  }

  function levelColour(level) {
    if (level <= D.settings.greenLimit) return '#92b283';
    const stops = [[146, 178, 131], [218, 200, 155], [212, 121, 102]];
    const position = (level - D.settings.greenLimit) / (1 - D.settings.greenLimit) * 2;
    const index = Math.min(1, Math.floor(position)), mix = position - index;
    return `rgb(${stops[index].map((v, i) => Math.round(v + (stops[index + 1][i] - v) * mix)).join(',')})`;
  }

  function updateDynamicVisuals() {
    const drift = D.drift(model, state);
    $('network').dataset.state = JSON.stringify(state);
    $('network').querySelectorAll('[data-node]').forEach(node => {
      const index = Number(node.dataset.node), level = state[index], green = !D.isOn(state, index);
      node.classList.toggle('inactive', green);
      node.dataset.level = level.toFixed(6);
      node.setAttribute('aria-label', `${I.symptoms[index].name}: ${(level * 100).toFixed(1)}% intensity${green ? ', green' : ''}${model.fieldDoses[index] ? `, ${model.fieldDoses[index]} field shifts` : ''}`);
      node.querySelector('title').textContent = `${I.symptoms[index].name} · ${(level * 100).toFixed(1)}% · ${green ? 'Green' : drift[index] < -.002 ? 'Fading' : drift[index] > .002 ? 'Rising' : 'Steady'}`;
      node.querySelector('.node-body').style.fill = levelColour(level);
      const rounded = Math.round(level * 100);
      node.querySelector('.node-symbol').textContent = !green && rounded === 10 ? '>10%' : `${rounded}%`;
      node.querySelector('.node-mini').textContent = green ? 'GREEN' : drift[index] < -.002 ? '↓ FADING' : drift[index] > .002 ? '↑ RISING' : 'STEADY';
      const callout = node.querySelector('.action-callout text');
      if (callout && turnAnimation?.stage === 'response' && turnAnimation.type === 'node') {
        const rising = level > turnAnimation.appliedLevel + .005;
        node.classList.toggle('reactivated', rising);
        node.querySelector('.action-callout').classList.toggle('reactivation-callout', rising);
        callout.textContent = rising ? '↑ RISING AGAIN' : 'STILL REDUCED';
      }
    });
    renderTime();
  }

  function renderTime() {
    if (!continuous()) return;
    const running = phase === 'busy' && turnAnimation?.stage === 'response';
    $('model-time').textContent = `t = ${modelTime.toFixed(1)}`;
    $('time-status').textContent = phase === 'won' ? 'All green · clock stopped' : phase === 'exhausted' ? 'Round complete' : running ? animationPaused ? 'Paused · resume to continue' : 'Time is passing' : phase === 'busy' ? 'Move applied · time paused' : 'Paused · choose a move';
    $('watch-time').disabled = phase !== 'playing';
    $('pause-time').disabled = !running;
    $('pause-time').textContent = animationPaused ? '▷ Resume' : 'Ⅱ Pause';
    $('pause-time').setAttribute('aria-label', animationPaused ? 'Resume the model response' : 'Pause the model response');
    $('time-fill').style.width = `${responseProgress * 100}%`;
    document.querySelector('.time-track').setAttribute('aria-valuenow', String(Math.round(responseProgress * 100)));
    $('mean-level').textContent = percent(D.mean(state));
    const extent = Math.max(modelTime, 1);
    $('level-trace-line').setAttribute('d', timeTrace.map((sample, index) => `${index ? 'L' : 'M'}${(sample.time / extent * 600).toFixed(1)},${(50 - sample.mean * 48).toFixed(1)}`).join(' '));
    $('level-trace').setAttribute('aria-label', `Average symptom intensity over model time, now ${percent(D.mean(state))} at time ${modelTime.toFixed(1)}`);
  }

  function renderModelChoice() {
    const dynamic = continuous();
    document.body.classList.toggle('continuous-model', dynamic);
    document.querySelectorAll('[data-model]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.model === modelMode));
      button.disabled = phase === 'busy';
    });
    document.querySelector('[data-type="self"]').hidden = !dynamic;
    $('model-summary').textContent = dynamic ? 'Park, Waldorp & Vasconcelos · Gradual change, self feedback and directed influences.' : 'Symptoms switch on or off. Chance shapes the response.';
    $('time-panel').hidden = !dynamic;
    $('binary-key').hidden = dynamic;
    $('continuous-key').hidden = !dynamic;
    $('activity-label').textContent = dynamic ? 'SYMPTOMS ABOVE 10%' : 'ACTIVE SYMPTOMS';
    $('activity-goal').textContent = dynamic ? 'All nine at 10% or below to win.' : 'Switch off every symptom to win.';
    $('budget-costs').textContent = dynamic ? 'Every intervention costs 1 coin.' : 'Node: 1 · field: 2 · edge: 3 coins.';
    $('timing-note').textContent = dynamic ? 'Watch up to 20 model-time units after treatment. All nine at ≤ 10% ends the round.' : 'The network responds for up to two sweeps. All nine green ends the round.';
    document.querySelector('[data-type="field"] .intervention-copy > span').textContent = dynamic ? `Lower baseline drive β by ${D.settings.fieldDose.toFixed(2)} for this round.` : 'Make a symptom less likely to activate.';
    document.querySelector('[data-type="node"] .intervention-copy > strong').firstChild.textContent = dynamic ? 'Reduce symptom intensity ' : 'Switch off a node ';
    document.querySelector('[data-type="node"] .intervention-copy > span').textContent = dynamic ? 'Lower by 25 percentage points, stopping at 10%.' : 'A one-time push. It can turn back on.';
    document.querySelector('.node-icon path').setAttribute('d', dynamic ? 'M4 5v14M10 9v10M16 13v6M3 19h18' : 'M12 3v9M6.4 6.4a8 8 0 1 0 11.2 0');
    document.querySelector('[data-type="edge"] .intervention-copy > span').textContent = dynamic ? 'Remove one influence between symptoms.' : 'Break one connection for this round.';
    document.querySelector('.edge-icon').textContent = dynamic ? '→' : '↔';
  }

  function renderStats() {
    const remaining = coinsRemaining();
    const spent = budget - remaining;
    $('coin-count').replaceChildren(document.createTextNode(`${remaining} `), element('span', 'metric-muted', `/ ${budget}`));
    const coins = $('coins');
    coins.replaceChildren();
    coins.setAttribute('aria-label', `${remaining} coins remaining`);
    for (let i = 0; i < budget; i++) coins.append(element('span', `coin${i >= remaining ? ' spent' : ''}`));
    const count = M.activeCount(state);
    $('active-count').replaceChildren(document.createTextNode(String(count)), element('span', 'metric-muted', ' / 9'));
    $('state-tag').textContent = count === 0 ? 'All green' : count <= 2 ? 'Almost there' : count <= 5 ? 'Changing' : 'High activity';
    $('state-tag').classList.toggle('low', count <= 2);
    const green = M.N - count;
    $('recovery-count').replaceChildren(document.createTextNode(String(green)), element('span', 'metric-muted', ` / ${M.N}`));
    $('recovery-fill').style.width = `${green / M.N * 100}%`;
    document.querySelector('.outlook-track').setAttribute('aria-valuenow', String(green));
    $('move-count').textContent = `${spent} ${spent === 1 ? 'coin' : 'coins'} spent`;
    $('network-badge').textContent = phase === 'busy' ? (turnAnimation?.stage === 'applied' ? 'MOVE APPLIED' : continuous() ? animationPaused ? 'TIME PAUSED' : 'NETWORK EVOLVING' : `RESPONSE · ${turnAnimation?.sweep || 1} / 2`) : phase === 'won' ? 'LOOP BROKEN' : phase === 'exhausted' ? 'ROUND COMPLETE' : 'YOUR MOVE';
    document.body.classList.toggle('busy', phase === 'busy');
    $('restart').disabled = phase === 'busy';
    $('undo').disabled = !history.length || phase === 'busy' || remaining < undoCost;
    $('undo').title = !history.length ? 'No actions to undo' : remaining < undoCost ? 'No coins left for undo' : 'Undo costs 1 coin. Earlier spending stays spent.';
    renderTime();
  }

  function renderForecast() {
    const area = $('forecast-result');
    const cached = validTarget() ? purchased.get(cacheKey()) : undefined;
    area.replaceChildren();
    area.hidden = !cached;
    if (!cached) return;
    area.append(element('p', 'forecast-title', 'YOUR PURCHASED FORECAST'));
    const comparison = element('div', 'forecast-comparison');
    for (const [label, probability] of [['Without this move', cached.baseline], ['With this move', cached.projected]]) {
      const column = element('div');
      column.append(element('strong', '', percent(probability)), element('span', '', label));
      comparison.append(column);
    }
    if (continuous()) {
      const levels = element('p', 'forecast-levels', `Expected average intensity: ${percent(cached.baselineMean)} → ${percent(cached.projectedMean)} with this move.`);
      area.append(comparison, levels, element('p', '', `Estimated chance of all nine intensities being ≤ 10% at t + ${D.settings.forecastTime}. ${cached.paths} simulated paths per scenario; approximate, not a promise. Zero means no successes in this sample. Treatment costs ${coinLabel(treatmentCost(type))}.`));
    } else area.append(comparison, element('p', '', `Chance of all nine nodes being green after six sweeps. A probability, not a promise. Applying this treatment costs ${coinLabel(treatmentCost(type))}.`));
  }

  function renderSelection() {
    document.querySelectorAll('[data-type]').forEach(button => {
      const selected = button.dataset.type === type;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.disabled = phase === 'busy' || phase === 'won';
      button.querySelector('.intervention-price').textContent = coinLabel(treatmentCost(button.dataset.type));
    });
    const price = treatmentCost(type);
    const remaining = coinsRemaining();
    $('treatment-cost').textContent = String(price);
    const hasTarget = target !== null;
    $('target-kicker').textContent = hasTarget ? (type === 'edge' ? 'SELECTED CONNECTION' : 'SELECTED SYMPTOM') : (type === 'edge' ? 'SELECT A CONNECTION' : 'SELECT A SYMPTOM');
    $('target-name').textContent = hasTarget ? targetName(type, target) : 'Where will you intervene?';
    let description = initialMessages[type];
    if (continuous()) description = type === 'node' ? 'Choose a symptom above 10%. Reduce its intensity by 25 percentage points, with a floor of 10%, then watch it evolve.' : type === 'edge' ? 'Choose an arrow between symptoms. Remove only that direction of influence for this round.' : type === 'self' ? initialMessages.self : 'Choose a symptom. Lower its baseline activation drive β for this round.';
    let detail = '';
    if (hasTarget) {
      if (type === 'node') {
        description = M.isOn(state, target) ? continuous() ? `Current intensity: ${(state[target] * 100).toFixed(1)}%. Reduce it by 25 percentage points, stopping at 10%. This is a one-time push; intensity remains free to rise or fade as time passes.` : 'Switch this symptom off once. It will be free to reactivate when the network evolves.' : continuous() ? 'This symptom is already in the green band (≤ 10%). Choose a higher-intensity symptom or try another intervention.' : 'This symptom is already inactive. Choose an active symptom to switch off, or try a field intervention.';
        detail = `One-time state change · ${coinLabel(price)}`;
      } else if (type === 'edge') {
        description = continuous() ? 'Remove this arrow only, from source to target. A reverse arrow, if present, and other paths stay in place.' : 'Remove this connection in both directions. The two symptoms can still influence each other through other paths.';
        detail = `Lasts for this round · ${coinLabel(price)}`;
      } else if (type === 'self') {
        description = model.self[target] > .10 ? `Lower this symptom’s self-feedback αᵢᵢ from ${model.self[target].toFixed(2)} to 0.10. This weakens self-reinforcement without setting its intensity.` : 'This loop is already at 0.10. Choose another symptom or a different intervention.';
        detail = `Self-feedback: ${model.self[target].toFixed(2)} · Lasts for this round · ${coinLabel(price)}`;
      } else {
        description = continuous() ? `Lower β by ${D.settings.fieldDose} (currently ${model.thresholds[target].toFixed(2)}). This changes the symptom’s future rate of change, rather than setting its intensity.` : 'Lower this symptom’s activation parameter. Its tendency to switch on decreases, but its current state is not forced to change.';
        detail = `Lasts for this round · ${model.fieldDoses[target]} previous ${model.fieldDoses[target] === 1 ? 'shift' : 'shifts'} · ${coinLabel(price)}`;
      }
    }
    if (phase === 'busy' && turnAnimation) {
      $('target-kicker').textContent = turnAnimation.stage === 'applied' ? 'YOUR MOVE HAS BEEN APPLIED' : 'NOW THE NETWORK RESPONDS';
      if (turnAnimation.stage === 'applied') {
        description = type === 'node' ? continuous() ? `Intensity was reduced from ${percent(turnAnimation.beforeLevel)} to ${percent(turnAnimation.appliedLevel)}. Time is paused briefly to show your move; intensity can still rise or fade.` : 'This symptom is now off. Your move registered. Next, its neighbours will have a chance to reactivate it.' : type === 'edge' ? 'This connection has been removed. Next, watch how the network responds without this direct influence.' : type === 'self' ? 'Self-feedback is now 0.10. Its current intensity was not reset. Watch how the weaker self-reinforcement changes the response.' : 'The activation field has been lowered. The symptom is less likely to switch on; its current state is not forced to change.';
      } else description = type === 'node' && M.isOn(state, target) ? 'The symptom has reactivated after your move. It was successfully switched off; the network then turned it back on.' : `The intervention was applied. You are now watching the network’s response: sweep ${turnAnimation.sweep} of 2.`;
      detail = `${coinLabel(price)} spent · Treatment applied`;
    }
    if (continuous() && phase === 'busy' && turnAnimation?.stage === 'response') {
      description = animationPaused ? 'The clock and intensities are paused. Resume to continue watching the same response.' : 'Intensities are evolving under the model. Watch the percentages, colours and clock as symptoms fade or rebound.';
      detail = `t = ${modelTime.toFixed(1)} · ${turnAnimation.type === 'wait' ? 'No treatment or coin charge' : 'Treatment applied'}`;
    }
    if (phase === 'won') {
      $('target-kicker').textContent = 'ROUND COMPLETE';
      $('target-name').textContent = 'All nine nodes are green';
      description = coinsRemaining() >= undoCost ? 'You earned the Loop Breaker award. Replay to try a cheaper path, or spend 1 coin to undo your final move.' : 'You earned the Loop Breaker award. The round is complete. Play again to try a different path.';
      detail = `${coinLabel(coinsSpent())} spent · ${budget - coinsSpent()} saved`;
    }
    $('target-description').textContent = description;
    $('target-detail').textContent = detail;
    $('target-detail').hidden = !detail;
    const enabled = validTarget() && phase === 'playing';
    $('apply').disabled = !enabled || remaining < price;
    $('apply-label').textContent = phase === 'busy' ? (turnAnimation?.stage === 'applied' ? '✓ Move applied' : 'Network responding…') : phase === 'won' ? 'Loop broken' : phase === 'exhausted' ? 'No coins left' : !validTarget() ? (type === 'self' && target !== null ? 'Loop already at 0.10' : 'Select a target') : remaining < price ? `Need ${coinLabel(price)}` : type === 'node' ? continuous() ? 'Reduce intensity' : 'Switch symptom off' : type === 'edge' ? 'Remove connection' : type === 'self' ? 'Lower loop to 0.10' : 'Shift this field';
    const cached = purchased.has(cacheKey());
    $('buy-forecast').disabled = !enabled || remaining < forecastCost || cached;
    $('buy-forecast').firstElementChild.lastChild.textContent = cached ? ' Forecast purchased' : ' Buy a forecast';
    $('forecast-note').textContent = phase === 'won' ? 'Your network is all green. The round is complete.' : cached ? 'Paid once. You can review this tip until the next treatment.' : remaining === forecastCost ? 'This uses your last coin, leaving none for treatment.' : enabled && remaining - forecastCost < price ? `A forecast leaves too few coins for this ${price}-coin treatment.` : 'Optional: spend a coin to preview your selected move.';
    renderForecast();
  }

  function renderHistory() {
    const list = $('history');
    list.replaceChildren();
    if (!ledger.length) {
      const empty = element('div', 'history-empty');
      empty.append(element('span', 'history-empty-line'), document.createTextNode('Your first intervention starts the story.'));
      list.append(empty);
      return;
    }
    ledger.forEach((entry, index) => {
      const row = element('div', `history-row${entry.undone ? ' undone-action' : ''}`);
      row.append(element('span', 'history-number', String(index + 1)));
      const description = element('div', 'history-description');
      const actionLabel = entry.kind === 'undo' ? 'Undo' : entry.kind === 'forecast' ? 'Forecast purchased' : entry.type === 'node' ? continuous() ? 'Intensity reduced' : 'Switched off' : entry.type === 'edge' ? 'Connection removed' : entry.type === 'self' ? 'Self-feedback lowered' : 'Field shifted';
      description.append(element('strong', '', `${entry.kind === 'wait' ? 'Watched time pass' : `${actionLabel} · ${targetName(entry.type, entry.target)}`}${entry.undone ? ' · undone' : ''}`));
      if (entry.kind === 'undo') {
        description.append(element('small', '', `${coinLabel(entry.cost)} · Reversed the last action. Earlier spending stays spent.`));
        row.append(description, element('span', 'history-activity', 'Undo fee'));
      } else if (entry.kind === 'forecast') {
        description.append(element('small', '', `${coinLabel(entry.cost)} · A paid tip. The network did not advance.`));
        row.append(description, element('span', 'history-forecast', `${percent(entry.forecast.projected)} predicted`));
      } else if (continuous() && entry.finalState !== undefined) {
        description.append(element('small', '', `${coinLabel(entry.cost)} · t = ${entry.beforeTime.toFixed(1)} → ${entry.finalTime.toFixed(1)} · average intensity ${percent(D.mean(entry.beforeState))} → ${percent(D.mean(entry.finalState))}`));
        row.append(description, element('span', 'history-activity', `${D.N - D.activeCount(entry.finalState)} / 9 green`));
      } else if (entry.finalState === undefined) {
        description.append(element('small', '', `${coinLabel(entry.cost)} · Intervention applied; waiting for the network response.`));
        row.append(description, element('span', 'history-activity', 'Responding…'));
      } else {
        const reactivated = entry.type === 'node' && M.isOn(entry.finalState, entry.target);
        description.append(element('small', '', `${coinLabel(entry.cost)} · ${entry.sweepCounts.length ? `Sweep checks: ${entry.sweepCounts.join(' → ')} active` : 'All green immediately after the intervention'}${reactivated ? ' · Target reactivated' : ''}`));
        row.append(description, element('span', 'history-activity', `${M.activeCount(entry.beforeState)} → ${M.activeCount(entry.finalState)} active`));
      }
      list.append(row);
    });
  }

  function renderResult() {
    const result = $('result');
    result.replaceChildren();
    result.hidden = phase !== 'won' && phase !== 'exhausted';
    result.classList.toggle('exhausted', phase === 'exhausted');
    if (result.hidden) { renderExhaustionPrompt(); return; }
    if (phase === 'won') {
      const tips = ledger.filter(entry => entry.kind === 'forecast').length;
      const undos = ledger.filter(entry => entry.kind === 'undo').length;
      result.append(element('h3', '', 'You broke the loop.'), element('p', '', `All nine nodes are green. You spent ${coinsSpent()} of ${budget} coins, including ${tips} ${tips === 1 ? 'forecast' : 'forecasts'} and ${undos} ${undos === 1 ? 'undo' : 'undos'}. Your Loop Breaker award is yours!`));
    } else result.append(element('h3', '', 'Out of coins.'), element('p', '', 'Your coins are spent. Play again to try a different path.'));
    const again = element('button', phase === 'exhausted' ? 'primary-button' : 'text-button', 'Play again');
    again.type = 'button';
    again.addEventListener('click', restart);
    result.append(again);
    renderExhaustionPrompt();
  }

  function renderExhaustionPrompt() {
    const dialog = $('round-over-dialog');
    if (phase !== 'exhausted') {
      exhaustionPromptShown = false;
      if (dialog.open) dialog.close();
      return;
    }
    if (exhaustionPromptShown) return;
    exhaustionPromptShown = true;
    $('round-over-description').textContent = `You’ve spent all ${budget} treatment coins. Try a different path to get the whole network green.`;
    if ($('learn-dialog').open) $('learn-dialog').close();
    dialog.showModal();
  }

  function renderCelebration() {
    const won = phase === 'won';
    const card = document.querySelector('.network-card');
    const particles = $('victory-confetti');
    $('victory-award').hidden = !won;
    card.classList.toggle('won', won);
    if (!won) {
      if (celebrationTimer !== null) clearTimeout(celebrationTimer);
      celebrationTimer = null;
      celebrationPlayed = false;
      particles.replaceChildren();
      return;
    }
    $('award-score').textContent = `${coinLabel(coinsSpent())} spent · ${budget - coinsSpent()} saved`;
    if (celebrationPlayed) return;
    celebrationPlayed = true;
    if (!reducedMotion) {
      const colors = ['#92b283', '#7598a9', '#cba951', '#d9c37e', '#315e3e'];
      const width = Math.min(card.clientWidth * .45, 370);
      for (let i = 0; i < 36; i++) {
        const angle = i * 2.399963;
        const piece = element('span', 'prize-confetti');
        const burstX = Math.cos(angle) * width * (.5 + (i % 4) / 6);
        piece.style.setProperty('--burst-x', `${burstX}px`);
        piece.style.setProperty('--burst-y', `${-70 - Math.abs(Math.sin(angle)) * 170}px`);
        piece.style.setProperty('--fall-x', `${burstX * 1.25}px`);
        piece.style.setProperty('--fall-y', `${250 + (i % 5) * 55}px`);
        piece.style.setProperty('--spin', `${180 + i * 37}deg`);
        piece.style.backgroundColor = colors[i % colors.length];
        piece.style.animationDelay = `${(i % 6) * .035}s`;
        if (i % 3 === 0) piece.classList.add('round-confetti');
        particles.append(piece);
      }
      celebrationTimer = setTimeout(() => { particles.replaceChildren(); celebrationTimer = null; }, 3500);
    }
    const bounds = card.getBoundingClientRect();
    if (bounds.top < 16 || bounds.bottom > window.innerHeight - 16) {
      card.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'instant' : 'smooth' });
    }
  }

  function render(previousState = state, interventionTarget = null) {
    renderModelChoice();
    drawNetwork(previousState, interventionTarget);
    renderStats(); renderSelection(); renderHistory(); renderResult(); renderCelebration();
  }

  function selectTarget(index) {
    if (phase === 'busy') return;
    target = index;
    drawNetwork(); renderSelection();
  }

  function captureDynamic() {
    return { model: D.cloneModel(model), state: [...state], random: random.snapshot(),
      time: modelTime, trace: timeTrace.map(sample => ({ ...sample })),
      purchased: [...purchased], version: treatmentVersion };
  }

  async function animateDynamic(entry, duration) {
    const startTime = modelTime;
    const response = D.trajectory(model, state, random, duration, true);
    animationPaused = false;
    turnAnimation = { type: entry.type, target: entry.target, stage: 'response', appliedLevel: entry.appliedLevel };
    timeTrace.push({ time: modelTime, mean: D.mean(state) });
    drawNetwork(); renderStats(); renderSelection();
    for (let index = 1; index < response.samples.length; index++) {
      // Reduced motion changes presentation only, never the simulated path.
      if (reducedMotion && index % 20 !== 0 && index !== response.samples.length - 1) continue;
      while (animationPaused || document.hidden || $('learn-dialog').open) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const sample = response.samples[index];
      state = [...sample.state]; modelTime = startTime + sample.time;
      responseProgress = sample.time / duration;
      timeTrace.push({ time: modelTime, mean: D.mean(state) });
      if (timeTrace.length > 800) timeTrace = timeTrace.filter((_, i) => i % 2 === 0 || i === timeTrace.length - 1);
      updateDynamicVisuals(); renderStats(); renderSelection();
      await new Promise(resolve => setTimeout(resolve, reducedMotion ? 180 : 50));
    }
    state = [...response.state]; modelTime = startTime + response.elapsed;
    entry.finalState = [...state]; entry.finalTime = modelTime;
    history.push(entry); turnAnimation = null;
    phase = isWon() ? 'won' : coinsRemaining() <= 0 ? 'exhausted' : 'playing';
    setMessage(phase === 'won' ? 'All nine intensities are at 10% or below together. You earned the Loop Breaker award!' : `Time advanced to ${modelTime.toFixed(1)}. Average intensity is ${percent(D.mean(state))}; ${9 - D.activeCount(state)} of nine nodes are green. Choose a move or watch more time pass.`, phase === 'won' ? 'You broke the loop.' : 'Network response complete · time paused');
    render();
  }

  async function applyDynamicTreatment() {
    const entry = { kind: 'treatment', type, target, cost: treatmentCost(type),
      before: captureDynamic(), beforeState: [...state], beforeTime: modelTime };
    ledger.push(entry); phase = 'busy'; responseProgress = 0;
    state = D.intervene(model, state, type, target);
    if (type === 'node') entry.appliedLevel = state[target];
    treatmentVersion++; purchased.clear();
    turnAnimation = { type, target, stage: 'applied', beforeLevel: entry.beforeState[target], appliedLevel: entry.appliedLevel };
    setMessage(type === 'node' ? `Intensity was reduced from ${percent(entry.beforeState[target])} to ${percent(state[target])}. It is free to rise or fade when time resumes.` : type === 'edge' ? 'This arrow is removed. Its reverse direction, if present, stays in place.' : type === 'self' ? 'Self-feedback is now 0.10. The symptom’s current intensity is unchanged; weaker self-reinforcement acts as time passes.' : 'The baseline activation drive is lower. Watch the intensity change as time resumes.', `✓ ${targetName(type, target)} · ${coinLabel(entry.cost)} spent`);
    render();
    const visibleTarget = $('network').querySelector(type === 'edge' ? '.edge-cut' : `[data-node="${target}"]`);
    if (visibleTarget) {
      const bounds = visibleTarget.getBoundingClientRect();
      if (bounds.top < 24 || bounds.bottom > window.innerHeight - 24) visibleTarget.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'instant' : 'smooth' });
    }
    await sleep(1600);
    await animateDynamic(entry, D.settings.responseTime);
  }

  async function watchTime() {
    if (!continuous() || phase !== 'playing') return;
    const entry = { kind: 'wait', type: 'wait', target: null, cost: 0,
      before: captureDynamic(), beforeState: [...state], beforeTime: modelTime };
    ledger.push(entry); phase = 'busy'; responseProgress = 0;
    treatmentVersion++; purchased.clear();
    setMessage('No intervention is applied and no coin is spent. Watch the network evolve under its current parameters.', 'Letting time pass · +10 model-time units');
    render();
    await animateDynamic(entry, D.settings.watchTime);
  }

  async function applyTreatment() {
    if (phase !== 'playing' || !validTarget() || coinsRemaining() < treatmentCost(type)) return;
    if (continuous()) { await applyDynamicTreatment(); return; }
    const entry = { kind: 'treatment', type, target, cost: treatmentCost(type), beforeState: state, sweepCounts: [] };
    ledger.push(entry);
    const label = targetName(type, target);
    phase = 'busy';
    const previousState = state;
    state = M.intervene(model, state, type, target);
    purchased.clear();
    treatmentVersion++;
    turnAnimation = { type, target, stage: 'applied' };
    setMessage(type === 'node' ? 'The symptom is off. The network is paused briefly so you can see the effect of your move.' : type === 'edge' ? 'This direct connection is now removed. The network will respond next.' : 'Its activation field is now lower. The network will respond next.', type === 'node' ? `✓ ${label} switched off · ${coinLabel(entry.cost)} spent` : type === 'edge' ? `✓ Connection removed · ${coinLabel(entry.cost)} spent` : `✓ ${label}: field lowered · ${coinLabel(entry.cost)} spent`);
    render(previousState, type === 'node' ? target : null);
    const visibleTarget = $('network').querySelector(type === 'edge' ? '.edge-cut' : `[data-node="${target}"]`);
    if (visibleTarget) {
      const bounds = visibleTarget.getBoundingClientRect();
      if (bounds.top < 24 || bounds.bottom > window.innerHeight - 24) {
        visibleTarget.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'instant' : 'smooth' });
      }
    }
    await sleep(1600);
    for (let sweep = 0; sweep < 2 && !isWon(); sweep++) {
      const before = state;
      state = M.sampleSweep(model, state, random);
      const active = M.activeCount(state);
      entry.sweepCounts.push(active);
      turnAnimation = { type, target, stage: 'response', sweep: sweep + 1 };
      const cameBack = type === 'node' && M.isOn(state, target);
      setMessage(cameBack ? 'Your switch-off worked. The symptom then reactivated under the influence of the network.' : `${active} symptoms are active. Your intervention has been applied; this is the network’s response.`, cameBack ? `↻ ${label} reactivated · response ${sweep + 1} of 2` : `Network responds · sweep ${sweep + 1} of 2`);
      drawNetwork(before); renderStats(); renderSelection();
      await sleep(950);
    }
    entry.finalState = state;
    history.push(entry);
    turnAnimation = null;
    phase = isWon() ? 'won' : coinsSpent() >= budget ? 'exhausted' : 'playing';
    const reactivated = entry.type === 'node' && M.isOn(state, entry.target);
    setMessage(phase === 'won' ? 'All nine nodes are green together. You earned the Loop Breaker award!' : `${entry.sweepCounts.join(' → ')} active symptoms across the two sweep checks.${reactivated ? ' The switch-off registered; the feedback loop then turned the symptom back on.' : ' Choose your next move.'}`, phase === 'won' ? 'You broke the loop.' : reactivated ? `Move applied → ${label} reactivated` : 'Move applied · network response complete');
    render();
  }

  function buyForecast() {
    if (phase !== 'playing' || !validTarget() || coinsRemaining() < forecastCost || purchased.has(cacheKey())) return;
    if (continuous()) {
      const before = captureDynamic();
      const forecast = D.forecast(model, state, type, target);
      purchased.set(cacheKey(), forecast);
      const entry = { kind: 'forecast', type, target, cost: forecastCost, forecast, before };
      history.push(entry); ledger.push(entry);
      if (coinsSpent() >= budget) phase = 'exhausted';
      setMessage(`Estimated ${percent(forecast.projected)} all-green probability at t + ${D.settings.forecastTime}; expected average intensity ${percent(forecast.projectedMean)}. Based on ${forecast.paths} simulated paths. The clock and round’s random sequence have not advanced.`, 'Forecast purchased · 1 coin');
      render();
      return;
    }
    const baseline = M.forecast(model, state).healthyProbability;
    const alteredModel = { edges: model.edges.map(e => ({ ...e })), thresholds: [...model.thresholds], fieldDoses: [...model.fieldDoses] };
    const alteredState = M.intervene(alteredModel, state, type, target);
    const projected = M.forecast(alteredModel, alteredState).healthyProbability;
    const forecast = { baseline, projected };
    purchased.set(cacheKey(), forecast);
    const entry = { kind: 'forecast', type, target, cost: forecastCost, forecast };
    history.push(entry);
    ledger.push(entry);
    if (coinsSpent() >= budget) phase = 'exhausted';
    setMessage(`Forecast purchased for one coin. ${targetName(type, target)}: ${percent(projected)} chance of all nine nodes being green after six sweeps if you apply this intervention. The network has not advanced.`);
    renderStats(); renderSelection(); renderHistory(); renderResult();
  }

  function resetModel() {
    model = M.createModel(); state = continuous() ? D.initialState() : M.SIZE - 1; random = M.randomGenerator(seed);
    history = []; ledger = []; purchased = new Map(); treatmentVersion = 0; phase = 'playing'; turnAnimation = null;
    modelTime = 0; timeTrace = continuous() ? [{ time: 0, mean: D.mean(state) }] : [];
    animationPaused = false; responseProgress = 0;
  }

  function restart() {
    if (phase === 'busy') return;
    resetModel(); target = null; type = 'node';
    setMessage('A fresh start, with the same network and random sequence. Choose your first intervention.');
    render();
  }

  function undo() {
    if (phase === 'busy' || !history.length || coinsRemaining() < undoCost) return;
    if (continuous()) {
      const removed = history.pop();
      removed.undone = true;
      ledger.push({ kind: 'undo', type: removed.type, target: removed.target, cost: undoCost });
      const before = removed.before;
      model = D.cloneModel(before.model); state = [...before.state]; random.restore(before.random);
      modelTime = before.time; timeTrace = before.trace.map(sample => ({ ...sample }));
      purchased = new Map(before.purchased); treatmentVersion = before.version;
      responseProgress = 0; animationPaused = false; turnAnimation = null; target = null;
      phase = coinsRemaining() <= 0 ? 'exhausted' : isWon() ? 'won' : 'playing';
      setMessage('The last action, clock and random sequence are restored. Earlier spending stays spent.', 'Undo applied · 1 coin spent');
      render(); return;
    }
    const removed = history[history.length - 1];
    removed.undone = true;
    const spending = ledger;
    spending.push({ kind: 'undo', type: removed.type, target: removed.target, cost: undoCost });
    const retained = history.slice(0, -1);
    resetModel();
    ledger = spending;
    for (const entry of retained) {
      if (entry.kind === 'forecast') {
        purchased.set(`${treatmentVersion}:${entry.type}:${entry.target}`, entry.forecast);
      } else {
        state = M.intervene(model, state, entry.type, entry.target);
        for (let i = 0; i < entry.sweepCounts.length; i++) {
          state = M.sampleSweep(model, state, random);
        }
        treatmentVersion++; purchased.clear();
      }
      history.push(entry);
    }
    target = null;
    phase = coinsSpent() >= budget ? 'exhausted' : 'playing';
    setMessage('The last action was reversed and the network restored. Earlier spending stays spent.', 'Undo applied · 1 coin spent');
    render();
  }

  document.querySelectorAll('[data-type]').forEach(button => button.addEventListener('click', () => {
    if (phase === 'busy') return;
    type = button.dataset.type; target = null;
    drawNetwork(); renderSelection();
  }));
  document.querySelectorAll('[data-model]').forEach(button => button.addEventListener('click', () => {
    if (phase === 'busy' || modelMode === button.dataset.model) return;
    modelMode = button.dataset.model; M = continuous() ? D : I;
    resetModel(); target = null; type = 'node';
    setMessage(continuous() ? 'Choose a treatment, or Watch +10 to see how intensities evolve. The clock pauses between moves.' : 'A fresh Ising round. Choose an intervention, then its target.');
    render();
  }));
  $('watch-time').addEventListener('click', watchTime);
  $('pause-time').addEventListener('click', () => {
    if (!continuous() || phase !== 'busy' || turnAnimation?.stage !== 'response') return;
    animationPaused = !animationPaused;
    renderStats(); renderSelection();
  });
  $('apply').addEventListener('click', applyTreatment);
  $('buy-forecast').addEventListener('click', buyForecast);
  $('restart').addEventListener('click', restart);
  $('undo').addEventListener('click', undo);
  $('play-again').addEventListener('click', () => {
    restart();
    document.querySelector('.network-card').scrollIntoView({ block: 'start', behavior: reducedMotion ? 'instant' : 'smooth' });
    $('network').querySelector('[data-node="0"]').focus({ preventScroll: true });
  });
  $('review-round').addEventListener('click', () => $('round-over-dialog').close());
  const dialog = $('learn-dialog');
  document.querySelectorAll('.learn-trigger').forEach(button => button.addEventListener('click', () => dialog.showModal()));
  $('close-learn').addEventListener('click', () => dialog.close());
  $('back-to-game').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  resetModel();
  if (continuous()) setMessage('Choose a treatment, or Watch +10 to see how intensities evolve. The clock pauses between moves.');
  render();
})();
