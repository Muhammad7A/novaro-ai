/**
 * Fokus Usaha Hari Ini — satu hal terpenting, dipilih secara deterministik.
 *
 * ------------------------------------------------------------------
 * KENAPA BERKAS INI ADA
 *
 * Aplikasi ini punya banyak angka; yang tidak dipunyai pemilik warung adalah
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
 *     RASIO_AMAN/BERISIKO (simulasi-kur.js), ambang margin 10% yang sama
 *     dengan pewarnaan margin di dasbor. Fokus ini MEMILIH, bukan MENGHITUNG.
 *   - NOL AI. Hasil check-up tidak pernah disimpan (ia hanya dikirim ke layar),
 *     jadi input tersimpan yang bisa dibaca di sini adalah peringatan dari
 *     rekomendasi terakhir — dibaca apa adanya, tanpa dipanggil ulang.
 *   - Setiap fokus punya ALASAN berangka, AKSI yang bisa dieksekusi (halaman
 *     tujuan), dan MODUL terkait bila ada — belajar mengikuti masalah nyata.
 *
 * Urutan aturan (pertama yang cocok menang):
 *   0. belum isi profil          → profil adalah pintu semua angka
 *   1. konsistensi mencatat      → tanpa data, semua angka lain perkiraan
 *   2. kas defisit               → arus kas membunuh usaha yang untung
 *   3. rugi                      → struktur harga/biaya
 *   4. prive > laba              → kebocoran yang paling sering
 *   5. cicilan hati-hati/berisiko→ risiko pinjaman
 *   6. margin tipis              → optimasi harga
 *   7. peringatan rekomendasi    → catatan tersimpan dari saran terakhir
 *   8. komponen skor terlemah    → umum, dari skor yang transparan
 *   9. pertahankan               → tidak ada yang mendesak: pesan positif
 */
import { formatRupiah } from './metrics.js';
import { nomorModulSah } from './kurikulum.js';

/**
 * Umur maksimum (hari) peringatan rekomendasi yang masih boleh diangkat
 * aturan 7. Konstanta bernama, bukan angka ajaib: 30 hari kalender — cukup
 * lama untuk tetap relevan pada ritme UMKM, cukup pendek agar nasihat bulan
 * lalu tidak berpura-pura segar.
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

/** Peta aspek skor ke modul yang mengajarkan perbaikannya. */
function modulDariAspek(aspek = '') {
  if (aspek.includes('Margin')) return 5;
  if (aspek.includes('mencatat')) return 3;
  if (aspek.includes('terpisah')) return 1;
  if (aspek.includes('Legalitas') || aspek.includes('NIB')) return 31;
  return null; // 'Lama usaha berjalan' — tidak ada materi yang mempercepat waktu
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
      judul: 'Isi profil usahamu dulu',
      alasan: 'Semua angka, skor, dan saran dihitung dari profil usahamu. Isinya sekali saja, kapan saja bisa diubah.',
      aksi: { label: 'Isi profil usaha', halaman: 'profil' },
      modul: null,
    };
  }

  const m = metrics;
  const catatan = m.sumber === 'catatan';
  const setara = m.disetarakan ? ' (laju setara sebulan penuh)' : '';

  /* 1 — konsistensi: tanpa catatan yang rapat, semua angka lain cuma perkiraan. */
  if (!catatan) {
    const alasan = m.catatanBelumCukup
      ? `Bulan ini baru tercatat ${m.hariTercatat} dari ${m.hariBerjalan} hari berjalan — angka di dasbor masih perkiraan profilmu. Semakin rapat catatanmu, semakin nyata semua angkanya.`
      : 'Belum ada catatan bulan ini — angka di dasbor masih perkiraan profilmu. Satu transaksi hari ini sudah mengubahnya.';
    return {
      id: 'konsistensi',
      judul: 'Rapikan ritme mencatat bulan ini',
      alasan,
      aksi: { label: 'Catat transaksi hari ini', halaman: 'kas' },
      modul: 3,
    };
  }

  /* 2 — kas defisit: fakta saldo, bukan opini. */
  if ((m.saldoKas ?? 0) < 0) {
    return {
      id: 'kas-defisit',
      judul: 'Saldo kas minus — periksa arus kas',
      alasan: `Saldo kas ${formatRupiah(m.saldoKas)}. Laba bersih ${formatRupiah(m.labaBersih)}${setara} — uangnya berpindah ke stok, alat, atau utang, atau prive menarik lebih cepat daripada laba masuk.`,
      aksi: { label: 'Periksa Buku Kas', halaman: 'kas' },
      modul: 9,
    };
  }

  /* 3 — rugi: fakta laba. */
  if (m.rugi) {
    return {
      id: 'rugi',
      judul: 'Bulan ini rugi — periksa harga dan biaya',
      alasan: `Laba bersih ${formatRupiah(m.labaBersih)} (margin ${m.marginBersih}%)${setara}. Kerugian yang berulang hampir selalu dari harga jual, biaya bahan, atau jumlah penjualan — periksa tiga-tiganya di laporan.`,
      aksi: { label: 'Buka Laporan', halaman: 'laporan' },
      modul: 5,
    };
  }

  /* 4 — prive lebih besar dari laba: kas terkikis pelan-pelan. */
  if ((m.prive ?? 0) > 0 && m.labaBersih > 0 && m.prive > m.labaBersih) {
    return {
      id: 'prive-lebih-besar-dari-laba',
      judul: 'Prive melebihi laba — atur gaji tetap',
      alasan: `Prive ${formatRupiah(m.prive)} lebih besar dari laba ${formatRupiah(m.labaBersih)}${setara} — uang usaha terkikis lebih cepat daripada menghasilkan. Ambil prive dengan jumlah tetap, sekali seminggu atau sebulan.`,
      aksi: { label: 'Periksa prive di Buku Kas', halaman: 'kas' },
      modul: 23,
    };
  }

  /* 5 — cicilan: status dari ambang aman/berisiko yang sama dengan simulasi KUR. */
  if (m.statusCicilan && m.statusCicilan !== 'aman') {
    return {
      id: 'cicilan',
      judul: m.statusCicilan === 'berisiko'
        ? 'Beban cicilan di atas batas berisiko'
        : 'Beban cicilan mendekati batas aman',
      alasan: `Cicilan ${formatRupiah(m.cicilanSaatIni)} = ${m.bebanCicilan}% dari laba bersih — batas cicilan sehatmu ${formatRupiah(m.maxCicilanSehat)}/bulan. Satu bulan sepi saja sudah cukup membuat menunggak.`,
      aksi: { label: 'Simulasikan cicilan (KUR)', halaman: 'laporan' },
      modul: 29,
    };
  }

  /* 6 — margin tipis: ambang 10% yang sama dengan pewarnaan margin di dasbor. */
  if (m.marginBersih >= 0 && m.marginBersih < 10) {
    return {
      id: 'margin-tipis',
      judul: 'Margin bersih tipis — tinjau harga jual',
      alasan: `Margin bersih ${m.marginBersih}%${setara} — di bawah 10%, biaya memakan hampir seluruh omzet. Cek menu dengan margin terkecil sebelum berpikir menambah penjualan.`,
      aksi: { label: 'Buka Laporan', halaman: 'laporan' },
      modul: 20,
    };
  }

  /* 7 — peringatan tersimpan dari rekomendasi terakhir (tanpa memanggil AI).
   *
   * Jendela umur: nasihat AI yang tersimpan membara sesuai angka pada HARI ia
   * disusun. Memangkatnya berminggu-minggu kemudian seolah masih "peringatan
   * terakhir" adalah dusta kesegaran — fokus harian justru permukaan yang
   * paling dipercaya peserta. Maka aturan 7 hanya berlaku bila rekomendasinya
   * cukup muda; di luar jendela (atau tanpa tanggal yang bisa dipercaya) aliran
   * jatuh ke aturan 8/9 yang murni deterministik. Satu konstanta, satu
   * pembanding — tanpa mesin pembatalan apa pun.
   */
  const peringatan = rekomendasi?.peringatan?.[0];
  const umurHari = umurRekomendasiHari(rekomendasi, kini);
  const dalamJendela = umurHari !== null && umurHari <= UMUR_MAKS_PERINGATAN_HARI;
  if (typeof peringatan === 'string' && peringatan.trim() && dalamJendela) {
    const modulTerkait = rekomendasi?.rekomendasi?.[0]?.modulTerkait;
    return {
      id: 'peringatan-rekomendasi',
      judul: 'Ada peringatan dari rekomendasi terakhirmu',
      // Umur disebut saat ia ada — peserta menilai sendiri kebaruannya.
      alasan:
        (umurHari > 0 ? `Disusun ${umurHari} hari lalu. ` : '') + peringatan.trim().slice(0, 200),
      aksi: { label: 'Buka Saran', halaman: 'rekomendasi' },
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
      judul: `Perkuat: ${terlemah.aspek}`,
      alasan: `Skor "${terlemah.aspek}" baru ${terlemah.poin}/${terlemah.maks} — ${terlemah.catatan}.`,
      aksi: { label: 'Lihat rincian skor', halaman: 'dasbor' },
      modul: modulDariAspek(terlemah.aspek),
    };
  }

  /* 9 — tidak ada yang mendesak: pesan positif yang tetap membawa langkah. */
  return {
    id: 'pertahankan',
    judul: 'Tidak ada hal mendesak — pertahankan ritme',
    alasan: `Tidak ada masalah mendesak yang terdeteksi dari angkamu hari ini. Pertahankan ritme mencatatnya — belajar berikutnya: ${sesiBerikut?.judul ?? 'pustaka lanjutan'}.`,
    aksi: { label: 'Lanjutkan belajar', halaman: 'modul' },
    modul: sesiBerikut?.no ?? null,
  };
}
