(function () {
  'use strict';
  const M = window.LoopModel;
  const $ = id => document.getElementById(id);
  const svgNS = 'http://www.w3.org/2000/svg';
  const budget = 6;
  const seed = 271828;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, reducedMotion ? 450 : milliseconds));
  const percent = p => `${Math.round(p * 100)}%`;
  const initialMessages = {
    node: 'Click an active symptom. Switching it off gives the system a push, but does not change its connections.',
    edge: 'Click a connection between two symptoms. Removing it breaks this direct influence in both directions for the rest of the round.',
    field: 'Click any symptom. Lowering its activation parameter makes it less likely to turn on for the rest of the round.'
  };

  let model, state, random, history, purchased, treatmentVersion;
  let type = 'node';
  let target = null;
  let phase = 'playing';
  let turnAnimation = null;
  let celebrationPlayed = false;
  let celebrationTimer = null;

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
    if (actionType === 'edge') {
      const e = model.edges[actionTarget];
      return `${M.symptoms[e.a].short} ↔ ${M.symptoms[e.b].short}`;
    }
    return M.symptoms[actionTarget].short;
  }
  function cacheKey() { return `${treatmentVersion}:${type}:${target}`; }
  function validTarget() {
    if (target === null) return false;
    if (type === 'node') return M.isOn(state, target);
    if (type === 'edge') return !model.edges[target].removed;
    return true;
  }
  function isWon() { return state === 0; }

  function drawNetwork(previousState = state, interventionTarget = null) {
    const svg = $('network');
    svg.replaceChildren();
    svg.dataset.state = state;
    svg.classList.toggle('edge-mode', type === 'edge');
    const edgesGroup = svgElement('g', { 'aria-label': 'Symptom connections' });
    model.edges.forEach((edge, index) => {
      const a = M.symptoms[edge.a], b = M.symptoms[edge.b];
      const coords = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
      const active = M.isOn(state, edge.a) && M.isOn(state, edge.b);
      const line = svgElement('line', { ...coords,
        class: `edge-visible${active ? ' edge-active' : ''}${edge.removed ? ' edge-removed' : ''}${type === 'edge' && target === index ? ' edge-selected' : ''}`,
        'stroke-width': 1.6 + edge.weight * 1.2 });
      edgesGroup.append(line);
      if (turnAnimation?.stage === 'applied' && turnAnimation.type === 'edge' && turnAnimation.target === index) {
        const removal = svgElement('line', { ...coords, class: 'edge-removal', 'stroke-width': 5 });
        edgesGroup.append(removal);
        const cut = svgElement('g', { transform: `translate(${(a.x + b.x) / 2},${(a.y + b.y) / 2})`, class: 'edge-cut', 'aria-hidden': 'true' });
        cut.append(svgElement('circle', { r: 18 }));
        const symbol = svgElement('text', { x: 0, y: 1 });
        symbol.textContent = '×';
        cut.append(symbol);
        edgesGroup.append(cut);
      }
      if (!edge.removed && type === 'edge') {
        const hit = svgElement('line', { ...coords, class: 'edge-hit', tabindex: '0', role: 'button',
          'aria-label': `Remove connection: ${a.short} and ${b.short}`, 'aria-pressed': target === index,
          'data-edge': index });
        activateWithKeyboard(hit, () => selectTarget(index));
        hit.addEventListener('pointerenter', () => line.classList.add('edge-hover'));
        hit.addEventListener('pointerleave', () => line.classList.remove('edge-hover'));
        edgesGroup.append(hit);
      }
    });
    svg.append(edgesGroup);
    const nodesGroup = svgElement('g', { 'aria-label': 'Nine depression symptoms' });
    M.symptoms.forEach((symptom, index) => {
      const on = M.isOn(state, index);
      const changed = on !== M.isOn(previousState, index);
      const affected = turnAnimation && turnAnimation.type !== 'edge' && turnAnimation.target === index;
      const applied = affected && turnAnimation.stage === 'applied';
      const reactivated = affected && turnAnimation.type === 'node' && !applied && on;
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
        text.textContent = applied ? (turnAnimation.type === 'node' ? '✓ SWITCHED OFF' : '↓ FIELD LOWERED') : reactivated ? '↻ REACTIVATED' : 'STILL INACTIVE';
        callout.append(text);
        node.append(callout);
      }
      activateWithKeyboard(node, () => { if (type !== 'edge') selectTarget(index); });
      nodesGroup.append(node);
    });
    svg.append(nodesGroup);
  }

  function renderStats() {
    const spent = history.length + (phase === 'busy' ? 1 : 0);
    const remaining = budget - spent;
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
    document.querySelector('[role="progressbar"]').setAttribute('aria-valuenow', String(green));
    $('move-count').textContent = `${spent} ${spent === 1 ? 'coin' : 'coins'} spent`;
    $('network-badge').textContent = phase === 'busy' ? (turnAnimation?.stage === 'applied' ? 'MOVE APPLIED' : `RESPONSE · ${turnAnimation?.sweep || 1} / 2`) : phase === 'won' ? 'LOOP BROKEN' : phase === 'exhausted' ? 'ROUND COMPLETE' : 'YOUR MOVE';
    document.body.classList.toggle('busy', phase === 'busy');
    $('restart').disabled = phase === 'busy';
    $('undo').disabled = !history.length || phase === 'busy';
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
    area.append(comparison, element('p', '', 'Chance of all nine nodes being green after six sweeps. A probability, not a promise. Treatment still costs its own coin.'));
  }

  function renderSelection() {
    document.querySelectorAll('[data-type]').forEach(button => {
      const selected = button.dataset.type === type;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.disabled = phase === 'busy' || phase === 'won';
    });
    const hasTarget = target !== null;
    $('target-kicker').textContent = hasTarget ? (type === 'edge' ? 'SELECTED CONNECTION' : 'SELECTED SYMPTOM') : (type === 'edge' ? 'SELECT A CONNECTION' : 'SELECT A SYMPTOM');
    $('target-name').textContent = hasTarget ? targetName(type, target) : 'Where will you intervene?';
    let description = initialMessages[type];
    let detail = '';
    if (hasTarget) {
      if (type === 'node') {
        description = M.isOn(state, target) ? 'Switch this symptom off once. It will be free to reactivate when the network evolves.' : 'This symptom is already inactive. Choose an active symptom to switch off, or try a field intervention.';
        detail = 'One-time state change · 1 coin';
      } else if (type === 'edge') {
        description = 'Remove this connection in both directions. The two symptoms can still influence each other through other paths.';
        detail = 'Lasts for this round · 1 coin';
      } else {
        description = 'Lower this symptom’s activation parameter. Its tendency to switch on decreases, but its current state is not forced to change.';
        detail = `Lasts for this round · ${model.fieldDoses[target]} previous ${model.fieldDoses[target] === 1 ? 'shift' : 'shifts'} · 1 coin`;
      }
    }
    if (phase === 'busy' && turnAnimation) {
      $('target-kicker').textContent = turnAnimation.stage === 'applied' ? 'YOUR MOVE HAS BEEN APPLIED' : 'NOW THE NETWORK RESPONDS';
      if (turnAnimation.stage === 'applied') {
        description = type === 'node' ? 'This symptom is now off. Your move registered. Next, its neighbours will have a chance to reactivate it.' : type === 'edge' ? 'This connection has been removed. Next, watch how the network responds without this direct influence.' : 'The activation field has been lowered. The symptom is less likely to switch on; its current state is not forced to change.';
      } else description = type === 'node' && M.isOn(state, target) ? 'The symptom has reactivated after your move. It was successfully switched off; the network then turned it back on.' : `The intervention was applied. You are now watching the network’s response: sweep ${turnAnimation.sweep} of 2.`;
      detail = '1 coin spent · Treatment applied';
    }
    if (phase === 'won') {
      $('target-kicker').textContent = 'ROUND COMPLETE';
      $('target-name').textContent = 'All nine nodes are green';
      description = 'You earned the Loop Breaker award. The network has stopped. Replay to try a cheaper path, or undo to revisit your final move.';
      detail = `${history.length} ${history.length === 1 ? 'coin' : 'coins'} spent · ${budget - history.length} saved`;
    }
    $('target-description').textContent = description;
    $('target-detail').textContent = detail;
    $('target-detail').hidden = !detail;
    const enabled = validTarget() && phase === 'playing' && history.length < budget;
    $('apply').disabled = !enabled;
    $('apply-label').textContent = phase === 'busy' ? (turnAnimation?.stage === 'applied' ? '✓ Move applied' : 'Network responding…') : phase === 'won' ? 'Loop broken' : phase === 'exhausted' ? 'No coins left' : !validTarget() ? 'Select a target' : type === 'node' ? 'Switch symptom off' : type === 'edge' ? 'Remove connection' : 'Shift this field';
    const cached = purchased.has(cacheKey());
    $('buy-forecast').disabled = !enabled || cached;
    $('buy-forecast').firstElementChild.lastChild.textContent = cached ? ' Forecast purchased' : ' Buy a forecast';
    $('forecast-note').textContent = phase === 'won' ? 'Your network is all green. The round is complete.' : cached ? 'Paid once. You can review this tip until the next treatment.' : history.length === budget - 1 ? 'This uses your last coin, leaving none for treatment.' : 'Optional: spend a coin to preview your selected move.';
    renderForecast();
  }

  function renderHistory() {
    const list = $('history');
    list.replaceChildren();
    if (!history.length) {
      const empty = element('div', 'history-empty');
      empty.append(element('span', 'history-empty-line'), document.createTextNode('Your first intervention starts the story.'));
      list.append(empty);
      return;
    }
    history.forEach((entry, index) => {
      const row = element('div', 'history-row');
      row.append(element('span', 'history-number', String(index + 1)));
      const description = element('div', 'history-description');
      const actionLabel = entry.kind === 'forecast' ? 'Forecast purchased' : entry.type === 'node' ? 'Switched off' : entry.type === 'edge' ? 'Connection removed' : 'Field shifted';
      description.append(element('strong', '', `${actionLabel} · ${targetName(entry.type, entry.target)}`));
      if (entry.kind === 'forecast') {
        description.append(element('small', '', 'A paid tip. The network did not advance.'));
        row.append(description, element('span', 'history-forecast', `${percent(entry.forecast.projected)} predicted`));
      } else {
        const reactivated = entry.type === 'node' && M.isOn(entry.finalState, entry.target);
        description.append(element('small', '', `${entry.sweepCounts.length ? `Sweep checks: ${entry.sweepCounts.join(' → ')} active` : 'All green immediately after the intervention'}${reactivated ? ' · Target reactivated' : ''}`));
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
    if (result.hidden) return;
    if (phase === 'won') {
      const tips = history.filter(entry => entry.kind === 'forecast').length;
      result.append(element('h3', '', 'You broke the loop.'), element('p', '', `All nine nodes are green. You spent ${history.length} of ${budget} coins, including ${tips} ${tips === 1 ? 'forecast' : 'forecasts'}. Your Loop Breaker award is yours!`));
    } else result.append(element('h3', '', 'A new strategy?'), element('p', '', 'Your coins are spent and the recovery goal is not yet met. Undo a move or restart to try a different path.'));
    const again = element('button', 'text-button', 'Replay this network ↗');
    again.type = 'button';
    again.addEventListener('click', restart);
    result.append(again);
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
    $('award-score').textContent = `${history.length} ${history.length === 1 ? 'coin' : 'coins'} spent · ${budget - history.length} saved`;
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
    drawNetwork(previousState, interventionTarget);
    renderStats(); renderSelection(); renderHistory(); renderResult(); renderCelebration();
  }

  function selectTarget(index) {
    if (phase === 'busy') return;
    target = index;
    drawNetwork(); renderSelection();
  }

  async function applyTreatment() {
    if (phase !== 'playing' || !validTarget() || history.length >= budget) return;
    const entry = { kind: 'treatment', type, target, beforeState: state, sweepCounts: [] };
    const label = targetName(type, target);
    phase = 'busy';
    const previousState = state;
    state = M.intervene(model, state, type, target);
    purchased.clear();
    treatmentVersion++;
    turnAnimation = { type, target, stage: 'applied' };
    setMessage(type === 'node' ? 'The symptom is off. The network is paused briefly so you can see the effect of your move.' : type === 'edge' ? 'This direct connection is now removed. The network will respond next.' : 'Its activation field is now lower. The network will respond next.', type === 'node' ? `✓ ${label} switched off · 1 coin spent` : type === 'edge' ? '✓ Connection removed · 1 coin spent' : `✓ ${label}: field lowered · 1 coin spent`);
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
    phase = isWon() ? 'won' : history.length >= budget ? 'exhausted' : 'playing';
    const reactivated = entry.type === 'node' && M.isOn(state, entry.target);
    setMessage(phase === 'won' ? 'All nine nodes are green together. You earned the Loop Breaker award!' : `${entry.sweepCounts.join(' → ')} active symptoms across the two sweep checks.${reactivated ? ' The switch-off registered; the feedback loop then turned the symptom back on.' : ' Choose your next move.'}`, phase === 'won' ? 'You broke the loop.' : reactivated ? `Move applied → ${label} reactivated` : 'Move applied · network response complete');
    render();
  }

  function buyForecast() {
    if (phase !== 'playing' || !validTarget() || history.length >= budget || purchased.has(cacheKey())) return;
    const baseline = M.forecast(model, state).healthyProbability;
    const alteredModel = { edges: model.edges.map(e => ({ ...e })), thresholds: [...model.thresholds], fieldDoses: [...model.fieldDoses] };
    const alteredState = M.intervene(alteredModel, state, type, target);
    const projected = M.forecast(alteredModel, alteredState).healthyProbability;
    const forecast = { baseline, projected };
    purchased.set(cacheKey(), forecast);
    history.push({ kind: 'forecast', type, target, forecast });
    if (history.length >= budget) phase = 'exhausted';
    setMessage(`Forecast purchased for one coin. ${targetName(type, target)}: ${percent(projected)} chance of all nine nodes being green after six sweeps if you apply this intervention. The network has not advanced.`);
    renderStats(); renderSelection(); renderHistory(); renderResult();
  }

  function resetModel() {
    model = M.createModel(); state = M.SIZE - 1; random = M.randomGenerator(seed);
    history = []; purchased = new Map(); treatmentVersion = 0; phase = 'playing'; turnAnimation = null;
  }

  function restart() {
    if (phase === 'busy') return;
    resetModel(); target = null; type = 'node';
    setMessage('A fresh start, with the same network and random sequence. Choose your first intervention.');
    render();
  }

  function undo() {
    if (phase === 'busy' || !history.length) return;
    const retained = history.slice(0, -1);
    resetModel();
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
    setMessage('Last action undone and its coin refunded. The network and random sequence are restored.');
    render();
  }

  document.querySelectorAll('[data-type]').forEach(button => button.addEventListener('click', () => {
    if (phase === 'busy') return;
    type = button.dataset.type; target = null;
    drawNetwork(); renderSelection();
  }));
  $('apply').addEventListener('click', applyTreatment);
  $('buy-forecast').addEventListener('click', buyForecast);
  $('restart').addEventListener('click', restart);
  $('undo').addEventListener('click', undo);
  const dialog = $('learn-dialog');
  document.querySelectorAll('.learn-trigger').forEach(button => button.addEventListener('click', () => dialog.showModal()));
  $('close-learn').addEventListener('click', () => dialog.close());
  $('back-to-game').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  resetModel(); render();
})();
