/**
 * Skema jejak peristiwa penelitian — SATU sumber untuk dua pembaca.
 *
 * ------------------------------------------------------------------
 * KENAPA BERKAS INI ADA
 *
 * Invarian "jejak peristiwa tidak memuat nominal atau teks bebas" selama ini
 * dijaga oleh SATU contoh uji (satu nominal, satu nama di penelitian.test.js).
 * Satu contoh tidak bisa membelakan jenis peristiwa baru: satu pushEvent
 * tambahan dengan meta asal bisa lolos selamanya. Karena itu invarian ini
 * dinaikkan dari contoh menjadi STRUKTUR: setiap jenis peristiwa terdaftar
 * di sini beserta medan meta yang SAH dan jenis nilainya.
 *
 * Daftar ini dibaca dua pihak dan keduanya HARUS sepakat selamanya:
 *   1. uji struktural (test/jejak.test.js) — menolak jenis baru yang tak
 *      terdaftar, medan di luar daftar, dan nilai di luar jenisnya;
 *   2. scripts/export.js — mode --anonymize membuang persis medan yang
 *      terdaftar sebagai teks bebas, sehingga janji pada BACA-DULU.txt
 *      ("teks bebas sudah dihapus") akhirnya benar, bukan sekadar ditulis.
 *
 * ------------------------------------------------------------------
 * JENIS NILAI
 *
 *   angka    Number finite (jumlah, versi, hitungan)
 *   bool     Boolean
 *   tanggal  string 'YYYY-MM-DD'
 *   waktu    string ISO timestamp
 *   kata     kosakata tertutup: huruf/angka/strip pendek (jenis, kategori,
 *            origin, rating, batch, aksi) — BUKAN teks bebas
 *   id       penanda pendek berpola tetap (trx_…)
 *   daftarAngka  array of angka
 *
 * ------------------------------------------------------------------
 * RATSU TEKS BEBAS
 *
 * `TEKS_BEBAS` mendaftar SETIAP medan yang sengaja memuat teks bebas hari
 * ini, beserta alasannya. Inilah "ratchet": jenis atau medan baru yang
 * membawa teks bebas GAGAL uji struktural sampai pemiliknya mendaftarkan
 * dan mengadjudikasinya di sini — normalisasi diam-diam tidak bisa terjadi.
 *
 * Terdaftar hari ini (keputusan masih terbuka — lihat
 * AI-TRUST-AUTOPILOT-DECISION.md §2.4, §20.7):
 *   - peserta_dinamai: seluruh meta memuat nama lama/baru + nama usaha.
 *     Nilai risetnya nyata (siapa memegang kode mana, kapan diganti), tapi
 *     inilah PII langsung di jejak. Anonimasi: SELURUH meta dibuang.
 *   - ai_feedback.alasan: alasan peserta menilai jawaban AI keliru — alat
 *     ukur yang sengaja dipilih peserta, dipotong 500 di rute.
 *   - latihan_dijawab.konsep / latihan_ai_dijawab.konsep: label konsep
 *     arahan AI (≤40 karakter) — bisa menggemakan kata peserta.
 */

export const SKEMA_JEJAK = {
  /* --- dari lib/store.js (pushEvent) --- */
  user_created: { batch: 'kata?', seed: 'bool?' },
  batch_assigned: { batch: 'kata', sebelum: 'kata' },
  belajar_dimulai: { mulaiPada: 'tanggal?', sebelum: 'tanggal?' },
  peserta_dinamai: { sebelum: 'identitas', sesudah: 'identitas' },
  consent_given: { versi: 'angka' },
  profile_saved: { versi: 'angka', garisDasar: 'bool' },
  chat_turn: { pesan: 'angka', 'modul?': 'angka?' },
  chat_cleared: { pesan: 'angka' },
  transaction_added: { jenis: 'kata', kategori: 'kata', tanggal: 'tanggal', mundur: 'bool', origin: 'kata' },
  transaction_deleted: { jenis: 'kata', kategori: 'kata', tanggal: 'tanggal' },
  module_completed: { modul: 'daftarAngka' },
  latihan_dijawab: { modul: 'angka', soal: 'angka', benar: 'bool', 'konsep?': 'teks40?' },
  latihan_ai_dibuat: { modul: 'angka' },
  latihan_ai_dijawab: { modul: 'angka', benar: 'bool', 'konsep?': 'teks40?' },
  praktik_terverifikasi: { modul: 'daftarAngka', aksi: 'kata' },
  recommendations_generated: { jumlah: 'angka', peringatan: 'angka' },
  /* Rekam advisori (Sesi G — memori nasihat): id rekam, jenis, dan asal saja.
   * Isi nasihat tinggal di user.advisori; jejaknya tetap tanpa nominal dan
   * tanpa teks — id menghubungkan keduanya. */
  advisori_dibuat: { id: 'id', jenis: 'kata', sumber: 'kata' },
  /* Checkpoint hasil (Sesi G fase 2): satu per satu, saat jatuh tempo.
   * status 'terukur'|'tak-terukur' — yang gagal dinilai juga tercatat,
   * supaya ketiadaan hasil terlihat, bukan hening. */
  evaluasi_advisori: { id: 'id', metode: 'kata', status: 'kata' },
  /* Tap tindak lanjut (Sesi G lanjutan): peserta menandai "saya sudah coba"
   * pada satu advisori — SATU peristiwa per advisori (idempoten di lib/
   * advisori.js). Sinyal EKSPLISIT ini mengalahkan derivasi korelasional
   * bila keduanya ada; contentless — tanpa isi nasihat, tanpa teks bebas. */
  advisori_ditindaki: { id: 'id' },
  /* Rel proposal T1 surface #1 (scan-nota; addendum §25 2026-09-12).
   * proposal_shown: usulan tampil di layar — id + tingkat keyakinan tutup
   * ('ok'|'warning'|'low'), menunggangi tulisan usage rute scan. TANPA delta
   * event (§21.2): penerimaan DITURUNKAN dari shown ⋈ baris (origin+proposalId),
   * tidak pernah disimpan sebagai peristiwa. proposal_rejected: penolakan
   * EKSPLISIT saja, alasan kosakata tertutup. Keduanya tanpa nominal, tanpa
   * teks bebas — isi usulan tinggal di respons HTTP, bukan di jejak. */
  proposal_shown: { id: 'id', 'tier?': 'kata?' },
  proposal_rejected: { id: 'id', 'alasan?': 'kata?' },

  /* --- dari rute (store.logEvent) --- */
  login: {},
  demo_login: {},
  anggaran_habis: { jenis: 'kata' },
  konteks_viewed: {},
  fokus_viewed: {},
  papan_viewed: {},
  report_viewed: { bulan: 'angka' },
  data_downloaded: {},
  ai_feedback: { rating: 'kata', 'alasan?': 'teks500?', 'chatIndex?': 'angka?' },

  /* --- dari lib/demo-data.js (dorong; akun batch DEMO) --- */
  /* Catatan: demo memakai nama jamak `transactions_added` dengan meta hitungan
   * — berbeda dari `transaction_added` milik store. didaftarkan APA ADANYA di
   * sini supaya tidak gagal uji, tapi percabangan kosakata ini perlu
   * diputuskan pemilik demo: dua nama untuk dua bentuk adalah utang kecil
   * yang menagih mahal nanti. */
  transactions_added: { jumlah: 'angka' },
};

/*
 * Ratsu teks bebas: jenis → daftar jalur medan (dukung `a.b` untuk meta
 * bertingkat). Medan di sini IKUT tersimpan di jejak lengkap, dan WAJIB
 * dibuang oleh ekspor anonim.
 */
export const TEKS_BEBAS = {
  peserta_dinamai: ['sebelum', 'sesudah'], // seluruh meta praktis habis — lihat BANG_META_ANONIM
  ai_feedback: ['alasan'],
  latihan_dijawab: ['konsep'],
  latihan_ai_dijawab: ['konsep'],
};

const POLA = {
  // Kata boleh kosong: `batch_assigned.sebelum` sah berupa '' (peserta belum
  // punya batch) — kosong bukan teks bebas.
  kata: /^[A-Za-z0-9-]{0,32}$/,
  tanggal: /^\d{4}-\d{2}-\d{2}$/,
  waktu: /^\d{4}-\d{2}-\d{2}T/,
};

/**
 * Memeriksa satu meta terdaftar. Mengembalikan daftar pelanggaran (kosong =
 * sah). Tidak melempar — peneleponnya (uji) yang memutuskan bagaimana
 * pelanggaran dilaporkan.
 */
export function periksaMetaJejak(type, meta) {
  const skema = SKEMA_JEJAK[type];
  if (!skema) return [`jenis peristiwa tidak terdaftar: ${type}`];
  if (meta == null) return [];

  const pelanggaran = [];
  const kunciSkema = Object.keys(skema).map((k) => k.replace('?', ''));
  for (const kunci of Object.keys(meta)) {
    if (!kunciSkema.includes(kunci)) {
      pelanggaran.push(`${type}.${kunci}: medan tidak terdaftar`);
      continue;
    }
    // '?' pada JENIS menandai medan opsional; '?' pada KUNCI cara lama yang
    // sama — keduanya dinormalkan di sini supaya cekJenis menerima jenis polos.
    const jenis = String(skema[kunci] ?? skema[`${kunci}?`]).replace('?', '');
    const nilai = meta[kunci];
    if (nilai == null) continue; // kosong eksplisit (mis. setMulai(null)) = tidak diisi
    if (!cekJenis(jenis, nilai)) {
      pelanggaran.push(`${type}.${kunci}: nilai di luar jenis ${jenis}`);
    }
  }
  return pelanggaran;
}

function cekJenis(jenis, nilai) {
  switch (jenis) {
    case 'angka': return typeof nilai === 'number' && Number.isFinite(nilai);
    case 'bool': return typeof nilai === 'boolean';
    case 'tanggal': return typeof nilai === 'string' && POLA.tanggal.test(nilai);
    case 'waktu': return typeof nilai === 'string' && POLA.waktu.test(nilai);
    case 'kata': return typeof nilai === 'string' && POLA.kata.test(nilai);
    case 'id': return typeof nilai === 'string' && /^[\w.:-]{1,80}$/.test(nilai);
    case 'daftarAngka': return Array.isArray(nilai) && nilai.every((n) => typeof n === 'number' && Number.isFinite(n));
    case 'teks40': return typeof nilai === 'string' && nilai.length <= 40;
    case 'teks500': return typeof nilai === 'string' && nilai.length <= 500;
    case 'identitas':
      return nilai !== null && typeof nilai === 'object' &&
        Object.keys(nilai).every((k) => ['name', 'business'].includes(k)) &&
        Object.values(nilai).every((v) => typeof v === 'string' || v === undefined);
    default: return false;
  }
}

/**
 * Meta versi ekspor ANONIM: membuang persis medan yang terdaftar di
 * TEKS_BEBAS — tidak lebih, tidak kurang. Mengembalikan `null` bila meta
 * hasilnya kosong, sehingga penulis CSV bisa membiarkan sel kosong.
 *
 * Ekspor LENGKAP tidak lewat sini sama sekali.
 */
export function bangMetaAnonim(type, meta) {
  if (!meta || typeof meta !== 'object') return null;
  const jalur = TEKS_BEBAS[type];
  if (!jalur) return { ...meta };
  const hasil = structuredClone(meta);
  for (const j of jalur) delete hasil[j];
  return Object.keys(hasil).length ? hasil : null;
}
