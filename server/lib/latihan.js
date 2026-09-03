/**
 * Latihan micro-learning — soal, pemeriksa, dan sanitizer soal AI.
 *
 * ------------------------------------------------------------------
 * KENAPA BERKAS INI ADA
 *
 * Materi selama ini satu arah: dibaca, ditandai selesai. Berkas ini
 * menambahkan lapisan yang hilang itu — SOAL — dengan tiga keputusan
 * rancangan yang dijaga ketat:
 *
 *   1. Kunci jawaban TIDAK PERNAH sampai ke peramban. Berkas ini hanya
 *      hidup di server; peramban menerima soal tanpa kunci lewat
 *      /api/latihan/:no dan mengirim jawabannya untuk DINILAI di sini.
 *      (Kebalikan pola simulasi-kur.js yang rumusnya sengaja ikut ke
 *      peramban — di sini kuncinya rahasia, jadi arah datanya dibalik.)
 *   2. Penilaian deterministik. Pilihan = pencocokan huruf; hitung =
 *      angka dengan toleransi; golong = pencocokan urutan golongan.
 *      Tidak ada AI di jalur ini — AI hanya membuat soal tambahan
 *      (sanitasiLatihanAI di bawah), tidak pernah MENILAI jawaban.
 *   3. Soal selalu setia pada materi modulnya dan kategori resmi buku
 *      kas (KATEGORI di lib/cashbook.js) — latihan yang mengajarkan
 *      kategori yang tidak ada di aplikasi adalah latihan yang salah.
 *
 * Soal hanya untuk tujuh sesi jalur dasar — inilah program intinya;
 * modul pustaka tetap bebas dibaca tanpa gerbang apa pun.
 */

/* ----------------------------------------------------------------- Soal */

const SOAL = {
  1: [
    {
      tipe: 'hitung',
      pertanyaan: 'Sehari: penjualan Rp 900.000, belanja bahan Rp 480.000, gas & listrik Rp 110.000. Berapa laba bersih hari itu? (dalam rupiah)',
      kunci: 310_000,
      satuan: 'rupiah',
      penjelasan: 'Laba = penjualan − belanja bahan − biaya operasional = 900.000 − 480.000 − 110.000 = Rp 310.000. Bukan Rp 900.000 — itu baru omzet.',
      konsep: 'omzet-laba-kas',
    },
    {
      tipe: 'golong',
      pertanyaan: 'Pilah kejadian uang ini: mana yang dicatat sebagai keuangan USAHA dan mana PRIBADI?',
      item: ['Beli gas 3 kg', 'Beli pulsa anak', 'Penjualan nasi pagi', 'Bayar arisan'],
      golongan: ['Usaha', 'Pribadi'],
      kunci: [0, 1, 0, 1],
      penjelasan: 'Gas dan hasil jualan adalah urusan usaha. Pulsa anak dan arisan tetap menghabiskan uang dari laci yang sama — tapi itu pribadi, dan wajib dicatat sebagai prive supaya tidak mencemari laba.',
      konsep: 'prive',
    },
    {
      tipe: 'pilihan',
      pertanyaan: 'Kamu mengambil Rp 100.000 dari laci untuk kebutuhan rumah. Apa dampaknya di catatan?',
      pilihan: {
        A: 'Laba berkurang Rp 100.000',
        B: 'Kas berkurang Rp 100.000, laba tetap',
        C: 'Tidak berpengaruh di mana pun',
      },
      kunci: 'B',
      penjelasan: 'Prive mengurangi UANG KAS, tapi bukan biaya usaha — laba tetap. Kalau prive dicatat sebagai biaya, usaha yang sehat bisa terlihat rugi.',
      konsep: 'prive',
    },
  ],
  2: [
    {
      tipe: 'pilihan',
      pertanyaan: 'Ponsel yang kamu pakai mencatat hilang. Apa yang terjadi pada catatan kas di aplikasi?',
      pilihan: {
        A: 'Hilang bersama ponselnya',
        B: 'Tetap aman — tersimpan di server, bisa dibuka dari perangkat mana pun',
        C: 'Tetap ada tapi tidak bisa ditambah lagi',
      },
      kunci: 'B',
      penjelasan: 'Cloud accounting menyimpan catatan di server, bukan di satu ponsel. Ponsel hanya jendela — ganti jendela, rumahnya tetap.',
      konsep: 'catatan-awet',
    },
    {
      tipe: 'pilihan',
      pertanyaan: 'Satu transaksi salah dan kamu hapus. Yang paling menggambarkan cloud accounting yang benar:',
      pilihan: {
        A: 'Kesalahan menghilang tanpa jejak — bersih lagi',
        B: 'Koreksinya meninggalkan jejak yang bisa ditelusuri',
        C: 'Transaksi yang dihapus tidak boleh dilakukan',
      },
      kunci: 'B',
      penjelasan: 'Catatan yang punya jejak perubahan jauh lebih dipercaya — termasuk oleh bank. Buku tulis mencoret, aplikasi mencatat jejaknya.',
      konsep: 'jejak-perubahan',
    },
    {
      tipe: 'golong',
      pertanyaan: 'Manakah ciri cloud accounting yang BENAR?',
      item: ['Data sama dari perangkat mana pun', 'Harus install aplikasi berat', 'Penjumlahan dihitung otomatis', 'Hanya untuk perusahaan besar'],
      golongan: ['Benar', 'Salah'],
      kunci: [0, 1, 0, 1],
      penjelasan: 'Cukup peramban di HP, dihitung server dengan rumus tetap, dan justru warung kecil paling terbantu karena tidak punya staf pembukuan.',
      konsep: 'catatan-awet',
    },
  ],
  3: [
    {
      tipe: 'golong',
      pertanyaan: 'Masukkan tiap kejadian ke kategori buku kas yang benar:',
      item: ['Penjualan sore Rp 310.000', 'Belanja pasar daging & sayur', 'Beli gas 3 kg', 'Ambil uang untuk keperluan rumah'],
      golongan: ['Penjualan', 'Belanja bahan', 'Operasional', 'Prive'],
      kunci: [0, 1, 2, 3],
      penjelasan: 'Hasil jualan = Penjualan. Bahan yang habis dipakai = Belanja bahan. Gas = Operasional. Uang untuk rumah = Prive — bukan biaya usaha.',
      konsep: 'kategori',
    },
    {
      tipe: 'hitung',
      pertanyaan: 'Belanja bahan Rp 200.000 dapat potongan Rp 50.000. Berapa yang dicatat di buku kas? (dalam rupiah)',
      kunci: 150_000,
      satuan: 'rupiah',
      penjelasan: 'Yang dicatat adalah uang yang BENAR-BENAR keluar: Rp 150.000. Menulis Rp 200.000 membuat biaya terlihat lebih besar dan laba terlihat lebih kecil dari kenyataan.',
      konsep: 'kategori',
    },
    {
      tipe: 'pilihan',
      pertanyaan: 'Ibu meminjamkan Rp 2.000.000 untuk modal. Boleh dicatat sebagai penjualan?',
      pilihan: {
        A: 'Boleh — uangnya masuk kok',
        B: 'Tidak — itu modal masuk/pinjaman, bukan hasil jualan',
        C: 'Boleh, asal diberi keterangan "pinjaman"',
      },
      kunci: 'B',
      penjelasan: 'Penjualan adalah uang dari hasil jualan. Pinjaman dicatat sebagai pemasukan lain — kalau dihitung omzet, labamu karangan dan laporan KUR-mu menyesatkan.',
      konsep: 'kategori',
    },
  ],
  4: [
    {
      tipe: 'hitung',
      pertanyaan: 'Penjualan Rp 150.000, belanja bahan Rp 60.000. Berapa laba KOTOR-nya? (dalam rupiah)',
      kunci: 90_000,
      satuan: 'rupiah',
      penjelasan: 'Laba kotor = penjualan − belanja bahan = 150.000 − 60.000 = Rp 90.000. Angka ini menjawab: apakah harga jual sudah di atas modal bahan?',
      konsep: 'laba-kotor',
    },
    {
      tipe: 'hitung',
      pertanyaan: 'Dari laba kotor Rp 90.000 tadi, biaya operasional (gas, sewa harian) Rp 30.000. Berapa laba BERSIH? (dalam rupiah)',
      kunci: 60_000,
      satuan: 'rupiah',
      penjelasan: 'Laba bersih = laba kotor − biaya operasional = 90.000 − 30.000 = Rp 60.000. Kalau kotor besar tapi bersih tipis, masalahnya di biaya operasional — bukan di harga.',
      konsep: 'laba-bersih',
    },
    {
      tipe: 'pilihan',
      pertanyaan: 'Prive dicatat sebagai biaya usaha. Akibatnya pada laporan?',
      pilihan: {
        A: 'Usaha terlihat rugi padahal sebenarnya sehat',
        B: 'Laporan tetap benar, hanya lebih rinci',
        C: 'Kas terlihat lebih besar dari kenyataan',
      },
      kunci: 'A',
      penjelasan: 'Prive bukan biaya — ia mengurangi kas, bukan laba. Dicatat sebagai biaya, usaha yang sehat terlihat rugi dan bisa sampai ditutup karena salah baca.',
      konsep: 'prive',
    },
  ],
  5: [
    {
      tipe: 'hitung',
      pertanyaan: 'Teh: 1 kotak Rp 8.000 bisa untuk 40 gelas. Berapa HPP teh per gelas? (dalam rupiah)',
      kunci: 200,
      satuan: 'rupiah',
      penjelasan: 'HPP per gelas = 8.000 ÷ 40 = Rp 200. HPP hanya hitung BAHANNYA — sewa, listrik, dan tenagamu tidak masuk sini.',
      konsep: 'hpp',
    },
    {
      tipe: 'pilihan',
      pertanyaan: 'Margin per porsi dihitung dengan membagi laba per porsi dengan…',
      pilihan: {
        A: 'HPP per porsi',
        B: 'Harga jual per porsi',
        C: 'Omzet sebulan',
      },
      kunci: 'B',
      penjelasan: 'Margin = (harga jual − HPP) ÷ HARGA JUAL. Membagi dengan HPP menghasilkan markup — angkanya selalu terlihat lebih besar dan bikin merasa untung lebih banyak dari kenyataan.',
      konsep: 'margin',
    },
    {
      tipe: 'hitung',
      pertanyaan: 'Ayam geprek dijual Rp 28.000 dengan HPP Rp 11.100. Berapa margin rupiah per porsi? (dalam rupiah)',
      kunci: 16_900,
      satuan: 'rupiah',
      penjelasan: 'Margin rupiah = 28.000 − 11.100 = Rp 16.900 per porsi. Dibanding harga jual, marginnya 60% — sehat. HPP 11.100 × 2,5 = Rp 27.750, jadi harga Rp 28.000 memang di atas ambang aman.',
      konsep: 'margin',
    },
  ],
  6: [
    {
      tipe: 'pilihan',
      pertanyaan: 'Penjualan Rp 80.000 tidak sengaja tercatat dua kali. Laporannya menjadi…',
      pilihan: {
        A: 'Laba terlihat lebih RENDAH dari sebenarnya',
        B: 'Laba terlihat lebih TINGGI dari sebenarnya — yang paling berbahaya',
        C: 'Tidak berpengaruh, saldo tetap benar',
      },
      kunci: 'B',
      penjelasan: 'Duplikasi pemasukan menyenangkan — makanya jarang diperiksa. Ciri khasnya: dua baris dengan tanggal, jumlah, dan keterangan yang persis sama.',
      konsep: 'duplikasi',
    },
    {
      tipe: 'pilihan',
      pertanyaan: 'Kemarin kamu lupa mencatat penjualan. Tanggal yang benar untuk mencatatnya hari ini:',
      pilihan: {
        A: 'Hari ini — biar berurutan',
        B: 'Tanggal kejadian yang sebenarnya (kemarin)',
        C: 'Akhir bulan saja, sekalian',
      },
      kunci: 'B',
      penjelasan: 'Catat pada hari kejadiannya. Tanggal yang digeser membuat laporan bulanan meleset di DUA bulan sekaligus.',
      konsep: 'tanggal-kejadian',
    },
    {
      tipe: 'pilihan',
      pertanyaan: 'Tutup buku: saldo di aplikasi tidak cocok dengan uang di laci. Kapan sebaiknya dicari?',
      pilihan: {
        A: 'Besok, sambil santai',
        B: 'Akhir bulan, saat rekap',
        C: 'Sekarang, selagi masih ingat kejadiannya',
      },
      kunci: 'C',
      penjelasan: 'Besok sudah tidak mungkin ingat. Selisih kecil yang berulang biasanya menunjuk satu jenis transaksi yang selalu lupa dicatat.',
      konsep: 'tutup-buku',
    },
  ],
  7: [
    {
      tipe: 'pilihan',
      pertanyaan: 'Laporan menunjukkan laba besar tapi kas menipis. Penjelasan yang paling mungkin:',
      pilihan: {
        A: 'Usaha sedang rugi besar',
        B: 'Uangnya tertahan di piutang, stok, atau sudah terpakai prive/cicilan',
        C: 'Aplikasi salah menghitung',
      },
      kunci: 'B',
      penjelasan: 'Laba dan kas menjawab pertanyaan berbeda. Satu laporan sendirian selalu menyesatkan — bacalah kas, laba rugi, dan harta-utang berurutan.',
      konsep: 'baca-laporan',
    },
    {
      tipe: 'pilihan',
      pertanyaan: 'Ada satu bulan yang catatannya bolong. Angkanya di laporan…',
      pilihan: {
        A: 'Terlihat lebih kecil dari kenyataan — jangan dijadikan kesimpulan',
        B: 'Tetap akurat, hanya lebih sedikit barisnya',
        C: 'Otomatis dikoreksi dari bulan lain',
      },
      kunci: 'A',
      penjelasan: 'Bulan bolong menghasilkan angka yang terlihat persis seperti usaha menurun. Aplikasi menandainya — jangan ambil keputusan dari bulan bertanda itu.',
      konsep: 'bulan-bolong',
    },
    {
      tipe: 'pilihan',
      pertanyaan: 'Yang paling meyakinkan bank saat mengajukan KUR adalah…',
      pilihan: {
        A: 'Foto warung yang ramai dan cerita lisan',
        B: 'Omzet besar yang disebut dari ingatan',
        C: 'Catatan transaksi harian yang rutin 3–6 bulan, bisa dicetak sebagai laporan',
      },
      kunci: 'C',
      penjelasan: 'Bank setiap hari mendengar omzet dari ingatan. Yang mengubah percakapan adalah lembar catatan yang konsisten — dan itu sudah kamu hasilkan dari sesi 3.',
      konsep: 'berkas-kur',
    },
  ],
};

const MODUL_LATIHAN = Object.keys(SOAL).map(Number).sort((a, b) => a - b);

/** Ada latihan untuk modul ini? (hanya tujuh sesi jalur dasar) */
export function adaLatihan(no) {
  return Boolean(SOAL[Number(no)]);
}

/** Jumlah soal satu modul. */
export function totalSoal(no) {
  return (SOAL[Number(no)] ?? []).length;
}

/** Daftar nomor modul yang punya latihan. */
export function modulLatihan() {
  return [...MODUL_LATIHAN];
}

/**
 * Soal versi publik untuk peramban — kunci dan penjelasannya DIBUANG.
 * Penjelasan baru dikirim server bersama hasil penilaian tiap jawaban.
 */
export function soalPublik(no) {
  const daftar = SOAL[Number(no)] ?? [];
  return daftar.map((s) => {
    const publik = { tipe: s.tipe, pertanyaan: s.pertanyaan };
    if (s.pilihan) publik.pilihan = s.pilihan;
    if (s.item) {
      publik.item = s.item;
      publik.golongan = s.golongan;
    }
    if (s.satuan) publik.satuan = s.satuan;
    return publik;
  });
}

/**
 * Nilai SATU jawaban. Deterministik dan murni — tidak menyimpan apa pun;
 * penyimpanannya urusan store.simpanJawabanLatihan.
 *
 * Melempar {status:400} bila nomor/indeks tidak sah — jawaban yang tidak
 * bisa dinilai tidak boleh diam-diam dianggap salah.
 */
export function periksa(no, index, jawaban) {
  const daftar = SOAL[Number(no)] ?? [];
  const s = daftar[Number(index)];
  if (!s) {
    const err = new Error('Nomor soal tidak dikenali.');
    err.status = 400;
    throw err;
  }

  let benar = false;
  if (s.tipe === 'pilihan') {
    benar = String(jawaban ?? '').trim().toUpperCase() === s.kunci;
  } else if (s.tipe === 'hitung') {
    // Semua soal hitung berjawaba rupiah bulat: buang pemisah ribuan dan
    // teks apa pun ("Rp 310.000" → 310000) sebelum membandingkan.
    const n = Number(String(jawaban ?? '').replace(/[^\d-]/g, ''));
    const toleransi = Number(s.toleransi) || 0;
    benar = Number.isFinite(n) && String(jawaban ?? '').trim() !== '' && Math.abs(n - s.kunci) <= toleransi;
  } else if (s.tipe === 'golong') {
    benar = Array.isArray(jawaban)
      && jawaban.length === s.kunci.length
      && jawaban.every((g, i) => Number(g) === s.kunci[i]);
  }

  return { benar, penjelasan: s.penjelasan, konsep: s.konsep };
}

/* -------------------------------------------------- Soal AI (opsional) */

/**
 * Bersihkan soal yang dibuat AI sebelum disimpan atau dikirim ke siapa pun.
 * Menolak bentuk rusak dengan {status:502} — soal yang tidak sah tidak
 * boleh tampil setengah jadi.
 */
export function sanitasiLatihanAI(data) {
  const teks = (v, min, maks) => {
    const s = String(v ?? '').trim();
    return s.length >= min && s.length <= maks ? s : null;
  };

  const pertanyaan = teks(data?.pertanyaan, 10, 300);
  const penjelasan = teks(data?.penjelasan, 10, 400);
  const pilihan = data?.pilihan ?? {};
  const kunci = String(data?.kunci ?? '').trim().toUpperCase();
  const nilai = { A: teks(pilihan.A, 1, 160), B: teks(pilihan.B, 1, 160), C: teks(pilihan.C, 1, 160) };

  if (!pertanyaan || !penjelasan || !['A', 'B', 'C'].includes(kunci) || Object.values(nilai).some((v) => v === null)) {
    const err = new Error('Hasil soal AI tidak terbaca. Coba lagi sebentar.');
    err.status = 502;
    throw err;
  }

  // Konsep hanya label — kalau AI memberi kepanjangan berlebihan, buang saja.
  let konsep = teks(data.konsep, 2, 40) ?? null;
  return {
    pertanyaan,
    pilihan: nilai,
    kunci,
    penjelasan,
    konsep,
  };
}
