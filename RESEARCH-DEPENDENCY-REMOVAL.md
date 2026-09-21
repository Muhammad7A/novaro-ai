# RESEARCH-DEPENDENCY-REMOVAL

**Keputusan pemilik (2026-09-13):** Novaro V3 adalah produk komersial sejak desainnya — garis keturunannya Nova Explorer (platform riset) → Novaro V2 (Emergent) → V3. Sisa-sisa instrumen riset yang masih menempel di V3 adalah warisan, bukan desain, dan **dihapus** karena membebani komersialisasi. Layanan `novaexplorer` (asia-southeast2, revision `00097-2vt`) tetap menjadi arsip riset yang frozen dan tidak disentuh; penghapusan ini murni di dalam repo V3.

**Klasifikasi audit (diverifikasi dari kode):**

| Residu riset | Lokasi | Keputusan |
|---|---|---|
| Batch B1/B2 waitlist-control | `users.js` (acak), `store.js` `BATCH_SAH` | B1/B2 dihapus; `batch` dipertahankan HANYA sebagai flag `'DEMO'` (karantina showroom tetap berfungsi) |
| `mulaiPada` + `belajar_dimulai` + setJadwal | store, users CLI, jejak | Dihapus (hanya berguna untuk baseline intervensi) |
| Day-gating kurikulum | `jadwal.js`, 5 guard di server.js, 2 test file | **Self-paced**: semua sesi selalu terbuka; bentuk payload `belajar` dijaga agar UI tak berubah |
| Consent riset ("peserta pilot") | `consent.js` v3 | **v4 komersial**: Ketentuan Layanan & Privasi; mekanisme versioning/enforcement/download/delete tetap |
| Instrumen validasi ahli | `validasi{,-it,-store}.js`, 5 rute, `validasi.html`, 5 test file, `VALIDASI_*` env | Dihapus utuh |
| `profileHistory` + ekspor riset | store, export.js (`--anonymize` kolom), demo seed | Dihapus; ekspor data-portability biasa tetap ada |
| `penelitian.test.js` | server/test | Dihapus (menjaga instrumen, bukan produk) |
| Residu V2 Emergent | `backend/`, `.emergent/`, `frontend/`, `.gitconfig`, `sync.sh`, `memory/PRD.md` | Dihapus dari HEAD (sejarah tetap di git) |
| Rebrand demo | `demo-data.js` ("juri kontes") | Showroom penjualan |

**Dipertahankan dan di-reframe sebagai aset komersial:** `jejak` event registry (audit trail + data minimization), provenance/sanitizer/staleness/budget AI (AI governance), consent versioning mechanism, KUR report (fitur pasar Indonesia), demo quarantine, trust floor lainnya.

**Urutan commit:** docs → C (validasi + Emergent) → G (self-paced + demo) → A (model user) → D (consent v4). Floor `cd server && npm test` wajib hijau di tiap commit kode.
