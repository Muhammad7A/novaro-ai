/**
 * Batas topik regulated advice — GAGAL-TUTUP.
 *
 * ------------------------------------------------------------------
 * ASAL POLA INI (W1-0, ENTERPRISE-OVERHAUL-PLAN)
 *
 * Dipindahkan dari Groundwork (apps/ai-engine/ai_engine/universe/tables.py,
 * PROHIBITED_STEMS): daftar kata kunci wilayah terlarang yang diperiksa
 * SEBELUM model dipanggil — bukan sesudahnya. Mengapa sebelum: (1) menjawab
 * lalu menambahkan disclaimer adalah gagal-terbuka — jawabannya sudah
 * terkirim; (2) panggilan yang ditolak di muka tidak membakar anggaran token
 * pengguna untuk sesuatu yang memang tidak boleh dijawab aplikasi ini.
 *
 * Wilayah yang DITOLAK DI MUKA untuk aplikasi keuangan AS:
 *   - jaminan hasil (returns/loan approval yang "pasti")
 *   - bantuan menghindar pajak / menipu pemeriksa
 *   - nasihat hukum representasional (menuntut, imigrasi, kontrak sengketa)
 *   - rekomendasi investasi spesifik (saham/crypto tertentu)
 *
 * Daftar ini SENGAJA pendek dan berstem pendek: ia bukan sensor isi, ia
 * pagar wilayah. Salah-tolak satu pertanyaan wajar lebih murah daripada
 * lolos satu janji hasil yang bisa dicatat user sebagai "nasihat".
 */

/** Stem yang kecocokannya menolak pertanyaan sebelum diproses. lowercase. */
export const PROHIBITED_STEMS = [
  'guaranteed return',
  'guarantee a return',
  'risk-free investment',
  'cannot lose',
  'can\'t lose money',
  'guaranteed approval',
  'loan is guaranteed',
  'will definitely be approved',
  'avoid paying taxes',
  'dont report income',
  'don\'t report income',
  'hide income from',
  'hide income from the irs',
  'tax evasion',
  'cheat the irs',
  'trick the auditor',
  'lie to the irs',
  'legal advice for my case',
  'represent me in court',
  'sue them for me',
  'should i sue',
  'which stock should i buy',
  'which crypto should i buy',
  'crypto tip',
  'pump and dump',
];

/**
 * Memeriksa satu pesan. Mengembalikan alasan penolakan (string) atau null.
 *
 * Gagal-tutup: kecocokan pada SALAH SATU stem cukup untuk menolak — dan
 * pemeriksaannya lower-case + trim supaya variasi kapital tidak lolos.
 * Pertanyaan sah tidak pernah menyentuh stem-stem ini dalam bentuk apa pun.
 */
export function tolakTopik(message) {
  const teks = ' ' + String(message ?? '').toLowerCase().replace(/\s+/g, ' ') + ' ';
  const kena = PROHIBITED_STEMS.find((stem) => teks.includes(stem));
  if (!kena) return null;
  return {
    stem: kena,
    pesan:
      'I can\'t help with that. Novaro is a bookkeeping and learning tool — it does not promise investment results, help with tax avoidance, or give legal representation. For those, please consult a licensed professional (CPA, tax advisor, or attorney).',
  };
}
