# Break the Loop

**[Play the game](https://dennyborsboom.github.io/break-the-loop/)**

A small strategy game about Denny Borsboom's network theory of mental disorders. Start with nine active depression symptoms and six treatment coins. Try to get the entire network green using as few coins as possible.

The game runs in a browser. No account, installation, or API key is needed.

## How to play

Choose an intervention and click its target in the network:

- **Switch off a node (1 coin):** make a symptom inactive once. Its neighbours can reactivate it.
- **Remove an edge (2 coins):** remove one symmetric connection for the round.
- **Shift a field (2 coins):** lower a node's activation parameter by 1.5 for the round. This reduces its tendency to become active; it does not force its current state.

The six-coin budget counts coins spent, rather than the number of actions. A treatment must be affordable at its full price. The move is shown first, then the network responds for up to two sweeps. A sweep consists of nine random node-update opportunities. When all nine nodes are green together, the round ends with a Loop Breaker trophy and confetti.

An optional **forecast costs one additional coin**. It compares the exact chance of all nine nodes being green after six sweeps, with and without the selected intervention. Buying it does not apply treatment or advance time. It is a fixed-horizon prediction, rather than the probability of winning at any earlier checkpoint.

Undo refunds the full price of the last action. Restart uses the same random sequence so that strategies can be compared. Motion effects respect the browser's reduced-motion preference.

## About the model

The nine nodes represent the nine depression symptom criteria. Their positive, symmetric interaction weights and activation parameters are illustrative. This is not fitted patient data or a reproduction of the original 14-node Cramer et al. network. The all-green goal is a game rule rather than a clinical definition of recovery.

The model uses binary states `x_i ∈ {0, 1}` and random-scan, single-site Gibbs updates:

```text
P(X_i = 1 | other nodes) = sigmoid(tau_i + sum_j w_ij * x_j)

P(x) ∝ exp(sum_i tau_i * x_i + sum_(i<j) w_ij * x_i * x_j)
```

With nine binary nodes, there are 512 configurations. Forecasts propagate probability across all 512 states for 54 node updates, then read the all-inactive state's probability. The calculation therefore includes the short-term effect of a one-time node switch without changing its equilibrium parameters.

The simulation is inspired by Cramer et al.'s dynamic framework, using asynchronous updates consistent with the joint Ising law. Their original synchronous update rule is not reproduced here. The in-game guide explains the intervention types, model, and learning goals in more detail.

## Run locally or edit

Open `index.html` directly in Chrome or Opera. It includes all styles, scripts, and the icon, so it also works without a network connection. Alternatively, run:

```sh
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

Edit these authoring files:

- `source/index.template.html`: interface and learning guide.
- `style.css`: appearance and animation.
- `model.js`: network parameters, stochastic dynamics, and exact forecasts.
- `game.js`: interaction, treatment coins, history, and winning rules.

Rebuild the self-contained page and run the mathematical checks:

```sh
python3 scripts/build.py
node tests/model-checks.cjs
```

Commit the rebuilt `index.html` with the source changes. GitHub Pages publishes the root of the `main` branch. The `.nojekyll` file keeps publication as a plain static site.

`capsule.json` contains Galvoro-compatible learning metadata. The game does not collect player data, contact remote APIs, or store progress.

## References

- Borsboom (2017). *A network theory of mental disorders.* World Psychiatry, 16, 5–13. [doi:10.1002/wps.20375](https://doi.org/10.1002/wps.20375).
- Cramer et al. (2016). *Major Depression as a Complex Dynamic System.* PLOS ONE, 11, e0167490. [doi:10.1371/journal.pone.0167490](https://doi.org/10.1371/journal.pone.0167490).
- Epskamp, Maris, Waldorp & Borsboom. *Network Psychometrics.* [arXiv:1609.02818v2](https://arxiv.org/abs/1609.02818).
- Lunansky et al. *Intervening on psychopathology networks: Evaluating intervention targets through simulations.* Methods. The NodeIdentifyR (NIRA) approach motivates the field interventions.

## Author and license

Denny Borsboom, University of Amsterdam. Licensed under [CC BY 4.0](LICENSE).
