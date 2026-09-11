# Novaro AI V3 — AI Trust & Autopilot Decision

**Status:** DECIDED ARCHITECTURE — **IMPLEMENTATION AUTHORIZED: NO.** **Date:** 2026-09-11.
**Evidence base:** baseline `5d60203`; committed records (`BASELINE.md`, `ARCHAEOLOGY.md`, `FOUNDATION-DECISION.md`, `FINANCIAL-DATA-MODEL.md`); 9 wave-1 investigations + 4 adversarial proposal reviewers + 1 meta-reviewer (14 agent reports; two re-run after rate limits). Every repository claim is FACT (code-verified, cited), ASSUMPTION, or INFERENCE. Architecture items are labeled **PROVEN REQUIREMENT** (a named stakeholder trust question or a code/consent/research fact creates it) vs **DESIGN PREFERENCE**.

---

## 1. Executive summary

The trust boundary between financial facts and AI is real, narrow, and already half-built: today **no AI output can create or alter a transaction** — the only ledger write is the human-tapped `/api/cashbook` route whose validation lives in the route, while the store mutator validates nothing. The boundary holds for money and fails for words: one AI output path (recommendations) persists provider JSON with **zero server-side re-validation**, AI prose is re-broadcast by deterministic surfaces (fokus card, public card), model identity is misattributed in the UI ("AI Gemini 2.5" hardcoded) and in the consent instrument (names Claude; production runs Gemini), and nothing on disk distinguishes "AI said" from "system verified."

**Decision:** the trust architecture is **Proposal B′ — the event-borne lifecycle, amended to its minimal honest form** (this document amends `FINANCIAL-DATA-MODEL.md` in four named places). Proposals remain **ephemeral in the HTTP response**; the permanent record is: `origin` + `proposalId` on the applied row (server-assigned), one `proposal_shown` research event riding the scan's existing write, a `proposal_rejected` event only for explicit non-applied outcomes, single-use HMAC tokens and request-id idempotency consumed at the hardened mutator, and deterministic display tiering. **Command frameworks (C) and workflow state machines (D) are rejected** — C's handler would bypass the route+mutator validation pair (a stop-ship path), and ten of D's twelve states have no T1 producer. **T1 is the only tier that may ever be authorized, and nothing is authorized now**: every trust prerequisite (consent v3, mutator hardening, provenance, idempotency, live L3 evidence on the deploy target) is currently unmet. **T3 is forbidden outright.**

The central question, answered link by link (§12 closes each):

> financial facts (rows, kept-voided, reconstruction property) → deterministic computation (pure single-sourced kernel) → AI interpretation (scope-labeled prompt-context projections; output schemas; sanitizers) → AI proposal (ephemeral payload + `proposal_shown` event + tier + HMAC token; never a persisted money payload) → human decision (the tap = ordinary validated mutation; edit = field values; reject = one event; idempotent) → financial action (the hardened mutator; server-assigned origin; machines never write income) → audit/history (`origin`+`proposalId` join across rows and events; contentless events; recorded limits).

---

## 2. Verified repository facts (load-bearing; all FACT unless noted)

1. The only ledger write is `POST /api/cashbook` → `store.addTransaction` (`store.js:759-778`). **The mutator validates nothing** — it spreads the caller's object; all validation (enum, clamp, date window, keterangan) lives in the route (`server.js:1369-1383`). "Invariants enforced at the mutator" is therefore **declared, not enforced** today.
2. The scan route writes to the store **today**: `recordUsage` (`server.js:154`) is a full `update()` with lock+flush (`store.js:915-921`). The accurate trust property is "scan never writes **transaction rows** and never stores amounts or free text" — not "no storage access" (`server.js:112-114` overclaims; `nota.js:11-14` is true of the lib only).
3. AI output reaches `users.json` through exactly three doors: `user.chat` (raw prose, 60-turn cap), `user.recommendations` (**raw provider JSON after bare `JSON.parse` — no sanitizer, no re-validation**, `claude.js:304-313` → `store.js:998-1005`; re-broadcast by fokus-harian rule 7 and the public card), `user.latihanAI` (sanitized, answer-key graded deterministically). Checkup is never persisted; scan-nota cannot write rows.
4. The research event stream is contentless **by one example-based test** (`penelitian.test.js:213-225` greps one amount and one name), not by an allowlist — and two live violations of its spirit exist: `peserta_dinamai` carries names (`store.js:559-564`) and `ai_feedback` carries up to 500 chars of free text (`server.js:1037-1050`), which also flows into the "anonymized" export (`export.js:235` writes meta verbatim; the disclosure at `export.js:336` is already false).
5. Model identity is env-mutable (`GEMINI_MODEL`) and **recorded nowhere per call**; the SPA hardcodes "AI Gemini 2.5" in ~6 places and ignores the `model` field the server actually sends (`server.js:967` vs `index.html:2482-2486`); consent text names Claude while production runs Gemini (`consent.js:43` vs `frontend/.env`).
6. Confidence tiers (ok ≥0.85 / warning ≥0.60, `nota.js:137-143`) are computed from **model self-reported confidence**, are pinned by test but have **no calibration evidence anywhere**, and the tier gates the save button (`index.html:3087-3091`) — an attacker-influenced channel gating its own guard.
7. **No idempotency exists on the money path**: `POST /api/cashbook` mints a fresh row id every call; no HMAC/jti machinery exists anywhere (grep: zero); the only double-tap guard is a client-side button disable. Duplicates **can manufacture the reliability gate** (a duplicated scan on day 16 can flip `isMonthReliable`, swapping the dashboard and KUR-facing numbers to "real data").
8. No background substrate: scale-to-zero (`_MIN_INSTANCES '0'`), `--max-instances=1`, 8 s shutdown; in-memory state resets on restart. T2 unattended generation is architecturally absent.
9. Live-AI evidence: last live proof is 2026-06 on the Emergent preview under a key-file identity (iteration reports + PRD prose — self-reported, undated-in-artifact); the deploy target (Cloud Run runtime identity) has **never made one recorded AI call**. The 446-test floor is entirely mock-based.
10. Live consent promises true deletion ("Menghapus berarti benar-benar dihapus", `consent.js:73-75`) — the M4 void-and-restate cutover changes what the delete button does, making consent v3 a hard predecessor.
11. ~20 pilot participants (PRD-of-record; treat as ASSUMPTION-of-record, not measurement). One builder. 4,406-line zero-test SPA with a structural-regression history.

## 3. Existing AI trust boundary map

| Surface | AI returns | Code-side validation | Persisted? | False-authority rank |
|---|---|---|---|---|
| `POST /api/chat` (SSE) | free prose | none (refusal→422, truncation→`terpotong`) | `user.chat`, re-injected as future prompt context | 2 |
| `POST /api/recommendations` | JSON per provider schema | **NONE** (bare `JSON.parse`) | `user.recommendations` verbatim → `/api/me`, Saran page, **fokus card, public card** | **1** |
| `POST /api/checkup` | items+insight | `sanitasiCheckup` (502 fail-closed; zero numeric fields) | never | 4 |
| `POST /api/scan-nota` | typed proposal, all nullable | `sanitasiHasilNota` + code-owned `PETA_KATEGORI` (null→human); **route cannot write rows** | never (usage only) | 5 (cleanest) |
| `POST /api/latihan/:no/ai` | quiz + answer key | `sanitasiLatihanAI` (502) | `user.latihanAI` (graded server-side); `konsep` ≤40 chars leaks into research events | 3 |
| smoke.js / live pytest | — | operator tools (manual; never in CI) | no store (smoke) / live preview store (pytest) | — |

Deterministic verification inventory: sanitizers (nota/checkup/latihan) + route whitelist + budget pre-flight + rate limit with service-failure refund + magic-byte image check + module-unlock gating of prompt material. **Nothing re-verifies an AI-stated number anywhere**; provider-side `json_schema` is trusted on faith (a provider regression silently passes on the recommendations path).

## 4. Existing gaps (severity-ordered)

1. **HIGH** Recommendations persisted unvalidated and amplified by deterministic surfaces.
2. **HIGH** No model/provider identity on any persisted output; no prompt/sanitizer era stamps → "which AI produced this?" is unanswerable forever once Autopilot ships unrecorded.
3. **HIGH** No "AI said" vs "system verified" distinction in any artifact (fokus card, public card carry AI prose unlabeled).
4. **HIGH** Live consent/identity defects: provider misattribution; deletion-promise vs M4; hardcoded UI model name.
5. **HIGH (latent)** No idempotency/tokens on the money path — duplicates and HMAC replay would be attested as legitimate under any T1 (the gate-manufacturing and replay attacks, both verified feasible).
6. **HIGH** Mutator validates nothing — "machines never write income at the mutator" is unenforceable until hardened; any internal caller (future rule detector) writes unvalidated rows.
7. **MED** Contentless-events invariant under-enforced (example-based test; two live violators; anonymized-export disclosure false).
8. **MED** No per-call model version persisted; usage contract silent-zero risk unguarded on the Anthropic passthrough; no AI latency/error observability.
9. **LOW-MED** Gemini client has no timeout (route-abort only); `isConfigured()` over-promises on Vertex (project-presence only — health can say `aiConfigured:true` while every call fails).

## 5. AI influence map (exact paths)

`AI output → users.json`: (1) `generateRecommendations` → `JSON.parse` → `simpanRekomendasiKe` (verbatim spread; nulled only by profile save); (2) `streamChat` → `simpanGiliranChat` (both turns; `POTONG` marker on truncation); (3) `sanitasiLatihanAI` → `aturLatihanAI` (+ key; `konsep` → research event); (4) usage counters (silent-zero risk). **No path reaches `transactions`, `profile`, `progress`, or `consent`.** Under the recommended architecture this map does not grow: proposals die with the HTTP response; only the row (human-tapped) and two contentless events are new.

## 6. Proposal lifecycle requirements

The T1 decision space is **three terminal decisions**: confirmed | edited-then-confirmed | rejected. States with no T1 producer on this substrate: draft, validated-as-stage, expired (no sweeps possible), executed/failed/reversed (ledger facts, not proposal states), superseded (regeneration overwrites the screen). Cross-session persistence is **physically unavailable** (scale-to-zero) and **not required by any evidenced T1 capability** (scan = one row; rules are read-time detectors; recurring is T2-gated). Therefore: **lifecycle = generated→presented→{confirmed|edited|rejected}, everything else derived or forbidden.** Requirements extracted by the investigations: server-issued proposal id; immutability of terminal decisions; no expiry sweeps (abandonment = shown-without-row, an analysis convention); stale-state handled by **write-time revalidation in the mutator** (precondition checks: target exists, not voided, expected fields — else typed 409), never by snapshots (snapshot binding = stored FinancialState, already rejected); idempotency at confirm (request-id row-field + single-use jti); **amount-delta audit limit recorded** (amount corrections are reconstructible only lossily from rows — never event meta).

## 7. Competing trust architectures

| | **A. Minimal Proposal Adapter** | **B′. Event-borne lifecycle (RECOMMENDED)** | **C. Command-Based Automation** | **D. Workflow/Event Architecture** |
|---|---|---|---|---|
| Canonical objects | Rows + `origin`; proposal = HTTP response only; HMAC jti; request-id | A **plus** two contentless research events (`proposal_shown` riding the scan's existing write; `proposal_rejected` for explicit reject) + row `proposalId` join; deterministic tiering; identity surfaced | Typed Command objects `{action, payload, preconditions, provenance}` + handler registry + command log | Persisted `proposals[]` + 12-state machine + sweeps + inbox UI + snapshot binding |
| Trust boundary | Write-time validation (if moved into the mutator) | Write-time revalidation + precondition checks in mutator + decision instrumentation | Schema validation + precondition objects at a separate validate step | State machine enforces transitions |
| Storage | "Zero new structures" — **false by its own token** (jti state must live somewhere) | <1 KB/lifecycle on the existing event stream; zero new arrays | `commands[]` money-payload array (violates three-way rule) + trim + states | `proposals[]` fourth array + snapshots + sweeps |
| Stale-state | Dissolved (nothing binds) — but no way to audit "AI wrong vs human wrong" | Dissolved + mutator preconditions (409 target-voided) | TOCTOU or theater (check-once = stale; check-twice = mutator did the work) | Snapshot binding = stored FinancialState (rejected) |
| Audit | origin only — no acceptance/calibration/abandonment/learning; provenance destructible under hard delete | origin + proposalId + shown/rejected events; **recorded limit**: amount deltas never in events | Command log duplicates the event system in a second vocabulary | Richest — and forks the source of truth ("did this money happen" answered twice) |
| AI provenance | origin enum; token attests only "a scan preceded this write" | + era stamps (deferred from critical path), surface-labeled identity | command-carried provenance = self-reported forgery surface (stop-ship class) | full payload retention (consent v3 scope) |
| Migration cost | ~zero upfront; **inverts by M8** (every later addition re-touches the same untested surfaces) | additive events + consent v3 naming + stamps | medium-high (registry/schema/versioning) | highest (consent scope + SPA inbox + sweeps + trim + research CSV) |
| Verdict | **Fails as specified** — survives only as "B′ with the audit amputated"; its jti/idempotency needs secretly contain B′'s machinery | **RECOMMENDED (amended)** | **Fails** — handler bypasses or duplicates the route+mutator validation pair (tested invariant: "jalur kedua… bug, bukan fitur", nota.test.js:303-336); preconditions-as-objects = TOCTOU or decoration | **Fails as T1** — 12 states → 0 persisted producers; correct only at the T2/inbox trigger (pinned escape shape below) |

**The excluded fifth option, adjudicated:** "build none of it — keep scan-nota as the only proposal surface until a second type has a named user story." **Partially accepted.** Generalized T1 machinery (rule suggestions, recurring catch-up) is **not** recommended now — no stored rules exist, recurring is T2-gated, no demand instrument exists. But the instrumentation subset (origin, `proposal_shown` on the *existing* scan surface) is justified **independently of T1**: scan-nota is a live, unmeasured AI decision surface writing into the bank-facing ledger today, the research stream is the consented instrument for exactly this ("alat ukur yang selama ini hilang", `server.js:1024-1032`), and every pre-instrumentation scan decision is permanently unrecorded (the same irreversibility logic the records already adopted for `origin`). Framing disclosure: the four-proposal menu spans the build-spectrum but not the do-not-build pole, and investigators read two committed DECIDED documents through one lens — re-affirming B was the path of least resistance; B survives this review only because its evidence was re-derived lineage-free (scan-nota's live provenance vacuum) **and simultaneously shrunk** (the delta was cut by it).

## 8. Architecture comparison matrix

| Criterion (trust-critical) | A | **B′** | C | D |
|---|---|---|---|---|
| AI can never write rows (mutator-enforced) | ✔ (after hardening) | ✔ (after hardening) | ✖ handler bypass risk (critical) | ✔ |
| Every proposal decision answerable in audit | ✖ | ✔ | ✔ (duplicate vocabulary) | ✔✔ (forked truth) |
| Duplicates/HMAC replay blocked | ~ (idempotency-by-luck as specced) | ✔ (row-field + jti-in-mutator) | ~ | ✔ (added machinery; new double-decide hazard) |
| Stale proposals harmless | ✔ (structural) | ✔ + 409 preconditions | TOCTOU/theater | ✔✔ (snapshots; violates FinancialState rejection) |
| Learning/calibration signal | ✖ | ✔ (shown⋈row; **amount-blind — recorded limit**) | ✔ | ✔✔ |
| Consent scope growth | none | v3 names proposal records (rides already-owed v3) | v3 + payload retention | v3 + AI-output retention + attrition risk |
| Store-ceiling impact | zero | ~0.5-0.75 MB/yr per active scanner (wired into §8.1 signal) | + commands[] array | + proposals[] + snapshots (worst) |
| One-write-path invariant preserved | ✔ | ✔ (confirm = the ordinary route) | **✖ (tested invariant broken)** | ✔ |
| Migration cost | ~0 (false economy) | low | med-high | high |
| Solo-builder surface | smallest | small | subsystem (500-1,000+ ln) | multi-week slice |

## 9. Recommended architecture — B′ (event-borne, minimal), five layers

1. **Mutator hardening (prerequisite — the trust floor):** validation (enum/clamp/date-window/whitelist) moves from route into the store mutators; an **effective-actor parameter** is added; `origin`/`proposalId` assigned **only inside mutators**; **machines-never-write-income** becomes a mutator check (an income row whose effective actor is not a human tap is refused); typed 409s (void-of-void, replacement, replayed request-id/jti). Pinned by stop-ship tests (body-supplied `origin`/`proposalId` ignored; machine-income refused).
2. **Provenance:** `origin` (manual|nota|rule|transfer) on rows **and** in `transaction_added` meta; `proposalId` on proposal-born rows; HMAC token issued by the scan route carrying `tokenVersion` + TTL + jti, **consumed inside the mutator** — honest jti store = the user's rows (a confirm with a jti already present on a row → 409), labeled "single-use within TTL and store lifetime," never claimed as unconditionally single-use.
3. **Proposal instrumentation (the B′ events, named to match the stream's snake_case convention — FDM naming amendment):** `proposal_shown {id, sumber, jenis, kategori|null, tingkat}` emitted inside the scan's **existing** `recordUsage` write (zero added flushes; the trust-property comments/tests reworded to "never writes rows, never stores amounts or free text, persists AI-derived data only as closed-vocabulary metadata"); `proposal_rejected {id}` only for an explicit reject affordance **if one is built** (none exists today — `diterima`/`diubah` derive from rows carrying `proposalId`; the `notaIsiManual` conversion path carries the proposalId too; abandonment = shown-without-row, documented convention). **No delta events** (FDM amendment: redundant with shown⋈row, amount-blind, irreversible if wrong).
4. **Display trust:** deterministic tiering per surface (nota thresholds declared nota-specific; a read-time detector has no model confidence — its "tier" derives from field-nullness/precondition distance); confirmation contract PR-1..PR-6 (month statement, guessed-field "perkiraan" markers, book-of-record naming, user-language uncertainty, post-confirm visibility for off-screen months, named undo path); live model identity surfaced (SPA reads the `model` field); staleness markers on stored AI prose.
5. **Reliability policy (R1-R10 from investigation 5):** propose-only preserved; SDK-bounded transport retries, none implicit on Gemini; refund on 502/503/429; never retry a confirmed write; AbortSignal everywhere; honest degradation; **no fallback model/failover** (usage-contract silent-zero + per-model calibration + consent naming make it untrustworthy); Gemini deadline added (per-feature ceilings below proxy limits); recommendations re-validated server-side before storage; confirm never requires an AI call; `isConfigured()` added to chat/recommendations; model-bump protocol (consent bump + contract test + calibration note).

## 10. Rejected alternatives

- **A (as specified)** — audit-insufficient by construction on a live surface (irreversible non-recording); "zero new structures" falsified by its own jti; learning dead-end (even the live `PETA_KATEGORI` map loses its only improvement signal); provenance destructible under hard delete. Its correct pieces are B′ layers 1-2. Resurrection: formal end of the research program (a funder decision, not an engineering result).
- **C** — the handler is a second write path: bypass the route = stop-ship; wrap the route = the command layer bought nothing; duplicate it = industrialized twin-literal debt. Preconditions-as-objects are TOCTOU or decoration (the load-bearing check is the mutator's either way). Resurrection: an evidenced multi-mutator atomic proposal capability, or an external serialized-intent consumer — neither in horizon; **not** the T2 trigger.
- **D** — 12 states, 0 T1 producers; `executed`/`reversed` mirror ledger state (two sources of truth); snapshot binding violates the FinancialState rejection; sweeps are theater at scale-to-zero; cross-session proposals physically unavailable. **Escape shape pinned now (FDM amendment):** if the trigger fires (measured decide-later demand via B′'s own events + funded §8.4 substrate + §8.1 storage move + consent v3 retention scope — all four), the shape is a **pending-only `proposals[]`**: terminal states only as events + row origin, never `executed`/`reversed`/`failed` states, no metric snapshots, decision idempotency key mandatory, retention begins at first display, companion research CSV in the same milestone.

## 11. AI provenance model

**Audit questions first (the only six that earn storage):** where did this row come from (`origin`)? what was proposed and what did the human decide (shown event + row join)? which AI system and code era (backend+model derivable from `era` stamps — no provider strings in event meta)? can we re-derive what the AI saw (recomputation by the reconstruction property — **except** nota images (never retained; regime recorded) and evicted chat turns)? was uncertainty shown and a human in charge (`tingkat` + mutator actor rule)? what did AI usage cost (existing cumulative `usage` + 14-day `tokenLog`; extend with a feature dimension)?

**Field adjudication:** AUDIT-REQUIRED: `origin`, `proposalId`, `tingkat`, era stamps, structural decision outcome, consent version (joined, not duplicated), timestamps (existing). USEFUL-OPTIONAL: request id (log-line join), `kategoriWasNull` flag. **DANGEROUS-TO-RETAIN / UNNECESSARY:** full prompt text and input snapshots (prompts are pure functions of user data + code era + clock — recomputable; a persisted copy is a second PII surface answering nothing; nota images cross a line the code itself refuses); per-proposal token counts (trim violation); executor identity (no roles exist); document hash before the Document entity (dangling pointer). **Minimal record: zero new stores** — row fields + event meta + existing counters.

**Versioning:** `PROMPT_ERA` / sanitizer-era exported integers, bumped on prompt/schema/mapping changes, recorded in shown-event meta and `feature_enabled` events; git SHA lives in the export manifest only.

## 12. Validation architecture (the boundary chain, each link closed)

1. **Facts:** rows + kept-voided; reconstruction property (state at T derivable); append-only events.
2. **Computation:** pure, single-sourced kernel (`cashbook`/`metrics`/`simulasi-kur`); ratios never AI-computed.
3. **Interpretation boundary = the prompt-context projection contract, per surface** (inputs; scope labels; "dihitung sistem" marker; output schema; sanitizer; budget class). Every new dispatcher method is a new contract entry + usage-shape contract test + its own live-evidence rung. **Prerequisite fix: recommendations sanitization** (the one unvalidated path).
4. **Proposal:** ephemeral payload + shown event + tier + HMAC; never persisted as money state; no state lock — **apply-time validation is the only gate, and impact displays (if ever built) must say so**.
5. **Decision:** the tap; edits are just field values; explicit reject = event; double-decide impossible (row-existence + jti).
6. **Action:** the ordinary validated mutator (hardened); origin/proposalId server-assigned; income-actor check; consent gate preserved.
7. **Audit:** rows + `origin`/`proposalId` + contentless events; **recorded limit:** amount-correction deltas never enter events (lossy reconstruction from rows only); no automated learning consumer at T1 — signal accumulates, the Rule entity stays deferred with its trigger.

## 13. Human confirmation model

Minimum honest contract — PR-1 month statement; PR-2 guessed-field provenance markers (reuse the curriculum's own "perkiraan" word); PR-3 book-of-record naming; PR-4 uncertainty in user language (never "confidence 0.72"); PR-5 post-confirm visibility for off-screen months (the server already computes the entry-month summary — currently discarded by the client); PR-6 named undo path with jejak truthfulness. DP (evidence-free, deferred): before/after saldo preview, score-impact preview, expiry indicators. Structural rule for T1: **tier/confirmation behavior lives in one shared render contract** so the low-tier-hides-save pattern cannot silently fail to apply to new proposal types. Confirmation theater findings accepted: the tap must certify state-and-consequence, not a form (PR-1/PR-5 close the worst cases; impact preview stays a DP).

## 14. Automation tier model

| Tier | Allowed | Prohibited | Required validation | Human role | Rollback | Audit |
|---|---|---|---|---|---|---|
| **T0 AI explains** (now) | Narration over server-computed, scope-labeled numbers; persisted prose in existing stores only | Any number not from the server kernel; identity misattribution; unvalidated persistence | Sanitizers; recommendations re-validation (new) | Reads | n/a | usage counters; era stamps (new) |
| **T1 AI proposes, human confirms** (architecture defined; **not authorized**) | Single-row proposals from user-initiated surfaces (scan; read-time detectors); tiered presentation; HMAC+jti; 409 idempotency | Multi-row batches (no producing capability); income rows without the human-tap mutator check; auto-apply; cross-session persistence; tier thresholds transferred between surfaces | Mutator revalidation + preconditions; single-use tokens; contentless-event allowlist | One tap per proposal | Ledger void (M4) | origin+proposalId+events |
| **T2 AI executes bounded low-risk actions** | **Specified-but-absent.** If ever: recurring materialization and auto-categorization below consented thresholds, with undo+audit | Income writes; boundary events; anything without a persistent-store guarantee; anything without per-surface live evidence + calibration argument | §8.4 gates + pending-inbox storage tier (pinned shape) + idempotent occurrence keys | None per action; consented enrollment | Compensating void; occurrence-key dedupe | Full event trail + command-free audit |
| **T3 unattended financial operations** | **FORBIDDEN — explicitly.** Grounds: consent instrument never contemplates agency; single-writer store; no substrate; research-dataset integrity; low-literacy trust audience; stop-ship class | Everything | — | — | — | — |

**Does Novaro architecturally support T2 now? No** — naming the tier is not building it; T2 is specified-but-absent, and any "runway" claim (the logic that killed C/D) is rejected. **T3 forbidden.**

## 15. Failure model

Provider outage → honest Indonesian copy + limiter refund; no fake content; non-AI features untouched. Timeout → same taxonomy (Gemini deadline new). Malformed output → fail-closed 502 (sanitizers); recommendations re-validated (new); one logged retry allowed for display-only features only. Partial chat stream → partial on screen, `POTONG` honesty preserved; mid-stream drop unpersisted (documented honesty gap). Budget 429 → blocks generation, **never** confirmation (R9). Invalid config → request-time IAM-specific 503; `isConfigured` hardened (not project-only). Model bump → consent bump + usage-contract test + calibration note; silent-zero risk guarded by contract tests per dispatcher method. Flush-throw → mutated-memory/stale-fingerprint window (pinned by test; runbook: verify from disk).

## 16. Retry / timeout policy

R1 propose-only; R2 SDK-bounded retries, none implicit on Gemini; R3 refund on 502/503/429; R4 never retry confirmed writes; R5 AbortSignal on every route; R6 honest degradation; **R7 no fallback model/failover (proven)**; R8 idempotency at the proposal-confirm boundary; R9 confirm never requires an AI call; R10 config taxonomy + `isConfigured` symmetry. D-preferences: one logged malformed-JSON retry (display-only); Gemini deadlines (chat 120 s, small JSON ~60 s, recommendations ~240 s < proxy 300 s); no circuit breaker now (in-memory 5-fail/60 s fail-fast only on incident evidence); sha256 re-scan dedup at the scan milestone; model-version provenance + live model label.

## 17. GCP production readiness assessment

- **Local dev — L0.** Vehicle exists (`npm run smoke`, one paid call pair; exits 1 unconfigured); no record of execution; its cost block prices Anthropic rates (stale for Gemini).
- **CI (Cloud Build) — L0 by design.** `npm ci && npm test` on node:22-slim, no credentials, fake SSE only. Proves logic, nothing about live AI.
- **Emergent preview — L2-historical, downgraded to "unknown, bounded above by L2".** Live Gemini calls plausibly succeeded (iteration reports; PRD "Status verified 2026-06"; pytest 6/6 incl. 2 live calls) — but evidence is self-reported prose, undated in-artifact, against a host/config generation that no longer matches tracked config (storage since switched; host URL stale in `test_novaro.py:7`). Admissible only for properties invariant across those changes.
- **Cloud Run production path — L0 for AI.** Pipeline builds/deploys but never calls the deployed service; zero artifacts prove a Vertex call from the runtime identity; IAM (`roles/aiplatform.user`), API enablement, region reachability (asia-southeast2→us-central1), quota, and model availability are documented-as-comment only.
- **No L3/L4 anywhere.** `CLOUD_ML_REGION` is not set on Cloud Run (implicit default); credential failure is honest but late (project-presence-only `isConfigured` can over-promise).

## 18. Live evidence maturity level

**Property × host × date matrix (the ladder is per-property, per-host, dated):**

| Property | Preview (key-file identity) | Cloud Run (runtime identity) | Local |
|---|---|---|---|
| Schema-valid structured output (nota/checkup) | claimed 2026-06, undated artifact — **≤L2, stale** | never | L0 |
| SSE chat streaming | claimed 2026-06 — **≤L2, stale** | never | L0 |
| **Confidence calibration (tiers 0.85/0.60)** | **zero evidence at any rung** | zero | zero |
| Sustained reliability/error rates | none (L4 nowhere) | none | — |

**Path to L3 (named artifacts):** post-deploy `uji-hidup` cloudbuild step (curl `/api/health` asserting `aiConfigured:true, model` + one authenticated checkup via demo secret — proves the runtime identity end-to-end); explicit `CLOUD_ML_REGION` env; committed IAM-evidence artifact; dated committed smoke output in `test_reports/` (Gemini-priced); re-pointed pytest 6/6. **Standing rule: every new dispatcher method starts at L0 and needs its own rung on the production host before user exposure.**

## 19. Required test gates

Seven classes (detail in investigation 9): (1) deterministic validation at the mutator incl. forged-origin/body-supplied-provenance refusals; (2) adversarial proposal/sanitizer matrices (incl. the recommendations hole; OCR injection provable only manually); (3) stale-state (target voided, ledger changed, enum widened, date drift — never half-applied, never silently applied); (4) duplicate execution (double-tap `gantiId`, jti replay, request-id replay, terminality); (5) failure injection (mid-stream 500, truncated frames, budget-429-between-proposal-and-confirm — new dribble/partial fakes); (6) provenance (origin per path, replay rejected, era recorded, contentless allowlist, proposalId join); (7) live evidence (manual operator gates; per-method rungs). Classes 1-6 are CI floor growth ≈ +8-13 s (consolidate into 2-3 files; build the `jedaGagal` stub first); class 7 is the documented operator checklist. **Cloudbuild floor composition:** the machines-never-write-income triad (classes 1+5+6) is non-deletable for any T1 ship.

## 20. Required prerequisites before Autopilot implementation (numbered, in order)

1. M0 archive-first (manifest enumerated file set; canonical DATA_DIR resolver).
2. **Consent v3** shipped and acknowledged: provider name fix; retention-after-delete; keterangan-on-voided; proposal/AI-suggestion profiling named; keterangan-scrub option decided.
3. M1 schema stamps (`featureVersions`, feature ship-date table, `feature_enabled`).
4. **Mutator hardening**: validation into mutators; effective-actor parameter; server-assigned `origin`/`proposalId`; machines-never-write-income check; stop-ship tests.
5. Idempotency: `gantiId`/void 409s; request-id row-field policy (incl. missing-id failure mode); jti store decision implemented.
6. HMAC token (format + `tokenVersion` + TTL) issued by the scan route.
7. Proposal events + per-type meta **allowlist structural test** + adjudicate the two existing contentless violators (`peserta_dinamai`, `ai_feedback`) + export anonymize filtering made true.
8. Recommendations sanitizer (close the JSON.parse hole).
9. Deterministic tiering + live model identity in UI + staleness markers on stored AI prose.
10. Live evidence: L3 on the deploy target (per §18); per-method rungs for every new dispatcher method.
11. Test-gate classes 1-6 green in the CI floor.
12. **A named second proposal surface with a user story** (the fifth-option gate) — otherwise T1 generalization stays unauthorized even after 1-11.
Additionally, M2-M4 (ledger adapter, modal boundary, void-and-restate) per FINANCIAL-DATA-MODEL remain predecessors of their own milestones.

## 21. Irreversible decisions (decide once, now — recorded here)

1. **Event vocabulary**: `proposal_shown` / `proposal_rejected` — **snake_case, matching the existing stream** (FDM's dot-case names amended); exact payload shapes as in §9.3; additive-only evolution; a type is never silently reused (`transaction_voided` precedent).
2. **No delta events** (FDM amendment): acceptance/edit is derived from shown⋈row; **amount-correction deltas never enter events** — recorded as a permanent audit limit.
3. **Consent v3 wording** — the single most irreversible string in the program; enumerated disclosures (§20.2); decide-once with named review.
4. **HMAC token format** with `tokenVersion`; TTL; jti store = row-presence check (honestly labeled); transport = server-issued signed tokens; `origin`/`proposalId` never body-trusted.
5. **featureVersion names** frozen in one reviewed constant table.
6. **Tier thresholds are nota-specific** (0.85/0.60, unaudited in-repo) — no transfer between surfaces without a calibration argument.
7. Inherited: GET-excludes-voided; machines-never-write-income (stop-ship); seed-once; fail-closed storage gate.
8. New stop-ship violations: any persisted proposal array without a trim policy; any AI surface exposed below its live-evidence rung; a forged-origin write reaching the ledger.

## 22. Decisions that can be postponed (with triggers)

Impact preview (measured confirmation-error evidence) · calibration harness (tier-vs-decision divergence in the T1 events) · circuit breaker (incident evidence) · rule entity + learning consumer (user-authored rules / T2) · pending-inbox `proposals[]` (all four D-gate conditions) · Document persistence (storage + consent + recall demand) · benchmarking cohort (§8.3) · multi-entity books (§8.6) · monetization gating.

## 23. Migration implications for the transaction-centric model

The canonical model is **amended, not restructured**: (a) event names corrected to snake_case (`proposal_shown`/`proposal_rejected`); (b) **delta events removed** from the committed vocabulary — decided outcomes for confirms are derived from `origin`+`proposalId` rows; (c) the pending-only `proposals[]` escape shape pinned (§10-D); (d) scan-route trust-property comments/tests reworded (write site for usage; now also shown events); (e) contentless invariant enforcement upgraded from example-grep to a per-type meta allowlist test, with the two existing violators adjudicated; (f) export manifest gains AI-era stamps; `transactions.csv` gains `origin`/`proposalId` columns; events.csv anonymize filtering fixed. All changes land inside the already-planned M1/M3/M4/M8 steps — no new milestones; the transaction-centric core is untouched.

## 24. Complexity / YAGNI findings

Cut by this mission's review chain (with resurrection triggers): persisted Proposal entities + 12-state machines (T2/inbox trigger) · command registries & precondition-object frameworks (multi-mutator atomic capability; external intent consumer) · approval queues/workflow engines (a second actor class) · full prompt logging/snapshot stores (dispute need + consent disclosure) · per-call model registries (an A/B research protocol) · circuit breakers (multi-instance) · fallback chains (an SLA with visible degraded mode — never a silent chain) · hash-chain audit trails (regulatory audit) · policy/DSL governance layers (never — governance lives in enums+mutators+consent+budgets) · confidence-calibration harnesses (measured divergence) · expiry sweeps (push-notification substrate) · idempotency infrastructure beyond the 409/jti checks (multi-instance). Kept because proven: mutator hardening, origin/proposalId, HMAC+jti, two contentless events, deterministic tiering, confirmation contract (PR items), recommendations sanitizer, live-evidence rungs. **Forgotten-safety findings (now gated):** the unvalidating mutator; the recommendations hole; the silent-zero usage contract; `isConfigured` over-promising; negative-amount semantics divergence (`asNumber`→0 vs sanitizer→null); the `TAHUN_TERLAMA` twin literals; the consent-deletion trap; the delta-drift temptation (closed by the allowlist test).

## 25. Explicit implementation authorization status

**IMPLEMENTATION AUTHORIZED: NO.**

- **Architecture:** B′ (§9) is decided on paper, including the FINANCIAL-DATA-MODEL amendments in §23.
- **"T1 only" means:** *if and when* implementation is ever authorized, T1 is the only authorized tier — never "T1 ships now." Generalized T1 additionally requires prerequisite 12 (a named second proposal surface with a user story).
- **T2:** specified-but-absent; requires §8.4 + §20 + the pinned inbox shape. **T3: forbidden.**
- **Live AI:** no environment currently exceeds "unknown, bounded above by L2"; no recommendation in this document may be read as relying on live reliability evidence that does not exist.
- Nothing in this document authorizes product features, refactors, database changes, migrations, or Autopilot work. Each milestone requires its own explicit go-ahead.
