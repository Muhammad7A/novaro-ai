#!/usr/bin/env node
/**
 * Membaca hasil validasi materi & IT — hanya dari mesin server / CLI.
 *
 *   npm run validasi                      ringkasan seluruh lembar (Materi & IT)
 *   npm run validasi -- lembar <id>       satu lembar, lengkap dengan komentarnya
 *   npm run validasi -- rekap             rekapitulasi antar validator, per butir & aspek
 *   npm run validasi -- ekspor            tulis CSV ke server/export/validasi-<waktu>/
 *   npm run validasi -- hapus <id>        hapus satu lembar (mis. salah kirim)
 *   npm run validasi -- instrumen         cetak instrumennya sendiri (untuk lampiran)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ASPEK,
  BUTIR,
  KATEGORI,
  KESIMPULAN,
  SKALA,
  hitungHasil,
  rekapValidasi,
} from '../lib/validasi.js';
import {
  ASPEK_IT,
  BUTIR_IT,
  KATEGORI_IT,
  KESIMPULAN_IT,
  SKALA_IT,
  hitungHasilIT,
  rekapValidasiIT,
} from '../lib/validasi-it.js';
import { validasiStore } from '../lib/validasi-store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const perintah = args[0] ?? 'ringkas';

const labelKesimpulan = (k, isIT = false) => {
  const list = isIT ? KESIMPULAN_IT : KESIMPULAN;
  return list.find((x) => x.kunci === k)?.label ?? k ?? '—';
};
const persen = (n) => `${Number(n).toFixed(2)}%`;
const garis = (n = 72) => '─'.repeat(n);

/* ------------------------------------------------------------------- CSV */

function cell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const toCsv = (rows, columns) =>
  [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n') + '\n';

/* --------------------------------------------------------------- Perintah */

async function ambilSemua() {
  const daftar = await validasiStore.daftar();
  if (!daftar.length) {
    console.log('\nBelum ada satu pun lembar validasi yang masuk.');
    console.log(`Berkas yang dibaca: ${validasiStore.FILE_PATH}\n`);
    return null;
  }
  return daftar;
}

async function ringkas() {
  const daftar = await ambilSemua();
  if (!daftar) return;

  console.log(`\nHasil validasi Novaro — ${daftar.length} lembar`);
  console.log(`Berkas: ${validasiStore.FILE_PATH}`);
  console.log(garis());
  for (const d of daftar) {
    const isIT = d?.jenis === 'it' || d?.jawaban?.IT01 !== undefined;
    const h = isIT ? hitungHasilIT(d.jawaban) : hitungHasil(d.jawaban);
    console.log(`\n  [${isIT ? 'AHLI IT' : 'MATERI'}] ${d.id}   ${d.validator.nama}${d.validator.institusi ? ` · ${d.validator.institusi}` : ''}`);
    console.log(`  Bidang       : ${(d.validator.bidang ?? []).join('; ')}`);
    console.log(`  Tanggal      : ${d.validator.tanggalValidasi}   (dikirim ${String(d.dikirimPada).slice(0, 10)})`);
    console.log(`  Skor         : ${h.skorDiperoleh} / ${h.skorMaksimum}   →   ${persen(h.persentase)}   ${h.kategori?.label ?? '—'}`);
    console.log(`  Butir dinilai: ${h.butirDinilai} dari ${h.butirTotal}${h.lengkap ? '' : `  <-- BELUM LENGKAP: ${h.belumDinilai.join(', ')}`}`);
    console.log(`  Kesimpulan   : ${labelKesimpulan(d.kesimpulan, isIT)}`);
    if (d.instrumenVersi !== h.instrumenVersi) {
      console.log(`  CATATAN      : diisi dengan instrumen versi ${d.instrumenVersi}, sekarang versi ${h.instrumenVersi}`);
    }
  }
  console.log(`\n${garis()}`);
  console.log('Rekapitulasi antar validator : npm run validasi -- rekap');
  console.log('Satu lembar lengkap          : npm run validasi -- lembar <id>\n');
}

async function lembar(id) {
  if (!id) {
    console.error('Sebutkan nomor lembarnya: npm run validasi -- lembar val_xxxxxxxxxxxx');
    process.exit(1);
  }
  const d = await validasiStore.cari(id);
  if (!d) {
    console.error(`Lembar ${id} tidak ditemukan.`);
    process.exit(1);
  }
  const isIT = d?.jenis === 'it' || d?.jawaban?.IT01 !== undefined;
  const h = isIT ? hitungHasilIT(d.jawaban) : hitungHasil(d.jawaban);
  const daftarAspek = isIT ? ASPEK_IT : ASPEK;
  const daftarButir = isIT ? BUTIR_IT : BUTIR;

  console.log(`\n${garis()}`);
  console.log(`LEMBAR VALIDASI ${isIT ? 'AHLI IT' : 'MATERI'} ${d.id}`);
  console.log(garis());
  console.log(`Nama       : ${d.validator.nama}`);
  console.log(`Institusi  : ${d.validator.institusi || '—'}`);
  console.log(`Jabatan    : ${d.validator.jabatan || '—'}`);
  console.log(`Bidang     : ${(d.validator.bidang ?? []).join('; ') || '—'}`);
  console.log(`Tanggal    : ${d.validator.tanggalValidasi}`);
  console.log(`Instrumen  : versi ${d.instrumenVersi}`);
  console.log(`\nSkor       : ${h.skorDiperoleh} / ${h.skorMaksimum}  =  ${persen(h.persentase)}  (${h.kategori?.label ?? '—'})`);
  console.log(`Rata butir : ${h.rataButir} dari 5`);
  console.log(`Kesimpulan : ${labelKesimpulan(d.kesimpulan, isIT)}`);

  console.log(`\n${garis()}\nPENILAIAN PER BUTIR\n${garis()}`);
  for (const a of daftarAspek) {
    const isi = daftarButir.filter((b) => b.aspek === a.kunci);
    const ringkasAspek = h.aspek.find((x) => x.kunci === a.kunci);
    console.log(`\n${a.kunci}. ${a.nama}  —  ${ringkasAspek.skor}/${ringkasAspek.skorMaksimum} (${persen(ringkasAspek.persentase)})`);
    for (const b of isi) {
      const j = d.jawaban?.[b.kode];
      console.log(`  ${b.kode}  [${j?.skor ?? '-'}]  ${b.pernyataan.slice(0, 96)}${b.pernyataan.length > 96 ? '…' : ''}`);
      if (j?.komentar) console.log(`        komentar: ${j.komentar}`);
    }
  }

  console.log(`\n${garis()}\nCATATAN UMUM\n${garis()}\n${d.catatanUmum || '(kosong)'}`);
  console.log(`\n${garis()}\nREKOMENDASI PERBAIKAN\n${garis()}\n${d.rekomendasi || '(kosong)'}`);
  console.log(`\n${garis()}\nKOMPONEN/MATERI YANG PERLU DIREVISI\n${garis()}`);
  if (!(d.materiPerluRevisi ?? []).length) console.log('(tidak ada yang dicatat)');
  for (const r of d.materiPerluRevisi ?? []) console.log(`  • ${r.bagian || '(bagian tidak disebut)'} — ${r.catatan}`);
  console.log('');
}

async function rekap() {
  const daftar = await ambilSemua();
  if (!daftar) return;

  const daftarMateri = daftar.filter((d) => d?.jenis !== 'it' && d?.jawaban?.IT01 === undefined);
  const daftarIT = daftar.filter((d) => d?.jenis === 'it' || d?.jawaban?.IT01 !== undefined);

  if (daftarMateri.length) {
    const r = rekapValidasi(daftarMateri);
    console.log(`\n${garis()}`);
    console.log(`REKAPITULASI VALIDASI MATERI — ${r.jumlahValidator} validator (${r.lembarLengkap} lembar lengkap)`);
    console.log(garis());
    console.log(`Total skor diperoleh : ${r.skorDiperoleh} / ${r.skorMaksimum}`);
    console.log(`Persentase kelayakan : ${persen(r.persentase)}   →   ${r.kategori.label} (${r.kategori.rentang})`);
    console.log(`Rata-rata per butir  : ${r.rataButir} dari 5`);
  }

  if (daftarIT.length) {
    const rIT = rekapValidasiIT(daftarIT);
    console.log(`\n${garis()}`);
    console.log(`REKAPITULASI VALIDASI AHLI IT — ${rIT.jumlahValidator} validator (${rIT.lembarLengkap} lembar lengkap)`);
    console.log(garis());
    console.log(`Total skor diperoleh : ${rIT.skorDiperoleh} / ${rIT.skorMaksimum}`);
    console.log(`Persentase kelayakan : ${persen(rIT.persentase)}   →   ${rIT.kategori.label} (${rIT.kategori.rentang})`);
    console.log(`Rata-rata per butir  : ${rIT.rataButir} dari 5`);
  }
  console.log('');
}

async function ekspor() {
  const daftar = await ambilSemua();
  if (!daftar) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(HERE, '..', 'export', `validasi-${stamp}`);
  await mkdir(outDir, { recursive: true });

  const daftarMateri = daftar.filter((d) => d?.jenis !== 'it' && d?.jawaban?.IT01 === undefined);
  const daftarIT = daftar.filter((d) => d?.jenis === 'it' || d?.jawaban?.IT01 !== undefined);

  if (daftarMateri.length) {
    const r = rekapValidasi(daftarMateri);
    const barisValidator = daftarMateri.map((d) => {
      const h = hitungHasil(d.jawaban);
      return {
        lembarId: d.id,
        nama: d.validator.nama,
        institusi: d.validator.institusi ?? '',
        jabatan: d.validator.jabatan ?? '',
        bidang: (d.validator.bidang ?? []).join('; '),
        tanggalValidasi: d.validator.tanggalValidasi,
        dikirimPada: d.dikirimPada,
        instrumenVersi: d.instrumenVersi,
        butirDinilai: h.butirDinilai,
        butirTotal: h.butirTotal,
        skorDiperoleh: h.skorDiperoleh,
        skorMaksimum: h.skorMaksimum,
        persentase: h.persentase,
        kategori: h.kategori?.label ?? '',
        rataButir: h.rataButir,
        kesimpulan: labelKesimpulan(d.kesimpulan, false),
        catatanUmum: d.catatanUmum ?? '',
        rekomendasi: d.rekomendasi ?? '',
      };
    });
    await writeFile(path.join(outDir, 'validator_materi.csv'), toCsv(barisValidator, Object.keys(barisValidator[0])), 'utf8');
  }

  if (daftarIT.length) {
    const rIT = rekapValidasiIT(daftarIT);
    const barisValidatorIT = daftarIT.map((d) => {
      const h = hitungHasilIT(d.jawaban);
      return {
        lembarId: d.id,
        nama: d.validator.nama,
        institusi: d.validator.institusi ?? '',
        jabatan: d.validator.jabatan ?? '',
        bidang: (d.validator.bidang ?? []).join('; '),
        tanggalValidasi: d.validator.tanggalValidasi,
        dikirimPada: d.dikirimPada,
        instrumenVersi: d.instrumenVersi,
        butirDinilai: h.butirDinilai,
        butirTotal: h.butirTotal,
        skorDiperoleh: h.skorDiperoleh,
        skorMaksimum: h.skorMaksimum,
        persentase: h.persentase,
        kategori: h.kategori?.label ?? '',
        rataButir: h.rataButir,
        kesimpulan: labelKesimpulan(d.kesimpulan, true),
        catatanUmum: d.catatanUmum ?? '',
        rekomendasi: d.rekomendasi ?? '',
      };
    });
    await writeFile(path.join(outDir, 'validator_it.csv'), toCsv(barisValidatorIT, Object.keys(barisValidatorIT[0])), 'utf8');
  }

  console.log(`\nEkspor validasi selesai: ${outDir}\n`);
}

async function hapus(id) {
  if (!id) {
    console.error('Sebutkan nomor lembarnya: npm run validasi -- hapus val_xxxxxxxxxxxx');
    process.exit(1);
  }
  const ada = await validasiStore.cari(id);
  if (!ada) {
    console.error(`Lembar ${id} tidak ditemukan.`);
    process.exit(1);
  }
  await validasiStore.hapus(id);
  console.log(`Lembar ${id} atas nama ${ada.validator?.nama ?? '—'} dihapus.`);
}

function cetakInstrumen() {
  console.log(`\n${garis()}\nINSTRUMEN VALIDASI AHLI IT (25 BUTIR)\n${garis()}`);
  for (const a of ASPEK_IT) {
    console.log(`\n${garis()}\n${a.kunci}. ${a.nama} — ${a.deskripsi}\n${garis()}`);
    for (const b of BUTIR_IT.filter((x) => x.aspek === a.kunci)) {
      console.log(`\n  ${b.kode}. ${b.pernyataan}`);
      console.log(`        Periksa pada: ${b.rujukan}`);
    }
  }
}

/* ------------------------------------------------------------------ Jalan */

switch (perintah) {
  case 'ringkas':
  case 'list':
    await ringkas();
    break;
  case 'lembar':
  case 'show':
    await lembar(args[1]);
    break;
  case 'rekap':
    await rekap();
    break;
  case 'ekspor':
  case 'export':
    await ekspor();
    break;
  case 'hapus':
    await hapus(args[1]);
    break;
  case 'instrumen':
    cetakInstrumen();
    break;
  default:
    console.log(`
Perintah yang dikenal:
  npm run validasi                    ringkasan seluruh lembar yang masuk
  npm run validasi -- lembar <id>     satu lembar lengkap dengan komentarnya
  npm run validasi -- rekap           rekapitulasi antar validator
  npm run validasi -- ekspor          tulis CSV ke server/export/
  npm run validasi -- hapus <id>      hapus satu lembar
  npm run validasi -- instrumen       cetak instrumennya
`);
    process.exit(1);
}
