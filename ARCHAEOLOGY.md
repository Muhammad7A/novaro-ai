# Novaro AI — V3 Repository Archaeology

**Status: evidence record. Reconstructed from repository evidence only. No target architecture is proposed here.**

- **Method:** 8 independent parallel investigations (architecture, data, financial logic, AI, product, infrastructure, testing, technical debt), read-only, each validating claims against code — not docs.
- **Baseline:** `v3-baseline` @ `5d60203e938611fa07366fb40282d701b41d740d` (see `BASELINE.md`). Working tree clean at investigation time.
- **Labeling:** **FACT** = verified in code with citation. **ASSUMPTION** = unstated in code but implied; basis given. **INFERENCE** = deduced from evidence; reasoning given.
- Companion files: `BASELINE.md` (governance + test floor), `test_reports/` (evidence).

---

## Deliverable 1 — Complete repository map

### Real application (all production logic lives here)

| Path | Role | Scale |
|---|---|---|
| `server/server.js` | Sole entry point: middleware stack, ~40 API routes, asset pipeline, static/fallback serving, lifecycle (startup gate, demo hydration, graceful shutdown), startup banner. God-module. | 2,218 ln |
| `server/lib/` (34 modules) | The actual product logic. Key modules: `store.js` (1,005 ln, the database), `db.js` (storage selector), `mongo-store.js`, `kunci.js` (file lock), `kesehatan.js` (health + fail-closed gate), `guard.js` (auth/headers/HTTPS), `cashbook.js` (467 ln), `metrics.js`, `simulasi-kur.js`, `fokus-harian.js`, `konteks-usaha.js`, `ai.js`/`backend.js`/`claude.js`/`gemini.js`/`prompts.js` (589 ln)/`anggaran.js`, `nota.js`, `checkup.js`, `kurikulum.js` (1,487 ln), `jadwal.js`, `latihan.js`, `praktik.js`, `demo-data.js` (690 ln), `validasi.js` (722 ln)/`validasi-it.js` (554 ln)/`validasi-store.js`, `backup.js`, `aset.js` (pre-compressed assets), `consent.js`, `log.js`, `putar-ulang.js` | ~10,000 ln |
| `server/public/` | `index.html` (4,406 ln — the entire SPA inline, script block lines 1194–4404, 27 inline onclick), `landing.html` (124 ln), `kartu.html` (168 ln, public card), `validasi.html` (1,004 ln, validator workbook), `logo-novaro.jpg` | ~6,600 ln |
| `server/test/` | 37 node:test files, 8,115 ln, 446 tests (baseline 446/0) | 8,115 ln |
| `server/scripts/` | `users.js` (CLI: add users, set batch, `mulai` schedule start), `export.js` (research CSV export, anonymize), `validasi.js`, `backup.js`, `smoke.js` (1 real paid AI call) | — |
| `server/deploy/` | `nginx-nova.conf`, `nova.service` (hardened systemd, `/var/lib/nova` on PD) | Jalan C path |
| `server/Dockerfile`, `server/docker-entrypoint.sh` | node:22-slim, dumb-init PID1, non-root, `/data`, HEALTHCHECK→`/api/health`, seed restore via `cat` | — |
| `server/.env.example`, `server/README.md` (39 KB) | Docs (README partially stale — see Appendix A) | — |

### Emergent platform shims (load-bearing for platform deploys, not app code)

| Path | Role |
|---|---|
| `backend/server.py` (58 ln) + `backend/requirements.txt` + `backend/.env` | FastAPI reverse proxy :8001→:3000 so SSE chat survives Emergent's dual-port ingress; injects `x-forwarded-*` |
| `frontend/package.json` + `frontend/.env` | Launcher shim (`node /app/server/server.js`); **`frontend/.env` is the de-facto production runtime config** because dotenv loads from cwd (`server.js:12`) — ASSUMPTION: supervisor cwd is `/app/frontend` |
| `.emergent/` | Platform cron machinery (webhook watcher, "DO NOT EDIT"), `emergent.yml` (job `c4f041b3`) |
| `sync.sh` | Workspace reset to GitHub main; **contains a live GitHub PAT** (`sync.sh:25`) |
| `.gitconfig`, `.claude/settings.json` | Emergent commit identity; Claude Code plugin setting |

### Research / contest artifacts

`memory/` (PRD — 2 config generations stale; `test_credentials.md` — commits `VALIDASI_KODE=emergent2026` + demo codes 101–120), `test_reports/` (3 Emergent agent JSON reports + baseline log), `BASELINE.md`, `ARCHAEOLOGY.md`, root `README.md` (current), root `package.json` (drifted from `server/package.json` — §7), `cloudbuild.yaml` (315 ln, Cloud Run pipeline), `.gcloudignore`, `.gitignore`.

### Dead/leftover (FACT)

- `server/public/bg-sky.jpg`, `bg-stars.png` — referenced by nothing; landing went pure-CSS starfield.
- Root `package.json` missing `mongodb` dep (dynamic import in `db.js:155` crashes only if Mongo selected from a root install).
- Files referenced but absent: `PANDUAN-VALIDASI.md` (cited `server.js:1703`).
- Dead routes: `GET /api/recommendations` (`server.js:796`), `POST /api/feedback` (`server.js:1032` — zero UI references), `GET /api/validasi/it/instrumen` (`server.js:1739`), `POST /api/validasi/it/kirim` (`server.js:1807` — line-for-line copy of the IT branch of `/api/validasi/kirim`).

---

## Deliverable 2 — Architecture reconstruction

**FACT.** Single Node.js/Express 5 (ESM) monolith; no frontend build step; Node ≥20 (Docker pins 22-slim). Auth = access code as Bearer token (sha256 at rest, shown once; per-IP 20-fail/15-min limiter where a correct code always wins — CGNAT-aware, `guard.js:231-244`). Three deployment topologies share one codebase:

| | Emergent (current preview) | Cloud Run (cloudbuild.yaml) | Compute Engine (deploy/) |
|---|---|---|---|
| Chain | ingress → FastAPI :8001 → Node :3000 | router → container :8080 → Node | nginx :443 → Node :3000 |
| Config source | tracked `frontend/.env` (cwd-dependent) | `--update-env-vars` + secrets | `/etc/nova/nova.env` (root-owned) |
| Data dir | `/app/server/data` | `/tmp/data` (**ephemeral**) | `/var/lib/nova` (Persistent Disk) |
| TRUST_PROXY | on | **off** | on |

**Middleware order (load-bearing, `server.js`):** `x-powered-by` off → `trust proxy` → `forceHttps` (non-GET bodies 403'd, never redirected) → `securityHeaders` → **`POST /api/scan-nota` with its own `express.raw` 4 MB parser** → global `express.json` 256 kb → ~40 routes → pre-compressed asset routes → `express.static` → SPA catch-all (unknown GETs get the SPA — masks asset 404s) → error handler. Four middlewares (`authenticate`, `rateLimit`, `anggaranToken`, `requireConsent`) are used at line 119 before their textual definitions at 184–282 — works only via function-declaration hoisting. No compression middleware may ever be added globally (it would buffer the `/api/chat` SSE stream; assets are pre-gzipped instead, `aset.js`).

**Frontend:** view-switching SPA (no hash routing, no deep links beyond separate pages), module-level globals (`token`, `state`, `kas`), `api()` wrapper handling 401→logout and 451→consent screen, hand-rolled SSE reader for chat, dark theme default, localStorage keys as cross-page contract. Three print flows (KUR sheet, health card, validator result). Strict CSP with `script-src 'self' 'unsafe-inline'` — required by the inline-script design, acknowledged in code as a weakness (`guard.js:82-88`).

**Lifecycle (exact, `server.js:2088-2213`):** import-time env computation (`db.js:65`, `guard.js:41`) → `GOOGLE_CREDENTIALS_B64` decode → routes/assets → direct-execution guard → **fail-closed storage gate** `wajibBisaMenyimpan()` (exit 1 if storage unusable or if `NOVA_REQUIRE_PERSISTENT_STORE=1` with json) → demo hydration (idempotent, never touches non-DEMO accounts) → listen → banner → in-process backup scheduler (unref'd interval). **Shutdown:** SIGTERM → hard deadline 8 s (`SHUTDOWN_TIMEOUT_MS`) → `server.close()` → write-queue drained twice → exit 0/1; systemd `TimeoutStopSec=20` deliberately > app's 8 s.

---

## Deliverable 3 — Data flow map

**Storage selection precedence (FACT, `db.js:50-63`):** explicit `NOVA_STORAGE` (json|mongo|postgres) > `DATABASE_URL` → postgres > any `MONGO_*` URL → mongo > json. Committed production = **json**.

**Write path (all backends, FACT `store.js:257-286`):** mutator → in-process `writeQueue` (promise chain) → cross-process file lock `denganKunci` (wx-create, 5 s wait, 30 s stale takeover; same-machine only) → fresh `load()` from disk → mutate → `flush()`:
- **JSON:** whole-DB pretty-print to `${DB_PATH}.${pid}.tmp` → atomic rename. **No fsync** (INFERENCE: power-loss durability gap; process-crash safe). Cache fingerprint (ino:size:mtime) invalidates on out-of-band edits.
- **Postgres:** one transaction: upsert **every** user (`INSERT … ON CONFLICT DO UPDATE`) + `DELETE FROM users WHERE NOT (id = ANY($1))` — O(N) statements per write, delete-missing semantics defended in comments (past bug: resurrected deletes, `store.js:219-232`).
- **Mongo:** `bulkWrite(replaceOne upsert)` then `deleteMany({_id: {$nin}})` — **no transaction** (standalone); crash between the two resurrects recently deleted users (`mongo-store.js:16-23`).

**Read path:** whole-DB cache + `structuredClone` per read (`store.js:323`); health probe parses the full file (measured **571 ms at 300 users**, `kesehatan.js:56-59`).

**Record shapes (FACT):** transaction = `{id: trx_+12hex, tanggal YYYY-MM-DD, jenis masuk|keluar, kategori (7-enum), keterangan ≤120, jumlah (0,1e12] clamp, createdAt UTC}`. User record: id/name/business/batch(B1|B2|DEMO)/codeHash/profile(+append-only `profileHistory`)/mulaiPada/recommendations/chat(60-turn cap)/transactions(never trimmed)/progress/events(**append-only audit, never trimmed**)/usage/tokenLog(14-day trim)/consent{versi,agreedAt}/tokenKartu/latihanAI/demoMeta. PG named columns + schemaless `data` JSONB for the rest (spread back on load); Mongo = one flat doc per user.

**Identity & ownership (FACT):** `NOVA-XXXX-XXXX` codes (32-char alphabet), stored **only** as `sha256(trim(code).toUpperCase())`; plaintext shown once; bulk CLI exports to gitignored 0600 CSV; demo codes 101–120 public by design. PII: name, business, location, free text, chat. Consent v2 states name/business/location are not sent to the AI provider — enforced in `profileToText` (`prompts.js:252-266`). Export excludes `codeHash`; hard delete (`konfirmasi:'HAPUS'`) removes from the live store but **not** from `validasi.json`, old backups, or prior exports.

**Integrity posture:** corrupt `users.json` **blocks boot** (fail-loud, never reseed over suspect data, `kesehatan.js:260-332`); backups refuse to archive unparseable files; seed applies **only** to an empty DB; `version:1` envelope exists but nothing branches on it — **no real schema-versioning machinery** (FACT); field additions degrade via `??` defaults at read sites.

**Historical assumptions:** WIB (UTC+7) single conversion point `tanggalWIB`; backdating allowed to 5 years and flagged (`mundur` event); consistency scoring uses entry-day, so backfill never punishes; month queries clamped `[5y back, currentMonth]`; empty months never fabricated.

---

## Deliverable 4 — Financial logic map

All deterministic, server-side (`metrics.js:2-7` header: numbers are never AI-computed).

**Category engine (FACT, `cashbook.js:30-48`):** closed 7-entry enum. `masuk`: penjualan, lain-masuk. `keluar`: belanja-bahan, operasional, lain-keluar, cicilan, prive. The `laba` flag is the whole mechanism: prive & cicilan have `laba:false` → excluded from `labaBersih` but included in `saldoKas`. Profit and cash are independent numbers per month.

**Month aggregation (`summarizeMonth`):** string-prefix month membership; unknown `jenis` rows skipped + counted (`barisDiabaikan` — old bug: income read as expense); float sums, no intermediate rounding; `marginBersih` 1-decimal, guard at 0.

**"Setara" full-month equivalent (`cashbook.js:279-300`):** factor = `hariBulan / hariBerjalan` (elapsed days — unrecorded days count as zero, deliberately conservative); rupiah columns × factor (only place integer rounding appears); ratios never scaled; factor exactly 1 for complete months.

**Reliability gate (FACT, `cashbook.js:368-380`):** real cashbook data replaces profile estimates only when `jumlahTransaksi >= 10 && hariTercatat >= 8 && cakupan >= 0.6`. Consistency denominator is days-since-first-entry-of-month (backfill-safe). The gate is applied at a single choke point (`server.js:293-315`).

**Health score 0–100 (`metrics.js:38-121`):** margin (max 30: ≥20%→30, ≥10→22, ≥5→14, >0→7) + recording habit (max 20: real konsistensi×20, or self-report 20/18/12/6/0) + separate account (20) + NIB (15) + business age (15: ≥24mo→15, ≥12→11, ≥6→7, else 3). Bands: ≥80 Sangat sehat, ≥60 Sehat, ≥40 Cukup, else Perlu perhatian.

**Cicilan rule:** `cicilan = max(profile.cicilanBulanan, cashbook-recorded)` with `cicilanBelumTercatat` flag — a self-acknowledged debt must not vanish on day one (`metrics.js:151-167`).

**KUR math (`simulasi-kur.js`, single-sourced):** installment = `round(jumlah/tenor + jumlah×0.06/12)`; null (never Rp 0) for nonsense input; burden ratio vs average profit capped at 999; zero/negative profit + installment = 999 = berisiko. Thresholds 30%/50% are **imported** by `metrics.js:8` and the browser executes the same file (`/simulasi-kur.js`, `window.NOVA_SIMULASI`). **Two known threshold copies outside the module (FACT):** printed report hardcodes `* 0.3` ("Kemampuan cicilan sehat", `index.html:3329`); the 10% thin-margin value exists as twin literals (`index.html:1888`, `fokus-harian.js:147`).

**KUR report (`server.js:1430-1522`):** 1–12 months (default 6); totals = raw sums; **average profit divides only by `isMonthComplete` months** (complete ∧ >0 trx ∧ cakupan ≥0.6); running month reported separately; setara projections deliberately **excluded** from the printable sheet (a 1-week month could factor 4×). Print is client-side `window.print()` + `@media print`.

**Month-over-month:** `((now−then)/|then|)×100`, null on zero/missing prior (never −100% or Infinity); "Apa yang berubah?" excludes prive & cicilan from pengeluaran by design (a bigger prive must not look like cost inflation, `server.js:1225-1229`).

**Invariants V3 must not break (testable, FACT-derived):** (1) prive/cicilan never touch labaBersih; (2) per-month figures always labeled setara vs raw; (3) reliability gate applied identically everywhere; (4) empty months never fabricated; (5) rata-laba divides by complete months only; (6) cicilan = max(profile, records); (7) 30/50 constants imported, not re-declared; (8) AI output never creates a number (scan-nota propose-only; checkup schema has zero numeric fields); (9) WIB boundaries via `tanggalWIB` only; (10) closed category enum validated on write.

---

## Deliverable 5 — AI integration map

**Provider matrix (FACT):**

| Path | Auth | Model | Notes |
|---|---|---|---|
| anthropic | `ANTHROPIC_API_KEY` | `claude-3-5-sonnet-20241022` (hardcoded) | maxRetries 2, timeout 120 s |
| vertex | ADC | `claude-3-5-sonnet-v2@20241022` | not covered by GCP trial credits |
| gemini (production) | ADC, `vertexai:true` | `GEMINI_MODEL` env, default `gemini-2.5-flash` | **no explicit client timeout** — relies on route AbortSignal |

Selection: `NOVA_AI_BACKEND` invalid value **throws at request time** (no silent fallback, `backend.js:29-36`); legacy default flips to vertex when `GOOGLE_CLOUD_PROJECT` is set — the reason cloudbuild pins the var explicitly. **No cross-provider failover exists** (`ai.js:19-21` is a bare ternary); provider outage = user-visible error + rate-limit slot refund.

**Dispatcher contract:** 5 functions (`streamChat`, `generateRecommendations`, `analyzeCheckup`, `analyzeLatihanAi`, `analyzeNota`) + `describeError`/`isConfigured`/`modelAktif`; every provider must return Anthropic-shaped usage (`keUsage` maps Gemini `thoughtsTokenCount` → output tokens). This usage contract is load-bearing: a field-name divergence reads as **0, silently** — budgets stop constraining spend (`anggaran.js:67-75`).

**Prompt architecture (`prompts.js`):** two-block system prompt with a cache boundary (stable block cached only ≥4,000 chars); deterministic context = full completed-month history (≤36 months) + current month + profile (name/location **excluded**, consent promise) + `metricsToText` prefixed "ANGKA KEUANGAN (sudah dihitung sistem, gunakan apa adanya)". Anti-hallucination devices: full-range disclosure line, trend computed only between two complete months, explicit "don't compare running month to last month" instruction, top-5 expenses aggregated. Module material enters the prompt only when the module is valid **and unlocked** — the AI cannot become the leak path for gated content. No few-shot examples anywhere.

**Structured output & failure:** provider-side JSON schemas (json_schema / responseJsonSchema); server re-validates nota/checkup/latihan via hand-written sanitizers, but **the recommendation schema is never re-validated** (bare `JSON.parse`); **no app-level retry/repair anywhere** (only SDK transport retries ×2). Refusals → 422 with Indonesian copy; truncation → chat flags `terpotong` + `POTONG` marker in history, JSON features → 502. Error taxonomy maps SDK errors to 400/402/429/500/502/503 with IAM-specific messages.

**Budgets (FACT):** pre-flight estimate vs WIB calendar daily (60k) + weekly (300k, Monday-anchored) budgets; cache-read billed 10%, cache-write 125%; tokenLog kept 14 days; budget breach blocks **only AI routes** (cashbook/reports/modules stay usable, and the 429 copy says so); per-user hourly request cap (40) is an in-memory Map — resets on restart, single-instance only. AI features: chat (SSE, free text), recommendations (stored blob), checkup (sanitized, never persisted), scan-nota (**provably cannot write** — route has no storage access), latihan AI challenge (stored with answer key, graded deterministically).

**Hallucination risk surfaces (ranked, FACT-based):** 1. chat free text — unvalidated, only context discipline constrains it; 2. recommendation prose fields — unrevalidated; 3. latihan question text — bounded harm (letter-graded); 4. checkup text ≤200 chars, numbers-on-page always from server; 5. scan-nota — every field nullable/mapped/clamped + tiered confidence. **Nowhere does code re-verify an AI-stated number against injected data.**

---

## Deliverable 6 — Feature maturity matrix

| Feature | Classification | Evidence |
|---|---|---|
| Access-code login (admin-issued; **no self-signup**) | PRODUCTION-READY | `guard.js:231-244`; codes via CLI `scripts/users.js` |
| Consent v2 flow (server-enforced 451 gate) | PRODUCTION-READY — **copy drift: text names Claude; production runs Gemini** | `consent.js:43-45` vs `frontend/.env:3` |
| Profil, Dasbor/score, Fokus harian, Konteks | PRODUCTION-READY | `server.js:340-369,617-659`; `metrics.js` |
| Buku kas entry, search/filter, delete | PRODUCTION-READY | `server.js:1341-1422` |
| Scan nota (AI, propose-only) | PRODUCTION-READY (AI-gated) | `server.js:119-170`; `nota.js` |
| WhatsApp 7-day recap | PRODUCTION-READY (client-built text) | `index.html:1734-1781` |
| Timeline, Apa yang Berubah? | PRODUCTION-READY | `server.js:1116-1135,1231-1289` |
| Check-up AI, Rekomendasi AI, Chat SSE, Latihan AI | PRODUCTION-READY (AI-gated, budgeted) | `server.js:796-856,883-981,1301-1339,720-785` |
| AI answer feedback (thumbs) | **INERT — route fully built, zero UI calls it** | `server.js:1032-1052` |
| KUR report + print, KUR simulation | PRODUCTION-READY (single-source math) | `server.js:1430-1522`; `simulasi-kur.js` |
| Public health card (whitelist payload) | PRODUCTION-READY | `server.js:508-590`; `kartu.html` |
| Curriculum (29 modules: 7 sessions + 22 library, 4 jalur) | PRODUCTION-READY content | `kurikulum.js:80-105` |
| 7-session unlock schedule | PARTIAL as product — **dead-ends without admin `users -- mulai`** | `jadwal.js:42-56` |
| Quizzes (7 sessions only), praktik terverifikasi, putar-ulang film | PRODUCTION-READY | `latihan.js`, `praktik.js:46-64`, `putar-ulang.js` |
| Papan Kemajuan (leaderboard) | **PARTIAL/DEMO-ONLY — data source is DEMO accounts only** | `server.js:1140-1217` |
| Demo mode (5 personas, codes 101–120, round-robin, boot rehydration) | PRODUCTION-READY, DEMO-ONLY purpose | `demo-data.js:73`; `server.js:429-491,2029-2086` |
| Data rights (export / hard delete) | PRODUCTION-READY (delete misses backups + validasi.json) | `server.js:1068-1092` |
| Validator sheets + manager download | RESEARCH-ONLY (env-gated; 2 of 4 routes unused by UI) | `server.js:1596-1832` |
| Research instrumentation (events, B1/B2, CSV export) | RESEARCH-ONLY | `store.js:510-519,611`; `scripts/export.js` |
| Multi-backend storage (pg/mongo) | PRODUCTION-READY code; JSON pinned in committed config | `db.js`; `frontend/.env:2` |
| Ops (health probe, backups, budgets, fail-closed gate) | PRODUCTION-READY, not user-facing; **backups effectively start-up-only on Cloud Run** | `backup.js:256-264` |

Known dead-end states (FACT): unstarted schedule → all 7 sessions locked; new account → report page empty; AI unconfigured → scan/checkup hidden, chat pill "offline"; budget out → Send disabled with reset-time copy; demo pool unhealthy → `/api/demo` 503.

---

## Deliverable 7 — Technical debt inventory

| # | Finding | Sev | Effort | Evidence |
|---|---|---|---|---|
| 1 | **dotenv cwd sensitivity** — `frontend/.env` is production config only because of cwd; documented prior incident: stray `.env` caused ~121 test failures | High | S | `server.js:12`; `memory/PRD.md` |
| 2 | **JSON store: whole-file rewrite per write** + never-trimmed `events`/`profileHistory`; 571 ms parse @300 users → ≥0.5 s serialized per write at that scale; untenable well before 1,000 users | High | L | `store.js:243-246,297-313`; `kesehatan.js:56-59` |
| 3 | **4,406-line single-file SPA, zero frontend tests**, `unsafe-inline` CSP, regression history (lost `@media` wrapper) | High | L | `index.html`; `test_reports/iteration_1.json` |
| 4 | **Usage-contract silent-zero risk** — wrong usage field names read 0; only Gemini side guarded (via internals-reaching test); Anthropic passthrough untested | High | S | `gemini.js:127-138`; `anggaran.js:67-75` |
| 5 | **Committed secrets** — live GitHub PAT (`sync.sh:25`), validator code (`memory/test_credentials.md:13`) | High | S | (flagged in BASELINE §8) |
| 6 | DATA_DIR derived independently in 4 modules — lock/health correctness depends on accidental agreement | Med | S | `store.js:35`, `kesehatan.js:39`, `validasi-store.js:30`, `backup.js:20` |
| 7 | Root `package.json`: missing `mongodb`, test script missing `--test-concurrency=1` | Med | S | root vs `server/package.json` |
| 8 | Dead/duplicate routes (`feedback`, `GET recommendations`, 2× `validasi/it/*`) | Med | S | §1 |
| 9 | Stale docs cluster: "Sonnet 5" ×9; module count 10 vs 14 vs 22+7; README budgets 10k/50k vs code 60k/300k; PRD describes Mongo-era config; missing `PANDUAN-VALIDASI.md` | Med | S | Appendix A |
| 10 | CSS/theme duplication across 4 shells + localStorage key drift (`nova-theme` vs `nova-tema`) | Med | M | `index.html:1209` vs `validasi.html:452` |
| 11 | Threshold prose duplicated in frontend (30%, 50%, 6% strings; twin 10% literals) | Low | S | `index.html:3399-3418` |
| 12 | In-memory Maps never pruned (`hits`, `demoHits`); quotas reset on restart | Low | S | `server.js:199,440` |
| 13 | SPA catch-all masks asset 404s; hoisting-dependent middleware order | Low | S | `server.js:1965-1971,119-282` |
| 14 | Test-only exports + 10 internal-only exports (API-surface noise) | Low | S | §1c of debt report |
| 15 | pg/mongo paths effectively unexercised in any committed environment | Low→Med at V3 | M | `frontend/.env:2` |

**Top 5 incident risks ranked:** (1) dotenv cwd config flip; (2) JSON-store write-latency collapse → shutdown force-exit losing queued writes (perceived as "data loss with no error"); (3) single-file SPA whole-client breakage with no test net; (4) token budgets silently disabled via usage-field drift; (5) config/docs drift cluster causing contributors to act on false premises.

---

## Deliverable 8 — Top architectural constraints (must hold in V3 unless explicitly redesigned)

1. **Single-writer, single-instance is structural** — full-DB cache + whole-file/whole-set flushes + delete-missing semantics; two instances silently clobber (`db.js:29-35`; `--max-instances=1`).
2. **`/api/scan-nota` before `express.json`**; global compression middleware forbidden (SSE).
3. **Middleware hoisting order** and import-time env computation must be preserved through any `server.js` reorganization.
4. **Dual-use libs** (`simulasi-kur.js`, `putar-ulang.js`, `kurikulum.js` via `/modul.js`) must stay dependency-free and environment-agnostic.
5. **Auth = access code as bearer**; migration must carry `codeHash` verbatim and keep the shown-once property.
6. **Consent v2 gates all writes server-side**; version number is research protocol.
7. **Research invariants:** `batch` never sent to client; `events`/`profileHistory` append-only (research dataset); demo generator never touches real accounts.
8. **AI dispatcher contract (5 functions + usage shape)**; any new AI feature must be a new dispatcher method, never a direct SDK call.
9. **Fail-closed startup + 8 s graceful shutdown** assume SIGTERM with ≥8–20 s patience (tuned across all three hosts).
10. **`GOOGLE_CLOUD_PROJECT` presence is a behavior switch** — `NOVA_AI_BACKEND` must stay explicitly pinned or deploys silently flip to the paid Vertex-Claude path.
11. **Express 5 + no-build frontend**; CSP tightening requires extracting the inline script first.
12. **Seed-once semantics** (empty DB only) must not regress.

## Deliverable 9 — Top reusable assets (kept as-is or extended in V3)

1. **Deterministic financial core** (`cashbook.js`, `metrics.js`, `simulasi-kur.js`, `fokus-harian.js`, `konteks-usaha.js`) — pure, tested, single-sourced, framework-free. The product's crown jewels.
2. **The 446-test suite** with its isolation pattern (temp data dir + port 0 + fake Anthropic SSE) — extensible to any V3 feature.
3. **AI layer**: dispatcher + prompts + schemas + sanitizers + budget system — provider-portable by contract.
4. **Dual-use shared modules** (same file powers node tests and browser) — a proven pattern for "one formula, one place".
5. **Curriculum content** (29 modules, 1,487 ln) + schedule gating + server-verified practice — pure data + logic, reusable in any UI.
6. **Validator instruments** (materi 25 items, IT 25 items) + server-side scoring + manager download.
7. **Security core**: `guard.js` (CSP, headers, CGNAT-aware limiter, HTTPS redirect), consent engine, `aset.js` pre-compression, `kesehatan.js` fail-closed gate.
8. **Research pipeline**: `logEvent` stream, export/anonymize scripts, validasi store.
9. **Demo-data generator** (seeded, deterministic, self-rehydrating) — durable for sales/jury demos.
10. **Deployment plumbing**: cloudbuild pipeline with test gate, Dockerfile/entrypoint with seed restore, systemd+nginx path, `/api/health` contract.

## Deliverable 10 — Top risks for V3 evolution (ranked)

1. **Storage ceiling vs V3 ambition** — JSON whole-file store + single instance bounds users (~50–100 comfortable, ~300 painful, <1,000 untenable). Any V3 scale-out, background job, or notification feature hits this first. Changing it means replacing `store.js` semantics, not tuning.
2. **Frontend change risk** — all V3 UI work lands in a 4,406-line untested file; the one prior structural regression proves the failure mode. No automatable UI net exists (the Emergent agent reports were the only E2E layer).
3. **Silent-zero AI spend** — the usage contract failure mode has no alarm; a provider/model switch in V3 can disable budgets with zero errors until the invoice.
4. **Config divergence** — up to four config sources per env var; TRUST_PROXY off on Cloud Run (per-IP lockout buckets behind router IP); backups near-noop on Cloud Run; `GOOGLE_CLOUD_PROJECT` switch trap.
5. **Committed secrets + demo openness** — PAT + validator code in history; codes 101–120 public on the login screen; no gating between jury traffic and research data.
6. **Coverage holes in exactly the live paths** — PostgreSQL path zero tests; Gemini transport (the production provider) barely tested; chat happy path (delta→done→persist) has no route-level test; deletion routes untested at HTTP level.
7. **Consent/compliance drift** — consent text names Claude while production uses Gemini; provider changes require a consent version bump; deletion leaves copies in backups/validasi.json.
8. **Test suite runtime economics** — ~222 s with ~115 s deliberate sleeping (clock injection missing) discourages adding the coverage V3 needs.
9. **Research-product entanglement** — B1/B2 batches, events, consent, validator flows are woven through core paths; loosening them for a general product breaks the research dataset invariants (and vice versa).

---

## Appendix A — Docs vs code drift (validated)

| Claim (doc) | Reality (code) |
|---|---|
| "Claude Sonnet 5" (server.js:4, README ×5, prompts.js:2, claude.js:2) | `claude-3-5-sonnet-20241022` / `claude-3-5-sonnet-v2@20241022` / `gemini-2.5-flash` |
| "10 modul" (server/README), "14 modul praktis" (landing), "Kelas 14 sesi" (demo tour) | 29 modules = 7 sessions + 22 library (`kurikulum.js`) |
| README budgets 10,000/50,000 | Code defaults 60,000/300,000 (`anggaran.js:28-29`) |
| PRD: frontend/.env has MONGO_URI + REQUIRE_PERSISTENT | Actual: `NOVA_STORAGE=json`, no Mongo vars |
| Consent text: data goes to "Claude (Anthropic)" | Production: Gemini on Vertex (`frontend/.env:3`) |
| Chat UI "AI Gemini 2.5" hardcoded (×4–6) | Ignores the `model` field the server actually sends in SSE `done` |
| server.js:1703 references `PANDUAN-VALIDASI.md` | File does not exist |
| "16 onclick" comment (server.js:1847) | 27 actual |
| Root README architecture omits MongoDB | `db.js` supports it |

## Appendix B — Investigation provenance

8 subagent investigations (architecture ×2 after one retry, data, financial logic, AI, product ×2 after one retry, infrastructure, testing, technical debt), ~1,400k tokens of tool-driven code reading total, all read-only; every FACT re-derivable from the cited file:line at baseline commit `5d60203`. ASSUMPTIONS of record: (a) Emergent supervisor cwd is `/app/frontend`; (b) coverage map derived by static import/route greps (no coverage tooling in repo); (c) SDK-level behavior of `thinking:{adaptive}`/`output_config` fields not executed to verify.
