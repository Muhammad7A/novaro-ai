/**
 * Terms of service & privacy notice for Novaro.
 *
 * Novaro collects bookkeeping data from business owners and sends part of it
 * to third-party AI services for processing. That is not something anyone
 * should be considered to have agreed to just by creating an account.
 *
 * Consent is stored TOGETHER WITH ITS VERSION NUMBER. If the text changes,
 * someone who agreed to the old text is not automatically assumed to agree to
 * the new one — they will be asked again. Without a version number, a consent
 * record only means "once pressed a button", not "agreed to this".
 */

/**
 * Bump every time the consent content changes meaningfully.
 *
 * Versi 2: memperbaiki pernyataan yang KELIRU di versi 1 (nama usaha & lokasi
 * dulu ikut terkirim padahal teks menyebut sebaliknya); nama usaha & lokasi
 * BERHENTI dikirim, lalu teks menyebut apa yang masih terkirim.
 *
 * Versi 3: pernyataan pemroses dulu menyebut SATU layanan; kini teks menyebut
 * semua pemroses yang mungkin (Anthropic / Vertex AI / Gemini).
 *
 * Versi 4 (keputusan pemilik 2026-09-13, RESEARCH-DEPENDENCY-REMOVAL.md):
 * Novaro V3 adalah produk komersial. Kerangka "persetujuan peserta pilot"
 * diganti ketentuan layanan & privasi biasa.
 *
 * Versi 5 (W2c 2026-09-25, ENTERPRISE-OVERHAUL-PLAN): teks diterjemahkan ke
 * bahasa Inggris untuk edisi enterprise AS. Isi substansinya tidak berubah
 * dari v4 — yang berubah bahasanya, dan itu tetap perlu disetujui ulang:
 * persetujuan yang pemiliknya tidak bisa dibaca bukan persetujuan.
 */
export const CONSENT_VERSION = 5;

export const CONSENT_TEXT = {
  versi: CONSENT_VERSION,
  judul: 'Before you start — terms of service & privacy',
  ringkas:
    'Novaro helps you record and understand your business finances. You can stop at any time, and you can download or delete your data yourself.',
  poin: [
    {
      judul: 'What we store',
      isi: 'Your business profile (business type, estimates of revenue) and every cash book entry you make. Also simple usage records: when you sign in, which modules you complete, when you open reports.',
    },
    {
      judul: 'What is sent to AI services',
      isi:
        'When you ask the AI consultant or request recommendations, part of your data is sent to the AI service this server uses — ' +
        'Claude (Anthropic) or Gemini (Google Cloud, via Vertex AI), depending on server configuration — for processing: ' +
        'business type, main products, time in business, number of employees, how you record, your goal, financial numbers computed by the system, ' +
        'your cash book summary including the notes on your largest expenses, the "biggest challenge" text if you fill it in, and your own questions.',
    },
    {
      judul: 'What is NOT sent to AI services',
      isi:
        'Your name, your business name, your location, and your access code are never sent. ' +
        'Because transaction notes are sent, avoid writing customer names in the note field — just write "customer ticket".',
    },
    {
      judul: 'This is a tool, not professional advice',
      isi: 'This app is a learning and recording tool. It is not a replacement for an accountant, tax advisor, or attorney. Loan and credit decisions belong entirely to the lender.',
    },
    {
      judul: 'Your data stays yours',
      isi: 'At any time you can download all of your data, or delete it and leave the service. Deleting means really deleting — cash book, profile, and conversation history.',
    },
    {
      judul: 'How we improve the service',
      isi: 'Usage patterns are analyzed to improve this service for its users. Analysis uses de-identified data: names, business names, locations, and conversation content are removed first. Data is never shared with third parties for any purpose.',
    },
  ],
  penutup: 'By pressing "I understand and agree", you accept the terms of service and privacy notice above.',
};

/** Apakah persetujuan pengguna masih berlaku untuk versi teks saat ini? */
export function hasConsented(user) {
  return Number(user?.consent?.versi) === CONSENT_VERSION;
}
