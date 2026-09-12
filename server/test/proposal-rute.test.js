/**
 * Uji ujung-ke-ujung rel proposal T1 surface #1 (scan-nota) — fase 5.
 *
 * Rantai penuh dengan penyedia palsu bergaya Anthropic (pola rekomendasi/
 * check-up): scan → token → peristiwa shown → KONFIRMASI lewat /api/cashbook
 * (satu-satunya pintu simpan — desain FDM §5) → baris origin 'proposal' →
 * join turunan shown ⋈ baris. Plus jalur tolak eksplisit, replay 409, token
 * palsu = nol efek samping, fitur MATI = bentuk lama, dan kejujuran HTML.
 *
 *   npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-proposal-rute-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.NOVA_AI_BACKEND = 'anthropic';
process.env.ANTHROPIC_API_KEY = '';
delete process.env.GOOGLE_CLOUD_PROJECT;
// Fitur proposal AKTIF untuk mayoritas uji; uji terakhir mematikannya.
process.env.NOVA_PROPOSAL_SCAN = '1';
process.env.NOVA_PROPOSAL_SECRET = 'rahasia-e2e-proposal';
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { store } = await import('../lib/store.js');
const { CONSENT_VERSION } = await import('../lib/consent.js');
const app = (await import('../server.js')).default;

/* ------------------- Penyedia palsu (SATU server, tubuh tetap) ------------ */

const NOTA_JSON = JSON.stringify({
  type: 'expense', amount: '12000', category: 'kopi',
  date: new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10),
  merchant: 'Warung Kopi Uji', description: 'kopi susu', confidence: 0.9,
});
const penyediaPalsu = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const usage = { input_tokens: 700, output_tokens: 200 };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const w = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify(d)}\n\n`);
    w('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [], stop_reason: null, usage } });
    w('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    w('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: NOTA_JSON } });
    w('content_block_stop', { type: 'content_block_stop' });
    w('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage });
    w('message_stop', { type: 'message_stop' });
    res.end();
  });
});
await new Promise((r) => penyediaPalsu.listen(0, r));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${penyediaPalsu.address().port}`;
process.env.ANTHROPIC_API_KEY = 'sk-ant-uji';

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => {
  server.close();
  penyediaPalsu.close();
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
});

const AKAR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HARI_INI = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

const minta = (jalur, { kode, ...opts } = {}) =>
  fetch(BASE + jalur, {
    ...opts,
    headers: {
      ...(opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(kode ? { Authorization: `Bearer ${kode}` } : {}),
      ...(opts.headers ?? {}),
    },
  });

const penggunaDisk = (id) => {
  const raw = JSON.parse(readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8'));
  return raw.users.find((u) => u.id === id);
};

/** Gambar sah secukupnya — penyedia palsu, isinya tak relevan. */
const JPEG_SAH_CUKUP = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(256, 0x11)]);

const scan = (kode) => minta('/api/scan-nota', {
  kode, method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: JPEG_SAH_CUKUP,
});

const peserta = async (nama) => {
  const { user, accessCode } = await store.createUser({ name: nama, business: '', batch: 'B1' });
  await store.saveConsent(user.id, CONSENT_VERSION);
  return { id: user.id, kode: accessCode };
};

/* ================================ Rantai e2e ============================== */

test('e2e: scan → token+shown → konfirmasi lewat rute kas → origin benar → join benar', async () => {
  const p = await peserta('Bu E2E');

  // 1 — scan: usulan bertoken + peristiwa shown; nol baris.
  const s = await scan(p.kode);
  assert.equal(s.status, 200);
  const sBody = await s.json();
  assert.ok(sBody.proposal?.token, 'token diterbitkan saat fitur aktif');
  assert.match(sBody.proposal.id, /^prop_[0-9a-f]{12}$/);
  assert.equal(sBody.hasil.tingkat, 'ok');
  assert.ok(sBody.anggaran, 'anggaran ikut — bukti pemakaian provider rung');

  const setelahScan = penggunaDisk(p.id);
  assert.equal(setelahScan.transactions.length, 0, 'scan tetap tidak menulis baris');
  const shown = setelahScan.events.find((e) => e.type === 'proposal_shown');
  assert.deepEqual(shown.meta, { id: sBody.proposal.id, tier: 'ok' });

  // 2 — konfirmasi: rute kas biasa + proposalToken; peserta MENGEDIT jumlah
  //     (12000 dari AI → 15000 keputusan manusia) — edited-then-confirmed sah.
  const k = await minta('/api/cashbook', {
    kode: p.kode, method: 'POST',
    body: JSON.stringify({
      jenis: 'keluar', kategori: 'operasional', jumlah: 15000,
      keterangan: 'kopi susu (dikoreksi)', tanggal: HARI_INI,
      proposalToken: sBody.proposal.token,
    }),
  });
  assert.equal(k.status, 201);
  const kBody = await k.json();
  assert.equal(kBody.transaction.origin, 'proposal');
  assert.equal(kBody.transaction.proposalId, sBody.proposal.id);
  assert.equal(kBody.transaction.jumlah, 15000, 'angka tersimpan = angka konfirmasi manusia, bukan angka model');

  // 3 — join turunan: shown ⋈ baris tersambung; stempel fitur terpasang.
  const disk = penggunaDisk(p.id);
  assert.equal(disk.transactions.length, 1);
  assert.equal(disk.transactions[0].proposalId, shown.meta.id);
  assert.equal(disk.featureVersions['proposal-scan'], 1);
  // TANPA delta event: penerimaan bukan peristiwa.
  assert.ok(!disk.events.some((e) => e.type.startsWith('proposal_') && e.type !== 'proposal_shown'));
});

test('replay token terkonsumsi → 409 duplikat; baris tetap satu', async () => {
  const p = await peserta('Bu Replay Rute');
  const sBody = await (await scan(p.kode)).json();
  const k1 = await minta('/api/cashbook', {
    kode: p.kode, method: 'POST',
    body: JSON.stringify({ jenis: 'keluar', kategori: 'operasional', jumlah: 1000, keterangan: 'x', tanggal: HARI_INI, proposalToken: sBody.proposal.token }),
  });
  assert.equal(k1.status, 201);
  const k2 = await minta('/api/cashbook', {
    kode: p.kode, method: 'POST',
    body: JSON.stringify({ jenis: 'keluar', kategori: 'operasional', jumlah: 1000, keterangan: 'x', tanggal: HARI_INI, proposalToken: sBody.proposal.token }),
  });
  assert.equal(k2.status, 409);
  assert.equal((await k2.json()).kode, 'duplikat');
  assert.equal(penggunaDisk(p.id).transactions.length, 1);
});

test('token palsu di konfirmasi → 400 token-tak-sah, nol efek samping', async () => {
  const p = await peserta('Bu Palsu Rute');
  await scan(p.kode); // shown tercatat — bukan prasyarat konfirmasi
  const k = await minta('/api/cashbook', {
    kode: p.kode, method: 'POST',
    body: JSON.stringify({ jenis: 'keluar', kategori: 'operasional', jumlah: 1000, keterangan: 'x', tanggal: HARI_INI, proposalToken: 'np1.eyJ2IjoxfQ.deadbeef' }),
  });
  assert.equal(k.status, 400);
  assert.equal((await k.json()).kode, 'token-tak-sah');
  const disk = penggunaDisk(p.id);
  assert.equal(disk.transactions.length, 0);
  assert.ok(!disk.featureVersions?.['proposal-scan']);
});

/* ------------------------------- Jalur tolak ------------------------------ */

test('tolak: eksplisit → proposal_rejected sekali; idempoten; tanpa baris', async () => {
  const p = await peserta('Bu Tolak Rute');
  const sBody = await (await scan(p.kode)).json();

  const t1 = await minta('/api/proposal/tolak', {
    kode: p.kode, method: 'POST', body: JSON.stringify({ proposalId: sBody.proposal.id }),
  });
  assert.equal(t1.status, 200);
  assert.deepEqual(await t1.json(), { sudah: false });

  const t2 = await minta('/api/proposal/tolak', {
    kode: p.kode, method: 'POST', body: JSON.stringify({ proposalId: sBody.proposal.id }),
  });
  assert.equal(t2.status, 200);
  assert.deepEqual(await t2.json(), { sudah: true });

  const disk = penggunaDisk(p.id);
  const tolak = disk.events.filter((e) => e.type === 'proposal_rejected');
  assert.equal(tolak.length, 1);
  assert.deepEqual(tolak[0].meta, { id: sBody.proposal.id });
  assert.equal(disk.transactions.length, 0, 'penolakan tidak pernah menjadi uang');

  // Tolak tetap sah SETELAH ditolak — manusia berubah pikiran via scan ulang;
  // token masih hidup sampai TTL-nya (konsumsi = keberadaan baris saja).
  const k = await minta('/api/cashbook', {
    kode: p.kode, method: 'POST',
    body: JSON.stringify({ jenis: 'keluar', kategori: 'operasional', jumlah: 1000, keterangan: 'x', tanggal: HARI_INI, proposalToken: sBody.proposal.token }),
  });
  assert.equal(k.status, 201);
  assert.equal((await k.json()).transaction.origin, 'proposal');
});

test('gerbang tolak: 401 tanpa kode; 400 id tak dikenali', async () => {
  const p = await peserta('Bu Gerbang Tolak');
  const t = await minta('/api/proposal/tolak', { method: 'POST', body: JSON.stringify({ proposalId: 'prop_000000000000' }) });
  assert.equal(t.status, 401);
  const t2 = await minta('/api/proposal/tolak', {
    kode: p.kode, method: 'POST', body: JSON.stringify({ proposalId: 'bukan-id' }),
  });
  assert.equal(t2.status, 400);
});

/* ------------------------------- Fitur MATI ------------------------------- */

test('fitur MATI: scan 200 tanpa proposal, tanpa peristiwa shown — bentuk lama', async () => {
  const p = await peserta('Bu Mati');
  delete process.env.NOVA_PROPOSAL_SCAN;
  try {
    const s = await scan(p.kode);
    assert.equal(s.status, 200);
    const body = await s.json();
    assert.ok(body.hasil);
    assert.ok(!('proposal' in body), 'tanpa token, tanpa medan proposal — bentuk lama');
    assert.ok(body.anggaran, 'anggaran tetap ikut (aditif, milik semua mode)');
    const disk = penggunaDisk(p.id);
    assert.ok(!disk.events.some((e) => e.type === 'proposal_shown'), 'tidak ada shown tanpa token');
    assert.equal(disk.transactions.length, 0);
  } finally {
    process.env.NOVA_PROPOSAL_SCAN = '1';
  }
});

/* --------------------------- Kejujuran tampilan --------------------------- */

test('HTML jujur: satu-ketuk berlabel, badge asal + tanggal konfirmasi, tombol buang', () => {
  const html = readFileSync(path.join(AKAR, 'public', 'index.html'), 'utf8');
  assert.match(html, /Simpan Usulan/, 'tombol satu-ketuk bernama apa adanya');
  assert.match(html, /Buang Usulan/, 'penolakan eksplisit tersedia');
  assert.match(html, /dari usulan pemindaian, dikonfirmasi /, 'badge kebenaran tampilan membawa tanggal');
  assert.match(html, /dari usulan pemindaian/, 'baris daftar berlabel asal');
  assert.match(html, /\/proposal\/tolak/, 'penolakan lewat endpoint eksplisit');
  assert.match(html, /proposalToken/, 'token ikut konfirmasi lewat rute kas — bukan jalur kedua');
  assert.doesNotMatch(html, /gemini/i, 'rambu lama tetap: tanpa nama model statis');
});
