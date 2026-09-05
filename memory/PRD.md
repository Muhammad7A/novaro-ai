> **2026-06 sync (HEAD 09b5b90):** Codebase now on upstream main with MongoDB adapter (`server/lib/mongo-store.js`; `lib/db.js` selects `mongo` when MONGO_URI/MONGO_URL is set). `frontend/.env` (loaded by Node via dotenv) has `MONGO_URI=mongodb://localhost:27017/novaro` (Emergent-managed Mongo = backend/.env MONGO_URL + DB_NAME) and `NOVA_REQUIRE_PERSISTENT_STORE=1` (fail-closed: server exits if Mongo unreachable — intentional, do not remove). `/api/health` reports `penyimpanan.jenis:"mongo"`, `peserta:20`. Persistence verified across supervisor restart via `GET /api/cashbook` (`/api/me` does not list transactions by design). Old "JSON-only storage" rule is superseded.

> **2026-06 mobile layout fix (CSS only, `server/public/index.html` ~L535-560):** restored `.tabbar{display:none}` + `@media (max-width:640px){…}` wrapper around the tabbar/#toast block and collapsed `.hero-row,.grid-2,.grid-3,.form-grid,.mod-grid,.report-sign` to 1 col / `.kas-summary` to 2 cols on mobile. Verified by testing agent (iteration_2.json, 100%). No JS touched. This change is LOCAL to the workspace (not yet on GitHub main 09b5b90) — use "Save to GitHub" to sync. `npm test` in /app/server: 445/445 pass ONLY when the stale git-ignored `/app/server/.env` (FORCE_HTTPS=1 etc., leftover from an earlier session, not used by the running app whose cwd is /app/frontend) is moved aside; with it present ~121-126 tests fail. `/app/server/.env` DELETED (2026-06, owner-approved); npm test now 445/445 hermetic, health/AI unaffected (iteration_3.json 100%). Layout fix auto-committed locally as 33f9350 — owner to push via "Save to GitHub", then Publish; post-publish smoke pending (health mongo/20 → transaction → redeploy → survived + still mongo).
> Deferred by owner: Backup Export behind validasi page (REJECTED — validator/participant-data boundary; only behind a separate admin token), Streak Reminder (post-contest).



# Novaro — PRD / Deployment Adaptation Notes

## What this is
Novaro (formerly "Nova Explorer") — an Indonesian UMKM financial-coaching web app built for the
**Building Indonesia AI Contest by Emergent**. It is a single **Node.js 20 / Express (ESM)** monolith
in `/app/server` (`server.js`, `lib/`, `public/index.html`) that serves both the HTML SPA and all
`/api/*` endpoints, including SSE streaming on `/api/chat`.

- Storage — THREE backends, one priority order (first set wins):
  1. `DATABASE_URL` → PostgreSQL (Cloud SQL / own server)
  2. `MONGO_URI` (or MONGODB_URI/MONGO_URL/MONGODB_URL) → MongoDB — the MANAGED DB Emergent
     provides in production Publish. One document per user in the `users` collection
     (`_id` = user id, whole user object stored as-is). Empty collection seeds once from
     JSON/users-seed.json, same as the Postgres path.
  3. neither → JSON files under `NOVA_DATA_DIR` (`/app/server/data`) — dev/test/CLI/preview.
     EPHEMERAL on redeploy: accepted for the contest demo (demo accounts reseed), NOT for real users.
- Production safety: set `NOVA_REQUIRE_PERSISTENT_STORE=1` in Emergent Deploy env vars. With it set
  and no DATABASE_URL/MONGO_URI, the server REFUSES TO START (exit 1, loud banner) instead of
  silently writing to ephemeral disk. `GET /api/health` reports the active backend as
  `penyimpanan.jenis` (`json|mongo|postgres`) and pings the DB for real on non-json backends.
- Write semantics on mongo/postgres: load-all into memory cache → flush = upsert all users +
  delete rows/docs absent from memory (so deleteUser really deletes). SINGLE-WRITER app: run ONE
  Node instance only (in-process write queue + per-pod file lock do not span replicas).
  Redeploy: data survives (DB is external); boot re-reads from DB; backups (`npm run backup`)
  are JSON-only — for mongo/postgres, back up server-side (mongodump/pg_dump); the CLI refuses
  and says so on non-json backends.
- Auth: access-code based — `Authorization: Bearer <code>`. `POST /api/demo` logs in a rotating demo account.
- AI: **Gemini on Google Vertex AI** (`NOVA_AI_BACKEND=gemini`, `GEMINI_MODEL=gemini-2.5-flash`,
  `CLOUD_ML_REGION=us-central1`, project `project-421f02fa-4c0b-4b27-b30`), authenticated by a Google
  service account. Do NOT switch to Claude-on-Vertex (404, model not enabled). Do NOT add any Emergent
  LLM key or other AI provider.
- No React, no Mongo usage, no new DB, no framework changes. Dockerfile untouched. Code-level changes only.

## Emergent adaptation (in-repo)
Ingress: `/api/*` → port 8001 (FastAPI proxy), everything else → port 3000 (Node app).
- `/app/frontend/package.json` — frontend supervisor service; `start` = `node /app/server/server.js`
  (pure node command, no shell shim), `postinstall` installs `/app/server` deps.
- `/app/backend/server.py` — FastAPI + httpx streaming reverse proxy → `NOVA_UPSTREAM=http://127.0.0.1:3000`,
  sets `x-forwarded-proto: https` + `x-forwarded-for`, strips hop headers, streams body (SSE works).
- `/app/backend/.env` (tracked) — Mongo placeholders (unused) + `NOVA_UPSTREAM`.
- `/app/frontend/.env` (tracked) — Node runtime config (dotenv loads it since cwd is `/app/frontend`).
  `GOOGLE_CREDENTIALS_B64` kept EMPTY in this tracked file. `PUBLIC_HOST`/`REACT_APP_BACKEND_URL` = preview host.
- `/app/server/.env` (gitignored) — same vars for local/preview.
- `.gitignore` ignores `.env`, `*.env`, `credentials/`, `node_modules/`, `server/data/*`, but un-ignores
  `!backend/.env` and `!frontend/.env`.
- `server.js` startup: if `GOOGLE_CREDENTIALS_B64` set and `GOOGLE_APPLICATION_CREDENTIALS` unset, it
  base64-decodes the key to a temp file (0600) and points `GOOGLE_APPLICATION_CREDENTIALS` at it.
- Only ONE Node process runs (single writer / no seed race). Start only via supervisor.

## Credentials
- Preview: SA key decoded to `/app/credentials/novaro-sa.json` (gitignored, mode 0600).
  `GOOGLE_APPLICATION_CREDENTIALS=/app/credentials/novaro-sa.json`.
- SA key / base64 is NEVER written to any tracked file.
- Production: set `GOOGLE_CREDENTIALS_B64` and `PUBLIC_HOST` in Emergent Deploy → Environment Variables.

## Status (verified 2026-06 on preview host 3ea54680-0765-44b8-b063-7e921fa89739)
All verification-checklist items PASS:
- `GET /api/health` → 200, ok:true, storage read/write ok, 20 participants, aiConfigured:true, model gemini-2.5-flash.
- `GET /` → 200, Novaro logo + sky background + "Building Indonesia AI Contest by Emergent" footer.
- `GET /app` → SPA loads, both demo and access-code (101–120) logins reach dashboard (health score + "Fokus usaha hari ini"); all 6 nav tabs work; zero app console errors on first load.
- `GET /validasi` → 200.
- `POST /api/demo` + `GET /api/me` → 200. `POST /api/cashbook` → 201 and persists to JSON.
- Live AI: `POST /api/checkup` → 200 real Gemini insights (~2.7s); `POST /api/chat` → SSE deltas + done through the 8001 proxy (real Gemini).
- Repo pytest suite `/app/backend/tests/test_novaro.py` → 6/6 pass (4 non-AI + 2 live-AI).
- Nothing sensitive tracked: `git grep "BEGIN PRIVATE KEY"` empty; `server/.env` & `credentials/novaro-sa.json` ignored; `backend/.env` & `frontend/.env` NOT ignored.

## Known observations (NOT fixed — out of scope for contest setup; touching inline SPA script is risky)
- The SPA's inline CSS in `server/public/index.html` has a lost `@media (max-width:...)` wrapper around
  the `.tabbar`/`#toast` block: the mobile bottom tabbar shows on desktop and dashboard grids overflow at
  ~390px. Pre-existing on `main`; not a deployment blocker and not on the verification checklist.
- Only console error on `/app` is the Cloudflare analytics beacon blocked by the app CSP (edge-injected, harmless).

## Backlog (P2, optional — owner decision)
- Restore the mobile `@media` wrapper + remove stray `}`/duplicated rules in `index.html` (verify with acorn/CSS lint after).
- Add mobile breakpoints so `.hero-row`/`.grid-2` collapse to one column below ~640px.
- Add `data-testid` attributes to SPA interactive elements.
