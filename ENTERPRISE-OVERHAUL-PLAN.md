# ENTERPRISE OVERHAUL — PLAN v2

Status: arah DIAPPROVE owner 2026-09-25. Eksekusi menunggu sesi Max-effort + gerbang otorisasi per-item. Semua dilipat ke window G-lanjutan (no new lettered sessions).

## Keputusan terkunci (owner, 2026-09-25)

1. Arah overhaul W1/W2/W3 approved.
2. Bahasa: **flip English langsung** (tanpa jalan i18n dua arah). Pasar = US enterprise.
3. **KUR dihapus** — tetap ada di history git. `simulasi-kur.js` dihapus total.
4. **Kurikulum micro-learning diganti** modul US enterprise finance/accounting. Mesin tetap (kurikulum/jadwal/latihan/praktik + ekspor prompt-nya), konten yang swap.
5. Auth: **infra dulu** (identitas email + fondasi session), implementasi Google OAuth ditunda — slot interfacenya disiapkan supaya OAuth tinggal colok.

## Skope terverifikasi (recon 2026-09-25, HEAD `81c241d`, clean, pushed)

- KUR menyentuh **12 file**: `lib/{consent, demo-data, cashbook, metrics, fokus-harian, kurikulum, latihan, praktik, prompts, simulasi-kur}.js`, `server.js`, dan ketiga `public/*.html`. `kurikulum.js` memuat 20 referensi KUR + 2 modul spesifik-KUR ("Laporan bulanan dan berkas untuk KUR", "Persiapan pengajuan KUR").
- **Seluruh kurikulum** (29 modul, `kurikulum.js` 1.487 baris) bergaya warung-Indonesia (GoFood/ShopeeFood, QRIS, pajak UMKM, NIB, kompor/kulkas/gerobak) → swap konten penuh, bukan cuma KUR.
- Auth hari ini: kode akses (`findByAccessCode` + rate-limit `periksaKodeAkses`) + 5 akun demo rotasi + token kartu. Belum ada email/OAuth.
- UI: vanilla, system font, tema paper/ink; SPA `index.html` ~4,4 ribu baris; `kartu.html` 172; `landing.html` 124.
- Lantai test saat HEAD: 511/0.

## Workstream

- **W3 AUTH INFRA (jalan duluan):** model identitas email (magic-link, tanpa password), manajemen session, kode akses jadi jalur legacy/migrasi, stub interface OAuth. TODO owner nanti (terpisah, butuh otorisasi): OAuth client Google Cloud + Secret Manager.
- **W2 SURFACE FLIP:** copy English menyeluruh (termasuk residu ~47 "peserta/penelitian" di `index.html`), overhaul UI/UX ke **financial trust console** (standard craft-level: reveal + motion pass + elemen alive; audit trail jadi visual kelas satu; coverage score), sapuan bersih KUR 12 file, swap konten kurikulum (usulan di bawah), demo-data jadi rasa bisnis US (USD).
- **W1 GROUNDWORK MERGE:** fase 0 port pattern (behavioral suite + prohibited-topics fail-closed) → fase 1 kontrak API interview sidecar → fase 2 intake/discrepancy-interview MVP → fase 3 examiner + coverage score di rung proposal.

## Usulan modul US enterprise (12, menggantikan 29 modul ID) — dikonfirmasi saat kickoff

1. Chart of Accounts & US GAAP basics
2. Cash vs accrual accounting
3. Month-end close checklist
4. Bank & card reconciliation
5. AP/AR & three-way match
6. Expense categorization & audit trail hygiene
7. 1099 contractor reporting (NEC/K, threshold 2026)
8. Sales tax economic nexus
9. Cash flow & runway
10. Budget vs actuals
11. Financial statements literacy (P&L / Balance Sheet / Cash Flow)
12. Internal controls & segregation of duties

## Urutan eksekusi & gerbang

auth infra → surface flip (EN + UI + KUR + kurikulum) → W1 fase 0 (lokal) → **[GATE owner]** W1 fase 1–2 sidecar + deploy → **[GATE owner]** wiring OAuth + setup Google.

Gerbang test lokal otomatis (`npm test` di HEAD = kanonik). Deploy/billable = otorisasi eksplisit per item. Diam = berhenti.
