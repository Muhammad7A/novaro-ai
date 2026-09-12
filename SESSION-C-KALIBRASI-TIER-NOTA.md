# Session C — Rencana Studi Kalibrasi Tier Scan-Nota

**Status:** DESAIN STUDI — bukan perubahan threshold, bukan implementasi. **Tanggal:** 2026-09-12.
**Rujukan:** `AI-TRUST-AUTOPILOT-DECISION.md` §2.6 (tier dari keyakinan-diri model, tanpa bukti kalibrasi), §18 (matriks bukti: kalibrasi 0.85/0.60 = nol bukti di semua rung), §21.6 (threshold adalah milik nota — tidak boleh pindah antar-surface tanpa argumen kalibrasi), §16 (protokol model-bump); rel proposal G-4 (commit `70439ec`).

---

## 1. Pertanyaan studi

Ambang keyakinan nota (ok ≥ 0.85 / warning ≥ 0.60 / low < 0.60, `lib/nota.js:133-143`) menentukan seberapa keras kartu konfirmasi memperingatkan peserta SEBELUM baris menyentuh buku kas. Ambang itu belum pernah diukur terhadap keputusan manusia sungguhan. Pertanyaannya bukan "apakah angka itu benar" melainkan:

> **Seberapa sering keputusan manusia menyimpang dari sinyal tier — dan ke arah mana?**

Tier yang tinggi tapi sering ditolak/ditinggalkan = terlalu percaya diri. Tier rendah tapi sering diterima apa adanya = terlalu menakut-nakuti. Keduanya kerusakan kepercayaan yang berbeda, dan keduanya hari ini tak terlihat.

## 2. Sumber data — bentuk yang SUDAH landed (G-4), bukan rencana

| Data | Bentuk | Catatan |
|---|---|---|
| Usulan tampil | event `proposal_shown {id, tier?}` | menunggangi tulisan `recordUsage` rute scan (nol tulisan baru); tanpa nominal/teks bebas |
| Dikonfirmasi | baris transaksi dengan `origin` proposal + `proposalId` | diturunkan lewat join shown ⋈ baris — TIDAK ada event penerimaan (§21.2) |
| Ditolak eksplisit | event `proposal_rejected {id, alasan?}` | kosakata alasan tertutup (`lib/proposal.js:165`) |
| Tier saat konfirmasi | terbawa di dalam token HMAC (`payload.tier`) | konsistensi tier token vs tier event bisa diperiksa silang |

Kosakata tier: `ok` / `warning` / `low`. Gerbang rilis (`NOVA_PROPOSAL_SCAN`, rahasia token) default MATI — data hanya terkumpul setelah gerbang dibuka di lingkungan yang sah.

## 3. Kelas luaran (outcome) yang TERUKUR dari instrumentasi hari ini

| Kelas | Definisi operasional | Sumber |
|---|---|---|
| **dikonfirmasi** | baris dengan `proposalId` id-event shown | join shown ⋈ transaksi |
| **ditolak** | event `proposal_rejected` untuk id tsb. | events |
| **ditinggalkan** | shown TANPA baris dan TANPA penolakan, lewat jendela berlaku token (TTL) + 7 hari | konvensi shown-without-row (dokumen keputusan §9.3) |

**Batas permanen yang dicatat jujur (bukan kekurangan yang bisa "diperbaiki" diam-diam):**

1. **Buta-edit.** Muatan usulan mati bersama respons HTTP (B′) — "diterima apa adanya" vs "dikonfirmasi setelah diedit" TIDAK dapat dibedakan dari data, karena membedakannya butuh delta event yang justru DILARANG §21.2 (amandemen tanpa-delta). Ini kembar dari batas audit delta-nominal yang sudah diputuskan.
2. **Buta-kategori untuk yang bukan dikonfirmasi.** `kategori` hidup di muatan usulan yang menguap; hanya BARIS konfirmasi yang punya kategori — rincian per kategori karenanya hanya tersedia atas subkumpulan terpilih (bias seleksi; lihat §6).
3. **Alasan ditinggalkan tidak pernah terekam** — by design (tidak ada pertanyaan gangguan di alur konfirmasi).

## 4. Metrik

Untuk setiap tier `t ∈ {ok, warning, low}` atas jendela analisis:

- **Tingkat keputusan per tier:** `n_t(dikonfirmasi) / n_t(shown)`, `n_t(ditolak) / n_t(shown)`, `n_t(ditinggalkan) / n_t(shown)` — dengan interval kepercayaan Wilson 95% (ukuran sel kecil adalah norma, bukan pengecualian).
- **Matriks tier × outcome** (3×3 + marginal) — bentuk laporan utama; TIDAK diringkas jadi satu skor.
- **Divergensi berarah** (definisi pra-registrasi, supaya kesimpulan tidak dipilih setelah lihat data):
  - *Overconfident*: tingkat konfirmasi tier `ok` ≤ tingkat konfirmasi tier `warning` pada rung yang sama.
  - *Overcautious*: tingkat penolakan + ditinggalkan tier `low` < tingkat konfirmasi tier `low` — orang menerima saja apa yang disebut tak bisa dipercaya.
  - *Silang-tier*: urutan tingkat konfirmasi `ok > warning > low` yang TIDAK monoton.
- **Konsistensi era**: semua angka di-label model + era prompt saat pengumpulan; bukti kalibrasi TIDAK diwariskan antar era (protokol model-bump §16).

## 5. Ukuran sampel dan rung pelaporan

| Rung |Shown events| Tujuan | Yang boleh disimpulkan |
|---|---|---|---|
| R1 | ≥ 50 | kelayakan arah | tidak ada kesimpulan; hanya daur data diperiksa (join, duplikasi, kualitas) |
| R2 | ≥ 200 | estimasi awal | matriks + CI Wilson; divergence HANYA dilaporkan, tidak ditindak |
| R3 | ≥ 500 | keputusan | argumen perubahan threshold boleh diajukan bila kriteria §7 terpenuhi |

Syrat minimum sel: argumen perubahan mensyaratkan ≥ 30 kejadian pada sel tier×outcome yang menjadi dasarnya, dan replikasi arah pada ≥ 2 rung. Di bawah itu, kata yang benar adalah "belum terukur", bukan "aman".

## 6. Bias dan penyesuaiannya

1. **Seleksi inisiatif** — hanya scan yang dijalankan peserta; nota penting-mahal mungkin justru yang dipindai. Tidak ada penyesuai kausal; laporan menyatakan cakupan, bukan generalisasi.
2. **Sensor ditinggalkan** — alasan ditinggalkan tak diketahui (sinyal lemah, UI, lupa). Analisis sensitivity: hitung ulang tanpa kelas ditinggalkan (hanya konfirmasi vs tolak).
3. **Bias seleksi kategori** (§3.2) — rincian kategori hanya atas yang dikonfirmasi; sampaikan sebagai "kategori yang dikonfirmasi", jangan "kategori usulan".
4. **Ketergantungan gerbang** — periode gerbang MATI menghasilkan nol shown; jendela analisis memotong pada tanggal gerbang, bukan menahuninya.
5. **Satu model satu era** — angka tidak digabung lintas model/era tanpa uji heterogenitas eksplisit.

## 7. Apa yang dihitung BUKTI untuk mengubah threshold

Semua harus terpenuhi, bukan sebagian:

1. Divergensi berarah (§4) yang terreplikasi pada ≥ 2 rung, arah sama, CI Wilson yang tidak tumpang tindih pada sel berbasis ≥ 30 kejadian.
2. Ditulis sebagai argumen kalibrasi eksplisit (threshold baru, basis data, dampak ke kartu konfirmasi) — persis artefak yang diminta §21.6 sebelum threshold dipindah/dipakai ulang antar-surface.
3. Threshold tetap milik nota: tidak ada transfer ke surface lain tanpa argumen kalibrasinya sendiri.
4. Perubahan mengikuti protokol era (bump `PROMPT_ERA`/sanitizer-era bila penyebabnya di sana; catatan kalibrasi; uji kontrak).

## 8. Mekanika analisis (sketsa, read-only)

Data lengkap ada di `users.json` per peserta; jalur analisis tanpa menyentuh produksi:

```
per pengguna:
  shown    = events.filter(type='proposal_shown')          → {id, tier}
  tolak    = events.filter(type='proposal_rejected')       → {id}
  konfirm  = transactions.filter(origin=proposal)          → {proposalId}
  outcome(id) = konfirm ∋ id ? 'dikonfirmasi'
              : tolak ∋ id  ? 'ditolak'
              : (now > shownTs(id) + TTL + 7d) ? 'ditinggalkan' : 'berjalan'  # dikecualikan
agregasi: tier × outcome → CI Wilson → matriks + daftar divergensi
```

**Ketergantungan terbuka (bukan pekerjaan sesi ini):** kolom `origin`/`proposalId` belum ada di `transactions.csv` ekspor (direncanakan §23f dokumen keputusan; wilayah window G) — sampai itu landed, analisis berjalan atas `users.json` (identitas penuh); setelahnya, atas ekspor anonim yang sama dengan berbagi riset biasa. `events.csv` anonim sudah memuat `proposal_shown/rejected` apa adanya (meta kosakata tertutup — lolos penyaringan teks bebas tanpa perubahan).

## 9. Yang TIDAK dilakukan dokumen ini

- Tidak mengubah 0.85 / 0.60 maupun pemetaan tier-ke-kartu.
- Tidak menambah jenis event, medan meta, atau array persisten apa pun.
- Tidak menjadikan studi ini gerbang CI/rilis — kalibrasi adalah syarat ARGUMEN, bukan syarat hijau.
