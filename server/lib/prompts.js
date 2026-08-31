/**
 * Prompt untuk Claude Sonnet 5.
 *
 * Bagian yang stabil (peran + daftar modul) sengaja ditaruh di blok pertama agar
 * bisa di-cache (prompt caching). Profil usaha yang berubah-ubah ada di blok kedua.
 */
import { isMonthComplete, kategoriLabel, monthsWithData, summarizeRange } from './cashbook.js';
import { metricsToText, formatRupiah } from './metrics.js';
import { KURIKULUM, MODUL_MAKS, MODUL_MIN, modulRingkasUntukAI } from './kurikulum.js';

/*
 * Daftar modul DITURUNKAN dari kurikulum, tidak ditulis ulang di sini.
 *
 * Sebelumnya daftar ini teks tetap, kembaran dari daftar di halaman Modul.
 * Selama keduanya kebetulan sama, tidak ada yang terlihat salah — begitu salah
 * satu berubah, AI mulai menyarankan "buka modul 7" yang isinya bukan modul 7
 * di layar peserta. Kesalahan macam itu tidak membuat apa pun gagal; ia cuma
 * membuat nasihatnya salah alamat, tanpa satu pun tanda.
 */
export const MODUL_RINGKAS = modulRingkasUntukAI();

const PERAN = `Kamu adalah "Konsultan Nova", pendamping keuangan untuk pemilik UMKM Indonesia yang awam akuntansi.

Cara menjawab:
- Selalu berbahasa Indonesia yang ramah dan sederhana, seperti mengobrol dengan pemilik warung. Hindari istilah akuntansi yang rumit; kalau terpaksa memakainya, jelaskan singkat.
- Jawab ringkas: maksimal sekitar 180 kata, kecuali pengguna memang minta penjelasan panjang.
- Berikan angka rupiah yang konkret dan langkah yang bisa dikerjakan hari ini.
- Boleh memakai **teks tebal** dan daftar dengan tanda "- ". Jangan pakai heading, tabel, atau blok kode.
- Kalau relevan, arahkan ke modul yang tepat (sebut nomornya).

Mengaitkan dengan pelajaran peserta:
- Peserta sedang menjalani satu sesi belajar per hari. Kalau ada blok KEMAJUAN BELAJAR PESERTA di bawah, pakai itu: kaitkan jawabanmu dengan sesi yang sedang dijalani bila nyambung, dan jangan mengarahkan ke modul yang jauh di depan sesi itu kecuali memang yang ditanyakan.
- Kalau ada blok MATERI MODUL YANG SEDANG DIBUKA PESERTA, jelaskan materi itu MEMAKAI ANGKA USAHA PESERTA SENDIRI dari data di bawah — itu tugas utamamu pada pertanyaan tersebut. Contoh: kalau modulnya tentang HPP, tunjukkan berapa persen belanja bahan terhadap penjualannya, bukan mengulang definisi HPP.
- Saat materi modul disertakan, jangan memberi penjelasan yang bertentangan dengan isinya. Peserta sedang membaca modul itu di layar yang sama; dua versi yang berbeda membuatnya bingung, bukan bertambah paham. Boleh menambah, tidak boleh membantah.

Batasan penting:
- Gunakan HANYA angka yang tersedia di data usaha di bawah, atau angka yang diberikan pengguna dalam percakapan. JANGAN mengarang omzet, laba, atau biaya. Kalau butuh data yang belum ada, tanyakan.
- Kamu bukan akuntan publik, konsultan pajak, atau penasihat hukum. Untuk urusan pajak, sengketa, atau pinjaman besar, sarankan konsultasi ke ahlinya.
- Jangan menjanjikan pengajuan KUR pasti disetujui; keputusan ada di bank.

Modul Nova Explorer (${KURIKULUM.length} modul). Jalur "Dasar" adalah sesi harian yang sedang dijalani peserta, satu sesi per hari selama dua minggu; jalur lain adalah pustaka yang dibuka sesuai kebutuhan. Arahkan peserta baru ke jalur Dasar lebih dulu.
${MODUL_RINGKAS}`;

/* Label berbahasa Indonesia untuk pilihan profil — dipakai AI, laporan,
 * dan kartu kesehatan (server.js). Diekspor supaya tiga tempat itu tidak
 * menjaga salinan labelnya sendiri. */
export const LABEL = {
  jenisUsaha: {
    kuliner: 'Kuliner (warung/kafe/katering)',
    retail: 'Retail / toko kelontong',
    jasa: 'Jasa (bengkel, salon, laundry, dll.)',
    produksi: 'Produksi / kerajinan',
    online: 'Toko online',
    lainnya: 'Lainnya',
  },  pencatatan: {
    belum: 'Belum mencatat sama sekali',
    kadang: 'Kadang-kadang saja',
    buku: 'Buku tulis',
    excel: 'Excel / spreadsheet',
    aplikasi: 'Aplikasi kasir/keuangan',
  },
  tujuan: {
    'rapikan-keuangan': 'Merapikan pencatatan keuangan',
    'naikkan-laba': 'Menaikkan laba',
    'ajukan-kur': 'Mempersiapkan pengajuan KUR',
    'kelola-stok': 'Mengelola stok lebih baik',
    'kembangkan-usaha': 'Mengembangkan usaha / buka cabang',
  },
};

/** Batas jumlah bulan riwayat yang dikirim. 3 tahun sudah jauh di atas kebutuhan KUR. */
const MAKS_BULAN_RIWAYAT = 36;

const namaBulan = (m) => {
  const [y, mo] = m.split('-');
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
};

/**
 * Konteks buku kas untuk AI, dipecah dua sesuai sifatnya.
 *
 * `riwayat`  — SELURUH bulan yang sudah selesai. Bulan yang sudah lewat tidak
 *              berubah lagi, jadi blok ini stabil dan ditandai untuk prompt
 *              caching: dibaca berkali-kali dengan biaya sekitar sepersepuluh.
 * `berjalan` — bulan yang sedang jalan dan pengeluaran terbesarnya. Berubah
 *              setiap kali pengguna mencatat, jadi tidak boleh ikut di-cache.
 *
 * Sebelumnya konteks dibatasi 3 bulan terakhir demi hemat token. Penghematannya
 * ternyata semu: orang yang memindahkan dua tahun pembukuan fisik ke aplikasi
 * ini mendapat saran dari 3 bulan terakhir saja, dan model tidak pernah tahu
 * ada 21 bulan lain yang tidak dilihatnya — jadi ia menyimpulkan tren dari
 * sepotong data tanpa pernah menyebut keterbatasannya.
 */
export function cashbookContext(transactions = [], now = new Date()) {
  const semuaBulan = monthsWithData(transactions);
  if (!semuaBulan.length) {
    return {
      riwayat: '',
      berjalan:
        'BUKU KAS\nPengguna belum mencatat transaksi apa pun. Dorong dia mulai mencatat di menu "Buku Kas" — cukup 10 detik per transaksi, dan setelah itu semua angka di aplikasi jadi akurat.',
    };
  }

  const bulanDipakai = semuaBulan.slice(0, MAKS_BULAN_RIWAYAT);
  const summaries = summarizeRange(transactions, bulanDipakai, now);
  const selesai = summaries.filter((s) => s.lengkap);
  const berjalan = summaries.find((s) => !s.lengkap) ?? null;

  return {
    riwayat: riwayatToText(selesai, semuaBulan),
    berjalan: berjalanToText(berjalan, transactions),
  };
}

/** Blok stabil: seluruh bulan yang sudah selesai. Aman di-cache. */
function riwayatToText(selesai, semuaBulan) {
  /*
   * Model perlu tahu SELURUH rentang catatan yang dimilikinya. Tanpa baris ini
   * ia tidak punya cara membedakan "pengguna baru mencatat 3 bulan" dari
   * "pengguna mencatat 2 tahun dan aku cuma diberi 3 bulan" — dan akan bicara
   * soal tren seolah-olah melihat semuanya.
   *
   * Yang dihitung di sini HANYA bulan yang sudah selesai. Memasukkan jumlah
   * seluruh transaksi termasuk bulan berjalan akan membuat baris ini berubah
   * setiap kali pengguna mencatat — dan satu byte berubah di blok ini
   * membatalkan seluruh cache di belakangnya. Angka yang bergerak tidak boleh
   * ikut ke dalam blok yang tugasnya justru tidak bergerak.
   */
  const bulanSelesai = semuaBulan.filter((m) => selesai.some((s) => s.month === m));
  const transaksiSelesai = selesai.reduce((n, s) => n + s.jumlahTransaksi, 0);

  const lines = ['BUKU KAS — RIWAYAT (angka nyata dari catatan pengguna)'];
  lines.push(
    bulanSelesai.length
      ? `Cakupan riwayat: ${bulanSelesai.length} bulan yang sudah selesai, ${namaBulan(bulanSelesai.at(-1))} s/d ${namaBulan(bulanSelesai[0])}, ${transaksiSelesai} transaksi.` +
          (semuaBulan.length > MAKS_BULAN_RIWAYAT
            ? ` Pengguna punya ${semuaBulan.length} bulan catatan; yang dirinci hanya ${MAKS_BULAN_RIWAYAT} bulan terbaru.`
            : ' Semuanya dirinci di bawah — tidak ada bulan yang disembunyikan darimu.')
      : 'Belum ada bulan yang selesai.',
  );

  if (!selesai.length) {
    lines.push('Belum ada satu pun bulan yang selesai; semua catatan ada di bulan berjalan.');
    return lines.join('\n');
  }

  for (const s of selesai) lines.push(bulanKeBaris(s));

  /*
   * Tren hanya antara dua bulan penuh yang tercatat rapat. Membandingkan bulan
   * berjalan dengan bulan lalu menghasilkan "penjualan turun 74%" untuk usaha
   * yang penjualannya tidak berubah sama sekali — dan model akan dengan patuh
   * membunyikan alarm palsu itu ke pemilik usaha.
   */
  const rapat = selesai.filter(isMonthComplete);
  if (rapat.length >= 2) {
    const [kini, lalu] = rapat;
    const delta = (a, b) => (b > 0 ? Number((((a - b) / b) * 100).toFixed(1)) : null);
    const tren = [];
    const dJual = delta(kini.penjualan, lalu.penjualan);
    const dBelanja = delta(kini.belanjaBahan, lalu.belanjaBahan);
    if (dJual !== null) tren.push(`penjualan ${dJual >= 0 ? 'naik' : 'turun'} ${Math.abs(dJual)}%`);
    if (dBelanja !== null) tren.push(`belanja bahan ${dBelanja >= 0 ? 'naik' : 'turun'} ${Math.abs(dBelanja)}%`);
    if (tren.length) {
      lines.push(`- Tren antar bulan penuh — ${namaBulan(kini.month)} dibanding ${namaBulan(lalu.month)}: ${tren.join(', ')}.`);
    }
  } else {
    lines.push(
      '- Belum ada dua bulan penuh yang tercatat rapat untuk dibandingkan. JANGAN membandingkan bulan berjalan dengan bulan lalu seolah-olah setara — periodenya beda panjang.',
    );
  }

  return lines.join('\n');
}

/** Blok berubah-ubah: bulan berjalan + pengeluaran terbesarnya. Tidak di-cache. */
function berjalanToText(berjalan, transactions) {
  const lines = ['BUKU KAS — BULAN BERJALAN'];

  if (!berjalan || berjalan.jumlahTransaksi === 0) {
    lines.push('Bulan ini belum ada catatan sama sekali. Dorong pengguna mulai mencatat lagi.');
  } else {
    lines.push(bulanKeBaris(berjalan));
    lines.push(pengeluaranTerbesar(transactions, berjalan.month));
  }

  lines.push(
    'Gunakan angka buku kas ini sebagai dasar saran. Sebutkan tanggal atau nama transaksi bila membantu pemilik usaha mengenali polanya.',
  );
  return lines.filter(Boolean).join('\n');
}

/** Satu baris ringkasan bulan, lengkap dengan periodenya. */
function bulanKeBaris(s) {
  const periode = isMonthComplete(s)
    ? `bulan penuh ${s.hariBulan} hari, tercatat rapat`
    : s.lengkap
      ? `BELUM UTUH — bulannya sudah lewat tapi hanya ${s.hariTercatat} dari ${s.hariBulan} hari yang tercatat, jadi angkanya lebih kecil dari kenyataan`
      : `BARU BERJALAN ${s.hariBerjalan} dari ${s.hariBulan} hari — setara sebulan penuh: penjualan ${formatRupiah(s.setara.penjualan)}, laba bersih ${formatRupiah(s.setara.labaBersih)}`;
  return (
    `- ${namaBulan(s.month)}: penjualan ${formatRupiah(s.penjualan)}, belanja bahan ${formatRupiah(s.belanjaBahan)}, ` +
    `operasional ${formatRupiah(s.operasional)}, laba bersih ${formatRupiah(s.labaBersih)} (margin ${s.marginBersih}%), ` +
    `prive ${formatRupiah(s.prive)}, saldo kas ${formatRupiah(s.saldoKas)} — tercatat ${s.hariTercatat} hari, ${s.jumlahTransaksi} transaksi (${periode})`
  );
}

/**
 * Lima pengeluaran terbesar, digabung per keterangan/kategori.
 *
 * Tanpa penggabungan, warung yang belanja bahan Rp 220rb setiap hari
 * menghasilkan lima baris identik yang tidak berisi informasi apa pun.
 */
function pengeluaranTerbesar(transactions, month) {
  const rekap = new Map();
  for (const t of transactions) {
    if (t.jenis !== 'keluar' || !String(t.tanggal).startsWith(month)) continue;
    const kategori = kategoriLabel(t.jenis, t.kategori);
    const nama = String(t.keterangan || '').trim() || kategori;
    const kunci = `${nama}|${kategori}`;
    const agg = rekap.get(kunci) ?? { nama, kategori, total: 0, kali: 0 };
    agg.total += Number(t.jumlah) || 0;
    agg.kali += 1;
    rekap.set(kunci, agg);
  }

  const besar = [...rekap.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  if (!besar.length) return '';

  return (
    `- Pengeluaran terbesar ${namaBulan(month)} (digabung per jenis): ` +
    besar
      .map((r) => {
        // Tanpa keterangan, nama = kategori; menyebutnya dua kali memboroskan token.
        const rincian = [r.kali > 1 ? `${r.kali}x` : '', r.nama === r.kategori ? '' : r.kategori].filter(Boolean);
        return `${r.nama} ${formatRupiah(r.total)}${rincian.length ? ` (${rincian.join(', ')})` : ''}`;
      })
      .join('; ')
  );
}

/** Menyusun profil usaha + hasil hitungan menjadi teks konteks untuk AI. */
export function profileToText(profile, metrics) {
  if (!profile) {
    return 'Pengguna belum mengisi profil usaha. Ajak mengisi menu "Profil Usaha" agar sarannya bisa disesuaikan, tapi tetap bantu pertanyaannya secara umum.';
  }
  const lamaBulan = Number(profile.lamaUsahaBulan) || 0;
  const lama =
    lamaBulan >= 12
      ? `${Math.floor(lamaBulan / 12)} tahun ${lamaBulan % 12} bulan`
      : `${lamaBulan} bulan`;

  /*
   * NAMA USAHA DAN LOKASI SENGAJA TIDAK IKUT.
   *
   * Keduanya dulu dikirim ke Anthropic pada setiap pertanyaan, sementara teks
   * persetujuan peserta menyatakan data pengenal tidak dikirim. Untuk warung
   * mikro keduanya memang mengenali: nama warung di Indonesia hampir selalu
   * nama pemiliknya ("Warung Bu Sari"), dan nama itu digabung satu kecamatan
   * menunjuk satu orang. Bukti bahwa repositori ini sendiri menganggapnya
   * pengenal: `scripts/export.js --anonymize` menghapus persis medan-medan ini.
   *
   * Yang hilang dari mutu jawaban: hampir nol. Model tidak pernah memerlukan
   * nama warung untuk menghitung HPP atau membaca margin — ia hanya memakainya
   * sebagai sapaan. Yang tetap dikirim adalah yang benar-benar mengubah isi
   * nasihat: jenis usaha, produk, lama usaha, cara mencatat, dan angkanya.
   */
  const baris = [
    `- Jenis usaha: ${LABEL.jenisUsaha[profile.jenisUsaha] ?? profile.jenisUsaha ?? '(belum diisi)'}`,
    `- Sudah berjalan: ${lama}`,
    `- Jumlah karyawan: ${Number(profile.jumlahKaryawan) || 0} orang`,
    `- Produk utama: ${profile.produkUtama || '(belum diisi)'}`,
    `- Cara mencatat saat ini: ${LABEL.pencatatan[profile.pencatatan] ?? '(belum diisi)'}`,
    `- Rekening/dompet usaha terpisah: ${profile.rekeningTerpisah ? 'Ya' : 'Belum'}`,
    `- Punya NIB: ${profile.punyaNib ? 'Ya' : 'Belum'}`,
    `- Tujuan utama: ${LABEL.tujuan[profile.tujuan] ?? '(belum diisi)'}`,
  ];
  if (profile.tantangan) baris.push(`- Tantangan terbesar menurut pemilik: "${profile.tantangan}"`);

  return `DATA USAHA PENGGUNA
${baris.join('\n')}

ANGKA KEUANGAN (sudah dihitung sistem, gunakan apa adanya)
${metricsToText(metrics)}`;
}

/**
 * Menyusun blok system prompt, diurutkan dari yang paling jarang berubah.
 *
 * Prompt caching bekerja atas awalan (prefix): satu byte berubah di depan
 * membatalkan semua yang di belakangnya. Karena itu urutannya:
 *
 *   1. PERAN + daftar modul   — tidak pernah berubah
 *   2. Riwayat buku kas       — berubah sebulan sekali  <-- penanda cache di sini
 *   3. Profil + angka + bulan berjalan — berubah tiap kali pengguna mencatat
 *
 * Penanda cache ditaruh di ujung blok 2, sehingga blok 1 dan 2 tersimpan
 * bersama. Ambang minimum Sonnet 5 adalah 1024 token; blok PERAN saja hanya
 * sekitar 550 token, jadi selama ini penandanya diam-diam tidak berefek apa pun.
 * Digabung dengan riwayat, awalan ini baru benar-benar terbentuk.
 *
 * Penandanya pun hanya dipasang kalau blok stabilnya memang cukup panjang.
 * Peserta baru belum punya satu pun bulan yang selesai, jadi `riwayat` masih
 * kosong dan awalannya tetap di bawah ambang — memasang penanda di situ tidak
 * menghasilkan apa pun. Menyembunyikannya membuat perilaku aplikasi ini jujur
 * terhadap apa yang benar-benar terjadi, bukan terhadap apa yang diniatkan.
 */
const AMBANG_CACHE_CHAR = 4000; // ~1024 token untuk teks bahasa Indonesia

function systemBlocks(profile, metrics, cashbook, tugas = '', belajar = []) {
  const { riwayat = '', berjalan = '' } = typeof cashbook === 'string' ? { berjalan: cashbook } : cashbook ?? {};

  const stabil = [PERAN, riwayat].filter(Boolean).join('\n\n');
  /*
   * Konteks belajar duduk di blok volatil, bukan stabil. Ia berubah setiap kali
   * peserta menyelesaikan satu sesi — menaruhnya di blok yang di-cache akan
   * membatalkan cache-nya justru pada hari-hari peserta paling aktif.
   */
  const volatil = [profileToText(profile, metrics), berjalan, ...belajar, tugas].filter(Boolean).join('\n\n');

  const blokStabil = { type: 'text', text: stabil };
  if (stabil.length >= AMBANG_CACHE_CHAR) blokStabil.cache_control = { type: 'ephemeral' };

  return [blokStabil, { type: 'text', text: volatil }];
}

/**
 * System prompt untuk konsultasi chat.
 *
 * @param {{kemajuan?: string, materi?: string}} belajar konteks pembelajaran:
 *   ringkasan sesi yang sedang dijalani, dan — hanya bila peserta bertanya dari
 *   dalam sebuah modul — materi lengkap modul itu.
 */
export function chatSystem(profile, metrics, cashbook = '', belajar = {}) {
  const { kemajuan = '', materi = '' } = belajar ?? {};
  return systemBlocks(profile, metrics, cashbook, '', [kemajuan, materi]);
}

/** System prompt untuk menyusun rekomendasi personal terstruktur. */
export function recommendationSystem(profile, metrics, cashbook = '', belajar = {}) {
  const { kemajuan = '' } = belajar ?? {};
  return systemBlocks(
    profile,
    metrics,
    cashbook,
    `TUGAS SAAT INI
Susun rencana perbaikan keuangan yang personal untuk usaha di atas, dalam format JSON sesuai skema.

Aturan penyusunan:
- Setiap rekomendasi harus spesifik untuk usaha ini — sebut angka rupiah dari data di atas bila relevan. Jangan memberi nasihat umum yang bisa berlaku untuk usaha mana pun.
- Urutkan dari yang paling berdampak. Prioritas "tinggi" maksimal 3 buah.
- Setiap rekomendasi berisi 2–4 langkah yang bisa dikerjakan sendiri oleh pemilik usaha dalam waktu dekat.
- "modulTerkait" diisi nomor modul ${MODUL_MIN}–${MODUL_MAKS} yang paling relevan. Utamakan modul jalur Dasar bila pesertanya masih baru mencatat.
- "targetBulanIni" berisi 3 target konkret dan terukur untuk 30 hari ke depan.
- "peringatan" hanya diisi bila ada risiko nyata dari data (mis. rugi, margin sangat tipis, cicilan melebihi 30% laba, uang usaha masih tercampur). Kosongkan bila tidak ada.
- Jangan mengulang angka skor kesehatan; sistem sudah menampilkannya sendiri.`,
    // Rekomendasi ikut melihat kemajuan belajar supaya "modulTerkait" mengarah
    // ke tempat peserta benar-benar berada, bukan ke modul yang belum akan
    // dibukanya sampai dua minggu lagi.
    [kemajuan],
  );
}

/** Skema JSON untuk structured outputs. */
export const RECOMMENDATION_SCHEMA = {
  type: 'object',
  properties: {
    ringkasan: {
      type: 'string',
      description: 'Ringkasan kondisi usaha dalam 2-3 kalimat, bahasa sederhana dan jujur.',
    },
    rekomendasi: {
      type: 'array',
      description: 'Daftar 3-5 rekomendasi personal, diurutkan dari yang paling berdampak.',
      items: {
        type: 'object',
        properties: {
          judul: { type: 'string', description: 'Judul singkat, maksimal 8 kata.' },
          prioritas: { type: 'string', enum: ['tinggi', 'sedang', 'rendah'] },
          alasan: { type: 'string', description: 'Kenapa ini penting untuk usaha INI, sebutkan angkanya.' },
          langkah: {
            type: 'array',
            description: '2-4 langkah konkret yang bisa dikerjakan pemilik usaha.',
            items: { type: 'string' },
          },
          dampak: { type: 'string', description: 'Perkiraan manfaat bila dijalankan, singkat.' },
          /*
           * Rentangnya disebut di deskripsi, bukan sebagai `minimum`/`maximum`.
           * Structured outputs hanya menerima sebagian kata kunci JSON Schema,
           * dan skema yang ditolak menggagalkan SELURUH jalur rekomendasi —
           * harga yang terlalu mahal untuk sekadar menjaga satu angka. Nomor di
           * luar rentang ditangkap belakangan oleh `nomorModulSah()` saat
           * disajikan, sehingga peserta tidak pernah melihat "Modul 47".
           */
          modulTerkait: {
            type: 'integer',
            description: `Nomor modul ${MODUL_MIN}-${MODUL_MAKS} yang relevan.`,
          },
        },
        required: ['judul', 'prioritas', 'alasan', 'langkah', 'dampak', 'modulTerkait'],
        additionalProperties: false,
      },
    },
    peringatan: {
      type: 'array',
      description: 'Risiko nyata dari data. Kosongkan bila tidak ada.',
      items: { type: 'string' },
    },
    targetBulanIni: {
      type: 'array',
      description: 'Tepat 3 target konkret dan terukur untuk 30 hari ke depan.',
      items: { type: 'string' },
    },
  },
  required: ['ringkasan', 'rekomendasi', 'peringatan', 'targetBulanIni'],
  additionalProperties: false,
};

export function recommendationRequest(profile, metrics) {
  // "usaha ini", bukan nama warungnya — lihat catatan di profileToText.
  return `Susun rencana perbaikan keuangan untuk usaha ini. Tujuan utama pemilik: ${
    LABEL.tujuan[profile.tujuan] ?? 'merapikan keuangan'
  }. Laba bersih saat ini ${formatRupiah(metrics.labaBersih)} per bulan.`;
}

/* ================================================== Ekstraksi nota (foto) */

/**
 * Skema JSON hasil baca nota. Medan yang tidak terbaca WAJIB null —
 * "required" di sini menuntut KUNCI-nya ada, bukan nilainya terisi, supaya
 * model tidak merasa dipaksa mengarang angka saat notanya kabur.
 */
export const NOTA_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['expense', 'income'], description: 'Nota belanja = expense. Kwitansi penjualan yang diterima = income.' },
    amount: { type: ['number', 'null'], description: 'TOTAL AKHIR transaksi dalam rupiah (angka murni, tanpa titik/koma). null bila tidak terbaca.' },
    category: { type: ['string', 'null'], description: 'Kata kunci kategori bebas bahasa Indonesia, mis. "bahan makanan", "sembako", "pertalite", "token listrik". null bila tidak jelas.' },
    description: { type: ['string', 'null'], description: 'Ringkasan barang/jasa maksimal 8 kata. null bila tidak ada.' },
    merchant: { type: ['string', 'null'], description: 'Nama toko/usaha tercetak di nota. null bila tidak terbaca.' },
    date: { type: ['string', 'null'], description: 'Tanggal transaksi di nota, format YYYY-MM-DD. null bila tidak ada.' },
    confidence: { type: 'number', description: 'Keyakinan keseluruhan 0.0-1.0.' },
  },
  required: ['type', 'amount', 'category', 'description', 'merchant', 'date', 'confidence'],
  additionalProperties: false,
};

/** Instruksi sistem pembaca nota — aturan memilih TOTAL adalah intinya. */
export function notaSystem() {
  return `Kamu pembaca nota belanja untuk aplikasi pembukuan UMKM Indonesia.
Tugasmu SATU: membaca foto nota dan mengembalikan JSON sesuai skema. Jangan bercerita.

CARA MEMILIH TOTAL (paling penting):
- Pilih angka pada baris berlabel: TOTAL, GRAND TOTAL, JUMLAH, TOTAL BAYAR, BAYAR, DIBAYAR, TAGIHAN.
- Jika tidak ada label, pilih jumlah akhir yang dibayar pada bagian bawah nota.
- JANGAN memilih angka terbesar secara otomatis. Harga satuan, subtotal per baris, nominal kembalian, nomor telepon, NPWP, dan kode struk BUKAN total.
- Angka Indonesia memakai titik sebagai pemisah ribuan (Rp120.000 = 120000) dan koma sebagai desimal. "120,000" dari nota marketplace = 120000.

NILAI YANG TIDAK TERBACA:
- Kembalikan null. Jangan pernah menebak, menjumlahkan sendiri, atau mengarang.
- Bila total tidak yakin tapi terbaca, tetap isi — dan TURUNKAN confidence.

confidence:
- 0.9 ke atas: nota cetak, jelas, totalnya berlabel.
- 0.6-0.85: nota kabur sebagian, tulisan tangan, atau total harus diduga dari konteks.
- di bawah 0.6: tidak yakin angka totalnya benar.

category: kata kunci bebas 1-3 kata (bukan kategori baku — aplikasi yang memetakannya). Contoh nota: belanja bahan makanan → "bahan makanan"; beli BBM → "pertalite"; token listrik → "token listrik"; belanja grosir sembako → "sembako".

date: dari tanggal cetak di nota. Tahun dua digit → pilih tahun terdekat yang tidak membuat tanggal berada di masa depan.`;
}

/** Permintaan pengguna — sengaja sependek ini; system yang memuat aturannya. */
export function notaRequest() {
  return 'Baca nota ini dan kembalikan JSON-nya.';
}

/* ================================================== Check-up keuangan (AI) */

/**
 * Skema hasil check-up: daftar observasi berstatus + satu insight.
 * Sengaja TIDAK ADA medan angka — semua angka di halaman berasal dari
 * data aplikasi yang dikirim sebagai konteks; model hanya menilai status.
 * Model yang menyelipkan angka ke dalam teks tidak bisa dicegah oleh
 * skema, tapi teksnya dibatasi dan diawasi sanitasi di lib/checkup.js.
 */
export const CHECKUP_SCHEMA = {
  type: 'object',
  properties: {
    item: {
      type: 'array',
      description: '3-5 observasi singkat tentang kondisi usaha, yang paling penting dulu.',
      items: {
        type: 'object',
        properties: {
          tipe: { type: 'string', enum: ['ok', 'perhatian'], description: 'ok = dalam kondisi baik; perhatian = perlu ditangani.' },
          teks: { type: 'string', description: 'Satu kalimat maksimal 120 karakter. Sebut angka HANYA yang ada di data yang diberikan.' },
        },
        required: ['tipe', 'teks'],
        additionalProperties: false,
      },
    },
    insight: { type: 'string', description: 'Satu-dua kalimat praktis: apa yang paling perlu dilakukan pekan ini.' },
  },
  required: ['item', 'insight'],
  additionalProperties: false,
};

/** Instruksi sistem check-up — larangan mengarang angka adalah intinya. */
export function checkupSystem(angkaTeks) {
  return `Kamu asisten check-up keuangan untuk pemilik UMKM Indonesia.

Nilai kondisi usaha HANYA dari angka-angka berikut, tanpa data luar:

${angkaTeks}

Aturan:
- Setiap item satu kalimat maksimal 120 karakter: faktual, spesifik untuk usaha ini, bisa ditindaklanjuti.
- Angka yang boleh disebut HANYA angka dari data di atas. Dilarang menghitung angka baru, memproyeksikan, atau mengarang.
- Gunakan tipe "ok" untuk kondisi baik, "perhatian" untuk hal yang perlu ditangani. Bila ragu, pilih "perhatian".
- 3-5 item, yang paling penting dulu.
- insight: satu-dua kalimat — satu langkah paling berdampak yang bisa dikerjakan pekan ini.
- Ini analisis edukatif, bukan nasihat keuangan profesional dan bukan keputusan kredit.`;
}

/** Permintaan pengguna — konteks angka sudah di system instruction. */
export function checkupRequest() {
  return 'Periksa kondisi keuangan usaha ini.';
}
