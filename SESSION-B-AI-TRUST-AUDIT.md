# Session B — AI Trust Surface & Provenance Audit

**Status:** FIRST DELIVERABLE — audit complete; Batch B1 (recommendations sanitizer) implemented and green. **Date:** 2026-09-11.
**Addendum (same day, post-audit):** while this audit ran, Session A's mutator hardening landed in the working tree — `server/lib/store.js` grew 1005→1181 lines with `barisTransaksiSah` validation at the mutator (`store.js:1109`: enum/date-window/actor checks, `GalatMutasi` typed errors) plus changes in `cashbook.js` and six test files. Effects on this document: (a) decision-doc fact 1 and audit gap for "mutator validates nothing" are **resolved by Session A's in-flight work** — Session B takes no position inside the mutator; (b) `store.js` line numbers cited below refer to the pre-hardening tree; function names remain valid anchors (`simpanRekomendasiKe`, `simpanGiliranChat`, `aturLatihanAI`, `catatUsage`); (c) full suite is 435/438 — the 3 failures (`GalatMutasi: Tanggal tidak boleh di masa depan` in `perubahan.test.js`/`timeline.test.js` fixtures; `fokus-harian.test.js` only under full-suite parallelism, passes 20/20 alone) are Session A's in-flight state, **not** Session B's diff: all 86 tests in Session B's domain (`rekomendasi` [new, 11], `nota`, `checkup`, `latihan`, `gemini`, `rute`, `keamanan`) pass.
**Protocol:** repository-first; every claim below was verified against the working tree at audit time. Line numbers are from the current tree (see addendum). Classification legend: **FACT** (code-verified), **ASSUMPTION** (stated but unverified), **INFERENCE** (derived from facts), **OPEN QUESTION** (needs an answer before/with implementation).

Alignment: `AI-TRUST-AUTOPILOT-DECISION.md` (B′, decided) is the governing architecture. Where this audit re-verified that document's repository claims, it found no drift. Session B's implementation scope per that document = prerequisites §20.3 (era stamps), §20.8 (recommendations sanitizer), §20.9 (tiering + live model identity + staleness markers), plus §9.3 instrumentation at the generation boundary — all inside Session B's brief.

---

## 1. AI surface inventory

The AI layer is one dispatcher (`server/lib/ai.js`) over three backends selected by `NOVA_AI_BACKEND` ∈ {anthropic, vertex, gemini} (`server/lib/backend.js:22-41`; invalid values throw — no silent fallback, per rule). Adapters: `server/lib/claude.js` (anthropic + vertex) and `server/lib/gemini.js` (Vertex Gemini). Five production AI surfaces, all Express routes in `server/server.js`:

| # | Surface | Route | Dispatcher fn | Provider output | Server sanitizer | Persisted? | User-facing authority label today |
|---|---|---|---|---|---|---|---|
| 1 | Chat (SSE) | `POST /api/chat` (`server.js:883-981`) | `streamChat` | free prose, streamed | none (refusal→422; `stop_reason`/`MAX_TOKENS` → `terpotong` + stored `POTONG` marker, `server.js:947`) | **YES** — both turns, raw prose, `user.chat`, 60-turn cap (`store.js:934-943`) | hardcoded "AI Gemini 2.5" per bubble (`index.html:2368,2522`); meta "Konsultan Nova" |
| 2 | Recommendations | `POST /api/recommendations` (`server.js:800-856`) | `generateRecommendations` | JSON via provider-side schema (`RECOMMENDATION_SCHEMA`, `prompts.js:364-416`) | **NONE** — bare `JSON.parse` (`claude.js:306`, `gemini.js:292`) | **YES** — verbatim payload + `generatedAt` (`store.js:998-1005`) | stamp "oleh AI Gemini 2.5" hardcoded (`index.html:2288`) |
| 3 | Check-up | `POST /api/checkup` (`server.js:1301-1339`) | `analyzeCheckup` | JSON | `sanitasiCheckup` (`checkup.js:15-40`), fail-closed 502, zero numeric fields accepted | never (usage counters only) | item icons ok/perhatian; no explicit "AI said" wording |
| 4 | Nota scan | `POST /api/scan-nota` (`server.js:119-170`) | `analyzeNota` | JSON | `sanitasiHasilNota` (`nota.js:180-219`) + closed `PETA_KATEGORI` + `tingkatKeyakinan` tiers | never (route has no store access to rows; `recordUsage` writes counters only) | tier-gated modal: `low` hides the save button (`index.html:3083-3090`) |
| 5 | Latihan AI challenge | `POST /api/latihan/:no/ai` (`server.js:720-774`) | `analyzeLatihanAi` | JSON | `sanitasiLatihanAI` (`latihan.js:342-369`), fail-closed 502 | **YES** — sanitized object + answer key, `user.latihanAI[no]` (`store.js:849-858`); graded deterministically (`server.js:777-785`) | presented as "tantangan AI" (AI-labeled); key never sent to browser |

Operator tooling: `server/scripts/smoke.js` (live paid calls, never CI). Non-AI deterministic surfaces that *consume* AI output are in §2. Legacy `backend/` (Python, Emergent host) and `test_reports/` are out of the active Node path — not audited further (ASSUMPTION: they are not deployed by the current `cloudbuild.yaml`; not verified in this pass).

Dead code, load-bearing for trust reasoning: `claude.js:27` and `gemini.js:42` import `sanitasiCheckup` **and never call it**. Sanitization for checkup actually happens at the route (`server.js:1325`). An adapter refactor that "moves" checkup handling into the adapter under the belief that the import is live would silently double-sanitize or, worse, lead someone to remove the route-side call believing the adapter covers it. (FACT; flagged for cleanup in Batch B1.)

## 2. AI trust-boundary map

Chain per surface: **prompt-context projection → provider → parse → sanitize → (persist) → display/re-broadcast**.

### 2a. Prompt-context projection (inputs)

- **Scope redaction:** `profileToText` deliberately excludes business name and location (`prompts.js:252-266`) — matches consent v2's "not sent" list.
- **Deterministic numbers only:** `metricsToText` (`metrics.js:243+`) and `cashbookContext` (`prompts.js:94-113`) project server-computed metrics with explicit "dihitung sistem" markers; the model is instructed to add no numbers.
- **Scope-gated module material:** `modulDiminta` (`server.js:877-881`) validates the module number AND schedule unlock before curriculum text enters a prompt — AI is not a bypass for locked content.
- **History:** last 16 turns re-sent (`claude.js:186`, `gemini.js:106`).

This is the existing, de-facto projection contract. It is consistent across surfaces but exists only as prompt-building code — there is no declared per-surface contract entry (the decision doc §12.3 names this gap; Batch B2 declares it).

### 2b. Provider → parse → sanitize

- Recommendations: provider-side `json_schema` (Claude `output_config.format`, `claude.js:276-279`) / `responseJsonSchema` (Gemini, `gemini.js:262`) is **trusted as sufficient**; the only server checks are truncation/refusal and `JSON.parse` success. The schema itself deliberately omits `minimum`/`maximum` on `modulTerkait` (`prompts.js:386-397`) and has **no length bounds on any string** — so even a fully schema-compliant response may carry out-of-range module numbers and unbounded prose.
- The other three surfaces fail closed through pure sanitizers (§4).

### 2c. Display / re-broadcast paths where AI output reaches a human financial decision

1. Saran page renders stored recommendations verbatim (`index.html:2246-2288`) — the primary "human decides" surface, correct model.
2. **Fokus harian rule 7** (`fokus-harian.js:157-168`): stored AI `peringatan[0]` prose becomes the deterministic daily-focus card's *reason* (sliced to 200 chars) and outranks the score-based rules 8–9; `rekomendasi[0].modulTerkait` is passed through `nomorModulSah` before use (good). The card title says "Ada peringatan dari rekomendasi terakhirmu" — attribution exists; staleness and uncertainty treatment do not.
3. **Public card** (`susunKartuPublik`, `server.js:508-552`): unauthenticated `GET /api/kartu/publik/:token` projects stored recommendation `judul`s (sliced 120) as card "insight" — AI-derived content on a **public** surface with zero AI attribution. Falls back to deterministic insight when none exist. Also coerces any `prioritas` other than tinggi/sedang → `sedang` (`server.js:514`), silently upgrading `rendah` (FACT, minor truthfulness defect).
4. Chat history re-renders from `GET /api/chat` and is re-injected as prompt context (bounded).
5. Latihan AI soal renders; answer graded server-side — AI cannot make itself right.

**Authority conclusion (INFERENCE, matches decision doc):** no AI output can create or mutate a transaction row today. The only ledger write remains the human-tapped `POST /api/cashbook` route. AI authority leaks are **display-authority** leaks (fokus card, public card) and **persistence-without-validation** (recommendations), not write-authority leaks.

## 3. Current persistence map

Backing stores: JSON file (`server/data/users.json`) or PostgreSQL (`users.recommendations` column + `data` JSONB) or Mongo (`store.js:121-152, 174-241`). All AI persistence lands on the user record:

| Field | Written by | Contents | Provenance stored | Trimmed? |
|---|---|---|---|---|
| `user.recommendations` | `simpanRekomendasiKe` (`store.js:998-1005`) via `simpanRekomendasi` (`store.js:946-953`) | verbatim provider payload + `generatedAt` | `generatedAt` only — **no model, no backend, no era** | no |
| `user.chat` | `simpanGiliranChat` (`store.js:934-943`) | raw user+assistant prose, `{role, content, ts}`, 60-turn cap | `ts` only — no model per message; event meta `chat_turn {pesan, modul}` is contentless | cap 60 turns |
| `user.latihanAI` | `aturLatihanAI` (`store.js:849-858`) | sanitized soal + `kunci` + `konsep` | `pada` timestamp | per-module overwrite |
| `user.usage`, `user.tokenLog` | `catatUsage` (`store.js:970-995`) | counters only; 14-day daily log | — | 14 days |

Never persisted: checkup result, scan-nota result (usage counters ride the same write — decision doc §2.2 correctly reframes the overclaiming "no storage access" comment at `server.js:112-114`).

Read/export surfaces for persisted AI data: `GET /api/me` → `publicUser.recommendations` (`store.js:343`); `GET /api/recommendations` (`server.js:796-798`); `GET /api/chat` (`server.js:858-860`); `GET /api/my-data` → `exportUser` (everything except `codeHash`, incl. `latihanAI` answer keys — own data, acceptable) (`server.js:1069-1078`, `store.js:658-664`); public card (projected, §2c-3). Research export (`scripts/export.js`) anonymization has known contentless-event violations (`peserta_dinamai`, `ai_feedback`) — adjudication is decision-doc §20.7 territory, coordinated with Session A; not touched by Session B batches.

Invalidation: `saveProfile` nulls `user.recommendations` on profile change (`store.js:703`). No other staleness mechanism exists.

## 4. Current sanitizer map

Pure, tested, fail-closed functions — the house style Session B's new sanitizer must follow:

| Sanitizer | Location | Strategy |
|---|---|---|
| `sanitasiHasilNota` | `nota.js:180-219` | rebuild object field-by-field; unprovable → `null` (never defaults); amount clamped >0, ≤1e12; date window ±5y; category via closed `PETA_KATEGORI` map (`nota.js:31-49`, model never picks app categories); text sliced; confidence clamped 0-1; tier via `tingkatKeyakinan` 0.85/0.60 (`nota.js:137-143`, **nota-specific** per decision §21.6) |
| `parseNotaJson` | `nota.js:89-105` | fence-tolerant extraction of first outer `{}`; failure → 502 ready-made error |
| `keAngkaRupiah` | `nota.js:155-163` | Indonesian/marketplace number-format normalization before numeric check |
| `sanitasiCheckup` | `checkup.js:15-40` | items ≤6, `tipe` enum-fallback `perhatian`, text ≤200, insight ≤400; empty → 502; **no numeric field exists to accept** |
| `sanitasiLatihanAI` | `latihan.js:342-369` | min/max length per field; `kunci` ∈ {A,B,C}; rebuilds object (drops extras); failure → 502 |
| Route whitelist (cashbook) | `server.js:1369-1383` | the money path validation (Session A owns; untouched) |

**Gap:** no equivalent for `generateRecommendations` output. Existing adversarial test coverage: strong for nota/checkup/latihan (`test/nota.test.js`, `test/checkup.test.js`, `test/latihan.test.js`, incl. malformed JSON, alien objects, out-of-range numbers, invariant "scan never creates a transaction" `nota.test.js:298-336`); **zero for recommendations**; provider-contract tests exist for backend selection and Gemini usage translation (`test/gemini.test.js`).

## 5. Files/functions owned by Session B (proposed)

**Owned (new):**
- `server/lib/rekomendasi.js` — recommendations sanitizer (pure function, house style) + `PROMPT_ERA`/`SANITIZER_ERA` constants for the recommendations surface.
- `server/lib/era.js` (or extend `rekomendasi.js`) — shared era-stamp constants for all AI surfaces (one reviewed table per decision §21.5).
- Tests: `server/test/rekomendasi.test.js` (sanitizer matrix), extensions to `test/gemini.test.js` (usage-contract/silent-zero), new model-identity contract test.

**Owned (edits):**
- `server/lib/claude.js`, `server/lib/gemini.js` — return model identity alongside `data`/`text`/`usage`; remove dead `sanitasiCheckup` imports; (no retry/fallback changes — R2/R7 policy untouched).
- `server/lib/ai.js` — propagate identity through the dispatcher contract.
- `server.js` — recommendations route: sanitize between `generateRecommendations` and `simpanRekomendasi`; chat route: include model in persisted turn + `done` payload (already sends `model`; add to `simpanGiliranChat`); `/api/me`/`/api/health`: verified model field (fix `modelAktif` vertex discrepancy); fokus route: pass staleness context; public card builder: attribution + prioritas fix; **scan route: `proposal_shown` emission riding the existing `recordUsage` write** (B′ §9.3).
- `server/lib/store.js` — `simpanRekomendasiKe`: accept sanitized+stamped payload (add `model`, `backend`, `era` fields); `simpanGiliranChat`: optional per-turn model stamp; scan-write extension for `proposal_shown` meta. Store *shape* changes are additive fields on existing objects — no new arrays (B′ rule).
- `server/lib/fokus-harian.js` — rule 7 staleness + explicit AI-source treatment.
- `server/public/index.html` — replace hardcoded "AI Gemini 2.5" with server-supplied identity; recommendation-card staleness marker; public-card attribution (with `kartu.html`).

**Explicitly NOT owned (Session A):** `addTransaction`/mutator internals, cashbook route validation, origin/proposalId *assignment inside mutators*, HMAC/jti machinery, consent v3 wording decision, GCP deploy. **Session C:** CI reliability gates, live-evidence automation, deployment verification.

## 6. Exact trust defects

**D1 — HIGH — Recommendations persisted with zero server-side re-validation.** FACT. `claude.js:304-313` / `gemini.js:290-299` bare-`JSON.parse` provider text → `server.js:827-838` persists `data` verbatim → served verbatim (`/api/me`, `/api/recommendations`) → re-broadcast by fokus rule 7 and the public card. Provider `json_schema` is treated as sufficient (locked rule: it is not). A provider regression, a proxy-injected body, or schema-permissive drift lands on disk and is amplified by two deterministic surfaces. Payload strings have no length bounds even when schema-compliant. **This is the critical defect — CLOSED by Batch B1 (see §9).**

**D2 — HIGH — Model identity is misattributed and unrecorded.** FACT. SPA hardcodes "AI Gemini 2.5" at `index.html` lines 7, 1127, 2288, 2327, 2368, 2522 and **ignores the `model` field the server sends** in the chat `done` event (`server.js:967`; client handler `index.html:2482-2489` reads only `anggaran`/`terpotong`). Consent v2 names "layanan Claude (Anthropic)" (`consent.js:43`) while the deployed backend is Gemini (decision doc fact 5; OPEN QUESTION: confirm the production value of `NOVA_AI_BACKEND` in the current deploy config — not verifiable from repo alone). `modelAktif()` returns the constant `claude.MODEL` even on the vertex path where calls actually use `getModel()` = `claude-3-5-sonnet-v2@20241022` (`ai.js:24-26` vs `claude.js:29-32`) — health/chat identity is wrong on vertex. Nothing persisted names the model/backend that produced any stored output; `GEMINI_MODEL` is env-mutable with no record. **Batch B2** (consent wording itself rides consent v3 — Session A coordination, not edited here).

**D3 — MEDIUM-HIGH — No staleness treatment for stored AI prose.** FACT. `user.recommendations` carries `generatedAt` with **zero age consumers**. The only invalidation is profile-save (`store.js:703`); cashbook changes do not invalidate. Fokus rule 7 serves weeks-old `peringatan` prose as today's focus with no age check and no "as of" marker; the Saran stamp claims "berdasarkan profil usaha terbaru" — true for the profile dimension only, misleading about the data dimension. Chat history has no per-message model and no staleness concept. **Batch B3.**

**D4 — MEDIUM — No "AI said" vs "system verified" distinction on display surfaces.** FACT. Public card insight (AI-derived) is unlabeled as AI content on an unauthenticated page; fokus rule 7 labels the *source card* ("rekomendasi terakhirmu") but presents AI prose in a deterministic card frame without uncertainty language; checkup items show ok/perhatian icons without an "AI assessment" label (the deterministic numbers around it are system-computed — the distinction is exactly what the page doesn't draw). Nota's tier treatment (ok/warning/low, low hides save) is the house pattern — **nota-specific, not copied** (locked rule). **Batch B3.**

**D5 — MEDIUM — Usage silent-zero is unobservable.** FACT. `catatUsage` coerces missing/zero usage to 0 (`store.js:972` `Number() || 0`); Gemini translation `keUsage` already sums thought tokens (`gemini.js:127-135`, tested). If a provider response lacks `usage` (SDK shape change, upstream error-with-200), the participant's budget reads untouched and billing runs unrecorded — the exact "silent-zero" the decision doc names — and nothing logs or alerts. Observable contract test + warn-log are missing. **Batch B5.**

**D6 — LOW-MEDIUM — Nota confidence tiers gate the save button while being model-self-reported.** FACT, inherited from decision doc §2.6 (thresholds pinned by test, no calibration evidence). Session B does **not** change thresholds or copy them elsewhere; staleness/uncertainty work (B3) must not touch the nota gate without a calibration argument.

**D7 — LOW — Dead sanitizer imports in both adapters.** FACT (`claude.js:27`, `gemini.js:42`). **CLOSED by Batch B1 (see §9).**

**D8 — LOW — Public-card `prioritas` coercion inflates `rendah` → `sedang`.** FACT (`server.js:514`). Fix in B3 alongside attribution.

**D9 — INFO — Chat truncation honesty is good and must be preserved.** FACT (`server.js:947`, POTONG marker stored and rendered; mid-stream drop unpersisted). Listed so no batch regresses it.

**ASSUMPTION (audit-level):** production runs `NOVA_AI_BACKEND=gemini` with a specific `GEMINI_MODEL`; the 446-test floor is entirely mock-based; no live-AI evidence exists at any CI rung (decision doc §17-18, accepted). Session C owns live evidence; Batch B2's identity work defines the field their evidence asserts.

## 7. Proposed migration batches (ordered; each independently shippable, additive, test-pinned)

**B1 — Close the recommendations hole (decision prerequisite §20.8).**
New `lib/rekomendasi.js`: pure `sanitasiRekomendasi(mentah, {modulMin, modulMaks})` mirroring house style — rebuild object field-by-field; `ringkasan`/`alasan`/`dampak`/`peringatan`/`targetBulanIni`/`judul`/`langkah` length-clamped (caps chosen from schema descriptions: judul ≤~80 chars, ringkasan ≤~600, per-item langkah ≤~200 ×4, peringatan ≤5 ×200, target =3 ×200); `prioritas` enum with fail-closed 502 on structural garbage; `modulTerkait` out-of-range → `null` (renderer already hides unknown labels, `index.html:3964-3969`); arrays length-capped; extra fields dropped; minimum structural validity → 502 ready-made error, same failure behavior as other sanitizers (fail-closed, no partial display). Route applies it between adapter and store. Adversarial tests: malformed JSON, schema-valid-but-semantically-invalid (empty arrays, huge strings, wrong types), extra fields, unexpected numeric fields (e.g. `jumlah`-like keys must not survive), non-object, array root. Also: remove dead imports (D7). *Store shape unchanged; payload remains prose-only, no money fields (B′ rule respected — recommendations are interpreted advice, not proposal payloads).*

**B2 — Identity + era provenance (decision prerequisites §20.9 identity half, §20.3).**
Adapters return `{model}` (the exact `getModel()`/`modelAktif()` string actually used in the call) alongside data; `ai.js` propagates. Recommendations persist `{model, backend, era}`; chat turns persist `{model}`. Fix `ai.js.modelAktif()` vertex discrepancy; `/api/health` and `/api/me` expose verified identity. SPA: single source of truth for the model label from server state (`/api/me`), chat bubbles use stored per-message model / live `done.model`; static meta description softened to provider-neutral wording. Era stamps: exported integer constants bumped on prompt/schema/sanitizer changes, persisted with recommendations, recorded in scan instrumentation (B4). Consent text correction = consent v3 → **coordination item with Session A**, not in this batch.

**B3 — Display trust: staleness + authority labeling (decision prerequisite §20.9 remainder).**
Fokus rule 7: require `generatedAt` within a declared window (constant, e.g. 30 days, tested) and prepend the source sentence with the recency ("dari rekomendasi {tanggal}") — AI prose stays out of the deterministic frame otherwise (falls through to rule 8). Public card: label AI-derived insight ("Saran AI") or prefer the deterministic insight when stale — public surface gets the stricter treatment; fix `rendah→sedang` coercion. Saran page: staleness marker (age of `generatedAt`), keep "oleh {model} · {tanggal}" stamp from B2 data. No nota-gate changes (D6).

**B4 — B′ proposal instrumentation at the generation boundary (decision §9.3).**
`proposalId` minting contract + `proposal_shown {id, sumber, jenis, kategori|null, tingkat}` emitted **inside the scan's existing `recordUsage` write** (zero added flushes) — implemented as a store-method extension coordinated with Session A (the id must be the same value the hardened mutator will accept on the row; Session A owns row-side `proposalId` assignment — the *contract* is joint, this batch owns only the generation-side emission). Meta is closed-vocabulary (allowlist test per decision §20.7); `tingkat` reuses nota tiers (same surface, no transfer). Event-name constants defined once in `lib/era.js`-adjacent module for A/B/C to import.

**B5 — Usage-contract observability (D5).**
Warn-log + contract test when a completed AI response carries missing/zero-`usage` where the provider contract guarantees one; Gemini translation test already exists (extend the Anthropic side). No behavioral change to budgeting.

**B6 — Test floor growth (Session C boundary-respecting).**
All of the above pinned in `node --test` files, mock-only, no live AI in CI; fits the existing `npm test` floor. Adversarial matrix per the brief: malformed provider JSON; schema-valid/semantically invalid; extra fields; unexpected numeric fields; persistence bypass (unsanitized payload cannot reach store — tested via route-level fake provider); stale AI content (rule 7 window); model identity mismatch (adapter stub returning wrong model string → persisted/UI value is the real one); sanitizer failure (502, nothing persisted); silent-zero usage; AI failure never blocks deterministic actions (existing refund/no-AI-required tests extended).

Explicitly deferred (not Session B): mutator hardening, HMAC/jti, origin on rows, consent v3 wording, idempotency — Session A; live-evidence rungs per method — Session C; calibrating nota thresholds — blocked on evidence.

## 8. Conflict map with Sessions A and C

| Point | Session B intent | Other session | Resolution |
|---|---|---|---|
| `store.js` — `simpanRekomendasiKe`, `simpanGiliranChat`, scan write | additive fields (identity/era), `proposal_shown` meta riding existing write | A owns mutator internals & row provenance | B touches **read/persist-of-AI-prose functions and the scan's usage write**, never `addTransaction`/void/replace mutators; row-side `origin`/`proposalId` assignment stays A. Shared file; disjoint functions; contract = event/meta shapes defined in one module both import. |
| `proposalId` format & single-use semantics | B mints ids at the generation boundary | A consumes at hardened mutator | Joint contract (B4): format, TTL wording, jti store = row-presence (decision §9.2). B implements emission; A implements consumption; neither ships the trust claim alone. |
| Consent text / v3 | D2 surfaces the Claude-vs-Gemini misattribution | A owns consent version bump (decision §21.3) | B fixes UI/health identity now; consent wording change lands only in A's consent v3 with re-acknowledgment flow. |
| Scan route trust-property comments/tests | reword to "persists AI-derived data only as closed-vocabulary metadata" (decision §23d) | A's stop-ship tests reference same wording | B's B4 does the reword together with the emission change; coordinated in one commit touching `nota.test.js` invariants. |
| `server.js` concurrent edits | B4/B1 edit recommendations/chat/scan/fokus/kartu regions | A edits cashbook route + store mutators | Disjoint regions of a shared file; recommend sequential landing (B1 → B2/B3 → B4) to minimize merge surface. |
| `contentless-events` violations (`peserta_dinamai`, `ai_feedback`) | out of scope | A adjudicates (§20.7), C gates | B's allowlist structural test (B4) covers **new** types only; existing violators untouched by B. |
| Test floor & CI | B adds mock-only tests | C owns CI reliability gates & live evidence | B tests run inside existing `npm test`; no CI config edits, no live-AI tests, no deploy changes. B2's identity fields are exactly what C's L3 health assertion (`aiConfigured:true, model`) will check — interface handed to C. |
| Nota tiers 0.85/0.60 | B reads them for `proposal_shown.tingkat` (same surface) | — | No threshold change, no transfer to other surfaces (§21.6); calibration stays blocked pending evidence. |

---

### Repository-first verification note

The decision doc's repository claims (§2 facts 1-7 relevant to Session B) were independently re-verified against the current tree: three persistence doors, bare-JSON.parse recommendations path, fokus/public-card re-broadcast, hardcoded UI model labels ignoring `done.model`, consent naming Claude, nota tier gating — **all still hold as stated**; no drift found between the decided architecture and the current code, and the B1 prerequisite was open exactly as documented **until closed by Batch B1 below**.

## 9. Implementation record — Batch B1 (landed, tested)

**Closed: D1 (the recommendations JSON.parse hole) and D7 (dead sanitizer imports).**

- `server/lib/rekomendasi.js` (new) — `sanitasiRekomendasi(mentah)`: pure, fail-closed 502 on structural garbage; rebuilds the object field-by-field (extra/provider-injected fields — including money-like keys — can never reach storage); length clamps (ringkasan ≤600, judul ≤80, alasan ≤400, dampak ≤200, langkah ≤4×200, peringatan ≤5×200, target ≤3×200, rekomendasi ≤5); `prioritas` enum fallback → `sedang` (never inflates to `tinggi`); `modulTerkait` validated against `MODUL_MIN..MODUL_MAKS` → `null` outside (renderers already hide null); hollow items dropped.
- `server/server.js` — `POST /api/recommendations` now runs `sanitasiRekomendasi(data)` between the adapter and `store.simpanRekomendasi`; a 502 from the sanitizer rides the existing `describeError` + `isServiceFailure(502)` path, so the participant's rate-limit slot is refunded on provider garbage.
- `server/lib/claude.js`, `server/lib/gemini.js` — removed the never-called `sanitasiCheckup` imports (D7).
- `server/test/rekomendasi.test.js` (new, 11 tests) — sanitizer matrix (structural garbage → 502; clamps; enum fallback; module-range nulling; extra-numeric-field stripping) and route tests against a fake Anthropic provider: clean payload persists with `generatedAt` and no foreign fields; four malformed/insufficient provider bodies → 502 **with `user.recommendations` left untouched** (persistence-bypass test); money-field injection (`jumlah`, `nominal`) stripped before storage. Shared single fake-provider server (the adapter client is cached per backend — per-test ports would point a cached client at a dead server, the same reason `checkup.test.js` has one provider test).

**Verification:** `test/rekomendasi.test.js` 11/11; full AI-domain set (`rekomendasi`, `nota`, `checkup`, `latihan`, `gemini`, `rute`, `keamanan`) 86/86. Store shape unchanged (payload remains the four schema fields + `generatedAt`) — no migration, no new arrays, B′-compatible. Batches B2-B6 remain as scoped in §7.
