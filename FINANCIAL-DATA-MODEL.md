# Novaro AI V3 — Canonical Financial Data Model

**Status:** DECIDED DESIGN — no implementation authorized. **Date:** 2026-09-08.
**Evidence base:** baseline `5d60203`, `FOUNDATION-DECISION.md` (B+ adopted), `ARCHAEOLOGY.md`, 6 domain investigations (data, accounting, architecture, AI, testing, adversarial-YAGNI) + 3 adversarial design reviews (complexity/completeness, correctness, migration). Labels: FACT (code-verified, cited) / ASSUMPTION / INFERENCE / RECOMMENDATION.

**Process note:** two design reviewers were rate-limited on first dispatch and re-run after the window reset; all attacks below were executed against the amended draft, and every accepted amendment is folded into this record.

---

## 0. Domain-model comparison — verdict

| Model | Verdict | Why |
|---|---|---|
| **TRANSACTION-CENTRIC** | **ADOPTED** as the canonical storage/balance model — V2 rows generalized with additive provenance | The entire tested math kernel (summarizeMonth → metrics → KUR), the 446-test floor, and all pre-V3 history are defined over rows. Zero read-path change; every rider lands additively. |
| **EVENT-CENTRIC** (event log as canonical storage) | REJECTED as storage; its **history discipline absorbed** | Fold-everything reads on a whole-file store (571 ms @300 users) with a single consumer monolith pays event-sourcing costs for none of its benefits. The existing contentless research-event stream + kept-voided rows + `origin` provenance deliver the auditability the model needs. |
| **LEDGER-CENTRIC** (double-entry) | REJECTED (matches brief constraint) | No required capability needs balance-checking postings; prive-as-equity is already captured by the `laba:false` flag at ~1% of the machinery; pedagogy explicitly rejects debit/kredit/journal. Escalation triggers (named): books split across stores; machine writes at T2 volume needing balance self-healing; a bank integration demanding balancing proofs. |
| **HYBRID** (rows materialized + typed full-payload financial events, same mutator, rebuild-parity) | **DESIGNED, DEFERRED** until the first real consumer (counterfactual replay over history, or Autopilot audit replay) | Cuts ratified by adversarial review: zero consumers today; the Twin as designed (params over current rows) never needs a historical log; a second never-trimmed array accelerates the store ceiling. Arrives as a same-mutator addition — never a cutover. Dual-canonicality design (rows = balances, events = history, `fold(events) === rows` post-stamp, DEMO/pre-stamp exempt) is recorded for that day. |

**Canonical concepts:** the **Transaction row** is canonical for balances and money math; the **contentless ResearchEvent stream** is canonical for behavior/history-of-record (kept-voided rows make the ledger state at any past instant T reconstructible: `{rows : createdAt ≤ T ∧ (¬voided ∨ voidedAt > T)}` — this reconstruction property is stated as an invariant and is what makes the full-payload event log deferrable without loss).

**Concept adjudication (required-by-capability test):**

| Concept | Verdict | Concrete capability / trigger |
|---|---|---|
| Transaction | ADOPT NOW | Every capability; all segments |
| `origin` provenance (row + event meta) | ADOPT NOW | Provenance-before-automation (irreversible rider); Autopilot T1; research segmentation |
| ResearchEvent vocabulary extensions | ADOPT NOW | Correction events, proposal lifecycle (T1), feature_enabled cutovers |
| Category (`modal` widening, laba:false) | ADOPT NOW | Boundary semantics + live modal=profit defect (nota.js:48, cashbook.js:33) |
| SchemaStamp (`featureVersions` per user) | ADOPT NOW | Schema-versioning rider; research cutover metadata |
| Prive budget read-model | ADOPT (M5) | Prive-enrichment layer; computed, nothing stored |
| CorrectionChain (void-and-restate) | ADOPT (M4, behind M2 adapter) | Historical accuracy + correction (mission requirements); live delete-loses-amount defect (store.js:788) |
| ledger.js read adapter | ADOPT (M2) | Single choke point: void filtering + scope defaults + future book views |
| Book / `books{}` N-array pattern | DEFER → §8.2 personal-satellite trigger | First instance = `personal[]`; aggregators stay array-param pure; re-signature = declared core change |
| TransferLink (transferId paired legs) | DEFER → satellite | The transfer is the one unrepresentable row today; same-file linked pair, atomic, paired void |
| RecurringSeries | DEFER → T2 (substrate) | Occurrence keys = transaction ids; month-end clamp (`clamped:true`); T1 = read-time detection, never auto-materializes |
| Rule (stored) | DEFER → T2 or user-authored rules | T1 rules are read-time detectors emitting proposals |
| PiutangEntry (invoice as register) | DEFER → pilot demand; `shape pinned now` (below) | Cash-basis preserved: settlements are ordinary masuk rows |
| Document (receipt/invoice files) | DEFER → storage + consent v3 + recall demand; capture-time metadata (sha256 + extracted + notaRef) adopted at scan milestone | "AI ate my receipt" audit; images never in users.json |
| Liability register (OwnerLoan) | DEFER → outstanding-balance feature | Shape: principal + linked cicilan payments (pokok/bunga split); enriches, never bypasses, `max(profile, records)` |
| Proposal entity | DEFER → user-authored rules | Until then lifecycle is event-borne (`proposal.shown` / `proposal.decided` + delta) |
| ScenarioParams store | DEFER → "saved scenarios" feature | Params-never-results is a rule, not a storage requirement today |
| Report inputs digest | DEFER → report-verification feature | Reconstruction property (§2) substitutes meanwhile |
| FinancialEvent full-payload log | DEFER → replay/audit consumer | Hybrid design recorded (§0) |
| FinancialState (stored) | REJECTED | Pure compute + TTL caches; stored derived numbers reopen the setara-exclusion hole |
| Counterparty, stored Entity objects, chart of accounts, Period/closing, TaxLine, open taxonomy, SharedMembership | REJECTED | No concrete capability; resurrection triggers documented (consent §8.5 for shared; bank-integration for GL; regulatory for tax) |

**Segments:** business + hybrid are the evidenced segments and are fully served now. Personal/multi-entity are reserved seams (books pattern); freelancer = `jasa` users served by the piutang shape when triggered; creator fee-splitting is pinned (gross `masuk` row + fee `keluar` row linked to the payout id, both human-confirmed — omzet stays gross, net reconciles). No entity is bought for a segment that has no user.

---

## 1. Deliverable 1 — Canonical domain model (entity definitions)

### 1.1 Transaction — *canonical record of money movement*
- **Purpose:** the single canonical fact of money moved in one book; basis of every derived number, report, and score.
- **Ownership:** exactly one user (access-code identity); one book (implicit by containing array until books{} ships).
- **Lifecycle:** created once through the single validated mutator → immutable (no update path exists; none may be added) → optionally voided (kept, flagged) → replacement linked via `replacedBy`. Post-M4 never hard-deleted (pre-M4 hard deletes = documented loss window).
- **Relationships:** Category (enum); CorrectionChain (voided/replacedBy); deferred: transferId pair, piutangId, notaRef→Document, scope/book.
- **Fields:** V2 shape `{id, tanggal, jenis, kategori, keterangan ≤120, jumlah (0,1e12], createdAt}` + `origin` (manual|nota|rule|transfer; server-assigned) + reserved-unbuilt: `transferId, scope, piutangId, notaRef, voided, voidedAt, voidReason, replacedBy`.
- **Invariants:** voided rows excluded from every aggregation and from the reliability gate, filtered before `hariTercatat`'s Set; unknown `jenis` skipped+counted (`barisDiabaikan`); additive fields reach the client raw (GET returns rows verbatim) so each is chosen deliberately.
- **Validation:** existing route whitelist; `origin`/`voided*`/`replacedBy`/`piutangId` assigned **only inside store mutators** — never from request bodies (route test asserts body-supplied values are ignored; a forged `origin:'rule'` is the stop-ship class). `origin:'nota'` requires a server-issued short-TTL HMAC token returned by the scan route — otherwise client-asserted and forgeable.

### 1.2 ResearchEvent — *behavior/audit trail (existing stream, extended vocabulary)*
- **Purpose:** append-only behavioral timeline for research and state-transition audit; **deliberately contentless — no amounts, no free text, permanently** (enforced by penelitian.test.js:213-225).
- **Ownership:** user-scoped; research-governed; never trimmed (demo cap excepted).
- **Lifecycle:** append-only; typed vocabulary extended at existing pushEvent sites only.
- **New types:** `transaction_voided {voidReason(enum)}` (M2 boundary — the old `transaction_deleted` type is not silently reused); `proposal.shown` / `proposal.decided {delta}` (T1); `feature_enabled {feature, schemaEra}` (every ship); `feature_rolledback` (rollback procedure); `invoice_status_changed {from, to}`-class transition events for deferred entities.
- **Invariants:** every financial state transition writes exactly one event; event writes ride the same mutator+flush as the domain write (atomic); the three-way rule: **current state lives on entity fields; each transition writes one research event; no money-payload array exists until its consumer does.**

### 1.3 Category — *closed per-book enum with laba flag*
- **Purpose:** the entire profit/cash mechanism (`labaBersih` vs `saldoKas`).
- **Ownership:** code-owned; grows only through reviewed releases. `modal` (masuk, laba:false) is widening #1 — fixing the live modal=profit defect and the quiz that teaches it (latihan.js:115-126).
- **Lifecycle/Invariants:** boundary money always lands in laba:false categories; the scan mapping falls through to null → human chooses; declared-change surface on any widening: `KOLOM_RUPIAH`, omzet sites (metrics.js:147, server.js:1239/1457, export.js:72, index.html:3305/3314), SPA chips, export columns.
- **Validation:** `isValidKategori` at write, per-book enums when books ship.

### 1.4 SchemaStamp — *per-user feature versions*
- **Purpose:** know each record's feature/schema era; research cutover metadata.
- **Ownership/fields:** `user.featureVersions = { provenance:1, voidRestate:1, … }` — set-if-absent, monotonic. A code-constant feature ship-date table replaces a db-level version field (**FACT: `db.schemaVersion` cannot persist off JSON** — PG/Mongo loads return literal `version:1`).
- **Invariants:** stamps are analytics/cutover metadata, **never behavior selectors** — read paths key off row-level flags (`voided`) only. CLI backfill is the authoritative cutover stamp (count-verified `--expect N`); lazy in-mutator stamping is a convenience hook, not the mechanism.

### 1.5 CorrectionChain — *void-and-restate discipline (rule-set over rows, not a stored entity)*
- **Purpose:** correction with historical accuracy — the Indonesian receipt-book ethic: cross out, never tear.
- **Semantics:** DELETE marks `{voided:true, voidedAt, voidReason, replacedBy?}` (row kept); correction = POST with `gantiId` (one mutator: void old + record new — atomic); **409 on void-of-void** (double-tap safe); **deleting a replacement is refused (409, `kode:'pengganti'`)** with client options "batalkan koreksi" (unwind predecessor) or "hapus keduanya" — both single-mutator; no general un-void.
- **Invariants:** voided rows invisible to the app (GET excludes them — the SPA's "hapus" wording stays true) but retained server-side and flagged in exports; voids never raise `konsistensi` (entry-day denominators); reclassification **always** via void+restate, never in-place edits (even in CLI tools); paired void for transfer legs; per-month `voidedCount` surfaced in GET (gate-loss after correction is honest AND visible).
- **Validation:** mutator-level checks (O(1), atomic via throwing mutator); route tests for all 409 paths.

### 1.6 Deferred shapes (pinned now, built on triggers — each with purpose/ownership/lifecycle/invariants)
- **Book** (`books{}`; trigger §8.2): scope of money. One user → N book arrays; book id implicit by array until a second business book exists. Aggregators remain array-param pure functions; re-signature (array→bookId) is the declared core change. Per-book closed enums; personal enum has no business-income semantics.
- **TransferLink** (trigger: satellite): two rows, same `transferId`, opposite jenis, equal jumlah, **one mutator** (atomic via whole-file flush), paired void; the receiving leg's category carries laba:false in its book's enum (the laba mechanism generalizes per book).
- **RecurringSeries** (trigger: T2): `{anchorDate, freq, lastMaterializedOccurrence}`; occurrence keys = materialized **transaction ids** (row-level idempotency); month-end anchor clamps with `clamped:true`; catch-up = forward-only proposals (jadwal.js "gerbang maju" precedent); WIB fixed UTC+7 (no DST issue).
- **Rule** (trigger: T2 / user-authored): `{match → kategori}` into the closed enum; learned from proposal deltas; **T1 rules are read-time detectors, never stored, never auto-materializing.**
- **PiutangEntry** (trigger: pilot demand): flat rows `{id, nama (free text), tanggal, jumlah, catatan}`; settlements = ordinary masuk rows sharing `piutangId`; status **derived** (`jumlah − Σ settlements`); partial payments native; write-off = explicit laba:false adjustment row + typed event (never a silent disappearance).
- **Document** (trigger: storage + consent v3 + recall demand): content-addressed `sha256`; capture-time metadata adopted at the scan milestone (hash + extracted fields + `notaRef` on saved rows; extracted nulls preserved as uncertainty evidence); image bytes never in users.json.
- **Liability register** (trigger: outstanding-balance feature): `{lender, principal, issuedDate, tenor, linkedPayments}`; each payment = a cicilan row annotated `loanId` + pokok/bunga split; outstanding = principal − Σ pokok (derived).
- **Proposal** (trigger: user-authored rules): until then event-borne lifecycle — proposed → confirmed | edited-then-confirmed (delta recorded) | rejected — terminal states immutable; **proposals are never silently applied; rejected proposals are negative learning signal, never pending work; machines never write income** (mutator-enforced).
- **ScenarioParams / ReportDigest**: params-only rule / deferred until their features exist.

### 1.7 Rejected (with resurrection triggers)
Stored FinancialState (a read becomes structurally expensive after in-memory TTL fails) · Counterparty entity (a third capability needing shared client identity) · stored Entity objects / chart of accounts (books split across stores; bank demands balancing proofs) · open/per-user taxonomy (aggregation + pedagogy solved AND measured demand) · Period/closing, TaxLine (regulatory milestones) · SharedMembership (third-party consent instrument, §8.5).

---

## 2. Deliverable 2 — Entity relationship model

```mermaid
erDiagram
    USER ||--o{ TRANSACTION : "owns (one book now; books{} later)"
    USER ||--o{ RESEARCH_EVENT : "append-only trail"
    USER ||--o{ SCHEMA_STAMP : "featureVersions"
    USER ||--o| PROFILE : "has"
    TRANSACTION }o--|| CATEGORY : "classified by (closed enum, laba flag)"
    TRANSACTION |o--o| TRANSACTION : "correction chain (voided / replacedBy)"
    TRANSACTION |o--o| TRANSACTION : "transfer pair (transferId, deferred)"
    TRANSACTION |o--o| PIUTANG_ENTRY : "settlement (piutangId, deferred)"
    TRANSACTION |o--o| DOCUMENT : "evidence (notaRef, deferred)"
    TRANSACTION |o--o| LIABILITY : "cicilan payment (loanId, deferred)"
    RECURRING_SERIES ||..o{ TRANSACTION : "materializes as (T2)"
    RULE ..o| PROPOSAL_EVENT : "suggests via (T1 events)"
    PROPOSAL_EVENT ..> TRANSACTION : "decided -> applied (human tap)"
    SCENARIO_PARAMS ..> TRANSACTION : "reads via pure projection (never writes)"
```

**Relationship rules:** every money fact is a Transaction; every state transition is a ResearchEvent; every machine suggestion is a Proposal event awaiting a human tap; documents/liabilities/series/counterparty-books attach to transactions additively when their triggers fire. No entity other than the store mutators ever writes Transactions.

---

## 3. Deliverable 3 — Invariants (consolidated; each testable)

**Accounting core**
1. Prive, cicilan, and modal never enter `labaBersih` — structurally, via laba:false categories; the nota mapping can never emit a laba-bearing category for boundary money (null → human chooses).
2. Profit and cash are independent numbers per book per month.
3. Reliability gate (`≥10 tx ∧ ≥8 days ∧ cakupan ≥0.6`) is defined over **cash rows only** — documents/invoices/scenarios never count; applied at the single `metricsFor` choke point.
4. Setara discipline: rupiah columns prorated by `hariBulan/hariBerjalan`, ratios never scaled, projections never print on the bank sheet; empty months never fabricated.
5. KUR averages divide only by `isMonthComplete` months; cicilan = max(profile, records); 30/50/6% constants imported from simulasi-kur.js, never re-declared.
6. WIB single conversion point (`tanggalWIB`); deterministic ordering `(tanggal, createdAt)` with id tiebreakers.

**Correction & history**
7. No in-place edits, ever; all reclassification goes through void+restate in one mutator.
8. Voided rows are excluded from every aggregation (filter **before** `hariTercatat`'s Set and `monthsWithData`) and from the app's GET; retained and flagged in exports; a month may honestly lose gate status, and `voidedCount` surfaces it.
9. Paired void: transfer legs void together or not at all; 409 on void-of-void and on deleting a replacement.
10. Reconstruction property: ledger state at any instant T is derivable from kept rows (`createdAt ≤ T ∧ (¬voided ∨ voidedAt > T)`) — the stated justification for deferring both the event log and the report digest.
11. Pre-M2 hard-deleted rows are a documented, bounded loss (archive-first snapshot mitigates).

**AI boundary**
12. Machines never write income — enforced at the mutator (effective-actor check), not the UI.
13. Proposals are never silently applied; terminal proposal states are immutable; rejected = negative signal only.
14. Every applied fact carries server-assigned `origin` (+ `proposalId`/`notaRef` when applicable); `origin:'nota'` requires the scan route's HMAC token.
15. Classifications map into closed per-book enums; unmapped → null → human.
16. Evidence is content-addressed; extracted nulls are preserved as uncertainty evidence.
17. Numbers in prompts are server-computed and scope-labeled ("dihitung sistem"); narration schemas carry zero numeric fields from the model; every new dispatcher method gets a PERKIRAAN class + usage-shape contract test; feature-tagged token log (`{tanggal, fitur, token}`).

**Data mechanics**
18. Research events stay contentless (no amounts/free text) — permanently; financial state transitions write exactly one typed event each; the three-way rule (state on entity fields / one transition event / money arrays only for money).
19. Read paths are stamp-independent (row flags decide behavior); stamps are analytics-only, set-if-absent, count-verified at backfill.
20. Mutator-level O(1) invariant checks (linked pairs, no orphan voids, enum validity) — a throwing mutator rolls back atomically; a **flush-throw** leaves mutated-memory/stale-fingerprint: pinned by test and treated as "verify from disk" in the runbook.
21. Additive fields reach the client raw — every new row field is a deliberate disclosure decision.
22. Consent v3 (naming row-retention after delete, AI provider name fix) ships and is acknowledged **before** M4's delete→void cutover — the live text promises true deletion (consent.js:73-75).

---

## 4. Deliverable 4 — Migration plan from V2

| Step | Content | Key guards / notes |
|---|---|---|
| **M0** | **Archive-first**: build export + sha256 manifest tooling (+ tests: round-trip byte-equal, flip-one-byte refuse, corrupt-manifest refuse, order-before-first-write) | Manifest the **enumerated file set**: users.json, users-seed.json, validasi.json, data/backup/*, server/export/* (access-code CSVs — most sensitive). One canonical DATA_DIR resolver (retires the 4 drifters). Copy the `JENIS_PENYIMPANAN !== 'json'` refusal (backup.js:19-30 precedent); non-json backends require mongodump/pg_dump in the manifest. Acceptance: CLI tools run once inside node:22-slim (CI image). |
| **M1** | **Schema stamps**: featureVersions map + feature ship-date constant table + feature_enabled events. No boot runner. Authoritative CLI backfill (`--expect N`, `--dry-run`, lock-retry, `runBackup({quiet:true})` first — house precedent users.js:559, resumable set-if-absent) + lazy in-mutator hook (one generic hook, not per-mutator paste) | Drop db-level schemaVersion (doesn't persist off JSON). **Read paths stamp-independent.** Per-export manifest standard introduced (app commit + feature ship-dates + semantics notes) in BACA-DULU.txt/manifest.json. |
| **M2** | **ledger.js read adapter** — behavior-identical bisnis/pribadi views; all consumers migrate one call site at a time (7 getTransactions sites in server.js + export.js) | Dual-run harness: zero-tolerance rupiah deep-equality over fixture corpora (demo generators + hand-built edges: prive/cicilan rows, backdated+mundur, unknown-jenis rows, empty months, subuh boundaries, batch ''/B1/B2/DEMO). Harness lifecycle declared: **dies at M4**, succeeded by golden-file fixtures + route-level shadow diff during the M2→M4 window. Rollback: safe only pre-M4. |
| **M3** | **Modal boundary**: 8th category `modal` (masuk, laba:false) + nota.js:48 keyword removal + latihan.js:115-126 quiz fix + `KOLOM_RUPIAH` + omzet-site updates (declared surface incl. SPA copies) + CLI audit → suspect-row list **surfaced to the pendamping**, remediation via the void-and-restate mutator (one human tap per row; never auto-reclassify; re-run never re-queues — review-state marker) | Rollback runbook documents both degradations (modal drops from omzet-facing columns → comparability break; new writes 400 → lain-masuk fallback reinstates the defect) and names the accepted degraded mode. Demo generator generates no lain-masuk rows (verified) — unaffected. |
| **M4** | **Void-and-restate** — **hard predecessor: consent v3 shipped and acknowledged** (deletion-promise change). DELETE → void-mark; GET excludes voided; export keeps rows + `voided/voidedAt/voidReason/replacedBy` columns; monthly/perkiraan/users tables recomputed **void-filtered** + `voidedCount` (fixes the export fatality: scripts/export.js added to the consumer list, routed through the adapter); `transaction_voided` event (new type); 409 semantics; per-month voidedCount surfaced | Rollback = **one-way door**: compensating hard-delete CLI + `feature_rolledback` events; never roll back the build without it. Route-level void tests added as **sanctioned floor growth** (446 → 446+N; deletion routes are untested today). Decide: keterangan retained on voided rows (research value) with explicit consent v3 disclosure; scrub is the fallback if re-consent fails. |
| **M5** | Prive budget read-model (computed; fokus-harian already flags prive > laba) | — |
| **M6** | Intelligence read-models: deterministic detection (fokus-harian pattern) + AI narration; absolute thresholds only until the cohort trigger | — |
| **M7** | Twin pure functions (params-never-results; watermarked; store-free lib) | ScenarioParams store only if "saved scenarios" ships |
| **M8** | Autopilot T1: rules as read-time detectors → proposal events (`proposal.shown`/`decided` + delta) → human tap → ordinary mutator; HMAC nota-origin token live; per-feature PERKIRAAN classes | Machines-never-write-income enforced at mutator |
| **Gated** | T2 recurring (substrate), personal satellite (§8.2), invoices/piutang rows, Document persistence, books{} multi-entity | Each with its FOUNDATION §8 trigger |

**Cross-cutting:** every step keeps the floor green in CI (node:22-slim) and dev; every CLI script carries the five guards; every ship writes feature_enabled + export-manifest entries; ` Intl id-ID` (jamWIB/demo month names) is the one known node-version skew surface — covered by suite assertions.

## 5. Deliverable 5 — API implications

- **Unchanged shapes, additive fields:** `GET/POST /api/cashbook` (rows gain `origin`; GET excludes voided post-M4 and gains per-month `voidedCount`), `/api/me`, dashboard payloads.
- **Changed semantics:** `DELETE /api/cashbook/:id` → void (same route/UX; new 409 responses: `sudah-dibatalkan`, `pengganti` with predecessor id); `POST /api/cashbook` accepts `gantiId` (correction, one mutator) and the nota HMAC token; request-body whitelist extended — `origin`/`voided*`/`replacedBy` rejected/ignored from bodies (route test).
- **New (gated by milestone):** scan route returns `{proposal, hmacToken}` (M8/M3-era); `/api/health/parity`-style manager endpoint only when the event log ships; piutang/recurring endpoints only at their triggers.
- **Error taxonomy unchanged** (`{error}` + typed extras); consent v3 rides the existing 451 re-prompt mechanism; export/download responses labeled (voided rows included in `/api/my-data` by design).

## 6. Deliverable 6 — Database implications

- **JSON (production):** additive arrays/fields only (`featureVersions`, later `personal[]`/`scenarios`); per-mutation cost unchanged (whole-file flush); growth bounded by the trim policy (research events and transactions never trimmed; the snapshot+tail archive seam is designed for the day bytes trend toward the ceiling); attachments never in users.json (512 Mi / whole-file rewrite).
- **PostgreSQL:** zero DDL — new keys ride `data` JSONB spread-back (tokenKartu precedent). Discipline: never add named columns casually (three synchronized edit sites in flush/load). Promotion path at the §8.1 move: `financial_events` append-only table + indexed projections — the point where event-canonical storage becomes *correct* here.
- **Mongo:** flat doc absorbs everything; delete-missing semantics unaffected (new arrays are per-user).
- **No indexes designed at this layer** — lookups are per-user array scans inside an already-parsed file; the index story belongs to the Postgres move.
- **Version storage:** per-user stamps only (db-level fields don't round-trip off JSON — verified); feature ship-dates live as code constants.

## 7. Deliverable 7 — Testing strategy

- **Floor discipline:** 446/0 stays; sanctioned growth only (M4 route-level void tests; export-filter tests). Budget contract: any change adding >10 s to the floor must delete equal wall-clock debt — the guard-sleep stub (`jedaGagal`) recovers ~30 s and is built first.
- **New infrastructure (built before model work):** shared test-utils (the ~20 duplicated `minta()` wrappers), test-data builders (`trx()`, `event()`, `transferPair()`, `voidOf()`, `userWith()`), clock injection (`now` always a parameter — the cashbook convention; financial core already complies), PG fake (pattern: the Mongo fake in penyimpanan.test.js), checksum tool + its tests.
- **Per-invariant testing:** rebuild-parity property loops **only when the event log ships** (pure-function level, seeded mulberry32, fixed seeds committed, `npm run test:fuzz` out of the CI floor); until then the dual-run harness (M2) and golden-file fixtures (post-M4 successor, immune to semantic drift) carry the zero-tolerance property; route-level shadow diff across the M2→M4 window catches missed call sites.
- **Migration tests:** dual-run over fixture corpora with **zero-tolerance rupiah equality** (integer inputs; the only roundings are deterministic); idempotent-migration tests (apply twice = no-op); corrupt-user policy pinned (reject wholesale vs quarantine, mirroring `rusak` semantics); checksum round-trip/refusal tests; node:22 container run of all CLI tools.
- **Runtime vs test-only invariants:** O(1) checks inside `update()` (linked-pair, no-orphan-void, enum validity — atomic via throwing mutator; plus the flush-throw case pinned); parity/golden-master stays test-only; the health probe gains a **sampled void-filter sanity check** only if the parity era arrives — warn-only, respecting `NOVA_HEALTH_COUNT_MS`.
- **Model testability contract (requirements fed back into the design, all satisfied):** pure dual-use projections; importable version constants (actually branched on — the dead `version:1` is the anti-pattern); a maintained V2 legacy view (what keeps 446 tests green while storage evolves); no wall clock inside mutators/projections; idempotency keys surface in shapes; closed enums with exported validators; research-event shape tests extended to the new vocabulary.

---

## Provenance

Six investigators + three adversarial reviewers; every FACT re-verified against the working tree this session. Adjudicated disagreements: data agent (adopt event log now) vs architecture/YAGNI agents (defer/cut) — **resolved: cut now, hybrid design recorded for the first consumer**; AI agent's stored Proposal entity — **thinned to event-borne lifecycle**; complexity attacker's one-line "amounts in delete-event meta" fix — **rejected**: it violates the research no-amounts invariant (penelitian.test.js:213-225); void-and-restate-keeps-rows achieves the same historical accuracy without breaking it. Correction of record: 7 `getTransactions` call sites (not ~10); quiz block is latihan.js:115-126. No implementation is authorized by this document; each milestone requires its own explicit go-ahead.
