/**
 * Persetujuan peserta pilot.
 *
 * Program ini mengumpulkan pembukuan keuangan dari pemilik usaha kecil dan
 * mengirim sebagiannya ke layanan AI pihak ketiga. Itu bukan sesuatu yang boleh
 * dianggap disetujui hanya karena seseorang diberi kode akses.
 *
 * Persetujuan disimpan BERSAMA NOMOR VERSINYA. Kalau teksnya berubah, orang yang
 * menyetujui teks lama tidak otomatis dianggap menyetujui yang baru — dia akan
 * ditanya lagi. Tanpa nomor versi, catatan persetujuan hanya berarti "pernah
 * menekan tombol", bukan "menyetujui hal yang ini".
 */

/**
 * Naikkan setiap kali isi persetujuan berubah secara berarti.
 *
 * Versi 2: memperbaiki pernyataan yang KELIRU di versi 1. Versi itu berbunyi
 * "Namamu dan kode aksesmu TIDAK ikut dikirim", sementara yang benar-benar
 * terkirim ke Anthropic mencakup nama usaha, lokasi, teks bebas "tantangan",
 * dan keterangan transaksi. Untuk warung mikro, nama usaha praktis adalah nama
 * pemiliknya, dan bersama lokasi ia menunjuk satu orang.
 *
 * Dua hal diperbaiki bersamaan, dan urutannya penting: nama usaha & lokasi
 * BERHENTI dikirim (lihat prompts.js), lalu teks ini menyebutkan apa yang masih
 * benar-benar terkirim. Memperbaiki teksnya saja berarti hanya membuat
 * pengakuan yang lebih rapi atas hal yang seharusnya tidak dilakukan.
 */
export const CONSENT_VERSION = 2;

export const CONSENT_TEXT = {
  versi: CONSENT_VERSION,
  judul: 'Sebelum mulai — apa yang perlu kamu tahu',
  ringkas:
    'Novaro adalah program pendampingan yang masih dalam tahap uji coba. Kamu bebas berhenti kapan saja, dan datamu bisa kamu unduh atau hapus sendiri.',
  poin: [
    {
      judul: 'Apa yang kami simpan',
      isi: 'Profil usahamu (jenis usaha, lokasi, perkiraan omzet) dan seluruh catatan buku kas yang kamu isi. Juga catatan sederhana tentang pemakaian aplikasi: kapan kamu masuk, modul mana yang selesai, kapan laporan dibuka.',
    },
    {
      judul: 'Apa yang dikirim ke layanan AI',
      isi:
        'Saat kamu bertanya ke Konsultan AI atau meminta rekomendasi, sebagian datamu dikirim ke layanan Claude (Anthropic) untuk diproses: ' +
        'jenis usaha, produk utama, lama usaha, jumlah karyawan, cara mencatat, tujuanmu, angka keuangan hasil hitungan sistem, ' +
        'ringkasan buku kas termasuk keterangan pengeluaran terbesarmu, teks "tantangan terbesar" bila kamu mengisinya, dan pertanyaanmu sendiri.',
    },
    {
      judul: 'Yang TIDAK dikirim ke layanan AI',
      isi:
        'Nama kamu, nama usahamu, lokasi usahamu, dan kode aksesmu tidak pernah ikut dikirim. ' +
        'Karena keterangan transaksi ikut terkirim, sebaiknya jangan menulis nama pelanggan di kolom keterangan — tulis saja "bon pelanggan".',
    },
    {
      judul: 'Ini uji coba, bukan nasihat profesional',
      isi: 'Aplikasi ini alat bantu belajar. Ia bukan pengganti akuntan, konsultan pajak, atau penasihat hukum. Keputusan pemberian KUR sepenuhnya ada di bank.',
    },
    {
      judul: 'Datamu tetap milikmu',
      isi: 'Kapan saja kamu bisa mengunduh seluruh datamu, atau menghapusnya sekaligus berhenti dari program. Menghapus berarti benar-benar dihapus — buku kas, profil, dan riwayat percakapan.',
    },
    {
      judul: 'Kalau hasilnya dipelajari',
      isi: 'Pengelola program dapat mempelajari data peserta untuk menilai apakah pendampingan ini membantu. Untuk keperluan itu, data dipakai dalam bentuk tanpa nama: nama, nama usaha, lokasi, dan isi percakapan dihapus lebih dulu.',
    },
  ],
  penutup: 'Dengan menekan "Saya mengerti dan setuju", kamu bersedia ikut program uji coba ini dengan ketentuan di atas.',
};

/** Apakah persetujuan pengguna masih berlaku untuk versi teks saat ini? */
export function hasConsented(user) {
  return Number(user?.consent?.versi) === CONSENT_VERSION;
}
