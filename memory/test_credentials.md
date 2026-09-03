# Novaro — Test Credentials

Base URL (preview): https://3ea54680-0765-44b8-b063-7e921fa89739.preview.emergentagent.com

## App login (access-code auth)
- Header: `Authorization: Bearer <code>`
- Valid demo access codes: **101 – 120** (20 auto-seeded demo accounts).
- No-code demo login: `POST /api/demo` returns a fresh rotating code, or click
  **"Coba tanpa kode – Mode Demo"** on the `/app` login screen.

## Validator sheet
- Route: **/validasi** (page returns 200).
- `VALIDASI_KODE=emergent2026` (validator access code used to submit the validation form).

## Notes
- The Google Vertex service-account key is NEVER stored here or in any tracked file.
  Preview keeps it at `/app/credentials/novaro-sa.json` (gitignored). Production uses
  `GOOGLE_CREDENTIALS_B64` set in Emergent Deploy env vars.
- Data is ephemeral (JSON storage under `/app/server/data`) and reseeds 20 accounts on first boot.
