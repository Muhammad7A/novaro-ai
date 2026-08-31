#!/usr/bin/env node
/**
 * Uji nyala: satu panggilan SUNGGUHAN ke Claude, sebelum ada peserta.
 *
 *   npm run smoke            kedua jalur AI (chat + rekomendasi)
 *   npm run smoke -- --chat  hanya chat (lebih murah)
 *
 * Seluruh uji otomatis di `npm test` memakai layanan tiruan — bagus untuk
 * memastikan logikanya benar, tapi tidak satu pun membuktikan bahwa parameter
 * yang dikirim benar-benar diterima Claude. Perbedaan itu baru ketahuan pada
 * panggilan sungguhan yang pertama. Perintah ini memindahkan momen itu ke
 * meja pengelola, beberapa sen sebelum peserta, alih-alih terjadi di depan
 * pemilik warung yang sedang menunggu jawaban.
 *
 * TIDAK menyentuh data peserta: profil dan buku kas contoh dibuat di memori.
 */
import { generateRecommendations, isConfigured, modelAktif, streamChat } from '../lib/ai.js';
import { summarizeMonth, currentMonth, todayISO } from '../lib/cashbook.js';
import { computeMetrics } from '../lib/metrics.js';
import { cashbookContext } from '../lib/prompts.js';
import { hitungToken } from '../lib/anggaran.js';

const hanyaChat = process.argv.includes('--chat');

if (!isConfigured()) {
  console.error('\n  Layanan AI belum diatur.');
  console.error('  Pilih salah satu:');
  console.error('    - Anthropic langsung : isi ANTHROPIC_API_KEY di server/.env');
  console.error('    - Vertex AI          : isi GOOGLE_CLOUD_PROJECT, lalu `gcloud auth application-default login`\n');
  process.exit(1);
}

/* ---------------------------------------------- Usaha contoh (di memori) */

const PROFIL = {
  namaUsaha: 'Warung Uji Coba',
  jenisUsaha: 'kuliner',
  lokasi: 'Sleman, DIY',
  produkUtama: 'Nasi rames',
  lamaUsahaBulan: 30,
  jumlahKaryawan: 2,
  omzetBulanan: 12_000_000,
  belanjaBulanan: 6_500_000,
  biayaOperasional: 2_000_000,
  cicilanBulanan: 1_500_000,
  pencatatan: 'buku',
  tujuan: 'ajukan-kur',
  rekeningTerpisah: true,
  punyaNib: false,
  tantangan: 'Sering kehabisan modal di tengah bulan',
};

const transaksi = [];
for (let i = 20; i >= 0; i--) {
  const tgl = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
  transaksi.push({ tanggal: tgl, jenis: 'masuk', kategori: 'penjualan', jumlah: 450_000, keterangan: 'Jual nasi', createdAt: `${tgl}T05:00:00Z` });
  if (i % 2 === 0) transaksi.push({ tanggal: tgl, jenis: 'keluar', kategori: 'belanja-bahan', jumlah: 280_000, keterangan: 'Belanja pasar', createdAt: `${tgl}T05:00:00Z` });
}

const ringkas = summarizeMonth(transaksi, currentMonth());
const metrics = computeMetrics(PROFIL, ringkas, ringkas);
const cashbook = cashbookContext(transaksi);

const rupiah = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n));
// Tarif perkenalan Sonnet 5 sampai 31 Agustus 2026: $2 / $10 per juta token.
const KURS = 16_500;
const biaya = (u) =>
  ((Number(u?.input_tokens) || 0) * 2 +
    (Number(u?.cache_creation_input_tokens) || 0) * 2.5 +
    (Number(u?.cache_read_input_tokens) || 0) * 0.2 +
    (Number(u?.output_tokens) || 0) * 10) /
  1e6 * KURS;

console.log(`\n  Uji nyala layanan AI — ${modelAktif()}`);
console.log(`  Tanggal: ${todayISO()} (WIB)\n`);

let gagal = 0;
let totalBiaya = 0;

/* ------------------------------------------------------------------ Chat */

console.log('  [1/2] Konsultasi chat (thinking dimatikan, effort rendah)');
try {
  const mulai = Date.now();
  let keluar = '';
  const { text, usage, terpotong } = await streamChat({
    profile: PROFIL,
    metrics,
    cashbook,
    history: [],
    message: 'Dalam dua kalimat saja: apa satu langkah pertama untuk merapikan keuangan warung saya?',
    onText: (c) => { keluar += c; },
  });

  const detik = ((Date.now() - mulai) / 1000).toFixed(1);
  const rp = biaya(usage);
  totalBiaya += rp;

  if (!text) throw new Error('jawaban kosong');
  if (keluar.length === 0) throw new Error('tidak ada satu pun potongan yang mengalir (streaming tidak jalan)');

  console.log(`        OK — ${detik} detik, ${usage.input_tokens} token masuk / ${usage.output_tokens} keluar · ~${rupiah(rp)}`);
  console.log(`        Streaming: ${keluar.length} karakter mengalir bertahap`);
  console.log(`        Terpotong: ${terpotong ? 'YA — max_tokens terlalu kecil' : 'tidak'}`);
  console.log(`        Token terhitung untuk anggaran: ${hitungToken(usage)}`);
  console.log(`\n        "${text.slice(0, 160).replace(/\n/g, ' ')}${text.length > 160 ? '…' : ''}"\n`);
  if (terpotong) gagal++;
} catch (err) {
  gagal++;
  console.error(`        GAGAL — ${err.message}\n`);
}

/* -------------------------------------------------------- Rekomendasi */

if (hanyaChat) {
  console.log('  [2/2] Rekomendasi — dilewati (--chat)\n');
} else {
  console.log('  [2/2] Rekomendasi terstruktur (thinking adaptif, skema JSON)');
  try {
    const mulai = Date.now();
    const { data, usage } = await generateRecommendations({ profile: PROFIL, metrics, cashbook });
    const detik = ((Date.now() - mulai) / 1000).toFixed(1);
    const rp = biaya(usage);
    totalBiaya += rp;

    // Skema JSON dijanjikan valid oleh structured outputs — dibuktikan di sini.
    const wajib = ['ringkasan', 'rekomendasi', 'peringatan', 'targetBulanIni'];
    const hilang = wajib.filter((k) => data[k] === undefined);
    if (hilang.length) throw new Error(`medan wajib hilang dari skema: ${hilang.join(', ')}`);
    if (!Array.isArray(data.rekomendasi) || !data.rekomendasi.length) throw new Error('daftar rekomendasi kosong');
    const r = data.rekomendasi[0];
    for (const k of ['judul', 'prioritas', 'alasan', 'langkah', 'dampak', 'modulTerkait']) {
      if (r[k] === undefined) throw new Error(`rekomendasi tidak punya medan "${k}"`);
    }

    console.log(`        OK — ${detik} detik, ${usage.input_tokens} token masuk / ${usage.output_tokens} keluar · ~${rupiah(rp)}`);
    console.log(`        Skema: ${data.rekomendasi.length} rekomendasi, ${data.peringatan.length} peringatan, ${data.targetBulanIni.length} target`);
    console.log(`        Token terhitung untuk anggaran: ${hitungToken(usage)}`);
    console.log(`\n        "${String(data.ringkasan).slice(0, 160)}…"`);
    console.log(`        Rekomendasi pertama: "${r.judul}" (${r.prioritas}, modul ${r.modulTerkait})\n`);
  } catch (err) {
    gagal++;
    console.error(`        GAGAL — ${err.message}\n`);
  }
}

/* ------------------------------------------------------------- Kesimpulan */

console.log(`  Perkiraan biaya uji ini: ~${rupiah(totalBiaya)}`);
if (gagal === 0) {
  console.log('\n  SEMUA LULUS. Jalur AI berfungsi dengan kunci API yang terpasang.');
  console.log('  Cek juga batas biaya di console.anthropic.com sebelum peserta masuk.\n');
} else {
  console.error(`\n  ${gagal} GAGAL. Jangan berikan kode akses ke peserta sebelum ini beres.\n`);
  process.exitCode = 1;
}
