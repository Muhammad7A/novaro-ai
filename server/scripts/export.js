#!/usr/bin/env node
/**
 * Ekspor data pilot untuk dianalisis.
 *
 *   npm run export -- --anonymize     tanpa data pribadi (untuk dibagikan/dianalisis)
 *   npm run export                    lengkap (untuk cadangan internal)
 *   npm run export -- --out /path     tujuan lain
 *
 * Yang dihasilkan bukan salinan mentah basis data, melainkan tabel-tabel yang
 * sudah siap dihitung — termasuk `perkiraan_vs_nyata.csv`, selisih antara apa
 * yang pemilik usaha KIRA dia hasilkan dan apa yang buku kasnya tunjukkan.
 * Itulah angka yang paling layak diteliti dari aplikasi ini, dan ia hanya bisa
 * dihitung karena versi pertama profil disimpan sebagai garis dasar.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isMonthComplete, monthsWithData, summarizeMonth, tanggalWIB } from '../lib/cashbook.js';
import { computeMetrics } from '../lib/metrics.js';
import { store } from '../lib/store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const anonymize = args.includes('--anonymize');
const outFlag = args.indexOf('--out');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT_DIR =
  outFlag >= 0 && args[outFlag + 1]
    ? path.resolve(args[outFlag + 1])
    : path.join(HERE, '..', 'export', `${stamp}${anonymize ? '-anonim' : '-lengkap'}`);

/* ------------------------------------------------------------------- CSV */

/** Satu sel CSV. Dikutip bila perlu; kutip ganda di dalam digandakan. */
function cell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows, columns) {
  const head = columns.join(',');
  const body = rows.map((r) => columns.map((c) => cell(r[c])).join(','));
  return [head, ...body].join('\n') + '\n';
}

/* ------------------------------------------------------- Penyamaran data */

/*
 * Yang dibuang saat --anonymize: nama orang, nama usaha, lokasi, produk, teks
 * bebas (tantangan, keterangan transaksi), dan seluruh isi percakapan. `usr_xxx`
 * sendiri sudah acak dan tidak mengandung identitas, jadi tetap dipakai supaya
 * baris antar tabel masih bisa disambungkan.
 */
const DIBUANG = '(dihapus)';
const teks = (v) => (anonymize ? (v ? DIBUANG : '') : (v ?? ''));

/* ------------------------------------------------------------- Perhitungan */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const bulanDariTanggal = (t) => String(t ?? '').slice(0, 7);

/** Rata-rata angka nyata dari bulan yang penuh DAN tercatat rapat saja. */
function nyataRataRata(summaries) {
  const layak = summaries.filter(isMonthComplete);
  if (!layak.length) return null;
  const rata = (f) => Math.round(layak.reduce((s, m) => s + f(m), 0) / layak.length);
  return {
    bulanDipakai: layak.length,
    omzet: rata((m) => m.penjualan + m.lainMasuk),
    hpp: rata((m) => m.belanjaBahan),
    biaya: rata((m) => m.operasional + m.lainKeluar),
    labaBersih: rata((m) => m.labaBersih),
  };
}

const selisih = (nyata, kira) => (kira > 0 ? Number((((nyata - kira) / kira) * 100).toFixed(1)) : null);

/**
 * Versi profil yang BERLAKU pada akhir sebuah bulan.
 *
 * Skor kesehatan memuat hal-hal yang berubah sepanjang program: punya NIB,
 * rekening usaha sudah dipisah, cara mencatat. Memakai profil terakhir untuk
 * semua bulan berarti NIB yang baru diurus bulan April ikut menaikkan skor bulan
 * Januari — kolom yang terlihat seperti ukuran perubahan dari waktu ke waktu,
 * padahal sebagian isinya datang dari masa depan.
 */
function profilPadaBulan(history, month) {
  const akhirBulan = `${month}-32`; // batas atas; perbandingan teks ISO sudah cukup
  let dipakai = null;
  for (const p of history) {
    if (String(p.recordedAt ?? '') <= akhirBulan) dipakai = p;
  }
  // Bulan sebelum profil pertama diisi: pakai versi pertama, tandai di kolomnya.
  return dipakai ?? history[0] ?? null;
}

/* ------------------------------------------------------------------ Jalan */

const db = await store.dump();
const users = db.users ?? [];

if (!users.length) {
  console.error('Belum ada pengguna untuk diekspor.');
  process.exit(1);
}

const barisPengguna = [];
const barisProfil = [];
const barisTransaksi = [];
const barisPeristiwa = [];
const barisBulanan = [];
const barisGap = [];

for (const u of users) {
  const transactions = u.transactions ?? [];
  const history = u.profileHistory ?? (u.profile ? [{ ...u.profile, recordedAt: u.profile.updatedAt }] : []);
  const garisDasar = history[0] ?? null;
  const terakhir = history.at(-1) ?? null;

  const months = monthsWithData(transactions);
  const summaries = months.map((m) => summarizeMonth(transactions, m));
  const nyata = nyataRataRata(summaries);

  /*
   * `batch` ikut di SETIAP tabel, bukan hanya users.csv.
   *
   * Tanpa itu, tiap analisis per-transaksi, per-bulan, atau per-peristiwa harus
   * digabungkan dulu ke users.csv sebelum bisa dikelompokkan — langkah manual
   * yang diulang tiap kali, dan tiap pengulangan adalah satu kesempatan
   * menggabungkan yang keliru. Satu kolom tambahan jauh lebih murah daripada
   * satu tabel yang salah gabung tanpa disadari.
   */
  const batch = u.batch ?? '';

  /* users.csv — satu baris per peserta */
  barisPengguna.push({
    userId: u.id,
    batch,
    nama: teks(u.name),
    usaha: teks(u.business),
    terdaftar: u.createdAt,
    /*
     * Tanggal mulai jalur belajar, ditetapkan pendamping. Wajib ada di sini:
     * tanpanya `module_completed` di events.csv tidak bisa diubah menjadi
     * "selesai pada hari ke berapa", dan analisis kepatuhan harian — inti dari
     * klaim micro-learning tujuh hari — tidak bisa dihitung sama sekali.
     */
    mulaiBelajar: u.mulaiPada ?? '',
    jenisUsaha: garisDasar?.jenisUsaha ?? '',
    lokasi: teks(garisDasar?.lokasi),
    lamaUsahaBulan: num(garisDasar?.lamaUsahaBulan),
    jumlahKaryawan: num(garisDasar?.jumlahKaryawan),
    pencatatanAwal: garisDasar?.pencatatan ?? '',
    tujuan: garisDasar?.tujuan ?? '',
    rekeningTerpisahAwal: garisDasar?.rekeningTerpisah ? 1 : 0,
    punyaNibAwal: garisDasar?.punyaNib ? 1 : 0,
    rekeningTerpisahAkhir: terakhir?.rekeningTerpisah ? 1 : 0,
    punyaNibAkhir: terakhir?.punyaNib ? 1 : 0,
    versiProfil: history.length,
    bulanTercatat: months.length,
    jumlahTransaksi: transactions.length,
    jumlahPesanChat: u.chat?.length ?? 0,
    modulSelesai: Object.values(u.progress?.done ?? {}).filter(Boolean).length,
    permintaanAI: u.usage?.requests ?? 0,
    tokenMasuk: u.usage?.inputTokens ?? 0,
    tokenKeluar: u.usage?.outputTokens ?? 0,
    // Token cache datang di medan terpisah; tanpa dua kolom ini pemakaian
    // terlihat jauh lebih kecil dari tagihan yang sebenarnya.
    tokenCacheBaca: u.usage?.cacheBacaTokens ?? 0,
    tokenCacheTulis: u.usage?.cacheTulisTokens ?? 0,
  });

  /* profile_versions.csv — tiap versi profil, versi 1 = garis dasar */
  history.forEach((p, i) => {
    barisProfil.push({
      userId: u.id,
      batch,
      versi: i + 1,
      garisDasar: i === 0 ? 1 : 0,
      dicatatPada: p.recordedAt ?? '',
      omzetBulanan: num(p.omzetBulanan),
      belanjaBulanan: num(p.belanjaBulanan),
      biayaOperasional: num(p.biayaOperasional),
      cicilanBulanan: num(p.cicilanBulanan),
      pencatatan: p.pencatatan ?? '',
      rekeningTerpisah: p.rekeningTerpisah ? 1 : 0,
      punyaNib: p.punyaNib ? 1 : 0,
      tujuan: p.tujuan ?? '',
      tantangan: teks(p.tantangan),
    });
  });

  /* transactions.csv — inti perilaku: kapan dicatat vs kapan terjadi */
  for (const t of transactions) {
    /*
     * Kedua sisi harus dalam zona waktu yang sama.
     *
     * `createdAt` disimpan dalam UTC, `tanggal` diisi pengguna dalam WIB. Dulu
     * baris ini memotong 10 karakter pertama createdAt — yaitu tanggal UTC-nya —
     * lalu menguranginya dengan tanggal WIB. Akibatnya setiap transaksi yang
     * dicatat antara tengah malam dan pukul 07.00 WIB menghasilkan jeda −1 hari:
     * "dicatat sehari sebelum kejadiannya". Padahal mencatat subuh, sebelum
     * warung buka, justru salah satu kebiasaan yang paling ingin diamati.
     */
    const hariTunda =
      t.createdAt && t.tanggal
        ? Math.round((new Date(tanggalWIB(t.createdAt)) - new Date(t.tanggal)) / 86400000)
        : '';
    barisTransaksi.push({
      userId: u.id,
      batch,
      transaksiId: t.id,
      tanggal: t.tanggal,
      bulan: bulanDariTanggal(t.tanggal),
      dicatatPada: t.createdAt ?? '',
      hariTundaCatat: hariTunda,
      jenis: t.jenis,
      kategori: t.kategori,
      jumlah: num(t.jumlah),
      keterangan: teks(t.keterangan),
    });
  }

  /* events.csv — garis waktu perilaku */
  for (const e of u.events ?? []) {
    barisPeristiwa.push({
      userId: u.id,
      batch,
      ts: e.ts,
      tanggal: String(e.ts).slice(0, 10),
      type: e.type,
      meta: e.meta ? JSON.stringify(e.meta) : '',
    });
  }

  /* monthly.csv — tabel siap analisis, satu baris per pengguna per bulan */
  for (const s of summaries) {
    const profilBulanItu = profilPadaBulan(history, s.month);
    barisBulanan.push({
      userId: u.id,
      batch,
      bulan: s.month,
      lengkap: s.lengkap ? 1 : 0,
      layakRataRata: isMonthComplete(s) ? 1 : 0,
      hariTercatat: s.hariTercatat,
      hariBerjalan: s.hariBerjalan,
      hariBulan: s.hariBulan,
      cakupan: Number(s.cakupan.toFixed(3)),
      konsistensi: Number(s.konsistensi.toFixed(3)),
      jumlahTransaksi: s.jumlahTransaksi,
      penjualan: s.penjualan,
      belanjaBahan: s.belanjaBahan,
      operasional: s.operasional,
      prive: s.prive,
      cicilan: s.cicilan,
      labaBersih: s.labaBersih,
      saldoKas: s.saldoKas,
      marginBersih: s.marginBersih,
      // Skor dihitung dengan profil yang berlaku SAAT ITU, bukan profil hari ini.
      skorKesehatan: computeMetrics(profilBulanItu ?? {}, isMonthComplete(s) ? s : null, s).skorKesehatan,
      versiProfilDipakai: profilBulanItu ? history.indexOf(profilBulanItu) + 1 : '',
    });
  }

  /* perkiraan_vs_nyata.csv — temuan utama */
  if (garisDasar && nyata) {
    barisGap.push({
      userId: u.id,
      batch,
      bulanNyataDipakai: nyata.bulanDipakai,
      omzetPerkiraan: num(garisDasar.omzetBulanan),
      omzetNyata: nyata.omzet,
      omzetSelisihPersen: selisih(nyata.omzet, num(garisDasar.omzetBulanan)),
      hppPerkiraan: num(garisDasar.belanjaBulanan),
      hppNyata: nyata.hpp,
      hppSelisihPersen: selisih(nyata.hpp, num(garisDasar.belanjaBulanan)),
      biayaPerkiraan: num(garisDasar.biayaOperasional),
      biayaNyata: nyata.biaya,
      biayaSelisihPersen: selisih(nyata.biaya, num(garisDasar.biayaOperasional)),
      labaPerkiraan: num(garisDasar.omzetBulanan) - num(garisDasar.belanjaBulanan) - num(garisDasar.biayaOperasional),
      labaNyata: nyata.labaBersih,
    });
  }
}

/* -------------------------------------------------------------- Menulis */

const files = [
  ['users.csv', toCsv(barisPengguna, Object.keys(barisPengguna[0]))],
  ['profile_versions.csv', barisProfil.length ? toCsv(barisProfil, Object.keys(barisProfil[0])) : ''],
  ['transactions.csv', barisTransaksi.length ? toCsv(barisTransaksi, Object.keys(barisTransaksi[0])) : ''],
  ['events.csv', barisPeristiwa.length ? toCsv(barisPeristiwa, Object.keys(barisPeristiwa[0])) : ''],
  ['monthly.csv', barisBulanan.length ? toCsv(barisBulanan, Object.keys(barisBulanan[0])) : ''],
  ['perkiraan_vs_nyata.csv', barisGap.length ? toCsv(barisGap, Object.keys(barisGap[0])) : ''],
];

if (!anonymize) {
  // Percakapan hanya ikut pada ekspor lengkap — isinya teks bebas dari pengguna.
  const chat = users.flatMap((u) =>
    (u.chat ?? []).map((m, i) => ({ userId: u.id, batch: u.batch ?? '', urutan: i + 1, ts: m.ts ?? '', role: m.role, isi: m.content })),
  );
  if (chat.length) files.push(['chat.csv', toCsv(chat, Object.keys(chat[0]))]);
}

await mkdir(OUT_DIR, { recursive: true });
for (const [name, content] of files) {
  if (content) await writeFile(path.join(OUT_DIR, name), content, 'utf8');
}

await writeFile(
  path.join(OUT_DIR, 'BACA-DULU.txt'),
  `Ekspor data pilot Nova Explorer
Dibuat        : ${new Date().toISOString()}
Mode          : ${anonymize ? 'ANONIM — data pribadi dihapus' : 'LENGKAP — MEMUAT DATA PRIBADI'}
Jumlah peserta: ${users.length}

Berkas:
  users.csv               Satu baris per peserta: profil awal, profil akhir, ringkasan pemakaian.
                          mulaiBelajar = tanggal jalur 7 hari dimulai (ditetapkan pendamping).
  profile_versions.csv    Tiap versi profil. versi=1 adalah GARIS DASAR (perkiraan hari pertama).
  transactions.csv        Tiap transaksi. hariTundaCatat = jeda hari antara kejadian dan pencatatan.
  events.csv              Garis waktu perilaku: login, modul selesai, rekomendasi, laporan dibuka.
  monthly.csv             Tabel siap analisis, satu baris per peserta per bulan.
  perkiraan_vs_nyata.csv  Selisih antara perkiraan hari pertama dan angka buku kas.
${anonymize ? '' : '  chat.csv                Isi percakapan. TIDAK ada pada ekspor anonim.\n'}
Catatan analisis:
- monthly.csv: pakai layakRataRata=1 untuk membandingkan antar bulan. Bulan dengan
  cakupan rendah angkanya lebih kecil dari kenyataan, bukan karena usahanya turun.
- perkiraan_vs_nyata.csv: hanya berisi peserta yang punya minimal satu bulan penuh
  yang tercatat rapat. Angka nyata dirata-rata dari bulan-bulan itu saja.
- transactions.csv: hariTundaCatat=0 berarti dicatat di hari kejadian.

${anonymize ? 'Mode anonim: nama, usaha, lokasi, produk, teks bebas, dan percakapan sudah dihapus.\nusr_xxx bersifat acak dan tetap dipakai agar baris antar tabel bisa disambungkan.' : 'PERINGATAN: berkas ini memuat nama, lokasi, dan percakapan peserta.\nJangan dibagikan. Untuk analisis atau publikasi, pakai: npm run export -- --anonymize'}
`,
  'utf8',
);

console.log(`\nEkspor selesai — ${anonymize ? 'ANONIM' : 'LENGKAP (memuat data pribadi)'}\n`);
console.log(`  ${OUT_DIR}\n`);
for (const [name, content] of files) {
  if (!content) continue;
  console.log(`  ${name.padEnd(24)} ${content.trim().split('\n').length - 1} baris`);
}
if (!anonymize) console.log('\n  Untuk dibagikan atau dianalisis, jalankan ulang dengan --anonymize.');
console.log('');
