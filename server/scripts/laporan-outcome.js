#!/usr/bin/env node
/**
 * Laporan kualitas outcome advisori — READ-ONLY, dari data evaluasi Sesi G.
 *
 * ------------------------------------------------------------------
 * KENAPA BERKAS INI ADA
 *
 * Checkpoint advisori (Sesi G fase 2) menilai tiap nasihat rekomendasi pada
 * bulan berikutnya: membaik / tetap / memburuk per dimensi (laba bersih,
 * margin bersih, saldo kas) — atau `tak-terukur` dengan sebabnya. Angka itu
 * tersebar di `user.evaluasiAdvisori`; sampai laporan ini ada, pertanyaan
 * riset paling dasar — "apakah nasihat aplikasi ini diikuti keadaan usaha
 * yang lebih baik?" — harus dijawab dengan membongkar JSON per peserta.
 *
 * Skrip ini membaca `users.json` LANGSUNG lewat fs, TANPA mengimpor
 * lib/store.js — mustahil memicu seed, tulisan, atau antrean apa pun. Ia
 * tidak pernah menulis: satu-satunya keluaran adalah layar (dan `--json`
 * untuk alat lain). Laporan, bukan gerbang: exit 0 selama data terbaca;
 * nonzero hanya bila berkas tidak ada/rusak.
 *
 * Batas yang dihormati (bukan bug): arah "membaik/memburuk" adalah KORELASI
 * bulan-ke-bulan, bukan atribusi kausal — nasihat yang baik pada bulan
 * kelam tetap tercatat "memburuk". Laporan ini menyajikan distribusi, dan
 * menolak menyimpulkan sebab-akibat; penafsirannya milik riset manusia.
 *
 * Pemakaian:
 *   node scripts/laporan-outcome.js            # tabel ke layar
 *   node scripts/laporan-outcome.js --json     # satu obyek JSON
 *   NOVA_DATA_DIR=/lain node scripts/laporan-outcome.js
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(fileURLToPath(import.meta.url));
const DIR_DATA = process.env.NOVA_DATA_DIR ?? path.join(AKAR, '..', 'data');
const DIMENSI = ['labaBersih', 'marginBersih', 'saldoKas'];
const ARAH = ['membaik', 'tetap', 'memburuk'];

const kosong = () => ({
  perDimensi: Object.fromEntries(DIMENSI.map((d) => [d, { membaik: 0, tetap: 0, memburuk: 0, takTerukur: 0 }])),
  takTerukurSebab: {},
  status: { terukur: 0, takTerukur: 0 },
  evaluasi: 0,
});

let db;
try {
  db = JSON.parse(await readFile(path.join(DIR_DATA, 'users.json'), 'utf8'));
} catch (err) {
  console.error(`Tidak bisa membaca ${path.join(DIR_DATA, 'users.json')}: ${err.message}`);
  console.error('Skrip ini read-only dan tidak membuat toko baru — jalankan di lingkungan yang punya data.');
  process.exit(1);
}
if (!Array.isArray(db.users)) {
  console.error('Bentuk users.json tidak dikenali (tidak ada array users).');
  process.exit(1);
}

/* -------------------------------------------------------------- Agregasi */

const perJenis = { rekomendasi: kosong(), checkup: kosong() };
const perBatch = {};
const tanpaJenis = kosong();
let penggunaDenganEvaluasi = 0;

for (const u of db.users) {
  const evaluasi = u.evaluasiAdvisori ?? [];
  if (!evaluasi.length) continue;
  penggunaDenganEvaluasi += 1;
  const batch = u.batch ?? '(tanpa batch)';
  perBatch[batch] ??= kosong();

  for (const e of evaluasi) {
    // Jenis evaluasi dibawa rekamnya sendiri (dasar evaluasi menyalin jenis
    // advisori); bila lenyap (data lama), jatuh ke keranjang terpisah —
    // jangan menebak.
    const wadah = perJenis[e.jenis] ?? tanpaJenis;
    for (const w of [wadah, perBatch[batch]]) {
      w.evaluasi += 1;
      w.status[e.status === 'terukur' ? 'terukur' : 'takTerukur'] += 1;
    }
    if (e.status !== 'terukur') {
      const sebab = e.sebab ?? '(tanpa sebab)';
      for (const w of [wadah, perBatch[batch]]) w.takTerukurSebab[sebab] = (w.takTerukurSebab[sebab] ?? 0) + 1;
      continue;
    }
    for (const d of DIMENSI) {
      const arah = e.dimensi?.[d]?.status;
      for (const w of [wadah, perBatch[batch]]) {
        if (ARAH.includes(arah)) w.perDimensi[d][arah] += 1;
        else w.perDimensi[d].takTerukur += 1;
      }
    }
  }
}

const totalEvaluasi = Object.values(perJenis).reduce((n, w) => n + w.evaluasi, 0) + tanpaJenis.evaluasi;

/* --------------------------------------------------------------- Laporan */

const persen = (n, t) => (t ? `${((100 * n) / t).toFixed(1)}%` : '—');
const baris = (label, w) => {
  const t = Object.values(w.perDimensi.labaBersih).reduce((a, b) => a + b, 0);
  console.log(`\n  ${label} — ${w.evaluasi} evaluasi (terukur: ${w.status.terukur}, tak-terukur: ${w.status.takTerukur})`);
  for (const d of DIMENSI) {
    const m = w.perDimensi[d];
    const td = m.membaik + m.tetap + m.memburuk;
    console.log(
      `    ${d.padEnd(12)} membaik ${String(m.membaik).padStart(4)} (${persen(m.membaik, td)})   tetap ${String(m.tetap).padStart(4)}   memburuk ${String(m.memburuk).padStart(4)} (${persen(m.memburuk, td)})   tak-terukur-dimensi ${m.takTerukur}`,
    );
  }
  const sebab = Object.entries(w.takTerukurSebab).sort((a, b) => b[1] - a[1]);
  if (sebab.length) {
    console.log('    sebab tak-terukur:');
    for (const [s, n] of sebab.slice(0, 5)) console.log(`      ${String(n).padStart(4)} × ${s}`);
  }
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    alat: 'laporan-outcome', dibacaDari: path.join(DIR_DATA, 'users.json'),
    totalEvaluasi, penggunaDenganEvaluasi,
    perJenis, tanpaJenis, perBatch,
    batas: 'korelasi bulan-ke-bulan, bukan atribusi kausal',
  }, null, 2));
} else {
  console.log(`\nlaporan-outcome — kualitas outcome advisori (read-only)`);
  console.log(`  sumber: ${path.join(DIR_DATA, 'users.json')} — ${db.users.length} pengguna, ${penggunaDenganEvaluasi} dengan evaluasi, ${totalEvaluasi} evaluasi`);
  if (!totalEvaluasi) {
    console.log('\n  Belum ada data evaluasi advisori. Checkpoint (Sesi G fase 2) terbentuk');
    console.log('  otomatis saat riwayat/fokus dibaca, setelah bulan periksa lewat penuh.');
  }
  for (const [jenis, w] of Object.entries(perJenis)) if (w.evaluasi) baris(`jenis: ${jenis}`, w);
  if (tanpaJenis.evaluasi) baris('jenis: (tak tercatat pada rekam lama)', tanpaJenis);
  const batchAda = Object.entries(perBatch).filter(([, w]) => w.evaluasi);
  if (batchAda.length > 1) {
    console.log('\n  per batch (jumlah evaluasi / terukur):');
    for (const [b, w] of batchAda) console.log(`    ${b.padEnd(12)} ${w.evaluasi} / ${w.status.terukur}`);
  }
  console.log('\n  Catatan: arah membaik/memburuk adalah korelasi bulan-ke-bulan, bukan');
  console.log('  atribusi kausal — jangan disimpulkan "nasihatnya berhasil/gagal" dari sini.\n');
}
