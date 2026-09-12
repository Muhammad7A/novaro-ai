# Session E — Failure Injection & Resilience Report (Batch 3)

**Role:** Failure injection & resilience builder (Session E of the B′ trust program).
**Recorded:** 2026-09-11, against HEAD `c751756` plus the live uncommitted working tree (Sessions A/B/C work present).
**Companion documents:** `SESSION-C-BASELINE-AND-GATES.md` (§8 batch 3 = this session), `AI-TRUST-AUTOPILOT-DECISION.md`, `SESSION-B-AI-TRUST-AUDIT.md`.

**Baseline verified independently before any design work:** full suite **498 pass / 0 fail**, ~148 s, Node v24.18.0 win32 — matches Session C's claimed checkpoint. Dated artifact: `test_reports/session-e-baseline-2026-09-11.log` (untracked per `*.log` policy, recorded here per `BASELINE.md` convention).

**Method note — probes, not assumptions.** Four behaviors were uncertain at code-read level and would have decided what the tests may pin. Each was settled empirically this session with throwaway scripts **outside the repository** (scratch imports of the real modules; no repo file touched):

| # | Question | Answer (all **FACT**, verified by execution) |
|---|---|---|
| P1 | Does `@anthropic-ai/sdk` 0.117 retry a stream that dies mid-body (`maxRetries: 2`)? | **No. Exactly 1 upstream request**; the stream rejects once with `AnthropicError: "terminated"`, ~80 ms. Retries apply only before a response begins. |
| P2 | Does a truncated stream (clean FIN without `message_delta`/`message_stop`) resolve? | **No.** Rejects once, 1 request, ~30 ms: `AnthropicError: stream ended without producing a Message with role=assistant`. No partial-message false success at the SDK boundary. |
| P3 | What does `describeError` produce for those transport errors? | `AnthropicError` is **not** an `APIError` instance and carries **no `.status`** → falls to the final branch → **`{status: 500, message: 'Terjadi kesalahan tak terduga di server.'}`** → `isServiceFailure(500)` is **false** → **no rate-limit refund**. |
| P4 | Storage seam viability + post-flush-failure store behavior | `writeFile` onto a directory: **EISDIR** (win32 verified; POSIX-identical). After a failed `flush()`: disk file untouched, lock released, **but the in-memory cache keeps the mutated state and serves it**, and the next *unrelated successful* write commits the earlier "failed" mutation to disk. |

---

## 1. Current failure-boundary map

Five AI surfaces, one shared skeleton (route order: `authenticate → requireConsent → anggaranToken(jenis) → rateLimit → AbortController wiring → provider → sanitizer → persist(+usage in ONE write) → respond`; catch: `describeError → refund if isServiceFailure(502/503/429)`):

| Surface | Provider fn | Sanitizer | Persist+usage write | Abort wiring |
|---|---|---|---|---|
| `POST /api/chat` (SSE out) | `streamChat` | `stop_reason` guard in adapter | `simpanGiliranChat` (messages+event+usage, one write) `server.js:958` | `res.on('close')` `server.js:928` |
| `POST /api/recommendations` | `generateRecommendations` | `sanitasiRekomendasi` (fail-closed 502) | `simpanRekomendasi` (rec+usage, one write) `server.js:839` | `server.js:816` |
| `POST /api/checkup` | `analyzeCheckup` | `sanitasiCheckup` | `recordUsage` (separate) `server.js:1328` | `server.js:1314` |
| `POST /api/scan-nota` | `analyzeNota` | `sanitasiHasilNota` | `recordUsage` (separate) `server.js:156` | `server.js:145` |
| `POST /api/latihan/:no/ai` | `analyzeLatihanAi` | `sanitasiLatihanAI` | `recordUsage` then `aturLatihanAI` (TWO writes — only surface without a combined write) | `server.js:738` |

Transport layer (`lib/claude.js`): SDK client `maxRetries: 2, timeout: 120_000` (`claude.js:107-110`); abort signal forwarded on every call; `stop_reason` checked (`refusal`→422, `max_tokens`→`terpotong` flag / 502 for structured outputs). `lib/gemini.js` mirrors the contract; `keUsage` translation is exported and unit-tested (`gemini.test.js`).

Persistence layer (`lib/store.js`): all writes serialize through `update()` → in-process `writeQueue` + cross-process file lock (`denganKunci`, `wx`-create, 30 s staleness) → `load()` under lock → mutator → `flush()` (tmp file + rename, atomic on same filesystem) `store.js:270-274`. Mutator throw ⇒ cache dropped, nothing written (`store.js:292-301`). **Flush throw ⇒ cache NOT dropped** (P4 divergence, §5).

Budget layer (`lib/anggaran.js`): `cekAnggaran` checked **before** send against `PERKIRAAN` estimate; calendar windows (WIB daily 60 k / weekly 300 k, env-tunable at module load); cache-read tokens weighted 0.1; rejection logs `anggaran_habis` with 1 h `jedaMs` dedup (`server.js:258`).

## 2. Current test inventory (failure-relevant subset; full floor 498)

| Existing | What it pins | Class gap it does NOT cover |
|---|---|---|
| `ketahanan.test.js:216` | `max_tokens` → `terpotong` flag; refusal→422; recommendations must stream; `describeError` unit branches | Transport-level destroy/truncation; route-level outcome |
| `pembatalan.test.js` | Client abort closes the upstream (recommendations only) | Chat SSE variant; dribble; post-abort state cleanliness |
| `rekomendasi.test.js` (B) | Malformed provider **body** → 502, nothing saved | Provider never finishing a body (transport failure) |
| `anggaran.test.js` | `cekAnggaran`/`ringkasAnggaran` unit math only | **Route-boundary enforcement: zero coverage** — provider-not-invoked, event dedup, rate-limit interplay never tested |
| `keamanan.test.js` | Login rate-limit 429 | AI rate-limit; **`refundRateLimit` has zero coverage anywhere** (grep-verified) |
| `mutasi-gerbang.test.js` (A/C) | `duplikat` 409 requestId dedup for transactions | AI-surface retry-after-failure idempotency |
| `gemini.test.js` | `keUsage` field mapping; `ApiError` class mapping | Gemini transport failure behavior (see §4 OPEN QUESTION) |
| `rute.test.js:246` | Route uses `describeError` (401 case) | 500-vs-502 classification for transport errors |
| `ketahanan.test.js:94` | Corrupt DB file fails loud, never read as empty | **Write-side** storage failure: nothing |

## 3. Budget failure analysis (class A)

**FACT.** `anggaranToken` runs *before* `rateLimit` in every AI route chain, so on exhaustion: provider is unreachable from the request, rate-limit slots are untouched, the only persisted artifact is the deduped `anggaran_habis` event (registered `jejak.js:74`), and `tokenLog`/`usage` are untouched. **None of this is asserted by any test today** — a reorder of middleware, a lost `return` before `next()`, or a broken `jedaMs` dedup would pass the entire floor while silently changing billing behavior.

**Seeding strategy (FACT, chose public-API path):** `store.recordUsage(id, {input_tokens: N})` lands `N` weighted tokens on today's WIB entry — same accounting path production uses; no date manipulation needed; timezone-safe because seeding and checking share `tanggalWIB`. 100 k ⇒ daily-exhausted (weekly intact, `jenis:'harian'`); 400 k ⇒ weekly-exhausted (`jenis:'mingguan'`, checked first per `anggaran.js:138`).

**Rate-limit interplay made cheaply observable:** `RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_HOUR) || 40` is read at module load (`server.js:72`), so the test file sets `RATE_LIMIT_PER_HOUR='3'` **before importing the server** — then 5 budget-rejected requests prove non-consumption (if budget rejection consumed slots, responses would flip to the rate-limit message from request 4).

## 4. SSE lifecycle analysis (classes B, C, D)

**Mid-stream destroy (B).** P1+P3: single upstream request (no SDK duplicate-retry hazard — that class of bug is structurally absent at transport level today), rejection with no `.status` → route catch → 500-shaped JSON / SSE `error` event. Trust-critical invariants to pin: client receives **exactly one terminal outcome** (chat: deltas may have flowed, `event: error` arrives, `event: done` NEVER arrives; recommendations: non-2xx, body `error` present); **nothing persists** (no chat, no recommendations, no `chat_turn`/`recommendations_generated` events, no tokenLog — usage is honestly *not* recorded because `message_delta` never arrived; that matches the documented abort semantics `server.js:805-809`).

**Truncated SSE (C).** P2: clean FIN mid-stream rejects the same way. Distinct from Session B's case (they own *complete SSE carrying malformed JSON* → sanitizer 502; I own *the stream never completing* → SDK-level rejection). Same no-persistence invariants.

**Dribble (D).** **FACT:** there is no application-level stream deadline anywhere in the repo (grep: no route timer, no `setTimeout` guard on AI calls); the only deadline is the SDK's 120 s request timeout (`claude.js:108-110`). Per the charter ("do not invent a timeout policy"), the tested claims are the ones reality supports: (i) a slow-but-alive stream **completes** with correct accounting (proves no accidental aggressive deadline exists); (ii) client abort mid-dribble closes the upstream and leaves no state (extends `pembatalan.test.js` to the chat SSE route). A >120 s hard-stall test would need a fake clock inside the SDK — not available without production changes; recorded as a limitation, not papered over.

## 5. Persistence failure analysis (class E)

**Narrowest realistic seam (FACT, P4-verified, zero production changes):** create a **directory** at exactly `${DB_PATH}.${process.pid}.tmp` — the temp path `flush()` itself computes (`store.js:271`). `writeFile` then fails **EISDIR** before rename; the real DB file, the lock file, and every other writer are untouched; remove the directory to "heal". This models the real-world case (disk full/EIO at write time: old file intact, new write impossible). Verified on win32; `writeFile`-onto-directory is EISDIR on POSIX too (CI parity).

**What failure must mean (invariants to pin):** the caller's rejection propagates (no false success); disk truth unchanged (old file parses, contains none of the failed mutation); lock released (`users.json.lock` absent); after healing, a retry lands the state **exactly once**.

**FINDING E-1 (for Session A, store owner) — flush-failure cache divergence.** `update()` drops the cache when the *mutator* throws but **not** when *flush* throws (`store.js:284-313`): the mutated object stays as `cache`, and because the untouched disk file still matches `cacheSidik`, subsequent reads **serve the failed mutation as if real** (P4: `getTokenLog` returned 1,000,000 tokens that never reached disk), and the next unrelated successful write **commits the rejected mutation to disk**. For `recordUsage` this is arguably benign (provider work did happen); for `deleteUser` or `addTransaction` it means "a write the caller saw rejected with 500 can silently land later", and Session A's `requestId` dedup — which reads the same cache — would answer `duplikat` 409 for a retry of a transaction that was *never persisted*. Not pinned by my tests either way (pinning current behavior would block a fix; asserting a fix would fail the floor). Surfaced for an owner decision.

**FINDING E-2 (for the `claude.js`/route owner) — transport failures are classified as the client's fault.** P3: stream destroy/truncation → `describeError` → 500 → `isServiceFailure` false → **no `refundRateLimit`**, although the participant did nothing wrong and `rateLimit()`'s own comment promises "pengguna tidak boleh kehilangan kuota untuk kegagalan yang bukan salahnya" (`server.js:216-221`). The likely fix belongs to `describeError` (map mid-stream `AnthropicError` → 502); my tests assert `status >= 500` and no-persistence so they survive that correction, and the refund gap is reported, not silently pinned.

**Refund mechanics otherwise untested (FACT):** `refundRateLimit` (`server.js:222-226`) has zero coverage; when the *mapped* status is a service failure (e.g. 503 from a refused key — `rute.test.js` pins the message only), the slot refund is unobserved. E-batch adds one refund observation via a 503-shaped provider (supported: `isServiceFailure(503)` is true today) — asserting only that a subsequent request is not rate-limited, which holds under both the current and any future 502 mapping.

## 6. Existing retry / idempotency protections

| Layer | Protection | Verified by |
|---|---|---|
| Financial mutations | `requestId` dedup at the mutator (`duplikat` 409), server-assigned origin | `mutasi-gerbang.test.js` (A/C) |
| Provider transport | SDK `maxRetries: 2` — **pre-response only**; mid-stream never retried (P1) | new E test pins the 1-request invariant |
| AI surfaces | No request-id idempotency — retry after failure legitimately re-invokes the provider (tokens double-spent provider-side is accepted reality, documented at `server.js:805-809`); **state** must land exactly once | E test pins: retry-after-storage-failure ⇒ one `recommendations_generated` event, usage counted once, provider hit count == attempts |
| Recommendation persistence | Overwrite semantics (`simpanRekomendasiKe`) — inherently non-duplicating | E test asserts single event + single usage even across retry |
| Chat | Append semantics — safe only because a *failed* turn persists nothing | E test asserts empty history after every failure mode |

## 7. Files owned by Session E

| File | Status |
|---|---|
| `server/test/kegagalan.test.js` | **new** — all E-batch tests |
| `test_reports/session-e-*.log` | evidence artifacts |

**Nothing else.** No production file is modified — the storage seam and all provider fakes are environmental (a directory at the pid-derived tmp path; an in-process SSE server on 127.0.0.1). Explicitly not touched: `store.js`, `server.js`, `claude.js`, `gemini.js`, `anggaran.js`, `rekomendasi.js`, financial semantics, sanitizers (E-1/E-2 are reported, not patched — they belong to A and the provider-adapter owner).

## 8. Minimal testability seams required

**None in production code.** Four environmental seams, all matching suite conventions (per-file tmp `NOVA_DATA_DIR`, cache-busted imports, inline fake SSE server):

1. Fake Anthropic provider — **one** server for the whole file with per-test behavior modes (`happy`, `destroy`, `truncate`, `dribble`, `dribble-abort`, ` unavailable-503`), because `claude.js` caches its client per backend (`rekomendasi.test.js:166-174` documents the dead-port trap). Hit counter per test.
2. Storage seam — directory at `${DB_PATH}.${process.pid}.tmp` (P4).
3. `RATE_LIMIT_PER_HOUR='3'` set at file top before server import (module-load constant, `server.js:72`).
4. Budget seeding via public `store.recordUsage` (§3).

## 9. Proposed implementation batches (all in `kegagalan.test.js`)

| Batch | Tests | CLAIM / FAILURE MODE / EXPECTED SAFE RESULT / REGRESSION VALUE |
|---|---|---|
| **E1 budget at route** (3 tests) | daily-exhausted → 429 `anggaranHabis:'harian'`; weekly-exhausted → `'mingguan'`; flood ×5 (RATE_LIMIT=3) all budget-shaped + exactly 1 `anggaran_habis` event | Provider never invoked (hit count 0); tokenLog/usage untouched on disk; no rate-limit slot consumed; event deduped. *Kills:* middleware reorder, missing `return`, dedup regression, silent provider call on exhausted budget. |
| **E2 mid-stream destroy** (2) | chat SSE: deltas then provider `destroy()` ⇒ `error` event, no `done`, empty history/tokenLog in file; recommendations: non-2xx, `recommendations` null, tokenLog null | One terminal outcome; nothing persisted; exactly 1 upstream request. *Kills:* false-success on broken stream, double-request retry hazards, persistence of partial turns. |
| **E3 truncated SSE** (1) | clean FIN without `message_delta`/`message_stop` (recommendations) ⇒ non-2xx, nothing stored | Same invariants for the silent-close variant. *Kills:* SDK upgrade regressing to resolve-on-truncate. |
| **E4 dribble + abort** (2) | slow stream (4 deltas × 30 ms) completes: full text, `done` with accounting, usage counted once; client abort mid-dribble: upstream closed within deadline, no chat/tokenLog/event | No invented deadline (slow succeeds); abort leaves zero state (chat variant of `pembatalan`). *Kills:* accidental route-level timeouts, post-abort ghost writes. |
| **E5 storage failure** (2) | `happy` provider + tmp-dir seam: recommendations POST ⇒ rejected (≥500), disk truth intact, lock released; heal + retry ⇒ 200 exactly once (1 event, 1 usage, provider hit count == 2) | No false success; no corrupted partial state; retry lands state once. *Kills:* flush-failure false success, partial-file writes, duplicate-state-on-retry. |

Floor after E-batches: **519 pass / 0 fail** (verified full-suite run, 2026-09-11, Node v24.18.0 win32, ~116 s, exit 0; artifact `test_reports/session-e-kegagalan-2026-09-11-node24-win.log`). Composition: 498 (verified baseline at session start) **+ 12 Session E** (`kegagalan.test.js`, all green in 1.3 s standalone) **+ 9 Session C batch-4** (`uji-hidup.test.js`) that landed in this shared tree while E worked — arithmetic 498+9+12=519 reconciles exactly; no pre-existing test was modified.

**Delivered vs planned:** 12 tests instead of 11 — batch E5 grew by one ("kegagalan tulis tidak mendarat diam-diam lewat penulisan proses lain"), an exactly-once counter test proving a rejected-500 mutation never lands on disk through any later independent write. The in-process retry test specified for E5 was **reframed during implementation**: FINDING E-1's cache divergence makes "retry lands exactly once *within one process*" unassertable honestly today (the failed attempt's cache-held mutation lands alongside the retry, double-counting events/usage). Asserting either the double-count (pins the bug) or the single-count (fails the floor) would both be wrong, so retry-idempotency is proven from *disk truth via a fresh store instance* (`prosesBaru()` convention), which is the guarantee a participant actually depends on across restarts and survives an E-1 fix unchanged.

## 10. Risks of false / flaky tests

1. **Cached-client dead port** — mitigated: one provider server for the file, port fixed at boot (documented convention).
2. **Timing** — dribble gaps (30 ms) and abort polling use deadline loops (`tunggu`, ~3 s ceiling) like `pembatalan.test.js`; no bare sleeps on the assertion path; all failure paths verified to reject in <100 ms (P1/P2), so no test depends on provider *speed* except E4 which asserts *completion* only.
3. **Cross-platform seam** — EISDIR on `writeFile`-onto-directory verified win32, POSIX-standard; the seam never touches the real DB file or lock.
4. **Timezone** — budget seeding and checks share `tanggalWIB`; no injected dates, so CI-timezone-safe.
5. **Ordering** — suite runs `--test-concurrency=1`; file-local users per test; disk-truth reads go through `readFile(DB_PATH)` (never through the possibly-divergent cache — FINDING E-1), matching `ketahanan.test.js` convention.
6. **Not pinned (deliberately):** the exact 500-vs-502 status for transport errors and the current no-refund behavior — both are FINDING E-2 outcomes an owner may legitimately change; tests assert only `>=500` + no-persistence so the batch outlives the fix.
7. **Out of scope, recorded:** Gemini transport failures (no base-URL seam without production changes; **INFERENCE from code-read:** a premature clean close of a Gemini stream would end the `for await` with `alasan=null` and `usage=null` → `keUsage(null)` zeros → resolves "successfully" with partial text and zero-usage accounting — flagged as OPEN QUESTION for the provider-adapter owner, untestable here); >120 s SDK stall (needs in-SDK fake clock); `latihan-ai` two-write non-atomicity (`recordUsage` then `aturLatihanAI` — failure between them records usage for an unsaved question; flagged for the surface owner, same seam applies later).

**Coordination:** nothing overlaps D (identity/staleness/usage *semantics* — E only verifies failure-path *accounting arithmetic*) or F (deployed live evidence — E is process-local, mock providers only). Contracts E exposes for them: `anggaranHabis` response field and its `jenis` values; SSE `error`-then-`end` (never silent close); post-failure guarantees that `GET /api/recommendations` and `GET /api/chat` never serve partial state.

---

## Lanjutan 2026-09-12 — E-1 dan E-2 DIJATUHKAN

**Pre-flight:** commit B (`13e1a86 session-b: provider stream deadline`) ada di HEAD, tree bersih, floor di-verify ulang sendiri: **548/0** (~138 s, Node v24 win32; 535 milik BASELINE.md di `2ad3ea7` + 13 tes baru commit B). Artefak: `test_reports/session-e2-baseline-2026-09-12.log`.

**E-1 — landed (`lib/store.js`, `update()`).** `flush()` yang gagal kini membuang `cache` + `cacheSidik`, aturan yang sama dengan mutator yang gagal. Mutasi yang ditolak pemanggil tidak lagi: (a) tersaji dari cache seolah nyata, (b) ter-commit diam-diam oleh penulisan sukses berikutnya, (c) membuat dedup `requestId` menjawab `duplikat` 409 untuk percobaan ulang yang belum pernah persist. Ketiganya dipin di `kegagalan.test.js` seksi E6 lewat seam EISDIR yang sama.

**E-2 — landed (`lib/gemini.js`, `bacaStream`).** Commit B sudah mengetikkan kegagalan transport sebagai `galatStreamTerpotong`/`galatStreamHabis` (502) dan claude.js sudah mengklasifikasi ulang lewat `pernahTerhubung`; yang tersisa adalah sisi gemini: galat iterasi stream yang SUDAH TERJALIN tanpa identitas penyedia (bukan `ApiError`, tanpa status) kini diklasifikasi `galatStreamTerpotong()` — simetris. Identitas penyedia tetap lewat apa adanya. Dengan itu `describeError` (claude/gemini/ai dispatcher) menyerahkan 502 → `isServiceFailure` → `refundRateLimit`, sesuai janji komentar `rateLimit()`. Dipin: 502 eksak untuk destroy/truncate/deadline, pengamatan refund (4 kegagalan transport beruntun dengan RATE_LIMIT=3 tidak pernah menjadi 429 jatah laju; penyedia sembuh → langsung 200), wiring `describeError` di adapter + dispatcher, dan klasifikasi gemini (terpotong untuk galat tak berstatus; passthrough untuk `ApiError`).

**Koreksi jujur atas batch kemarin.** Mode `happy` penyedia palsu dulu tidak mengirim delta teks, sehingga uji rute "penyimpanan gagal setelah AI sukses" kemarin lulus karena alasan SALAH: penyedia gagal 502 (teks kosong) sebelum menyentuh penyimpanan, dan `>= 500` juga meloloskannya. Seam EISDIR-nya tidak pernah tersentuh di jalur rute. Kini `happy` mengirim JSON rekomendasi yang sah, uji itu memin **500 eksak + tepat satu panggilan penyedia** (galat disk, bukan galat penyedia), dan pembeda 500-vs-502 membuat kecocokan semacam itu mustahil terulang. Dua uji penyimpanan tingkat toko kemarin tidak terdampak (memanggil `simpanRekomendasi` langsung).

**Floor setelah landing: 555 pass / 0 fail** (~135 s, Node v24 win32, exit 0) = 548 + 7 tes baru (3 seksi E6 + 4 seksi E7). Artefak: `test_reports/session-e2-kegagalan-2026-09-12-node24-win.log`.
