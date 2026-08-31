/**
 * Pembersih hasil check-up AI — kerabat dekat lib/nota.js, bedanya objek.
 *
 * Kontrak yang dijaga sama persis dengan seluruh fitur AI aplikasi ini:
 * keluaran model tidak pernah dipercaya mentah-mentah. Struktur yang salah
 * digagalkan dengan galat siap-tampil; medan yang kepanjangan dipotong;
 * tipe di luar daftar jatuh ke nilai paling aman. Tidak ada satu pun angka
 * baru yang diterima dari model — teks observasi dibatasi panjangnya dan
 * angka di kartu tetap datang dari perhitungan server.
 */
const TIPE_SAH = new Set(['ok', 'perhatian']);

const potong = (v, maks) => String(v ?? '').trim().slice(0, maks);

export function sanitasiCheckup(mentah) {
  if (!mentah || typeof mentah !== 'object' || Array.isArray(mentah)) {
    const err = new Error('AI mengembalikan format yang tidak terbaca. Coba lagi sebentar.');
    err.status = 502;
    throw err;
  }

  const item = (Array.isArray(mentah.item) ? mentah.item : [])
    .filter((i) => i && typeof i === 'object')
    .slice(0, 6)
    .map((i) => ({
      tipe: TIPE_SAH.has(i.tipe) ? i.tipe : 'perhatian',
      teks: potong(i.teks, 200),
    }))
    .filter((i) => i.teks.length > 0);

  const insight = potong(mentah.insight, 400);

  if (!item.length || !insight) {
    const err = new Error('Hasil check-up tidak lengkap. Coba lagi sebentar.');
    err.status = 502;
    throw err;
  }

  return { item, insight };
}
