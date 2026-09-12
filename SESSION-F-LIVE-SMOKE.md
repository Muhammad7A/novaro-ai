# Session F — Live Smoke Evidence Report

**Role:** Live AI evidence & deployment builder (Session F of the B′ trust program).
**Recorded:** 2026-09-12, against local `main` at `31e1bca` (session-g3). NOTE: at recording time these commits — `13e1a86` (B), `af7d07e` (E), `3c2febd`/`55288a9`/`31e1bca` (G1–G3) — were **not yet on `origin/main`** (local ahead 5); the 2026-09-11 evidence below is committed at `61efe69` (`v3-integration-freeze-2`), which IS on origin.
**Companion documents:** `AI-TRUST-AUTOPILOT-DECISION.md` (§17–18 evidence levels), `SESSION-C-BASELINE-AND-GATES.md` (§8 batch 4), `SESSION-E-FAILURE-INJECTION.md`.

**Why this report exists:** until now the program's only live-AI-evidence account lived in chat transcripts and the artifacts themselves. This is the missing standing record: what was proven, on exactly which deployment, and — just as important — what was NOT.

---

## 1. The deployment this evidence binds to

All facts below were read directly from the GCP project (`project-421f02fa-4c0b-4b27-b30`, read-only `gcloud`) and from the deployed service's own responses/logs on 2026-09-11.

| Fact | Value | Class |
|---|---|---|
| Service / region | `novaexplorer` @ `asia-southeast2`, `https://novaexplorer-532597100979.asia-southeast2.run.app` | FACT |
| Revision serving 100% traffic | `novaexplorer-00097-2vt`, created 2026-08-31T14:38:52Z | FACT |
| Image | `asia-southeast2-docker.pkg.dev/…/muhammad7a-claude-code-testing/novaexplorer:d7e6c9d5efc1f8b3911169987d4fd437557d9fe5` | FACT |
| Provenance of that image | NOT built by the committed `cloudbuild.yaml` (different Artifact Registry path, generation-97 config carries Cloud SQL Postgres env, `UNLOCK_ALL_MODULES`, plaintext validation codes, dead vars) — deployed by an earlier/different tool | FACT (config), OPEN QUESTION (which tool) |
| Runtime identity | default compute SA `532597100979-compute@developer.gserviceaccount.com`; roles include `roles/aiplatform.user`; `aiplatform.googleapis.com` enabled | FACT |
| Effective AI region | `us-central1` — via the **code fallback** in `gemini.js`/`claude.js`; the service carries `VERTEX_LOCATION=us-central1`, a name the code never reads, and no `CLOUD_ML_REGION` | FACT |
| Storage on that revision | Cloud SQL Postgres via unix socket (`USE_POSTGRES=true`), not the `/tmp/data` JSON mode the committed pipeline comments describe | FACT |
| A second, stale service | `novaexplorer` @ `europe-north1` exists, superseded | FACT |

## 2. The five dated artifacts of 2026-09-11

All in `test_reports/`, committed at `61efe69`. Secret-scan clean on all five: demo access codes redacted, service env allowlisted (5 keys by value, rest name-only), no provider keys, no database URLs.

| Artifact (UTC) | Result | What happened |
|---|---|---|
| `…T152928Z…json` | LULUS (health-only) | `/api/health` 200, `gemini-2.5-flash`, `aiConfigured:true`. **Explicitly NOT AI evidence** — labeled as such in-artifact. |
| `…T153003Z…json` | **GAGAL** | First full attempt: health ✓, demo ✓, `/api/checkup` → **500 in 145 ms** (too fast for a provider round trip; no tokens billed). Deployed runtime's own Cloud Logging names the cause: komponen `checkup`, *"analyzeCheckup is not defined"* — the Aug-31 bundle contains a `/api/checkup` route whose dispatcher method its own `lib/ai.js` never exported. An internally inconsistent bundle, caught by exactly the probe built for it. |
| `…T153500Z…json` | LULUS (chat) | Real AI call through the deployed identity: SSE, 3 delta chunks, 80 chars, **3,029 token units recorded by the server's budget accounting**, chat history cleaned afterwards (200). Identity section empty — tool bug (Node ≥20.12 refuses to spawn `gcloud.cmd` without a shell, `spawn EINVAL`), fixed immediately after. |
| `…T153640Z…json` | LULUS (chat) | 2 chunks, 73 chars, 2,943 token units; **full runtime-identity evidence**: SA, role list, `roles/aiplatform.user: true`, `apiVertexAktif: true`. Revision field still null (this service never populates `status.latestCreatedRevision`). |
| `…T153819Z…json` | **LULUS — canonical** | 3 chunks, 94 chars, **2,996 token units**, revision `novaexplorer-00097-2vt` recorded via `status.traffic[0].revisionName`, cost estimate ~Rp 124 upper bound (Gemini 2.5 Flash $0.30/$2.50 per 1M, as-of 2026-09-11, labeled in-artifact). `catatan: []` — zero collection errors. |

**The one-sentence claim these support:** on 2026-09-11, revision `novaexplorer-00097-2vt` of `novaexplorer` performed a real, streamed Gemini call through its Cloud Run runtime identity, and the server's own accounting recorded the provider usage — with a dated, redacted artifact to show for it.

## 3. Evidence level after this session

Against decision §17–18:

- **Chat rung: PROVEN on the production host** (dated, revision-pinned). Previously "Cloud Run production path — L0 for AI".
- **Checkup rung: L0 on this bundle** — diagnosed 500 (see §2). Only a run on a NEW revision can move it.
- **Recommendations rung: L0** — tooling exists since `31e1bca` (`--ai-route rekomendasi`), never executed against any revision.
- **CI execution: L0** — the `_UJI_HIDUP` Cloud Build gate is built-not-run (see §4).

## 4. Boundaries — what this evidence does NOT prove

1. **Binds to the Aug-31 bundle only.** The 00097-2vt image predates the entire committed trust floor (B/C/E/G work landed after). Future revisions need their own rungs; nothing here is forward-valid.
2. **Checkup is broken on that bundle** (`analyzeCheckup is not defined`). Any consumer quoting the 2026-09-11 chat artifact as proof "the AI surface works" is over-reading it: ONE method, one rung.
3. **The `_UJI_HIDUP` Cloud Build step has never executed.** It is code review-verified (YAML parses, script unit-tested) but zero real builds have run it. "CI green" claims about it are currently impossible, not pending.
4. **Operator-initiated, not CI-initiated.** The runs were executed from the operator's machine (gcloud-authenticated) against the deployed URL — the AI call itself was made by the deployed service, but the evidence flow is not yet automated proof.
5. **`CLOUD_ML_REGION=us-central1` is explicit only in the pipeline config, not on the live service.** The live service still carries the dead `VERTEX_LOCATION` var and relies on the code fallback. The artifact records the *effective* region inference, not a service-level setting.
6. **Cost figures are labeled upper-bound estimates** (budget-counter delta priced at output rates); the ground truth is the token count, not the rupiah.
7. **Side effects by design, kept bounded:** each chat run left a small usage-counter delta on a rotating fictional demo account (budget-gated; ~3k of 60k daily) and removed its chat history (`pembersihan` 200). No financial rows, no participant data, anywhere.
8. **Unexplained observation left open:** `/api/health` reports `peserta: 0` on the Postgres-backed service while demo accounts serve normally — not investigated, not owned by Session F.

## 5. Tooling state now (post-G3)

`server/scripts/uji-hidup.js` (zero-dep, Node ≥18) — three selectable rungs via `--ai-route`:
`chat` (default; SSE streaming proof + self-cleanup), `checkup`, `rekomendasi` (overwrites the demo slot in place, reports stored provenance verbatim). Target resolution: `--base` → `/workspace/deploy.log` (CI) → read-only `gcloud describe`. Unit-pinned in `server/test/uji-hidup.test.js`. Canonical floor including it: 587/0 at `31e1bca` (per session-g3 record).

## 6. Required next rungs — PLANNED, NOT EXECUTED (owner authorization outstanding)

Per the standing rule (every method needs its own rung per revision), the next authorized deploy from `main` MUST be followed by, against the NEW revision only:

```bash
node server/scripts/uji-hidup.js --service novaexplorer --region asia-southeast2 --project <PROJECT>
node server/scripts/uji-hidup.js … --ai-route checkup        # must heal on a consistent bundle
node server/scripts/uji-hidup.js … --ai-route rekomendasi    # G-3 rung, first execution
```

…plus one `gcloud builds submit --substitutions=_UJI_HIDUP=1` to convert the gate from built-not-run to executed. **The 2026-09-11 artifacts are frozen to `novaexplorer-00097-2vt` and MUST NOT be cited as evidence for any newer revision.**
