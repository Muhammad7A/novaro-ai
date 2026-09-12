#!/usr/bin/env node
/**
 * Harness regresi prompt advisori — pembanding deterministik atas golden set.
 *
 * ------------------------------------------------------------------
 * KENAPA BERKAS INI ADA
 *
 * Prompt (lib/prompts.js) dan pembersih (lib/rekomendasi.js, lib/checkup.js)
 * adalah SATU kontrak dua muka: skema yang dijanjikan prompt ke penyedia, dan
 * bentuk yang dijamin pembersih ke penyimpanan. Kontrak itu selama ini hanya
 * diuji dari sisi pembersih (uji unit per aturan). Yang belum ada adalah
 * rekam bentuk LENGKAP lintas profil warung: bila prompt berubah (medan baru,
 * batas baru, nada baru), tidak ada yang bilang "keluaran yang diharapkan
 * bergeser dari sini ke situ".
 *
 * Harness ini mengisi itu — TANPA memanggil AI. Golden set
 * (scripts/fixtures/golden-advisori.json) berisi bentuk mentah penyedia yang
 * anonim-sintetis lintas profil warung; `diharapkan` di dalamnya dihitung dari
 * batas SPESIFIKASI (konstanta di bawah, BUKAN impor pembersih) sehingga ia
 * oracle independen: bila pembersih bergeser dari spesifikasi, di sini
 * terlihat sebagai diff, bukan sebagai kebetulan hijau.
 *
 * ------------------------------------------------------------------
 * KONVENSI (dicatat juga di BASELINE.md)
 *
 *   Setiap perubahan server/lib/prompts.js WAJIB menjalankan:
 *
 *     cd server && node scripts/eval-advisori.js --simpan
 *
 *   dan melampirkan artefak hasilnya (test_reports/eval-advisori-<tanggal>.json)
 *   pada pesan commit / PR. Harness ini DI LUAR lantai CI (`npm test` tidak
 *   menjalankannya): ia gerbang operator atas kontrak prompt, bukan gerbang
 *   mesin atas kode. Keluar exit 1 bila ada satu pun kasus gagal.
 *
 * Pemakaian:
 *   node scripts/eval-advisori.js            # jalankan, skor + diff ke layar
 *   node scripts/eval-advisori.js --simpan   # + artefak JSON bertanggal
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sanitasiRekomendasi } from '../lib/rekomendasi.js';
import { sanitasiCheckup } from '../lib/checkup.js';

const AKAR = path.dirname(fileURLToPath(import.meta.url));

/*
 * Batas SPESIFIKASI — sama dengan yang dipakai generator golden set, dan
 * sengaja TIDAK diimpor dari pembersih. Dua sumber yang sama adalah salinan
 * yang bisa saling tertinggal; di sini justru itu gunanya: bila pembersih
 * berubah tanpa spesifikasi (atau sebaliknya), harness berteriak.
 */
const BATAS = {
  rekomendasi: {
    ringkasanCap: 600, judulCap: 80, alasanCap: 400, dampakCap: 200,
    langkahCap: 200, langkahMaks: 4, itemMaks: 5,
    peringatanCap: 200, peringatanMaks: 5, targetCap: 200, targetMaks: 3,
    prioritasSah: new Set(['tinggi', 'sedang', 'rendah']), modulMin: 1, modulMaks: 32,
  },
  checkup: { itemMaks: 6, teksCap: 200, insightCap: 400, tipeSah: new Set(['ok', 'perhatian']) },
};

/* Kosakata aturan yang WAJIB tercakup golden set — peta liputan adversarial. */
const DAFTAR_ATURAN = [
  'lolos-utuh', 'potong-ringkasan-600', 'potong-judul-80', 'potong-alasan-400',
  'potong-dampak-200', 'potong-langkah-200', 'maks-4-langkah', 'maks-5-rekomendasi',
  'maks-5-peringatan', 'potong-peringatan-200', 'maks-3-target', 'potong-target-200',
  'buang-hantu', 'prioritas-tengah', 'modul-rentang', 'langkah-kosong-dibuang',
  '502-rekomendasi-kosong', '502-bukan-obyek', '502-ringkasan-kosong', 'medan-asing-dibuang',
  'elemen-bukan-obyek', 'langkah-bukan-daftar', 'batas-presisi',
  'potong-insight-400', 'tipe-jatuh-perhatian', 'maks-6-item', 'teks-kosong-dibuang',
  'potong-teks-200', '502-item-kosong', '502-insight-kosong',
];

/* ---------------------------------------------------------------- */

/** Diff rekursif sederhana: daftar {jalur, harapan, nyata}, maks 8 entri. */
function beda(harapan, nyata, jalur = '$', keluar = []) {
  if (keluar.length >= 8) return keluar;
  if (harapan === nyata) return keluar;
  const th = typeof harapan, tn = typeof nyata;
  if (th !== tn || harapan === null || nyata === null || th !== 'object') {
    keluar.push({ jalur, harapan, nyata }); return keluar;
  }
  const kunci = new Set([...Object.keys(harapan), ...Object.keys(nyata)]);
  for (const k of kunci) {
    if (!(k in harapan)) keluar.push({ jalur: `${jalur}.${k}`, harapan: '<tidak ada>', nyata: nyata[k] });
    else if (!(k in nyata)) keluar.push({ jalur: `${jalur}.${k}`, harapan: harapan[k], nyata: '<tidak ada>' });
    else beda(harapan[k], nyata[k], `${jalur}.${k}`, keluar);
    if (keluar.length >= 8) return keluar;
  }
  return keluar;
}

/** Bukti bentuk: invarian struktur keluaran pembersih, diperiksa terpisah dari diff. */
function buktiBentuk(jenis, hasil) {
  const pelanggaran = [];
  if (hasil == null || typeof hasil !== 'object' || Array.isArray(hasil)) {
    return ['keluaran bukan obyek'];
  }
  if (jenis === 'rekomendasi') {
    const B = BATAS.rekomendasi;
    const kunci = Object.keys(hasil).sort().join(',');
    if (kunci !== 'peringatan,rekomendasi,ringkasan,targetBulanIni') {
      pelanggaran.push(`medan teratas menyimpang: [${kunci}]`);
    }
    if (typeof hasil.ringkasan !== 'string' || hasil.ringkasan.length > B.ringkasanCap) {
      pelanggaran.push(`ringkasan melebihi ${B.ringkasanCap}`);
    }
    if (!Array.isArray(hasil.rekomendasi) || hasil.rekomendasi.length > B.itemMaks || hasil.rekomendasi.length === 0) {
      pelanggaran.push(`jumlah rekomendasi di luar 1..${B.itemMaks}`);
    } else {
      hasil.rekomendasi.forEach((r, i) => {
        const k = Object.keys(r).sort().join(',');
        if (k !== 'alasan,dampak,judul,langkah,modulTerkait,prioritas') {
          pelanggaran.push(`rekomendasi[${i}] medan menyimpang: [${k}]`);
        }
        if (String(r.judul).length > B.judulCap) pelanggaran.push(`rekomendasi[${i}].judul > ${B.judulCap}`);
        if (String(r.alasan).length > B.alasanCap) pelanggaran.push(`rekomendasi[${i}].alasan > ${B.alasanCap}`);
        if (String(r.dampak).length > B.dampakCap) pelanggaran.push(`rekomendasi[${i}].dampak > ${B.dampakCap}`);
        if (r.langkah.length > B.langkahMaks) pelanggaran.push(`rekomendasi[${i}].langkah > ${B.langkahMaks} butir`);
        r.langkah.forEach((s, j) => { if (s.length > B.langkahCap) pelanggaran.push(`rekomendasi[${i}].langkah[${j}] > ${B.langkahCap}`); });
        if (!B.prioritasSah.has(r.prioritas)) pelanggaran.push(`rekomendasi[${i}].prioritas di luar kosakata`);
        const m = r.modulTerkait;
        if (!(m === null || (Number.isInteger(m) && m >= B.modulMin && m <= B.modulMaks))) {
          pelanggaran.push(`rekomendasi[${i}].modulTerkait bukan null/bilangan bulat ${B.modulMin}..${B.modulMaks}`);
        }
      });
    }
    if (hasil.peringatan.length > B.peringatanMaks) pelanggaran.push(`peringatan > ${B.peringatanMaks}`);
    hasil.peringatan.forEach((s, i) => { if (s.length > B.peringatanCap) pelanggaran.push(`peringatan[${i}] > ${B.peringatanCap}`); });
    if (hasil.targetBulanIni.length > B.targetMaks) pelanggaran.push(`targetBulanIni > ${B.targetMaks}`);
    hasil.targetBulanIni.forEach((s, i) => { if (s.length > B.targetCap) pelanggaran.push(`targetBulanIni[${i}] > ${B.targetCap}`); });
  } else {
    const B = BATAS.checkup;
    const kunci = Object.keys(hasil).sort().join(',');
    if (kunci !== 'insight,item') pelanggaran.push(`medan teratas menyimpang: [${kunci}]`);
    if (!Array.isArray(hasil.item) || hasil.item.length === 0 || hasil.item.length > B.itemMaks) {
      pelanggaran.push(`jumlah item di luar 1..${B.itemMaks}`);
    } else {
      hasil.item.forEach((it, i) => {
        const k = Object.keys(it).sort().join(',');
        if (k !== 'teks,tipe') pelanggaran.push(`item[${i}] medan menyimpang: [${k}]`);
        if (!B.tipeSah.has(it.tipe)) pelanggaran.push(`item[${i}].tipe di luar kosakata`);
        if (String(it.teks).length > B.teksCap) pelanggaran.push(`item[${i}].teks > ${B.teksCap}`);
      });
    }
    if (typeof hasil.insight !== 'string' || hasil.insight.length > B.insightCap) pelanggaran.push(`insight melebihi ${B.insightCap}`);
  }
  return pelanggaran;
}

/* ---------------------------------------------------------------- */

const fixture = JSON.parse(await readFile(path.join(AKAR, 'fixtures', 'golden-advisori.json'), 'utf8'));
const simpan = process.argv.includes('--simpan');

const hasilUji = [];
let lulus = 0;

for (const kasus of fixture.kasus) {
  const pembersih = kasus.jenis === 'rekomendasi' ? sanitasiRekomendasi : sanitasiCheckup;
  const rekam = { id: kasus.id, jenis: kasus.jenis, aturan: kasus.aturan, status: 'lulus', diff: [], bentuk: [] };

  try {
    const hasil = pembersih(kasus.mentah);
    if (kasus.galat) {
      rekam.status = 'gagal';
      rekam.diff.push({ jalur: '$', harapan: `galat ${kasus.galat}`, nyata: 'tidak melempar' });
    } else {
      const d = beda(kasus.diharapkan, hasil);
      if (d.length) { rekam.status = 'gagal'; rekam.diff = d; }
      rekam.bentuk = buktiBentuk(kasus.jenis, hasil);
      if (rekam.bentuk.length) rekam.status = 'gagal';
    }
  } catch (err) {
    const status = err?.status ?? 500;
    if (!kasus.galat || status !== kasus.galat) {
      rekam.status = 'gagal';
      rekam.diff.push({ jalur: '$', harapan: kasus.galat ? `galat ${kasus.galat}` : 'hasil sah', nyata: `galat ${status}: ${err?.message}` });
    }
  }

  if (rekam.status === 'lulus') lulus += 1;
  hasilUji.push(rekam);
}

/* Liputan aturan: setiap aturan kosakata wajib dipakai ≥1 kasus. */
const terpakai = new Set(hasilUji.flatMap((r) => r.aturan));
const takTerliput = DAFTAR_ATURAN.filter((a) => !terpakai.has(a));
const aturanAsing = [...terpakai].filter((a) => !DAFTAR_ATURAN.includes(a));
const gagal = hasilUji.filter((r) => r.status === 'gagal');

/* ---------------------------------------------------------------- Laporan */

const total = hasilUji.length;
console.log(`\neval-advisori — ${total} kasus (${fixture.kasus.filter((k) => k.jenis === 'rekomendasi').length} rekomendasi, ${fixture.kasus.filter((k) => k.jenis === 'checkup').length} checkup)\n`);
for (const r of hasilUji) {
  const tanda = r.status === 'lulus' ? '✔' : '✖';
  console.log(`  ${tanda} ${r.id.padEnd(4)} [${r.aturan.join(', ')}]`);
  for (const d of r.diff) {
    console.log(`      diff ${d.jalur}: harapan ${JSON.stringify(d.harapan).slice(0, 90)} != nyata ${JSON.stringify(d.nyata).slice(0, 90)}`);
  }
  for (const b of r.bentuk) console.log(`      bentuk: ${b}`);
}
console.log(`\nskor: ${lulus}/${total} lulus`);
console.log(`liputan aturan: ${DAFTAR_ATURAN.length - takTerliput.length}/${DAFTAR_ATURAN.length}${takTerliput.length ? ` — TAK TERLIPUT: ${takTerliput.join(', ')}` : ''}`);
if (aturanAsing.length) console.log(`aturan asing di fixture (tidak ada di kosakata harness): ${aturanAsing.join(', ')}`);

const ok = lulus === total && !takTerliput.length && !aturanAsing.length;

if (simpan) {
  const laporan = {
    alat: 'eval-advisori',
    versi: 1,
    dijalankan: new Date().toISOString(),
    fixture: 'scripts/fixtures/golden-advisori.json',
    skor: `${lulus}/${total}`,
    ok,
    liputan: { terliput: DAFTAR_ATURAN.length - takTerliput.length, total: DAFTAR_ATURAN.length, takTerliput, aturanAsing },
    kasus: hasilUji,
  };
  const dir = path.join(AKAR, '..', '..', 'test_reports');
  await mkdir(dir, { recursive: true });
  const berkas = path.join(dir, `eval-advisori-${new Date().toISOString().slice(0, 10)}.json`);
  await writeFile(berkas, JSON.stringify(laporan, null, 2) + '\n', 'utf8');
  console.log(`artefak: ${berkas}`);
}

console.log(ok ? '\nLULUS — kontrak prompt/advisori sesuai golden set.\n' : '\nGAGAL — ada diff/pelanggaran; jangan mengubah prompts.js tanpa menutup ini.\n');
process.exitCode = ok ? 0 : 1;
