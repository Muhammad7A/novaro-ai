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
 *      (Kebalikan pola simulasi-cicilan.js yang rumusnya sengaja ikut ke
 *      peramban — di sini kuncinya rahasia, jadi arah datanya dibalik.)
 *   2. Penilaian deterministik. Pilihan = pencocokan huruf; hitung =
 *      angka dengan toleransi; golong = pencocokan urutan golongan.
 *      Tidak ada AI di jalur ini — AI hanya membuat soal tambahan
 *      (sanitasiLatihanAI di bawah), tidak pernah MENILAI jawaban.
 *   3. Soal selalu setia pada materi modulnya dan kategori resmi buku
 *      kas (KATEGORI di lib/cashbook.js) — latihan yang mengajarkan
 *      kategori yang tidak ada di aplikasi adalah latihan yang salah.
 *
 * Soal hanya untuk tujuh sesi jalur dasar (modul 101–107) — inilah
 * program intinya; modul pustaka tetap bebas dibaca tanpa gerbang.
 * Soal berbahasa Inggris sejak ganti kurikulum enterprise (W2b).
 */

/* ----------------------------------------------------------------- Soal */

const SOAL = {
  101: [
    {
      tipe: 'hitung',
      pertanyaan:
        'One day: sales $2,400, materials purchased $1,150, utilities and fees $290. What is the day\'s net profit? (in dollars)',
      kunci: 960,
      satuan: 'dollar',
      penjelasan:
        'Profit = sales − materials − operating costs = 2,400 − 1,150 − 290 = $960. Not $2,400 — that is revenue, the top line.',
      konsep: 'revenue-vs-profit',
    },
    {
      tipe: 'golong',
      pertanyaan: 'Sort each cash movement: is it BUSINESS or PERSONAL?',
      item: ['Supplies for the shop', 'Your kid\'s phone bill', 'Morning customer sales', 'Family dinner groceries'],
      golongan: ['Business', 'Personal'],
      kunci: [0, 1, 0, 1],
      penjelasan:
        'Supplies and customer sales are business. The phone bill and groceries spend from the same wallet but are personal — record them as an owner draw so they never contaminate profit.',
      konsep: 'owner-draw',
    },
    {
      tipe: 'pilihan',
      pertanyaan: 'You take $600 from the business account for personal use. What does it do in the books?',
      pilihan: {
        A: 'Profit falls by $600',
        B: 'Cash falls by $600, profit unchanged',
        C: 'No effect anywhere',
      },
      kunci: 'B',
      penjelasan:
        'An owner draw moves cash out without being a business cost. Book it as a draw and profit stays honest — a healthy month must not print as a loss just because you paid yourself.',
      konsep: 'owner-draw',
    },
  ],
  102: [
    {
      tipe: 'golong',
      pertanyaan: 'File each cost into the right cash book category:',
      item: ['Flour resold as bread', 'Shop rent', 'Loan principal payment', 'Owner contribution deposited'],
      golongan: ['Affects profit', 'Cash only'],
      kunci: [0, 0, 1, 1],
      penjelasan:
        'Flour (COGS) and rent (operating expense) hit profit. Loan principal and owner contributions move cash only — they are not income and not expense.',
      konsep: 'chart-of-accounts',
    },
    {
      tipe: 'pilihan',
      pertanyaan: 'A cost that doubles when sales doubles belongs to:',
      pilihan: {
        A: 'Cost of goods sold (purchases)',
        B: 'Operating expenses',
        C: 'Owner draw',
      },
      kunci: 'A',
      penjelasan:
        'The test is "does the cost move with volume?" If it scales with sales it is COGS. Rent — the same whether you sell one unit or a hundred — is operating expense.',
      konsep: 'cogs-vs-opex',
    },
    {
      tipe: 'hitung',
      pertanyaan:
        'Monthly sales $18,000, purchases $7,200, operating expenses $6,100. What is GROSS profit? (in dollars)',
      kunci: 10_800,
      satuan: 'dollar',
      penjelasan: 'Gross profit = sales − COGS = 18,000 − 7,200 = $10,800. Operating expenses are subtracted AFTER this line.',
      konsep: 'gross-margin',
    },
  ],
  103: [
    {
      tipe: 'pilihan',
      pertanyaan: 'Under CASH-basis accounting, income counts when:',
      pilihan: {
        A: 'The invoice is sent',
        B: 'The payment actually lands',
        C: 'The work is half done',
      },
      kunci: 'B',
      penjelasan:
        'Cash-basis books income when payment arrives and expenses when paid — it mirrors the bank account. Accrual books when earned/incurred instead.',
      konsep: 'cash-basis',
    },
    {
      tipe: 'pilihan',
      pertanyaan: 'A profitable accrual-basis month can still end with zero cash because:',
      pilihan: {
        A: 'Accrual ignores money entirely',
        B: 'Earned income on invoices not yet paid still counts as income',
        C: 'Accrual adds a hidden tax reserve',
      },
      kunci: 'B',
      penjelasan:
        'Accrual counts invoiced-but-unpaid sales as income. The P&L looks great while receivables sit uncollected — exactly why cash flow is tracked separately.',
      konsep: 'accrual',
    },
    {
      tipe: 'pilihan',
      pertanyaan: 'You want to change your official tax accounting method. The honest answer is:',
      pilihan: {
        A: 'Flip the toggle in your app and move on',
        B: 'It generally needs IRS consent (Form 3115) — an accountant conversation',
        C: 'Methods can switch every quarter freely',
      },
      kunci: 'B',
      penjelasan:
        'A formal method change affects when income is taxed; done carelessly one year can be taxed twice or not at all. Form 3115 exists precisely because this is not a settings toggle.',
      konsep: 'method-switch',
    },
  ],
  104: [
    {
      tipe: 'hitung',
      pertanyaan:
        'Sales $32,000, COGS $19,200. What is gross MARGIN as a percentage of sales? (number only, e.g. 40)',
      kunci: 40,
      satuan: 'percent',
      toleransi: 0.5,
      penjelasan: 'Gross profit = 32,000 − 19,200 = $12,800. Margin = 12,800 ÷ 32,000 = 40%.',
      konsep: 'gross-margin',
    },
    {
      tipe: 'pilihan',
      pertanyaan: 'A gross margin that shrinks slowly over months is usually the earliest sign of:',
      pilihan: {
        A: 'Rising supplier costs or quiet discounting',
        B: 'Too many bank accounts',
        C: 'Paying taxes too early',
      },
      kunci: 'A',
      penjelasan:
        'Gross margin isolates the product itself from overhead. A slow slide there shows up long before net profit notices — the whole reason to read lines separately.',
      konsep: 'gross-margin',
    },
    {
      tipe: 'hitung',
      pertanyaan:
        'Gross profit $12,000, operating expenses $6,100. What is operating profit? (in dollars)',
      kunci: 5_900,
      satuan: 'dollar',
      penjelasan: 'Operating profit = gross profit − operating expenses = 12,000 − 6,100 = $5,900.',
      konsep: 'pnl-structure',
    },
  ],
  105: [
    {
      tipe: 'pilihan',
      pertanyaan: 'Reconciliation means:',
      pilihan: {
        A: 'The totals of your books and the bank are roughly close',
        B: 'Line by line, every transaction matches a statement line — each one ticked',
        C: 'The bank statement is imported and never read',
      },
      kunci: 'B',
      penjelasan:
        'Plausible totals hide a $420 sale recorded as $240. Reconciliation is per-line confirmation — the only proof that the books describe real money.',
      konsep: 'reconciliation',
    },
    {
      tipe: 'pilihan',
      pertanyaan: 'A check written Thursday that clears the following Tuesday is:',
      pilihan: {
        A: 'An error to correct immediately',
        B: 'A normal timing difference — expect it to clear',
        C: 'Evidence of fraud',
      },
      kunci: 'B',
      penjelasan:
        'Timing differences are normal. Mark them, expect them on the next statement — and investigate anything still unmatched two statements later.',
      konsep: 'timing-difference',
    },
    {
      tipe: 'golong',
      pertanyaan: 'Which risks does monthly reconciliation actually catch?',
      item: ['A fat-fingered sale amount', 'A duplicate supplier charge', 'Next year\'s marketing plan', 'A charge you never made'],
      golongan: ['Caught by reconciliation', 'Not a reconciliation matter'],
      kunci: [0, 0, 1, 0],
      penjelasan:
        'Wrong amounts, duplicate charges, and unfamiliar transactions are exactly what per-line matching surfaces. Marketing plans are strategy, not books.',
      konsep: 'reconciliation',
    },
  ],
  106: [
    {
      tipe: 'pilihan',
      pertanyaan: 'The US tax test for a deductible business expense is that it is:',
      pilihan: {
        A: 'Ordinary and necessary',
        B: 'Large and documented',
        C: 'Cash and recent',
      },
      kunci: 'A',
      penjelasan:
        'Ordinary (common in your industry) and necessary (helpful and appropriate). Short enough to apply at the register, not just at filing time.',
      konsep: 'ordinary-necessary',
    },
    {
      tipe: 'golong',
      pertanyaan: 'Sort these mixed-use costs by how they are handled:',
      item: ['Home office used 15% for business', 'A ream of paper for the shop', 'Personal car with a business mileage log'],
      golongan: ['Split by a consistent method', 'Fully business'],
      kunci: [0, 1, 0],
      penjelasan:
        'Home office and vehicle are split (square footage, mileage log) using a boring consistent method. Paper bought for the shop is fully business.',
      konsep: 'mixed-use',
    },
    {
      tipe: 'pilihan',
      pertanyaan: 'You recorded an expense wrong last month. The trustworthy fix is:',
      pilihan: {
        A: 'Silently overwrite the old entry so it looks right',
        B: 'A visible correction that leaves a footprint',
        C: 'Delete the month and start over',
      },
      kunci: 'B',
      penjelasan:
        'A book where corrections are visible is more trustworthy than one pretending it was never wrong — to a lender, an auditor, and your future self alike.',
      konsep: 'audit-trail',
    },
  ],
  107: [
    {
      tipe: 'pilihan',
      pertanyaan: 'Closing the month means:',
      pilihan: {
        A: 'Deleting drafts and hoping numbers settle',
        B: 'Everything recorded, reconciled, category-scanned — then locked',
        C: 'Resetting the cash book to zero',
      },
      kunci: 'B',
      penjelasan:
        'A close is a deliberate pass ending with the month locked, so later changes cannot silently rewrite history. After a close, the P&L is a statement — not a draft.',
      konsep: 'month-end-close',
    },
    {
      tipe: 'pilihan',
      pertanyaan: 'The "category scan" step of the close is powerful because:',
      pilihan: {
        A: 'Formulas catch every error automatically',
        B: 'Human eyes on a sorted list catch what no formula does',
        C: 'It replaces reconciliation',
      },
      kunci: 'B',
      penjelasan:
        'Sorting each category by amount and reading the top and the odd ones surfaces the $340 "office supply" that was personal — a pattern, not a formula problem.',
      konsep: 'category-scan',
    },
    {
      tipe: 'golong',
      pertanyaan: 'Put each close task in its half of the checklist:',
      item: ['Reconcile to statements', 'Enter all transactions', 'Lock the month', 'Scan categories'],
      golongan: ['First half', 'Second half'],
      kunci: [1, 0, 1, 1],
      penjelasan:
        'Enter everything first, reconcile second (nothing to reconcile otherwise), then scan categories for oddities, then lock. Order is the checklist\'s value.',
      konsep: 'month-end-close',
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
    // Semua soal hitung berjawaban angka bulat: buang pemisah ribuan dan
    // teks apa pun ("$12,800" → 12800) sebelum membandingkan.
    const n = Number(String(jawaban ?? '').replace(/[^\d.-]/g, ''));
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
