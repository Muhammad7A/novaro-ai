/*
 * Gerbang struktural jejak peristiwa penelitian.
 *
 * Menggantikan jagaan contoh (satu nominal + satu nama) dengan penegakan
 * struktural: SETIAP peristiwa yang dihasilkan store, rute, dan data demo
 * diperiksa terhadap skema per-jenis di lib/jejak.js — medan di luar daftar
 * ditolak, nilai di luar jenisnya ditolak, dan teks bebas hanya boleh hidup
 * di medan yang TERDAFTAR di ratsu (daftar yang dipatok uji ini).
 *
 * Tiga kelas regresi yang dibunuh berkas ini:
 *   1. jenis peristiwa baru dengan meta asal — gugur di uji skema;
 *   2. medan teks bebas baru di jenis lama — gugur di ratsu + skema;
 *   3. normalisasi diam-diam pelanggaran lama — daftar ratsu dipatok
 *      persis, setiap perubahan wajib sadar dan terlihat di diff.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NOVA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'jejak-'));
process.on('exit', () => rmSync(process.env.NOVA_DATA_DIR, { recursive: true, force: true }));

import { store } from '../lib/store.js';
import { SKEMA_JEJAK, TEKS_BEBAS, periksaMetaJejak, bangMetaAnonim } from '../lib/jejak.js';
import { PERSONA_DEMO, isiDemoPenuh } from '../lib/demo-data.js';
import { CONSENT_VERSION } from '../lib/consent.js';

const AKAR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let idPeserta = null; // dipakai lintas uji — uji berjalan berurutan dalam satu berkas

test('seluruh mutator menghasilkan peristiwa yang terdaftar dan sah bentuknya', async () => {
  const { user } = await store.createUser({ name: 'Peserta Jejak', business: 'Warung Uji', batch: 'B1' });
  const id = user.id;
  idPeserta = id;

  await store.setMulai(id, '2026-09-01');
  await store.setMulai(id, null);
  await store.setBatch(id, 'B2'); // batch_assigned: pindahan B1 → B2 tercatat dengan sebelumnya
  await store.renameUser(id, { name: 'Bu Sari Santoso', business: 'Warung Sari Rasa' });
  await store.saveConsent(id, CONSENT_VERSION);
  await store.saveProfile(id, { ...PERSONA_DEMO[0].profil });
  const baris = await store.addTransaction(id, {
    tanggal: '2026-09-01', jenis: 'keluar', kategori: 'operasional',
    keterangan: 'Bayar utang ke Pak Haji Soleh', jumlah: 9_876_543,
  }, { aktor: 'manusia' });
  await store.deleteTransaction(id, baris.id);
  await store.appendChat(id, [
    { role: 'user', content: 'Kas kecil itu dicatat di mana?' },
    { role: 'assistant', content: 'Kas kecil dicatat sebagai transaksi keluar.' },
  ], { modul: 1 });
  await store.clearChat(id);
  await store.saveProgress(id, { done: { 1: true } });
  await store.simpanJawabanLatihan(id, 1, 0, true, 'kas kecil');
  await store.aturLatihanAI(id, 1, { kunci: 'A', konsep: 'arus kas', soal: 's', pilihan: ['a', 'b', 'c'] });
  await store.catatJawabanLatihanAI(id, 1, false);
  await store.tandaiPraktik(id, [1], 'transaksi');
  await store.simpanRekomendasi(id, {
    ringkasan: 'ringkasan uji', rekomendasi: [{ judul: 'judul uji' }],
    peringatan: ['peringatan uji'], targetBulanIni: [],
  }, { requests: 1, inputTokens: 10, outputTokens: 5 });
  await store.logEvent(id, 'login');
  await store.logEvent(id, 'anggaran_habis', { jenis: 'harian' });
  await store.logEvent(id, 'konteks_viewed');
  await store.logEvent(id, 'fokus_viewed');
  await store.logEvent(id, 'papan_viewed');
  await store.logEvent(id, 'report_viewed', { bulan: 2 });
  await store.logEvent(id, 'data_downloaded');
  await store.logEvent(id, 'ai_feedback', {
    rating: 'down', alasan: 'Jawaban AI salah soal kas warung Bu Sari', chatIndex: 0,
  });

  const peristiwa = await store.getEvents(id);
  const jenisTerlihat = peristiwa.map((e) => e.type).sort().join(',');

  // Pin kosakata: jumlah per jenis PERSIS. Peristiwa baru di salah satu
  // mutator = wajib lewat lib/jejak.js dulu — inilah gerbangnya.
  assert.equal(
    jenisTerlihat,
    [
      'ai_feedback', 'anggaran_habis', 'batch_assigned', 'belajar_dimulai',
      'belajar_dimulai', 'chat_cleared', 'chat_turn', 'consent_given',
      'data_downloaded', 'fokus_viewed', 'konteks_viewed', 'latihan_ai_dibuat',
      'latihan_ai_dijawab', 'latihan_dijawab', 'login', 'module_completed',
      'papan_viewed', 'peserta_dinamai', 'praktik_terverifikasi',
      'profile_saved', 'recommendations_generated', 'report_viewed',
      'transaction_added', 'transaction_deleted', 'user_created',
    ].join(','),
    'kosakata peristiwa berubah — daftarkan di lib/jejak.js dan perbarui pin ini secara sadar',
  );

  for (const e of peristiwa) {
    const pelanggaran = periksaMetaJejak(e.type, e.meta);
    assert.deepEqual(pelanggaran, [], `peristiwa ${e.type} melanggar skema jejak`);
  }
});

test('nominal, keterangan, dan nama tidak pernah bocor ke jejak — di luar medan terdaftar', async () => {
  const peristiwa = await store.getEvents(idPeserta);

  // Kontrol positif: teks terdaftar MEMANG ada di jejak lengkap — ratsu
  // membuatnya terlihat dan bisa diaudit, bukan menormalisasikannya diam-diam.
  const umpan = peristiwa.find((e) => e.type === 'ai_feedback');
  assert.match(umpan.meta.alasan, /salah soal kas/);
  const nama = peristiwa.find((e) => e.type === 'peserta_dinamai');
  assert.equal(nama.meta.sesudah.name, 'Bu Sari Santoso');

  // Setelah medan terdaftar dibuang: tidak ada lagi jejak nominal, nama,
  // keterangan, maupun teks AI di mana pun.
  const tersaring = peristiwa.map((e) => ({ type: e.type, meta: bangMetaAnonim(e.type, e.meta) }));
  const teks = JSON.stringify(tersaring);
  for (const terlarang of ['9876543', 'Soleh', 'Santoso', 'Sari Rasa', 'kas kecil', 'arus kas']) {
    assert.doesNotMatch(teks, new RegExp(terlarang), `teks bebas "${terlarang}" bocor ke jejak anonim`);
  }
});

test('setiap jenis peristiwa di kode terdaftar — dan tidak ada pendaftaran yang mati', () => {
  const baca = (f) => readFileSync(path.join(AKAR, f), 'utf8');

  const jenisDari = (teks, pola) => [...teks.matchAll(pola)].map((m) => m[1]);
  const terlihat = new Set([
    ...jenisDari(baca('lib/store.js'), /(?:pushEvent|logEvent)\(\s*[^,()\n]+,\s*'([a-z_]+)'/g),
    ...jenisDari(baca('server.js'), /logEvent\(\s*[^,()\n]+,\s*'([a-z_]+)'/g),
    // Hanya dorong PERISTIWA (bangunEvents), bukan dorong baris transaksi —
    // pemisahnya definisinya yang bertanda (type, ts, meta).
    ...jenisDari(baca('lib/demo-data.js').slice(baca('lib/demo-data.js').indexOf('const dorong = (type, ts, meta')), /dorong\('([a-z_]+)'/g),
  ]);

  const terdaftar = new Set(Object.keys(SKEMA_JEJAK));

  for (const jenis of terlihat) {
    assert.ok(terdaftar.has(jenis), `jenis peristiwa "${jenis}" dipancarkan kode tapi tidak terdaftar di lib/jejak.js`);
  }
  for (const jenis of terdaftar) {
    assert.ok(terlihat.has(jenis), `jenis "${jenis}" terdaftar di lib/jejak.js tapi tidak dipancarkan mana pun — hapus atau perbaiki pendaftarannya`);
  }
});

test('ratsu teks bebas: daftarnya PERSIS pelanggaran yang sudah diadjudikasi', () => {
  // Dua pelanggaran dinamai keputusan arsitektur (§2.4, §20.7); satu kandidat
  // tambahan ditemukan sesi C (konsep — §3). Menambah medan teks bebas ke-empat
  // TANPA menyentuh uji ini tidak mungkin; menyentuhnya berarti adjudikasi
  // sadar yang terlihat di diff.
  assert.deepEqual(TEKS_BEBAS, {
    peserta_dinamai: ['sebelum', 'sesudah'],
    ai_feedback: ['alasan'],
    latihan_dijawab: ['konsep'],
    latihan_ai_dijawab: ['konsep'],
  });
});

test('bangMetaAnonim membuang persis medan terdaftar — tidak lebih, tidak kurang', () => {
  assert.deepEqual(
    bangMetaAnonim('ai_feedback', { rating: 'down', alasan: 'keliru', chatIndex: 3 }),
    { rating: 'down', chatIndex: 3 },
  );
  assert.deepEqual(bangMetaAnonim('latihan_dijawab', { modul: 1, soal: 0, benar: true, konsep: 'kas' }), {
    modul: 1, soal: 0, benar: true,
  });
  // Nama peserta: seluruh meta habis — tidak ada versi parsial yang aman.
  assert.equal(bangMetaAnonim('peserta_dinamai', { sebelum: { name: 'A' }, sesudah: { name: 'B' } }), null);
  // Jenis tanpa teks bebas lolos utuh.
  assert.deepEqual(bangMetaAnonim('login', {}), {});
  assert.deepEqual(bangMetaAnonim('report_viewed', { bulan: 2 }), { bulan: 2 });
  // Meta kosong/tidak ada → null (sel CSV kosong), bukan "{}".
  assert.equal(bangMetaAnonim('login', undefined), null);
});

test('peristiwa data demo juga terdaftar dan sah bentuknya', () => {
  const peristiwa = isiDemoPenuh(PERSONA_DEMO[0]).events;
  assert.ok(peristiwa.length >= 5, 'data demo diharapkan membawa riwayat peristiwa');
  for (const e of peristiwa) {
    const pelanggaran = periksaMetaJejak(e.type, e.meta);
    assert.deepEqual(pelanggaran, [], `peristiwa demo ${e.type} melanggar skema jejak`);
  }
});
