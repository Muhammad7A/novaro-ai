/**
 * Uji uji-hidup — fungsi-fungsi murni yang menopang bukti live.
 *
 * Yang diuji di sini BUKAN panggilan AI-nya — itu hanya bisa dibuktikan oleh
 * eksekusi nyata terhadap layanan terdeploy (artefaknya ada di test_reports/).
 * Yang diuji adalah sambungan yang bila salah TIDAK meledak melainkan
 * membocorkan atau membatalkan bukti: log deploy yang salah urai, env
 * rahasia yang ikut terekam, dan perkiraan biaya yang diam-diam jadi nol.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { bacaArgv, parseDeployLog, perkiraanBiaya, potong, rekamExaminerRiwayat, rekamInterviuMulai, rekamInterviuSelesai, rekamProposalKonfirmasi, rekamProposalReplay, rekamProposalScan, rekamRekomendasi, saringEnv, gambarNotaUji } from '../scripts/uji-hidup.js';

test('import uji-hidup tidak menjalankan apa pun (uji tetap tanpa jaringan)', () => {
  // Sengaja kosong: keberhasilan impor sendiri sudah buktinya — modul ini
  // mengeksekusi rantai uji hidup hanya bila dijalankan langsung dari CLI.
  assert.equal(typeof parseDeployLog, 'function');
});

test('parseDeployLog menemukan URL dan revisi di antara baris progres gcloud', () => {
  const log = [
    'Deploying to Cloud Run...',
    '  Creating revision... Done.',
    'Service [novaexplorer] revision [novaexplorer-00097-2vt] has been deployed',
    'https://novaexplorer-532597100979.asia-southeast2.run.app',
    'Some trailing notice line',
  ].join('\n');
  const hasil = parseDeployLog(log);
  assert.equal(hasil.baseUrl, 'https://novaexplorer-532597100979.asia-southeast2.run.app');
  assert.equal(hasil.revision, 'novaexplorer-00097-2vt');
});

test('parseDeployLog mengembalikan null untuk log yang tidak berisi keduanya', () => {
  const hasil = parseDeployLog('build sukses, tanpa baris deploy\n');
  assert.equal(hasil.baseUrl, null);
  assert.equal(hasil.revision, null);
});

test('saringEnv hanya merekam nilai kunci yang aman; rahasia jadi nama saja', () => {
  const { bernilai, hanyaNama } = saringEnv([
    { name: 'CLOUD_ML_REGION', value: 'us-central1' },
    { name: 'GEMINI_MODEL', value: 'gemini-2.5-flash' },
    { name: 'NODE_ENV', value: 'production' },
    { name: 'DATABASE_URL', value: 'postgresql://rahasia' },
      { name: 'NOVA_PROPOSAL_SECRET', value: 'NILAI-YANG-TIDAK-BOLEH-TEREKAM' },
    { name: 'ANTHROPIC_API_KEY', valueFrom: { secretKeyRef: { name: 'anthropic-api-key', key: 'latest' } } },
  ]);

  assert.deepEqual(bernilai, {
    CLOUD_ML_REGION: 'us-central1',
    GEMINI_MODEL: 'gemini-2.5-flash',
    NODE_ENV: 'production',
  });
  // Nilainya TIDAK BOLEH ikut di mana pun — termasuk daftar nama.
  const teks = JSON.stringify({ bernilai, hanyaNama });
  assert.ok(!teks.includes('rahasia'), 'nilai DATABASE_URL bocor');
  assert.ok(!teks.includes('NILAI-YANG-TIDAK-BOLEH-TEREKAM'), 'nilai secret proposal bocor');

  const db = hanyaNama.find((e) => e.nama === 'DATABASE_URL');
  assert.ok(db && db.secret === false);
  const kunci = hanyaNama.find((e) => e.nama === 'ANTHROPIC_API_KEY');
  assert.ok(kunci && kunci.secret === true);
});

test('perkiraanBiaya gemini: tarif 0.30/2.50 per juta, cache dibaca setara input (batas atas)', () => {
  const h = perkiraanBiaya('gemini', { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 });
  // 0.30 + 2.50 + 0.30 (cache_read tanpa diskon) = 3.10 USD
  assert.equal(h.usd, 3.1);
  assert.equal(h.tarif.asal.includes('Gemini 2.5 Flash'), true);
  assert.ok(h.tarif.asOf, 'tarif wajib membawa tanggal berlaku');
});

test('perkiraanBiaya anthropic: 3/15 dengan cache 1.25x/0.1x', () => {
  const h = perkiraanBiaya('anthropic', {
    input_tokens: 1_000_000, output_tokens: 1_000_000,
    cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000,
  });
  // 3 + 15 + 3.75 + 0.3 = 22.05 USD
  assert.equal(h.usd, 22.05);
});

test('perkiraanBiaya backend tak dikenali: null, bukan angka tebak-tebakan', () => {
  assert.equal(perkiraanBiaya('gemmeni', {}), null);
  assert.equal(perkiraanBiaya('', {}), null);
});

test('perkiraanBiaya tanpa usage: nol token, nol biaya, tetap terurai', () => {
  const h = perkiraanBiaya('gemini', null);
  assert.equal(h.usd, 0);
});

test('potong memangkas teks panjang dan membiarkan teks pendek utuh', () => {
  assert.equal(potong('abc'), 'abc');
  assert.equal(potong('abc', 2), 'ab…');
  assert.equal(potong(undefined), '');
});

/* ------------------- Rung rekomendasi (fase 3, tanpa panggilan live) ---- */

const JAWABAN_SAH = {
  recommendations: {
    ringkasan: 'Laba sehat, rapikan prive.',
    rekomendasi: [{ judul: 'Tetapkan prive mingguan', prioritas: 'sedang' }],
    peringatan: ['prive hampir menyamai laba'],
    targetBulanIni: ['atur jadwal prive'],
    generatedAt: '2026-09-12T03:00:00.000Z',
    sumber: 'ai',
    model: 'gemini-2.5-flash',
  },
  anggaran: { harian: { terpakai: 640 }, mingguan: { terpakai: 900 } },
};

test('rekamRekomendasi: jawaban sah lulus — provenansi dari slot, anggaran ikut', () => {
  const r = rekamRekomendasi(JAWABAN_SAH, 200, 1234);
  assert.equal(r.langkah, 'rekomendasi');
  assert.equal(r.lulus, true);
  assert.equal(r.jumlah, 1);
  assert.equal(r.jumlahPeringatan, 1);
  assert.equal(r.jumlahTarget, 1);
  assert.equal(r.sumber, 'ai');
  assert.equal(r.model, 'gemini-2.5-flash', 'model dilaporkan apa adanya dari slot tersimpan');
  assert.equal(r.anggaranSesudah?.harian?.terpakai, 640, 'delta anggaran adalah bukti pemakaian provider');
  assert.ok(r.pratinjau.ringkasan.includes('Laba sehat'), 'pratinjau dipotong, bukan dihapus');
});

test('rekamRekomendasi: model tak dikenal tetap null — tidak pernah dikarang', () => {
  const tanpaModel = structuredClone(JAWABAN_SAH);
  delete tanpaModel.recommendations.model;
  const r = rekamRekomendasi(tanpaModel, 200, 10);
  assert.equal(r.lulus, true);
  assert.equal(r.model, null);
});

test('rekamRekomendasi gagal jujur: slot hilang, butir kosong, status bukan 200', () => {
  assert.equal(rekamRekomendasi({}, 200, 5).lulus, false);
  assert.match(rekamRekomendasi({}, 200, 5).alasan, /tanpa slot/);
  const kosong = structuredClone(JAWABAN_SAH);
  kosong.recommendations.rekomendasi = [];
  const r = rekamRekomendasi(kosong, 200, 5);
  assert.equal(r.lulus, false);
  assert.match(r.alasan, /tanpa satu pun butir/);
  const gagal = rekamRekomendasi(JAWABAN_SAH, 502, 5);
  assert.equal(gagal.lulus, false);
  assert.match(gagal.alasan, /status 502/);
});

/* ------------------- Rung proposal (fase 5, tanpa panggilan live) -------- */

test('gambarNotaUji: PNG sah deterministik — magic, ukuran, byte-identik', () => {
  const a = gambarNotaUji();
  const b = gambarNotaUji();
  assert.equal(a.slice(0, 8).toString('hex'), '89504e470d0a1a0a', 'magic PNG');
  assert.ok(a.length > 50 && a.length < 500, 'kecil dan tetap sah');
  assert.deepEqual(a, b, 'deterministik — artefak rung bisa dibandingkan');
});

test('rekamProposalScan: token ada = lulus; 200 tanpa proposal = konfigurasi jujur disebut', () => {
  const baik = rekamProposalScan(
    { proposal: { id: 'prop_000000000000', token: 'np1.xxx.yyy' }, hasil: { tingkat: 'ok' }, anggaran: { harian: { terpakai: 10 } } },
    200, 120,
  );
  assert.equal(baik.lulus, true);
  assert.equal(baik.proposalId, 'prop_000000000000');
  assert.equal(baik.tingkat, 'ok');
  assert.equal(baik.anggaranSesudah.harian.terpakai, 10);

  const fiturMati = rekamProposalScan({ hasil: {} }, 200, 120);
  assert.equal(fiturMati.lulus, false);
  assert.match(fiturMati.alasan, /NOVA_PROPOSAL_SCAN/, 'kegagalan konfigurasi disebut nama env-nya');
  assert.equal(rekamProposalScan({}, 503, 5).lulus, false);
});

test('rekamProposalKonfirmasi: baris origin proposal + id cocok; yang lain jujur gagal', () => {
  const baik = rekamProposalKonfirmasi(
    { transaction: { id: 'trx_a', origin: 'proposal', proposalId: 'prop_1' } },
    201, 90, 'prop_1',
  );
  assert.equal(baik.lulus, true);
  assert.equal(baik.transactionId, 'trx_a');

  // Baris lahir tapi bukan dari usulan (origin manual) — bukan lulusan rung ini.
  const manual = rekamProposalKonfirmasi({ transaction: { origin: 'manual' } }, 201, 5, 'prop_1');
  assert.equal(manual.lulus, false);
  assert.match(manual.alasan, /origin: manual/);
  // Id tidak cocok = token usulan lain — jangan dianggap bukti rantai ini.
  const silang = rekamProposalKonfirmasi({ transaction: { origin: 'proposal', proposalId: 'prop_lain' } }, 201, 5, 'prop_1');
  assert.equal(silang.lulus, false);
  assert.equal(rekamProposalKonfirmasi({}, 400, 5).lulus, false);
});

test('rekamProposalReplay: wajib 409 duplikat — bukan 404, bukan 201 kedua', () => {
  assert.equal(rekamProposalReplay({ kode: 'duplikat' }, 409, 5).lulus, true);
  assert.equal(rekamProposalReplay({ kode: 'token-tak-sah' }, 400, 5).lulus, false);
  assert.equal(rekamProposalReplay({ transaction: {} }, 201, 5).lulus, false);
  assert.match(rekamProposalReplay({}, 500, 5).alasan, /sekali pakai/);
});

/* ------------------- Rung interviu (fase 3, tanpa panggilan live) -------- */

test('rekamInterviuMulai: 503 = skipped jujur (hijau, bukan gagal); 200 sah membawa intakeId', () => {
  const lewat = rekamInterviuMulai({}, 503, 40);
  assert.equal(lewat.lulus, true, 'sidecar off bukan drama merah');
  assert.equal(lewat.skipped, 'sidecar off');

  const baik = rekamInterviuMulai({ intakeId: 'int_00000000aaaa', pertanyaan: 'Berapa kas akhir bulan?' }, 200, 90);
  assert.equal(baik.lulus, true);
  assert.equal(baik.intakeId, 'int_00000000aaaa');

  assert.equal(rekamInterviuMulai({ intakeId: 'sampah' }, 200, 5).lulus, false);
  assert.equal(rekamInterviuMulai({}, 500, 5).lulus, false);
});

test('rekamInterviuSelesai: wajib selesai true + coverage 0..1', () => {
  assert.equal(rekamInterviuSelesai({ selesai: true, coverage: 0.75 }, 200, 10).lulus, true);
  assert.equal(rekamInterviuSelesai({ selesai: false, coverage: 0.2 }, 200, 10).lulus, false);
  assert.equal(rekamInterviuSelesai({ selesai: true, coverage: 1.5 }, 200, 10).lulus, false);
  assert.equal(rekamInterviuSelesai({}, 502, 10).lulus, false);
});

test('rekamExaminerRiwayat: ok/insufficient lulus; unavailable gagal jujur; tanpa examiner gagal', () => {
  const ok = rekamExaminerRiwayat({ examiner: { verdict: 'ok', coverage: 0.75, perArea: [{ area: 'cash', coverage: 0.9 }] } });
  assert.equal(ok.lulus, true);
  assert.equal(ok.verdict, 'ok');
  assert.equal(ok.jumlahArea, 1);

  const tipis = rekamExaminerRiwayat({ examiner: { verdict: 'insufficient', coverage: 0.35, perArea: [] } });
  assert.equal(tipis.lulus, true, 'insufficient adalah data jujur — bukan galat rung');

  const tak = rekamExaminerRiwayat({ examiner: { verdict: 'unavailable' } });
  assert.equal(tak.lulus, false, 'sidecar hidup tapi examiner tidak = rantai belum lengkap');
  assert.match(tak.alasan, /examiner sidecar/);

  assert.equal(rekamExaminerRiwayat({}).lulus, false);
});

test('bacaArgv tanpa --ai-route jatuh ke default chat (regresi CI 2026-09-28)', () => {
  // Bug nyata: langkah uji-hidup di Cloud Build memanggil skrip ini TANPA
  // --ai-route; nilai() mengembalikan undefined (bukan null), dan cek lama
  // `rute !== null` melempar "diterima: undefined" setelah deploy sukses.
  const opsi = bacaArgv(['node', 'uji-hidup.js', '--project', 'p', '--region', 'r', '--service', 's']);
  assert.equal(opsi.aiRoute, 'chat', 'tanpa bendera, rung chat default, tanpa lemparan');

  const eksplisit = bacaArgv(['node', 'uji-hidup.js', '--ai-route', 'proposal']);
  assert.equal(eksplisit.aiRoute, 'proposal');

  assert.throws(() => bacaArgv(['node', 'uji-hidup.js', '--ai-route', 'aneh']), /harus 'chat'/);
});
