/**
 * Kurikulum Novaro — SUMBER TUNGGAL. Edisi enterprise US (W2b, 2026-09-25).
 *
 * Berkas ini dipakai tiga pihak sekaligus:
 *   1. Halaman Modul di peramban (lewat `GET /modul.js`)
 *   2. Prompt AI (`prompts.js` menurunkan daftar ringkasnya dari sini)
 *   3. Ekspor (jumlah modul & nama jalur)
 *
 * Dulu daftar modul ditulis dua kali — sekali di `index.html`, sekali sebagai
 * teks tetap di `prompts.js`. Selama keduanya sama persis tidak ada yang
 * kelihatan salah; begitu salah satu diubah, AI mulai menyarankan "buka modul 7"
 * yang isinya bukan modul 7 di layar pengguna. Kesalahan seperti itu tidak
 * membuat apa pun gagal — ia hanya membuat nasihatnya salah alamat, diam-diam.
 * Karena itu hanya ada satu daftar, dan yang lain menurunkannya.
 *
 * ------------------------------------------------------------------
 * GANTI KURIKULUM 2026-09-25 (keputusan owner — ENTERPRISE-OVERHAUL-PLAN)
 *
 * 29 modul lama bergaya warung-Indonesia (GoFood, QRIS, pajak UMKM, NIB,
 * KUR) diganti 13 modul keuangan-dan-akuntansi enterprise AS, berbahasa
 * Inggris. Mesinnya TIDAK berubah: jalur + sesi harian + latihan + praktik
 * terverifikasi tetap memakai bentuk yang sama.
 *
 * PENOMORAN: modul baru mulai dari 101. Nomor 1–29 ditempati modul lama di
 * `progress.done` milik pengguna dan di `events.csv` (module_completed), dan
 * aturan berkas ini melarang memakai ulang nomor modul yang dihapus —
 * penomoran ulang dari 1 akan menandai modul BARU sebagai sudah dibaca hanya
 * karena pengguna lama pernah menyelesaikan modul LAMA bernomor sama.
 * Jarak satu abis sengaja terlihat jelas di data.
 *
 * Video pendamping lama tidak dibawa: tautan mati lebih buruk daripada tidak
 * ada tautan. Modul baru berdiri sendiri pada teksnya.
 */

export const JALUR = {
  dasar: {
    kunci: 'dasar',
    nama: 'Core — 7 daily sessions',
    ringkas: 'One session a day, 10–15 minutes, for one week. Start at session 1.',
    warna: 'green',
  },
  lanjutan: {
    kunci: 'lanjutan',
    nama: 'Operate — deeper numbers',
    ringkas: 'After the cash book is running: payables, receivables, contractor forms, and variance.',
    warna: 'blue',
  },
  tumbuh: {
    kunci: 'tumbuh',
    nama: 'Grow — cash that lasts',
    ringkas: 'Runway and multi-state sales tax for the business that is scaling.',
    warna: 'gold',
  },
  modal: {
    kunci: 'modal',
    nama: 'Govern — controls & trust',
    ringkas: 'Internal controls that make the books worth trusting — and worth auditing.',
    warna: 'plum',
  },
};

export const KURIKULUM = [
  /* ================================================================
     CORE — 7 sesi harian (satu minggu)
     ================================================================ */

  {
    no: 101,
    sesi: 1,
    jalur: 'dasar',
    icon: '💵',
    judul: 'Revenue, profit, and cash are three different numbers',
    ringkas:
      'A busy month can still be a losing month. Separating business money from personal money is what makes the three numbers readable at all.',
    menit: 12,
    isi: [
      {
        h: 'Three numbers, one lumpy wallet',
        p: 'Revenue is everything customers paid you. Profit is what is left after the costs of earning that revenue. Cash is what is physically available right now. A business can have great revenue, negative profit, and empty cash — all in the same week. The only way to tell them apart is to record every movement in one dedicated place.',
      },
      {
        h: 'Open a separate business account',
        li: [
          'A checking account in the business name (or a second personal account used strictly for the business, if the bank requires an EIN first).',
          'One card, one account, one purpose: every business dollar in and out passes through it.',
          'Owner money going in is an owner contribution — it increases cash, never profit.',
          'Owner money taken out is an owner draw — it decreases cash, never profit.',
        ],
      },
      {
        h: 'Why draws are not expenses',
        p: 'Paying yourself is not a cost of doing business. If a $600 draw is recorded as an expense, a profitable month can print as a loss — and every number built on top of profit (margins, health score, safe loan payment) inherits the error. Record the draw under Owner draw and profit stays honest.',
      },
      {
        h: 'The one-week habit',
        p: 'Record money the day it moves, or in one fixed five-minute slot each evening. Reconstruction is where mistakes live: a reconstructed month is a guess wearing a spreadsheet. Ten seconds per transaction at the register beats an hour of archaeology at month-end.',
      },
    ],
    praktik:
      'Record one real transaction in the cash book — a sale, a purchase, or an owner draw — and watch which of the three numbers it moves.',
    aksi: { halaman: 'kas', label: 'Open the cash book', terverifikasi: 'transaksi' },
  },

  {
    no: 102,
    sesi: 2,
    jalur: 'dasar',
    icon: '🗂️',
    judul: 'The chart of accounts: a place for every dollar',
    ringkas:
      'Categories are the chart of accounts of a small business. Consistent categories are what turn a pile of transactions into a statement.',
    menit: 12,
    isi: [
      {
        h: 'What a chart of accounts is',
        p: 'Every accounting system from a shoebox to SAP is built on the same idea: a fixed list of named buckets, and a rule that every dollar lands in exactly one bucket. Financial statements are nothing more than those buckets summed. Change the buckets and every report changes meaning; use them consistently and reports become comparable month over month.',
      },
      {
        h: 'The buckets in this app',
        li: [
          'Sales — revenue from customers. The top line.',
          'Purchases / COGS — goods and materials you resell or turn into product.',
          'Operating expenses — rent, utilities, software, marketing: the cost of keeping the doors open.',
          'Owner draw / owner contribution — money out to or in from the owner. Cash moves; profit does not.',
          'Loan payment — principal back to a lender. Reducing debt is not an expense.',
        ],
      },
      {
        h: 'COGS vs operating expenses',
        p: 'The test: does the cost move with volume? Flour for a bakery doubles when sales double — that is COGS. Rent stays the same whether you sell one loaf or a hundred — that is operating expense. Gross margin (Sales − COGS) answers "is the product itself profitable?"; operating expenses answer "can the business afford its own overhead?"',
      },
      {
        h: 'Consistency beats precision',
        p: 'A category system only works if the same purchase lands in the same bucket every time. Write your own one-line rule for the fuzzy ones ("coffee for the office = operating expense; coffee for resale = COGS") and follow it. An audit trail of consistent choices is worth more than a theoretically perfect system applied at random.',
      },
    ],
    praktik:
      'Record one purchase in the cash book and pick its category deliberately — ask "does this cost move with volume?" before you save.',
    aksi: { halaman: 'kas', label: 'Record a categorized purchase', terverifikasi: 'transaksi' },
  },

  {
    no: 103,
    sesi: 3,
    jalur: 'dasar',
    icon: '⚖️',
    judul: 'Cash or accrual? The method decision',
    ringkas:
      'Cash-basis is the default most small US businesses start with — and the switch to accrual is a real accounting event, not a settings toggle.',
    menit: 10,
    isi: [
      {
        h: 'Cash-basis: money when it moves',
        p: 'Income counts when payment lands; expenses count when paid. It matches the cash book exactly, it is simple, and for most solo and small service businesses it is an accepted method for tax reporting. If your answer to "how is the business doing?" is "how much money is in the account?", you are already thinking cash-basis.',
      },
      {
        h: 'Accrual: earnings when earned',
        p: 'Income counts when earned (invoice sent), expenses when incurred (bill received) — regardless of payment timing. It shows receivables and payables as real obligations, which is why lenders, investors, and GAAP financial statements prefer it. It is also more work: unpaid invoices become reportable income, and a profitable accrual month can still end with zero cash.',
      },
      {
        h: 'The trap in switching',
        li: [
          'Switching methods changes when income is taxed — done wrong, one year gets taxed twice or not at all.',
          'A formal method change for tax generally needs IRS consent (Form 3115) — an accountant conversation, not a weekend project.',
          'Whichever method you use, use it consistently across the year.',
        ],
      },
      {
        h: 'A practical pattern',
        p: 'Many small businesses run cash-basis for tax and read an accrual view for management: "what did we earn this month, regardless of who has paid?" You do not need to change your official method to ask that question of your own numbers — you need disciplined invoice records.',
      },
    ],
    praktik:
      'Write down which method you are on today (cash unless an accountant told you otherwise), and one question you would rather answer the other way.',
    aksi: { halaman: 'dasbor', label: 'Back to the dashboard' },
  },

  {
    no: 104,
    sesi: 4,
    jalur: 'dasar',
    icon: '📊',
    judul: 'Read your P&L in five minutes',
    ringkas:
      'The income statement is one subtraction repeated three times. Learn the structure once and every P&L — yours, a client\'s, a lender\'s — reads the same.',
    menit: 12,
    isi: [
      {
        h: 'The shape of the statement',
        p: 'Sales, minus cost of goods sold, equals gross profit. Gross profit, minus operating expenses, equals operating profit. That is the whole skeleton. Everything else is detail hanging off those lines. Read top to bottom and ask one question at each subtraction: is this line pulling its weight?',
      },
      {
        h: 'Gross margin: the product verdict',
        p: 'Gross margin is gross profit as a percentage of sales. It answers "does the thing you sell make money before overhead?" Track it over months: a slowly shrinking gross margin is the earliest visible sign of rising supplier costs or quiet discounting — long before net profit notices.',
      },
      {
        h: 'Operating expenses: the overhead verdict',
        p: 'Operating expenses should be mostly fixed. When they grow as fast as sales, the business is buying its growth with overhead — sustainable only while sales keep climbing. Compare operating expenses as a percentage of sales month over month; the trend matters more than any single number.',
      },
      {
        h: 'Percentage, not just dollars',
        p: 'A $4,000 marketing spend means nothing alone. As 8% of $50,000 sales it is a decision; as 40% of $10,000 sales it is a problem. Every P&L line is more honest as a percentage of sales — that is what makes months of different sizes comparable.',
      },
    ],
    praktik: 'Open the financial report and find your gross margin for last month — the line above operating expenses.',
    aksi: { halaman: 'laporan', label: 'Open the report', terverifikasi: 'laporan' },
  },

  {
    no: 105,
    sesi: 5,
    jalur: 'dasar',
    icon: '🔁',
    judul: 'Reconciliation: making the books match the bank',
    ringkas:
      'Reconciliation is a five-minute monthly discipline that catches fat fingers, duplicate charges, and fraud — while they are still small.',
    menit: 12,
    isi: [
      {
        h: 'What reconciliation actually is',
        p: 'Line by line, confirm that what your books say matches what the bank and card statements say. Not "the totals are close" — each transaction, one at a time, until both sides agree. When they agree, you have proven your books describe real money.',
      },
      {
        h: 'Why totals are not enough',
        li: [
          'A $420 sale recorded as $240 lowers revenue invisibly — totals still look plausible.',
          'A duplicate charge or an unrecorded fee makes cash wrong in a direction you cannot guess.',
          'A transaction you never made is how fraud looks on day one. Reconciliation is how it gets seen on day one.',
        ],
      },
      {
        h: 'Timing differences are normal',
        p: 'A check written Thursday clears Tuesday. A card charge posts Monday for Friday\'s purchase. These are not errors — they are timing. The discipline: mark them, expect them to clear next statement, and investigate anything still unmatched two statements later.',
      },
      {
        h: 'A monthly rhythm',
        p: 'When each statement closes: open it next to your records, tick every matching transaction, chase every mismatch to its cause, and record bank fees you did not know about. Done monthly it is minutes; done yearly it is a forensic project nobody finishes.',
      },
    ],
    praktik: 'Open the multi-month report and compare its totals against one real statement — note anything unexplained.',
    aksi: { halaman: 'laporan', label: 'Open the report', terverifikasi: 'laporan' },
  },

  {
    no: 106,
    sesi: 6,
    jalur: 'dasar',
    icon: '🧾',
    judul: 'Expense discipline and the audit trail',
    ringkas:
      'Every dollar that leaves needs a business reason, a category, and a traceable record. That triple is what an auditor, a lender, or your future self actually needs.',
    menit: 12,
    isi: [
      {
        h: 'Ordinary and necessary',
        p: 'The US tax standard for a deductible business expense is two words long: ordinary (common in your industry) and necessary (helpful and appropriate for the business). The phrase is worth memorizing because it is a test you can apply at the register, not just at filing time.',
      },
      {
        h: 'Mixed-use costs',
        li: [
          'Home office, personal phone partly used for business, personal car doing business miles — these are split, not all-or-nothing.',
          'Keep the method boring and consistent: square footage for the office, a mileage log for the car.',
          'The record you keep through the year is the deduction you can defend in an audit. April is too late to reconstruct July.',
        ],
      },
      {
        h: 'The audit trail',
        p: 'An audit trail is the ability to answer "show me this number\'s origin" for any number in your books: the receipt behind the expense, the correction behind the odd month, the who-and-when behind every change. Systems that keep this trail make errors findable and honest; systems that overwrite history make every disagreement a matter of memory.',
      },
      {
        h: 'Corrections leave footprints',
        p: 'Wrong entry? Fix it with a visible correction, not a silent overwrite. A book where corrections are visible is more trustworthy than a book that pretends it was never wrong — that is as true for a lender reading your reports as for an IRS examiner reading your return.',
      },
    ],
    praktik:
      'Record one expense with a note a stranger could understand in a year — what it bought, and which job or product it belonged to.',
    aksi: { halaman: 'kas', label: 'Record a documented expense', terverifikasi: 'transaksi' },
  },

  {
    no: 107,
    sesi: 7,
    jalur: 'dasar',
    icon: '🗓️',
    judul: 'The month-end close: a checklist that shrinks',
    ringkas:
      'Closing the month is how numbers become statements. A fixed checklist makes it boring — and boring is exactly what accounting close should be.',
    menit: 12,
    isi: [
      {
        h: 'What "closing" means',
        p: 'A close is a deliberate end-of-month pass: every transaction recorded, every bank and card account reconciled, every category reviewed for landings that look wrong, and the month locked so later changes cannot silently rewrite history. After a close, the month\'s P&L is a statement — not a draft.',
      },
      {
        h: 'A starter checklist',
        li: [
          'All transactions entered through the last day of the month.',
          'Bank, card, and payment-processor accounts reconciled to statements.',
          'Category scan: sort each category by amount and read the top and the odd ones.',
          'No unexplained negatives, no duplicate-looking pairs, no transactions dated in the wrong month.',
          'Lock the month. Corrections after the lock get their own visible entry in the next month.',
        ],
      },
      {
        h: 'The category scan',
        p: 'The highest-value five minutes of the close: sort each expense category by size and read it. Big items belong; strange items get a note. Human eyes on a sorted list catch what no formula does — the $340 "office supply" that was actually a personal purchase, the supplier charged twice in one week.',
      },
      {
        h: 'Why close at all?',
        p: 'An unclosed book is a living document that changes under your feet — comparisons drift, and nobody can say which version of March was real. The close is a promise: these numbers are now stable, and everything built on them (score, trends, loan conversations, tax estimates) stands on fixed ground.',
      },
    ],
    praktik: 'Open the report for the most recent complete month and do one category scan — sort a category and read its top five.',
    aksi: { halaman: 'laporan', label: 'Open the report', terverifikasi: 'laporan' },
  },

  /* ================================================================
     OPERATE — angka yang lebih dalam
     ================================================================ */

  {
    no: 108,
    sesi: null,
    jalur: 'lanjutan',
    icon: '🤝',
    judul: 'Payables, receivables, and the three-way match',
    ringkas:
      'Who owes you, who you owe, and the check that stops paying for things you never ordered.',
    menit: 12,
    isi: [
      {
        h: 'Two clocks worth watching',
        p: 'Accounts receivable is money customers owe you; accounts payable is money you owe suppliers. Neither shows up in a cash-basis P&L until paid — yet both decide when cash actually arrives. A business can be profitable on paper and steered into the wall by slow receivables.',
      },
      {
        h: 'The three-way match',
        p: 'Before paying a supplier invoice, match three documents: the purchase order (what you asked for), the receiving record (what actually arrived), and the invoice (what they billed). All three agree → pay. Any leg disagrees → hold. This single habit eliminates duplicate payments, wrong-price charges, and bills for goods never delivered — the most common leaks in small-business payables.',
      },
      {
        h: 'Aging: the honest view',
        p: 'List receivables by how long unpaid: current, 1–30, 31–60, 60+ days. The total matters less than the shape — a receivables pile aging past 60 days is a collections problem wearing an asset\'s clothes. Same view on payables tells you which suppliers are about to stop shipping.',
      },
      {
        h: 'Two ratios that summarize it',
        li: [
          'Days sales outstanding (DSO): average days from invoice to payment. Rising DSO means you are financing your customers.',
          'Days payable outstanding (DPO): average days you take to pay. Stretching it helps cash; stretching it too far costs terms and goodwill.',
        ],
      },
    ],
    praktik: 'List every customer who owes you money right now, with the invoice date — that list is your receivables aging.',
    aksi: { halaman: 'laporan', label: 'Check the report' },
  },

  {
    no: 109,
    sesi: null,
    jalur: 'lanjutan',
    icon: '📮',
    judul: '1099s and contractors: who gets which form',
    ringkas:
      'Hire contractors and a second tax calendar starts running: W-9s up front, 1099-NEC in January, and the employee-versus-contractor line drawn honestly.',
    menit: 11,
    isi: [
      {
        h: 'W-9 before the first invoice',
        p: 'Before paying any US contractor, collect a signed W-9 (name, TIN, entity type). Collecting it later is collecting it never — the contractor has moved, or the check is disputed, and January finds you without the paperwork. Up front, it takes thirty seconds.',
      },
      {
        h: '1099-NEC: the January obligation',
        li: [
          'Generally required for each contractor paid $600 or more in the year (payments by card/processor are reported by the processor instead — on the 1099-K track).',
          'Deadlines are early: copies to contractors and the IRS by the end of January.',
          'The W-9 you collected is exactly the data the 1099 needs. This is the whole trick.',
        ],
      },
      {
        h: 'Contractor or employee?',
        p: 'The question is behavioral control, financial control, and the relationship — who directs how the work is done, who supplies tools, whether the work is the core of the business. Misclassification is expensive (back payroll taxes plus penalties) and the lines are factual, not a matter of what the contract calls the person. When the answer is genuinely unclear, that is an accountant or lawyer question.',
      },
      {
        h: 'The 1099-K side of the world',
        p: 'Payment apps and marketplaces (card processors, gig platforms) report what they paid you on a 1099-K. For 2026 the reporting threshold is back at $20,000 and 200 transactions — but reported or not, all business income is taxable. Reconcile the 1099-K against your books; the processor\'s gross can include fees and refunds you never saw as income.',
      },
    ],
    praktik: 'Make the list: every contractor you paid this year, whether you hold their W-9, and the running total.',
    aksi: { halaman: 'dasbor', label: 'Back to the dashboard' },
  },

  {
    no: 110,
    sesi: null,
    jalur: 'lanjutan',
    icon: '🎯',
    judul: 'Budget vs actuals: variance that means something',
    ringkas:
      'A budget is a hypothesis. The monthly variance read is the experiment — and the fastest teacher in management accounting.',
    menit: 10,
    isi: [
      {
        h: 'Build the budget from the P&L',
        p: 'Last year (or last six months) by category, adjusted for what you already decided: the new hire, the price increase, the marketing push. A budget copied blindly from history is a calendar, not a plan; a budget with your decisions priced in is a commitment you can check.',
      },
      {
        h: 'Reading variance',
        li: [
          'Favorable/unfavorable is not the same as good/bad — under-spending on marketing that stalled sales is an unfavorable favorable.',
          'Set a threshold (for example, investigate anything off by more than 10% or $500 — whichever you notice) and read only those lines.',
          'Write one sentence per investigated variance: the cause, and whether it repeats.',
        ],
      },
      {
        h: 'Cadence beats precision',
        p: 'A rough budget read every month beats a perfect budget read never. Twenty minutes: actuals beside budget, the three biggest gaps, one sentence each, one decision or question each. Variance review is where accounting turns back into management.',
      },
      {
        h: 'Rolling forecast',
        p: 'Once the rhythm holds, stop treating the budget as a yearly document: re-project the remaining months with what you now know. The budget is the plan as announced; the rolling forecast is the plan as believed. The gap between them is the most honest strategy conversation a small business can have with itself.',
      },
    ],
    praktik: 'Write your expected totals for next month — sales and three expense categories — and park them where you will see them.',
    aksi: { halaman: 'laporan', label: 'Open the report' },
  },

  /* ================================================================
     GROW — kas yang bertahan
     ================================================================ */

  {
    no: 111,
    sesi: null,
    jalur: 'tumbuh',
    icon: '🛫',
    judul: 'Cash flow and runway',
    ringkas:
      'Profit is an opinion; cash is a fact. Runway is the number of months that fact keeps the doors open.',
    menit: 12,
    isi: [
      {
        h: 'Profitable and broke at the same time',
        p: 'You invoice on net-30, suppliers want payment in 15, payroll is weekly. Every new sale makes the squeeze tighter until the customer pays. Growth consumes cash before it produces it — which is why fast-growing profitable businesses fail more often than slow unprofitable ones.',
      },
      {
        h: 'The 13-week cash flow',
        p: 'The standard small-business survival tool: a spreadsheet of the next 13 weeks, opening cash plus every expected receipt minus every expected payment, week by week. It is not a forecast of profit — it is a forecast of the bank balance. Any week that dips below your safety line is visible three months out, while there is still time to act.',
      },
      {
        h: 'Runway, one division',
        p: 'Runway = cash on hand ÷ average monthly cash burn. Six months of runway buys strategy; six weeks buys only tactics. Recompute it monthly — the trend (extending or shrinking) matters more than the level.',
      },
      {
        h: 'Levers, in order of speed',
        li: [
          'Collect faster: shorter terms, deposits up front, a weekly receivables ritual.',
          'Pay on your terms, not early — without straining supplier goodwill.',
          'Move fixed costs to variable (space, subscriptions, staffing) so the burn bends when revenue does.',
        ],
      },
    ],
    praktik: 'Compute today\'s runway: cash on hand ÷ average monthly cash burn from your last three complete months.',
    aksi: { halaman: 'laporan', label: 'Open the report' },
  },

  {
    no: 112,
    sesi: null,
    jalur: 'tumbuh',
    icon: '🗺️',
    judul: 'Sales tax nexus: when other states start counting',
    ringkas:
      'Sell enough into a state and its sales tax becomes your problem. Nexus rules are numeric — which means they are plannable.',
    menit: 10,
    isi: [
      {
        h: 'What nexus is',
        p: 'Nexus is the connection that makes a state allowed to require you to collect its sales tax. Physical presence (an office, an employee, inventory in a warehouse) has always created it. Since 2018, selling enough into a state creates it too — without any physical presence at all.',
      },
      {
        h: 'Economic nexus, the numbers',
        li: [
          'The common threshold: $100,000 of sales into a state, or 200 separate transactions, in a year. Most states now use some version of it.',
          'Some big states set higher bars (for example $500,000) — the direction is higher, not lower.',
          'Thresholds count sales INTO the state by buyers located there — cross the line and registration duties generally start the NEXT sale.',
        ],
      },
      {
        h: 'Product taxability is its own question',
        p: 'Registered in a state does not tell you what to tax: goods, services, software, and digital products are taxed differently state by state, and the same item can be taxable in one state and exempt next door. Automating calculation is normal once you cross a few thresholds; the discipline that matters first is watching the numbers.',
      },
      {
        h: 'The discipline',
        p: 'One report, run quarterly: sales by state. Crossing a threshold is not a crisis — it is a known, dated event with a checklist (register, set up collection, file returns). What hurts is discovering two years of uncollected tax after a state notice; that bill comes with penalties and interest attached.',
      },
    ],
    praktik: 'Run the count: total sales into each US state this year — your top five states and whether any approaches $100,000.',
    aksi: { halaman: 'laporan', label: 'Open the report' },
  },

  /* ================================================================
     GOVERN — kontrol & kepercayaan
     ================================================================ */

  {
    no: 113,
    sesi: null,
    jalur: 'modal',
    icon: '🛡️',
    judul: 'Internal controls and segregation of duties',
    ringkas:
      'The person who approves a payment should not be the only person who records it. Controls are how a business stays honest — including with itself.',
    menit: 12,
    isi: [
      {
        h: 'Why controls exist',
        p: 'Most small-business loss is not a stranger with a laptop; it is an unwatched routine. Controls are structural habits that make error and self-dealing visible: not because people are bad, but because good systems do not depend on people being good. The same controls that catch fraud also catch typos — and typos are far more common.',
      },
      {
        h: 'Segregation of duties, the three roles',
        li: [
          'Authorization — who approves the payment or the purchase.',
          'Custody — who physically moves the money or holds the asset.',
          'Recording — who enters the transaction in the books.',
          'One person holding all three roles is the definition of an uncontrolled process.',
        ],
      },
      {
        h: 'Small-team workarounds',
        li: [
          'Owner does the books? Then someone else reviews the monthly statement — an accountant, a partner, even a quarterly self-review with the statements printed.',
          'Two-person rule above a threshold: no payment over $X moves without a second pair of eyes.',
          'Separate duties in time when you cannot separate them in people: record on Monday, reconcile on Friday — the delay itself catches errors.',
        ],
      },
      {
        h: 'The audit trail is the control that scales',
        p: 'Every approval, correction, and change stamped with who and when: that is what makes all the other controls checkable. An append-only trail turns "trust me" into "look". It is also the artifact an external audit, a lender\'s due diligence, or a SOC 2 review asks for first — building it from day one is cheaper than reconstructing it under deadline.',
      },
    ],
    praktik: 'Pick one payment path in your business and name the person (or hour) for each of the three roles — including yourself.',
    aksi: { halaman: 'dasbor', label: 'Back to the dashboard' },
  },
];

/* ------------------------------------------------------------------ Turunan */

/** Modul jalur dasar, urut sesi 1-7. Inilah jalur inti yang dibuka satu per hari. */
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
 * Tanpa ini, AI tidak tahu pengguna sedang di sesi keberapa — dan bisa
 * mengarahkan pengguna sesi ketiga ke materi jauh di depan, atau tidak bisa
 * mengaitkan jawabannya dengan materi yang sedang dipelajari hari itu.
 *
 * Harganya ~40 token per pertanyaan.
 */
export function ringkasKemajuan(done = {}) {
  const sudah = (m) => Boolean(done?.[m.no]);
  const sesiSelesai = SESI_HARIAN.filter(sudah);
  const berikut = SESI_HARIAN.find((m) => !sudah(m)) ?? null;
  const pustakaSelesai = KURIKULUM.filter((m) => m.sesi == null && sudah(m));

  const baris = [`- Daily sessions: ${sesiSelesai.length} of ${SESI_HARIAN.length} completed.`];

  if (berikut) {
    baris.push(`- Current session: session ${berikut.sesi} — "${berikut.judul}" (module ${berikut.no}).`);
  } else {
    baris.push('- All daily sessions completed; the library paths are open for reading in any order.');
  }

  if (pustakaSelesai.length) {
    baris.push(`- Library modules already read: ${pustakaSelesai.map((m) => m.no).join(', ')}.`);
  }

  return `LEARNING PROGRESS\n${baris.join('\n')}`;
}

/**
 * Materi lengkap satu modul, untuk disisipkan saat pengguna bertanya DARI
 * DALAM modul itu.
 *
 * Hanya dikirim untuk pertanyaan yang memang berasal dari halaman modul, bukan
 * pada tiap percakapan: satu modul berharga ~700 token, dan mengirim semuanya
 * setiap kali menghabiskan anggaran harian dalam dua pertanyaan.
 *
 * Tanpa materinya, model menjawab dari pengetahuannya sendiri, dan
 * penjelasannya bisa berbeda — bahkan bertentangan — dengan yang baru saja
 * dibaca pengguna di layar yang sama.
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

  const label = m.sesi != null ? `Module ${m.no} (daily session ${m.sesi})` : `Module ${m.no}`;

  return `MODULE MATERIAL CURRENTLY OPEN
${label}: ${m.judul}
${m.ringkas}

${bagian}

Practice this module asks for: ${m.praktik}`;
}

/**
 * Daftar modul untuk prompt AI — nomor + judul saja, dikelompokkan per jalur.
 *
 * Bentuknya sengaja sekurus ini. Daftar ini duduk di blok system prompt dan ikut
 * terkirim pada SETIAP pertanyaan, jadi setiap kata di sini dibayar berulang
 * kali dan ikut memakan anggaran token harian pengguna. Judul saja
 * (~345 token) cukup: model tidak perlu tahu ISI modul untuk menyebut nomor
 * yang tepat, ia hanya perlu tahu modul apa saja yang ada. Pengelompokan per
 * jalur ikut disertakan karena harganya hampir nol dan menjawab satu hal yang
 * tidak bisa disimpulkan dari judul: mana yang sesi harian, mana pustaka.
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
