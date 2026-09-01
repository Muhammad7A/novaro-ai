/**
 * Instrumen validasi Ahli IT & Infrastruktur Sistem — Novaro.
 *
 * Berkas ini memuat:
 *   1. 6 Dimensi dan 25 butir pernyataan kelayakan infrastruktur IT penelitian.
 *   2. Skala penilaian Likert 1-5 dan kriteria interpretasi kelayakan.
 *   3. Perhitungan skor dan rekapitulasi data validasi IT.
 */

export const INSTRUMEN_IT_VERSI = 1;

/* ------------------------------------------------------------------ Skala */

export const SKALA_IT = [
  { nilai: 1, label: 'Sangat Tidak Layak' },
  { nilai: 2, label: 'Tidak Layak' },
  { nilai: 3, label: 'Cukup Layak' },
  { nilai: 4, label: 'Layak' },
  { nilai: 5, label: 'Sangat Layak' },
];

export const SKOR_MIN = 1;
export const SKOR_MAKS = 5;

/* ------------------------------------------------- Kriteria interpretasi */

export const KATEGORI_IT = [
  { kunci: 'sangat-layak', label: 'Sangat Layak', rentang: '81–100%', batasBawah: 80 },
  { kunci: 'layak', label: 'Layak', rentang: '61–80%', batasBawah: 60 },
  { kunci: 'cukup-layak', label: 'Cukup Layak', rentang: '41–60%', batasBawah: 40 },
  { kunci: 'kurang-layak', label: 'Kurang Layak', rentang: '21–40%', batasBawah: 20 },
  { kunci: 'tidak-layak', label: 'Tidak Layak', rentang: '0–20%', batasBawah: -Infinity },
];

export function kategoriKelayakanIT(persen) {
  const n = Number(persen);
  if (!Number.isFinite(n)) return KATEGORI_IT.at(-1);
  return KATEGORI_IT.find((k) => n > k.batasBawah) ?? KATEGORI_IT.at(-1);
}

/* ------------------------------------------------------------------ Aspek */

export const ASPEK_IT = [
  {
    kunci: 'IT_A1',
    nama: 'Arsitektur Sistem & Deployment Cloud',
    deskripsi: 'Evaluasi struktur modular, kontainerisasi, skalabilitas cloud, dan manajemen konfigurasi.',
  },
  {
    kunci: 'IT_A2',
    nama: 'Keamanan, Autentikasi & Privasi Data',
    deskripsi: 'Evaluasi mekanisme otentikasi tanpa kata sandi, proteksi brute-force, RBAC, HTTPS, dan hak privasi.',
  },
  {
    kunci: 'IT_A3',
    nama: 'Integritas Basis Data & Ketahanan Penyimpanan',
    deskripsi: 'Evaluasi persistensi PostgreSQL Managed DB, health probe, integritas relasional, dan pencadangan.',
  },
  {
    kunci: 'IT_A4',
    nama: 'Kinerja, Efisiensi Jaringan & Aksesibilitas',
    deskripsi: 'Evaluasi efisiensi transfer data seluler, caching aset, latensi API, dan optimasi streaming SSE.',
  },
  {
    kunci: 'IT_A5',
    nama: 'Keandalan Integrasi Kecerdasan Buatan (AI Engine)',
    deskripsi: 'Evaluasi stabilitas gateway AI, pengendalian anggaran token, injeksi konteks, dan proteksi jadwal belajar.',
  },
  {
    kunci: 'IT_A6',
    nama: 'Auditabilitas, Logging & Instrumentasi Penelitian',
    deskripsi: 'Evaluasi pencatatan jejak aktivitas, sanitasi log dari kredensial, kemudahan ekspor, dan error handling.',
  },
];

/* ------------------------------------------------------------------ Butir */

export const BUTIR_IT = [
  /* --- IT_A1: Arsitektur Sistem & Deployment Cloud (4 Butir) --- */
  {
    kode: 'IT01',
    aspek: 'IT_A1',
    pernyataan:
      'Pemisahan lapisan sistem (decoupled architecture) antara antarmuka klien (SPA), backend API Express, basis data PostgreSQL, dan layanan AI Gemini terstruktur secara jelas dan independen.',
    rujukan: 'Struktur direktori server/, server/server.js, server/lib/',
  },
  {
    kode: 'IT02',
    aspek: 'IT_A1',
    pernyataan:
      'Penerapan kontainerisasi (Docker) pada Google Cloud Run menjamin portabilitas, konsistensi lingkungan produksi Linux, dan kemudahan deployment ulang tanpa ketergantungan konfigurasi mesin lokal.',
    rujukan: 'server/Dockerfile, server/docker-entrypoint.sh, Cloud Run Service',
  },
  {
    kode: 'IT03',
    aspek: 'IT_A1',
    pernyataan:
      'Konfigurasi serverless autoscaling pada Google Cloud Run memadai untuk menangani variasi konkurensi akses 50 peserta penelitian tanpa terjadi kegagalan alokasi sumber daya komputasi.',
    rujukan: 'Cloud Run autoscaling (min/max instances, concurrency limit)',
  },
  {
    kode: 'IT04',
    aspek: 'IT_A1',
    pernyataan:
      'Manajemen konfigurasi sistem (Environment Variables & Secrets) terkelola secara aman dan terisolasi tanpa ada kredensial sensitif atau string koneksi basis data yang tertulis permanen (hardcoded) di kode sumber.',
    rujukan: 'server/.env.example, server/lib/db.js, Cloud Run env vars',
  },

  /* --- IT_A2: Keamanan, Autentikasi & Privasi Data (5 Butir) --- */
  {
    kode: 'IT05',
    aspek: 'IT_A2',
    pernyataan:
      'Skema autentikasi berbasis kode akses unik (mis. NOVA-XXXX-XXXX) efektif memberikan akses tanpa beban pengelolaan kata sandi bagi peserta UMKM sekaligus menjaga prinsip anonimitas data penelitian.',
    rujukan: 'server/lib/guard.js, rute POST /api/login, tabel users',
  },
  {
    kode: 'IT06',
    aspek: 'IT_A2',
    pernyataan:
      'Sistem menerapkan proteksi terhadap upaya serangan tebakan kode (brute-force protection) dengan mekanisme pembatasan percobaan login, penundaan respons, dan pencatatan insiden keamanan.',
    rujukan: 'server/lib/guard.js fungsi periksaKodeAkses',
  },
  {
    kode: 'IT07',
    aspek: 'IT_A2',
    pernyataan:
      'Pemisahan hak akses berbasis peran (RBAC) terisolasi secara ketat sehingga kode akses peserta, kode validator materi/IT (VALIDASI_KODE), dan kode pengelola (VALIDASI_PENGELOLA_KODE) tidak dapat saling membuka data satu sama lain.',
    rujukan: 'server/server.js fungsi autentikasiValidator & autentikasiPengelola',
  },
  {
    kode: 'IT08',
    aspek: 'IT_A2',
    pernyataan:
      'Seluruh pertukaran data antara peramban peserta dan server diproteksi melalui protokol terenkripsi HTTPS (TLS) dengan header keamanan modern (CSP, HSTS, X-Content-Type-Options).',
    rujukan: 'server/lib/keamanan.js securityHeaders & forceHttps',
  },
  {
    kode: 'IT09',
    aspek: 'IT_A2',
    pernyataan:
      'Hak privasi subjek penelitian terjamin melalui penyediaan fitur pengunduhan salinan data mandiri (GET /api/my-data) dan opsi penarikan diri/penghapusan akun permanen (DELETE /api/my-account).',
    rujukan: 'rute /api/my-data dan /api/my-account di server/server.js',
  },

  /* --- IT_A3: Integritas Basis Data & Ketahanan Penyimpanan (4 Butir) --- */
  {
    kode: 'IT10',
    aspek: 'IT_A3',
    pernyataan:
      'Penyimpanan data pada Managed Cloud SQL PostgreSQL menjamin persistensi data profil, pembukuan, transaksi, dan riwayat belajar peserta tidak hilang saat kontainer Cloud Run dimatikan atau direstart.',
    rujukan: 'server/lib/db.js, Cloud SQL PostgreSQL socket connection',
  },
  {
    kode: 'IT11',
    aspek: 'IT_A3',
    pernyataan:
      'Pemeriksaan kesehatan penyimpanan (health check probe pada /api/health) memverifikasi kesiapan operasional baca dan tulis basis data secara riil sebelum instance melayani permintaan peserta.',
    rujukan: 'server/lib/kesehatan.js, endpoint GET /api/health',
  },
  {
    kode: 'IT12',
    aspek: 'IT_A3',
    pernyataan:
      'Integritas data transaksi keuangan dijaga melalui sanitasi tipe data, validasi tanggal logis, dan batasan numerik pada sisi server untuk mencegah data rusak (corrupted data) masuk ke basis data.',
    rujukan: 'server/server.js fungsi sanitizeProfile & rute /api/cashbook',
  },
  {
    kode: 'IT13',
    aspek: 'IT_A3',
    pernyataan:
      'Tersedia mekanisme pencadangan otomatis (automated backup) dan prosedur pemulihan data (disaster recovery) untuk mengamankan data empiris selama masa intervensi penelitian berlangsung.',
    rujukan: 'server/lib/cadangan.js, jadwal scheduleBackups(), Cloud SQL Backup',
  },

  /* --- IT_A4: Kinerja, Efisiensi Jaringan & Aksesibilitas (4 Butir) --- */
  {
    kode: 'IT14',
    aspek: 'IT_A4',
    pernyataan:
      'Strategi kompresi aset dan pemisahan modul statis (/modul.js) yang dapat di-cache oleh browser efektif menghemat kuota internet dan mempercepat pemuatan aplikasi di perangkat seluler peserta.',
    rujukan: 'server/server.js asetDariBerkas, gzip kompresi di memori',
  },
  {
    kode: 'IT15',
    aspek: 'IT_A4',
    pernyataan:
      'Waktu respons server (latensi API) untuk operasi standar non-AI (buku kas, dasbor, profil) berada dalam ambang batas cepat dan responsif (< 500 ms) pada koneksi jaringan seluler standar.',
    rujukan: 'Express REST routing, PostgreSQL connection pooling',
  },
  {
    kode: 'IT16',
    aspek: 'IT_A4',
    pernyataan:
      'Pemanfaatan Server-Sent Events (SSE) untuk streaming respons percakapan AI memberikan umpan balik visual secara realtime tanpa mengalami pemutusan koneksi (timeout).',
    rujukan: 'server/server.js rute POST /api/chat dengan event-stream',
  },
  {
    kode: 'IT17',
    aspek: 'IT_A4',
    pernyataan:
      'Penanganan pemutusan koneksi klien (AbortController on close) bekerja dengan benar untuk menghentikan pemanggilan AI yang belum selesai saat peserta menutup peramban di tengah proses.',
    rujukan: 'server/server.js AbortController pada /api/chat dan /api/recommendations',
  },

  /* --- IT_A5: Keandalan Integrasi Kecerdasan Buatan (AI Engine) (4 Butir) --- */
  {
    kode: 'IT18',
    aspek: 'IT_A5',
    pernyataan:
      'Integrasi dengan model Gemini melalui Vertex AI berjalan stabil dan memiliki mekanisme penanganan kesalahan (error fallback & retry) yang informatif apabila terjadi kegagalan jaringan eksternal.',
    rujukan: 'server/lib/gemini.js, server/lib/gemini-galat.js describeError',
  },
  {
    kode: 'IT19',
    aspek: 'IT_A5',
    pernyataan:
      'Sistem pembatasan laju pemanggilan (rate limiting per jam) dan kuota anggaran token per pengguna efektif mengendalikan pemakaian komputasi AI serta mencegah pembengkakan biaya.',
    rujukan: 'server/lib/anggaran.js, middleware rateLimit & anggaranToken',
  },
  {
    kode: 'IT20',
    aspek: 'IT_A5',
    pernyataan:
      'Mekanisme perakitan prompt dinamis (context injection) secara akurat memasukkan ringkasan profil usaha, riwayat buku kas, dan kemajuan belajar peserta tanpa melebihi batas token model.',
    rujukan: 'server/lib/ai-konteks.js cashbookContext & ringkasKemajuan',
  },
  {
    kode: 'IT21',
    aspek: 'IT_A5',
    pernyataan:
      'Server menerapkan gerbang validasi jadwal (schedule guard) yang ketat sehingga asisten AI tidak membocorkan materi sesi harian yang belum terbuka untuk peserta yang bersangkutan.',
    rujukan: 'server/server.js fungsi modulDiminta, server/lib/jadwal.js',
  },

  /* --- IT_A6: Auditabilitas, Logging & Instrumentasi Penelitian (4 Butir) --- */
  {
    kode: 'IT22',
    aspek: 'IT_A6',
    pernyataan:
      'Sistem mencatat setiap interaksi penting penelitian (login, penyelesaian modul, penambahan transaksi, interaksi AI, dan umpan balik pengguna) ke dalam log peristiwa (event log) secara kronologis.',
    rujukan: 'server/lib/store.js fungsi logEvent, tabel events',
  },
  {
    kode: 'IT23',
    aspek: 'IT_A6',
    pernyataan:
      'Sanitasi catatan log sistem (log privacy) memastikan tidak ada informasi data pribadi rahasia (PII) atau nama validator ahli yang bocor ke sistem pemantauan Cloud Logging.',
    rujukan: 'server/lib/log.js sanitasi parameter log',
  },
  {
    kode: 'IT24',
    aspek: 'IT_A6',
    pernyataan:
      'Struktur data penelitian siap diekspor ke dalam format standar (JSON/CSV) untuk memudahkan pengolahan data statistik lanjutan dan evaluasi efektivitas intervensi.',
    rujukan: 'server/lib/store.js exportUser, rekapitulasi data validasi',
  },
  {
    kode: 'IT25',
    aspek: 'IT_A6',
    pernyataan:
      'Penanganan galat sistem (error handling) bersifat ramah pengguna dan tidak menampilkan jejak tumpukan kesalahan internal (internal stack trace) yang berpotensi menjadi celah keamanan.',
    rujukan: 'server/server.js middleware error handler akhir',
  },
];

/* ------------------------------------------------------------ Kesimpulan */

export const KESIMPULAN_IT = [
  { kunci: 'layak-tanpa-revisi', label: 'Infrastruktur siap digunakan untuk penelitian tanpa revisi' },
  { kunci: 'layak-revisi-kecil', label: 'Infrastruktur layak digunakan untuk penelitian dengan revisi minor' },
  { kunci: 'layak-revisi-besar', label: 'Infrastruktur memerlukan perbaikan arsitektur/keamanan sebelum intervensi' },
  { kunci: 'belum-layak', label: 'Infrastruktur belum layak digunakan untuk penelitian' },
];

export const BIDANG_IT = [
  'Rekayasa Perangkat Lunak (Software Engineering)',
  'Infrastruktur Cloud & DevOps',
  'Keamanan Siber & Privasi Data (Cybersecurity)',
  'Basis Data & Rekayasa Data (Database Engineering)',
  'Sistem Informasi & Integrasi AI',
  'Evaluasi & Audit Sistem Informasi',
];

/* --------------------------------------------------------------- Turunan */

export const KODE_BUTIR_IT = BUTIR_IT.map((b) => b.kode);
export const JUMLAH_BUTIR_IT = BUTIR_IT.length;
export const SKOR_MAKSIMUM_PENUH_IT = JUMLAH_BUTIR_IT * SKOR_MAKS;

export function cariButirIT(kode) {
  return BUTIR_IT.find((b) => b.kode === kode) ?? null;
}

export function cariAspekIT(kunci) {
  return ASPEK_IT.find((a) => a.kunci === kunci) ?? null;
}

export function butirAspekIT(kunci) {
  return BUTIR_IT.filter((b) => b.aspek === kunci);
}

export function instrumenIT() {
  return {
    versi: INSTRUMEN_IT_VERSI,
    jenis: 'it',
    judul: 'Instrumen Validasi Ahli IT & Infrastruktur Sistem',
    skala: SKALA_IT,
    kategori: KATEGORI_IT.map((k) => ({ ...k, batasBawah: Number.isFinite(k.batasBawah) ? k.batasBawah : null })),
    kesimpulan: KESIMPULAN_IT,
    bidang: BIDANG_IT,
    jumlahButir: JUMLAH_BUTIR_IT,
    skorMaksimum: SKOR_MAKSIMUM_PENUH_IT,
    aspek: ASPEK_IT.map((a) => ({ ...a, butir: butirAspekIT(a.kunci) })),
  };
}

/* ----------------------------------------------------------- Perhitungan */

export function skorSah(nilai) {
  const n = Number(nilai);
  return Number.isInteger(n) && n >= SKOR_MIN && n <= SKOR_MAKS;
}

const ambilJawaban = (jawaban, kode) =>
  jawaban && typeof jawaban === 'object' && Object.hasOwn(jawaban, kode) ? jawaban[kode] : undefined;

const bulat2 = (n) => Number((Math.round(n * 100) / 100).toFixed(2));

export function persentaseKelayakanIT(skor, maksimum) {
  if (!maksimum) return 0;
  return bulat2((skor / maksimum) * 100);
}

export function hitungHasilIT(jawaban = {}) {
  const nilai = (kode) => {
    const j = ambilJawaban(jawaban, kode);
    const skor = j && typeof j === 'object' ? j.skor : j;
    return skorSah(skor) ? Number(skor) : null;
  };

  const dinilai = [];
  const belumDinilai = [];
  for (const b of BUTIR_IT) {
    const n = nilai(b.kode);
    if (n === null) belumDinilai.push(b.kode);
    else dinilai.push({ kode: b.kode, aspek: b.aspek, skor: n });
  }

  const skorDiperoleh = dinilai.reduce((s, b) => s + b.skor, 0);
  const skorMaksimum = dinilai.length * SKOR_MAKS;
  const persentase = persentaseKelayakanIT(skorDiperoleh, skorMaksimum);

  const aspek = ASPEK_IT.map((a) => {
    const isi = dinilai.filter((b) => b.aspek === a.kunci);
    const skor = isi.reduce((s, b) => s + b.skor, 0);
    const maks = isi.length * SKOR_MAKS;
    const persen = persentaseKelayakanIT(skor, maks);
    return {
      kunci: a.kunci,
      nama: a.nama,
      deskripsi: a.deskripsi,
      butirDinilai: isi.length,
      butirTotal: butirAspekIT(a.kunci).length,
      skor,
      skorMaksimum: maks,
      persentase: persen,
      kategori: isi.length ? kategoriKelayakanIT(persen).kunci : null,
    };
  });

  return {
    instrumenVersi: INSTRUMEN_IT_VERSI,
    jenis: 'it',
    butirDinilai: dinilai.length,
    butirTotal: JUMLAH_BUTIR_IT,
    lengkap: dinilai.length === JUMLAH_BUTIR_IT,
    belumDinilai,
    skorDiperoleh,
    skorMaksimum,
    persentase,
    rataButir: dinilai.length ? bulat2(skorDiperoleh / dinilai.length) : 0,
    kategori: dinilai.length ? kategoriKelayakanIT(persentase) : null,
    aspek,
  };
}

/* -------------------------------------------------------- Pemeriksaan isi */

const teks = (v, maks) => String(v ?? '').trim().slice(0, maks);

const BATAS = {
  nama: 100,
  institusi: 150,
  jabatan: 100,
  bidangLain: 100,
  komentar: 600,
  catatan: 3000,
  revisiCatatan: 600,
  revisiMaks: 30,
};

function tanggalSah(nilai) {
  const t = teks(nilai, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t ? null : t;
}

export function periksaPengirimanIT(body = {}, { hariIni } = {}) {
  const errors = [];
  const v = body?.validator ?? {};

  const nama = teks(v.nama, BATAS.nama);
  if (!nama) errors.push('Nama validator IT wajib diisi.');

  const bidangPilihan = Array.isArray(v.bidang)
    ? v.bidang.map((b) => teks(b, BATAS.bidangLain)).filter(Boolean).slice(0, BIDANG_IT.length + 3)
    : [];
  if (!bidangPilihan.length) errors.push('Bidang keahlian validator IT wajib diisi minimal satu.');

  const tanggal = tanggalSah(v.tanggalValidasi);
  if (!tanggal) errors.push('Tanggal validasi wajib diisi dengan format tahun-bulan-tanggal.');
  else if (hariIni && tanggal > hariIni) errors.push('Tanggal validasi tidak boleh di masa depan.');

  const kesimpulan = KESIMPULAN_IT.find((k) => k.kunci === body?.kesimpulan)?.kunci ?? null;
  if (!kesimpulan) errors.push('Kesimpulan kelayakan infrastruktur wajib dipilih.');

  const jawaban = {};
  const kosong = [];
  const tanpaAlasan = [];
  for (const b of BUTIR_IT) {
    const masuk = ambilJawaban(body?.jawaban, b.kode);
    const skorMentah = masuk && typeof masuk === 'object' ? masuk.skor : masuk;
    const komentar = teks(masuk && typeof masuk === 'object' ? masuk.komentar : '', BATAS.komentar);
    if (!skorSah(skorMentah)) {
      kosong.push(b.kode);
      continue;
    }
    const skor = Number(skorMentah);
    if (skor <= 2 && !komentar) tanpaAlasan.push(b.kode);
    jawaban[b.kode] = { skor, komentar };
  }

  if (kosong.length) {
    errors.push(`Masih ada ${kosong.length} butir instrumen IT yang belum dinilai: ${kosong.join(', ')}.`);
  }
  if (tanpaAlasan.length) {
    errors.push(
      `Butir IT yang dinilai 1 atau 2 wajib disertai komentar agar dapat ditindaklanjuti: ${tanpaAlasan.join(', ')}.`,
    );
  }

  const perluRevisi = (Array.isArray(body?.materiPerluRevisi) ? body.materiPerluRevisi : [])
    .slice(0, BATAS.revisiMaks)
    .map((r) => ({
      bagian: teks(r?.bagian, 120),
      catatan: teks(r?.catatan, BATAS.revisiCatatan),
    }))
    .filter((r) => r.bagian || r.catatan);

  if (errors.length) return { data: null, errors };

  return {
    errors: [],
    data: {
      instrumenVersi: INSTRUMEN_IT_VERSI,
      jenis: 'it',
      validator: {
        nama,
        institusi: teks(v.institusi, BATAS.institusi),
        jabatan: teks(v.jabatan, BATAS.jabatan),
        bidang: bidangPilihan,
        tanggalValidasi: tanggal,
      },
      jawaban,
      kesimpulan,
      catatanUmum: teks(body?.catatanUmum, BATAS.catatan),
      rekomendasi: teks(body?.rekomendasi, BATAS.catatan),
      materiPerluRevisi: perluRevisi,
    },
  };
}

/* ------------------------------------------------------------ Rekapitulasi */

export function rekapValidasiIT(daftar = []) {
  const sah = (Array.isArray(daftar) ? daftar : []).filter((d) => d?.jawaban && (d?.jenis === 'it' || d?.jawaban?.IT01 !== undefined));
  if (!sah.length) {
    return {
      jenis: 'it',
      jumlahValidator: 0,
      lembarLengkap: 0,
      skorDiperoleh: 0,
      skorMaksimum: 0,
      persentase: null,
      kategori: null,
      rataButir: 0,
      butir: [],
      aspek: [],
    };
  }

  const hasil = sah.map((d) => hitungHasilIT(d.jawaban));

  const skorDiperoleh = hasil.reduce((s, h) => s + h.skorDiperoleh, 0);
  const skorMaksimum = hasil.reduce((s, h) => s + h.skorMaksimum, 0);
  const persentase = persentaseKelayakanIT(skorDiperoleh, skorMaksimum);

  const butir = BUTIR_IT.map((b) => {
    const skor = sah.map((d) => ambilJawaban(d.jawaban, b.kode)?.skor).filter((s) => skorSah(s)).map(Number);
    const jumlah = skor.reduce((s, n) => s + n, 0);
    return {
      kode: b.kode,
      aspek: b.aspek,
      pernyataan: b.pernyataan,
      penilai: skor.length,
      skor: jumlah,
      skorMaksimum: skor.length * SKOR_MAKS,
      rata: skor.length ? bulat2(jumlah / skor.length) : 0,
      persentase: persentaseKelayakanIT(jumlah, skor.length * SKOR_MAKS),
      terendah: skor.length ? Math.min(...skor) : null,
    };
  });

  const aspek = ASPEK_IT.map((a) => {
    const isi = butir.filter((b) => b.aspek === a.kunci);
    const skor = isi.reduce((s, b) => s + b.skor, 0);
    const maks = isi.reduce((s, b) => s + b.skorMaksimum, 0);
    const persen = persentaseKelayakanIT(skor, maks);
    return {
      kunci: a.kunci,
      nama: a.nama,
      deskripsi: a.deskripsi,
      skor,
      skorMaksimum: maks,
      persentase: persen,
      kategori: maks ? kategoriKelayakanIT(persen).label : null,
    };
  });

  return {
    jenis: 'it',
    jumlahValidator: sah.length,
    lembarLengkap: hasil.filter((h) => h.lengkap).length,
    skorDiperoleh,
    skorMaksimum,
    persentase,
    kategori: kategoriKelayakanIT(persentase),
    rataButir: bulat2(butir.reduce((s, b) => s + b.rata, 0) / butir.length),
    butir,
    aspek,
  };
}
