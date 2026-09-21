/**
 * Ketentuan layanan & privasi Novaro.
 *
 * Novaro mengumpulkan pembukuan keuangan dari pemilik usaha dan mengirim
 * sebagiannya ke layanan AI pihak ketiga untuk diproses. Itu bukan sesuatu
 * yang boleh dianggap disetujui hanya karena seseorang membuat akun.
 *
 * Persetujuan disimpan BERSAMA NOMOR VERSINYA. Kalau teksnya berubah, orang
 * yang menyetujui teks lama tidak otomatis dianggap menyetujui yang baru —
 * dia akan ditanya lagi. Tanpa nomor versi, catatan persetujuan hanya berarti
 * "pernah menekan tombol", bukan "menyetujui hal yang ini".
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
 * benar-benar terkirim.
 *
 * Versi 3 (keputusan pemilik, tercatat di SESSION-D5-CONSENT-DECISION.md):
 * pernyataan pemroses dulu menyebut SATU layanan, "layanan Claude (Anthropic)",
 * padahal NOVA_AI_BACKEND memilih salah satu dari tiga jalur — anthropic
 * (Anthropic), vertex, dan gemini (keduanya Vertex AI, Google Cloud). Kini
 * teks menyebut semua pemroses yang mungkin.
 *
 * Versi 4 (keputusan pemilik 2026-09-13, RESEARCH-DEPENDENCY-REMOVAL.md):
 * Novaro V3 adalah produk komersial, bukan program uji coba. Kerangka
 * "persetujuan peserta pilot" diganti ketentuan layanan & privasi biasa:
 * klaim "uji coba" dan klausul pemakaian data untuk penelitian dihapus; data
 * dipakai untuk menyediakan dan meningkatkan layanan bagi penggunanya sendiri.
 * Mekanisme versi, hak unduh, dan hak hapus tidak berubah.
 */
export const CONSENT_VERSION = 4;

export const CONSENT_TEXT = {
  versi: CONSENT_VERSION,
  judul: 'Sebelum mulai — ketentuan layanan & privasi',
  ringkas:
    'Novaro membantu kamu mencatat dan memahami keuangan usahamu. Kamu bebas berhenti kapan saja, dan datamu bisa kamu unduh atau hapus sendiri.',
  poin: [
    {
      judul: 'Apa yang kami simpan',
      isi: 'Profil usahamu (jenis usaha, lokasi, perkiraan omzet) dan seluruh catatan buku kas yang kamu isi. Juga catatan sederhana tentang pemakaian aplikasi: kapan kamu masuk, modul mana yang selesai, kapan laporan dibuka.',
    },
    {
      judul: 'Apa yang dikirim ke layanan AI',
      isi:
        'Saat kamu bertanya ke Konsultan AI atau meminta rekomendasi, sebagian datamu dikirim ke layanan AI yang dipakai server ini — ' +
        'Claude (Anthropic) atau Gemini (Google Cloud, lewat Vertex AI), sesuai pengaturan server — untuk diproses: ' +
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
      judul: 'Ini alat bantu, bukan nasihat profesional',
      isi: 'Aplikasi ini alat bantu belajar dan pencatatan. Ia bukan pengganti akuntan, konsultan pajak, atau penasihat hukum. Keputusan pemberian KUR sepenuhnya ada di bank.',
    },
    {
      judul: 'Datamu tetap milikmu',
      isi: 'Kapan saja kamu bisa mengunduh seluruh datamu, atau menghapusnya sekaligus berhenti dari layanan. Menghapus berarti benar-benar dihapus — buku kas, profil, dan riwayat percakapan.',
    },
    {
      judul: 'Bagaimana kami meningkatkan layanan',
      isi: 'Pola pemakaian aplikasi dianalisis untuk memperbaiki layanan ini bagi penggunanya. Analisis memakai data tanpa nama: nama, nama usaha, lokasi, dan isi percakapan dihapus lebih dulu. Data tidak dibagikan ke pihak lain untuk keperluan apa pun.',
    },
  ],
  penutup: 'Dengan menekan "Saya mengerti dan setuju", kamu menyetujui ketentuan layanan dan keterangan privasi di atas.',
};

/** Apakah persetujuan pengguna masih berlaku untuk versi teks saat ini? */
export function hasConsented(user) {
  return Number(user?.consent?.versi) === CONSENT_VERSION;
}
