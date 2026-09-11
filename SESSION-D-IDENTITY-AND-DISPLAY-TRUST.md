# Session D — AI Identity & Display Trust: First Report (Evidence Phase)

**Role:** AI identity + display trust builder (Session D of the B′ trust program).
**Recorded:** 2026-09-11, against HEAD `c751756` plus the live uncommitted working tree (Sessions A/B/C work, uncommitted).
**Companion documents:** `AI-TRUST-AUTOPILOT-DECISION.md`, `SESSION-A-WRITE-BOUNDARY.md`, `SESSION-B-AI-TRUST-AUDIT.md`, `SESSION-C-BASELINE-AND-GATES.md`.

**No code modified by this session yet.** Everything below is repository evidence.

---

## 1. Verified repository facts

| # | Fact | Class | Evidence |
|---|---|---|---|
| 1.1 | Test floor **498 pass / 0 fail** on the current tree (A+B+C work included), Node v24.18.0 win32, ~37 s | **FACT — verified this session** | `test_reports/session-d-baseline-verify.log` (`ℹ tests 498 … pass 498 … fail 0`) |
| 1.2 | Working tree = HEAD `c751756` + 19 modified + 10 untracked files; **all of A/B/C's work is uncommitted** | FACT | `git status --porcelain`; `git log -1` |
| 1.3 | Three AI backends exist: `anthropic` (direct), `vertex` (Claude via AnthropicVertex), `gemini` (Gemini via Vertex AI). Unknown `NOVA_AI_BACKEND` throws fail-closed; no switch → `GOOGLE_CLOUD_PROJECT ? vertex : anthropic` | FACT | `server/lib/backend.js:22-41` |
| 1.4 | Runtime model differs per path: `getModel()` returns `claude-3-5-sonnet-v2@20241022` on vertex, `claude-3-5-sonnet-20241022` otherwise; Gemini: `GEMINI_MODEL` env or `gemini-2.5-flash` | FACT | `claude.js:28-31`, `gemini.js:50-52` |
| 1.5 | **`modelAktif()` misidentifies the Vertex path**: `ai.js:25` returns `claude.MODEL` (the direct-API constant `claude-3-5-sonnet-20241022`) when backend is `vertex`, while the actual request uses `getModel()` = `claude-3-5-sonnet-v2@20241022` | FACT (bug) | `ai.js:24-26` vs `claude.js:28-31`; consumed at `server.js:381` (`/api/health`), `server.js:968` (chat SSE `done`), `server.js:2213` (startup banner), `smoke.js:74` |
| 1.6 | Chat SSE `done` frame carries `model: modelAktif()`; the frontend handler reads `payload.anggaran` and `payload.terpotong` and **ignores `payload.model`** | FACT | `server.js:968`; `server/public/index.html` `prosesBingkai` (`event === 'done'` branch) |
| 1.7 | Frontend hardcodes **"AI Gemini 2.5" in 6 sites** in `server/public/index.html` (meta description, `.ai-note` disclaimer, recommendation stamp, online status, chat history meta, live chat meta). The frontend never reads a runtime model value anywhere | FACT | grep `server/public/index.html` lines 7, 1127, 2288, 2327, 2368, 2522; no `.model` read exists |
| 1.8 | Consent instrument hardcodes the provider: "sebagian datamu dikirim ke layanan Claude (Anthropic)" — factually wrong when `NOVA_AI_BACKEND=gemini` | FACT | `server/lib/consent.js:43` |
| 1.9 | Consent **version machinery exists and has precedent for exactly this**: v2 exists because v1's statement was wrong (`consent.js:17-28`); `hasConsented` compares stored `consent.versi` to `CONSENT_VERSION` | FACT | `consent.js:17-28,69-72` |
| 1.10 | Persisted AI outputs and their metadata — see §4 inventory | FACT | store.js routes (details in §4) |
| 1.11 | Recommendations are the **only persistent AI output read back by three surfaces** (Saran tab, Fokus Harian rule 7, public card) | FACT | `server.js:832-835` comment; `server.js:506,648`; `fokus-harian.js:157-168` |
| 1.12 | Fokus Harian rule 7 surfaces stored AI prose (`peringatan[0]`, ≤200 chars) as the daily focus `alasan`, for recommendations **of any age** | FACT | `fokus-harian.js:157-168`; `server.js:648` passes `req.user.recommendations` unfiltered |
| 1.13 | Public card takes only `judul` (≤120 chars) + `prioritas` from recommendations, renders them under "Catatan utama" mixed with system-computed numbers, and the card disclaimer attributes everything to "catatan pemilik usaha sendiri" (the owner's own records) — AI-derived titles presented with **no AI attribution** on an unauthenticated public page | FACT | `server.js:499-544`; `kartu.html:132-140` |
| 1.14 | The recommendation stamp claims "berdasarkan profil usaha **terbaru**" unconditionally, regardless of age; profile save **does** null recommendations (`store.js:747`), but cashbook changes do not, and there is no age treatment anywhere | FACT | `index.html:2288`; `store.js:746-748` |
| 1.15 | Missing provider usage silently becomes zero: Gemini `keUsage(null)` → all zeros (pinned as desired behavior in `gemini.test.js:86`); `hitungToken` coerces missing fields to 0 (`\|\| 0`); `catatUsage` aggregates daily `{tanggal, token}` only — **absent usage and true zero are indistinguishable** downstream | FACT | `gemini.js:126-134`; `gemini.test.js:84-91`; `anggaran.js:67-75`; `store.js:1153-1165` |
| 1.16 | Check-up results are never persisted (screen-only) — consistent with Fokus Harian's own header claim | FACT | `server.js:1326-1329` (returns `hasil`, records usage only); `fokus-harian.js:23` |
| 1.17 | Latihan-AI questions persist the whole sanitized question with `pada` timestamp and answer state — no model identity | FACT | `store.js:926-933` (`aturLatihanAI`) |
| 1.18 | Demo account seeds curated (deterministic, human-authored) recommendations with `generatedAt: ${hariIni}T02:00:00Z` — the UI will stamp them "oleh AI Gemini 2.5" | FACT | `demo-data.js:466-530` |
| 1.19 | `store.saveRecommendations` (store.js:745) has **no callers** outside its definition (legacy) — `simpanRekomendasi` is the live path (Session B wiring at `server.js:839`) | FACT | grep repo-wide |

## 2. AI identity flow map

```
NOVA_AI_BACKEND env ──► backendAI() ──► 'anthropic' | 'vertex' | 'gemini'
                                           │
             ┌─────────────────────────────┘
             ▼
lib/ai.js (dispatcher)
  ├─ impl()            → gemini.* | claude.*          (correct)
  ├─ modelAktif()      → gemini.modelAktif() | claude.MODEL   ← WRONG on 'vertex' (1.5)
  ├─ isConfigured()    → vertex: project id only; anthropic: key check; gemini: project id
  └─ streamChat / generateRecommendations / analyzeCheckup / analyzeLatihanAi / analyzeNota

Identity consumers:
  /api/health   → { model: modelAktif(), aiConfigured }        (server.js:381)
  /api/login    → { aiConfigured } — NO model                  (server.js:405)
  chat SSE done → { model: modelAktif(), terpotong, anggaran } (server.js:968)
  startup banner→ modelAktif() + backend label                 (server.js:2213-2219)
  smoke.js      → modelAktif()                                 (smoke.js:74)

Frontend: consumes NONE of the above model fields; renders hardcoded "AI Gemini 2.5" (1.7).
```

**Authority classification of user-visible identity:** runtime identity is server-known (env + selected impl), so a truthful label is fully deterministic server-side. There is no honest path to "AI Gemini 2.5" when the runtime is Claude — the label is currently a lie in 2 of 3 backend configurations (anthropic, vertex), and on gemini it is only accidentally right (hardcodes "2.5" while `GEMINI_MODEL` can be anything).

## 3. Display trust map (what the user is told, by surface)

| Surface | What is shown | AI-derived? | Labeled as AI? | Freshness signal | Verdict |
|---|---|---|---|---|---|
| Saran tab (index.html:2288) | ringkasan + 5 rec items + stamp "Dibuat <genAt> oleh AI Gemini 2.5 · berdasarkan profil usaha **terbaru**" | yes | yes — but model label hardcoded, "terbaru" claim unconditional | `generatedAt` rendered as date only; no age framing | model = lie off-gemini; staleness claim overstates |
| Fokus Harian (rule 7) | AI `peringatan[0]` as the daily focus `alasan`, titled "Ada peringatan dari **rekomendasi terakhirmu**" | yes | partial — source attributed, but on a surface whose header advertises deterministic rules; no model, no age | none — any age fires | acceptable attribution, missing freshness bound |
| Public card `/kartu/:token` | rec `judul`s (≤120 ch) under "Catatan utama" beside system-computed omzet/laba/skor; disclaimer says content comes from "catatan pemilik usaha sendiri" | yes (titles) | **no** | `dibuatPada` = fetch time, **masks** rec age | worst offender: public + mis-attributed |
| Chat live + history | meta line "AI Gemini 2.5 · <time>" hardcoded both paths | yes | yes — wrong model label off-gemini | `ts` per message (good) | model label lie |
| Konsultan status | "Online · AI Gemini 2.5" | — | — | — | model label lie |
| Meta description + `.ai-note` | "AI Gemini 2.5" in product disclaimer | — | — | — | model label lie |
| Check-up | server-computed frame + AI status items (screen-only) | yes (items) | sanitized via `sanitasiCheckup`; UI frames as "penilaian AI" | ephemeral — nothing stale | OK |
| Latihan AI | AI question, deterministic grading (server) | question only | grading explicitly non-AI | `pada` timestamp stored; UI OK | OK |

## 4. Persisted AI metadata inventory

| Artifact | Where persisted | Timestamps | Model/provider | Usage link | Notes |
|---|---|---|---|---|---|
| Recommendations | `user.recommendations` (`simpanRekomendasiKe`, store.js:1181-1189) | `generatedAt` (ISO) | **none** | usage recorded same write | sanitizer output `{ringkasan, rekomendasi[], peringatan[], targetBulanIni[]}` + generatedAt. No prompt, no money payload — compliant with B′ |
| Chat turns | `user.chat` (max 60) via `simpanGiliranChat` (store.js:1006) | `ts` per message | **none** | usage same write | assistant message = `{role, content, ts}` only; truncated answers carry `POTONG` marker in text |
| Latihan AI question | `user.latihanAI[no]` via `aturLatihanAI` (store.js:926) | `pada`, `terakhir` on answer | **none** | usage recorded separately (two writes — A's domain) | holds `kunci` — correctly never in publicUser |
| Check-up | **not persisted** | — | — | usage recorded | screen-only |
| Nota scan | raw extraction merged only via participant-confirmed cashbook write (A's boundary) | — | — | usage recorded | AI is reader, never recorder |
| tokenLog | `user.tokenLog` daily aggregate `{tanggal, token}` | day only | none | — | zero ≡ missing (1.15) |
| Events (`jejak` registry) | `recommendations_generated {jumlah, peringatan}`, `chat_turn {pesan[, modul]}`, `latihan_ai_dibuat {modul}`, `latihan_ai_dijawab {modul, benar, konsep?}` | event time | none | — | `konsep` (≤40 ch AI-derived) already adjudicated by C as free-text allowlist entry |

**Minimal metadata strategy (proposed, no new infrastructure):** add one additive field `model` (value of the *truthful* runtime identity string, e.g. `claude-3-5-sonnet-v2@20241022`) at persistence time for recommendations, chat assistant messages, and latihan-AI questions. Stamped by the route (composition point) through existing store calls — store stays schema-stupid, no migration (JSON store, additive fields are backward compatible; readers ignore unknown fields). This is the entire persistence delta. No prompts, no snapshots, no proposal payloads.

## 5. Staleness dependency map

```
profile_saved ──────────────► recommendations = null      (already exists — store.js:747)
transaction added/changed ──► (nothing)                   recommendations stay
time passes ────────────────► (nothing)                   recommendations age unbounded
consumers of user.recommendations:
  ├─ GET /api/recommendations      → any age
  ├─ /api/fokus rule 7             → any age              (server.js:648)
  ├─ public card insights          → any age; dibuatPada masks age (server.js:543)
  └─ publicUser (login payload)    → any age
```

Materially stale axes: (a) profile change — already handled; (b) cashbook drift — recommendations are advisory prose, mostly profile-derived; the cashbook summary was a snapshot at generation time, but invalidating on every transaction would constantly destroy paid-for output (and push regenerations = cost). Decision: cashbook drift does **not** invalidate; it is covered by age framing; (c) age — the only unhandled axis.

**Smallest deterministic freshness contract (proposed):**
1. Fokus rule 7 ignores recommendations older than a named constant (30 days, WIB-calendar comparison consistent with `anggaran.js` conventions) — falls through to rule 8/9. One constant, one comparison, fully testable.
2. Saran stamp tells the truth: renders generation date + relative age ("disusun N hari lalu") and drops the unconditional "terbaru" claim.
3. Public card projection gains `insightGeneratedAt` (additive whitelist field) so the public page can stamp insight age instead of the fetch-time `dibuatPada` masking it.
No invalidation engine, no background scheduler, no event churn.

## 6. Usage observability map

```
provider response
  ├─ anthropic: final.usage (SDK guarantees shape; absent → undefined propagates today)
  └─ gemini:    usageMetadata per chunk → keUsage(meta)    (meta absent → keUsage(null) = all zeros — 1.15)
        │
        ▼
route: usage ──► store.simpanGiliranChat / simpanRekomendasi / recordUsage
        │
        ▼
catatUsage: hitungToken(usage) ──► daily {tanggal, token}       (0 ≡ missing)
        │
        ▼
ringkasAnggaran / cekAnggaran (pre-check uses PERKIRAAN estimates, not the log)
```

Key architectural facts: the **pre-call budget gate already runs on estimates** (`PERKIRAAN`, `anggaranToken` middleware) — so enforcement does not depend on recorded usage. The recorded log exists to keep the *post-hoc* accounting truthful. Therefore the honest fix for 1.15 is narrow: when a provider returns **no usage at all**, the recorded debit should be the same estimate the gate already charged against (marked as estimated), instead of a proven-zero 0. A provider that reports a genuine all-zero is a different case and stays 0. `keUsage(undefined) → zeros` stays as-is — it is the pinned translation contract for a *given* metadata object (`gemini.test.js:86`); the wrapper stops feeding it `null` and returns `null` instead, so absence survives to the accounting layer. Implementation point: routes translate `usage == null → { …PERKIRAAN[jenis], perkiraan: true }`; `catatUsage` stores the additive `perkiraan` flag. No store schema change, no jejak event, no anggaran.js semantics change.

## 7. Files/functions owned by Session D

**Modified:**
| File | Change |
|---|---|
| `server/lib/ai.js` | `modelAktif()` → `claude.getModel()` on non-gemini paths (fixes 1.5) |
| `server/lib/gemini.js` | streamChat/generateRecommendations/analyzers return `usage: null` when `usageMetadata` absent (translation fn unchanged) |
| `server/lib/claude.js` | `?? null` on returned usage; fix stale header comment ("Claude Sonnet 5" vs actual 3.5) |
| `server/server.js` | login response + persisted stamps: pass runtime `model` into `simpanRekomendasi` / `simpanGiliranChat` / `aturLatihanAI`; translate `usage == null` → estimate+flag; `/api/login` gains additive `model` |
| `server/lib/store.js` | `simpanRekomendasiKe` stamps `model`; `catatUsage` honors additive `perkiraan` flag; assistant message passes through `model` (all additive) |
| `server/lib/fokus-harian.js` | rule 7: max-age constant |
| `server/public/index.html` | all 6 hardcoded labels → runtime label from login/SSE; truthful stamp wording; age framing |
| `server/public/kartu.html` | render `insightGeneratedAt` when present |
| `server/server.js` (kartu projection) | additive `insightGeneratedAt` field |
| `server/lib/consent.js` | provider-accurate wording + `CONSENT_VERSION` bump (mechanism exists; precedent = v2) — see risk R1 |

**Created:** `server/test/identitas-ai.test.js` (identity + persistence-stamp + usage-absence gates), additions to `fokus-harian.test.js` (rule-7 age cap).

**Read-only / untouched:** `rekomendasi.js` (B's contract), `jejak.js` (C's registry — no new event types), `cashbook.js`, financial mutation paths, `cloudbuild.yaml`, `smoke.js`, `backend/tests/*` (E/F territory).

## 8. Conflicts with other active sessions

- **Session A** owns `store.js`/`server.js` mutation paths — my store/server edits are confined to recommendation/chat/latihanAI stamping + `catatUsage` flag; no mutator, no event, no route-wiring overlap. Residual risk: A landing further work in the same tree mid-flight (C observed this). Mitigation: small, additive, well-separated hunks.
- **Session B** owns `rekomendasi.js` — I do not touch the sanitizer contract; stamping happens *after* it, at persistence.
- **Session C** owns `jejak.js` + export filtering + batches 3/4 (`kegagalan.test.js`, `uji-hidup`, cloudbuild, smoke pricing) — I add **no** event types and do not touch smoke/cloudbuild. My `identitas-ai.test.js` uses the same conventions (per-file tmp `NOVA_DATA_DIR`, fake SSE server) but is a separate file.
- **Session E** (failure injection, SSE resilience): my chat-route changes are payload-shape only (additive fields), not transport/failure semantics; no `jedaGagal`/fake-server ownership overlap.
- **Session F** (post-deploy evidence): my `/api/health` model-correctness fix is a *dependency* for F's identity evidence, not a conflict; I change nothing in deploy infrastructure.

## 9. Implementation batches

| Batch | Content | Gates killed | Risk |
|---|---|---|---|
| **D1** | `ai.js` modelAktif Vertex fix + truthful `model` through `/api/login`, chat `done` (already there), health (fix flows free); `identitas-ai.test.js` part 1: vertex identity, unknown-backend fail-closed already covered by backend contract — pin identity per backend | stale/misleading runtime identity (health/SSE/banner) | low |
| **D2** | Persistence stamps: `model` on recommendations/chat/latihanAI (route→store additive); tests: persisted objects carry the runtime model; demo path does **not** claim a model it never used (curated seed stamped `sintetis` or left model-less — decided at implementation, one line either way) | persisted AI without provenance; era ambiguity | low-medium (store.js/shared) |
| **D3** | Usage absence: providers return `usage: null` on absence; routes debit `PERKIRAAN[jenis]` with `perkiraan: true`; tests: absent ≠ zero ≠ estimate-silent; genuine zero stays 0; budget math unaffected | missing usage silently proven zero | medium (touches usage accounting paths shared with budget tests) |
| **D4** | Display trust: index.html runtime label + truthful stamp + age framing; fokus rule-7 age cap + test; kartu `insightGeneratedAt` + render | deterministic surface presenting AI prose as owner/system truth; stale reuse | low (frontend + fokus) |
| **D5** | Consent wording → provider-accurate, `CONSENT_VERSION = 3` + test; header comment fixes in claude.js | consent lying about processor identity | **gated on R1 sign-off** |

D1–D4 are safe to begin on the current tree. D5 lands only after R1 (below) is acknowledged.

## 10. Explicit risks

- **R1 (consent re-consent ripple):** bumping `CONSENT_VERSION` forces every existing participant through re-consent on next login. That is the *honest* behavior when the disclosure changes (precedent: v1→v2), but it is a research-protocol decision touching participant flow — flagged for program-owner confirmation, not silently landed. Alternative if refused: leave consent text, but that keeps a factually false statement in a legal-ish instrument.
- **R2 (uncommitted tree):** all prior-session work is uncommitted. If anything resets the tree, 498-test floor and my base vanish. Recommendation: A/B/C land (commit) their work before or atomically with mine; my batches are additive to minimize collision surface.
- **R3 (usage-estimate debit):** debiting the estimate when usage is unknown errs conservative (never understates billing) but slightly overcharges a participant's budget window when providers drop usage. The alternative (record 0 + flag, no debit) keeps budgets exact but re-creates the cost leak. Estimate-debit matches the architecture's own philosophy (the gate already charges `PERKIRAAN` before the call).
- **R4 (frontend test surface):** index.html is a 4k-line inline-JS single file with no frontend test harness. Identity regressions there are pinned by a source-literal scan (jejak-style: "no hardcoded model label may exist in index.html") rather than DOM tests — deliberately, to avoid inventing a frontend test framework in this session.
- **R5 (validasi instruments):** `validasi.html` / `validasi-it.js` contain static "AI Gemini melalui Google Vertex AI" descriptions (and a "fallback & retry" claim). These are self-assessment instruments, not runtime identity surfaces; changing them is cosmetic truthfulness deferred unless the owner wants it — noted, not owned.
- **R6 (demo fiction):** demo recommendations are curated, and the UI currently stamps them as AI-generated. A demo is explicitly a fictional showcase; still, the model label there should either be omitted or explicitly marked — decided in D2, flagged here for visibility.

## First-response mandates

1. **Verified:** §1 (all rows independently checked this session), including the 498/498 floor re-run.
2. **Previous claims no longer matching the repo:** only two corrections — (a) the hardcoded labels live in `server/public/index.html`, **not** `frontend/` (that directory is an empty package.json shell); (b) "may appear on public surfaces" is precise: the public card exposes AI-derived *titles only* (≤120 chars), never full prose — still a real mis-attribution (1.13), but bounded. Everything else in the prior findings list held up exactly.
3. **Still open:** consent version-bump authorization (R1); demo-stamp choice (R6); validasi instrument wording (R5); whether Fokus rule-7 age cap should be 30 days or another named constant (constant proposed, value is a product call).
4. **Ownership boundary:** §7 files only; E and F boundaries respected per §8.
5. **Implementation safe to begin:** **yes, batches D1–D4**, on the current tree, additive-only; **D5 gated** on R1.
