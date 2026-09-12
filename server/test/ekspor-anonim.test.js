/*
 * Janji ekspor anonim harus benar.
 *
 * BACA-DULU.txt pada ekspor --anonymize menjanjikan teks bebas sudah
 * dihapus. Dulu events.csv ditulis apa adanya di KEDUA mode — nama peserta
 * (peserta_dinamai), alasan umpan balik (ai_feedback), dan konsep AI lolos
 * ke berkas yang dijanjikan aman dibagikan. Uji ini menjalankan skrip
 * ekspor SUNGGUHAN (proses anak, bukan salinan logikanya) di atas toko
 * berisi pelanggaran, lalu memeriksa berkasnya:
 *   - mode anonim: teks terdaftar TIDAK ada; sinyal perilaku (batch, rating,
 *     jumlah) TETAP ada — anonim bukan berarti jejaknya kosong;
 *   - mode lengkap: teks yang sama TETAP ada (penyaring hanya milik anonim);
 *   - janji di BACA-DULU.txt menyebut apa yang benar-benar dibuang.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const jalankan = promisify(execFile);
const AKAR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const DIR_DATA = mkdtempSync(path.join(tmpdir(), 'ekspor-data-'));
const DIR_ANONIM = mkdtempSync(path.join(tmpdir(), 'ekspor-anonim-'));
const DIR_LENGKAP = mkdtempSync(path.join(tmpdir(), 'ekspor-lengkap-'));
process.on('exit', () => {
  for (const d of [DIR_DATA, DIR_ANONIM, DIR_LENGKAP]) rmSync(d, { recursive: true, force: true });
});

// ── Benih: satu peserta dengan SEMUA medan teks bebas yang terdaftar ──
process.env.NOVA_DATA_DIR = DIR_DATA;
const { store } = await import('../lib/store.js');
{
  const { user } = await store.createUser({ name: 'Peserta Ekspor', business: 'Warung Asal', batch: 'B1' });
  await store.renameUser(user.id, { name: 'Bu Sari Purnama', business: 'Warung Purnama' });
  await store.saveProfile(user.id, { omzetBulanan: 5_000_000, belanjaBulanan: 2_000_000, biayaOperasional: 500_000 });
  await store.addTransaction(user.id, {
    tanggal: '2026-09-01', jenis: 'keluar', kategori: 'operasional',
    keterangan: 'Bayar utang ke Pak Haji Soleh', jumlah: 9_876_543,
  }, { aktor: 'manusia' });
  await store.simpanJawabanLatihan(user.id, 1, 0, true, 'arus kas kecil');
  await store.logEvent(user.id, 'ai_feedback', { rating: 'down', alasan: 'Jawaban meleset soal kas halus', chatIndex: 0 });
  // Benih memori advisori (Sesi G): prosa nasihat + hasil checkpoint.
  await store.simpanRekomendasi(user.id, {
    ringkasan: 'Nasihat rahasia zaraza — prosa uji kebocoran.',
    rekomendasi: [{ judul: 'Rapikan prive', prioritas: 'tinggi', alasan: 'prive besar', langkah: ['atur jadwal'], dampak: 'kas tertib', modulTerkait: 23 }],
    peringatan: ['prive hampir menyamai laba'],
    targetBulanIni: ['tetapkan prive mingguan'],
  }, { input_tokens: 5, output_tokens: 5 }, { model: 'gemini-2.5-flash-uji' });
  {
    const denganAdvisori = await store.findUserById(user.id);
    await store.tambahEvaluasiAdvisori(user.id, [{
      advisoriId: denganAdvisori.advisori[0].id,
      jenis: 'rekomendasi',
      dinilaiAt: '2026-10-01T03:00:00.000Z',
      metode: 'komparsi-bulan',
      status: 'terukur',
      bulanDasar: '2026-07',
      bulanCek: '2026-08',
      dimensi: {
        labaBersih: { dasar: 1_700_000, kini: 2_000_000, status: 'membaik' },
        marginBersih: { dasar: 8, kini: 9.5, status: 'membaik' },
        saldoKas: { dasar: 1_700_000, kini: -3_400_000, status: 'memburuk' },
      },
      perItem: [],
    }]);
  }
  await store.selesaikanPenulisan();
}

const EKSPOR = path.join(AKAR, 'scripts', 'export.js');

test('ekspor anonim tidak memuat teks bebas; sinyal perilakunya tetap utuh', async () => {
  await jalankan(process.execPath, [EKSPOR, '--anonymize', '--out', DIR_ANONIM], {
    cwd: AKAR,
    env: { ...process.env, NOVA_DATA_DIR: DIR_DATA },
  });

  const acara = readFileSync(path.join(DIR_ANONIM, 'events.csv'), 'utf8');
  const transaksi = readFileSync(path.join(DIR_ANONIM, 'transactions.csv'), 'utf8');
  const pengguna = readFileSync(path.join(DIR_ANONIM, 'users.csv'), 'utf8');
  const semuanya = acara + transaksi + pengguna;

  // Identitas dan teks bebas: tidak di berkas mana pun.
  for (const terlarang of ['Soleh', 'Purnama', 'meleset soal kas', 'arus kas kecil']) {
    assert.doesNotMatch(semuanya, new RegExp(terlarang), `"${terlarang}" bocor ke ekspor anonim`);
  }
  // Nominal: jejak PERISTIWA tetap tanpa nominal (invarian lama), tapi
  // angka buku kas di transactions.csv JUSTRU isi ekspor ini — dianalisis,
  // bukan disembunyikan.
  assert.doesNotMatch(acara, /9876543/, 'nominal tidak boleh ikut ke events.csv');
  assert.match(transaksi, /9876543/, 'angka buku kas justru isi transactions.csv');
  assert.doesNotMatch(transaksi, /Soleh/, 'keterangan transaksi harus terganti');
  assert.match(transaksi, /\(dihapus\)/, 'keterangan terganti penanda, bukan kosong tanpa jejak');

  // Anonim tetap memuat sinyal: baris umpan balik ada, ratingnya utuh.
  const barisUmpan = acara.split('\n').find((b) => b.includes('ai_feedback'));
  assert.ok(barisUmpan, 'ai_feedback seharusnya tetap tercatat (ratingnya adalah sinyal perilaku)');
  assert.match(barisUmpan, /down/, 'rating harus selamat dari penyaringan');
  assert.doesNotMatch(barisUmpan, /meleset/, 'alasan harus hilang dari baris yang sama');

  // batch ikut terbangun demi analisis antar kelompok.
  assert.match(acara, /B1/, 'kolom batch adalah sinyal riset, bukan PII');
});

test('ekspor lengkap tetap memuat teks bebas — penyaring hanya milik mode anonim', async () => {
  await jalankan(process.execPath, [EKSPOR, '--out', DIR_LENGKAP], {
    cwd: AKAR,
    env: { ...process.env, NOVA_DATA_DIR: DIR_DATA },
  });

  const acara = readFileSync(path.join(DIR_LENGKAP, 'events.csv'), 'utf8');
  assert.match(acara, /meleset soal kas/, 'mode lengkap memang memuat teks bebas');
  assert.match(acara, /Purnama/, 'mode lengkap memang memuat nama peserta');
});

test('janji di BACA-DULU.txt menyebut apa yang benar-benar dibuang', async () => {
  const janji = readFileSync(path.join(DIR_ANONIM, 'BACA-DULU.txt'), 'utf8');
  assert.match(janji, /sudah dihapus/);
  assert.match(janji, /jejak peristiwa/, 'janji harus menyebut penyaringan events.csv secara eksplisit');
  assert.doesNotMatch(janji, /produk/, 'janji soal kolom "produk" tidak pernah benar — kolom itu tidak ada');
  assert.ok(existsSync(path.join(DIR_ANONIM, 'events.csv')));
});

test('advisori & evaluasi: prosa nasihat terfilter di anonim — sinyal, asal, dan hasil tetap', async () => {
  const anonimAdvisori = readFileSync(path.join(DIR_ANONIM, 'advisori.csv'), 'utf8');
  const anonimEvaluasi = readFileSync(path.join(DIR_ANONIM, 'evaluasi_advisori.csv'), 'utf8');
  const anonimSemua = anonimAdvisori + anonimEvaluasi;

  // Prosa nasihat (teks bebas dari model): tidak di berkas anonim mana pun.
  for (const berkas of [readFileSync(path.join(DIR_ANONIM, 'events.csv'), 'utf8'), anonimSemua]) {
    assert.doesNotMatch(berkas, /zaraza/, 'prosa nasihat bocor ke ekspor anonim');
  }
  assert.match(anonimAdvisori, /\(dihapus\)/, 'ringkasan diganti penanda, bukan kolom kosong tanpa jejak');
  // Sinyal riset tetap utuh: asal keluaran, bentuk, dan sidik dasar angkanya.
  assert.match(anonimAdvisori, /gemini-2\.5-flash-uji/, 'identitas model adalah sinyal riset, bukan PII');
  assert.match(anonimAdvisori, /komparsi-bulan|rekomendasi/);
  assert.match(anonimAdvisori, /sha256:/, 'sidik dasar angka ikut — angkanya sendiri tidak pernah disalin');
  assert.doesNotMatch(anonimAdvisori.split('\n')[0], /omzet|jumlah:/, 'tabel advisori tidak memuat kolom angka profil');
  // Hasil checkpoint: angka buku kas dan arahnya adalah isi analisis, bukan PII.
  assert.match(anonimEvaluasi, /komparsi-bulan/);
  assert.match(anonimEvaluasi, /membaik/);
  assert.match(anonimEvaluasi, /memburuk/);
  assert.match(anonimEvaluasi, /2000000/, 'angka kernel dari buku kas justru isi tabel evaluasi');

  // Mode lengkap: prosa yang sama TETAP ada — penyaring hanya milik anonim.
  const lengkapAdvisori = readFileSync(path.join(DIR_LENGKAP, 'advisori.csv'), 'utf8');
  assert.match(lengkapAdvisori, /zaraza/, 'mode lengkap memang memuat prosa nasihat');
  assert.match(lengkapAdvisori, /gemini-2\.5-flash-uji/);

  // Janji BACA-DULU menyebut tabel baru dan nasihatnya secara eksplisit.
  const janji = readFileSync(path.join(DIR_ANONIM, 'BACA-DULU.txt'), 'utf8');
  assert.match(janji, /advisori\.csv/);
  assert.match(janji, /Prosa nasihat/, 'janji anonim menyebut nasihat yang dibuang');
});
