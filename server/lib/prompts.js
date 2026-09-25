/**
 * Prompt untuk Claude Sonnet 5 — edisi enterprise US (W2c 2026-09-25).
 *
 * Bagian yang stabil (peran + daftar modul) sengaja ditaruh di blok pertama agar
 * bisa di-cache (prompt caching). Profil usaha yang berubah-ubah ada di blok kedua.
 */
import { isMonthComplete, kategoriLabel, monthsWithData, summarizeRange } from './cashbook.js';
import { metricsToText, formatDolar } from './metrics.js';
import { KURIKULUM, MODUL_MAKS, MODUL_MIN, modulRingkasUntukAI } from './kurikulum.js';

/*
 * Daftar modul DITURUNKAN dari kurikulum, tidak ditulis ulang di sini.
 *
 * Sebelumnya daftar ini teks tetap, kembaran dari daftar di halaman Modul.
 * Selama keduanya kebetulan sama, tidak ada yang terlihat salah — begitu salah
 * satu berubah, AI mulai menyarankan "open module 7" yang isinya bukan modul 7
 * di layar pengguna. Kesalahan macam itu tidak membuat apa pun gagal; ia cuma
 * membuat nasihatnya salah alamat, tanpa satu pun tanda.
 */
export const MODUL_RINGKAS = modulRingkasUntukAI();

const PERAN = `You are "Nova", the financial companion for US small-business owners who are not accountants.

How to answer:
- Always friendly, plain English — like talking to a busy shop owner. Avoid heavy accounting jargon; if you must use a term, explain it in one short phrase.
- Keep answers concise: about 180 words max, unless the user explicitly asks for a deep explanation.
- Give concrete dollar amounts from the data below and steps they can do today.
- You may use **bold text** and lists with "- ". No headings, no tables, no code blocks.
- When relevant, point to the right module by its number.

Connecting to the learning path:
- The user works through one learning session per day. If a LEARNING PROGRESS block appears below, use it: tie your answer to the current session when it fits, and do not push them to modules far ahead of that session unless they asked.
- If a MODULE MATERIAL CURRENTLY OPEN block appears, teach that material USING THE USER'S OWN BUSINESS NUMBERS from the data below — that is your main job for this question. Example: if the module is about gross margin, show their purchases as a percent of sales, not the textbook definition.
- When module material is included, never contradict it. The user is reading that module on this same screen; two competing versions confuse rather than help. You may add; you may not contradict.

Hard limits:
- Use ONLY numbers present in the business data below, or numbers the user gives you in conversation. NEVER invent revenue, profit, or costs. If you need data that is missing, ask.
- You are not a CPA, tax advisor, or attorney. For tax filings, disputes, or large financing decisions, recommend the right professional.
- Never promise that any loan or credit application will be approved; the decision belongs to the lender.

Novaro modules (${KURIKULUM.length} total). The "Core" path is the daily session path — one session per day for a week; other paths are an open library. Direct new users to the Core path first.
${MODUL_RINGKAS}`;

/* Label berbahasa Inggris untuk pilihan profil — dipakai AI, laporan,
 * dan kartu kesehatan (server.js). Kunci tetap (disimpan di data pengguna);
 * hanya labelnya yang tampil. Diekspor supaya tiga tempat itu tidak
 * menjaga salinan labelnya sendiri. */
export const LABEL = {
  jenisUsaha: {
    kuliner: 'Food service (restaurant/café/catering)',
    retail: 'Retail store',
    jasa: 'Services (repair, salon, laundry, etc.)',
    produksi: 'Manufacturing / crafts',
    online: 'Online store',
    lainnya: 'Other',
  },
  pencatatan: {
    belum: 'Not recording at all yet',
    kadang: 'Only sometimes',
    buku: 'Paper notebook',
    excel: 'Excel / spreadsheet',
    aplikasi: 'POS or finance app',
  },
  tujuan: {
    'rapikan-keuangan': 'Get the books in order',
    'naikkan-laba': 'Raise profit',
    'ajukan-kur': 'Prepare a loan or credit application',
    'kelola-stok': 'Manage inventory better',
    'kembangkan-usaha': 'Grow the business / open a second location',
  },
};

/** Batas jumlah bulan riwayat yang dikirim. 3 tahun jauh di atas kebutuhan analisis. */
const MAKS_BULAN_RIWAYAT = 36;

const namaBulan = (m) => {
  const [y, mo] = m.split('-');
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

/**
 * Konteks buku kas untuk AI, dipecah dua sesuai sifatnya.
 *
 * `riwayat`  — SELURUH bulan yang sudah selesai. Bulan yang sudah lewat tidak
 *              berubah lagi, jadi blok ini stabil dan ditandai untuk prompt
 *              caching: dibaca berkali-kali dengan biaya sekitar sepersepuluh.
 * `berjalan` — bulan yang sedang jalan dan pengeluaran terbesarnya. Berubah
 *              setiap kali pengguna mencatat, jadi tidak boleh ikut di-cache.
 */
export function cashbookContext(transactions = [], now = new Date()) {
  const semuaBulan = monthsWithData(transactions);
  if (!semuaBulan.length) {
    return {
      riwayat: '',
      berjalan:
        'CASH BOOK\nThe user has not recorded any transactions yet. Encourage them to start recording in the "Cash Book" section — about 10 seconds per entry, and every number in the app becomes accurate after that.',
    };
  }

  const bulanDipakai = semuaBulan.slice(0, MAKS_BULAN_RIWAYAT);
  const summaries = summarizeRange(transactions, bulanDipakai, now);
  const selesai = summaries.filter((s) => s.lengkap);
  const berjalan = summaries.find((s) => !s.lengkap) ?? null;

  return {
    riwayat: riwayatToText(selesai, semuaBulan),
    berjalan: berjalanToText(berjalan, transactions),
  };
}

/** Blok stabil: seluruh bulan yang sudah selesai. Aman di-cache. */
function riwayatToText(selesai, semuaBulan) {
  /*
   * Model perlu tahu SELURUH rentang catatan yang dimilikinya. Tanpa baris ini
   * ia tidak punya cara membedakan "pengguna baru mencatat 3 bulan" dari
   * "pengguna mencatat 2 tahun dan aku cuma diberi 3 bulan" — dan akan bicara
   * soal tren seolah-olah melihat semuanya.
   *
   * Yang dihitung di sini HANYA bulan yang sudah selesai. Angka yang bergerak
   * tidak boleh ikut ke blok yang tugasnya tidak bergerak (satu byte berubah
   * membatalkan seluruh cache di belakangnya).
   */
  const bulanSelesai = semuaBulan.filter((m) => selesai.some((s) => s.month === m));
  const transaksiSelesai = selesai.reduce((n, s) => n + s.jumlahTransaksi, 0);

  const lines = ['CASH BOOK — HISTORY (real numbers from the user\'s records)'];
  lines.push(
    bulanSelesai.length
      ? `Coverage: ${bulanSelesai.length} completed months, ${namaBulan(bulanSelesai.at(-1))} through ${namaBulan(bulanSelesai[0])}, ${transaksiSelesai} transactions.` +
          (semuaBulan.length > MAKS_BULAN_RIWAYAT
            ? ` The user has ${semuaBulan.length} months of records; only the most recent ${MAKS_BULAN_RIWAYAT} are detailed.`
            : ' All of them are detailed below — no month is hidden from you.')
      : 'No completed months yet.',
  );

  if (!selesai.length) {
    lines.push('Not a single month is complete yet; all records sit in the current month.');
    return lines.join('\n');
  }

  for (const s of selesai) lines.push(bulanKeBaris(s));

  /*
   * Tren hanya antara dua bulan penuh yang tercatat rapat. Membandingkan bulan
   * berjalan dengan bulan lalu menghasilkan "sales down 74%" untuk usaha
   * yang penjualannya tidak berubah sama sekali.
   */
  const rapat = selesai.filter(isMonthComplete);
  if (rapat.length >= 2) {
    const [kini, lalu] = rapat;
    const delta = (a, b) => (b > 0 ? Number((((a - b) / b) * 100).toFixed(1)) : null);
    const tren = [];
    const dJual = delta(kini.penjualan, lalu.penjualan);
    const dBelanja = delta(kini.belanjaBahan, lalu.belanjaBahan);
    if (dJual !== null) tren.push(`sales ${dJual >= 0 ? 'up' : 'down'} ${Math.abs(dJual)}%`);
    if (dBelanja !== null) tren.push(`purchases ${dBelanja >= 0 ? 'up' : 'down'} ${Math.abs(dBelanja)}%`);
    if (tren.length) {
      lines.push(`- Trend across complete months — ${namaBulan(kini.month)} vs ${namaBulan(lalu.month)}: ${tren.join(', ')}.`);
    }
  } else {
    lines.push(
      '- There are not yet two densely-recorded complete months to compare. Do NOT compare the current month against last month as if equivalent — the periods have different lengths.',
    );
  }

  return lines.join('\n');
}

/** Blok berubah-ubah: bulan berjalan + pengeluaran terbesarnya. Tidak di-cache. */
function berjalanToText(berjalan, transactions) {
  const lines = ['CASH BOOK — CURRENT MONTH'];

  if (!berjalan || berjalan.jumlahTransaksi === 0) {
    lines.push('Nothing recorded this month yet. Encourage the user to start recording again.');
  } else {
    lines.push(bulanKeBaris(berjalan));
    lines.push(pengeluaranTerbesar(transactions, berjalan.month));
  }

  lines.push(
    'Use these cash book numbers as the basis for advice. Mention dates or transaction names when they help the owner recognize the pattern.',
  );
  return lines.filter(Boolean).join('\n');
}

/** Satu baris ringkasan bulan, lengkap dengan periodenya. */
function bulanKeBaris(s) {
  const periode = isMonthComplete(s)
    ? `full ${s.hariBulan}-day month, densely recorded`
    : s.lengkap
      ? `INCOMPLETE — the month has passed but only ${s.hariTercatat} of ${s.hariBulan} days were recorded, so the numbers are lower than reality`
      : `IN PROGRESS ${s.hariBerjalan} of ${s.hariBulan} days — full-month equivalent: sales ${formatDolar(s.setara.penjualan)}, net profit ${formatDolar(s.setara.labaBersih)}`;
  return (
    `- ${namaBulan(s.month)}: sales ${formatDolar(s.penjualan)}, purchases ${formatDolar(s.belanjaBahan)}, ` +
    `operating ${formatDolar(s.operasional)}, net profit ${formatDolar(s.labaBersih)} (margin ${s.marginBersih}%), ` +
    `owner draw ${formatDolar(s.prive)}, cash balance ${formatDolar(s.saldoKas)} — recorded ${s.hariTercatat} days, ${s.jumlahTransaksi} transactions (${periode})`
  );
}

/**
 * Lima pengeluaran terbesar, digabung per keterangan/kategori.
 *
 * Tanpa penggabungan, usaha yang belanja bahan $220 setiap hari
 * menghasilkan lima baris identik yang tidak berisi informasi apa pun.
 */
function pengeluaranTerbesar(transactions, month) {
  const rekap = new Map();
  for (const t of transactions) {
    if (t.jenis !== 'keluar' || !String(t.tanggal).startsWith(month)) continue;
    const kategori = kategoriLabel(t.jenis, t.kategori);
    const nama = String(t.keterangan || '').trim() || kategori;
    const kunci = `${nama}|${kategori}`;
    const agg = rekap.get(kunci) ?? { nama, kategori, total: 0, kali: 0 };
    agg.total += Number(t.jumlah) || 0;
    agg.kali += 1;
    rekap.set(kunci, agg);
  }

  const besar = [...rekap.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  if (!besar.length) return '';

  return (
    `- Largest expenses in ${namaBulan(month)} (grouped by item): ` +
    besar
      .map((r) => {
        const rincian = [r.kali > 1 ? `${r.kali}x` : '', r.nama === r.kategori ? '' : r.kategori].filter(Boolean);
        return `${r.nama} ${formatDolar(r.total)}${rincian.length ? ` (${rincian.join(', ')})` : ''}`;
      })
      .join('; ')
  );
}

/** Menyusun profil usaha + hasil hitungan menjadi teks konteks untuk AI. */
export function profileToText(profile, metrics) {
  if (!profile) {
    return 'The user has not filled in the business profile yet. Invite them to complete "Business Profile" so advice can be tailored — but still help with their question in general terms.';
  }
  const lamaBulan = Number(profile.lamaUsahaBulan) || 0;
  const lama =
    lamaBulan >= 12
      ? `${Math.floor(lamaBulan / 12)} yr ${lamaBulan % 12} mo`
      : `${lamaBulan} mo`;

  /*
   * NAMA USAHA DAN LOKASI SENGAJA TIDAK IKUT.
   *
   * Keduanya dulu dikirim ke Anthropic pada setiap pertanyaan, sementara teks
   * persetujuan pengguna menyatakan data pengenal tidak dikirim. Untuk usaha
   * mikro keduanya memang mengenali: nama usaha kecil hampir selalu nama
   * pemiliknya, dan nama itu digabung satu kota menunjuk satu orang. Bukti
   * bahwa repositori ini sendiri menganggapnya pengenal:
   * `scripts/export.js --anonymize` menghapus persis medan-medan ini.
   *
   * Yang hilang dari mutu jawaban: hampir nol. Model tidak pernah memerlukan
   * nama usaha untuk menghitung margin — ia hanya memakainya sebagai sapaan.
   */
  const baris = [
    `- Business type: ${LABEL.jenisUsaha[profile.jenisUsaha] ?? profile.jenisUsaha ?? '(not filled)'}`,
    `- Operating for: ${lama}`,
    `- Employees: ${Number(profile.jumlahKaryawan) || 0}`,
    `- Main products: ${profile.produkUtama || '(not filled)'}`,
    `- How they record today: ${LABEL.pencatatan[profile.pencatatan] ?? '(not filled)'}`,
    `- Separate business account: ${profile.rekeningTerpisah ? 'Yes' : 'Not yet'}`,
    `- Has an EIN: ${profile.punyaNib ? 'Yes' : 'Not yet'}`,
    `- Main goal: ${LABEL.tujuan[profile.tujuan] ?? '(not filled)'}`,
  ];
  if (profile.tantangan) baris.push(`- Biggest challenge per the owner: "${profile.tantangan}"`);

  return `USER'S BUSINESS DATA
${baris.join('\n')}

FINANCIAL NUMBERS (computed by the system — use as given)
${metricsToText(metrics)}`;
}

/**
 * Menyusun blok system prompt, diurutkan dari yang paling jarang berubah.
 *
 * Prompt caching bekerja atas awalan (prefix): satu byte berubah di depan
 * membatalkan semua yang di belakangnya. Karena itu urutannya:
 *
 *   1. PERAN + daftar modul   — tidak pernah berubah
 *   2. Riwayat buku kas       — berubah sebulan sekali  <-- penanda cache di sini
 *   3. Profil + angka + bulan berjalan — berubah tiap kali pengguna mencatat
 *
 * Penanda cache ditaruh di ujung blok 2, sehingga blok 1 dan 2 tersimpan
 * bersama. Ambang minimum Sonnet 5 adalah 1024 token; blok PERAN saja hanya
 * sekitar 550 token, jadi selama ini penandanya diam-diam tidak berefek apa pun.
 * Digabung dengan riwayat, awalan ini baru benar-benar terbentuk.
 *
 * Penandanya pun hanya dipasang kalau blok stabilnya memang cukup panjang.
 * Pengguna baru belum punya satu pun bulan yang selesai, jadi `riwayat` masih
 * kosong dan awalannya tetap di bawah ambang. Menyembunyikannya membuat
 * perilaku aplikasi ini jujur terhadap apa yang benar-benar terjadi.
 */
const AMBANG_CACHE_CHAR = 4000; // ~1024 token untuk teks bahasa Inggris

function systemBlocks(profile, metrics, cashbook, tugas = '', belajar = []) {
  const { riwayat = '', berjalan = '' } = typeof cashbook === 'string' ? { berjalan: cashbook } : cashbook ?? {};

  const stabil = [PERAN, riwayat].filter(Boolean).join('\n\n');
  /*
   * Konteks belajar duduk di blok volatil, bukan stabil. Ia berubah setiap kali
   * pengguna menyelesaikan satu sesi — menaruhnya di blok yang di-cache akan
   * membatalkan cache-nya justru pada hari-hari pengguna paling aktif.
   */
  const volatil = [profileToText(profile, metrics), berjalan, ...belajar, tugas].filter(Boolean).join('\n\n');

  const blokStabil = { type: 'text', text: stabil };
  if (stabil.length >= AMBANG_CACHE_CHAR) blokStabil.cache_control = { type: 'ephemeral' };

  return [blokStabil, { type: 'text', text: volatil }];
}

/**
 * System prompt untuk konsultasi chat.
 *
 * @param {{kemajuan?: string, materi?: string}} belajar konteks pembelajaran:
 *   ringkasan sesi yang sedang dijalani, dan — hanya bila pengguna bertanya dari
 *   dalam sebuah modul — materi lengkap modul itu.
 */
export function chatSystem(profile, metrics, cashbook = '', belajar = {}) {
  const { kemajuan = '', materi = '' } = belajar ?? {};
  return systemBlocks(profile, metrics, cashbook, '', [kemajuan, materi]);
}

/** System prompt untuk menyusun rekomendasi personal terstruktur. */
export function recommendationSystem(profile, metrics, cashbook = '', belajar = {}) {
  const { kemajuan = '' } = belajar ?? {};
  return systemBlocks(
    profile,
    metrics,
    cashbook,
    `CURRENT TASK
Build a personal financial improvement plan for the business above, as JSON matching the schema.

Rules:
- Every recommendation must be specific to THIS business — cite dollar amounts from the data above when relevant. No generic advice that would fit any business.
- Order by impact. At most 3 items with priority "high".
- Each recommendation carries 2–4 steps the owner can execute on their own in the near term.
- "modulTerkait" = the most relevant module number ${MODUL_MIN}–${MODUL_MAKS}. Prefer Core-path modules when the user is new to recording.
- "targetBulanIni" = exactly 3 concrete, measurable targets for the next 30 days.
- "peringatan" only when there is a real risk in the data (e.g. losses, very thin margin, loan payments above 30% of profit, business and personal money still mixed). Leave empty otherwise.
- Do not repeat the health score; the system already displays it.`,
    // Rekomendasi ikut melihat kemajuan belajar supaya "modulTerkait" mengarah
    // ke tempat pengguna benar-benar berada.
    [kemajuan],
  );
}

/** Skema JSON untuk structured outputs. */
export const RECOMMENDATION_SCHEMA = {
  type: 'object',
  properties: {
    ringkasan: {
      type: 'string',
      description: 'Summary of the business condition in 2-3 sentences, plain and honest.',
    },
    rekomendasi: {
      type: 'array',
      description: '3-5 personal recommendations, ordered by impact.',
      items: {
        type: 'object',
        properties: {
          judul: { type: 'string', description: 'Short title, max 8 words.' },
          prioritas: { type: 'string', enum: ['high', 'medium', 'low'] },
          alasan: { type: 'string', description: 'Why this matters for THIS business — cite the numbers.' },
          langkah: {
            type: 'array',
            description: '2-4 concrete steps the owner can execute.',
            items: { type: 'string' },
          },
          dampak: { type: 'string', description: 'Expected benefit if done — keep it short.' },
          /*
           * Rentangnya disebut di deskripsi, bukan sebagai `minimum`/`maximum`.
           * Structured outputs hanya menerima sebagian kata kunci JSON Schema,
           * dan skema yang ditolak menggagalkan SELURUH jalur rekomendasi.
           * Nomor di luar rentang ditangkap belakangan oleh `nomorModulSah()`.
           */
          modulTerkait: {
            type: 'integer',
            description: `Relevant module number ${MODUL_MIN}-${MODUL_MAKS}.`,
          },
        },
        required: ['judul', 'prioritas', 'alasan', 'langkah', 'dampak', 'modulTerkait'],
        additionalProperties: false,
      },
    },
    peringatan: {
      type: 'array',
      description: 'Real risks from the data. Leave empty if none.',
      items: { type: 'string' },
    },
    targetBulanIni: {
      type: 'array',
      description: 'Exactly 3 concrete, measurable targets for the next 30 days.',
      items: { type: 'string' },
    },
  },
  required: ['ringkasan', 'rekomendasi', 'peringatan', 'targetBulanIni'],
  additionalProperties: false,
};

export function recommendationRequest(profile, metrics) {
  // "this business", bukan namanya — lihat catatan di profileToText.
  return `Build a financial improvement plan for this business. The owner's main goal: ${
    LABEL.tujuan[profile.tujuan] ?? 'getting the books in order'
  }. Current net profit is ${formatDolar(metrics.labaBersih)} per month.`;
}

/* ================================================== Ekstraksi nota (foto) */

/**
 * Skema JSON hasil baca nota. Medan yang tidak terbaca WAJIB null —
 * "required" di sini menuntut KUNCI-nya ada, bukan nilainya terisi, supaya
 * model tidak merasa dipaksa mengarang angka saat notanya kabur.
 */
export const NOTA_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['expense', 'income'], description: 'Purchase receipt = expense. Customer sales receipt = income.' },
    amount: { type: ['number', 'null'], description: 'FINAL TOTAL of the transaction in US dollars (plain number, no separators or $ sign). null if unreadable.' },
    category: { type: ['string', 'null'], description: 'Free-form item keyword, 1-3 words, e.g. "groceries", "fuel", "office supplies". null if unclear.' },
    description: { type: ['string', 'null'], description: 'Summary of goods/services, max 8 words. null if none.' },
    merchant: { type: ['string', 'null'], description: 'Store or business name printed on the receipt. null if unreadable.' },
    date: { type: ['string', 'null'], description: 'Transaction date from the receipt, format YYYY-MM-DD. null if absent.' },
    confidence: { type: 'number', description: 'Overall confidence 0.0-1.0.' },
  },
  required: ['type', 'amount', 'category', 'description', 'merchant', 'date', 'confidence'],
  additionalProperties: false,
};

/** Instruksi sistem pembaca nota — aturan memilih TOTAL adalah intinya. */
export function notaSystem() {
  return `You are a receipt reader for a US small-business bookkeeping app.
Your ONE job: read the receipt photo and return JSON matching the schema. No narration.

HOW TO PICK THE TOTAL (most important):
- Choose the number on the line labeled: TOTAL, GRAND TOTAL, AMOUNT DUE, BALANCE DUE, TOTAL DUE, or PAYMENT.
- If there is no label, pick the final amount paid at the bottom of the receipt.
- Do NOT just grab the largest number. Unit prices, per-line subtotals, change received, phone numbers, and receipt codes are NOT the total.
- US numbers use a comma as the thousands separator and a period for decimals ($1,234.56 = 1234.56).

UNREADABLE VALUES:
- Return null. Never guess, never do your own addition, never invent.
- If the total is readable but uncertain, still fill it in — and LOWER the confidence.

confidence:
- 0.9 and above: printed receipt, clear, labeled total.
- 0.6-0.85: partially blurred, handwritten, or the total must be inferred from context.
- below 0.6: not confident the total is correct.

category: free-form 1-3 word keyword (not a fixed taxonomy — the app maps it). Examples: grocery run → "groceries"; gas station → "fuel"; office store → "office supplies".

date: from the printed receipt date. Two-digit year → pick the nearest year that does not put the date in the future.`;
}

/** Permintaan pengguna — sengaja sependek ini; system yang memuat aturannya. */
export function notaRequest() {
  return 'Read this receipt and return its JSON.';
}

/* ================================================== Check-up keuangan (AI) */

/**
 * Skema hasil check-up: daftar observasi berstatus + satu insight.
 * Sengaja TIDAK ADA medan angka — semua angka di halaman berasal dari
 * data aplikasi yang dikirim sebagai konteks; model hanya menilai status.
 */
export const CHECKUP_SCHEMA = {
  type: 'object',
  properties: {
    item: {
      type: 'array',
      description: '3-5 short observations about the business condition, most important first.',
      items: {
        type: 'object',
        properties: {
          tipe: { type: 'string', enum: ['ok', 'attention'], description: 'ok = in good shape; attention = needs handling.' },
          teks: { type: 'string', description: 'One sentence, max 120 characters. Cite ONLY numbers present in the given data.' },
        },
        required: ['tipe', 'teks'],
        additionalProperties: false,
      },
    },
    insight: { type: 'string', description: 'One or two practical sentences: the single most useful thing to do this week.' },
  },
  required: ['item', 'insight'],
  additionalProperties: false,
};

/** Instruksi sistem check-up — larangan mengarang angka adalah intinya. */
export function checkupSystem(angkaTeks) {
  return `You are the financial check-up assistant for a US small-business owner.

Judge the business ONLY from the numbers below — no outside data:

${angkaTeks}

Rules:
- Each item is one sentence, max 120 characters: factual, specific to this business, actionable.
- Numbers you may cite come ONLY from the data above. No new math, no projections, no inventions.
- Use type "ok" for good condition, "attention" for something that needs handling. When unsure, choose "attention".
- 3-5 items, most important first.
- insight: one or two sentences — the highest-impact step they can take this week.
- This is educational analysis, not professional financial advice and not a credit decision.`;
}

/** Permintaan pengguna — konteks angka sudah di system instruction. */
export function checkupRequest() {
  return 'Run the financial check-up for this business.';
}

/* --------------------------------- Soal latihan personal (AI, opsional) */

export const LATIHAN_AI_SCHEMA = {
  type: 'object',
  properties: {
    pertanyaan: {
      type: 'string',
      description: 'ONE multiple-choice question in English, max 240 characters, using the given business numbers.',
    },
    pilihan: {
      type: 'object',
      properties: {
        A: { type: 'string', description: 'Max 120 characters.' },
        B: { type: 'string', description: 'Max 120 characters.' },
        C: { type: 'string', description: 'Max 120 characters.' },
      },
      required: ['A', 'B', 'C'],
      additionalProperties: false,
    },
    kunci: { type: 'string', enum: ['A', 'B', 'C'] },
    penjelasan: {
      type: 'string',
      description: 'Max 300 characters. Explains why the key is correct by referring to the given numbers.',
    },
    konsep: {
      type: 'string', description: 'Short concept label (2-40 characters), e.g. "margin", "owner draw", "cash flow".',
    },
  },
  required: ['pertanyaan', 'pilihan', 'kunci', 'penjelasan', 'konsep'],
  additionalProperties: false,
};

/**
 * Sistem untuk soal latihan personal. Dua larangan yang paling dijaga:
 * tidak mengarang angka di luar data yang diberikan, dan tidak keluar dari
 * materi modul yang sedang dipelajari pengguna.
 */
export function latihanAiSystem(materiTeks, angkaTeks) {
  return `You are a quiz writer for US small-business owners learning applied finance in the Novaro app.

MODULE MATERIAL CURRENTLY BEING STUDIED:
${materiTeks}

THE USER'S BUSINESS NUMBERS (the only numbers you may use):
${angkaTeks}

Rules:
1. Write EXACTLY ONE multiple-choice question (3 options: A, B, C) that tests understanding of the material above, using the user's own numbers.
2. Invent no numbers outside the given data. If data is thin, write a conceptual question from the material without numbers.
3. Calibrate difficulty: the question must answer "does the user understand this module's concept for their own business", not memorization of the text.
4. Distractors must be plausible — built from typical misunderstandings (mixing profit with cash, dividing margin by COGS), not obviously wrong options.
5. Plain, friendly English a busy owner can read fast.
6. Answer with JSON only, matching the schema.`;
}

/** Permintaan pengguna — konteks materi + angka sudah di system instruction. */
export function latihanAiRequest() {
  return 'Write their personal practice question now.';
}
