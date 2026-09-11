# SESSION A — FINANCIAL WRITE BOUNDARY

**Status:** Batch 1 (mutator hardening — the trust floor) implemented and tested. Full suite green.
**Scope authority:** AI-TRUST-AUTOPILOT-DECISION.md (B′, prerequisite §"Mutator hardening", items 1–2, 5) + FINANCIAL-DATA-MODEL.md §1.1 validation rules.
**Base:** HEAD `c751756`. **Concurrent session:** Session B worked in this same tree during this batch (recommendations sanitizer: `lib/rekomendasi.js`, `test/rekomendasi.test.js`, `SESSION-B-AI-TRUST-AUDIT.md`, two import-line edits in `server.js`). Edits are disjoint; both suites green. See §8.

---

## 1. Repository evidence map

All evidence verified against the working tree this session, not from decision documents.

| # | Evidence | Classification |
|---|---|---|
| E1 | Single canonical store: `server/lib/store.js` — JSON-file default, PostgreSQL (`DATABASE_URL`) and MongoDB (`MONGO_URI`) backends behind the same in-process write queue + cross-process file lock (`update()`, `denganKunci`). A mutator throw discards the cache and writes nothing (store.js, `update()` error path). | FACT |
| E2 | The only financial row writers, exhaustively: `store.addTransaction` (route `POST /api/cashbook` + tests), `store.deleteTransaction` (route `DELETE /api/cashbook/:id`), and demo hydration `store.terapkanDemo` (boot/demo route only, batch `DEMO`). No AI path, CLI script, or backup path writes transactions (`grep` over `lib/`, `scripts/`, `server.js`). | FACT |
| E3 | Scan-nota is proposal-only today: `POST /api/scan-nota` returns a sanitized suggestion and has no store access; the participant saves through the ordinary cashbook route (pinned by nota.test.js "konfirmasi → rute cashbook LAMA tetap satu-satunya pintu simpan"). | FACT |
| E4 | Route-side validation exists only in `POST /api/cashbook`: jenis enum, kategori validity, `asNumber` clamp (0, 1e12], date regex + not-future + not-older-than-5-years, keterangan ≤120. | FACT |
| E5 | `store.addTransaction` pre-hardening did **no validation**: `{ id: generated, ...transaction, createdAt }` — a caller-supplied `id` overrode the generated one, and any caller field (including a hypothetical `origin`) passed straight into the row. | FACT |
| E6 | No provenance fields exist on any row; no idempotency anywhere on the money path; the only double-tap guard is client-side. | FACT |
| E7 | No void/restate semantics: `DELETE` is a hard delete; `pembatalan.test.js` covers AI-call cancellation, not financial void. | FACT |
| E8 | `transaction_added` event meta carries only `jenis/kategori/tanggal/mundur`; a research test pins "no amounts, no free text" in the event stream (penelitian.test.js). | FACT |
| E9 | The 5-year date-window constant existed twice (server.js route + lib/nota.js sanitizer) — the "TAHUN_TERLAMA twin literals" noted in the decision doc. | FACT |
| E10 | Demo transactions are machine-written income rows (batch `DEMO`), injected via `terapkanDemo`'s `Object.assign` — a write path that bypasses `addTransaction` entirely; the only guard was a comment plus `personaDemo` returning null for non-DEMO users (demo-data.js:683). | FACT |
| E11 | `addTransaction` returning `null` (user gone) reached the route as a 201 with `transaction: null`. | FACT |
| E12 | `db.schemaVersion` cannot persist off the JSON backend (PG/Mongo loads return `version:1` literally) — recorded in FDM; relevant to why stamps are out of this batch. | FACT (from FDM, spot-verified in db.js load paths) |
| E13 | Tests: baseline 446/0 verified by full run this session before changes (`node --test --test-concurrency=1`, ~5.5 min). | FACT |
| E14 | Void-and-restate (M4) is gated on consent v3 shipped **and acknowledged**; the FDM calls the M4 rollback a one-way door and states pre-M4 hard deletes are a documented loss window. | FACT (decision record) |
| E15 | Frontend adoption of `X-Request-Id` is required for end-user double-tap dedup; the frontend bundle lives outside `server/` and is owned by the confirmation-UX workstream. | ASSUMPTION (no frontend code inspected this session) |
| E16 | `lib/nota.js` has a second, divergent date-window computation and the noted `asNumber`(→0) vs sanitizer(→null) divergence — same family of defects, sanitizer is outside Session A domain. | FACT / OPEN QUESTION (owner: Session B) |
| E17 | HMAC token issuance for scan-born confirms does not exist; mutator-side consumption therefore cannot be implemented yet without inventing the issuer's contract. | FACT |

## 2. Mutation-path map (current, post-batch)

```
HTTP (human tap, the only authorized writer)
  POST /api/cashbook      → route pre-checks (friendly 400s, unchanged)
                          → store.addTransaction(uid, fields, { aktor:'manusia', requestId })
                          → barisTransaksiSah() INSIDE update() [whitelist · enum · amount ·
                            date window · actor check · requestId dedup · origin assignment]
                          → row pushed + transaction_added {…, origin} → atomic flush
  DELETE /api/cashbook/:id → store.deleteTransaction (hard delete; void semantics = M4, untouched)

Internal (fail-closed)
  store.addTransaction without opts, or with aktor:'mesin' → GalatMutasi (400/403, typed)
  store.terapkanDemo on batch ≠ DEMO → GalatMutasi('bukan-demo', 403)

Fixture writer (documented exception)
  demo-data → terapkanDemo, DEMO batch only, now enforced at the store boundary
```

## 3. Files owned by Session A (this batch)

- `server/lib/store.js` — `GalatMutasi` (typed failure), `barisTransaksiSah` (row contract), hardened `addTransaction`, `terapkanDemo` batch guard, `origin` in `transaction_added` meta.
- `server/lib/cashbook.js` — `TAHUN_TERLAMA` / `tanggalTerlama(now)` moved here as the single source (clock-injectable, per repo convention).
- `server/server.js` — route passes `{ aktor:'manusia', requestId }`; maps `GalatMutasi` to `{error, kode}` with its status; null row → 404 (201-with-null defect closed); local date-window twins removed.
- `server/test/mutasi-uang.test.js` — NEW, 17 adversarial tests.
- 12 existing test files — mechanical `{ aktor: 'manusia' }` attestation at all 26 income/expense seeding sites (the fail-closed contract makes attestation explicit; this is the sanctioned floor-growth churn).

## 4. Trust defects found in the write boundary (and disposition)

| Defect | Class | Disposition |
|---|---|---|
| D1 Mutator accepted any fields/`id` override; validation lived only in the route | stop-ship class ("the unvalidating mutator") | FIXED — whitelist + full validation inside the mutator |
| D2 No effective actor; internal caller indistinguishable from human tap | trust-floor gap | FIXED — required `aktor`, fail-closed |
| D3 Machines could write income (no check existed) | invariant violation | FIXED — typed 403 `mesin-penghasilan` |
| D4 Body-supplied `origin`/`proposalId` would have become authoritative the moment anyone added those fields | latent stop-ship | FIXED — whitelist strips; pinned by test |
| D5 No idempotency; duplicates can manufacture the reliability gate | HIGH (decision finding 7) | PARTIALLY FIXED — `X-Request-Id` honored end-to-end (mutator dedup + typed 409); requires frontend to send it (§7) |
| D6 `terapkanDemo` = unguarded bypass to any user's ledger | bypass class | FIXED — DEMO-batch-only, enforced in the store |
| D7 201-with-null on vanished user | minor correctness | FIXED → 404 |
| D8 Twin date-window literals | drift risk | FIXED for money path (cashbook.js single source); nota.js twin remains (Session B) |
| D9 Hard delete destroys history | FDM documented loss window | NOT TOUCHED — M4, consent-v3-gated one-way door |
| D10 Flush-throw leaves mutated memory + stale fingerprint | known, pinned by FDM invariant 20 | NOT TOUCHED — documented accepted case |
| D11 Two test fixtures (timeline, perubahan) manufactured FUTURE-dated current-month rows (days up to 12/16; silently written by the unvalidating mutator whenever the suite ran on an earlier day-of-month) | latent data pollution — the exact class the mutator now stops | FIXED in fixtures (clamped to elapsed days; sums/counts preserved, assertions untouched). The hardening caught these on its first full run — positive evidence the floor works. |

## 5. Migration sequence (as executed)

1. **Batch 1 — trust floor (DONE, this batch):** canonical validation contract + caller contract + provenance ownership + compatibility strategy, per the brief. Additive; externally observable behavior preserved (route messages, statuses, response shapes unchanged; rows gain additive `origin`/`requestId` fields, which GET returns verbatim by design).
2. **Batch 2 — Session B seam:** when the scan route issues HMAC tokens (`tokenVersion`, TTL, jti), extend `barisTransaksiSah`/`addTransaction` with an internal, token-bearing option consumed **inside** the mutator; `origin:'nota'` + `proposalId` become assignable only through it. Contract to honor: "jti store = row-presence check, honestly labeled single-use within TTL and store lifetime."
3. **Batch 3 — M2 adapter (not Session A solo):** `ledger.js` read adapter; void filtering lives there.
4. **Batch 4 — M4 void-and-restate (explicit go-ahead + consent v3 required):** DELETE→void-mark, `gantiId` single-mutator corrections, 409 `sudah-dibatalkan`/`pengganti`, `transaction_voided` event. The typed-failure machinery from Batch 1 is the vehicle.

## 6. Compatibility risks

- **Additive row fields** (`origin`, `requestId` on rows that opt in): flow verbatim through GET, `/api/my-data`, exports, PG `data` JSONB, Mongo documents — no schema change anywhere; export CSV column additions remain a later milestone (decision amendment f). Consumers that iterate specific fields are unaffected (verified for `scripts/export.js`, kartu publik whitelist, prompts context).
- **Fail-closed `aktor`** changes the internal API of `addTransaction` only; all in-repo callers updated (26 sites). Any out-of-tree caller (none found) breaks loudly, which is the intent.
- **Behavior preserved exactly** for: all existing 400 messages/statuses, 201/404 route outcomes, response shapes, event stream shape (meta gained one closed-vocabulary key), demo hydration (all callers provably DEMO-batch: verified at server.js seeding + `/api/demo` + `personaDemo` null-guard).
- **Test floor:** 446 → 480 for the tree as it now stands (+17 Session A `mutasi-uang.test.js`; the other +17 are Session B's `rekomendasi.test.js`, verified green in the same full run). Existing Session A test changes were mechanical call-site attestation; no assertions weakened. Two fixtures (timeline, perubahan) had future-date seeding corrected — see D11.

## 7. File-conflict risks with Sessions B and C

- **OBSERVED (B):** Session B edited `server.js` (recommendations sanitizer import + route block), `lib/claude.js`, `lib/gemini.js`, added `lib/rekomendasi.js` + test + `SESSION-B-AI-TRUST-AUDIT.md` while this batch was in flight. Regions disjoint from Session A's edits; both change-sets coexist green (480/480 full run includes B's tests).
- **OBSERVED (C):** a third change-set landed late in this batch: `lib/jejak.js` (per-type event-meta allowlist — the FDM amendment (e) mechanism) + `test/jejak.test.js`, `test/ekspor-anonim.test.js`, export anonymization in `scripts/export.js`, and a demo event-meta shape fix in `lib/demo-data.js`. **Their schema already registers `transaction_added.origin: 'kata'`** — i.e., closed vocabulary, survives `--anonymize`, and their structural tests pass against this batch's meta (9/9 verified together). No action needed; this is the coordination working as designed.
- **Anticipated:** scan route (B) will add token issuance — Batch 2 seam above; `lib/nota.js` sanitizer (B) still carries its own date-window math — should switch to `cashbook.js`'s `tanggalTerlama` when B next touches it; frontend (C) should send `X-Request-Id` on cashbook POST (any `^[A-Za-z0-9._:-]{1,128}$` string) to activate dedup — absent header = today's behavior, documented failure mode.
- **Shared-tree caution:** because three sessions write one working tree, the last full-suite run is only authoritative for the tree as of its start. Whoever lands changes last should re-run `npm test` before any commit.
- **Exposed contract (narrow, stable):** `store.addTransaction(userId, fields, { aktor:'manusia'|'mesin', requestId? })` → row | null | throws `GalatMutasi{kode, status}`; rows carry server-assigned `origin`; `GalatMutasi` exported from `lib/store.js`.

## 8. Implementation record (FACT)

- `POST /api/cashbook`: unchanged request/response shape; honors optional `X-Request-Id`; replay → `409 {error, kode:'duplikat'}`; malformed id → `400 {kode:'id-permintaan'}`.
- Mutator refusals (all typed, all side-effect-free — pinned by tests): `aktor-tidak-sah` 400 · `mesin-penghasilan` 403 · `mesin-tanpa-asal` 403 · `jenis` / `kategori` / `jumlah` / `tanggal-bentuk` / `tanggal-masa-depan` / `tanggal-terlalulama` / `id-permintaan` 400 · `duplikat` 409 · `bukan-demo` 403.
- Amount semantics deliberately identical to the route: unreadable/negative → refused (never stored as 0); >1e12 clamped (route behavior preserved).
- Test call sites: `{ aktor: 'manusia' }` added at 26 sites across 12 files — the honest cost of fail-closed semantics; fixture writers now attest they stand in for human taps.
- Not authorized by this batch, not done: proposals[] persistence, command framework, workflow states, event sourcing, double-entry, `gantiId`/void semantics (M4), HMAC/jti consumption (needs Session B issuer), schema stamps (M1), ledger adapter (M2), frontend changes.

## OPEN QUESTIONS (for the orchestrator / other sessions)

1. **Q1 (Session B):** token contract for `origin:'nota'` — Batch 2 needs its exact shape (token format, TTL, verification inputs) before the mutator seam is implemented.
2. **Q2 (frontend owner):** confirm `X-Request-Id` adoption + whether the SPA retries on 409 `duplikat` (it should surface "sudah tercatat", not loop).
3. **Q3 (orchestrator):** is `terapkanDemo`'s `Object.assign` (all-fields) acceptable as the permanently documented fixture exception, or should a later batch narrow it to an explicit field list? (Left as-is: behavior-preserving, DEMO-only, enforced at the boundary.)
4. **Q4 (unresolved by design):** route-level pre-checks and mutator checks now overlap by intent (defense in depth). If a future change weakens the route layer, the mutator holds — no action needed, recorded so nobody "de-duplicates" the wrong layer.
