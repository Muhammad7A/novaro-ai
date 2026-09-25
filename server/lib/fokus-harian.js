/**
 * Today's Business Focus — one most-important thing, chosen deterministically.
 *
 * ------------------------------------------------------------------
 * KENAPA BERKAS INI ADA
 *
 * Aplikasi ini punya banyak angka; yang tidak dipunyai pemilik usaha adalah
 * WAKTU. Berkas ini menjawab satu pertanyaan: "kalau hari ini saya cuma
 * melakukan SATU hal, apa yang paling penting?" — dari angka usahanya
 * sendiri, dengan aturan tetap yang bisa diuji, bukan dengan menimbang AI.
 *
 * ------------------------------------------------------------------
 * ATURAN MAIN
 *
 *   - FIRST-MATCH-WINS: daftar aturan berurutan dari yang paling mendasar
 *     (mencatat) ke yang paling optimasi (margin). Yang pertama cocok menjadi
 *     satu-satunya fokus — maksimal satu, supaya kartunya menuntut tindakan,
 *     bukan menawarkan menu.
 *   - NOL rumus baru. Semua angka adalah milik computeMetrics/bandingkanBulan;
 *     ambang yang dipakai pun yang sudah ada di aplikasi: status cicilan dari
 *     RASIO_AMAN/BERISIKO (simulasi-cicilan.js), ambang margin 10% yang sama
 *     dengan pewarnaan margin di dasbor. Fokus ini MEMILIH, bukan MENGHITUNG.
 *   - NOL AI. Hasil check-up tidak pernah disimpan (ia hanya dikirim ke layar),
 *     jadi input tersimpan yang bisa dibaca di sini adalah peringatan dari
 *     rekomendasi terakhir — dibaca apa adanya, tanpa dipanggil ulang.
 *   - Setiap fokus punya ALASAN berangka, AKSI yang bisa dieksekusi (halaman
 *     tujuan), dan MODUL terkait bila ada — belajar mengikuti masalah nyata.
 *     Nomor modul mengikuti kurikulum enterprise (101–113).
 *
 * Urutan aturan (pertama yang cocok menang):
 *   0. belum isi profil          → profil adalah pintu semua angka
 *   1. konsistensi mencatat      → tanpa data, semua angka lain perkiraan
 *   2. kas defisit               → arus kas membunuh usaha yang untung
 *   3. rugi                      → struktur harga/biaya
 *   4. prive > laba              → kebocoran yang paling sering
 *   5. cicilan caution/risky     → risiko pinjaman
 *   6. margin tipis              → optimasi harga
 *   7. peringatan rekomendasi    → catatan tersimpan dari saran terakhir
 *   8. komponen skor terlemah    → umum, dari skor yang transparan
 *   9. pertahankan               → tidak ada yang mendesak: pesan positif
 */
import { formatDolar } from './metrics.js';
import { nomorModulSah } from './kurikulum.js';

/**
 * Umur maksimum (hari) peringatan rekomendasi yang masih boleh diangkat
 * aturan 7. Konstanta bernama, bukan angka ajaib: 30 hari kalender — cukup
 * lama untuk tetap relevan, cukup pendek agar nasihat bulan lalu tidak
 * berpura-pura segar.
 */
const UMUR_MAKS_PERINGATAN_HARI = 30;

/**
 * Umur rekomendasi dalam hari kalender, atau null bila tanggalnya absen,
 * bukan tanggal sah, atau dari masa depan (jam server melenceng diperlakukan
 * sama dengan tak diketahui — bukan umur negatif).
 *
 * Gagal-aman berarti DI LUAR jendela: nasihat tanpa tanggal yang bisa
 * dipercaya tidak boleh tampil sebagai "peringatan terakhir".
 */
function umurRekomendasiHari(rekomendasi, kini) {
  const t = Date.parse(rekomendasi?.generatedAt);
  if (!Number.isFinite(t)) return null;
  const hari = Math.floor((kini.getTime() - t) / 86_400_000);
  return hari < 0 ? null : hari;
}

/** Peta aspek skor ke modul yang mengajarkan perbaikannya (label aspek = bahasa Inggris dari metrics.js). */
function modulDariAspek(aspek = '') {
  if (aspek.includes('margin')) return 104; // Read your P&L
  if (aspek.includes('Recording')) return 101; // revenue/profit/cash + recording habit
  if (aspek.includes('Separate')) return 101; // separation is module 101's core
  // 'Business registration (EIN)' dan 'Years in business' — tidak ada modul
  // yang mengajarkan keduanya; null lebih jujur daripada modul yang nyaru.
  return null;
}

/**
 * Susun fokus hari ini.
 *
 * @param {{
 *   punyaProfil?: boolean,
 *   metrics?: object|null,
 *   perubahan?: object|null,
 *   rekomendasi?: object|null,
 *   sesiBerikut?: {no: number, judul: string}|null,
 *   kini?: Date,
 * }} sumber
 * @returns {{id: string, judul: string, alasan: string, aksi: {label: string, halaman: string}, modul: number|null}|null}
 */
export function susunFokusHarian({
  punyaProfil = false,
  metrics = null,
  perubahan = null,
  rekomendasi = null,
  sesiBerikut = null,
  kini = new Date(),
} = {}) {
  if (!punyaProfil || !metrics) {
    return {
      id: 'isi-profil',
      judul: 'Fill in your business profile first',
      alasan: 'Every number, score, and piece of advice is computed from your business profile. Fill it once — you can change it anytime.',
      aksi: { label: 'Fill business profile', halaman: 'profil' },
      modul: null,
    };
  }

  const m = metrics;
  const catatan = m.sumber === 'catatan';
  const setara = m.disetarakan ? ' (full-month equivalent pace)' : '';

  /* 1 — konsistensi: tanpa catatan yang rapat, semua angka lain cuma perkiraan. */
  if (!catatan) {
    const alasan = m.catatanBelumCukup
      ? `This month has ${m.hariTercatat} of ${m.hariBerjalan} elapsed days recorded — the dashboard still runs on your profile estimates. The denser your records, the more real every number gets.`
      : 'Nothing recorded this month yet — the dashboard still runs on your profile estimates. One transaction today already changes that.';
    return {
      id: 'konsistensi',
      judul: 'Get this month\'s recording rhythm back',
      alasan,
      aksi: { label: 'Record today\'s transactions', halaman: 'kas' },
      modul: 101,
    };
  }

  /* 2 — kas defisit: fakta saldo, bukan opini. */
  if ((m.saldoKas ?? 0) < 0) {
    return {
      id: 'kas-defisit',
      judul: 'Cash balance is negative — check your cash flow',
      alasan: `Cash balance ${formatDolar(m.saldoKas)}. Net profit ${formatDolar(m.labaBersih)}${setara} — the money moved into inventory, equipment, or debt, or owner draws are outpacing profit.`,
      aksi: { label: 'Open the Cash Book', halaman: 'kas' },
      modul: 111,
    };
  }

  /* 3 — rugi: fakta laba. */
  if (m.rugi) {
    return {
      id: 'rugi',
      judul: 'This month is a loss — review prices and costs',
      alasan: `Net profit ${formatDolar(m.labaBersih)} (margin ${m.marginBersih}%)${setara}. Repeated losses almost always trace to selling prices, input costs, or sales volume — check all three in the report.`,
      aksi: { label: 'Open the report', halaman: 'laporan' },
      modul: 104,
    };
  }

  /* 4 — prive lebih besar dari laba: kas terkikis pelan-pelan. */
  if ((m.prive ?? 0) > 0 && m.labaBersih > 0 && m.prive > m.labaBersih) {
    return {
      id: 'prive-lebih-besar-dari-laba',
      judul: 'Owner draw exceeds profit — set a fixed salary',
      alasan: `Owner draw ${formatDolar(m.prive)} is larger than profit ${formatDolar(m.labaBersih)}${setara} — business cash is draining faster than it is earned. Take a fixed draw, once a week or once a month.`,
      aksi: { label: 'Review draws in the Cash Book', halaman: 'kas' },
      modul: 101,
    };
  }

  /* 5 — cicilan: status dari ambang safe/caution/risky yang sama dengan simulasi cicilan. */
  if (m.statusCicilan && m.statusCicilan !== 'safe') {
    return {
      id: 'cicilan',
      judul: m.statusCicilan === 'risky'
        ? 'Loan payments are above the risky threshold'
        : 'Loan payments are nearing the safe limit',
      alasan: `Loan payments ${formatDolar(m.cicilanSaatIni)} = ${m.bebanCicilan}% of net profit — your safe ceiling is ${formatDolar(m.maxCicilanSehat)}/month. One slow month is enough to miss a payment.`,
      aksi: { label: 'Simulate a payment', halaman: 'laporan' },
      modul: 111,
    };
  }

  /* 6 — margin tipis: ambang 10% yang sama dengan pewarnaan margin di dasbor. */
  if (m.marginBersih >= 0 && m.marginBersih < 10) {
    return {
      id: 'margin-tipis',
      judul: 'Net margin is thin — review your pricing',
      alasan: `Net margin ${m.marginBersih}%${setara} — below 10%, costs eat nearly all revenue. Check the lowest-margin items before thinking about selling more.`,
      aksi: { label: 'Open the report', halaman: 'laporan' },
      modul: 104,
    };
  }

  /* 7 — peringatan tersimpan dari rekomendasi terakhir (tanpa memanggil AI).
   *
   * Jendela umur: nasihat AI yang tersimpan membara sesuai angka pada HARI ia
   * disusun. Memangkatnya berminggu-minggu kemudian seolah masih "peringatan
   * terakhir" adalah dusta kesegaran. Maka aturan 7 hanya berlaku bila
   * rekomendasinya cukup muda; di luar jendela (atau tanpa tanggal yang bisa
   * dipercaya) aliran jatuh ke aturan 8/9 yang murni deterministik.
   */
  const peringatan = rekomendasi?.peringatan?.[0];
  const umurHari = umurRekomendasiHari(rekomendasi, kini);
  const dalamJendela = umurHari !== null && umurHari <= UMUR_MAKS_PERINGATAN_HARI;
  if (typeof peringatan === 'string' && peringatan.trim() && dalamJendela) {
    const modulTerkait = rekomendasi?.rekomendasi?.[0]?.modulTerkait;
    return {
      id: 'peringatan-rekomendasi',
      judul: 'There is a warning from your latest recommendations',
      // Umur disebut saat ia ada — pengguna menilai sendiri kebaruannya.
      alasan:
        (umurHari > 0 ? `Generated ${umurHari} days ago. ` : '') + peringatan.trim().slice(0, 200),
      aksi: { label: 'Open advice', halaman: 'rekomendasi' },
      modul: nomorModulSah(modulTerkait) ? Number(modulTerkait) : null,
    };
  }

  /* 8 — komponen skor terlemah: ambil yang rasionya terendah, urutan daftar
     jadi penentu bila seri (deterministik). Catatannya teks bawaan skor. */
  const komponen = Array.isArray(m.komponenSkor) ? m.komponenSkor : [];
  const terlemah = komponen
    .filter((k) => k.maks > 0 && k.poin < k.maks)
    .sort((a, b) => a.poin / a.maks - b.poin / b.maks)[0];
  if (terlemah) {
    return {
      id: 'komponen-skor',
      judul: `Strengthen: ${terlemah.aspek}`,
      alasan: `"${terlemah.aspek}" scored only ${terlemah.poin}/${terlemah.maks} — ${terlemah.catatan}.`,
      aksi: { label: 'See score breakdown', halaman: 'dasbor' },
      modul: modulDariAspek(terlemah.aspek),
    };
  }

  /* 9 — tidak ada yang mendesak: pesan positif yang tetap membawa langkah. */
  return {
    id: 'pertahankan',
    judul: 'Nothing urgent — keep the rhythm',
    alasan: `No urgent issue shows in your numbers today. Keep the recording rhythm — next up: ${sesiBerikut?.judul ?? 'the library paths'}.`,
    aksi: { label: 'Continue learning', halaman: 'modul' },
    modul: sesiBerikut?.no ?? null,
  };
}
