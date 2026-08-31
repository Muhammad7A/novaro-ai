/**
 * Kurikulum Nova Explorer — SUMBER TUNGGAL.
 *
 * Berkas ini dipakai tiga pihak sekaligus:
 *   1. Halaman Modul di peramban (lewat `GET /modul.js`)
 *   2. Prompt AI (`prompts.js` menurunkan daftar ringkasnya dari sini)
 *   3. Ekspor penelitian (jumlah modul & nama jalur)
 *
 * Dulu daftar modul ditulis dua kali — sekali di `index.html`, sekali sebagai
 * teks tetap di `prompts.js`. Selama keduanya sama persis tidak ada yang
 * kelihatan salah; begitu salah satu diubah, AI mulai menyarankan "buka modul 7"
 * yang isinya bukan modul 7 di layar peserta. Kesalahan seperti itu tidak
 * membuat apa pun gagal — ia hanya membuat nasihatnya salah alamat, diam-diam.
 * Karena itu sekarang hanya ada satu daftar, dan yang lain menurunkannya.
 *
 * ------------------------------------------------------------------
 * BENTUK KURIKULUM DAN ALASANNYA
 *
 * Jalur dasar berisi TUJUH sesi harian, bukan empat belas. Pemadatan ini
 * dilakukan pada 10 Agustus 2026 dengan dua alasan yang berdiri sendiri:
 *
 *   1. Jendela waktu. Pengumpulan penelitian jatuh 31 Agustus 2026. Intervensi
 *      14 hari menyisakan tiga hari untuk analisis dan penulisan; tujuh hari
 *      menyisakan sembilan. Yang dikorbankan panjangnya intervensi, bukan
 *      selesainya penelitian.
 *   2. Keselarasan dengan alat ukur. Tujuh sesi ini dipilih dengan mencocokkan
 *      isi tiap sesi ke 20 soal pra/pasca-tes (Lampiran 6 & 7 proposal).
 *      Susunan sekarang menutup 19 dari 20 soal. Empat sesi yang dipindah ke
 *      pustaka — modul 8, 9, 10, 11 — tidak diuji oleh satu soal pun, jadi
 *      pemotongannya tidak mengurangi daya ukur sama sekali.
 *
 * Modul 2 ("Cloud accounting") adalah materi BARU, bukan hasil penggabungan.
 * Ia ditulis karena enam soal di Lampiran 6 — no. 1, 2, 6, 10, 15, 17 —
 * menguji cloud accounting, sementara empat belas sesi versi lama sama sekali
 * tidak membahasnya: seluruhnya netral-alat, sama saja di kertas atau aplikasi.
 * Tanpa modul ini, hampir sepertiga pasca-tes menguji materi yang tidak pernah
 * diajarkan, dan skornya akan tertahan di situ bukan karena peserta gagal
 * belajar melainkan karena kurikulumnya tidak pernah mengajarkannya.
 *
 * Angka di proposal yang perlu ikut disamakan: BAB 2 (tabel novelty) masih
 * menulis "14 sesi (10 menit/hari)" selama 2 minggu, BAB 3 §3.3 menulis "8-10
 * modul bite-size" dan uji lapangan "4 minggu", sedangkan BAB 1 menyebut 15
 * menit/hari. Susunan ini cocok dengan "8-10 modul bite-size" dan dengan
 * 10-15 menit; dua angka lainnya perlu diperbarui di naskah.
 *
 * Yang TIDAK dilakukan: menumpuk semua modul menjadi satu daftar panjang.
 * Alasan penelitian ini ada justru karena pelatihan konvensional gagal akibat
 * information overload (BAB 1). Dua puluh lima kartu yang disodorkan sekaligus
 * pada hari pertama adalah bentuk baru dari kegagalan yang sama. Karena itu
 * peserta selalu melihat SATU sesi hari ini, dan pustaka baru terbuka di
 * belakangnya.
 *
 * Sesi hasil penggabungan kini 10-15 menit, bukan 5-10. Itu di atas batas
 * micro-learning yang dikutip proposal (Ulupui et al., 2021), dan disadari:
 * yang ditukar adalah sedikit kemurnian bentuk demi cakupan materi yang utuh
 * dalam tujuh hari. Modul pustaka tetap 7-10 menit.
 *
 * ------------------------------------------------------------------
 * BENTUK SATU MODUL
 *
 *   no       nomor unik & permanen. JANGAN dipakai ulang bila modul dihapus:
 *            nomor ini sudah tersimpan di `progress.done` milik peserta dan di
 *            `events.csv` sebagai `module_completed`.
 *   sesi     nomor hari (1-7) untuk jalur `dasar`; null untuk pustaka.
 *   jalur    kunci ke JALUR di bawah.
 *   menit    perkiraan waktu baca. Dipakai UI, dan menjadi pengingat saat
 *            menulis modul baru: kalau tidak muat 10 menit, pecah jadi dua.
 *   isi      materi yang bisa dibaca DI DALAM aplikasi.
 *   praktik  satu hal yang dikerjakan hari itu juga, di aplikasi ini.
 *   video    ID YouTube pendamping — OPSIONAL, lihat catatan di bawah.
 *
 * Soal `video`: hanya modul yang benar-benar punya video pendamping terverifikasi
 * yang mengisi medan ini. Sepuluh ID yang ada dibawa dari daftar modul lama dan
 * tetap menempel pada topik yang sama. Modul baru dibiarkan kosong dan tautannya
 * tidak dirender — tautan mati ke "Video unavailable" lebih buruk daripada tidak
 * ada tautan sama sekali, apalagi di alat yang dipakai penelitian. Isi tekstual
 * di `isi` dibuat cukup lengkap untuk berdiri sendiri tanpa video.
 */

export const JALUR = {
  dasar: {
    kunci: 'dasar',
    nama: 'Dasar — 7 sesi harian',
    ringkas: 'Satu sesi sehari, 10-15 menit, selama satu minggu. Urut dari sesi 1.',
    warna: 'green',
  },
  lanjutan: {
    kunci: 'lanjutan',
    nama: 'Lanjutan — angka yang lebih dalam',
    ringkas: 'Setelah buku kas jalan. Menghitung untung per menu, titik impas, dan harta usaha.',
    warna: 'blue',
  },
  tumbuh: {
    kunci: 'tumbuh',
    nama: 'Bertumbuh — menaikkan laba',
    ringkas: 'Harga, promo, jualan online, dan gaji. Dipakai kalau catatan sudah rapi.',
    warna: 'gold',
  },
  modal: {
    kunci: 'modal',
    nama: 'Modal & legalitas',
    ringkas: 'Utang yang sehat, pajak, izin usaha, dan berkas pengajuan KUR.',
    warna: 'plum',
  },
};

export const KURIKULUM = [
  /* ================================================================
     JALUR DASAR — 7 sesi harian (satu minggu)
     ================================================================ */

  {
    no: 1,
    sesi: 1,
    jalur: 'dasar',
    icon: '📒',
    judul: 'Uang ramai, laba tipis — dan kenapa dompetnya harus dipisah',
    ringkas: 'Omzet, laba, dan saldo kas adalah tiga angka berbeda. Satu dompet campur membuat ketiganya tidak bisa dibaca.',
    menit: 13,
    video: 'Gpxd-zSthGg',
    isi: [
      {
        h: 'Yang sering terjadi',
        p: 'Sehari jualan habis, laci penuh, tapi akhir bulan uangnya tidak ada. Ini bukan karena uangnya hilang — hampir selalu karena uang yang masuk itu sebagian besar bukan milik kita: ada bagian untuk belanja bahan besok, bagian untuk bayar listrik, dan bagian untuk membayar diri sendiri.',
      },
      {
        h: 'Tiga angka yang berbeda',
        li: [
          'Omzet — semua uang masuk dari penjualan. Ini yang paling terlihat.',
          'Laba — omzet dikurangi belanja bahan dan semua biaya. Ini yang benar-benar milikmu.',
          'Saldo kas — uang yang benar-benar ada sekarang. Bisa besar padahal rugi (karena baru pinjam), bisa kecil padahal untung (karena baru belanja stok).',
        ],
      },
      {
        h: 'Contoh warung soto',
        p: 'Sehari laku 60 porsi × Rp 15.000 = Rp 900.000. Terlihat besar. Tapi belanja daging, bumbu, dan beras Rp 480.000; gas, listrik, dan air Rp 60.000; sewa dibagi 30 hari Rp 50.000. Sisanya Rp 310.000. Itu labanya — bukan Rp 900.000.',
      },
      {
        h: 'Kenapa ketiganya sering tertukar: satu dompet',
        p: 'Kalau uang warung dan uang rumah ada di satu tempat, tidak ada cara untuk memisahkan ketiga angka di atas. Beli pulsa anak, bayar arisan, dan belanja bahan semuanya keluar dari laci yang sama, jadi laci yang tinggal sedikit tidak memberi tahu apa-apa. Selama dompetnya satu, seluruh modul berikutnya akan menghasilkan angka yang salah.',
      },
      {
        h: 'Cara paling sederhana memisahkan',
        li: [
          'Sediakan satu tempat khusus uang usaha — kotak, amplop, atau rekening terpisah. Tidak harus rekening bank; kaleng pun cukup, asal disiplin.',
          'Semua hasil jualan masuk ke situ. Semua belanja usaha keluar dari situ.',
          'Kalau butuh uang untuk keperluan pribadi, AMBIL dari situ — jangan langsung dari laci — dan catat pengambilannya.',
        ],
      },
      {
        h: 'Namanya "prive", bukan "gaji"',
        p: 'Uang yang kamu ambil untuk keperluan pribadi disebut prive. Ini penting: prive BUKAN biaya usaha, jadi tidak mengurangi laba. Ia mengurangi uang kas, tapi labanya tetap. Kalau prive dicatat sebagai biaya, usahamu akan terlihat rugi padahal sebenarnya untung — dan itu bisa membuatmu menutup usaha yang sebetulnya sehat.',
      },
      {
        h: 'Di aplikasi ini',
        p: 'Saat mencatat pengeluaran ada kategori "Prive / ambil pribadi". Transaksi dengan kategori itu ikut mengurangi saldo kas tapi tidak mengurangi laba bersih. Itulah kenapa di Dasbor ada dua angka berdampingan: Laba bersih dan Saldo kas.',
      },
    ],
    praktik: 'Dua hal hari ini. Pertama, tebak dulu — menurutmu berapa laba usahamu bulan lalu? Tulis angkanya di kolom perkiraan pada halaman Profil; nanti kita bandingkan di sesi 4. Kedua, tentukan di mana uang usahamu mulai disimpan terpisah, lalu catat satu pengambilan pribadi terakhir yang kamu ingat dengan kategori Prive.',
    aksi: { halaman: 'kas', label: 'Catat di Buku Kas sekarang', terverifikasi: 'transaksi' },
  },

  {
    no: 2,
    sesi: 2,
    jalur: 'dasar',
    icon: '☁️',
    judul: 'Cloud accounting: catatan yang tidak bisa hilang',
    ringkas: 'Kenapa mencatat di server lebih aman daripada di buku tulis — dan apa yang sebenarnya berubah.',
    menit: 12,
    isi: [
      {
        h: 'Masalah buku tulis, yang jarang disebut',
        p: 'Buku kas kertas bekerja baik sampai ia tidak bekerja sama sekali. Ia bisa basah, hilang, terbawa orang, atau ketinggalan di rumah saat kamu di pasar. Salinannya cuma satu. Dan untuk menjumlahkan sebulan, kamu harus menghitung ulang seluruh halaman dengan tangan — pekerjaan yang paling sering ditunda sampai akhirnya tidak pernah dikerjakan.',
      },
      {
        h: 'Apa itu cloud accounting',
        p: 'Cloud accounting adalah pencatatan keuangan yang datanya disimpan di server lewat internet, bukan di buku atau di satu HP saja. Kamu mencatat dari HP, datanya tersimpan di tempat lain, dan bisa dibuka lagi kapan saja dari perangkat mana saja dengan kode aksesmu.',
      },
      {
        h: 'Tiga hal yang benar-benar berbeda dari buku kas manual',
        li: [
          'Tersimpan sendiri. Begitu kamu tekan simpan, catatannya sudah ada di server. HP hilang tidak berarti catatan hilang.',
          'Bisa dibuka dari mana saja. Di pasar, di warung, atau di rumah — datanya sama, karena memang satu.',
          'Menghitung sendiri. Saldo, laba kotor, dan laba bersih dihitung otomatis setiap kali ada transaksi baru. Tidak ada penjumlahan manual yang bisa keliru.',
        ],
      },
      {
        h: 'Yang sering dikira, padahal keliru',
        li: [
          '"Ini cuma untuk perusahaan besar." Justru sebaliknya — warung kecil paling terbantu, karena tidak punya staf pembukuan.',
          '"Harus install aplikasi berat." Tidak. Cukup dibuka lewat peramban di HP, seperti membuka situs biasa.',
          '"Nanti dia yang mengambil keputusan." Tidak. Ia hanya menghitung dan menyajikan. Yang memutuskan menaikkan harga atau tidak tetap kamu.',
        ],
      },
      {
        h: 'Riwayat perubahan: kenapa ini yang paling berharga',
        p: 'Setiap perubahan tercatat — apa yang diubah dan kapan. Kalau ada kesalahan, ia bisa ditelusuri dan diperbaiki, bukan dihapus diam-diam. Ini bukan soal saling curiga; ini soal kepercayaan pihak luar. Catatan yang bekas dihapus tidak bisa dipercaya siapa pun, termasuk bank saat menilai pengajuan KUR. Catatan yang punya jejak perubahan justru sebaliknya.',
      },
      {
        h: 'Dua alasan orang mau memakai alat baru',
        p: 'Penelitian tentang penerimaan teknologi menyebut dua hal yang menentukan: apakah alatnya terasa BERGUNA (menghemat waktu, membuat laporan lebih akurat), dan apakah alatnya terasa MUDAH dipakai (bisa dipelajari lewat HP dalam waktu singkat, tanpa pelatihan panjang). Kalau salah satunya tidak terpenuhi, alat sebagus apa pun akan ditinggalkan setelah minggu pertama. Karena itu modul-modul berikutnya sengaja pendek.',
      },
      {
        h: 'Di aplikasi ini',
        p: 'Nova Explorer adalah cloud accounting. Kode aksesmu membuka data yang sama dari HP mana pun. Seluruh angka keuangan dihitung di server dengan rumus tetap — bukan ditaksir. Dan transaksi yang kamu hapus tetap meninggalkan jejak di riwayat, jadi tidak ada yang hilang diam-diam.',
      },
    ],
    praktik: 'Buka aplikasi ini dari HP-mu dengan kode akses, lalu catat SATU transaksi hari ini. Sesudah itu tutup peramban dan buka lagi — pastikan catatanmu masih ada di sana. Itulah bedanya dengan buku tulis.',
    aksi: { halaman: 'kas', label: 'Catat satu transaksi sekarang', terverifikasi: 'transaksi' },
  },

  {
    no: 3,
    sesi: 3,
    jalur: 'dasar',
    icon: '🧾',
    judul: 'Buku kas digital: lima kolom dan kategorinya',
    ringkas: 'Tanggal, keterangan, masuk, keluar, saldo — ditambah satu label yang membuat buku kas bisa ditanya.',
    menit: 15,
    video: 'L5YIVSNp2_U',
    isi: [
      {
        h: 'Bentuknya',
        p: 'Buku kas hanyalah daftar urut waktu: setiap baris satu kejadian uang. Kolomnya lima — tanggal, keterangan, uang masuk, uang keluar, dan saldo (sisa uang setelah baris itu). Aplikasi ini menghitung kolom saldo sendiri, jadi yang kamu isi tinggal empat.',
      },
      {
        h: 'Contoh satu hari',
        li: [
          '05/08 · Penjualan pagi · masuk Rp 420.000',
          '05/08 · Belanja pasar (daging, sayur) · keluar Rp 260.000',
          '05/08 · Beli gas 3 kg · keluar Rp 22.000',
          '05/08 · Penjualan sore · masuk Rp 310.000',
        ],
      },
      {
        h: 'Menghitung saldo akhir',
        p: 'Saldo akhir = saldo awal + seluruh uang masuk − seluruh uang keluar. Contoh: saldo pagi Rp 200.000, penjualan tunai Rp 120.000, pengeluaran hari itu Rp 70.000 → saldo akhir Rp 250.000. Aplikasi menghitungnya otomatis, tapi kamu tetap perlu paham rumusnya — karena itulah yang kamu cocokkan dengan uang fisik di laci nanti.',
      },
      {
        h: 'Aturan yang membuatnya berguna',
        li: [
          'Catat pada hari kejadiannya. Menunda satu hari masih bisa; menunda seminggu berarti mengarang.',
          'Satu kejadian satu baris. Jangan menggabung "belanja + gas" jadi satu baris, karena nanti tidak bisa dipisah lagi.',
          'Keterangan ditulis supaya kamu paham enam bulan lagi. "Belanja" kurang; "Belanja pasar: daging 2 kg" cukup.',
          'Penjualan boleh digabung per sesi (pagi/sore) — tidak perlu satu baris per pembeli.',
        ],
      },
      {
        h: 'Kategori: supaya buku kas bisa ditanya',
        p: 'Buku kas tanpa kategori bisa menjawab satu pertanyaan saja: "berapa sisa uang saya?". Dengan kategori, buku yang sama bisa menjawab "belanja bahan saya naik atau tidak bulan ini?" dan "berapa yang saya ambil untuk pribadi?". Datanya sama; yang berubah cuma pelabelannya.',
      },
      {
        h: 'Kategori pemasukan',
        li: [
          'Penjualan — hasil jualan sehari-hari. Ini yang terbesar dan paling sering.',
          'Pemasukan lain — misalnya uang sewa etalase, atau penjualan barang bekas usaha.',
          'Modal masuk / pinjaman — uang yang kamu suntikkan atau pinjam. Ini BUKAN penjualan, dan tidak boleh dihitung sebagai omzet.',
        ],
      },
      {
        h: 'Kategori pengeluaran',
        li: [
          'Belanja bahan — bahan yang habis dipakai jualan. Biasanya yang terbesar.',
          'Biaya operasional — gas, listrik, air, sewa, transport, kemasan, kebersihan.',
          'Gaji / upah — untuk karyawan, termasuk yang membantu paruh waktu.',
          'Beli alat — kompor, kulkas, gerobak, etalase. Umurnya bertahun-tahun, jadi diperlakukan berbeda (lihat modul 8).',
          'Prive — pengambilan pribadi. Bukan biaya usaha.',
          'Cicilan / bayar utang — pembayaran pokok pinjaman. Bukan biaya usaha juga.',
        ],
      },
      {
        h: 'Kalau ada potongan atau diskon',
        p: 'Catat jumlah yang BENAR-BENAR kamu bayar, bukan harga sebelum potongan. Belanja bahan Rp 200.000 dengan diskon Rp 50.000 dicatat sebagai pengeluaran Rp 150.000 — karena itulah uang yang keluar dari laci. Menuliskan Rp 200.000 membuat biaya usahamu terlihat lebih besar daripada kenyataannya, dan labamu terlihat lebih kecil.',
      },
      {
        h: 'Kalau ragu golongannya',
        p: 'Tanyakan satu hal: "kalau warung ini tutup bulan depan, pengeluaran ini masih ada tidak?". Kalau masih ada, itu urusan pribadi. Kalau ikut hilang, itu biaya usaha.',
      },
    ],
    praktik: 'Catat semua transaksi hari ini di Buku Kas — dari pembukaan sampai sekarang — lengkap dengan kategorinya. Kalau hari ini belum jualan, catat hari kemarin. Kalau ada belanja yang dapat potongan, catat jumlah yang benar-benar kamu bayar.',
    aksi: { halaman: 'kas', label: 'Buka Buku Kas', terverifikasi: 'transaksi' },
  },

  {
    no: 4,
    sesi: 4,
    jalur: 'dasar',
    icon: '🧮',
    judul: 'Laba rugi sederhana',
    ringkas: 'Laba = Penjualan − Belanja bahan − Biaya operasional. Tiga baris, dua angka yang berbeda artinya.',
    menit: 10,
    video: 'YymWqDeXCfA',
    isi: [
      {
        h: 'Rumusnya',
        p: 'Laba kotor = Penjualan − belanja bahan (harga pokok penjualan). Laba bersih = laba kotor − biaya operasional. Tidak ada rumus lain yang perlu dihafal untuk warung ukuran biasa.',
      },
      {
        h: 'Laba kotor dulu, sebelum yang lain',
        p: 'Kalau hari ini penjualan Rp 150.000 dan belanja bahannya Rp 60.000, laba kotor hari itu Rp 90.000. Angka ini menjawab satu pertanyaan saja, tapi pertanyaan yang paling menentukan: apakah harga jualku sudah di atas modal bahan? Kalau laba kotor saja sudah tipis, tidak ada penghematan operasional yang bisa menolong.',
      },
      {
        h: 'Contoh sebulan, warung nasi',
        li: [
          'Penjualan: Rp 27.000.000',
          'Belanja bahan (beras, lauk, sayur, bumbu): Rp 14.500.000',
          'Laba kotor: Rp 12.500.000',
          'Biaya operasional — sewa Rp 1.500.000, gas Rp 660.000, listrik & air Rp 400.000, upah 1 orang Rp 1.800.000, kemasan Rp 350.000, transport Rp 300.000: Rp 5.010.000',
          'Laba bersih: Rp 7.490.000',
        ],
      },
      {
        h: 'Dua angka, bukan satu',
        p: 'Laba KOTOR (Rp 12,5 juta) menjawab: "apakah harga jualku sudah di atas modal bahan?". Laba BERSIH (Rp 7,49 juta) menjawab: "apakah usaha ini benar-benar menghasilkan?". Kalau laba kotor besar tapi bersihnya tipis, masalahnya di biaya operasional — bukan di harga.',
      },
      {
        h: 'Yang tidak masuk hitungan',
        p: 'Prive dan pokok cicilan tidak dikurangkan di sini. Karena itu bisa terjadi labamu Rp 7,49 juta tapi uang yang tersisa cuma Rp 2 juta — sisanya sudah kamu ambil atau kamu pakai bayar utang. Itu bukan kesalahan hitung; itu dua pertanyaan berbeda.',
      },
    ],
    praktik: 'Buka Dasbor dan lihat angka Laba bersih bulan ini. Bandingkan dengan tebakanmu di sesi 1. Jauh berbeda? Itu temuan, bukan kesalahan — dan itulah alasan mencatat.',
    aksi: { halaman: 'dasbor', label: 'Buka Dasbor', terverifikasi: null },
  },

  {
    no: 5,
    sesi: 5,
    jalur: 'dasar',
    icon: '🍜',
    judul: 'HPP dan harga jual yang tidak rugi',
    ringkas: 'Berapa rupiah bahan yang habis untuk satu porsi, dan berapa harga jual yang menutupi semuanya.',
    menit: 15,
    video: 'okgyt5WSit4',
    isi: [
      {
        h: 'Apa itu HPP',
        p: 'HPP (harga pokok penjualan) adalah biaya bahan untuk membuat satu porsi. Bukan termasuk sewa, listrik, atau tenagamu — hanya bahannya. Angka ini yang membuatmu tahu apakah menu tertentu menguntungkan atau justru menggerogoti.',
      },
      {
        h: 'Cara menghitung — contoh es teh manis',
        li: [
          'Teh: 1 kotak Rp 8.000 untuk 40 gelas → Rp 200/gelas',
          'Gula: 1 kg Rp 16.000 untuk 50 gelas → Rp 320/gelas',
          'Es batu: 1 balok Rp 5.000 untuk 25 gelas → Rp 200/gelas',
          'Gelas plastik + sedotan: Rp 350/gelas',
          'HPP = Rp 1.070 per gelas',
        ],
      },
      {
        h: 'Contoh yang lebih rumit — ayam geprek',
        li: [
          'Ayam 1 ekor Rp 38.000 dipotong 8 → Rp 4.750',
          'Beras: 1 porsi nasi Rp 1.800',
          'Tepung, telur, minyak (dibagi rata per potong): Rp 1.900',
          'Sambal (cabai, bawang, garam): Rp 1.200',
          'Lalapan + kemasan: Rp 1.450',
          'HPP = Rp 11.100 per porsi',
        ],
      },
      {
        h: 'Minyak, gas, dan bumbu dasar',
        p: 'Ini yang paling sering lupa dihitung, dan jumlahnya tidak kecil. Cara praktis: jumlahkan belanja minyak, gas, dan bumbu sebulan, lalu bagi jumlah porsi sebulan. Tambahkan hasilnya ke setiap HPP.',
      },
      {
        h: 'Dari HPP ke harga jual',
        p: 'Harga jual = HPP × pengali. Untuk warung makan, pengali yang lazim adalah 2,5 sampai 3,5 kali. Kenapa setinggi itu? Karena harga jual bukan cuma menutup bahan — ia juga harus menutup sewa, gas, listrik, tenagamu, bahan yang terbuang, dan menyisakan laba. Ayam geprek tadi: Rp 11.100 × 2,5 = Rp 27.750, dibulatkan Rp 28.000.',
      },
      {
        h: 'Margin: berapa persen yang tersisa',
        p: 'Margin per porsi = (Harga jual − HPP) ÷ Harga jual. Ayam geprek dijual Rp 28.000 dengan HPP Rp 11.100 → (28.000 − 11.100) ÷ 28.000 = 60%. Perhatikan pembaginya adalah HARGA JUAL, bukan HPP. Membagi dengan HPP menghasilkan angka lain (markup) yang selalu terlihat lebih besar dan membuat orang merasa untung lebih banyak daripada kenyataannya.',
      },
      {
        h: 'Memeriksa pengali seluruh warung',
        p: 'Ambil laporan sebulan: kalau belanja bahan Rp 14,5 juta dan penjualan Rp 27 juta, pengali rata-ratamu 27 ÷ 14,5 = 1,86. Itu terlalu rendah untuk warung makan — laba kotormu hanya 46%, dan biaya operasional akan memakan hampir semuanya. Warung sehat biasanya di 2,5 ke atas.',
      },
      {
        h: 'Kalau laporan menunjukkan rugi berhari-hari',
        p: 'Jangan menutup warung, dan jangan mengabaikan laporannya. Periksa tiga hal berurutan: harga jual (sudah di atas 2,5 × HPP?), biaya bahan (ada pemasok lain? ada yang terbuang?), dan jumlah penjualan (turun, atau memang selalu segini?). Kerugian yang berulang hampir selalu berasal dari salah satu dari ketiganya, dan ketiganya bisa diperbaiki.',
      },
    ],
    praktik: 'Hitung HPP untuk SATU menu andalanmu — yang paling sering laku. Kalikan 2,5 dan 3, lalu bandingkan dengan harga jualmu sekarang. Kalau harga jualmu di bawah 2,5 × HPP, catat menu itu; itu yang perlu dibenahi lebih dulu.',
  },

  {
    no: 6,
    sesi: 6,
    jalur: 'dasar',
    icon: '✏️',
    judul: 'Salah catat, koreksi, dan jejak perubahan',
    ringkas: 'Kesalahan pasti terjadi. Yang menentukan mutu catatanmu adalah cara memperbaikinya.',
    menit: 12,
    video: 'mhFH_ccuSek',
    isi: [
      {
        h: 'Salah golongan: yang paling sering',
        p: 'Kesalahan tersering bukan salah hitung, melainkan salah kolom — penjualan Rp 80.000 masuk ke pengeluaran, atau sebaliknya. Yang benar: perbaiki entry-nya, pindahkan ke kolom yang tepat, dan biarkan koreksinya tercatat. Jangan menambah transaksi baru untuk "menyeimbangkan"; itu membuat dua kesalahan dari satu.',
      },
      {
        h: 'Kalau laporan bilang rugi padahal kamu yakin untung',
        p: 'Langkah pertama BUKAN menyalahkan aplikasi dan bukan menghapusnya. Periksa dulu data yang masuk: adakah penjualan yang belum tercatat, atau pengeluaran yang tercatat dua kali, atau prive yang salah digolongkan sebagai biaya? Hampir semua laporan yang terasa aneh berasal dari data yang dimasukkan, bukan dari hitungannya. Hitungan mesin jarang salah; isian manusia sering.',
      },
      {
        h: 'Transaksi tercatat dua kali',
        li: [
          'Penjualan terduplikasi → pemasukan terlihat berlebih, laba tampak LEBIH TINGGI dari sebenarnya. Ini yang paling berbahaya, karena menyenangkan dan karena itu jarang diperiksa.',
          'Pengeluaran terduplikasi → biaya terlihat berlebih, laba tampak LEBIH RENDAH dari sebenarnya.',
          'Cara menemukannya: cari dua baris dengan tanggal, jumlah, dan keterangan yang persis sama.',
        ],
      },
      {
        h: 'Kalau lupa mencatat sehari',
        li: [
          'Catat besoknya, dengan tanggal kejadian yang SEBENARNYA — bukan tanggal hari ini. Tanggal yang digeser membuat laporan bulanan meleset di dua bulan sekaligus.',
          'Kalau sudah lewat beberapa hari dan angkanya tidak ingat persis, tulis perkiraan terbaikmu dan beri keterangan "perkiraan". Perkiraan yang ditandai jauh lebih berguna daripada baris kosong.',
          'Yang tidak boleh: mengarang angka rapi supaya laporan terlihat bagus. Data karangan tidak bisa dibedakan dari data asli setelah beberapa bulan, dan akan menyesatkanmu sendiri.',
        ],
      },
      {
        h: 'Jejak perubahan',
        p: 'Di buku tulis, koreksi dilakukan dengan mencoret satu garis sehingga angka lama masih terbaca — jangan dihapus atau ditip-ex. Di aplikasi ini, transaksi yang dihapus tetap meninggalkan jejak di riwayat, jadi tidak ada yang hilang diam-diam. Keduanya melayani hal yang sama: catatan yang bisa ditelusuri jauh lebih dipercaya daripada catatan yang bersih tanpa sejarah.',
      },
      {
        h: 'Tutup buku harian: dua menit',
        p: 'Setiap selesai jualan, hitung fisik uang di laci lalu bandingkan dengan saldo di aplikasi. Kalau cocok, hari itu beres. Kalau selisih, cari sekarang selagi masih ingat — besok sudah tidak mungkin. Selisih kecil yang berulang biasanya berarti ada satu jenis transaksi yang selalu lupa dicatat.',
      },
    ],
    praktik: 'Lakukan tutup buku hari ini: hitung uang di laci, bandingkan dengan saldo di aplikasi, dan telusuri selisihnya kalau ada. Sekalian periksa apakah ada transaksi yang tercatat dua kali.',
    aksi: { halaman: 'kas', label: 'Periksa Buku Kas', terverifikasi: null },
  },

  {
    no: 7,
    sesi: 7,
    jalur: 'dasar',
    icon: '📊',
    judul: 'Laporan bulanan dan berkas untuk KUR',
    ringkas: 'Sesi terakhir: mengubah semua yang sudah dicatat menjadi laporan, lalu menjadi keputusan.',
    menit: 14,
    video: 'Xq1fYjX77ss',
    isi: [
      {
        h: 'Tiga laporan yang cukup',
        li: [
          'Arus kas — saldo awal, total masuk, total keluar, saldo akhir. Menjawab: ke mana perginya uang saya?',
          'Laba rugi — penjualan, belanja bahan, biaya operasional, laba bersih. Menjawab: usaha saya menghasilkan atau tidak?',
          'Harta & utang — apa yang dimiliki usaha (kas, stok, alat, piutang) dan apa yang dipinjam. Selisihnya modalmu sendiri. Menjawab: usaha saya bertambah kaya atau tidak?',
        ],
      },
      {
        h: 'Bacalah berurutan, jangan satu-satu',
        p: 'Satu laporan sendirian selalu menyesatkan. Laba besar + kas menipis = piutang menumpuk atau prive terlalu besar. Kas tebal + laba tipis = mungkin baru pinjam. Ketiganya bersama baru memberi gambaran yang jujur.',
      },
      {
        h: 'Skor kesehatan: apa yang diukur',
        li: [
          'Margin laba — apakah harga jualmu cukup di atas modal',
          'Kerapian catatan — berapa hari dalam sebulan yang benar-benar tercatat',
          'Pemisahan uang usaha & pribadi',
          'Beban cicilan dibanding laba',
          'Kestabilan penjualan antar bulan',
        ],
      },
      {
        h: 'Skor bukan nilai rapor',
        p: 'Skor rendah di awal itu normal dan justru berguna — ia menunjukkan di mana perbaikan paling cepat terasa. Yang perlu diperhatikan bukan angkanya hari ini, melainkan arahnya tiga bulan lagi.',
      },
      {
        h: 'Yang dilihat bank saat kamu mengajukan KUR',
        p: 'Bukan foto warung yang ramai, dan bukan cerita lisan. Yang berbicara adalah catatan transaksi harian yang rutin selama beberapa bulan, laporan laba rugi sederhana, dan arus kas yang menunjukkan uang benar-benar berputar. Itu semua sudah kamu hasilkan sejak sesi 3 — bedanya sekarang ia bisa dicetak. Catatan yang rapi selama tiga bulan lebih meyakinkan daripada omzet besar yang tidak bisa dibuktikan.',
      },
      {
        h: 'Rencana 30 hari yang berhasil',
        li: [
          'Pilih maksimal TIGA hal. Lebih dari itu tidak akan dikerjakan.',
          'Buat masing-masing terukur: bukan "lebih rajin mencatat", tapi "mencatat setiap hari sesudah tutup, minimal 25 hari bulan ini".',
          'Pilih yang paling berdampak dulu — biasanya harga menu yang marginnya tipis, atau prive yang tidak terkontrol.',
          'Tulis tanggal pemeriksaannya. Rencana tanpa tanggal periksa hanya niat.',
        ],
      },
      {
        h: 'Satu peringatan penting',
        p: 'Bulan yang catatannya bolong akan menghasilkan angka yang lebih kecil dari kenyataan, dan itu terlihat persis seperti usaha yang sedang menurun. Aplikasi ini menandai bulan yang cakupan catatannya rendah — jangan mengambil kesimpulan dari bulan bertanda itu.',
      },
      {
        h: 'Setelah sesi ini',
        p: 'Jalur dasar selesai. Pustaka modul lanjutan terbuka: tiga pengeluaran yang sering tertukar, arus kas, piutang pelanggan, stok bahan, titik impas, penyusutan alat, jualan online, sampai berkas pengajuan KUR. Buka sesuai kebutuhan — tidak perlu berurutan. Yang paling penting sudah kamu punya: kebiasaan mencatat setiap hari.',
      },
    ],
    praktik: 'Buka halaman Laporan dan baca ketiga bagiannya berurutan, lalu tulis satu kalimat kesimpulan untuk dirimu sendiri. Sesudah itu buka halaman Saran dan pilih TIGA target untuk 30 hari ke depan, lengkap dengan tanggal kapan kamu akan memeriksanya.',
    aksi: { halaman: 'laporan', label: 'Buka Laporan', terverifikasi: 'laporan' },
  },

  /* ================================================================
     JALUR LANJUTAN — empat sesi yang dulu harian, kini pustaka

     Keempatnya dipindah dari jalur dasar saat intervensi dipadatkan
     dari 14 hari menjadi 7. Dasar pemilihannya bukan selera: tidak
     satu pun dari keempat topik ini diuji oleh soal pra/pasca-tes di
     Lampiran 6 dan 7 proposal, sedangkan tujuh sesi yang bertahan
     menutup 19 dari 20 soalnya. Isinya tetap utuh dan nomornya tidak
     berubah — peserta yang selesai lebih cepat tetap bisa membukanya,
     dan modul pustaka yang dibuka justru menjadi penanda keterlibatan
     untuk analisis dosis-respons.
     ================================================================ */
  {
    no: 8,
    sesi: null,
    jalur: 'lanjutan',
    icon: '🔀',
    judul: 'Tiga pengeluaran yang paling sering tertukar',
    ringkas: 'Belanja bahan, beli alat, dan bayar utang terlihat sama di laci — tapi ketiganya berbeda.',
    menit: 8,
    isi: [
      {
        h: 'Kenapa ini satu modul sendiri',
        p: 'Kesalahan pencatatan yang paling sering di warung bukan salah hitung, melainkan salah golongan. Tiga jenis pengeluaran ini sama-sama membuat uang keluar dari laci, tapi hanya satu yang mengurangi laba. Salah menaruhnya membuat laporanmu meleset jauh — bukan sedikit.',
      },
      {
        h: '1. Belanja bahan → mengurangi laba, tapi hanya yang terpakai',
        p: 'Beras 25 kg yang dibeli hari ini akan habis dalam seminggu. Yang mengurangi laba hari ini hanya bagian yang benar-benar dimasak hari ini. Untuk warung kecil selisih ini biasanya kecil dan boleh diabaikan. Tapi kalau kamu belanja borongan sebulan sekali, angka bulanan jadi bergelombang: satu bulan terlihat rugi, bulan berikutnya untung besar. Modul 11 membahas cara merapikannya.',
      },
      {
        h: '2. Beli alat → tidak langsung mengurangi laba',
        p: 'Kulkas Rp 3.000.000 tidak membuatmu rugi Rp 3.000.000 bulan ini. Kulkasnya masih ada, masih bisa dijual, dan akan dipakai bertahun-tahun. Uangnya berpindah bentuk — dari kas menjadi barang. Yang jadi biaya adalah penyusutannya sedikit demi sedikit tiap bulan (modul 17).',
      },
      {
        h: '3. Bayar cicilan utang → sebagian besar bukan biaya',
        p: 'Cicilan terdiri dari dua bagian: pokok dan bunga. Bagian POKOK hanya mengembalikan uang yang dulu kamu terima — itu bukan biaya, cuma mengurangi utang. Yang benar-benar biaya adalah BUNGA-nya. Kalau seluruh cicilan dicatat sebagai biaya, usahamu terlihat jauh lebih rugi daripada kenyataannya.',
      },
      {
        h: 'Ringkasnya',
        li: [
          'Belanja bahan → biaya (mengurangi laba)',
          'Beli alat → harta (tidak mengurangi laba, disusutkan)',
          'Cicilan: pokok → mengurangi utang; bunga → biaya',
        ],
      },
    ],
    praktik: 'Periksa buku kasmu bulan ini. Cari pembelian alat dan pembayaran cicilan, lalu pastikan kategorinya sudah benar — bukan tercatat sebagai belanja bahan.',
    aksi: { halaman: 'kas', label: 'Periksa Buku Kas', terverifikasi: null },
  },
  {
    no: 9,
    sesi: null,
    jalur: 'lanjutan',
    icon: '💧',
    judul: 'Arus kas: untung di catatan, kering di laci',
    ringkas: 'Usaha yang untung tetap bisa mati kalau uangnya datang terlambat.',
    menit: 9,
    video: 'qOE9GNuv-_U',
    isi: [
      {
        h: 'Beda laba dan kas',
        p: 'Laba dihitung dari kapan penjualan TERJADI. Kas dihitung dari kapan uangnya BERPINDAH. Untuk warung yang semua pembelinya bayar tunai, keduanya hampir sama. Begitu ada katering yang bayar mundur, atau pelanggan yang ngebon, keduanya mulai berpisah.',
      },
      {
        h: 'Contoh yang mematikan',
        p: 'Kamu dapat pesanan katering Rp 8.000.000, dibayar 30 hari setelah acara. Bahannya harus dibeli sekarang: Rp 4.500.000. Di laporan laba rugi bulan ini kamu untung Rp 3,5 juta. Tapi di laci, uangmu berkurang Rp 4,5 juta. Kalau bulan itu juga harus bayar sewa dan gaji, kamu bisa tidak sanggup — padahal usahamu untung.',
      },
      {
        h: 'Tanda-tanda arus kas bermasalah',
        li: [
          'Sering menunda belanja sampai ada uang masuk',
          'Sering pinjam untuk menutup belanja rutin, bukan untuk menambah alat',
          'Saldo kas turun terus padahal laporan bilang untung',
          'Uang pribadi sering dipakai menalangi warung',
        ],
      },
      {
        h: 'Cara memperbaikinya',
        li: [
          'Minta uang muka untuk pesanan besar — 50% di depan sudah menolong banyak.',
          'Perpendek tempo bayar pelanggan, perpanjang tempo bayar ke pemasok.',
          'Simpan cadangan kas minimal untuk 2 minggu belanja rutin (modul 24).',
          'Jangan ambil prive besar di bulan yang banyak piutangnya.',
        ],
      },
      {
        h: 'Di aplikasi ini',
        p: 'Dasbor menampilkan Laba bersih dan Saldo kas berdampingan justru untuk ini. Kalau keduanya menjauh, arus kasmu sedang bekerja melawanmu.',
      },
    ],
    praktik: 'Lihat Dasbor: bandingkan Laba bersih dan Saldo kas bulan ini. Kalau selisihnya besar, tuliskan penyebabnya — biasanya prive, cicilan, atau piutang.',
    aksi: { halaman: 'dasbor', label: 'Buka Dasbor', terverifikasi: null },
  },
  {
    no: 10,
    sesi: null,
    jalur: 'lanjutan',
    icon: '📝',
    judul: 'Kasbon, bon, dan piutang pelanggan',
    ringkas: 'Barang sudah keluar, uang belum masuk. Ini penjualan, tapi belum kas.',
    menit: 8,
    isi: [
      {
        h: 'Kenapa perlu dicatat terpisah',
        p: 'Pelanggan langganan yang ngebon adalah hal biasa di warung, dan sering justru tanda hubungan baik. Yang berbahaya bukan bonnya, melainkan bon yang tidak tercatat: ia hilang dari ingatan, tidak pernah ditagih, dan pelan-pelan menjadi kerugian yang tidak pernah kelihatan di laporan mana pun.',
      },
      {
        h: 'Cara sederhana',
        li: [
          'Sediakan satu buku kecil khusus bon: tanggal, nama, jumlah, lunas/belum.',
          'Catat penjualannya sebagai penjualan (karena memang sudah terjadi), lalu catat pelunasannya saat uangnya benar-benar datang.',
          'Setiap akhir minggu, baca ulang daftar bon. Yang lewat 2 minggu, tagih.',
        ],
      },
      {
        h: 'Batas yang sehat',
        p: 'Aturan praktis: total bon jangan melebihi hasil penjualan 3 hari. Kalau warungmu sehari Rp 700.000, jangan biarkan total bon menembus sekitar Rp 2 juta. Di atas itu, uang usahamu sebenarnya sedang dipinjam banyak orang sekaligus.',
      },
      {
        h: 'Cara menagih tanpa merusak hubungan',
        li: [
          'Sebut angkanya, jangan menyindir. "Bu, catatan saya Rp 145.000 ya, dari tanggal 3." lebih mudah dijawab daripada "kok belum dibayar".',
          'Tawarkan cicil kalau jumlahnya besar.',
          'Kalau satu orang sudah menunggak lama, hentikan bon baru untuknya — dengan sopan, tapi hentikan.',
        ],
      },
    ],
    praktik: 'Tulis daftar semua bon yang belum lunas hari ini, lengkap dengan nama dan jumlah. Kalau totalnya lebih dari penjualan 3 hari, tandai satu orang untuk ditagih minggu ini.',
  },
  {
    no: 11,
    sesi: null,
    jalur: 'lanjutan',
    icon: '📦',
    judul: 'Stok bahan dan belanja pasar',
    ringkas: 'Stok adalah uang yang sedang tidur. Terlalu banyak rugi, terlalu sedikit kehilangan penjualan.',
    menit: 9,
    video: 'tgBvdGpXy1s',
    isi: [
      {
        h: 'Stok itu uang',
        p: 'Beras 50 kg di gudang bukan "persediaan aman" — itu Rp 650.000 yang tidak bisa dipakai untuk apa pun sampai terjual. Untuk bahan segar, ia bahkan bisa menyusut nilainya sendiri sambil menunggu.',
      },
      {
        h: 'Dua jenis bahan, dua cara',
        li: [
          'Bahan segar (sayur, daging, ikan) — beli untuk 1-2 hari. Lebih mahal per satuan, tapi jauh lebih murah daripada membuangnya.',
          'Bahan kering (beras, minyak, gula, bumbu kemasan) — boleh borongan mingguan atau bulanan kalau harganya jelas lebih murah dan tempat simpannya aman.',
        ],
      },
      {
        h: 'FIFO — yang lama dipakai duluan',
        p: 'First In First Out: bahan yang datang lebih dulu dipakai lebih dulu. Caranya sederhana — taruh belanjaan baru di BELAKANG yang lama, jangan di depan. Kedengarannya sepele, tapi inilah penyebab paling umum bahan kedaluwarsa di warung kecil.',
      },
      {
        h: 'Stock opname: hitung ulang sebulan sekali',
        p: 'Sekali sebulan, hitung sisa bahan yang ada dan taksir nilainya. Angka ini menjelaskan kenapa laba bulanan naik-turun padahal jualannya stabil: bulan yang belanjanya borongan akan terlihat rugi, bulan berikutnya terlihat untung besar. Dengan nilai stok awal dan akhir, kamu bisa menghitung bahan yang BENAR-BENAR terpakai:',
      },
      {
        h: 'Rumusnya',
        p: 'Bahan terpakai = Stok awal + Belanja bulan ini − Stok akhir. Contoh: stok awal Rp 1.200.000, belanja Rp 14.500.000, stok akhir Rp 900.000 → yang benar-benar terpakai Rp 14.800.000.',
      },
    ],
    praktik: 'Hitung sisa bahan kering di dapurmu sekarang dan taksir nilainya dalam rupiah. Tulis di catatanmu — angka ini yang jadi "stok awal" bulan depan.',
  },
  /* ================================================================
     JALUR LANJUTAN — angka yang lebih dalam
     ================================================================ */
  {
    no: 15,
    sesi: null,
    jalur: 'lanjutan',
    icon: '⚖️',
    judul: 'Harta = Utang + Modal',
    ringkas: 'Satu persamaan yang menjadi dasar semua akuntansi. Lebih sederhana dari kelihatannya.',
    menit: 8,
    isi: [
      {
        h: 'Persamaannya',
        p: 'Harta = Utang + Modal. Artinya: segala sesuatu yang dimiliki usaha pasti dibiayai oleh salah satu dari dua sumber — uang orang lain (utang) atau uang sendiri (modal). Tidak ada sumber ketiga.',
      },
      {
        h: 'Contoh warung',
        li: [
          'Harta: kas Rp 3.000.000 + stok bahan Rp 900.000 + peralatan Rp 6.500.000 + piutang Rp 600.000 = Rp 11.000.000',
          'Utang: sisa pinjaman koperasi Rp 4.000.000 + utang ke pemasok Rp 500.000 = Rp 4.500.000',
          'Modal (milikmu sendiri) = Rp 11.000.000 − Rp 4.500.000 = Rp 6.500.000',
        ],
      },
      {
        h: 'Kenapa berguna',
        p: 'Angka Modal inilah kekayaan bersih usahamu. Kalau naik dari bulan ke bulan, usahamu benar-benar bertumbuh. Kalau labanya besar tapi modalnya tidak naik, berarti labanya habis diambil sebagai prive — usahanya menghidupi keluargamu, tapi tidak membesarkan dirinya sendiri. Keduanya sah; yang penting kamu tahu mana yang sedang terjadi.',
      },
      {
        h: 'Yang mengubah modal',
        li: [
          'Naik: laba, dan uang baru yang kamu suntikkan',
          'Turun: rugi, dan prive',
          'Tidak berpengaruh: pinjam uang (harta naik, utang naik), bayar pokok utang (harta turun, utang turun)',
        ],
      },
    ],
    praktik: 'Hitung modalmu sendiri hari ini: jumlahkan semua harta usaha, kurangi semua utang. Catat angkanya dan tanggalnya — bandingkan lagi 3 bulan lagi.',
  },
  {
    no: 16,
    sesi: null,
    jalur: 'lanjutan',
    icon: '🏛️',
    judul: 'Neraca sederhana untuk warung',
    ringkas: 'Foto keadaan usaha pada satu tanggal. Salah satu berkas yang diminta bank.',
    menit: 9,
    isi: [
      {
        h: 'Bedanya dengan laba rugi',
        p: 'Laba rugi menceritakan SEBULAN ("bulan Juli untung Rp 7 juta"). Neraca memotret SATU TANGGAL ("per 31 Juli, harta segini, utang segitu"). Satu film, satu foto.',
      },
      {
        h: 'Bentuknya — sisi kiri: harta',
        li: [
          'Kas & bank — uang tunai di laci dan di rekening',
          'Piutang — bon pelanggan yang belum dibayar',
          'Persediaan — nilai bahan yang masih ada',
          'Peralatan — kompor, kulkas, etalase, gerobak (setelah dikurangi penyusutan)',
        ],
      },
      {
        h: 'Sisi kanan: utang & modal',
        li: [
          'Utang jangka pendek — utang pemasok, cicilan yang jatuh tempo tahun ini',
          'Utang jangka panjang — sisa pinjaman di atas satu tahun',
          'Modal — selisihnya; inilah bagianmu',
        ],
      },
      {
        h: 'Kedua sisi harus sama',
        p: 'Kalau tidak sama, ada yang belum tercatat — biasanya utang yang terlupa atau alat yang tidak pernah dimasukkan. Ketidakcocokan itu bukan masalah matematika; ia petunjuk letak catatan yang bolong.',
      },
      {
        h: 'Untuk pengajuan KUR',
        p: 'Bank ingin melihat neraca sederhana bersama laba rugi. Neraca menjawab pertanyaan yang tidak bisa dijawab laba rugi: kalau usaha ini berhenti hari ini, cukupkah hartanya untuk menutup utangnya.',
      },
    ],
    praktik: 'Susun neraca sederhana per akhir bulan lalu di selembar kertas. Periksa apakah kedua sisinya seimbang.',
  },
  {
    no: 17,
    sesi: null,
    jalur: 'lanjutan',
    icon: '🔧',
    judul: 'Penyusutan alat: kompor, kulkas, gerobak',
    ringkas: 'Alat tidak habis sekaligus. Biayanya dicicil selama umur pakainya.',
    menit: 8,
    isi: [
      {
        h: 'Masalah yang diselesaikan',
        p: 'Beli kulkas Rp 4.000.000 bulan ini bukan berarti bulan ini rugi Rp 4 juta. Kulkasnya akan dipakai 5 tahun. Kalau seluruh harganya dibebankan sekali, bulan pembelian terlihat hancur dan 59 bulan berikutnya terlihat terlalu bagus. Keduanya salah.',
      },
      {
        h: 'Cara menghitung — garis lurus',
        p: 'Penyusutan per bulan = Harga beli ÷ (umur pakai dalam tahun × 12). Kulkas Rp 4.000.000 dengan umur 5 tahun → Rp 4.000.000 ÷ 60 = Rp 66.700 per bulan. Itulah biaya kulkas yang sebenarnya setiap bulan.',
      },
      {
        h: 'Umur pakai yang lazim di warung',
        li: [
          'Kompor & wajan besar: 3-5 tahun',
          'Kulkas / freezer: 5 tahun',
          'Etalase, meja, kursi: 5-8 tahun',
          'Gerobak: 5 tahun',
          'Blender, rice cooker, dispenser: 2-3 tahun',
          'Ponsel untuk pesanan online: 2-3 tahun',
        ],
      },
      {
        h: 'Kenapa ini penting untuk harga jual',
        p: 'Kalau penyusutan tidak pernah dihitung, harga jualmu tidak pernah menyisihkan uang untuk mengganti alat yang rusak. Saat kulkasnya mati lima tahun lagi, tidak ada dana penggantinya — dan yang terjadi biasanya adalah berutang. Menghitung penyusutan berarti mengumpulkan biaya penggantian sedikit demi sedikit sejak sekarang.',
      },
    ],
    praktik: 'Daftar semua alat usahamu beserta harga dan tahun belinya. Hitung total penyusutan per bulan. Angka itu adalah biaya yang selama ini tidak terlihat di laporanmu.',
  },
  {
    no: 18,
    sesi: null,
    jalur: 'lanjutan',
    icon: '🧊',
    judul: 'Biaya tetap dan biaya variabel',
    ringkas: 'Ada biaya yang jalan terus walau warung tutup. Membedakannya mengubah cara mengambil keputusan.',
    menit: 7,
    isi: [
      {
        h: 'Biaya tetap — jalan terus',
        p: 'Sewa tempat, gaji karyawan tetap, langganan internet, penyusutan alat. Besarnya sama entah kamu jual 10 porsi atau 200 porsi. Kalau warung tutup seminggu, biaya ini tetap berjalan.',
      },
      {
        h: 'Biaya variabel — ikut penjualan',
        p: 'Bahan baku, kemasan, gas, kantong plastik, komisi aplikasi ojek online. Naik kalau jualan ramai, turun kalau sepi, nol kalau tidak jualan sama sekali.',
      },
      {
        h: 'Kenapa pembedaan ini penting',
        li: [
          'Biaya tetap tinggi berarti kamu WAJIB ramai. Sewa Rp 3 juta sebulan harus tertutup sebelum sepeser pun jadi laba.',
          'Saat sepi, yang bisa cepat dipotong hanya biaya variabel — dan itu artinya mengurangi produksi, bukan menghemat.',
          'Menambah biaya tetap (menyewa tempat lebih besar, menambah karyawan tetap) adalah keputusan yang sulit ditarik kembali. Menambah biaya variabel jauh lebih mudah dibatalkan.',
        ],
      },
      {
        h: 'Yang setengah-setengah',
        p: 'Listrik ada bagian tetapnya (kulkas menyala terus) dan bagian variabelnya (blender, penanak nasi ikut sibuk). Untuk warung kecil, tidak perlu dipecah serumit itu — masukkan saja ke tetap, dan cukup sadar bahwa ia sedikit bergerak.',
      },
    ],
    praktik: 'Pisahkan biaya bulan lalu menjadi dua kelompok: tetap dan variabel. Jumlahkan biaya tetapnya — angka itu yang harus kamu tutup setiap bulan sebelum untung.',
  },
  {
    no: 19,
    sesi: null,
    jalur: 'lanjutan',
    icon: '⚖️',
    judul: 'Titik impas: berapa porsi sehari supaya tidak rugi',
    ringkas: 'Angka paling menenangkan yang bisa dimiliki pemilik warung.',
    menit: 9,
    isi: [
      {
        h: 'Apa itu titik impas (BEP)',
        p: 'Jumlah penjualan yang membuat kamu tidak untung dan tidak rugi — semua biaya tertutup pas. Di bawah angka itu rugi, di atasnya untung.',
      },
      {
        h: 'Rumusnya',
        p: 'Titik impas (porsi) = Biaya tetap sebulan ÷ (Harga jual − HPP per porsi). Bagian dalam kurung disebut margin kontribusi: berapa rupiah dari setiap porsi yang tersisa untuk menutup biaya tetap.',
      },
      {
        h: 'Contoh lengkap',
        li: [
          'Biaya tetap sebulan: sewa Rp 1.500.000 + upah Rp 1.800.000 + penyusutan Rp 200.000 + internet Rp 100.000 = Rp 3.600.000',
          'Harga jual rata-rata: Rp 18.000 · HPP rata-rata: Rp 8.000',
          'Margin kontribusi: Rp 10.000 per porsi',
          'Titik impas = Rp 3.600.000 ÷ Rp 10.000 = 360 porsi sebulan',
          'Dibagi 30 hari = 12 porsi per hari. Di atas 12 porsi sehari, kamu untung.',
        ],
      },
      {
        h: 'Cara memakainya',
        li: [
          'Tempel angkanya di dapur. Setiap hari kamu tahu sudah lewat titik aman atau belum.',
          'Sebelum menambah biaya tetap, hitung ulang. Menyewa tempat Rp 1 juta lebih mahal berarti titik impasmu naik 100 porsi sebulan — sanggup?',
          'Kalau titik impasnya terasa jauh di atas penjualan hariranmu, masalahnya bukan kurang promosi. Biaya tetapmu terlalu besar untuk ukuran usahamu.',
        ],
      },
    ],
    praktik: 'Hitung titik impasmu sendiri dengan rumus di atas, lalu bagi 30. Bandingkan dengan penjualan rata-rata harianmu.',
  },
  {
    no: 20,
    sesi: null,
    jalur: 'lanjutan',
    icon: '📐',
    judul: 'Margin per menu',
    ringkas: 'Bukan menu termahal yang paling menguntungkan, dan bukan yang paling laris.',
    menit: 8,
    isi: [
      {
        h: 'Dua cara mengukur',
        li: [
          'Margin rupiah = Harga jual − HPP. Berapa rupiah yang tersisa dari satu porsi.',
          'Margin persen = Margin rupiah ÷ Harga jual × 100. Seberapa efisien harga itu.',
        ],
      },
      {
        h: 'Contoh yang mengejutkan',
        li: [
          'Ayam geprek: jual Rp 28.000, HPP Rp 11.100 → margin Rp 16.900 (60%)',
          'Es teh manis: jual Rp 5.000, HPP Rp 1.070 → margin Rp 3.930 (79%)',
          'Nasi rames: jual Rp 15.000, HPP Rp 9.500 → margin Rp 5.500 (37%)',
        ],
      },
      {
        h: 'Cara membacanya',
        p: 'Es teh punya margin PERSEN tertinggi tapi margin RUPIAH terkecil — menjual 10 gelas es teh menghasilkan Rp 39.300, sementara 3 porsi ayam geprek menghasilkan Rp 50.700. Karena itu keduanya dibutuhkan: menu utama membawa rupiah, minuman menaikkan efisiensi. Warung yang hanya menjual menu utama tanpa minuman membuang laba paling mudah yang ada.',
      },
      {
        h: 'Menu bermargin rendah',
        p: 'Nasi rames 37% patut diperiksa. Pilihannya: naikkan harga sedikit, kurangi bahan yang paling mahal di dalamnya, atau biarkan — asal ia memang menarik pembeli yang lalu memesan minuman. Menu bermargin rendah yang tidak menarik siapa-siapa sebaiknya dihentikan.',
      },
    ],
    praktik: 'Hitung margin rupiah dan persen untuk 5 menu terlarismu. Urutkan dari margin rupiah terbesar — biasanya urutannya tidak seperti dugaanmu.',
  },
  {
    no: 21,
    sesi: null,
    jalur: 'lanjutan',
    icon: '🔎',
    judul: 'Analisis menu: laris belum tentu untung',
    ringkas: 'Menggabungkan margin dengan jumlah terjual. Empat golongan, empat tindakan.',
    menit: 9,
    isi: [
      {
        h: 'Caranya',
        p: 'Ambil dua angka untuk setiap menu: margin rupiah per porsi (modul 20) dan jumlah terjual sebulan. Lalu golongkan setiap menu ke salah satu dari empat kotak.',
      },
      {
        h: 'Empat golongan',
        li: [
          'Laris + margin tinggi — BINTANG. Jaga mutunya, jangan pernah kehabisan bahannya, letakkan paling atas di daftar menu.',
          'Laris + margin rendah — KUDA BEBAN. Menarik orang datang tapi tidak menghasilkan. Naikkan harga sedikit atau turunkan HPP-nya; jangan dipromosikan besar-besaran.',
          'Tidak laris + margin tinggi — TEKA-TEKI. Sayang kalau dilepas. Coba tawarkan aktif, jadikan paket, atau perbaiki namanya di daftar menu.',
          'Tidak laris + margin rendah — BEBAN. Hentikan. Ia memakan tempat di dapur, bahan yang berisiko basi, dan perhatianmu.',
        ],
      },
      {
        h: 'Contoh keputusan nyata',
        p: 'Warung dengan 14 menu biasanya bisa memotong 3-4 menu tanpa kehilangan pembeli sama sekali. Yang didapat: belanja lebih sederhana, bahan terbuang berkurang, dapur lebih cepat, dan stok tidak menumpuk. Menyederhanakan menu hampir selalu menaikkan laba.',
      },
      {
        h: 'Sebelum menghapus menu',
        p: 'Periksa apakah ada pelanggan tetap yang datang khusus untuk menu itu. Kalau ada dan jumlahnya lumayan, ia sebenarnya "kuda beban" — naikkan harganya, jangan dihapus.',
      },
    ],
    praktik: 'Daftar semua menumu dengan margin dan jumlah terjual bulan lalu. Tandai menu golongan BEBAN — putuskan satu yang akan dihentikan bulan depan.',
  },
  {
    no: 22,
    sesi: null,
    jalur: 'lanjutan',
    icon: '🗑️',
    judul: 'Susut, sisa, dan makanan terbuang',
    ringkas: 'Kerugian yang tidak pernah muncul di buku kas, karena ia tidak pernah jadi transaksi.',
    menit: 8,
    isi: [
      {
        h: 'Kenapa tidak terlihat',
        p: 'Sayur yang layu, nasi yang basi, gorengan sisa sore — semuanya sudah tercatat sebagai belanja, tapi tidak pernah menjadi penjualan. Di buku kas ia tidak muncul sebagai kerugian; ia hanya membuat laba lebih kecil tanpa menjelaskan kenapa.',
      },
      {
        h: 'Cara mengukurnya',
        p: 'Selama satu minggu, catat setiap hari apa saja yang terbuang dan taksir nilainya. Cukup di kertas: "Rabu — 8 gorengan Rp 8.000, sayur bayam 1 ikat Rp 3.000". Akhir minggu dijumlah, lalu dikalikan 4 untuk perkiraan sebulan. Hampir semua pemilik warung terkejut dengan hasilnya.',
      },
      {
        h: 'Batas yang wajar',
        p: 'Untuk warung makan, susut 2-5% dari belanja bahan masih wajar. Di atas 10%, ada yang salah pada perencanaan produksi — dan itu setara membuang lebih dari Rp 1,4 juta sebulan pada warung dengan belanja Rp 14,5 juta.',
      },
      {
        h: 'Cara menekannya',
        li: [
          'Masak bertahap, jangan sekaligus untuk sehari penuh. Lebih repot, tapi jauh lebih murah.',
          'Catat pola: hari apa yang biasanya sepi? Kurangi produksi di hari itu.',
          'Turunkan harga menjelang tutup untuk barang yang tidak tahan semalam. Terjual murah tetap lebih baik daripada dibuang.',
          'Pakai bahan yang bisa dipakai ulang di beberapa menu, supaya sisa satu menu tidak langsung terbuang.',
          'Terapkan FIFO dengan disiplin (modul 11).',
        ],
      },
    ],
    praktik: 'Mulai catat makanan dan bahan yang terbuang hari ini, di kertas terpisah. Lakukan seminggu penuh, lalu jumlahkan nilainya.',
  },

  /* ================================================================
     JALUR BERTUMBUH — menaikkan laba
     ================================================================ */
  {
    no: 23,
    sesi: null,
    jalur: 'tumbuh',
    icon: '🧑‍🍳',
    judul: 'Gaji pemilik dan gaji karyawan',
    ringkas: 'Kalau tenagamu tidak pernah dihitung, labamu selalu terlihat lebih besar dari yang sebenarnya.',
    menit: 8,
    isi: [
      {
        h: 'Masalah yang tersembunyi',
        p: 'Banyak pemilik warung bekerja 12 jam sehari tanpa pernah memasukkan tenaganya sebagai biaya. Akibatnya laporan menunjukkan untung Rp 5 juta sebulan — padahal kalau orang lain yang dibayar untuk pekerjaan itu, upahnya saja sudah Rp 3 juta. Laba usahanya yang sebenarnya cuma Rp 2 juta.',
      },
      {
        h: 'Cara memperbaikinya',
        p: 'Tetapkan gaji untuk dirimu sendiri — angka yang wajar untuk pekerjaan yang kamu lakukan, misalnya setara upah yang akan kamu bayar bila menyewa orang. Ambil jumlah itu secara rutin setiap bulan sebagai prive dengan jumlah tetap, bukan sesukanya saat butuh.',
      },
      {
        h: 'Kenapa jumlah tetap lebih baik',
        li: [
          'Prive yang tidak menentu adalah penyebab paling umum kas warung mengering.',
          'Dengan angka tetap, kamu bisa tahu apakah usaha ini sanggup menghidupimu — atau hanya terlihat sanggup karena kamu mengambil semaunya.',
          'Sisa laba setelah gajimu adalah laba usaha yang sebenarnya. Itulah yang bisa dipakai bertumbuh.',
        ],
      },
      {
        h: 'Kalau memakai karyawan',
        li: [
          'Hitung biaya penuh, bukan hanya upah pokok: makan, THR, lembur, dan bonus ikut masuk.',
          'Ukur dengan penjualan: total upah idealnya di bawah 15-20% dari penjualan untuk warung kecil.',
          'Karyawan tetap adalah biaya tetap. Sebelum menambah, hitung ulang titik impasmu (modul 19).',
        ],
      },
    ],
    praktik: 'Tetapkan angka gaji bulanan untuk dirimu sendiri. Mulai bulan depan, ambil jumlah itu sebagai prive rutin — dan catat.',
  },
  {
    no: 24,
    sesi: null,
    jalur: 'tumbuh',
    icon: '🛟',
    judul: 'Dana darurat usaha',
    ringkas: 'Kompor rusak, anak sakit, sepi sebulan. Yang membedakan bertahan dan tutup biasanya ini.',
    menit: 7,
    isi: [
      {
        h: 'Berapa besarnya',
        p: 'Sasaran yang masuk akal untuk warung: cukup untuk menutup biaya tetap dan belanja rutin selama 1 bulan. Kalau biaya tetapmu Rp 3.600.000 dan belanja bahan sebulan Rp 14.500.000, targetnya sekitar Rp 18 juta. Terdengar besar — karena itu dikumpulkan pelan-pelan.',
      },
      {
        h: 'Cara mengumpulkannya',
        li: [
          'Sisihkan persentase tetap dari penjualan setiap hari, misalnya 3%. Rp 700.000 sehari berarti Rp 21.000 disisihkan — hampir tidak terasa, tapi jadi Rp 630.000 sebulan.',
          'Simpan di tempat yang TERPISAH dan agak sulit diambil. Rekening lain, bukan laci.',
          'Sisihkan di depan, sesudah jualan — bukan di akhir bulan dari sisa. Tidak akan pernah ada sisa.',
        ],
      },
      {
        h: 'Kapan boleh dipakai',
        li: [
          'Boleh: alat rusak dan harus diganti sekarang, sepi mendadak, sakit, harga bahan melonjak tiba-tiba.',
          'Tidak boleh: menambah menu baru, renovasi, beli alat yang belum mendesak, keperluan pribadi. Untuk itu ada tabungan terpisah.',
          'Kalau terpakai, isi kembali lebih dulu sebelum rencana lain dijalankan.',
        ],
      },
      {
        h: 'Kenapa ini paling menentukan',
        p: 'Usaha kecil jarang tutup karena tidak untung. Jauh lebih sering karena satu kejadian tak terduga yang datang saat kasnya kosong, lalu ditutup dengan pinjaman berbunga tinggi, dan bunganya memakan sisanya. Dana darurat memutus rantai itu di awal.',
      },
    ],
    praktik: 'Tentukan persentase yang akan kamu sisihkan setiap hari, dan mulai hari ini. Angka kecil yang rutin mengalahkan angka besar yang tidak pernah jadi.',
  },
  {
    no: 25,
    sesi: null,
    jalur: 'tumbuh',
    icon: '🛵',
    judul: 'Jualan di GoFood / ShopeeFood: hitung ulang labanya',
    ringkas: 'Omzet naik, laba bisa turun. Komisinya harus masuk hitungan sejak awal.',
    menit: 9,
    isi: [
      {
        h: 'Yang sering luput',
        p: 'Aplikasi pesan-antar memotong komisi dari setiap pesanan — besarannya diatur dalam perjanjian kemitraanmu, dan di Indonesia umumnya sekitar 20%. Kalau harga di aplikasi disamakan dengan harga di warung, marginmu langsung terpotong sebesar itu.',
      },
      {
        h: 'Hitungannya',
        li: [
          'Ayam geprek Rp 28.000, HPP Rp 11.100 → margin di warung Rp 16.900',
          'Di aplikasi dengan komisi 20%: yang kamu terima Rp 22.400',
          'Margin jadi Rp 22.400 − Rp 11.100 = Rp 11.300 — turun sepertiga',
          'Tambah kemasan bawa pulang Rp 1.500 → margin tinggal Rp 9.800',
        ],
      },
      {
        h: 'Tiga pilihan',
        li: [
          'Naikkan harga di aplikasi. Ini yang paling umum dan diperbolehkan; pembeli online sudah terbiasa harga aplikasi sedikit lebih tinggi.',
          'Sediakan menu khusus online dengan porsi dan kemasan yang disesuaikan.',
          'Terima margin lebih tipis dengan sadar, karena volumenya menambal — tapi hanya kalau kamu sudah menghitungnya, bukan karena tidak tahu.',
        ],
      },
      {
        h: 'Mencatatnya di buku kas',
        p: 'Catat yang BENAR-BENAR masuk ke rekeningmu sebagai penjualan, bukan harga di aplikasi. Kalau ingin lebih rapi: catat penjualan kotornya, lalu catat komisi sebagai biaya operasional terpisah. Cara kedua lebih repot tapi memperlihatkan berapa yang sebenarnya kamu bayar ke aplikasi setiap bulan — dan angka itu biasanya mengejutkan.',
      },
      {
        h: 'Periksa perjanjianmu sendiri',
        p: 'Persentase komisi, biaya layanan, dan jadwal pencairan berbeda antar aplikasi dan bisa berubah. Jangan pakai angka di modul ini sebagai patokan — buka laporan penyelesaian (settlement) milikmu sendiri dan hitung persentase sesungguhnya.',
      },
    ],
    praktik: 'Buka laporan penyelesaian aplikasi pesan-antarmu bulan lalu. Hitung: total potongan ÷ total penjualan kotor × 100. Itu persentase komisi sesungguhnya.',
  },
  {
    no: 26,
    sesi: null,
    jalur: 'tumbuh',
    icon: '📱',
    judul: 'QRIS dan uang yang masuk rekening',
    ringkas: 'Pembayaran digital memudahkan pembeli, tapi mengubah cara kas harus dicatat.',
    menit: 7,
    isi: [
      {
        h: 'Apa yang berubah',
        p: 'Dengan QRIS, uang tidak masuk laci — ia masuk rekening, kadang esok harinya. Kalau pencatatanmu masih berpatokan pada isi laci, penjualan QRIS akan hilang dari catatan dan labamu terlihat lebih kecil daripada kenyataannya.',
      },
      {
        h: 'Cara mencatat yang benar',
        li: [
          'Catat penjualan pada hari TRANSAKSINYA, bukan hari uangnya cair.',
          'Pisahkan dalam keteranganmu: "Penjualan sore (QRIS)" dan "Penjualan sore (tunai)". Ini memudahkan saat mencocokkan mutasi rekening.',
          'Saat tutup buku, cocokkan tunai dengan isi laci, dan QRIS dengan aplikasi/mutasi bank. Dua pencocokan, bukan satu.',
        ],
      },
      {
        h: 'Biaya layanan',
        p: 'QRIS untuk usaha mikro dikenai biaya layanan (MDR) per transaksi. Untuk kategori usaha mikro tarifnya paling rendah dibanding kategori lain, dan ada masa-masa tertentu di mana tarifnya ditetapkan nol oleh regulator. Karena kebijakannya bisa berubah, jangan berpatokan pada angka yang kamu dengar dari orang lain — periksa di aplikasi penyedia QRIS-mu sendiri, atau bandingkan jumlah yang masuk rekening dengan nilai transaksinya.',
      },
      {
        h: 'Keuntungan yang sering diabaikan',
        li: [
          'Mutasi rekening adalah bukti penjualan yang tidak bisa dibantah — sangat berguna saat mengajukan KUR.',
          'Uang di rekening lebih sulit terpakai untuk keperluan pribadi tanpa sadar dibanding uang di laci.',
          'Mengurangi risiko kembalian salah dan uang palsu.',
        ],
      },
    ],
    praktik: 'Cocokkan penjualan QRIS-mu minggu lalu dengan mutasi rekening. Kalau ada selisih, cari penyebabnya sekarang selagi masih ingat.',
    aksi: { halaman: 'kas', label: 'Periksa Buku Kas', terverifikasi: null },
  },
  {
    no: 27,
    sesi: null,
    jalur: 'tumbuh',
    icon: '🎁',
    judul: 'Promo dan diskon yang tidak memakan laba',
    ringkas: 'Diskon 20% tidak memotong laba 20% — biasanya jauh lebih besar.',
    menit: 8,
    isi: [
      {
        h: 'Hitungan yang mengagetkan',
        li: [
          'Ayam geprek Rp 28.000, HPP Rp 11.100 → margin Rp 16.900',
          'Diskon 20% → harga Rp 22.400, HPP tetap Rp 11.100 → margin Rp 11.300',
          'Harganya turun 20%, tapi LABANYA turun 33%',
          'Artinya kamu harus menjual 1,5 kali lebih banyak hanya untuk kembali ke laba semula',
        ],
      },
      {
        h: 'Aturan sebelum membuat promo',
        p: 'Hitung dulu berapa tambahan penjualan yang dibutuhkan supaya promo itu impas. Rumusnya: penjualan harus naik menjadi margin lama ÷ margin baru. Pada contoh di atas, 16.900 ÷ 11.300 = 1,5 kali. Kalau menurutmu promo itu tidak akan menaikkan penjualan sampai 1,5 kali, promonya merugikan.',
      },
      {
        h: 'Promo yang biasanya lebih menguntungkan',
        li: [
          'Paket menu utama + minuman dengan potongan kecil — minuman marginnya tinggi, jadi paketnya tetap sehat.',
          'Beli 10 gratis 1 lewat kartu cap — biayanya hanya 9% dan mengikat pelanggan untuk datang lagi.',
          'Diskon pada jam sepi saja — mengisi kapasitas yang tetap terpakai biayanya.',
          'Menaikkan porsi sedikit lebih terasa bagi pembeli daripada memotong harga, dan biayanya lebih kecil bagimu.',
        ],
      },
      {
        h: 'Yang paling berbahaya',
        p: 'Diskon terus-menerus mengajari pembeli menunggu diskon. Setelah beberapa bulan, harga normalmu terasa mahal bagi pelangganmu sendiri, dan menghentikan promonya menjadi sulit. Promo sebaiknya punya tanggal mulai dan tanggal selesai sejak awal.',
      },
    ],
    praktik: 'Ambil satu promo yang pernah atau sedang kamu jalankan. Hitung berapa kali lipat penjualan yang dibutuhkan supaya impas. Sudah tercapai?',
  },
  {
    no: 28,
    sesi: null,
    jalur: 'tumbuh',
    icon: '🗓️',
    judul: 'Anggaran sederhana untuk bulan depan',
    ringkas: 'Mencatat melihat ke belakang. Anggaran melihat ke depan — dan mencegah kaget.',
    menit: 8,
    isi: [
      {
        h: 'Anggaran bukan hal rumit',
        p: 'Anggaran hanyalah tebakan terdidik tentang bulan depan, dibuat dari catatan bulan-bulan lalu. Setelah tiga bulan mencatat, kamu sudah punya bahan yang cukup untuk membuatnya dengan cukup tepat.',
      },
      {
        h: 'Cara membuatnya — empat baris',
        li: [
          'Perkiraan penjualan: rata-rata 3 bulan terakhir, disesuaikan dengan yang kamu tahu (bulan puasa, libur sekolah, musim hujan).',
          'Perkiraan belanja bahan: biasanya persentase tetap dari penjualan. Kalau selama ini 53%, pakai 53%.',
          'Biaya tetap: hampir sama tiap bulan, tinggal disalin.',
          'Sisanya: perkiraan laba. Dari situ tentukan berapa untuk prive, berapa untuk dana darurat, berapa untuk bayar utang.',
        ],
      },
      {
        h: 'Yang membuatnya berguna',
        p: 'Anggaran baru bekerja kalau dibandingkan dengan kenyataan di akhir bulan. Selisih yang besar bukan berarti anggarannya salah — ia menunjukkan ada yang berubah dan pantas ditanyakan: kenapa belanja bahan naik jadi 60% padahal biasanya 53%?',
      },
      {
        h: 'Bulan-bulan yang perlu disiapkan khusus',
        li: [
          'Ramadan dan Lebaran: pola penjualan berubah drastis, dan THR karyawan jatuh tempo.',
          'Awal tahun ajaran: banyak pelanggan memotong pengeluaran makan di luar.',
          'Musim hujan: pesan-antar naik, pembeli di tempat turun.',
        ],
      },
    ],
    praktik: 'Buat anggaran empat baris untuk bulan depan berdasarkan rata-rata 3 bulan terakhir di halaman Laporan. Simpan, dan periksa lagi di akhir bulan.',
    aksi: { halaman: 'laporan', label: 'Buka Laporan', terverifikasi: 'laporan' },
  },

  /* ================================================================
     JALUR MODAL & LEGALITAS
     ================================================================ */
  {
    no: 29,
    sesi: null,
    jalur: 'modal',
    icon: '⛓️',
    judul: 'Utang yang sehat dan utang yang mencekik',
    ringkas: 'Bukan besarnya yang menentukan, tapi untuk apa dan berapa cicilannya.',
    menit: 9,
    isi: [
      {
        h: 'Pertanyaan pertama: untuk apa',
        li: [
          'Utang PRODUKTIF — dipakai membeli sesuatu yang menambah penghasilan: alat baru, tambahan stok saat pesanan naik, memperluas tempat. Ia membiayai pengembaliannya sendiri.',
          'Utang KONSUMTIF — dipakai menutup biaya rutin atau keperluan pribadi. Ia tidak menambah penghasilan apa pun, jadi cicilannya harus diambil dari laba yang sudah ada. Inilah jenis yang paling sering menutup usaha kecil.',
        ],
      },
      {
        h: 'Pertanyaan kedua: sanggup tidak',
        p: 'Aturan yang dipakai banyak bank, dan layak kamu pakai sendiri: total cicilan per bulan sebaiknya tidak melebihi 30% dari laba bersih bulanan. Laba bersih Rp 7.000.000 → cicilan maksimal sekitar Rp 2.100.000. Di atas itu, satu bulan sepi saja sudah cukup untuk membuatmu menunggak.',
      },
      {
        h: 'Membandingkan biaya pinjaman',
        li: [
          'Selalu tanyakan bunga per TAHUN, bukan per bulan. Bunga "3% saja" per bulan berarti 36% setahun.',
          'Tanyakan total yang harus dikembalikan, bukan hanya besar cicilannya. Cicilan kecil dengan tenor panjang bisa jauh lebih mahal.',
          'Tanyakan biaya lain: administrasi, provisi, asuransi, denda pelunasan dipercepat.',
          'Bandingkan minimal dua pemberi pinjaman sebelum memutuskan.',
        ],
      },
      {
        h: 'Tanda bahaya',
        li: [
          'Meminjam untuk membayar cicilan pinjaman lain',
          'Cicilan melebihi 30% laba bersih',
          'Tidak tahu persis berapa total utangmu sekarang',
          'Pinjaman harian/mingguan dari rentenir keliling — bunganya hampir selalu berlipat dan sulit dilepas',
        ],
      },
      {
        h: 'Di aplikasi ini',
        p: 'Skor kesehatan keuanganmu ikut menilai beban cicilan terhadap laba. Kalau bagian itu merah, ia sedang mengatakan hal yang sama dengan modul ini.',
      },
    ],
    praktik: 'Tulis daftar semua utang usahamu: pemberi pinjaman, sisa pokok, cicilan per bulan, dan bunga per tahun. Jumlahkan cicilannya, lalu bagi dengan laba bersih bulananmu.',
  },
  {
    no: 30,
    sesi: null,
    jalur: 'modal',
    icon: '🧾',
    judul: 'Pajak UMKM: yang perlu diketahui pemilik warung',
    ringkas: 'Pengenalan dasar supaya tidak kaget — bukan nasihat pajak.',
    menit: 8,
    isi: [
      {
        h: 'Baca ini dulu',
        p: 'Modul ini hanya pengenalan supaya kamu tahu harus bertanya apa. Aturan pajak berubah dari waktu ke waktu dan berbeda menurut keadaan tiap usaha. Untuk keputusan yang menyangkut uangmu, tanyakan ke Kantor Pelayanan Pajak (KPP) setempat, layanan Kring Pajak, atau konsultan pajak. Aplikasi ini bukan penasihat pajak.',
      },
      {
        h: 'Skema yang biasanya berlaku untuk UMKM',
        p: 'Usaha dengan peredaran bruto (omzet) sampai batas tertentu dalam setahun dapat memakai skema PPh Final dengan tarif rendah yang dihitung dari OMZET, bukan dari laba. Perhitungannya karena itu jauh lebih sederhana daripada pajak badan biasa: tidak perlu menghitung biaya, cukup omzetnya.',
      },
      {
        h: 'Ada batas omzet yang tidak dikenai pajak',
        p: 'Untuk wajib pajak orang pribadi yang memakai skema ini, ada bagian omzet setahun yang tidak dikenai PPh Final. Banyak warung mikro berada di bawah batas itu dan karenanya tidak membayar PPh Final sama sekali — tetapi tetap perlu terdaftar dan melaporkan. Besaran batas dan tarifnya sebaiknya kamu pastikan langsung ke KPP karena angkanya diatur peraturan yang bisa berubah.',
      },
      {
        h: 'Kenapa pencatatan tetap penting walaupun mungkin tidak membayar',
        li: [
          'Untuk membuktikan bahwa omzetmu memang di bawah batas, kamu perlu catatan.',
          'Buku kas yang rapi adalah dasar pelaporan yang benar, dan melindungimu kalau ada pemeriksaan.',
          'Catatan yang sama dipakai untuk mengajukan KUR — satu pekerjaan, dua manfaat.',
        ],
      },
      {
        h: 'Langkah praktis',
        li: [
          'Punya NPWP. Untuk usaha perorangan, NPWP pribadimu biasanya sudah cukup.',
          'Ketahui omzet setahunmu — buku kas di aplikasi ini sudah menjumlahkannya.',
          'Tanyakan ke KPP terdekat skema mana yang berlaku untukmu. Layanan konsultasinya gratis.',
          'Jangan menunggu sampai ada surat. Bertanya lebih awal jauh lebih murah daripada memperbaiki belakangan.',
        ],
      },
    ],
    praktik: 'Lihat total penjualan 12 bulan terakhir di halaman Laporan. Catat angkanya — itu yang akan ditanyakan pertama kali saat kamu berkonsultasi ke KPP.',
    aksi: { halaman: 'laporan', label: 'Buka Laporan', terverifikasi: 'laporan' },
  },
  {
    no: 31,
    sesi: null,
    jalur: 'modal',
    icon: '📜',
    judul: 'Legalitas usaha: NIB, halal, dan izin edar',
    ringkas: 'Tiga berkas yang membuka pintu — pemasok besar, aplikasi, bantuan, dan KUR.',
    menit: 9,
    isi: [
      {
        h: 'NIB — Nomor Induk Berusaha',
        p: 'Identitas resmi usahamu, diurus lewat sistem OSS (oss.go.id) secara daring dan tanpa biaya untuk usaha mikro. Prosesnya biasanya cepat kalau data kependudukanmu sudah benar. NIB sering menjadi syarat pertama untuk KUR, bantuan pemerintah, dan pendaftaran sebagai pemasok.',
      },
      {
        h: 'Sertifikat halal',
        p: 'Untuk usaha makanan dan minuman, sertifikasi halal diwajibkan oleh peraturan, dengan jalur khusus bagi usaha mikro dan kecil yang biayanya ditanggung pemerintah melalui program self-declare. Pengurusannya lewat BPJPH. Jadwal kewajiban dan kuota program bisa berubah, jadi tanyakan ke dinas koperasi/UMKM setempat untuk keadaan terbaru.',
      },
      {
        h: 'PIRT / izin edar',
        p: 'Dibutuhkan kalau kamu menjual makanan KEMASAN yang tahan lebih dari seminggu — misalnya keripik, sambal botolan, atau bumbu kemasan. Diurus melalui OSS dan dinas kesehatan setempat, biasanya disertai penyuluhan keamanan pangan. Makanan matang yang langsung dimakan di tempat umumnya tidak memerlukan ini.',
      },
      {
        h: 'Kenapa mengurusnya lebih awal',
        li: [
          'Aplikasi pesan-antar, marketplace, dan pemasok besar sering mensyaratkannya.',
          'Bank meminta NIB untuk pengajuan KUR.',
          'Program bantuan dan pelatihan pemerintah hampir selalu mensyaratkan usaha terdaftar.',
          'Kemasan dengan nomor izin dipercaya lebih tinggi oleh pembeli, dan bisa dijual lebih mahal.',
        ],
      },
      {
        h: 'Bantuan pengurusan',
        p: 'Dinas Koperasi dan UMKM di kotamu biasanya membuka pendampingan gratis untuk pengurusan NIB dan halal, termasuk untuk yang tidak terbiasa mengurus sendiri secara daring. Tanyakan ke kelurahan atau kecamatan setempat.',
      },
    ],
    praktik: 'Periksa berkas mana yang sudah kamu punya: NIB, halal, PIRT. Untuk yang belum, cari tahu satu langkah pertamanya minggu ini.',
  },
  {
    no: 32,
    sesi: null,
    jalur: 'modal',
    icon: '🏦',
    judul: 'Persiapan pengajuan KUR',
    ringkas: 'Buku kas rapi 3-6 bulan adalah berkas terkuat yang bisa dibawa pemilik warung.',
    menit: 10,
    video: 'fSSKjiADor0',
    isi: [
      {
        h: 'Apa yang dinilai bank',
        li: [
          'Usahamu benar-benar berjalan dan sudah berumur cukup — umumnya minimal 6 bulan.',
          'Penghasilannya cukup untuk membayar cicilan tanpa mencekik.',
          'Kamu bisa menunjukkan angkanya, bukan hanya menceritakannya.',
          'Riwayat pinjamanmu bersih (SLIK OJK). Tunggakan lama yang belum diselesaikan adalah penghambat paling sering.',
        ],
      },
      {
        h: 'Berkas yang biasanya diminta',
        li: [
          'KTP dan Kartu Keluarga',
          'NIB atau surat keterangan usaha dari kelurahan',
          'NPWP (untuk jumlah pinjaman tertentu ke atas)',
          'Catatan keuangan usaha — inilah bagian yang aplikasi ini siapkan untukmu',
          'Foto tempat usaha',
          'Rekening bank atas nama sendiri, kalau ada',
        ],
      },
      {
        h: 'Kenapa buku kas menentukan',
        p: 'Petugas bank setiap hari mendengar pemilik usaha menyebut omzet dari ingatan. Yang membedakan pengajuanmu adalah lembar cetakan berisi penjualan, biaya, dan laba per bulan selama 6 bulan berturut-turut, yang angkanya konsisten. Itu mengubah percakapan dari "menurut Bapak berapa" menjadi "ini datanya".',
      },
      {
        h: 'Yang perlu disiapkan sebelum datang',
        li: [
          'Minimal 3 bulan catatan yang rapat — 6 bulan jauh lebih baik.',
          'Tahu angkamu sendiri di luar kepala: omzet rata-rata, laba rata-rata, cicilan yang sudah berjalan.',
          'Alasan pinjaman yang jelas dan bisa dihitung. "Untuk menambah dua meja dan satu kulkas supaya bisa melayani 20 pembeli lagi" jauh lebih kuat daripada "untuk mengembangkan usaha".',
          'Perkiraan cicilan yang sanggup kamu bayar — pakai batas 30% dari laba bersih (modul 29).',
        ],
      },
      {
        h: 'Yang perlu ditanyakan ke bank',
        p: 'Plafon, jangka waktu, suku bunga per tahun, biaya administrasi, dan apakah ada agunan yang diminta. Ketentuan KUR ditetapkan pemerintah dan diperbarui setiap tahun, jadi tanyakan langsung ke bank penyalur untuk angka yang berlaku sekarang — jangan berpatokan pada informasi tahun lalu.',
      },
      {
        h: 'Yang tidak dijanjikan siapa pun',
        p: 'Catatan rapi memperbesar peluangmu dan mempercepat prosesnya, tapi keputusan tetap ada di bank. Kalau ditolak, tanyakan alasannya — hampir selalu ada satu hal spesifik yang bisa diperbaiki lalu diajukan lagi.',
      },
    ],
    praktik: 'Buka halaman Laporan, pilih rentang bulan terpanjang yang catatannya rapat, dan cetak sebagai PDF. Simpan — itu berkas pertamamu.',
    aksi: { halaman: 'laporan', label: 'Buka Laporan & cetak', terverifikasi: 'laporan' },
  },
];

/* ------------------------------------------------------------------ Turunan */

/** Modul jalur dasar, urut sesi 1-14. Inilah intervensi harian penelitian. */
export const SESI_HARIAN = KURIKULUM.filter((m) => m.sesi != null).sort((a, b) => a.sesi - b.sesi);

/** Nomor modul terkecil & terbesar — dipakai memvalidasi `modulTerkait` dan progres. */
export const NOMOR_MODUL = KURIKULUM.map((m) => m.no);
export const MODUL_MIN = Math.min(...NOMOR_MODUL);
export const MODUL_MAKS = Math.max(...NOMOR_MODUL);

/** @returns {boolean} apakah `no` benar-benar nomor modul yang ada. */
export function nomorModulSah(no) {
  const n = Number(no);
  return Number.isInteger(n) && NOMOR_MODUL.includes(n);
}

/** @returns {object|null} satu modul menurut nomornya. */
export function cariModul(no) {
  return KURIKULUM.find((m) => m.no === Number(no)) ?? null;
}

/**
 * Ringkasan kemajuan belajar untuk prompt AI.
 *
 * Tanpa ini, AI tidak tahu peserta sedang di hari keberapa. Akibatnya dua hal
 * yang sama-sama merusak intervensinya: ia bisa mengarahkan peserta hari ketiga
 * ke modul titik impas, dan ia tidak bisa mengaitkan jawabannya dengan materi
 * yang sedang dipelajari hari itu.
 *
 * Yang kedua justru inti rancangan penelitian ini. Micro-learning saja sudah
 * pernah diteliti; AI penjawab pertanyaan saja apalagi. Yang belum adalah
 * keduanya menyatu — sesi hari ini dijelaskan memakai angka usaha peserta
 * sendiri. Itu tidak bisa terjadi kalau modelnya buta terhadap sesi mana yang
 * sedang berjalan.
 *
 * Harganya ~40 token per pertanyaan.
 */
export function ringkasKemajuan(done = {}) {
  const sudah = (m) => Boolean(done?.[m.no]);
  const sesiSelesai = SESI_HARIAN.filter(sudah);
  const berikut = SESI_HARIAN.find((m) => !sudah(m)) ?? null;
  const pustakaSelesai = KURIKULUM.filter((m) => m.sesi == null && sudah(m));

  const baris = [`- Sesi harian: ${sesiSelesai.length} dari ${SESI_HARIAN.length} selesai.`];

  if (berikut) {
    baris.push(`- Sesi yang sedang dijalani sekarang: sesi ${berikut.sesi} — "${berikut.judul}" (modul ${berikut.no}).`);
  } else {
    baris.push('- Seluruh sesi harian sudah selesai; peserta kini bebas membuka pustaka lanjutan.');
  }

  if (pustakaSelesai.length) {
    baris.push(`- Modul pustaka yang sudah dibaca: ${pustakaSelesai.map((m) => m.no).join(', ')}.`);
  }

  return `KEMAJUAN BELAJAR PESERTA\n${baris.join('\n')}`;
}

/**
 * Materi lengkap satu modul, untuk disisipkan saat peserta bertanya DARI DALAM
 * modul itu.
 *
 * Hanya dikirim untuk pertanyaan yang memang berasal dari halaman modul, bukan
 * pada tiap percakapan: satu modul berharga ~700 token, dan mengirim semuanya
 * setiap kali akan menghabiskan anggaran harian peserta dalam dua pertanyaan.
 *
 * Gunanya bukan sekadar menghemat baca. Tanpa materinya, model menjawab dari
 * pengetahuannya sendiri, dan penjelasannya bisa berbeda — bahkan bertentangan
 * — dengan yang baru saja dibaca peserta di layar yang sama. Untuk penelitian
 * pendidikan, intervensi yang isinya tidak konsisten adalah intervensi yang
 * tidak bisa diukur.
 */
export function materiModul(no) {
  const m = cariModul(no);
  if (!m) return '';

  const bagian = (m.isi ?? [])
    .map((s) => {
      const badan = s.p ? s.p : (s.li ?? []).map((x) => `- ${x}`).join('\n');
      return `${s.h}\n${badan}`;
    })
    .join('\n\n');

  const label = m.sesi != null ? `Modul ${m.no} (sesi harian ${m.sesi})` : `Modul ${m.no}`;

  return `MATERI MODUL YANG SEDANG DIBUKA PESERTA
${label}: ${m.judul}
${m.ringkas}

${bagian}

Praktik yang diminta modul ini: ${m.praktik}`;
}

/**
 * Daftar modul untuk prompt AI — nomor + judul saja, dikelompokkan per jalur.
 *
 * Bentuknya sengaja sekurus ini. Daftar ini duduk di blok system prompt dan ikut
 * terkirim pada SETIAP pertanyaan, jadi setiap kata di sini dibayar berulang
 * kali dan ikut memakan anggaran token harian peserta.
 *
 * Yang diukur sebelum memilih bentuk ini:
 *
 *   judul + ringkasan tiap modul   3.927 char  ~1.007 token
 *   judul saja, dikelompokkan      1.347 char  ~  345 token
 *
 * Selisihnya ~660 token pada tiap pertanyaan — hampir seperlima dari perkiraan
 * satu percakapan. Yang dibeli dengan biaya itu hanyalah kalimat ringkasan yang
 * sudah tersirat dari judulnya sendiri; model tidak perlu tahu ISI modul untuk
 * bisa menyebut nomor yang tepat, ia hanya perlu tahu modul apa saja yang ada.
 *
 * Pengelompokan per jalur ikut disertakan karena harganya hampir nol (28 token)
 * dan menjawab satu hal yang tidak bisa disimpulkan dari judul: mana yang jadi
 * sesi harian peserta sekarang, dan mana yang pustaka untuk nanti. Tanpa itu,
 * model bisa mengarahkan peserta hari ketiga ke modul titik impas.
 */
export function modulRingkasUntukAI() {
  return Object.keys(JALUR)
    .map((kunci) => {
      const daftar = KURIKULUM.filter((m) => m.jalur === kunci);
      if (!daftar.length) return '';
      const baris = daftar.map((m) => `${m.no}. ${m.judul}`).join('\n');
      return `${JALUR[kunci].nama}:\n${baris}`;
    })
    .filter(Boolean)
    .join('\n\n');
}
