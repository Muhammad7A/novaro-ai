# SESSION G — PRODUCT MOAT & ARCHITECTURE RECONNAISSANCE

**Status:** READ-ONLY RECONNAISSANCE — no implementation, no commits, no pushes, no deploys, no cloud spend. **Date:** 2026-09-12. **Evidence base:** working tree at `2ad3ea7` (origin/main, clean), canonical test suite re-run this session, direct reads of server/lib core files, server.js route table, all four committed decision documents (`FINANCIAL-DATA-MODEL.md`, `AI-TRUST-AUTOPILOT-DECISION.md`, `FOUNDATION-DECISION.md`, `PHASE-0-INTEGRATION-CHECKPOINT.md`), all 44 test files (surveyed), all 4 frontend HTML files (read in full), infra files (cloudbuild.yaml, Dockerfile, scripts, deploy configs).

**Labeling:** every important claim below is tagged **VERIFIED FACT** (repository evidence cited), **INFERENCE** (evidence used stated), **ASSUMPTION** (uncertainty stated), **DESIGN DECISION** (a proposal, not an existing fact), or **OPEN QUESTION**.

---

## STATUS PELAKSANAAN — diperbarui 2026-09-12, sesi G fase 3

| Fase | Isi (§12–§13) | Status | Commit |
|---|---|---|---|
| 1 (dulu "SESSION H") | Rekam advisori: append-only, trim 24/jenis, event `advisori_dibuat`, write-through slot, `simpanCheckup`, stempel `featureVersions` M1-lite, fix E-1 | **SELESAI** | `3c2febd` (lantai 569) |
| 2 (dulu "SESSION I") | Checkpoint hasil read-time (`evaluasiTertunda`, `tambahEvaluasiAdvisori`), `GET /api/advisori/riwayat` + hook `/api/fokus`, `lib/deteksi.js` (3 detektor), permukaan Riwayat Saran | **SELESAI** | `55288a9` (lantai 583) |
| 3 (dulu "SESSION J") | Instrumentasi keputusan (`evaluasi_advisori` — tercatat: sudah terpenuhi fase 2, dengan delta sadar meta `{id, metode, status}` — status amount-blind dan permanen karena baris evaluasi ter-trim 48 sementara event tidak pernah dipangkas), tabel ekspor `advisori.csv` + `evaluasi_advisori.csv` (disiplin anonim), rung `--ai-route rekomendasi` pada `uji-hidup` | **SELESAI** | sesi ini |

**Rung yang MENUNGGU EKSEKUSI OPERATOR** (window F — semuanya membutuhkan deploy/biaya Cloud, bukan sesi builder):

1. Redeploy `main` → revisi Cloud Run baru (bundle terdeploy saat ini adalah Aug-31, internalnya tidak konsisten — `/api/checkup` 500).
2. `uji-hidup` penuh (rute chat) pada revisi baru — artefak bertanggal BARU wajib; jangan pernah mengutip artefak 2026-09-11 untuk revisi lain.
3. `uji-hidup --ai-route checkup` pada revisi yang sama (rung per-metode, keputusan §18).
4. `uji-hidup --ai-route rekomendasi` (rung baru, disiapkan fase 3 — belum pernah dieksekusi live mana pun).
5. Build Cloud Build pertama pasca-G3: lantai CI (`uji` step) wajib 583/0 sebelum `deploy` berjalan.

---

## 1. Repository State Verification

Checked this session before any analysis (VERIFIED FACT for all rows):

| Item | Expected | Actual | Verdict |
|---|---|---|---|
| Branch | `main` | `main` | VERIFIED FACT |
| HEAD | `2ad3ea7` | `2ad3ea710135363b12f3c2942d328c091ea1d89a` | VERIFIED FACT |
| Working tree | clean | clean (`git status --porcelain` empty, pre-report) | VERIFIED FACT |
| origin/main | in sync | `2ad3ea7`, ahead 0 / behind 0 | VERIFIED FACT |
| History | `61efe69` → `2ad3ea7` | confirmed: `61efe69` (integration freeze, tag `v3-integration-freeze-2`) then `2ad3ea7` (session-d) | VERIFIED FACT |
| Canonical test | `cd server && npm test` = 535/0/0 | **535 pass / 0 fail / 0 skipped, exit 0**, Node v24.18.0, 348.7 s | VERIFIED FACT (run this session) |
| Test files | — | 44 files in `server/test/` (not 43) | VERIFIED FACT |

**Differences from expected state: none.** The tree was clean; no dirty-file triage (categories A–D) was needed.

Two documentation-drift findings (VERIFIED FACT, non-blocking):

1. `BASELINE.md` §6 still records the floor as **446** tests; the suite is now 535. The "regression = lower count" governance rule in BASELINE.md references a stale number. The live floor is 535 (re-verified above).
2. Root `package.json` `npm test` runs `node --test server/test/*.test.js` **without** `--test-concurrency=1`; the canonical command (and CI's `uji` step) is `cd server && npm test`. The root script is vestigial and can produce different (parallel, flakier) behavior on win32.

---

## 2. What Novaro Actually Is Today

**VERIFIED FACT synthesis** (frontend read in full, server route table, prior committed decision docs):

Novaro today is a **research-grade, consent-gated cashbook and KUR-readiness assistant for Indonesian micro-traders**, delivered as a single-page Indonesian-language app backed by one Node/Express monolith. Three co-equal layers exist:

1. **The money layer (the chassis).** Daily cashbook entry (masuk/keluar, 7 closed categories with a `laba` flag separating prive/cicilan from profit), a deterministic metrics kernel (`computeMetrics`: laba bersih vs saldo kas as independent numbers, health score, monthly timeline, month-over-month deltas), a printable bank-facing KUR report with installment simulator, and a shareable public "Kartu Kesehatan Usaha". Every number is server-computed (`cashbook.js`, `metrics.js`, `simulasi-kur.js`).
2. **The learning layer (the research treatment).** A 7-session core + ~22 pustaka micro-learning curriculum (`kurikulum.js`, 1,487 lines — the largest single module in the codebase) with server-enforced day gating, server-verified practical homework, and server-graded quizzes. This is an *intervention being measured* on B1/B2 waitlist-control batches, not a free-floating feature.
3. **The AI layer (a labeled assistant, not the product's face).** Five surfaces — chat (SSE), recommendations, scan-nota, checkup, AI quiz challenge — all opt-in, per-user token-budgeted, sanitized before persistence, provenance-stamped (`sumber: 'ai'|'contoh'` + `model`), staleness-windowed, and consent-gated (v3 names both Anthropic and Gemini/Vertex).

The daily loop the product actually creates is: **record → see score/fokus → today's learning session → (optionally) ask AI**; the weekly/monthly loop ends in the KUR report. Demo mode (20 seeded warungs, codes 101–120, Papan Kemajuan leaderboard) is a confined showroom on a device-local flag. Expert-validation instruments (`validasi.html`) and anonymized research export are first-class citizens — this is an academic field-trial instrument evolving product-ward, and the code says so honestly (landing page: "prototipe dari program penelitian independen").

**INFERENCE:** the strategic ladder proposed for Session G (accounting → financial event system → financial intelligence → AI-assisted decisions) is **compatible with the evidence, with one amendment**: the "financial event system" rung must NOT be read as event-sourced storage — that was already adjudicated and rejected in `FINANCIAL-DATA-MODEL.md` §0 (event-centric storage REJECTED; hybrid deferred until a real consumer exists). Novaro already has the event *discipline* it needs (contentless research-event stream + kept provenance). The rung that is genuinely missing is the third one: **financial intelligence with memory and accountability** (see §9).

---

## 3. Capability Map

Subsystems as product architecture (not file-by-file). Orientation: **P** = production-oriented, **R** = research-oriented, **D** = demo-oriented.

| Subsystem | User problem | Inputs | Persistent state | Outputs | AI | Deterministic | Orientation | Coupling |
|---|---|---|---|---|---|---|---|---|
| Cashbook (entry, filter, search, delete) | record daily money | manual rows; WIB date default | `user.transactions` (append; hard delete) | rows, monthly summary, charts | none | full (route whitelist + hardened mutator, requestId dedup) | P (core) | feeds everything |
| Metrics kernel & dashboard | "how is my business doing" | transactions + profile | none (pure compute + TTL caches) | laba/kas/score/komponenSkor, timeline, perubahan | none | full (`computeMetrics`, single-sourced) | P (core) | consumed by report, fokus, AI prompts, kartu |
| KUR report + simulation | bank-readiness | month metrics, profile cicilan | none (rendered on demand) | printable P&L, AMAN/KETAT verdict | none | full (shared `simulasi-kur.js` node+browser) | P | thresholds reused by fokus rule 5 |
| Fokus Harian | "one thing today" | metrics, perubahan, latest recommendations | none | single action card | reads stored warnings only (30-day window) | full (10-rule first-match-wins) | P (core) | joins learning (modul links) |
| AI chat (Konsultan Nova) | ask questions | message + server-built context (profile, cashbook, module) | `user.chat` (60-turn cap) | SSE prose, provenance-stamped | yes (sanitized persistence, budget, rate-limit refund rules) | budgeting/gating | P (supporting) | prompts.js contracts; module gating |
| Recommendations (Saran) | improvement plan | profile + metrics (server) | `user.recommendations` — **single overwritten slot** | ringkasan/peringatan/≤5 items | yes (whitelist sanitizer, provenance, 502 fail-closed) | sanitizer + caps | P (supporting) | re-broadcast by fokus rule 7 and kartu |
| Scan-nota | receipt → draft row | image blob | nothing (usage only) | proposed row, confidence tiers | yes (typed schema, code-owned category map, null→human) | sanitizer, magic-byte check | P (experimental) | cannot write rows |
| Checkup | periodic narrative check | metrics | nothing (display only) | items + insight, zero numeric fields from model | yes | sanitizer 502 fail-closed | P (experimental) | broken on deployed Aug-31 bundle; local code consistent |
| Latihan-AI (quiz challenge) | practice from own numbers | module material + metrics | `user.latihanAI` | quiz + server-graded answer | yes | deterministic grading, key never sent | R→P bridge | curriculum |
| Curriculum & progress | the intervention | session completion, praktik actions | `user.progress`, `user.mulaiPada` | gated sessions, 2 progress bars | quiz generation only | day gating, server verification | R (core treatment) | joins fokus + praktik events |
| Consent & data sovereignty | participant rights | user taps | `user.consent {versi, agreedAt}` | 451 gate, download, delete | no | version-bound enforcement (3 enforcement points) | R/P (trust floor) | wraps every write route |
| Research event stream (jejak) | behavior audit | system emissions | `user.events` (append-only, contentless, ~26 registered types, schema-registry-gated) | anonymized CSV export | no | structural schema registry + free-text ratchet | R (core instrument) | every subsystem emits |
| Demo mode + Papan Kemajuan | showroom, blinding-safe | demo codes 101–120 | demo users (isolated batch `DEMO`) | tour, leaderboard | seeded `sumber:'contoh'` data | generator determinism | D | never touches real accounts |
| Validation instruments | expert review | validator codes | `validasi-store` (separate) | scored sheets | no | server-side recomputation | R | isolated from participant data |
| Infra & evidence (cloudbuild, uji-hidup, smoke, backup, export) | operate + prove | CI/manual | `test_reports/` artifacts | deploy + live-AI evidence | proof harness | gates | P (ops) | CI gate = canonical tests |

**INFERENCE from the map:** the deterministic money kernel and the trust rails are the two genuinely well-engineered assets; the AI surfaces are consumers of the kernel, not sources of truth (by design, post-Sessions A–D); the curriculum is the largest single investment but is research-scoped; the demo/validation machinery is cleanly quarantined.

---

## 4. Product Core Classification

Classification criteria: recurring value, usage frequency, data accumulation quality, automation potential, compounding, compatibility with the trust architecture.

| Class | Capabilities | Rationale |
|---|---|---|
| **CORE** | Cashbook; deterministic metrics kernel + health score + timeline; Fokus Harian; KUR report + simulation; consent gate + data sovereignty | Daily/weekly loop, strongest data accumulation (transactions compound), all downstream value derives from them, fully compatible with the trust architecture |
| **SUPPORTING** | AI chat; recommendations; scan-nota; public kartu; auth/throttle; backup/export tooling; WhatsApp recap | Real value but currently shallow-loop (see §9); recommendations already carry sanitizer/provenance/staleness rails worth building on |
| **EXPERIMENTAL** | Checkup; latihan-AI; putar-ulang replay film; scan-nota tiering (0.85/0.60 unaudited) | Useful, display-only or lightly persisted; no outcome loop; tier thresholds have zero calibration evidence (VERIFIED FACT, AI-TRUST §2.6) |
| **RESEARCH-SPECIFIC** | Curriculum/day-gating/praktik (the treatment); B1/B2 batches; jejak event stream as instrument; validasi instruments; anonymized export | Load-bearing *for the study*; not candidates for deletion, but product evolution must not silently re-purpose them (consent scope) |
| **DEMO-SPECIFIC** | Demo-data generator (699 ln); Papan Kemajuan; onboarding tour | Quarantined by batch/flag; keep as-is |
| **DEPRECATED-CANDIDATE** | `backend/tests/test_novaro.py` (dead preview URL, pytest not in committed requirements — unrunnable); root `package.json` scripts (non-canonical duplicate of the test command); `memory/test_credentials.md` (committed validator code — security flag, BASELINE §8); the dead env names on the deployed revision (`VERTEX_LOCATION`, `USE_POSTGRES`, `AI_BACKEND`, `GEMINI_API_KEY` — read by zero code) | Evidence supports retirement *after owner review*; the mission forbids casual deletion, so these are candidates only. `sync.sh` (committed GitHub PAT, read-only, self-documented "revoke after contest") is a hygiene flag, not a feature |

No capability is classified DEPRECATED on product merit. The curriculum stays RESEARCH-SPECIFIC rather than CORE only because its gating model (7–14 day intervention) is instrument-shaped (VERIFIED FACT: server-enforced one-session-per-day, waitlist-control comments in `index.html`); its *content* overlaps the core heavily (prive, margin, cicilan modules are the core concepts' teachers).

---

## 5. Current Data and Domain Model

**The user record (VERIFIED FACT, `store.js:513-526`, `users.json` shape):**

```
user = {
  id, name, business, batch (B1|B2|DEMO|''), codeHash, createdAt,
  profile (+ profileHistory: append-only research baseline),
  mulaiPada,
  recommendations,   // SINGLE SLOT — latest only, overwritten (store.js:1205, 737)
  chat,              // capped ring buffer, 60 turns (store.js:758, 1013)
  transactions,      // append; DELETE = hard delete (transaction_deleted event; no void fields)
  progress,          // {done, praktik, latihan, checks}
  events,            // append-only, contentless, schema-registry-gated
  usage,             // cumulative {requests, inputTokens, outputTokens}
  consent,           // {versi: 3, agreedAt}
  latihanAI, tokenLog (14-day window)
}
```

Storage: single-writer JSON file with a cross-process file lock, multi-process write-merge, TTL caches, atomic flush discipline; Mongo and Postgres adapters exist behind a strict selector (`NOVA_STORAGE` > `DATABASE_URL` > Mongo env > JSON, pinned by `penyimpanan.test.js`). **The Postgres path has no behavioral tests** (selector-string tests only — VERIFIED FACT, test-suite audit). Deployed reality: JSON on ephemeral `/tmp/data` on Cloud Run `--max-instances=1` (VERIFIED FACT, cloudbuild.yaml:300).

**Answer to G3: Novaro is a deliberate hybrid** — closest to option **C** of the offered set, and this is not an accident:

- **CRUD accounting core for money**: the Transaction row is canonical for balances and every derived number; one validated mutator (`store.addTransaction`) with server-owned provenance (`origin` always `manual` today), requestId idempotency, actor contract, machines-never-write-income enforced at the mutator (all pinned by `mutasi-gerbang`/`mutasi-uang` tests — VERIFIED FACT).
- **Event-oriented discipline for history**: a contentless append-only research-event stream (~26 registered types in `jejak.js:52-89`) with a structural schema registry, a free-text ratchet (exactly 4 adjudicated fields), and anonymization that drops exactly the registered fields. Money events carry no amounts by design.
- **Fragmentation: low.** One store, one file, one user aggregate, one write path. The known vocabulary blemish (`transaction_added` singular/store vs `transactions_added` plural/demo, `jejak.js:83-88`) is registered and documented, not a boundary violation.

**What the model does NOT yet have (VERIFIED FACT — absence checks):** no void-and-restate (hard delete; no `voided/voidedAt/replacedBy` fields); no schema-version stamps (`featureVersions` absent); no `modal` category (7 categories, `cashbook.js:32-40` — owner capital injections in `lain-masuk` carry `laba:true`, the known modal=profit defect, FDM §1); no proposal lifecycle events (`proposal_shown`/`proposal_rejected` absent from the registry); no HMAC nota-origin token; **no advisory history** (recommendations single-slot, overwritten; chat evicted at 60 turns; checkup never persisted).

This absence list matches precisely the DECIDED-but-unbuilt milestones M0–M8 of `FINANCIAL-DATA-MODEL.md` and layers 3–6 of the B′ architecture in `AI-TRUST-AUTOPILOT-DECISION.md` (both documents: DECIDED, implementation not authorized). The trust prerequisites that Sessions A–E delivered are exactly B′ prerequisites 2, 4, 5, 8, 9, 11 of that document's §20 (VERIFIED FACT by test evidence); prerequisites 1, 3, 6, 7, 10, 12 remain open.

---

## 6. Architecture Diagnosis

**Strengths (VERIFIED FACT unless noted):**

1. **A real trust floor, not a claims document.** Single write gate with actor/origin/idempotency contracts; AI-as-untrusted-externality across all five surfaces (whitelist sanitizers, 502 fail-closed, budget pre-flight, provenance stamps, staleness windows); structural event-schema gate with a free-text ratchet; consent versioning enforced three ways; failure-injection suite asserting side-effect-free failures against disk truth; 535 tests re-verified green this session.
2. **A single-sourced deterministic kernel.** All money math in pure functions; ratios never AI-computed; thresholds imported, never re-declared (fokus-harian, simulasi-kur).
3. **Evidence-culture tooling.** `uji-hidup.js` produced the repo's only real deployed-runtime AI proof (chat on revision `novaexplorer-00097-2vt`, 2026-09-11); CI gate runs the canonical tests before build.
4. **Honest display discipline.** Estimate-vs-recorded badges, `contoh` vs AI labels, truncation markers, incomplete-month hatching, staleness windows — even marketing copy in HTML is contract-tested.

**Weaknesses / debts, severity-ordered (VERIFIED FACT each unless noted):**

1. **The AI layer has amnesia (see §9).** The product's differentiating layer cannot compound: recommendations are one overwritten slot; chat evicts at 60 turns; checkup vanishes; nothing records what was advised, on what numbers, whether the user acted, or whether it worked.
2. **Ledger temporal integrity is incomplete for an intelligence product.** Hard delete destroys history (the void-and-restate design exists on paper, M4, gated on consent — which v3 has since satisfied on its deletion-promise rider by disclosing retention-after-delete? — see OPEN QUESTIONS). Duplicates beyond requestId scope and backdated-window edges are handled, but correction semantics are destructive.
3. **Ephemeral production storage.** Deployed JSON on `/tmp/data` means any real participant data on Cloud Run is one instance recycle from loss. This is the known gating risk for the pilot (cloudbuild header says so itself).
4. **Unbuilt decided designs.** M0 (archive-first), M1 (schema stamps), M2 (ledger adapter), M3 (modal boundary), M4 (void-and-restate), M8 (T1 instrumentation) — designed, adjudicated, unimplemented. The repo now carries more decided architecture than built architecture.
5. **Known-open correctness findings:** E-1 (flush-throw leaves mutated cache — a 500-rejected write can land later), E-2 (transport-error 500 vs 502 misclassification eats rate-limit refunds), no application-level Gemini stream deadline (premature close resolves "successfully" with partial text, zero usage), the modal=profit defect reachable via scan-nota mapping.
6. **Store ceiling is a monitored, unsolved constraint.** Whole-file parse measured 571 ms @300 users; success literally slows the product. Deferred by design with triggers — but any feature that grows per-user bytes (an advisory history) must carry a trim policy.
7. **Deployment drift.** The live revision (Aug-31, non-repo pipeline) is internally inconsistent (`/api/checkup` 500: `analyzeCheckup is not defined`), carries dead env names, and a stale twin sits in `europe-north1`. Local `main` is consistent; the deployed bundle is not current.
8. **Two committed credentials** (`sync.sh` PAT, `memory/test_credentials.md` validator code) — hygiene flags already on record.

---

## 7. Existing Trust Architecture Assets

These are load-bearing assets; every recommendation in §10–§13 integrates with them explicitly (VERIFIED FACT — all pinned by named tests):

| Asset | Where pinned | Constraint it imposes on future work |
|---|---|---|
| Mutation gate (actor, origin server-owned, machines-never-write-income, requestId dedup) | `mutasi-gerbang`, `mutasi-uang` | Any new money-writing capability must go through the mutator; machines still write nothing; `origin` enum widening is a declared change |
| AI output sanitization (whitelist, caps, 502 fail-closed) | `rekomendasi`, `nota`, `checkup`, `latihan` | Any new persisted AI artifact needs its own sanitizer + shape tests before first write |
| Provenance stamps (`sumber`/`model`, no retrofit, no fabrication) | `identitas-ai` | New AI surfaces inherit stamping; old data is never back-filled |
| Staleness discipline (30-day window, fail-safe on bad timestamps) | `identitas-ai`, `fokus-harian` | Anything that re-surfaces stored advice needs an age window |
| Consent v3 (both processors named, 451 re-prompt, version-bound) | `perlindungan`, `identitas-ai`, `rute` | New data uses must be checked against the v3 text; expansions → v4 by decision, never silently |
| Event schema registry + free-text ratchet | `jejak` | New event types must register first; new free-text fields fail the structural test until adjudicated |
| Export filtering / anonymization | `ekspor-anonim` (runs the real script) | New persisted fields must decide their anonymized-export fate explicitly |
| Failure injection (nothing-persisted-on-failure, disk truth) | `kegagalan`, `ketahanan` | New write paths need failure-path tests asserting zero side effects |
| Budget & rate limiting (pre-flight, refunds, idempotent denials) | `anggaran`, `kegagalan` | New AI dispatchers need a budget class and a usage-shape contract test |
| Live-evidence ladder (per-method rungs; chat = proven once at L2) | `uji-hidup` artifacts | A new AI method exposed to users needs its own deployed-runtime rung before exposure (standing rule, AI-TRUST §18) |

**Rule adopted for this report:** any proposed feature that creates an AI-generated *financial* action must specify provenance, actor identity, deterministic validation boundary, persistence, failure behavior, and display truth. The §12 jump deliberately creates **no new financial action path** — it creates memory *about* advice, not new money writes — and therefore adds only provenance and event-registry obligations.

---

## 8. Candidate Moats Ranked

Ranking is Session G's judgment (DESIGN DECISION on ordering; the Foundation/Existence columns are VERIFIED FACT/INFERENCE as marked). Difficulty assumes one builder, local-first development.

| # | Candidate | Existing Foundation | Missing Pieces | Difficulty | Defensibility | Feature-Bloat Risk | Solo-Dev Suitability | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | **Decision & outcome feedback loop** (advice memory: what was advised, on what numbers, was it acted on, did it work) | Sanitized, provenance-stamped, staleness-windowed recommendation object; praktik/modul action events; pure metrics kernel for before/after; event registry ready for new types | Persistent advisory records (today: single overwritten slot); outcome checkpoints (pure month-boundary comparison); decision events; riwayat surface | Low–Med (additive lib + store array + 2 read routes + UI section) | **High** — compounds per business over time; requires the trust rails competitors won't bother building; no generic chatbot has it | Low — it deepens one existing loop rather than adding a feature family | **High** — pure functions + additive arrays; no cloud spend | **PURSUE (primary)** |
| 2 | **Financial event intelligence** (deterministic detectors + AI narration, fokus-harian generalized) | fokus-harian 10-rule engine; single-sourced kernel; `isMonthComplete` honesty discipline; checkup narration shape (zero model numerics) | More detectors (M6 read-models); detector output as first-class (persisted) objects; temporal sequence rules | Low–Med | Med — domain expertise encoded in rules is copyable but expensive to re-derive for warung economics | Med — detector lists grow; needs the first-match-wins discipline | High | **PURSUE (same program as #1)** |
| 3 | **Privacy/trust architecture as product** | The entire Session A–E floor (§7) | Nothing to build; make it *visible* (it already is: stamps, badges, consent UX) | — (sunk) | Real but not sufficient alone; it is a *multiplier* on every other moat | n/a | n/a | **AMPLIFY — already built; stop extending, start leaning on it** |
| 4 | **Indonesian micro-business specialization** (prive/cicilan/KUR/WIB/warung taxonomy/bahasa) | Entire product: categories, KUR report, curriculum, fokus rules, Indonesian copy | Depth in more verticals only on demand | Low incremental | High *locally* (global players won't localize this deep); low globally | Med — vertical sprawl | High | **AMPLIFY — cross-cutting; guides rule and module design** |
| 5 | **Receipt → transaction → insight pipeline** | scan-nota sanitizer + code-owned category map + tiers; image compression client-side | HMAC origin tokens (B′ prereq 6); Document persistence (storage + consent); capture-frequency loop into intelligence | Med | Med–High if capture becomes habitual (frequency driver) | Med | Med (needs L3 evidence rung before exposure grows) | **DEFER — valuable after #1/#2 land; needs its trust prereqs** |
| 6 | **Business-specific AI memory (conversational)** | 60-turn chat cap (bounded); server-built context projection | Long-lived memory store; retrieval; consent scope for retention | Med–High | Med alone; High merged into #1 (memory that *checks itself* beats memory that just persists) | High — "chat remembers" is a feature, not a loop | Med | **MERGE INTO #1 — memory earns its storage through outcomes** |
| 7 | **Explainable recommendations** | Sanitizer + provenance + staleness + "dihitung sistem" labeling already shipped | Outcome join (→#1); per-item rationale grounded in kernel numbers (partially exists via `alasan` berangka in fokus) | Low (as part of #1) | Med | Low | High | **MERGED INTO #1** |
| 8 | **Automation workflows (T1 propose→confirm)** | Decided B′ architecture; hardened mutator; scan-nota as first proposal surface; requestId dedup | Prereq 12 (named second proposal surface + user story); HMAC jti; proposal events; per-method L3 evidence | Med–High | Med (time-saving moats erode; audit moats persist) | **High** — this is where feature bloat historically enters | Med — well-specified but wide | **DEFER — trust-gated by the repo's own decision record; revisit after #1 generates the decision data that would justify surface #2** |
| 9 | **Cross-business benchmarks** | Papan (demo-only), batch structure, export tooling, cohort design | Consented cohort at scale; statistical machinery; consent scope for comparative use; privacy-safe aggregation | High | Med–High with network effects — but zero users today means zero network | High (premature = fake numbers = trust destruction) | Low now | **DEFER — the repo's own trigger (FOUNDATION §8.3) is unmet** |
| 10 | **Temporal anomaly detection** | Kernel time-series (timeline, perubahan); 30-day staleness pattern | Detector library (→#2); more history per business (blocked partly by hard delete, → M4) | Med | Low standalone at single-business scale; subsumed by #2 | Low | High | **SUBSUMED by #2** |
| 11 | **Semi-enterprise financial operations** | None | Everything (multi-entity, roles, controls, integrations) | Very High | — | Total | None | **REJECT — no foundation, wrong product, contradicts decided B+ core** |

**Reading of the table (INFERENCE):** the two highest-ranked moats are the same program viewed from two sides — #1 is the memory/loop, #2 is the deterministic brain that feeds it — and both are *additive to the existing architecture*, local-buildable, and trust-rail-compatible. Everything else either amplifies what exists (#3, #4) or is correctly gated by the repo's own decision records (#5, #8, #9).

---

## 9. The Single Biggest Bottleneck

**The advisory layer has no memory and no outcome connection — Novaro cannot get from "accounting app with AI features" to "financial intelligence system" because its intelligence evaporates.**

Evidence (VERIFIED FACT):

- `user.recommendations` is a single overwritten slot (`store.js:1205-1206`; regeneration replaces the object; `store.js:737` nulls it on profile save). Yesterday's advice, the numbers it was based on, and what happened next are unrecoverable.
- Chat is a 60-turn capped buffer (`store.js:758,1013`) — old context evicted.
- Checkup is never persisted (pinned by `checkup.test.js:121`).
- Fokus rule 7 may only re-surface the *first warning* of the latest recommendation, and only within 30 days (`fokus-harian.js:50,192-194`) — an honest staleness guard on top of an object with no history.
- The only "did the user act" signal that exists is indirect: `praktik_terverifikasi` events (server-verified learning actions) and transaction rows. Nothing joins advice → action → outcome.

Why this is the bottleneck rather than the other candidates:

- It blocks the *product* rung, not just a feature: without an advisory history there is no accountability ("did Novaro's advice help?"), no personalization (the next recommendation cannot know what was already tried), no calibration signal (the repo's own T1 gate wants decision data that nothing currently records), and no compounding asset — the one thing a moat requires.
- The ledger-side gaps (hard delete, no schema stamps) matter chiefly *because* intelligence wants trustworthy temporal data; they are prerequisites-in-part, and ride the same program (§13).
- The trust phase is complete enough (535 green, all five AI surfaces fenced) that extending it further now would repeat finished work — the exact anti-pattern the mission brief warns against.

**INFERENCE on timing:** every dependency this bottleneck needs was delivered by Sessions A–D — sanitized outputs worth remembering, provenance worth trusting, staleness windows worth respecting, an event registry ready to register decision events. The bottleneck became the *next* bottleneck precisely because the trust floor landed. That is strong evidence it is the right next target.

---

## 10. Three Possible Futures

### Path A — Conservative evolution: "Finish the decided foundation"

1. **Product thesis:** Novaro becomes a *durable, deployable pilot*: the decided-but-unbuilt integrity work lands, production storage becomes real, and every AI method has deployed-runtime evidence. No new user-facing capability.
2. **Core architecture change:** implement M0 (archive-first + manifest tooling), M1 (schema stamps + `feature_enabled`), fix E-1/E-2, add the Gemini stream deadline, move deployed storage off `/tmp/data` (attached disk or the (untested) Postgres path made tested), redeploy, run `uji-hidup` per method rung (incl. the broken checkup route).
3. **Major new capability:** none user-facing; operator-facing evidence and durability.
4. **Reused:** everything; nothing new is invented.
5. **Untouched:** product surfaces, AI scope, consent.
6. **Complexity:** low–medium; mostly ops + careful additive store work.
7. **Technical risks:** Postgres path is untested (behavioral suite required first); consent interplay if void-and-restate (M4) is pulled forward; redeploy changes the live revision (per F: rerun uji-hidup, never cite old artifacts).
8. **Feature-bloat risk:** none — this path's risk is the opposite: it defers all product differentiation.
9. **Moat potential:** indirect (durability and evidence raise trust, which multiplies other moats) but creates no new compounding asset.

### Path B — High-upside product transformation: "Advisory memory & the outcome loop"

1. **Product thesis:** *the AI remembers what it told you and checks whether it came true.* Advice becomes a persistent, accountable, compounding record per business — Novaro's advice gets a track record, per user, that no generic tool can replicate.
2. **Core architecture change:** recommendations (and later checkups) upgrade from an overwritten slot to an append-only, trim-policy-capped **advisory record**; deterministic **outcome checkpoints** compare the numbers at advice-time vs. a later month using the existing kernel; decision/act signals reuse the existing event registry; a "Riwayat Saran" surface makes the track record visible.
3. **Major new capability:** the outcome loop (advised → acted → measured), plus 2–3 new fokus-style deterministic detectors to feed it (M6 read-models).
4. **Reused:** sanitizer + provenance + staleness rails as-is; kernel as the sole number source; jejak registry for new contentless events; budget/rate-limit machinery; praktik/modul events as the action signal; existing frontend patterns (stamps, badges).
5. **Untouched:** money mutator semantics (zero new financial write paths); consent mechanics (v3 stays; any scope expansion is a v4 decision, flagged); curriculum; demo machinery; infra.
6. **Complexity:** medium — 2–3 sessions of additive lib/store/route/UI work with tests; no cloud spend.
7. **Technical risks:** store growth (mitigated by mandatory trim policy); outcome evaluation misread (mitigated: deterministic, `tak-terukur` fail-safe, system-labeled); consent scope question for longitudinal comparison (flagged as OPEN QUESTION, not silently resolved); frontend is the untested 4.4k-line SPA (new section kept small and stamped).
8. **Feature-bloat risk:** low–medium — the loop is one deepened existing loop; discipline rule: no new AI surface, no new number source.
9. **Moat potential:** highest of the three (candidate #1 + #2 combined; per-business compounding; trust-rail-dependent — a competitor must rebuild the trust floor to copy it honestly).

### Path C — Technically ambitious, still solo-realistic: "Novaro as a scheduled financial intelligence service"

1. **Product thesis:** Novaro stops being only something you open and becomes something that *arrives*: a weekly intelligence digest generated on schedule, delivered where warung owners already are (WhatsApp/link), over an event-backboned core with full history (void-and-restate, hybrid event log), plus consented cohort benchmarks.
2. **Core architecture change:** persistent storage (Postgres path tested + adopted); M2 ledger adapter + M4 void-and-restate; hybrid full-payload financial event log with fold-parity (FDM §0's recorded design); a scheduler substrate (Cloud Scheduler → authenticated job endpoint) for unattended generation (T2-adjacent); outbound delivery channel; cohort benchmarking job.
3. **Major new capability:** proactive weekly digest + benchmarks + true correction history.
4. **Reused:** kernel, sanitizers, budget, consent, registry — as in B, plus everything from B as a subset.
5. **Untouched:** nothing, realistically — deployment shape, storage backend, and deletion semantics all change.
6. **Complexity:** high — spans storage migration (with zero behavioral tests today), an event-log cutover that FDM explicitly deferred until "the first real consumer", a new substrate on a scale-to-zero deployment, and a consent expansion.
7. **Technical risks:** storage migration over live research data; event-log dual-canonicality bugs; scheduler on `--max-instances=1` scale-to-zero; delivery channel consent; benchmark privacy; the largest test-surface growth.
8. **Feature-bloat risk:** high — three major programs in one path.
9. **Moat potential:** high in principle (proactive intelligence + network data), but several components contradict the repo's own adjudicated deferrals, and the sequencing risk to the live research cohort is real.

---

## 11. Recommended Direction

**RECOMMENDATION: Path B — Advisory memory & the outcome loop.**

Why B and not A now:

- A is real and partially *absorbed* by B anyway: B's first session touches `store.js` and `rekomendasi.js`, where E-1 lands naturally, and introduces the first new persisted shape, where M1 schema stamps earn their keep. The genuinely A-only remainder (storage move, redeploy, per-method L3 rungs) is **operator work requiring cloud spend and deploy authorization** — excluded from this session's constraints and better executed as its own ops session after the product direction is set. A alone answers the mission's strategic question with "no new leverage".
- A's most product-relevant item (void-and-restate, M4) is a one-way door gated on its own consent-review checklist; folding it into a product jump would couple two risky changes. It stays on the roadmap, sequenced after B's additive work or in parallel by explicit owner decision.

Why B and not C now:

- C's event-log cutover violates the repo's own ruling (FDM §0: deferred until the first real consumer — which B's outcome loop *then becomes*, making C cheaper *after* B); its storage move is untested today; its scheduler substrate is architecturally absent on scale-to-zero; its benchmarks trigger (a consented cohort) is unmet. C is best understood as **B + the storage/event/substrate milestones, sequenced later** — not an alternative to B.
- Constraint fit: B requires no Cloud Run spending, no deploy, no new substrate; it is incremental, floor-preserving, and sized for a solo builder with the existing test conventions.

Why B serves the strategic ladder honestly:

- It implements the *intelligence* rung on the transaction-centric core that the repo already adopted, without re-opening the event-storage question.
- It converts the trust architecture from a cost center into the moat itself: accountable advice is only buildable *on top of* provenance, sanitization, staleness, and consent — the assets Sessions A–F just finished paying for.
- It avoids the "generic AI accounting chatbot" fate: the differentiator is not a model, it is the per-business, longitudinally-checked advisory record — data that compounds and cannot be prompted into existence.

**Direction challenge (as the mission requires):** the four-rung ladder is **supported with one amendment** — rung 2 ("financial event system") should be understood as *already achieved in its adjudicated form* (rows canonical + contentless event stream + provenance), and must not be re-attempted as event-sourced storage. The genuine gap is rung 3, and specifically its *memory* half, which no prior session covered.

---

## 12. Proposed Next Major Architecture Jump

**The Advisory Memory & Outcome Loop ("Saran yang Beringat") — concrete design. No implementation code; DECISION proposal only.**

### New conceptual domain model (all additive to the existing user record)

```
advisori (Advisory Record) — appended, never edited, trim-capped:
  id                'adv_' + server-generated hex (same discipline as trx_)
  jenis             closed vocab: 'rekomendasi' | 'checkup'          (DESIGN DECISION: start with these two)
  dibuat            ISO timestamp (WIB discipline as elsewhere)
  model             string|null   — provenance, Session D pattern; absent when sistem-generated
  sumber            'ai' | 'sistem'                    — never fabricated (identitas-ai rule)
  dasarAngka        digest of the metrics context used (month keys + a content hash),
                    NOT a stored copy of the numbers — numbers stay recomputable (kernel is pure)
  isi               sanitized payload — EXACTLY the existing whitelists:
                      rekomendasi: ringkasan, peringatan, ≤5 items (6 fields each) — reuse sanitasiRekomendasi verbatim
                      checkup: sanitasiCheckup output (never persisted today; persistence is new, sanitizer unchanged)
  berlakuHingga     dibuat + 30 days (UMUR_MAKS_PERINGATAN_HARI discipline, generalized per jenis)
  status            derived, not stored: aktif | kedaluwarsa | digantikan (newer same-jenis advisory)

evaluasi (Outcome Checkpoint) — appended per advisory when its checkpoint fires:
  advisoriId        join
  dinilaiAt         timestamp
  periodeDasar vs periodeKini   month identifiers
  perItem           [{ indeks, status: 'membaik'|'tetap'|'memburuk'|'tak-terukur' }]
  metode            'komparsi-bulan' (closed vocab — the single deterministic method v1)
```

### Boundaries

- **AI responsibilities (unchanged in kind):** generate `isi` prose/priorities, subject to the existing sanitizers, budget classes, and provenance stamping; optionally *narrate* an outcome in checkup style (zero numeric fields from the model — numbers are quoted by the server from the kernel, "dihitung sistem"). **No new AI surface is created.**
- **Deterministic responsibilities:** all outcomes. `evaluasiAdvisori(advisori, metricsKini)` is a pure function over `computeMetrics` output; thresholds borrowed from existing constants, never new numbers (fokus-harian discipline); any missing/unparseable input yields `tak-terukur` — fail-safe, mirroring `umurRekomendasiHari`.
- **Action signal (v1, zero new writes):** "acted on" is *derived*, not stored: an advisory whose `modulTerkait` has a later `praktik_terverifikasi`/`latihan_dijawab` event, or whose target month shows kernel movement on the referenced dimension, is presented as "ada tindak lanjut tercatat" — honestly hedged wording, because derivation is correlational. (A stored explicit user tap is a v2 DESIGN DECISION, not assumed.)

### State transitions

Advisory: `dibuat → tampil → (derived: ada-tindakan | tanpa-tindakan) → {evaluasi appended | kedaluwarsa | digantikan}`. There is **no state machine and no stored mutable status** — everything terminal is an appended checkpoint or derived (respects the D rejection in AI-TRUST §10; no sweeps; abandonment is a documented convention, not a state).

### Persistence implications

- New arrays `advisori[]`, `evaluasiAdvisori[]` on the user record — additive, absorbed by JSON/Mongo/Postgres shapes without DDL (JSONB spread-back precedent, FDM §6).
- **Mandatory trim policy (stop-ship rule inherited from AI-TRUST §21.8):** cap per `jenis` (e.g., 24 advisories + their evaluations), trim oldest-first at write; pinned by test. Without this, the single-file store ceiling is needlessly accelerated.
- Legacy compatibility: `user.recommendations` **remains exactly as today** (latest-slot read model, written through so every existing consumer — `/api/me`, fokus rule 7, kartu — is untouched); `advisori[]` is the new append-only history. Old users with no `advisori[]`: the riwayat surface shows "belum ada riwayat" — never fabricated.

### Provenance & event implications

- New registered event types (contentless, closed vocab, riding `jejak.js` + the free-text ratchet): `advisori_dibuat {id, jenis, sumber}`, `evaluasi_advisori {id, metode}`. No amounts, no free text — the structural test enforces this automatically.
- Display truth: every riwayat item carries the existing stamp vocabulary (`sumber`, `model`, age) plus outcome lines labeled "dihitung sistem dari angka buku kas"; AI-narrated outcome text (if built) is separately stamped and never carries model-computed numbers.
- **Provenance requirements for the one AI-to-data touchpoint (outcome narration):** sanitized, budgeted, provenance-stamped, never persisted as numbers, failure = no narration (display-only degradation, R6).
- **Actor identity:** advisories are not money mutations; no actor needed. If T1 proposals ever land, `advisoriId` can join `proposalId` — no schema conflict.

### Failure behavior

Generation failure → nothing appended (existing 502 fail-closed paths reused verbatim). Checkpoint computation failure → `tak-terukur` item, checkpoint still appended with honest status (so absence of an outcome is itself visible, not silent). Storage failure mid-append → covered by the existing flush/failure-injection contract (and E-1's fix, proposed as a rider in Session H).

### Backward compatibility

GET shapes gain additive fields only; `recommendations` slot consumers unchanged; export gains advisory tables with the same anonymize discipline (free-text whitelist unchanged → advisory prose is excluded from anonymized export by the existing rule that only registered fields export); consent: v3's existing disclosure that data is sent to AI covers `isi` generation; **whether longitudinal outcome comparison needs a v4 disclosure is an explicit OPEN QUESTION** (§15) — v1 ships outcome *computation* only on data already collected, and surfaces it only to the user herself, which the current text's download/erase framing appears to cover; this must be confirmed, not assumed.

---

## 13. Proposed Implementation Program

Three sessions, **strictly sequential** (I depends on H's store/lib work; J depends on both). The 3-parallel-builder cap is respected (never more than one builder active at a time in this program; the shared working tree hazard documented in prior sessions makes same-file parallelism unsafe). Each session is independently executable, floor-preserving, and ends in exactly one commit.

### SESSION H — "Advisory record: additive memory with provenance"

- **MISSION:** introduce `advisori[]` + trim policy + write-through from the existing recommendation path (and checkup persistence under its sanitizer); register `advisori_dibuat`; pure `evaluasiAdvisori()` function (no routes yet); fix E-1 (flush-throw cache divergence — same file, owner-acknowledged finding) and add the M1-lite `featureVersions` stamp set-if-absent (first new persisted shape makes it load-bearing).
- **OWNED FILE AREAS:** `server/lib/store.js` (additive), `server/lib/rekomendasi.js`, `server/lib/checkup.js`, new `server/lib/advisori.js`, `server/lib/jejak.js` (registrations only), new test files.
- **FORBIDDEN FILE AREAS:** `server/public/**`, `server.js` (except the minimal write-through call sites if unavoidable — prefer store-internal), `server/scripts/**`, `cloudbuild.yaml`, `backend/**`, `frontend/**`, consent text.
- **DEPENDENCIES:** none beyond current HEAD (`2ad3ea7`).
- **TEST GATES:** canonical floor green (535 + new); no-retrofit tests (old users untouched); trim policy pinned; contentless event meta pinned by the structural suite; failure-injection: nothing appended on provider/storage failure (disk-truth assertions); E-1 regression test.
- **COMMIT BOUNDARY:** one commit: `session-h: advisory record (additive, sanitized, event-registered, trim-capped) + E-1 fix + featureVersion stamps`.

### SESSION I — "Outcome checkpoints & the Riwayat surface"

- **MONTHLY CHECKPOINT WIRING + INTELLIGENCE:** evaluate open advisories on month rollover detection at read time (no scheduler — read-time evaluation on `/api/advisori/riwayat` and `/api/fokus`, keeping the no-substrate constraint); 2–3 new fokus-style deterministic detectors feeding advisory generation contexts; new `GET /api/advisori/riwayat` (read-only, additive fields only); frontend "Riwayat Saran" section on the Rekomendasi page using existing stamp/badge patterns.
- **OWNED FILE AREAS:** `server/lib/advisori.js`, new `server/lib/deteksi.js`, `server.js` (new read routes + read-time evaluation hook only), `server/public/index.html` (one new section), new/extended tests.
- **FORBIDDEN FILE AREAS:** money mutator semantics, `server/lib/claude.js`/`gemini.js`, storage backends (`db.js`/`store.js` internals beyond consuming H's API), `server/scripts/**`, consent text, curriculum.
- **DEPENDENCIES:** Session H merged and floor-verified.
- **TEST GATES:** floor green; outcome function property tests (deterministic, fail-safe `tak-terukur`, thresholds imported not re-declared); route tests (auth + consent gating on the new GET); HTML claims honesty test extended (no unlabeled AI text); month-boundary edge tests (WIB).
- **COMMIT BOUNDARY:** one commit: `session-i: outcome checkpoints, riwayat surface, deterministic detectors`.

### SESSION J — "Decision instrumentation & evidence continuity"

- **MISSION:** decision/act instrumentation per B′ layer 3: `evaluasi_advisori` event emission riding existing writes; explicit advisory lifecycle stamps in the riwayat + fokus surfaces; extend `scripts/export.js` with advisory/evaluation tables (anonymize-safe, whitelist discipline); extend `scripts/uji-hidup.js` with a `--ai-route rekomendasi` rung (prepared; **executed only by the operator on a real deploy** — no cloud action from builder sessions); update `BASELINE.md` floor number (446 → current) as documentation repair.
- **OWNED FILE AREAS:** `server.js` (event emission riders on existing recommendation/checkup routes), `server/lib/jejak.js`, `server/scripts/export.js`, `server/scripts/uji-hidup.js`, `BASELINE.md`, tests.
- **FORBIDDEN FILE AREAS:** `server/lib/store.js` internals, money mutator semantics, `server/public/**` (beyond nothing — I owns the UI), consent text (any v4 question goes to the owner, §15), storage backends, `cloudbuild.yaml`.
- **DEPENDENCIES:** Session I merged.
- **TEST GATES:** floor green; `jejak` structural suite (new events registered, amount-blind); `ekspor-anonim` green with the new tables; uji-hidup helper unit tests (the existing `uji-hidup.test.js` pattern — no live calls in CI).
- **COMMIT BOUNDARY:** one commit: `session-j: advisory decision instrumentation, export tables, evidence rung prep, baseline doc repair`.

---

## 14. Things Explicitly Not Recommended Yet

All items below are **not recommended now**, each with its governing reason (classification inline):

1. **Event-sourced storage / full-payload financial event log** — rejected-for-now by FINANCIAL-DATA-MODEL §0; revisit only when B's outcome loop or an audit consumer needs replay (VERIFIED FACT — decided record; DESIGN DECISION to respect it).
2. **Void-and-restate (M4)** — right design, wrong pairing with a product jump; one-way door gated on its own consent checklist. Sequence it as its own session after H–J or by explicit owner go-ahead (DESIGN DECISION).
3. **T1 automation generalization (second proposal surface, HMAC jti, proposal events)** — gated by the repo's own prerequisite 12 (AI-TRUST §20) and per-method L3 evidence; revisit when advisory decision data (from B) exists to justify the surface (VERIFIED FACT — gate; INFERENCE — revisit condition).
4. **T2 scheduled/unattended execution** — architecturally absent on scale-to-zero; requires the §8.4 substrate gates (VERIFIED FACT).
5. **T3 unattended financial operations** — forbidden outright by the decided record (VERIFIED FACT).
6. **Cross-business benchmarks / cohort intelligence** — trigger unmet (no consented cohort instrument; consent scope for comparative use unresolved) (VERIFIED FACT — trigger; OPEN QUESTION — consent scope).
7. **Vector database, embeddings, RAG** — no retrieval problem is evidenced; context is small, structured, and server-computed; adding retrieval infrastructure would be architecture tourism (INFERENCE from prompt sizes and context-building code).
8. **Postgres migration as a product step** — storage backend choice is an ops/durability decision with zero behavioral tests today; belongs to the Path-A ops session, not the product jump (VERIFIED FACT — test gap).
9. **New AI surfaces (voice, photo-of-books, forecasting, multi-model fallback)** — each would require budget class, sanitizer, provenance, consent review, and a live-evidence rung before exposure; none has a data/control loop specified (repo's own standing rule, AI-TRUST §18/§14 R7).
10. **Frontend framework rewrite** — the 4.4k-line zero-test SPA is the riskiest asset, but a rewrite mid-cohort trades a known liability for a migration; the stamp/badge patterns are working (DESIGN DECISION to defer).
11. **Microservices / Kubernetes / queue infrastructure** — solo builder, single-writer store, scale-to-zero; contradicts every scale reality in the repo (VERIFIED FACT — deployment shape).
12. **Deleting the curriculum, demo mode, or research instruments** — they are the study's load-bearing structure; RESEARCH-SPECIFIC ≠ deprecated (DESIGN DECISION per mission constraint).

---

## 15. Open Questions

| # | Question | Classification | Notes |
|---|---|---|---|
| 1 | Does longitudinal outcome comparison (advisory → later-month metrics) require consent v4, or is v3's current text sufficient because outcomes are computed on already-collected data and shown only to the user? | **OPEN QUESTION** (leaning sufficient — INFERENCE from v3's send-to-AI and data-sovereignty disclosures, `consent.js:52-69`; not resolved here) | Owner decision before Session I's surface ships |
| 2 | Consent v3 promised "benar-benar dihapus" while FDM M4 changes delete→void-and-restate. Is M4 now unblocked, or does M4 need v4? | **OPEN QUESTION** (VERIFIED FACT: the tension exists — FDM invariant 22 vs `consent.js:73-75`) | Owner decision; affects sequencing of §14 item 2 |
| 3 | Should the deprecated-candidate list (backend/ pytest, root scripts, dead envs, committed credentials) be actioned? | **DESIGN DECISION** for the owner | Session G read-only; evidence in §4 |
| 4 | Which session owns the Path-A ops remainder (storage move, redeploy, per-method uji-hidup rungs, checkup-route fix on the deployed bundle)? | **DESIGN DECISION** | Recommended as a separate ops session after H (or parallel, disjoint files) |
| 5 | Is the "acted on" derivation (events/kernel correlation) honest enough for v1 wording, or should an explicit user tap be recorded from the start? | **DESIGN DECISION** (Session I scope) | Derivation chosen for v1 to avoid new write paths; wording must stay hedged |
| 6 | Trim policy caps (24 per jenis?) — right number for the store ceiling vs. research value? | **ASSUMPTION** in §12 (bounded by measured 571 ms @300-user parse; no measurement of advisory sizes yet) | Validate in Session H with size estimates |
| 7 | Checkup persistence: does persisting today-display-only output change its research/export sensitivity? | **OPEN QUESTION** | Sanitizer unchanged; export whitelist unchanged; confirm with owner before Session H includes checkup |
| 8 | Exact count discrepancy: `jejak.js` registers 26 event types; the structural test is described in the suite audit as pinning 25 — the pinned-count claim should be re-derived from the test's sorted-equality string before any registry work. | **VERIFIED FACT** (discrepancy exists as a description-level issue) / **OPEN QUESTION** (which number is canonical) | Trivial; resolve during Session H's first registry touch |
| 9 | Do the demo twin vocabularies (`transaction_added` vs `transactions_added`) get unified before advisories land? | **TERTUTUP 2026-09-13 (sesi G lanjutan, mandat owner)** — demo kini memancarkan `transaction_added` per baris dengan meta bentuk sama dengan store; nama jamak DIHAPUS dari registri (declared change, pin diperbarui sadar). Dokumen historis (PHASE-0 §9.2, SESSION-C) tetap sebagai catatan bertanggal. | Advisory events tidak pernah bergantung padanya; kini kosakata jejak satu sumber |

> **KEPUTUSAN OWNER — direkam 2026-09-12, sesi G fase 2.** Q1 diputuskan: consent v3 **mencakup** evaluasi yang dihitung dari data yang sudah dikumpulkan dan hanya ditampilkan ke peserta sendiri; pemakaian komparatif antar-usaha tetap membutuhkan consent v4 di masa depan. Q8 tertutup di tempatnya: hitungan pin `jejak.test.js` adalah jumlah *emisi* skenario, bukan jumlah *registri* `SKEMA_JEJAK` (lihat komentar pin yang diperbarui sejak `session-g1`).

> **KEPUTUSAN OWNER — direkam 2026-09-13, sesi G lanjutan.** Q7 diputuskan **YA**: output checkup di-persist sebagai advisori jenis 'checkup' — sanitizer tak berubah, trim per jenis tetap berlaku, provenansi sumber+model pola Sesi D, persist HANYA sebagai advisori (nol tulisan uang — pin pembukuan tak berubah), dan prosanya otomatis keluar dari ekspor anonim lewat aturan whitelist yang ada (ter-pin di `ekspor-anonim`). Pin lama "output checkup tidak pernah persist" diganti secara sadar menjadi "persist HANYA sebagai advisori, tidak ke tempat lain". Tindak lanjut tercatat: evaluasi checkpoint tetap khusus 'rekomendasi' (checkup belum punya metode penilaian bulanan — tidak dipaksa); komentar basi "hasil check-up tidak pernah disimpan" di `fokus-harian.js` (komentar aturan 7 — perilakunya tetap benar, ia membaca slot rekomendasi) menyusul pada giliran pemiliknya.

---

**END OF REPORT** — Session G produced this file only. No source modified, no commits, no pushes, no deploys, no cloud spend. Per the mission: STOP here; Sessions H–J are proposals, not authorizations.
