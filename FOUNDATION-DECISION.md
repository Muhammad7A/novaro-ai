# Novaro AI V3 — Foundation Decision Record

**Status:** DECIDED — no implementation authorized by this document. **Date:** 2026-09-08. **Evidence base:** baseline `v3-baseline` @ `5d60203` (test floor 446/0), `ARCHAEOLOGY.md`, `BASELINE.md`, 5 domain-fit investigations + 1 adversarial premise review + 5 adversarial proposal/meta reviews (10 agent reports total).

---

## 0. Process record (transparency)

- **Correlated-evidence disclosure:** all investigators read the same repo through one synthesis document (`ARCHAEOLOGY.md`), so their conclusions share a lens. A meta-review was therefore run against the process itself. It caught: (a) a subagent had quietly written an untracked draft decision document (`ARCHITECTURE_DECISION.md`) mid-review, which later reviewers then read — a contamination; (b) that draft contained a factual error (storage described as having "no locking across processes" — **false**: `kunci.js` provides a same-machine cross-process lock used at `store.js:259`; what is missing is cross-*machine* locking, and single-writer is enforced by deployment); (c) two inherited count errors (test files: **36**, not 37; ARCHAEOLOGY erratum noted here). The stray draft was folded into this record **with those corrections applied**, then deleted. Its useful content is credited where used.
- **Labeling:** FACT (code-verified, cited) / ASSUMPTION (basis given) / INFERENCE (reasoned). Where a claim is a **strategic bet** rather than evidence, it is labeled as such.

## 1. Verified ground facts that drive the decision

1. **FACT — live accounting defect today:** scan-nota maps "modal masuk" → `lain-masuk` (`nota.js:48`), which carries `laba:true` (`cashbook.js:33`); owner capital injections are counted as **profit**, inflating `labaBersih`, `maxCicilanSehat`, and potentially the printed KUR report. The curriculum teaches the opposite (`latihan.js:117-120`). A one-line mitigation exists in the file's own design: unmapped keywords already return `null` → user chooses (`nota.js:26-30`).
2. **FACT — the prive/laba identity is structural:** prive & cicilan carry `laba:false`; profit and cash are independent numbers; prive is load-bearing **pedagogy** (Modul 2/6, server-verified praktik), a **printed KUR column**, an AI-coaching surface, and a fokus-harian rule — and the health score awards 20 points for business/personal separation (`metrics.js:85-91`).
3. **FACT — the personal↔business transfer is the one requirement that cannot share today's row:** single-sided, single-scope, category-fixed `laba`; ground fact 1 proves the boundary is unrepresentable today.
4. **FACT — substrate limits:** single-writer whole-file JSON store (571 ms parse @300 users); no background-execution substrate (deliberate CPU throttling, scale-to-zero, 8 s shutdown); no cross-user read path except the DEMO-whitelisted papan; transactions carry **no provenance field**; the `version:1` envelope is inert (no schema-versioning machinery); the research dataset lives on the deployed host, not in the repo (~20 participants per PRD), and has already survived one storage migration (Mongo→JSON).
5. **FACT — consent is policy, not physics:** `CONSENT_VERSION` is one constant; ~9 test files import it dynamically; the 451 re-prompt mechanism was designed for renegotiation. A v3 bump is mechanically near-zero and **arguably overdue** (consent text names Claude; production runs Gemini — `consent.js:43` vs `frontend/.env`).
6. **FACT — evaluation-stage reality:** one builder (+ agents); 4,406-line SPA with zero frontend tests; no payment infrastructure; contest/research-stage product ("post-contest" deferrals appear in the PRD).
7. **STRATEGIC BET (not evidence):** "the bank-facing KUR trust chain is Novaro's primary monetizable asset." No billing exists; this is the premise the foundation choice partly rests on. If the funder horizon or product thesis changes, the choice below has a defined revisit path (§8).

## 2. Deliverable 1 — Architecture comparison matrix

Layer definitions used: **A Financial Intelligence** (read-side analytics/benchmarks/anomalies), **B Financial Autopilot** (rules, recurring, nudges, gated agentic action), **C Financial Digital Twin** (what-if, forecast, counterfactual replay), **D Consumer/Hybrid Finance** (personal/household ledgers, personal↔business flows).

| Criterion | **A. Unified core** (one ledger, scope-tagged rows, prive→transfer, allocations) | **B+. Business-first + extensions** (business core canonical; additive entities; prive-enrichment now; opt-in personal satellite later) | **C. Consumer-first** (person/account pool canonical; business as reporting overlay) | **D. Modular bounded contexts** (per-context stores + events) |
|---|---|---|---|---|
| Canonical entities | Party, Book(usaha\|pribadi), Transaction+scope+provenance, Transfer, Rule, Scenario, Budget, Goal, Insight | Unchanged business core; additive: insights, scenarios, rules(+runs/gates), prive budget, goals; optional `personal[]` satellite; boundary-event register | Person, Account, Transaction+allocation, Budget, Goal, Household; BusinessWorkspace overlay | Per-context ownership (Ledger/Intelligence/Autopilot/Twin/Consumer), events as contracts |
| Transaction repr. | Existing row + scope + origin/transferId; prive re-encoded as transfer leg | **Unchanged for business rows**; additive fields only (origin, ruleId, transferId) | Open categories + tags; profit treatment computed by overlay at read time | Five shapes of the same money; event-carried state transfer |
| User / entity | One code → party → N books | One code → one person → one business (unchanged); satellite opt-in | Person 1—N accounts/household; business attaches as workspace | Identity context issues codes; contexts reference ids |
| Business ownership | Business scope only feeds laba/gate/KUR; every aggregator becomes scope-aware | **Business ledger IS the canonical book** — semantics untouched | Overlay configuration — derived, editable | Ledger context owns; Reporting consumes projections |
| Personal ownership | First-class second book | prive-enrichment first; satellite opt-in behind gates | Total — person owns everything | Separate Personal context/store |
| Shared transactions | Atomic linked-pair transfers in one mutator | prive-as-boundary now; linked-leg convention at satellite time (atomic: same store) | Native transfer/allocation primitives | **No cross-store atomicity exists** (validasi-store precedent) — structurally cannot host the transfer requirement |
| AI boundaries | Unchanged propose-only + per-scope labeled views; consent v3 | **Exactly today's boundaries**; propose+confirm for Autopilot T1; new dispatcher methods + PERKIRAAN classes | Consumer advisor persona; overlay makes classification advice | Per-context under global dispatcher; metering must stay aggregated or budgets break |
| Simulation compatibility | Twin over any book/consolidated view; params-not-results | Twin over business ledger; params-not-results; simulasi-kur generalization | Household+business twin over the pool | Twin as subscribing context (needs event substrate that doesn't exist) |
| Hosting the 4 layers | A/C yes; B-T2 needs substrate; **D-full breaks prive pedagogy + KUR + consent + tests** | A/C/B-T1 additive; B-T2 declared core change (deferred, gated); D via prive-enrichment + gated satellite | All four "natively" — by redefining the product | All four — after a storage/infra rebuild that doesn't exist |
| Migration risk from V2 | Medium-high (re-signature of most-tested functions; ~100–200 test edits; consent v3 mid-pilot; prive history trilemma) | **Low** (additive M0–M7, each shippable, floor never drops; riders add hours) | **High** (11–21 builder-weeks freeze; store+SPA inversion; ~50% test rewrite; second auth path) | **Highest** (Postgres move + event substrate + test-harness rewrite of 8,115 ln are prerequisites) |
| Scalability | Same ceiling, reached sooner (personal volume fattens users.json) | Same ceiling (deferred, not solved — monitored, §8 triggers) | Same ceiling, hit sooner (consumer volume) | Only shape that survives multi-instance — but requires the store replacement anyway |
| Consumer-vs-business conflict | Resolved by scope — at the price of prive ambiguity + pedagogy damage | **Avoided** — prive stays the boundary; satellite is consented and opt-in | Inverted (pool canonical) — fights score, curriculum, consent | Clean by separation — but contexts are pre-discovery; contract churn is maximal |
| Accounting correctness | prive redefinition trilemma (dual representation / fabricated personal history / report discontinuity) | **Invariants intact**; modal defect fixed at the boundary | Config-driven laba = two identical ledgers print different statements; reliability gate becomes rule-dependent | Cross-store races make boundary writes lossy (kunci.js documented loss shape) |
| AI reliability fit | Fits (guardrails) | **Fits** (guardrails; T1 only) | Fits-with-consent-v3 | Fits per-context; budget aggregation is a new silent-zero surface |
| Monetization optionality | Broad but speculative (consumer option bought now, unproven) | **Program/B2B2C now, banks/cohort-data later, consumer reachable via reserved seams** | Consumer TAM with **no channel** (no self-serve signup exists) | Enterprise-shape optionality for an organization that doesn't exist |
| Verdict | **Rejected for now** — salvage adopted | **RECOMMENDED** | **Rejected** | **Rejected now; D-lite hygiene adopted; D-full gated (§8)** |

**Weighting note (per meta-review):** the matrix is unweighted by design; "migration risk" is one row among many, and §8 makes the revisit triggers explicit so this choice is falsifiable rather than anchored on cheapness-from-V2.

## 3. Deliverable 2 — Recommended architecture

**Proposal B+ — Business-first core with consumer extensions, with non-deferrable riders (§6) and falsifiable revisit triggers (§8).**

The business cashbook remains the canonical, invariant-bearing core. The four layers land as:

- **A Financial Intelligence: SHIP.** Deterministic detection (more fokus-harian-style rules over `isMonthComplete` months), AI narration only; absolute-threshold insight now; benchmarking deferred until a real, consented cohort exists (§8.3).
- **C Financial Digital Twin: SHIP LITE.** Deterministic scenario engine generalizing `simulasi-kur.js`/`putar-ulang.js` (dual-use, pure, single-sourced); store scenario **parameters**, never results; every output watermarked (the `setara`/`perkiraan` labeling discipline); no forecasts rendered as facts; counterfactual replay is a pure projection over an in-memory modified copy. AI narrates (checkup shape: zero numeric fields from the model). **C-full (persisted forecasting) is rejected** — it reopens the exact hole the `setaraLabaBersih` removal closed.
- **B Financial Autopilot: SHIP T1 ONLY.** Propose→confirm→undo→audit (generalized scan-nota: `{proposal, confidence, provenance}`, code-side enum mapping, one human tap per write batch). Requires the provenance rider first (§6.3). **Machines never write income.** T2 (scheduled/unattended) is not "deferred" — it is architecturally absent (no scheduler substrate); it is a **declared core change** gated on §8.4.
- **D Consumer/Hybrid: prive-enrichment now; satellite gated.** Prive budgeting/salary guidance (noting much already exists — fokus rule "prive > laba", Kurikulum gaji-tetap module). The `personal[]` satellite ledger ships only behind: schema-version machinery live, consent v3, provenance fields, and the §8.2 adoption trigger. prive/modal are recorded **now** as boundary *events, not income* — the semantic decision is made in this document; the code can follow incrementally.

## 4. Deliverables 3+4 — Rejected alternatives and reasons

| Rejected | Reasons (evidence-based) | Becomes right when… |
|---|---|---|
| **A-full (unified scoped ledger)** | (1) prive redefinition trilemma: keep legacy prive rows → dual representation forever; rewrite them → fabricate personal history inside an append-only research dataset; reflag → bank-report discontinuity for exactly the months banks review. (2) prive is pedagogy + printed KUR column + AI-coached concept — re-teaching it destabilizes the two trust assets simultaneously for a low-literacy audience being *taught* prive as the answer. (3) Blast radius: ~14 lib/server files + the untested SPA; 9 `getTransactions` route sites; 18 aggregation call sites; ~100–200 test edits; consent v3 re-roll mid-pilot. (4) Personal-volume growth accelerates the store ceiling. (5) No current user evidence for a personal book (goal taxonomy has zero personal-finance goals; the instrument never asked). | Personal-book demand is demonstrated (§8.2 trigger fires); or the Postgres move happens anyway; or the product pivots consumer with funding; or a new intake cohort coincides with consent v3 (no mid-series re-roll). |
| **C (consumer-first)** | (1) Overlay inversion makes the only trust-bearing, bank-facing artifact depend on user-editable semantics — two identical ledgers print different statements; no config-audit machinery specified; the reliability gate becomes ruleset-dependent. (2) Destroys or strains the actual differentiation: prive pedagogy (≥16 curriculum passages), KUR trust posture, research consent instrument (household third parties never contemplated), access-code distribution (no self-serve exists). (3) 11–21 builder-weeks of freeze on a one-builder project with a zero-test SPA. (4) Consumer channel does not exist; monetization evidence points program/banks. | Measured adoption/demand evidence (users persistently record personal spend in the business book AND satellite abandonment is high), a self-serve consumer funnel materializes, or a consumer-side funder appears (§8.2). |
| **D-full (bounded contexts now)** | (1) Scale inversion: one builder (40 commits, 4-day history); per-context scaling is vacuous when every context's ceiling is one instance rewriting a JSON file. (2) No event substrate can exist on this deployment (throttled CPU, scale-to-zero, 8 s shutdown, ephemeral disk) — D degrades to B-with-worse-ergonomics. (3) No cross-store atomicity (validasi-store precedent) — structurally cannot host the boundary-transfer requirement. (4) Contexts would slice through load-bearing shared state (consent wraps every write; usage metering lives inside domain mutators; one user aggregate). (5) Contract churn: 3 of 5 contexts are pre-discovery. | §8.1 triggers: real team growth with merge contention, sustained users past the store ceiling, a background-work requirement that moves deployment off scale-to-zero, funded machine-writes, or event contracts that survive two pivots unchanged. **D-lite hygiene is adopted now** (§6.6). |

## 5. Deliverable 5 — Migration difficulty from V2 (comparable)

| Proposal | Steps | Test impact | Freeze | Data/consent events |
|---|---|---|---|---|
| **A** | Scope-aware re-signature of `summarizeMonth`/`metrics`/report/timeline/perubahan/papan/prompts/demo/scan-mapping; prive→transfer conversion; book provisioning; delete-cascade for transfer legs | ~100–200 test edits/additions across 12+ fixture files | ~3–6 weeks of risky overlap with pilot | Consent v3 mid-pilot (re-roll B1/B2; cutover-month comparability break unless §6.4 riders precede it); prive history trilemma must be solved first |
| **B+** | M0 floor gate → M1 functional schema versioning → M2 read adapter (`ledger.js` bisnis/pribadi views; behavior-identical) → M3 modal boundary event + keyword fix + retroactive review queue (never auto-reclassify) → M4 prive budget surface → M5 Intelligence read-models → M6 Twin lib → M7 Autopilot T1 (gated) | ~0 existing tests broken by design (additive); new isolation tests added | **None** — every step ships independently | Dataset **archived first** (§6.5); consent v3 (provider-name fix) as its own step; cutover metadata events from day one |
| **C** | Store inversion + person/workspace schema + overlay rule engine + config audit/versioning + SPA information-architecture inversion + second auth path | ~50% rewrite + config-matrix regime (suite runtime doubles) | 11–21 builder-weeks (realistic calendar 3–5 months solo) | Consent v3 for household third parties mid-pilot (attrition risk); longitudinal series breaks |
| **D-full** | Postgres/storage move (the migration IS the proposal) → event substrate (contradicts 4 deployment invariants) → per-context stores/deploys → test harness rewrite (8,115 ln assume one temp dir + one process) | Floor unenforceable during rewrite | Months; blocked on infra decisions that don't exist | New failure classes (partial corruption, cross-store lost updates) with no current answer |

## 6. Non-deferrable riders (adopted NOW regardless of layer timing)

1. **Modal keyword fix** (`nota.js:48`): remove "modal masuk" from the lain-masuk keyword list → unmapped → participant chooses. One line; stops a live defect that falsifies the bank-facing number.
2. **Semantic decision, recorded here:** prive and modal injections are **boundary events between the owner's pockets, never business income**. Implementation follows incrementally; the decision does not wait.
3. **Provenance before automation exists:** additive `origin` (manual|rule|nota|transfer) set server-side on writes; included in `transaction_added` event meta (append-only — cannot be backfilled later; the single genuinely irreversible deferral).
4. **Functional schema versioning:** branch on the existing `version` envelope; stamp per-user feature versions; write a `feature_enabled` event per additive-entity ship. Hours now vs combinatorial archaeology later.
5. **Archive-first:** export + checksum the deployed pilot dataset (all ~20 participants) before any M-step touches storage — decouples "protect the data" (hours) from "freeze the schema" (the expensive conflation this evaluation initially made).
6. **D-lite hygiene:** logical context carve (`server/contexts/*` or documented ownership map + import-lint), typed event vocabulary at existing `pushEvent` sites, and the standing **lib-purity rule** for the dual-use/dependency-free modules — the real extraction seam for any future A/C/D move.
7. **Trim policy:** rule runs, gate states, budget history must not become a third/fourth never-trimmed append-only array; runs go through `pushEvent` or carry documented trimming.
8. **Consent v3** (provider-name fix + any new data-flow scope) ships as its own first step — proving the renegotiation mechanism before any feature asks users to re-learn prive.
9. **Corrected citation discipline:** non-breakingness arguments must cite the real guarantees — financial functions are pure functions of whitelisted field picks; `GET /api/cashbook` returns raw rows (`server.js:1362`) and `publicUser` does not cover transactions, so additive fields DO reach the client and must be chosen accordingly.

## 7. Risks (likelihood / impact / monitoring signal)

| # | Risk | L | I | Signal / mitigation |
|---|---|---|---|---|
| 1 | Store ceiling hit exactly when the program succeeds (write p95 collapse → shutdown force-exit → silent "lost" writes) | Med (scales with success) | High | `/api/health` parse timing + peserta count trend; §8.1 trigger; store replacement is planned, not improvised |
| 2 | Modal=profit defect live today | **Certain** | High (trust asset) | Fixed by §6.1 immediately; audit existing `lain-masuk` rows before M3 review queue; never auto-reclassify |
| 3 | SPA regression from all V3 UI work (zero frontend tests; prior structural regression on record) | High | High | Minimal carve-out of tested modules (chat stream reader, entry flow) + `data-testid` convention before M4+ |
| 4 | Usage-contract silent-zero kills budgets as dispatcher surface grows | Med | High (loops) | Weekly token-log-vs-invoice reconciliation; contract test extended to every new dispatcher method |
| 5 | Consent v3 re-roll attrition mid-pilot | Med | Med | Re-consent rate within 14 days; ship with §6.8 as its own step, not bundled with features |
| 6 | Boundary-mirroring double-count (business & personal views of one event) | Med | High | Paired-void + ledger-verification invariant checks; atomic single-mutator writes only |
| 7 | Contest/research horizon ends, stranding rider rationale | Unknown | Strategic | Named decision point with funder; §8 triggers are worded to survive it |
| 8 | Single-maintainer capacity overrun | Med | High | Milestone slip > 2 weeks ⇒ scope cut, not quality cut; riders (§6) are the protected floor |

## 8. Postponable decisions — each with a falsifiable trigger

| # | Decision | Trigger to revisit (metric / threshold / source) |
|---|---|---|
| 1 | **D-full / Postgres storage move** | Sustained owners > 200 **or** health-probe full-parse > 300 ms trend (`/api/health` already exposes both) **or** >3 contributors with recurring merge contention on `server.js`/`store.js` **or** a background-work requirement moves deployment off scale-to-zero |
| 2 | **Personal satellite ledger (`personal[]`)** | Instrumented demand: ≥30% of active pilot users adopt/ask for personal tracking within 30 days of the instrument shipping **and** satellite split-abandonment < 50% in a 30-day trial; otherwise prive-enrichment stands as the answer to layer D |
| 3 | **Cross-user benchmarking** | ≥100 consented comparable books **and** a consent version whose text covers participant-visible comparison; until then absolute thresholds only (the honest form that already exists) |
| 4 | **Autopilot T2 (scheduled/unattended)** | T1 confirms users tap-confirm recurring proposals at meaningful rates **and** a scheduler substrate decision is funded (tick route + min-instances=1, or Compute Engine path) **and** gate/resourcing for audit+undo is named. Without all three: Autopilot stays T1, honestly |
| 5 | **Household members / shared finance** | Demand evidence from §8.2 instrument **and** a consent instrument designed for third-party data subjects |
| 6 | **Multi-business, staff roles, monetization gating, currency** | Schema reserved (ids/bizId/fields), logic unbuilt; each waits for its own demand signal |
| 7 | **A-full / C-full core inversions** | Only via §8.2/#3 evidence paths; the reserved shapes (allocation-shaped fields, scope-ready adapter) make the later move cheaper, not impossible |

## 9. Falsifiable predictions (decision-record format)

1. If prive-enrichment + Intelligence land and the §8.2 instrument shows **no** meaningful personal-tracking demand by the trial deadline, Proposals A/C's premise was wrong for this user, and B+ stands permanently for this horizon.
2. If benchmarking ships against demo personas or an n<30 cohort before §8.3 fires, the evaluation predicted it will fabricate authority and damage trust — treat that occurrence as a process failure, not a feature.
3. If Autopilot ever writes a financial row without a human tap before §6.3 provenance + §8.4 gates exist, the dataset is silently corrupted; this is defined now as a **stop-ship violation**, not a bug.

## 10. Missing perspectives register (not investigated; noted for honesty)

Security blast-radius of merged personal+business stores; offline-first (no service worker; server-side math assumes connectivity); non-Indonesian expansion (WIB/Indonesian are load-bearing); regulatory (Indonesia PDP, OJK context for credit-adjacent reports); accessibility depth (51 aria- attributes exist; unassessed); second-engineer maintainability (the strongest pro-D argument, unquantified); funder goals (contest framing unexamined as a V3 constraint).

---

**Bottom line.** All ten investigations agree on more than they divide: the deterministic math kernel is untouchable; AI proposes and a human taps; simulation is quarantined as labeled non-fact; the personal boundary is real and currently mis-encoded (modal=profit is a live defect). The four layers do **not** belong together as one data model and one trust contract — they belong together as **one codebase with one invariant-bearing business core, additive extension entities, reserved seams, and four separately-gated trust surfaces**. That is Proposal B+, and its first milestones are the riders in §6, not any of the four layers.
