/**
 * Putar Ulang — susunan perjalanan buku kas untuk film 15 detik di dasbor.
 *
 * ------------------------------------------------------------------
 * KENAPA BERKAS INI ADA
 *
 * Fitur "Putar Ulang" memutar riwayat buku kas sebagai animasi: hari
 * berjalan, saldo tergambar, skor bulanan menyusul. Yang tampak sebagai
 * satu film sebenarnya adalah TIGA keputusan hitung — cara mengelompokkan
 * transaksi per hari, apa yang dihitung sebagai biaya usaha, dan kapan
 * skor sebuah bulan boleh dianggap "sudah terjadi". Keputusan yang sama
 * dibutuhkan DUA dunia sekaligus — di uji otomatis, dan di peramban yang
 * harus menganimasikan tanpa satu pun panggilan API tambahan — karena itu
 * satu berkas ini dipakai dua dunia:
 *
 *   - node/uji   : import biasa dari berkas ini;
 *   - peramban   : disajikan apa adanya sebagai <script type="module">
 *                  lewat rute /putar-ulang.js (server.js), yang menempel
 *                  API-nya ke window.NOVA_PUTAR di bawah.
 *
 * Satu rumus, satu tempat — pola yang sama dengan lib/simulasi-kur.js.
 *
 * ------------------------------------------------------------------
 * ATURAN YANG DIJAGA (sama dengan halaman lain)
 *
 *   - Laba = omzet MINUS biaya usaha (belanja bahan + operasional + lain-
 *     keluar). Prive dan cicilan tidak ikut — aturan yang sama dengan
 *     bandingkanBulan di server.js; memasukkannya justru menuduh pemilik
 *     "rugi" karena mengambil uang pribadinya.
 *   - Saldo kas mencakup SEMUA jenis transaksi, termasuk prive dan
 *     cicilan — uang yang keluar dari dompet tetap mengurangi dompet.
 *   - Skor bulanan dari garis waktu (/api/timeline) ditempel ke HARI
 *     TERAKHIR bulannya di dalam data, bukan tanggal 1: skor bulan itu
 *     baru benar-benar terjadi setelah bulannya selesai dicatat.
 *
 * Fungsi ini MURNI: tidak membaca jam, tidak memanggil jaringan, tidak
 * menyentuh penyimpanan — masuk transaksi dan titik skor, keluar susunan
 * film siap animasi.
 */

/** Biaya usaha — daftar yang sama dengan bandingkanBulan di server.js. */
const BIAYA_USAHA = ['belanja-bahan', 'operasional', 'lain-keluar'];

/**
 * Susun film dari transaksi + titik garis waktu.
 *
 * @param {Array<{tanggal: string, jenis: string, kategori: string, jumlah: number, keterangan?: string, createdAt?: string}>} transactions
 * @param {Array<{bulan: string, skor: number, status?: string}>} titik Skor bulanan dari /api/timeline
 * @returns {{hari: Array, skorTitik: Array, totalLaba: number, terbaik: (object|null)}}
 */
export function susunFilmKas(transactions, titik = []) {
  // Urutkan dari tanggal + waktu catatnya — data demo dan input manual sama-sama
  // membawa keduanya, dan urutan inilah yang membuat garis saldo bergerak maju.
  const trx = (transactions ?? [])
    .slice()
    .sort((a, b) => `${a.tanggal} ${a.createdAt ?? ''}`.localeCompare(`${b.tanggal} ${b.createdAt ?? ''}`));

  const skorBulan = new Map();
  for (const t of titik ?? []) if (t?.bulan) skorBulan.set(t.bulan, t);

  // Kelompokkan per hari, lalu hitung kumulatifnya sekali — pemutar animasi
  // hanya membaca angka jadi pada tiap bingkai, bukan menjumlah ulang.
  const hari = [];
  let saldo = 0;
  let omzet = 0;
  let biaya = 0;
  for (const t of trx) {
    let h = hari[hari.length - 1];
    if (!h || h.tanggal !== t.tanggal) {
      h = { tanggal: t.tanggal, rows: [] };
      hari.push(h);
    }
    h.rows.push(t);
    const masuk = t.jenis === 'masuk';
    saldo += masuk ? t.jumlah : -t.jumlah;
    if (masuk) omzet += t.jumlah;
    else if (BIAYA_USAHA.includes(t.kategori)) biaya += t.jumlah;
    h.saldo = saldo;
    h.omzet = omzet;
  }

  const skorTitik = [];
  for (const [bulan, s] of skorBulan) {
    let idx = -1;
    for (let i = 0; i < hari.length; i += 1) {
      if (hari[i].tanggal.startsWith(bulan)) idx = i;
    }
    if (idx >= 0) skorTitik.push({ idx, skor: s.skor, bulan });
  }
  skorTitik.sort((a, b) => a.idx - b.idx);

  // Hari dengan penjualan terbesar — satu momen yang layak diumangkan
  // di kartu akhir. Hanya hari yang BENAR-BENAR punya catatan masuk.
  let terbaik = null;
  for (const h of hari) {
    const m = h.rows.filter((r) => r.jenis === 'masuk').reduce((x, r) => x + r.jumlah, 0);
    if (m > (terbaik?.m ?? -1)) terbaik = { m, h };
  }

  return { hari, skorTitik, totalLaba: omzet - biaya, terbaik };
}

/* Peramban: serahkan API ke satu pintu global. Node melewati ini. */
if (typeof window !== 'undefined') {
  window.NOVA_PUTAR = { susunFilmKas };
}
