# Break the Loop

**[Play the game](https://dennyborsboom.github.io/break-the-loop/)** · **[Start with symptom dynamics](https://dennyborsboom.github.io/break-the-loop/#dynamics)**

A strategy game about Denny Borsboom’s network theory of mental disorders. Start with nine highly active depression symptoms and six treatment coins. Get all nine nodes green together using as few coins as possible.

Choose between **Ising**, with symptoms that switch on or off, and **Symptom dynamics**, a continuous-time model based on Park, Waldorp & Vasconcelos (2026). Switching models starts a fresh round. The game runs entirely in your browser, without an account, installation or API key.

## How to play

Choose an intervention, then select a node, loop or connection in the network.

| Intervention | Symptom dynamics | Ising |
| --- | --- | --- |
| Node | **1 coin:** reduce intensity by 25 percentage points, stopping at 10% (90% → 65%, 30% → 10%). | **1 coin:** switch the node off once. |
| Self-feedback | **1 coin:** lower one self coefficient from 0.30 to 0.10 for the round. | Not available. |
| Field | **1 coin:** lower baseline activation drive β by 0.25 for the round. Repeat doses are allowed. | **2 coins:** lower activation field τ by 1.5 for the round. |
| Edge | **1 coin:** remove one directed influence for the round. A reverse arrow is a separate connection. | **3 coins:** remove one symmetric connection for the round. |

Node interventions change the current state once; they do not clamp a symptom or alter its parameters. A reduced symptom can rise again. Field, self-feedback and edge interventions change how the network evolves. The interface shows the move before the response, including the before-and-after percentages for a symptom reduction.

**Forecasts cost 1 coin.** A purchased tip compares the selected intervention with no intervention, without advancing the network or consuming the round’s random sequence. The methods differ between models, as described below. A purchased forecast can be reopened free until treatment or passage of time changes the network.

**Undo costs 1 additional coin.** It restores the last active action, including the network, paid tips, random sequence and continuous-model clock. Earlier spending stays spent. Undone actions and undo fees remain in the history. Undo is unavailable at zero coins.

Restart resets the budget and reuses the same random sequence so that strategies can be compared. When the coins run out without a win, an automatic **Play again?** prompt opens after the response. A last-coin win earns the trophy instead. Reduced-motion preferences preserve the simulated path while simplifying animation.

## Symptom dynamics

This mode implements Equation 2 of Park, Waldorp & Vasconcelos (2026), with `f(s) = s²`:

```text
ds_i = s_i(1-s_i) [beta_i + alpha_ii*s_i
       + (1 + delta_i*s_i²) sum_(j != i) alpha_ji*s_j] dt + sigma_i dW_i
```

The 21 directed between-symptom influences follow Appendix A4: rows are sources and columns are targets. Nine visible self-loops start at `alpha_ii = 0.30`; dashed loops show the lowered `0.10` setting. The baseline boost is `delta_i = 9.50` (Table 3), and baseline β values use the normal-period values in Table 2. Lowering a self-loop changes only that coefficient, not the paper’s entire high-resilience scenario. The equations and matrix are independently implemented; the authors’ R source is not copied.

The game uses reflected Euler–Maruyama integration with `dt = 0.02`, independent additive Gaussian noise of strength `sigma = 0.10`, and initial intensities of `0.92`. These numerical and game settings are illustrative rather than a reproduction of the paper’s shock experiment or a fit to a particular person.

Treatments are followed by up to **20 model-time units** of animated response. The clock pauses between moves. **Watch +10** advances ten units without treatment or a coin charge; **Pause/Resume** freezes and continues the response. Units are dimensionless model time, not days. Node colours, percentages and the intensity trace show the evolving state.

Green means intensity **≤ 10%**. The game checks all nine at every integration step and stops at the first all-green state, awarding the Loop Breaker trophy. The 10% band is a game choice, not a clinical recovery criterion. The numerical process does not snap intensities to green or impose decay.

A paid forecast estimates the chance of all nine intensities being green **at 40 model-time units**, using **256 simulated paths per scenario**. It also reports expected average intensity. This is an approximate fixed-horizon estimate, not a chance of winning at any earlier checkpoint. Zero successes in a finite sample does not prove impossibility. Paired forecast seeds reduce comparison noise; forecast RNGs are separate from the player’s RNG.

## Ising

The nine nodes are binary, with illustrative positive symmetric weights. Each treatment receives up to two response sweeps; a sweep consists of nine random single-node updates with replacement. Green means off, checked immediately after treatment and after each sweep.

```text
P(X_i = 1 | other nodes) = sigmoid(tau_i + sum_j w_ij*x_j)
P(x) ∝ exp(sum_i tau_i*x_i + sum_(i<j) w_ij*x_i*x_j)
```

The parameters are defined directly in 0/1 coding. Random-scan Gibbs updates preserve the joint Ising law. The game illustrates Cramer et al.’s dynamic framework rather than reproducing their original 14-node, synchronous-update model.

Ising forecasts propagate probability across all **512 states for 54 node updates**, giving the exact all-off probability after six sweeps, subject to floating-point precision. This includes the transient effect of a one-time node switch without changing its equilibrium law.

## Run locally or edit

Open `index.html` directly in Chrome or Opera, or serve this directory with `python3 -m http.server 8080`. The complete page contains all scripts, styles and the icon, and works offline after loading. It does not collect player data, contact remote APIs or store progress.

Authoring files:

- `source/index.template.html`: interface, rules and learning guide.
- `style.css`: appearance and animation.
- `model.js`: Ising parameters, dynamics and exact forecasts.
- `dynamics.js`: continuous-time parameters, dynamics and sampled forecasts.
- `game.js`: controls, prices, clock, history, feedback and winning rules.

Rebuild the complete page and check both models:

```sh
python3 scripts/build.py
node tests/model-checks.cjs
node tests/dynamics-model-checks.cjs
```

Commit the rebuilt `index.html` with its source changes. GitHub Pages publishes the root of `main`; `.nojekyll` keeps it a plain static site. `capsule.json` contains Galvoro-compatible learning metadata. Research PDFs are not distributed with the game.

## References

- Park, Waldorp & Vasconcelos (2026). *A Mechanistic Model of Symptom Dynamics: Implications for Statistical Network Analyses.* Multivariate Behavioral Research. [doi:10.1080/00273171.2026.2710730](https://doi.org/10.1080/00273171.2026.2710730).
- Borsboom (2017). *A network theory of mental disorders.* World Psychiatry, 16, 5–13. [doi:10.1002/wps.20375](https://doi.org/10.1002/wps.20375).
- Cramer et al. (2016). *Major Depression as a Complex Dynamic System.* PLOS ONE, 11, e0167490. [doi:10.1371/journal.pone.0167490](https://doi.org/10.1371/journal.pone.0167490).
- Epskamp, Maris, Waldorp & Borsboom. *Network Psychometrics.* [arXiv:1609.02818v2](https://arxiv.org/abs/1609.02818).
- Lunansky et al. *Intervening on psychopathology networks: Evaluating intervention targets through simulations.* Methods. The NodeIdentifyR (NIRA) approach motivates the Ising field intervention.

## Author and license

Denny Borsboom, University of Amsterdam. Licensed under [CC BY 4.0](LICENSE).
