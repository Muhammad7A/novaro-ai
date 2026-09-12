/**
 * Uji rel proposal T1 surface #1 (scan-nota) — sesi G fase 4.
 *
 * Otorisasi: addendum §25 AI-TRUST-AUTOPILOT 2026-09-12 (T1 HANYA scan-nota;
 * T2/T3 tetap terlarang; surface #2 butuh prasyarat 12; exposure default MATI).
 *
 * Yang dijaga di sini (stop-ship bila pecah):
 *   - token HMAC sekali-pakai: bentuk np1 + tokenVersion + TTL 15 menit;
 *     tanpa rahasia, penerbitan menolak diri (null), bukan token lemah;
 *   - konsumsi HANYA di mutator: origin 'proposal' lahir dari token yang
 *     lolos verifikasi; tubuh permintaan tidak punya jalan menyetelnya;
 *   - jti = KEBERADAAN BARIS (label jujur): replay token → 409 duplikat;
 *   - mesin tetap tidak pernah menulis penghasilan — tak tersentuh;
 *   - proposal_shown menunggangi SATU tulisan usage+event; proposal_rejected
 *     eksplisit saja dan idempoten; TANPA delta event — penerimaan diturunkan
 *     dari shown ⋈ baris;
 *   - gagal apa pun (token kadaluarsa/palsu/replay) = NOL efek samping;
 *   - M0-lite: manifest set-berkas-ter + resolver DATA_DIR kanonik + prune
 *     berpasangan dengan manifest.
 *
 *   npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-proposal-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.NOVA_AI_BACKEND = 'anthropic';
process.env.ANTHROPIC_API_KEY = '';
delete process.env.GOOGLE_CLOUD_PROJECT;
// M0-lite: rotasi kecil supaya pasangan prune manifest terlihat cepat.
process.env.BACKUP_KEEP = '2';
// Rahasia dipasang sejak awal seperti di produksi (env stabil) — uji "tanpa
// rahasia" menurunkannya sementara lalu memulihkannya.
process.env.NOVA_PROPOSAL_SECRET = 'rahasia-uji-proposal-jangan-dipakai-di-mana-pun';
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { store, GalatMutasi } = await import('../lib/store.js');
const {
  ALASAN_TOLAK_SAH, TOKEN_VERSION, TTL_MS, buatIdProposal, bukaToken,
  proposalScanAktif, terbitkanToken,
} = await import('../lib/proposal.js');
const { periksaMetaJejak } = await import('../lib/jejak.js');
const { CONSENT_VERSION } = await import('../lib/consent.js');
const { KEEP, direktoriData, manifestData, runBackup } = await import('../lib/backup.js');

const HARI_INI = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const penggunaDisk = (id) =>
  JSON.parse(readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8')).users.find((u) => u.id === id);

/* ------------------------------------------------------------ Token murni */

test('token: terbitkan → buka sekali-jalan; bentuk np1 + TTL 15 menit', () => {
      const id = buatIdProposal();
    assert.match(id, /^prop_[0-9a-f]{12}$/);
    const token = terbitkanToken({ proposalId: id, tingkat: 'ok' });
    assert.ok(token.startsWith(`np${TOKEN_VERSION}.`), 'awalan membawa tokenVersion');
    const isi = bukaToken(token);
    assert.equal(isi.proposalId, id);
    assert.equal(isi.tingkat, 'ok');
    // TTL tercantum di payload — 15 menit persis dari penerbitan.
    const mentah = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    assert.equal(mentah.exp - mentah.iat, TTL_MS);
    assert.equal(TTL_MS, 15 * 60 * 1000);
});

test('token tanpa rahasia: penerbitan menolak diri (null) — tidak ada token lemah', () => {
  const lama = process.env.NOVA_PROPOSAL_SECRET;
  delete process.env.NOVA_PROPOSAL_SECRET;
  try {
    assert.equal(terbitkanToken({ proposalId: buatIdProposal() }), null);
  } finally {
    process.env.NOVA_PROPOSAL_SECRET = lama;
  }
});

test('token kedaluwarsa ditolak dengan kode bertipe', () => {
      const kini = new Date('2026-09-12T04:00:00Z');
    const token = terbitkanToken({ proposalId: buatIdProposal() }, { kini });
    const lewat = new Date(kini.getTime() + TTL_MS + 1);
    assert.throws(() => bukaToken(token, { kini: lewat }), (e) => e.kode === 'token-kedaluwarsa' && e.status === 400);
    // Satu milidetik sebelum batas: masih hidup.
    assert.ok(bukaToken(token, { kini: new Date(kini.getTime() + TTL_MS - 1) }).proposalId);
});

test('token palsu: MAC dirusak, bentuk asing, versi asing — semua ditolak', () => {
      const token = terbitkanToken({ proposalId: buatIdProposal() });
    const [awal, body, mac] = token.split('.');
    const rusakMac = `${awal}.${body}.${mac.slice(0, -1)}${mac.at(-1) === '0' ? '1' : '0'}`;
    assert.throws(() => bukaToken(rusakMac), (e) => e.kode === 'token-tak-sah');
    assert.throws(() => bukaToken('bukan.token'), (e) => e.kode === 'token-tak-sah');
    assert.throws(() => bukaToken(null), (e) => e.kode === 'token-tak-sah');
    // Payload ditulis ulang dengan id lain tapi MAC lama — tidak lolos.
    const mentah = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    const palsu = Buffer.from(JSON.stringify({ ...mentah, id: buatIdProposal() }), 'utf8').toString('base64url');
    assert.throws(() => bukaToken(`${awal}.${palsu}.${mac}`), (e) => e.kode === 'token-tak-sah');
    // Rahasia berbeda: MAC tidak cocok.
    const asli = process.env.NOVA_PROPOSAL_SECRET;
    process.env.NOVA_PROPOSAL_SECRET = 'rahasia-lain';
    assert.throws(() => bukaToken(token), (e) => e.kode === 'token-tak-sah');
    process.env.NOVA_PROPOSAL_SECRET = asli;
});

test('gerbang fitur: default MATI; hanya literal "1" yang membuka', () => {
  delete process.env.NOVA_PROPOSAL_SCAN;
  assert.equal(proposalScanAktif(), false);
  process.env.NOVA_PROPOSAL_SCAN = '0';
  assert.equal(proposalScanAktif(), false, '"0" bukan "hidup" — konvensi literal-1');
  process.env.NOVA_PROPOSAL_SCAN = 'true';
  assert.equal(proposalScanAktif(), false, '"true" pun bukan — tidak ada tebakan');
  process.env.NOVA_PROPOSAL_SCAN = '1';
  assert.equal(proposalScanAktif(), true);
  delete process.env.NOVA_PROPOSAL_SCAN;
});

/* ------------------------------------------------- Konsumsi di mutator */

async function pesertaBaru(nama) {
  const { user } = await store.createUser({ name: nama, business: '', batch: 'B1' });
  await store.saveConsent(user.id, CONSENT_VERSION);
  return user;
}

const transaksiSah = () => ({
  tanggal: HARI_INI, jenis: 'keluar', kategori: 'operasional', keterangan: 'nota kopi', jumlah: 12_000,
});

test('konsumsi: token sah → origin proposal + proposalId + stempel fitur + event origin', async () => {
  const user = await pesertaBaru('Bu Proposal');
  let token;
      token = terbitkanToken({ proposalId: buatIdProposal(), tingkat: 'warning' });

  const row = await store.addTransaction(user.id, transaksiSah(), { aktor: 'manusia', proposalToken: token });
  assert.equal(row.origin, 'proposal');
  assert.match(row.proposalId, /^prop_[0-9a-f]{12}$/);

  const disk = penggunaDisk(user.id);
  assert.equal(disk.featureVersions['proposal-scan'], 1, 'stempel fitur M1 set-if-absent');
  const ev = disk.events.find((e) => e.type === 'transaction_added');
  assert.equal(ev.meta.origin, 'proposal');
  // Meta event TIDAK membawa proposalId — join bekerja via baris (skema jejak tidak melebar).
  assert.ok(!('proposalId' in ev.meta));
});

test('STOP-SHIP: origin/proposalId palsu dari tubuh TIDAK PERNAH mencapai ledger', async () => {
  const user = await pesertaBaru('Bu Palsu');
  const row = await store.addTransaction(user.id, {
    ...transaksiSah(),
    origin: 'proposal', proposalId: 'prop_000000000000', id: 'trx_palsu',
  }, { aktor: 'manusia' });
  assert.equal(row.origin, 'manual', 'tanpa token, satu-satunya asal adalah manual');
  assert.equal(row.proposalId, undefined);
  assert.equal(row.id !== 'trx_palsu', true);
});

test('replay: token terkonsumsi dipakai lagi → 409 duplikat, tetap satu baris', async () => {
  const user = await pesertaBaru('Bu Replay');
  let token;
      token = terbitkanToken({ proposalId: buatIdProposal() });
  await store.addTransaction(user.id, transaksiSah(), { aktor: 'manusia', proposalToken: token });
  await assert.rejects(
    () => store.addTransaction(user.id, transaksiSah(), { aktor: 'manusia', proposalToken: token }),
    (e) => e instanceof GalatMutasi && e.kode === 'duplikat' && e.status === 409,
  );
  assert.equal((await store.getTransactions(user.id)).length, 1);
  // Konfirmasi KEDUA dari scan lain (token lain) tetap sah — jti per usulan.
  let token2;
      token2 = terbitkanToken({ proposalId: buatIdProposal() });
  const kedua = await store.addTransaction(user.id, transaksiSah(), { aktor: 'manusia', proposalToken: token2 });
  assert.equal(kedua.origin, 'proposal');
  assert.equal((await store.getTransactions(user.id)).length, 2);
});

test('gagal token = NOL efek samping: tidak ada baris, tidak ada event, tidak ada stempel', async () => {
  const user = await pesertaBaru('Bu Gagal Token');
  const kini = new Date(Date.now() - 2 * TTL_MS);
  let basi;
      basi = terbitkanToken({ proposalId: buatIdProposal() }, { kini });

  await assert.rejects(
    () => store.addTransaction(user.id, transaksiSah(), { aktor: 'manusia', proposalToken: basi }),
    (e) => e instanceof GalatMutasi && e.kode === 'token-kedaluwarsa',
  );
  const tokenPalsu = 'np1.eyJ2IjoxfQ.deadbeef';
  await assert.rejects(
    () => store.addTransaction(user.id, transaksiSah(), { aktor: 'manusia', proposalToken: tokenPalsu }),
    (e) => e instanceof GalatMutasi && e.kode === 'token-tak-sah',
  );

  const disk = penggunaDisk(user.id);
  assert.equal(disk.transactions.length, 0, 'tidak ada baris yang lahir dari token gagal');
  assert.equal(disk.events.filter((e) => e.type === 'transaction_added').length, 0);
  assert.ok(!disk.featureVersions?.['proposal-scan'], 'stempel fitur tidak ikut tertinggal');

  // Setelah kegagalan: konfirmasi manual biasa tetap hidup (degradasi jujur).
  const manual = await store.addTransaction(user.id, transaksiSah(), { aktor: 'manusia' });
  assert.equal(manual.origin, 'manual');
});

test('token tidak hangus oleh medan yang keliru — perbaiki lalu simpan', async () => {
  const user = await pesertaBaru('Bu Perbaikan');
  let token;
      token = terbitkanToken({ proposalId: buatIdProposal() });
  await assert.rejects(
    () => store.addTransaction(user.id, { ...transaksiSah(), jumlah: 0 }, { aktor: 'manusia', proposalToken: token }),
    (e) => e instanceof GalatMutasi && e.kode === 'jumlah',
  );
  const row = await store.addTransaction(user.id, transaksiSah(), { aktor: 'manusia', proposalToken: token });
  assert.equal(row.origin, 'proposal', 'token masih hidup setelah medan diperbaiki');
});

/* ------------------------------------------------ Peristiwa & penolakan */

test('proposal_shown menunggangi SATU tulisan usage+event — meta tertutup', async () => {
  const user = await pesertaBaru('Bu Shown');
  const id = buatIdProposal();
  const usage = { input_tokens: 7, output_tokens: 3 };

  await store.catatProposalScan(user.id, { id, tingkat: 'low' }, usage);
  await store.catatProposalScan(user.id, { id: buatIdProposal() }, usage); // tanpa tingkat

  const disk = penggunaDisk(user.id);
  assert.equal(disk.usage.requests, 2, 'usage tercatat dalam tulisan yang sama');
  const shown = disk.events.filter((e) => e.type === 'proposal_shown');
  assert.equal(shown.length, 2);
  assert.deepEqual(shown[0].meta, { id, tier: 'low' });
  assert.deepEqual(shown[1].meta, { id: shown[1].meta.id }); // hanya id — tier opsional
  for (const e of shown) {
    assert.deepEqual(periksaMetaJejak(e.type, e.meta), [], 'meta lolos gerbang struktural');
  }
  // Scan tidak pernah menulis baris — invarian lama tetap berdiri.
  assert.equal(disk.transactions.length, 0);
});

test('proposal_rejected: eksplisit, alasan kosakata tertutup, idempoten', async () => {
  const user = await pesertaBaru('Bu Tolak');
  const id = buatIdProposal();

  const pertama = await store.tolakProposal(user.id, id, 'salah-jumlah');
  assert.deepEqual(pertama, { sudah: false });
  const kedua = await store.tolakProposal(user.id, id); // ketukan ganda tanpa alasan
  assert.deepEqual(kedua, { sudah: true }, 'satu keputusan, satu peristiwa');

  await assert.rejects(
    () => store.tolakProposal(user.id, buatIdProposal(), 'karena enak'),
    (e) => e instanceof GalatMutasi && e.kode === 'alasan-tolak' && e.status === 400,
  );

  const tolak = penggunaDisk(user.id).events.filter((e) => e.type === 'proposal_rejected');
  assert.equal(tolak.length, 1);
  assert.deepEqual(tolak[0].meta, { id, alasan: 'salah-jumlah' });
  assert.deepEqual(periksaMetaJejak('proposal_rejected', tolak[0].meta), []);
  assert.equal(ALASAN_TOLAK_SAH.includes('lainnya'), true);
});

test('TANPA delta event: penerimaan tidak pernah menjadi peristiwa — hanya shown ⋈ baris', async () => {
  const user = await pesertaBaru('Bu Join');
  let token;
      token = terbitkanToken({ proposalId: buatIdProposal() });
  await store.catatProposalScan(user.id, { id: JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).id, tingkat: 'ok' }, { input_tokens: 1, output_tokens: 1 });
  await store.addTransaction(user.id, transaksiSah(), { aktor: 'manusia', proposalToken: token });

  const jenis = penggunaDisk(user.id).events.map((e) => e.type);
  assert.ok(!jenis.includes('proposal_accepted'), 'penerimaan bukan peristiwa — diturunkan dari baris');
  assert.ok(!jenis.includes('proposal_decided'));
  // Join yang dimaksud: shown membawa id, baris membawa proposalId yang sama.
  const shownId = penggunaDisk(user.id).events.find((e) => e.type === 'proposal_shown').meta.id;
  const baris = (await store.getTransactions(user.id)).find((t) => t.proposalId);
  assert.equal(baris.proposalId, shownId, 'shown ⋈ baris tersambung lewat id');
});

/* --------------------------------------------------- M0-lite: manifest */

test('manifest: set-berkas-ter terenumerasi — yang hilang terlihat, sha256 terbukti', async () => {
  await pesertaBaru('Bu Manifest'); // memastikan users.json ada

  const m = await manifestData();
  const jalur = Object.fromEntries(m.berkas.map((b) => [b.jalur, b]));
  assert.ok(jalur['users.json']?.ada, 'users.json tercantum dengan sha256');
  assert.match(jalur['users.json'].sha256, /^[0-9a-f]{64}$/);
  assert.equal(jalur['users-seed.json'].ada, false, 'berkas yang tidak ada tetap tercantum — temuan, bukan keheningan');
  assert.ok('validasi.json' in jalur, 'set-berkas-ter lengkap');

  // Sidiknya benar: hash ulang isi users.json cocok.
  const isi = readFileSync(path.join(DATA_DIR, 'users.json'));
  assert.equal(jalur['users.json'].sha256, createHash('sha256').update(isi).digest('hex'));

  // Resolver kanonik: env dipatuhi, tanpa env pun folder bawaan.
  assert.equal(direktoriData(), DATA_DIR);
});

test('runBackup menulis manifest berpasangan; prune membuang pasangannya', async () => {
  assert.equal(KEEP, 2, 'BACKUP_KEEP=2 dari env uji');
  const user = await pesertaBaru('Bu Rotasi');

  const info1 = await runBackup({ quiet: true });
  await store.addTransaction(user.id, transaksiSah(), { aktor: 'manusia' });
  const info2 = await runBackup({ quiet: true });
  await store.addTransaction(user.id, { ...transaksiSah(), jumlah: 999 }, { aktor: 'manusia' });
  const info3 = await runBackup({ quiet: true });

  const isi = readdirSync(path.join(DATA_DIR, 'backup'));
  const manifest1 = info1.file.replace(/^users-/, 'manifest-');
  const manifest3 = info3.file.replace(/^users-/, 'manifest-');
  // Rotasi KEEP=2: cadangan pertama dan manifest-nya pergi bersama.
  assert.ok(!existsSync(path.join(DATA_DIR, 'backup', info1.file)), 'cadangan tertua terbuang');
  assert.ok(!existsSync(path.join(DATA_DIR, 'backup', manifest1)), 'manifest pasangannya ikut pergi — tanpa yatim');
  assert.ok(existsSync(path.join(DATA_DIR, 'backup', manifest3)), 'manifest termuda tinggal');
  // Manifest tidak menyamar sebagai cadangan (pola rotasi hanya users-*).
  assert.ok(!manifest1.startsWith('users-'));

  // Isi manifest termuda mencantumkan users.json yang hidup.
  const m = JSON.parse(readFileSync(path.join(DATA_DIR, 'backup', manifest3), 'utf8'));
  assert.ok(m.berkas.some((b) => b.jalur === 'users.json' && b.ada));
  assert.ok(m.berkas.some((b) => b.jalur === `backup/${info2.file}`), 'cadangan lain ikut terenumerasi');
});
