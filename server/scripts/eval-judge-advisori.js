#!/usr/bin/env node
/**
 * Pendamping rubrik LLM-as-judge advisori — ALAT RISET, BUKAN GERBANG CI.
 *
 * ------------------------------------------------------------------
 * KENAPA BERKAS INI ADA
 *
 * Rubrik (judge-rubrik-advisori.md) menilai dua draft keluaran advisori
 * secara BUTA per kasus. Dua pekerjaan skrip ini:
 *
 *   --susun  menyusun paket penilaian: konteks kasus + dua naskah berlabel
 *            acak ("Naskah 1"/"Naskah 2") + rubrik terlampir, satu berkas
 *            markdown per kasus, plus kunci-acak.json (dibuka SETELAH vonis
 *            terkumpul).
 *   --hitung membuka kunci, memvalidasi vonis (layak/tak-layak + kutipan
 *            bukti), lalu menyusun MATRIKS PERSETUJUAN per dimensi:
 *            keduanya-layak / hanya-DraftA / hanya-DraftB / keduanya-tak-layak.
 *
 * Skrip ini TIDAK memanggil model apa pun: paket dinilai manusia memakai
 * LLM pilihannya di luar sini; hasilnya kembali sebagai JSONL. Laporan
 * TIDAK PERNAH satu angka — rubrik melarangnya, dan kode di bawah memang
 * tidak menghitungnya.
 *
 * Format berkas draft (A maupun B) — JSON array:
 *   [{ "id": "r01", "profil": "warung nasi", "situasi": "…",
 *      "jenis": "rekomendasi", "isi": { …keluaran pembersih… } }]
 *
 * Pemakaian:
 *   node scripts/eval-judge-advisori.js --susun --a a.json --b b.json --keluar dir/
 *   node scripts/eval-judge-advisori.js --hitung --hasil dir/hasil.jsonl --kunci dir/kunci-acak.json
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(fileURLToPath(import.meta.url));
const DIMENSI = ['kejujuran', 'kejelasan', 'konteks'];
const VONIS_SAH = new Set(['layak', 'tak-layak']);

const args = process.argv.slice(2);
const ambil = (nama) => {
  const i = args.indexOf(`--${nama}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};

const bacaJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const galatPakai = (pesan) => { console.error(`\nGALAT: ${pesan}\n`); process.exit(1); };

/* --------------------------------------------------------------- --susun */

async function susun() {
  const berkasA = ambil('a'), berkasB = ambil('b'), keluar = ambil('keluar');
  if (!berkasA || !berkasB || !keluar) galatPakai('--susun butuh --a, --b, --keluar');
  const a = await bacaJson(berkasA), b = await bacaJson(berkasB);
  if (!Array.isArray(a) || !Array.isArray(b)) galatPakai('berkas draft harus JSON array kasus');

  const petaB = new Map(b.map((k) => [k.id, k]));
  const kunci = {};
  await mkdir(keluar, { recursive: true });

  const rubrik = await readFile(path.join(AKAR, 'judge-rubrik-advisori.md'), 'utf8');
  let jumlah = 0;
  for (const kasus of a) {
    const pasangan = petaB.get(kasus.id);
    if (!pasangan) continue; // hanya kasus yang ada di KEDUA draft yang layak dibandingkan
    const naskah1Dulu = randomInt(2) === 0; // urutan buta, dikunci di kunci-acak.json
    const naskah = {
      'Naskah 1': naskah1Dulu ? kasus : pasangan,
      'Naskah 2': naskah1Dulu ? pasangan : kasus,
    };
    kunci[kasus.id] = { 'Naskah 1': naskah1Dulu ? 'A' : 'B', 'Naskah 2': naskah1Dulu ? 'B' : 'A' };

    const isiMd = (k) => '```json\n' + JSON.stringify(k.isi, null, 2) + '\n```';
    const paket = `# Paket penilaian — kasus ${kasus.id}

> ALAT RISET — BUKAN GERBANG CI. Nilai kedua naskah di bawah menurut rubrik
> terlampir. Satu paket = satu penilaian segar. Vonis wajib kutipan bukti.

## Konteks kasus

- Profil: ${kasus.profil}
- Situasi: ${kasus.situasi}
- Jenis advisori: ${kasus.jenis}

## Naskah 1

${isiMd(naskah['Naskah 1'])}

## Naskah 2

${isiMd(naskah['Naskah 2'])}

## Jawaban (satu JSON, simpan ke hasil.jsonl)

${'```'}json
{
  "kasus": "${kasus.id}",
  "naskah1": {
${DIMENSI.map((d) => `    "${d}": "layak|tak-layak", "${d}Bukti": "kutipan"`).join(',\n')}
  },
  "naskah2": {
${DIMENSI.map((d) => `    "${d}": "layak|tak-layak", "${d}Bukti": "kutipan"`).join(',\n')}
  },
  "catatan": ""
}
${'```'}

---

## Rubrik (dibawa sekalian supaya paket berdiri sendiri)

${rubrik}
`;
    await writeFile(path.join(keluar, `paket-${kasus.id}.md`), paket, 'utf8');
    jumlah += 1;
  }
  await writeFile(path.join(keluar, 'kunci-acak.json'), JSON.stringify({ dibuat: new Date().toISOString(), kunci }, null, 2) + '\n', 'utf8');
  console.log(`\n${jumlah} paket tersusun di ${keluar} + kunci-acak.json (jangan dibuka sebelum vonis lengkap).\n`);
}

/* -------------------------------------------------------------- --hitung */

async function hitung() {
  const berkasHasil = ambil('hasil'), berkasKunci = ambil('kunci');
  if (!berkasHasil || !berkasKunci) galatPakai('--hitung butuh --hasil, --kunci');
  const baris = (await readFile(berkasHasil, 'utf8')).split('\n').filter((l) => l.trim());
  const { kunci } = await bacaJson(berkasKunci);

  const matriks = Object.fromEntries(DIMENSI.map((d) => [d, { keduanyaLayak: 0, hanyaDraftA: 0, hanyaDraftB: 0, keduanyaTakLayak: 0 }]));
  const divergen = [];
  const ditolak = [];
  let sah = 0;

  for (const barisSatu of baris) {
    let v;
    try { v = JSON.parse(barisSatu); } catch { ditolak.push({ baris: barisSatu.slice(0, 60), sebab: 'bukan JSON' }); continue; }
    const petak = kunci[v.kasus];
    if (!petak) { ditolak.push({ kasus: v.kasus, sebab: 'kasus tidak ada di kunci' }); continue; }

    // Validasi vonis: dua naskah × tiga dimensi, kata layak/tak-layak, bukti terisi.
    let valid = true;
    for (const n of ['naskah1', 'naskah2']) {
      for (const d of DIMENSI) {
        if (!VONIS_SAH.has(v[n]?.[d]) || typeof v[n]?.[`${d}Bukti`] !== 'string' || !v[n][`${d}Bukti`].trim()) valid = false;
      }
    }
    if (!valid) { ditolak.push({ kasus: v.kasus, sebab: 'vonis tidak sah / bukti kosong (rubrik §4-§6)' }); continue; }
    sah += 1;

    for (const d of DIMENSI) {
      const aLayak = v[petak['Naskah 1'] === 'A' ? 'naskah1' : 'naskah2'][d] === 'layak';
      const bLayak = v[petak['Naskah 1'] === 'B' ? 'naskah1' : 'naskah2'][d] === 'layak';
      const sel = aLayak && bLayak ? 'keduanyaLayak' : aLayak && !bLayak ? 'hanyaDraftA' : !aLayak && bLayak ? 'hanyaDraftB' : 'keduanyaTakLayak';
      matriks[d][sel] += 1;
      if (sel === 'hanyaDraftA' || sel === 'hanyaDraftB') {
        divergen.push({ kasus: v.kasus, dimensi: d, arah: sel, catatan: v.catatan ?? '' });
      }
    }
  }

  console.log('\neval-judge-advisori — matriks persetujuan antar-draft');
  console.log('(ALAT RISET; tidak ada angka tunggal, rubrik melarangnya)\n');
  for (const d of DIMENSI) {
    const m = matriks[d];
    console.log(`  ${d}:`);
    console.log(`    keduanya layak    ${m.keduanyaLayak}`);
    console.log(`    hanya Draft A     ${m.hanyaDraftA}`);
    console.log(`    hanya Draft B     ${m.hanyaDraftB}`);
    console.log(`    keduanya tak-layak ${m.keduanyaTakLayak}`);
  }
  if (divergen.length) {
    console.log('\n  Divergensi (bagian terpenting — periksa dengan mata manusia):');
    for (const x of divergen) console.log(`    ${x.kasus} · ${x.dimensi} · ${x.arah}${x.catatan ? ` — ${x.catatan}` : ''}`);
  }
  if (ditolak.length) {
    console.log(`\n  ${ditolak.length} baris DIBUANG (vonis tidak sah):`);
    for (const x of ditolak) console.log(`    ${x.kasus ?? x.baris}: ${x.sebab}`);
  }
  console.log(`\n  kasus sah: ${sah} dari ${baris.length} baris\n`);
}

/* ------------------------------------------------------------------ main */

if (args.includes('--susun')) await susun();
else if (args.includes('--hitung')) await hitung();
else {
  console.log('Pemakaian: --susun --a <draftA.json> --b <draftB.json> --keluar <dir>  |  --hitung --hasil <hasil.jsonl> --kunci <kunci-acak.json>');
  process.exit(1);
}
