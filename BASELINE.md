# Novaro AI — V3 Engineering Baseline

**Status: immutable reference.** This document records the exact state of the code at the moment Novaro AI V3 development begins. Every future change must be traceable against this baseline. No feature work, no redesign, no refactoring is reflected here.

- **Baseline tag:** `v3-baseline`
- **Baseline branch:** `baseline/v3`
- **Baseline commit:** `5d60203e938611fa07366fb40282d701b41d740d`
- **Baseline test run log:** `test_reports/baseline-2026-09-08-node24-win.log` (kept untracked — the repo's `.gitignore` excludes `*.log` by policy; exact results are recorded verbatim in §6)
- **Recorded:** 2026-09-08

---

## 1. Repository identity

| Field | Value |
|---|---|
| New repository | `Muhammad7A/novaro-ai` (private) — independent V3 development baseline |
| Source repository | `Muhammad7A/nova-explorer-emergent` (private) — GitHub sync target of the Emergent app `novaro-indonesia-ai` (job `c4f041b3-1240-437c-b64d-8ef9ceae6652`) |
| Relationship | Full-history clone of the source at its HEAD; upstream preserved as git remote `emergent-upstream` |
| App | **Novaro** — finance companion for Indonesian UMKM: cash book (buku kas), financial health score, AI consultant, KUR loan simulation/reports, receipt scan, public business health card |
| Lineage | `Muhammad7A/app` → `Muhammad7A/emergent` → `Muhammad7A/nova-explorer-emergent` → **`Muhammad7A/novaro-ai`** (V3 evolves independently from here) |
| Language | JavaScript (Node.js ESM), single Python proxy shim |

## 2. Current commit

- **SHA:** `5d60203e938611fa07366fb40282d701b41d740d`
- **Message:** `Landing footer: drop research-project copyright, brand as Novaro`
- **Parent context:** recent history includes landing redesign (dark aurora pure-CSS), app background change, production storage switch to JSON (`51d51b9`).
- Working tree at baseline: **clean** (no modifications).

## 3. Branch

- **`main`** — the only branch; tracks `origin/main` (`Muhammad7A/novaro-ai`).
- `emergent-upstream/main` — preserved pointer to the Emergent source (`nova-explorer-emergent`).
- `baseline/v3` + tag `v3-baseline` — frozen baseline pointers created at preparation time.

## 4. Architecture summary

Single Node.js/Express monolith. **No redesign is permitted in V3 without architectural justification.**

```
Browser (single-file SPA)  ──►  Node.js/Express (server/server.js, port 3000)
                                     │
                                     ├─► AI: Gemini 2.5 Flash on Vertex AI (current)  |  Claude/Anthropic  |  Claude via Vertex
                                     └─► Storage: JSON files (current)  |  PostgreSQL  |  MongoDB
```

- **True entry point:** `server/server.js` (2,218 lines) — serves the SPA and ~45 `/api/*` routes, incl. SSE streaming chat (`POST /api/chat`).
- **`backend/` is an Emergent platform shim, not the app backend:** a 58-line FastAPI reverse proxy (`backend/server.py`, port 8001 → 3000) that exists so SSE chat survives Emergent's dual-port ingress.
- **`frontend/` is also a shim:** `frontend/package.json` has no frontend code; it boots `node /app/server/server.js` so the Emergent supervisor starts the app. Because Emergent runs it with cwd `/app/frontend`, **`frontend/.env` is the de-facto production runtime config**.
- **Data layer** (`server/lib/db.js`, selector `pilihPenyimpanan`): explicit `NOVA_STORAGE` (`json|mongo|postgres`) wins; else `DATABASE_URL` → PostgreSQL; else any `MONGO_*` URL → MongoDB; else JSON files in `NOVA_DATA_DIR` (atomic tmp+rename writes, in-process write queue, per-process file lock `server/lib/kunci.js`). **Committed production config = JSON storage, single-writer by design (`--max-instances=1`).** `NOVA_REQUIRE_PERSISTENT_STORE=1` makes startup fail-closed on ephemeral storage.
- **AI provider wiring:** `server/lib/ai.js` dispatches to `claude.js` (Anthropic SDK or AnthropicVertex) or `gemini.js` (`@google/genai`, VertexAI mode via ADC). Selection in `server/lib/backend.js` via `NOVA_AI_BACKEND` (invalid values throw at request time). All paths normalize usage to Anthropic shape so token budgeting (`server/lib/anggaran.js`) works unchanged.
- **Financial math is server-side** (`server/lib/metrics.js`, `server/lib/cashbook.js`); AI only explains/annotates. Prive (personal drawings) separated from business cost; "real numbers beat estimates" threshold; partial months never presented as full months.
- **Auth:** access-code login (`POST /api/login`), sha256 code hash, `Authorization: Bearer <code>`, per-IP failed-attempt lockout (`server/lib/guard.js`).

## 5. Current features (all implemented; none to be removed in V3)

| Feature | Implementation |
|---|---|
| Buku kas (cash book) | `POST/GET/DELETE /api/cashbook`; `server/lib/cashbook.js` |
| Search & filter | `GET /api/cashbook` query params (`saringTransaksi`) |
| Health score 0–100 + dashboard | `GET /api/papan`; `server/lib/metrics.js` |
| Health timeline (per month) | `GET /api/timeline` |
| "Apa yang berubah?" month compare | `GET /api/perubahan` |
| Daily business focus / context | `GET /api/fokus`, `GET /api/konteks` |
| AI consultant chat (SSE) | `POST /api/chat`; `server/lib/prompts.js` |
| AI recommendations | `GET/POST /api/recommendations` |
| AI financial check-up | `POST /api/checkup`; `server/lib/checkup.js` |
| Scan nota (receipt OCR) | `POST /api/scan-nota` — raw image (4 MB cap), magic-byte sniffing (`server/lib/nota.js`); proposes only, save goes through the normal cashbook route |
| KUR simulation (client sliders) | `/simulasi-kur.js` → `server/lib/simulasi-kur.js` (6% flat p.a.; AMAN/KETAT/TERLALU BERAT thresholds shared with metrics.js — one formula, node + browser) |
| KUR bank-ready report (3–12 mo, print/PDF) | `GET /api/report` |
| Public health card (read-only, no login) | `POST /api/kartu`, `GET /api/kartu/publik/:token`, `GET /kartu/:token` → `server/public/kartu.html` |
| Micro-learning curriculum (10 modules) | `server/lib/kurikulum.js`, `/modul.js`, `GET/POST /api/latihan/:no`, progress/schedule routes (`server/lib/jadwal.js`, `latihan.js`, `praktik.js`) |
| "Putar ulang" replay film | `/putar-ulang.js` → `server/lib/putar-ulang.js` |
| Demo mode (5 personas, self-reseeding) | `POST /api/demo`; `server/lib/demo-data.js` |
| Access-code auth + lockout | `POST /api/login`; `server/lib/guard.js` |
| Consent / data rights / feedback | `GET/POST /api/consent`, `GET /api/my-data`, `DELETE /api/my-account`, `POST /api/feedback` |
| Research validator sheets (inert without `VALIDASI_KODE`) | `/validasi`, `/validasi-it`; `server/lib/validasi.js`, `validasi-it.js`, `validasi-store.js` |
| Ops: backups, budgets, rate limit, graceful shutdown, JSON logs, `/api/health` | `server/lib/backup.js`, `anggaran.js`, `log.js`, `kesehatan.js` |

No payment/billing system exists. Nothing is stubbed.

## 6. Test baseline (exact recorded result)

**Command (canonical, matches Cloud Build CI):** `cd server && npm ci && npm test`
(`npm test` = `node --test --test-concurrency=1`, suite: `server/test/*.test.js`, 37 files, ~8,100 lines; AI is mocked via local fake `ANTHROPIC_BASE_URL`; isolated temp `NOVA_DATA_DIR` per test.)

**Baseline run — 2026-09-08, Node v24.18.0, Windows (Git Bash), npm 12.0.2:**

```
ℹ tests      446
ℹ suites     0
ℹ pass       446
ℹ fail       0
ℹ cancelled  0
ℹ skipped    0
ℹ todo       0
ℹ duration_ms 221842
```

- **Exit code: 0.** Full log preserved locally at `test_reports/baseline-2026-09-08-node24-win.log` (untracked per `*.log` ignore policy).
- Note: `test_reports/iteration_3.json` (prior Emergent-agent record) reported **445** pass. The suite has since grown by one test; the delta is expected drift, not a regression. New canonical floor: **446 / 0**.
- Not part of `npm test`: `backend/tests/test_novaro.py` (6 pytest live-integration tests against a deployed preview URL, incl. 2 live Gemini calls) and `server/scripts/smoke.js` (`npm run smoke`, one real paid AI call). Neither was run for this baseline.

## 7. Known deployment dependencies

- **Emergent platform (current production host):** supervisor runs `frontend/package.json` start → Node on :3000; ingress `/api/*` → Python proxy :8001 → :3000. `PUBLIC_HOST=novaro-indonesia-ai.emergent.host`. `.emergent/` cron machinery is platform-managed ("DO NOT EDIT").
- **Cloud Run path:** `cloudbuild.yaml` → test step (`npm ci && npm test` on `node:22-slim`) → `server/Dockerfile` image → Artifact Registry → Cloud Run `novaexplorer`, region **asia-southeast2 (Jakarta)**, `--max-instances=1` (single-writer requirement), 1 vCPU / 512 Mi, timeout 300 s (SSE), `--allow-unauthenticated`. Secret Manager: `anthropic-api-key`; optional `nova-seed-users`, `nova-validasi-kode`, `nova-validasi-pengelola`.
  - ⚠ Cloud Run filesystem is ephemeral → committed JSON storage loses data on instance recycle; the pipeline's `--update-*` (not `--set-*`) convention is load-bearing.
- **Alternative path (documented "Jalan B/C"):** Compute Engine via `server/deploy/` (nginx + hardened systemd unit) + Dockerfile entrypoint seed restore.
- **Local dev:** Node ≥ 20 (Dockerfile pins `node:22-slim`; baseline test machine ran v24.18.0 — green). npm only, no build step, no frontend bundler.
- `sync.sh` resets the Emergent workspace to GitHub `origin/main`.

## 8. Environment dependencies

Production-relevant environment variables read by the code:

- **Secrets/credentials:** `ANTHROPIC_API_KEY` (or Vertex via ADC: `GOOGLE_APPLICATION_CREDENTIALS` / `GOOGLE_CREDENTIALS_B64` decoded by server.js into a 0600 temp file); `VALIDASI_KODE`, `VALIDASI_PENGELOLA_KODE` (validator access codes).
- **AI selection:** `NOVA_AI_BACKEND` (`anthropic|vertex|gemini`; invalid throws), `GEMINI_MODEL` (default `gemini-2.5-flash`), `GOOGLE_CLOUD_PROJECT`/`VERTEX_PROJECT_ID`/…, `CLOUD_ML_REGION`/`VERTEX_REGION` (default `us-central1`), `TEST_IGNORE_NOVA_AI_BACKEND` (test-only).
- **Storage:** `NOVA_STORAGE` (`json|mongo|postgres`), `DATABASE_URL`, `MONGO_URI`/`MONGODB_URI`/`MONGO_URL`/`MONGODB_URL`/`MONGO_DB`, `NOVA_DATA_DIR`, `NOVA_REQUIRE_PERSISTENT_STORE`, `NOVA_SEED_USERS_FILE`.
- **HTTP/security:** `PORT`, `TRUST_PROXY`, `FORCE_HTTPS` (deliberately unset in production — platform edge TLS), `PUBLIC_HOST`, `LOGIN_MAX_ATTEMPTS` (20), `LOG_FORMAT` (`json`), `SHUTDOWN_TIMEOUT_MS` (8000).
- **Quotas/ops:** `RATE_LIMIT_PER_HOUR` (40), `TOKEN_BUDGET_DAILY` (60k), `TOKEN_BUDGET_WEEKLY` (300k), `BACKUP_KEEP` (14), `BACKUP_EVERY_HOURS` (24), `NODE_ENV`, `TZ` (`Asia/Jakarta`), `NOVA_HEALTH_CACHE_MS`/`NOVA_HEALTH_COUNT_MS`, `UNLOCK_ALL_MODULES`/`BUKA_SEMUA_MODUL`, `NOVA_UPSTREAM` (Python proxy), `REACT_APP_BACKEND_URL` (pytest only).

**Current committed production config** (`frontend/.env`, tracked deliberately — Emergent build context requires it): JSON storage, Gemini backend, Vertex project `project-421f02fa-4c0b-4b27-b30`, us-central1, `TZ=Asia/Jakarta`, `NOVA_DATA_DIR=/app/server/data`. `backend/.env` (tracked): `NOVA_UPSTREAM` only. The SA key itself lives at untracked `/app/credentials/novaro-sa.json`. No AI key material is committed; Cloud Build injects `ANTHROPIC_API_KEY` from Secret Manager.

**🚨 SECURITY FLAGS (pre-existing, inherited from the source repo — action required outside this baseline):**
1. **`sync.sh` contains a committed GitHub PAT** (`github_pat_11BGN6…`, embedded in the origin URL; read-only scope per the file's own comment, self-declared "revoke after the contest"). **Recommendation: revoke the token and strip it from the file/history in a dedicated, justified commit — not casually during V3 work.**
2. **`memory/test_credentials.md` commits a validator code** (`VALIDASI_KODE=emergent2026`), preview URL, and demo codes 101–120.

## 9. High-risk files (modification risks breakage, data loss, or secret leaks)

| File | Risk |
|---|---|
| `server/lib/store.js` (1,005 ln) | All JSON persistence: cache, write queue, atomic tmp+rename, seed logic. Wrong change silently corrupts/loses every user's cash book. |
| `server/lib/db.js` | Storage selector precedence + Postgres schema init + Mongo connect. Reordering silently migrates where data lives. |
| `server/lib/mongo-store.js` | Upsert-all + delete-missing semantics; breaking delete-missing resurrects deleted users on restart. |
| `server/lib/kunci.js` | Cross-process file lock; removing it breaks the single-writer guarantee. |
| `server/lib/guard.js` | Auth, timing-safe compare, security headers, login throttle. Regressions = auth bypass or lockout of all users sharing an IP. |
| `server/lib/backend.js`, `server/lib/ai.js` | AI provider switch; strict rejection prevents silently billing the wrong provider. |
| `server/lib/anggaran.js` + `keUsage` contract in `claude.js`/`gemini.js` | If usage field names diverge, token budgets read zero → unbounded spend. |
| `server/server.js` | Route order matters (raw-body scan-nota before `express.json`; auth middleware coverage). |
| `server/public/index.html` (4,406 ln) | The entire SPA inline; a CSS/JS slip breaks the whole client (past incident: lost `@media` wrapper, see `test_reports/iteration_1.json`). |
| `frontend/.env`, `backend/.env` | Tracked runtime config; edits flip production storage/AI backend. |
| `sync.sh` | Contains the live PAT (see §8). |
| `server/lib/kesehatan.js` | Fail-closed startup gate; weakening it lets production run on ephemeral storage silently. |
| `server/lib/backup.js` | Backup scheduling/retention — data-recovery last resort. |

## 10. Files not to be modified without explicit architectural justification

- `server/server.js` — sole entry point and routing table; ordering-sensitive middleware.
- `server/lib/db.js`, `store.js`, `mongo-store.js`, `validasi-store.js` — data layer and backend-selection contract.
- `server/lib/ai.js`, `backend.js`, `claude.js`, `gemini.js`, `prompts.js` — provider wiring and the prompt/schema contract shared by all providers.
- `server/public/index.html` — the whole client; plus the other user-facing shells `landing.html`, `kartu.html`, `validasi.html`.
- `server/lib/simulasi-kur.js` — deliberately dual-use (node import **and** browser `<script type="module">`); changing its export style breaks one side.
- `server/package.json` + `server/package-lock.json` — the exact test command Cloud Build CI gates on; `engines` pins Node ≥ 20.
- `cloudbuild.yaml` — deployment pipeline; `--update-*` (not `--set-*`) convention is load-bearing (a `--set-env-vars` would wipe manually added runtime vars).
- `server/Dockerfile` + `server/docker-entrypoint.sh` — image, non-root user, PID 1 (`dumb-init`), seed restore.
- `.gitignore`, `.gcloudignore`, `server/.dockerignore` — deliberate asymmetries (`!frontend/.env`, `!backend/.env`, `!server/data/users-seed.json`) control what enters build contexts.
- `backend/server.py`, `frontend/package.json` — Emergent ingress proxy and service launcher; deleting either kills platform deploys.

### Repo artifacts (context, not app code)

`.claude/settings.json` (plugin marketplace setting), `memory/` (Emergent agent memory; `PRD.md` partially stale vs current `.env` — e.g. it still describes Mongo-first storage), `test_reports/` (Emergent testing-agent JSON reports, iterations 1–3 + this baseline's log), `.gitconfig` (Emergent commit identity), `.emergent/` (platform cron machinery).

---

## Baseline governance

1. `v3-baseline` / `baseline/v3` pin commit `5d60203e938611fa07366fb40282d701b41d740d`. **Do not move or delete them.**
2. Every V3 change ships as a traceable commit/PR against `main`; PRs should state their delta relative to this baseline.
3. The test floor is **446 pass / 0 fail** (§6). Any V3 change that lowers the count or turns a test red without an explicitly justified, recorded decision is a regression.
4. The two security flags in §8 must be resolved in dedicated, reviewed commits — never folded into feature work.
