# Session C — Baseline, Gates Design & Implementation Plan

**Role:** Reliability, test gates & production evidence builder (Session C of the B′ trust program).
**Recorded:** 2026-09-11, ~20:00 local, against HEAD `c751756` plus a live, uncommitted working tree.
**Companion documents:** `AI-TRUST-AUTOPILOT-DECISION.md` (§18 evidence ladder, §19 gate classes, §20 prerequisites), `BASELINE.md`, `SESSION-B-AI-TRUST-AUDIT.md`.

**Critical observation about the tree:** at inspection time, two concurrent sessions were landing work in this same working tree (all uncommitted at first observation):

- **Session A (mutation trust boundary)** — `store.js` (+198 ln), `cashbook.js`, `server.js`, plus updates to six existing test files. Full mutator hardening (prerequisite 4): `GalatMutasi` typed rejections, `aktor` contract, machines-never-write-income, server-assigned `origin`, `requestId` dedup, `X-Request-Id` route wiring, demo-write guard. Route wiring landed **while this baseline was being written** (GalatMutasi import + catch appeared between two reads).
- **Session B (AI trust boundary)** — new `lib/rekomendasi.js` (`sanitasiRekomendasi`, fail-closed 502, rebuild-not-spread), new `test/rekomendasi.test.js`, route wiring in `server.js` (`simpanRekomendasi(req.user.id, bersih, usage)`).

Session C files below are chosen to be **disjoint** from both sessions' edits.

---

## 1. Current evidence baseline

| Claim | Status | Class | Evidence |
|---|---|---|---|
| Test floor **446 pass / 0 fail** at HEAD `c751756` | verified this session, ~78 s, Node v24.18.0 win32 (CI runs node:22-slim) | FACT | local run; `test_reports/baseline-2026-09-08-node24-win.log` (446/0, 221 s) |
| CI floor = `cloudbuild.yaml` step `uji`: `npm ci && npm test` on node:22-slim; no credentials, no network AI | FACT | mock-only proof; image that fails tests is never built (step 1 before `bangun`) |
| Cloud Run AI evidence | **L0** — pipeline deploys but never calls the deployed service; zero artifacts of a runtime-identity AI call | FACT | decision §17; confirmed by full cloudbuild.yaml read (no post-deploy probe step exists) |
| Local live evidence (`npm run smoke`) | **L0** — tool exists (2 live dispatcher calls, schema asserts, exit 1 unconfigured), but stdout-only, no dated artifact, no record of execution, cost block prices stale Anthropic rates | FACT | `scripts/smoke.js:25-31, 65-72, 149` |
| Preview (Emergent) evidence | ≤L2, stale: host URL in pytest default no longer matches tracked config; artifacts self-reported, undated-in-artifact | FACT | `backend/tests/test_novaro.py:7`; `test_reports/iteration_*.json` |
| `uji-hidup` post-deploy live-evidence step | **does not exist** — named in decision §18 only | FACT | repo-wide grep: 2 doc mentions, zero code |
| No GitHub Actions / no CI beyond cloudbuild | FACT | no `.github/` |
| Live consent instrument vs M4 deletion semantics | unresolved (consent v3 prerequisite, owned outside C) | FACT | decision §2.10 |

**Standing verdict (unchanged from the decision, now independently verified): no environment exceeds "unknown, bounded above by L2"; Cloud Run is L0 for AI.**

## 2. Test inventory (36 files, ~8,115 ln, 446 tests, `node --test --test-concurrency=1`)

Mapped to the six CI trust classes (decision §19):

| Class | Existing coverage | Gap Session C must close |
|---|---|---|
| 1. Deterministic mutation validation | Route-level only (date bounds, enums, consent gating in `rute.test.js`); concurrency in `ketahanan.test.js` | **Mutator-level adversarial gates** — until Session A's in-flight hardening, the mutator validated *nothing*; nothing pins the hardened contract yet |
| 2. Adversarial proposal/sanitizer | STRONG: nota/checkup/latihan sanitizers (502 fail-closed) | Recommendations hole was open at HEAD (bare `JSON.parse`); Session B's `rekomendasi.test.js` (in-flight) closes it — C verifies, doesn't duplicate |
| 3. Stale-state protection | STRONG for sessions/consent/locks (jadwal, latihan, produksi) | Date-window and precondition enforcement **at the mutator** (route can be bypassed by internal callers) |
| 4. Duplicate/replay execution | **NONE.** No jti/request-id machinery existed at HEAD; `putar-ulang.test.js` is a visualization test, not replay | Pin Session A's `requestId` dedup (`duplikat` 409) + forged-field discards; jti/HMAC remains blocked (prerequisite 6 not built) |
| 5. Failure injection | PARTIAL: truncation (`terpotong`), refusal→422, abort propagation (pembatalan), quota error mapping | Budget-exhaustion at the route (only unit math today); mid-stream connection destroy; storage/flush failure; no dribble/partial SSE fakes |
| 6. Provenance/contentless events | **Example-based only** (`penelitian.test.js:213-225` greps ONE amount + ONE name) | Structural per-type allowlist (below); adjudication record for live violators; export filtering made true |
| 7. Live evidence | Manual operator tools, never in CI | Operator gate + dated artifacts (batch 4) |

Suite conventions C builds on: per-file tmp `NOVA_DATA_DIR`, cache-busting fresh-store imports, inline fake-Anthropic SSE servers on 127.0.0.1, no shared helper module (deliberately not centralizing now — that would touch every file Session A is editing).

## 3. CI inventory

- `cloudbuild.yaml`: `uji` (test gate) → `bangun` (server/Dockerfile) → `dorong` (Artifact Registry) → `deploy` (Cloud Run `novaexplorer`, asia-southeast2, max-instances=1, `--update-*` convention). No evidence artifacts, no post-deploy verification, `CLOUD_ML_REGION` not set.
- Manual-only: `npm run smoke`, pytest (6 tests, 2 live AI calls, stale host), `npm run export/backup/validasi`.
- The machines-never-write-income triad (classes 1+5+6) must become non-deletable CI floor for any T1 ship (decision §19) — batch 2 starts this.

## 4. Live-evidence inventory

| Rung | Tool | Status |
|---|---|---|
| Local | `scripts/smoke.js` | L0. Calls `streamChat` + `generateRecommendations` directly (not HTTP); asserts schema keys; stdout only; stale Anthropic pricing |
| Preview | `backend/tests/test_novaro.py` | ≤L2 stale; default host = dead Emergent preview; `pytest`/`requests` not even declared in `backend/requirements.txt`; no pytest config |
| Cloud Run | — | **nothing exists**; L0 |
| Artifacts | `test_reports/` | 4 files: 1 dated local baseline log (untracked per `*.log` policy), 3 Emergent iteration JSONs (self-reported, references PNGs not in repo) |

Path to L3 (per decision §18, built in batch 4): post-deploy `uji-hidup` step (health asserts `aiConfigured:true` + `model`, then one authenticated live AI call via demo secret), explicit `CLOUD_ML_REGION`, dated committed evidence artifact with explicit per-property pass/fail.

## 5. Event/privacy invariant inventory

Complete vocabulary as observed (store `pushEvent` + route `logEvent` + demo `dorong`), 23 types. Full per-key schema lives in `server/lib/jejak.js` (batch 1). Load-bearing findings:

1. **Violator 1 — `peserta_dinamai`** (`store.js:596`): meta carries `{sebelum, sesudah: {name, business}}` — participant names into the research stream. Decision §2.4 names it; adjudication still open (it is the only record that a rename happened — research value vs PII).
2. **Violator 2 — `ai_feedback`** (`server.js:1051`): `alasan` up to 500 chars of participant free text. Deliberate instrument ("alat ukur yang selama ini hilang"), still free text in the stream.
3. **Violator 3 — `konsep`** on `latihan_dijawab` / `latihan_ai_dijawab` (`store.js:912,944`): ≤40-char AI-derived concept text — decision §3 flags it as leaking into research events but §20.7 names only two violators. **C raises this as a third adjudication candidate.**
4. **Export disclosure is false** (`scripts/export.js:235` vs `:336`): `--anonymize` claims "teks bebas… sudah dihapus" but `events.csv` meta is written `JSON.stringify(e.meta)` verbatim — names, `alasan`, `konsep` all leak into the *anonymized* export. Also: manifest claims "produk" deleted; no produk column exists.
5. **Demo-data vocabulary divergence**: demo events use `transactions_added {jumlah: count}` (plural — store uses singular `transaction_added` with a different shape) and `user_created {batch, seed:true}` (extra key). Demo events flow into the same `events.csv`. Either demo vocabulary is registered deliberately or it is drift — registered in batch 1, flagged for A.
6. **`store.logEvent(userId, type, meta)` is an open door**: any caller can emit any type with any meta. The allowlist + source-literal scan (batch 1) kills the *accidental* class; deliberate misuse remains a code-review matter — recorded limit, not silently accepted.

## 6. Files owned by Session C

Created/modified by C only (disjoint from A/B):

| File | Purpose |
|---|---|
| `server/lib/jejak.js` (new) | Single-sourced event-meta schema registry: per-type key allowlist + value kinds + the explicit free-text ratchet. Imported by the gate test AND `export.js` (same pattern as A's single-sourced `tanggalTerlama`) |
| `server/test/jejak.test.js` (new) | Class-6 structural gate: schema conformance of every emitted event; source-literal coverage (every event type literal in code is registered); amount-never-in-meta across all scenarios; free-text ratchet |
| `server/test/mutasi-gerbang.test.js` (new) | Classes 1/3/4(/6): mutator trust gates against Session A's documented `GalatMutasi` contract, store-level + route-level |
| `server/test/ekspor-anonim.test.js` (new) | Anonymized-export truth: child-process run of the real `export.js --anonymize` over a seeded store; asserts PII absent from `events.csv`, present in full mode |
| `server/scripts/export.js` (edit) | Anonymize mode filters registered free-text meta paths; manifest wording made true |
| `server/scripts/uji-hidup.js` (new, batch 4) | Live-evidence operator gate → dated JSON artifact in `test_reports/` |
| `cloudbuild.yaml` (edit, batch 4) | Post-deploy `uji-hidup` step (substitution-gated), explicit `CLOUD_ML_REGION` — justified by decision §18 naming exactly this step |
| `server/scripts/smoke.js` (edit, batch 4) | Backend-correct cost block (Gemini vs Anthropic rates) |

Explicitly **not** touched by C: `store.js`, `server.js`, `cashbook.js`, `claude.js`, `gemini.js`, `rekomendasi.js`, `consent.js`, `index.html`, financial semantics.

## 7. Coordination interfaces

**From Session A (consumed, now material in the tree):**
- `import { GalatMutasi } from './lib/store.js'` — fields `{kode, status, message}`; codes observed: `aktor-tidak-sah`(400), `mesin-penghasilan`(403), `mesin-tanpa-asal`(403), `jenis`/`kategori`/`jumlah`/`tanggal-masa-depan`/`tanggal-terlalulama`/`id-permintaan`(400), `duplikat`(409), `bukan-demo`(403).
- `store.addTransaction(userId, txn, {aktor:'manusia'|'mesin', requestId?})` — aktor **required**; today `mesin` is refused entirely (both jenis) until `rule`/`transfer` origins exist; `origin` server-assigned only; body-supplied `id/origin/proposalId/requestId/voided` discarded; failed mutation leaves no row and no orphan event.
- Route: `X-Request-Id` header → mutator dedup → `{error, kode}` with typed status.
- **Needed from A:** confirmation of the two demo divergences (item 5.5) and the `konsep` adjudication (5.3); later, the HMAC/jti confirm path (prerequisite 6) and `proposal_shown` event shape (prerequisite 7) so C can pin them.

**From Session B (consumed):**
- `sanitasiRekomendasi(raw)` — rebuild-not-spread; 502 fail-closed on non-object/empty; module-range clamp to null; persisted object contains only schema keys. C verifies coverage via their `rekomendasi.test.js` rather than duplicating; **needed from B:** confirm malformed-JSON-at-provider (unparseable stream text) lands as a pinned 502 case, not just wrong-shape-object.

**Stop-ship contract C pins for both (decision §21.8):** a forged-origin write reaching the ledger, or an AI surface exposed below its live-evidence rung, is a new stop-ship violation class — the batch-2 tests are the enforcement.

## 8. Implementation batches

| Batch | Content | Gate class | Conflict risk | Status |
|---|---|---|---|---|
| **1** | `jejak.js` registry + `jejak.test.js` structural gate + export anonymize fix + `ekspor-anonim.test.js` | 6 | none (disjoint files) | **DONE — 9 tests green** |
| **2** | `mutasi-gerbang.test.js` — forged provenance, machine-income, missing-actor, dedup replay, date/enum/amount at boundary, atomicity of rejected mutation, demo backdoor, route `X-Request-Id` | 1, 3, 4, 6 | low (new file; pins A's documented contract) | **DONE — 15 tests green** |
| **3 (next)** | `kegagalan.test.js` — budget exhaustion at route, mid-stream `destroy()`, truncated/dribble SSE fakes, storage-failure via rename-onto-directory seam (no store.js changes); `jedaGagal` helper | 5 | low | specified |
| **4 (next)** | `uji-hidup.js` + cloudbuild post-deploy step + `CLOUD_ML_REGION` + smoke pricing fix; dated artifact convention in `test_reports/` | 7 | medium (cloudbuild.yaml is on the care list; change is the one the decision itself prescribes) | specified |
| **5 (after A/B land)** | Full-suite re-verification; prerequisite-traceability matrix (§20.1-12 → gate/artifact); adjudication record for 5.3/5.5 folded into decision amendment if owners concur | — | — | pending A/B |

**Verified floor after batches 1-2 (2026-09-11, this tree with A/B in-flight work included): 498 pass / 0 fail, ~175 s, Node v24.18.0 win32.** Dated artifact: `test_reports/session-c-gerbang-2026-09-11-node24-win.log` (untracked per `*.log` policy, recorded here per `BASELINE.md` convention). Delta from 446: +24 Session C (6 jejak + 3 ekspor + 15 mutasi-gerbang), + Session A's new mutator-contract cases in existing files + Session B's `rekomendasi.test.js`.

## 9. Findings produced while building the gates

1. **FIXED by C — demo `module_completed` shape divergence.** `demo-data.js` emitted `{modul: <number>}` while the store (and the research contract, `penelitian.test.js:119`) uses `{modul: [<numbers>]}` — the exact silent same-type-different-shape reuse §21.1 forbids. Aligned demo to the store shape; the jejak gate now holds it.
2. **FOR SESSION A — docstring/code mismatch in `barisTransaksiSah` date handling.** The comment states a malformed date string from an internal caller is a *contract defect that must be thrown* ("bentuk asing dari pemanggil internal adalah cacat kontrak dan harus terlihat"), but the implementation **defaults it to today** (`POLA_TANGGAL.test` fails → `hariIni`). HTTP is unaffected (route pre-normalizes). C pins the implemented behavior (asserting only the unambiguous future/ancient rejections) and does not choose between them — A should either throw or fix the comment.
3. **Boundary clarification (test-design lesson).** Amounts in `transactions.csv` of the *anonymized* export are the payload, not a leak — the contentless invariant governs the **event stream**, and `monthly.csv` analytics need the ledger numbers. The original example-test's framing ("nominal tidak boleh ikut") is true of events only; the new `ekspor-anonim.test.js` asserts exactly that split (amount absent from `events.csv`, present in `transactions.csv`, keterangan replaced with `(dihapus)`).
4. **Vocabulary pin works as intended.** While building the vocabulary pin, the gate immediately surfaced the two demo divergences (item 1 and `transactions_added`-plural). The plural name remains registered as-is with a comment flagging it for the demo owner — it is still a deliberate-rename decision, not something C normalized silently.

Blocked / explicitly out of scope for C: jti/HMAC token gates (prerequisite 6 unbuilt — no interface to test against), `proposal_shown`/`proposal_rejected` event gates (unbuilt), calibration evidence (no tiers-in-production), consent v3.
