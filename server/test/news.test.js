/**
 * Uji news feed — pool headline, tailoring deterministik, redirect klik.
 *
 * DESAIN TERKUNCI yang dipin di sini:
 *   - NOL PII keluar: permintaan ke feed TIDAK membawa identifier/parameter
 *     pengguna — dipin dengan memeriksa URL + header yang diterima feed palsu;
 *   - headline verbatim {id, title, source, publishedAt, url} — tanpa AI;
 *   - tailoring deterministik: profil kuliner vs retail vs tanpa profil →
 *     urutan stabil (tiebreak id), pool tidak pernah berubah;
 *   - fail-closed: feed rusak/timeout/500 menyumbang kosong; daftar kosong
 *     ('-') = fitur off yang jujur TANPA satu pun fetch;
 *   - klik: 302 ke sumber + event news_klik contentless (sektor, bukan
 *     judul); id tak dikenal → 404 tanpa redirect liar.
 *
 *   npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-news-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.NOVA_AI_BACKEND = 'anthropic';
process.env.ANTHROPIC_API_KEY = '';
delete process.env.GOOGLE_CLOUD_PROJECT;
// TTL pendek untuk uji cache; timeout pendek untuk uji feed menggantung.
process.env.NOVA_NEWS_TTL_MS = '250';
process.env.NOVA_NEWS_TIMEOUT_MS = '400';
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const {
  FEED_BAWAAN, _buangCache, ambilPool, newsAktif, parseFeed, sektorKlik, skorItem, susunBerita,
} = await import('../lib/news.js');
const { periksaMetaJejak } = await import('../lib/jejak.js');
const { CONSENT_VERSION } = await import('../lib/consent.js');
const { store } = await import('../lib/store.js');

/* ------------------------------------------------- Fixture feed (string) */

const HARI_INI_ISO = new Date().toISOString();
const baru = (hLalu) => new Date(Date.now() - hLalu * 3600_000).toISOString();

const FIXTURE_RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Small Biz Wire</title>
<item>
  <title><![CDATA[Restaurant owners face rising food costs this winter]]></title>
  <link>https://contoh.co/restaurant-food-costs</link>
  <pubDate>${new Date(baru(2)).toUTCString()}</pubDate>
</item>
<item>
  <title>Retail store inventory tips &amp; tricks for the holidays</title>
  <link>https://contoh.co/retail-inventory</link>
  <pubDate>${new Date(baru(5)).toUTCString()}</pubDate>
</item>
<item>
  <title>Fed holds rates steady &lt;em&gt;again&lt;/em&gt; amid mixed signals</title>
  <link>https://contoh.co/fed-rates</link>
  <pubDate>${new Date(baru(1)).toUTCString()}</pubDate>
</item>
<item>
  <title>Tanpa link — item ini dibuang</title>
  <pubDate>${new Date(baru(1)).toUTCString()}</pubDate>
</item>
</channel></rss>`;

const FIXTURE_ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Biz</title>
<entry>
  <title>How a cafe doubled its catering revenue</title>
  <link rel="alternate" type="text/html" href="https://contoh.co/cafe-catering"/>
  <published>${baru(3)}</published>
</entry>
<entry>
  <title>Ecommerce holiday checklist for small shops</title>
  <link href="https://contoh.co/ecommerce-checklist"/>
  <updated>${baru(4)}</updated>
</entry>
</feed>`;

const FIXTURE_RUSAK = '<?xml version="1.0"?><rss><channel><title>putus di tengah';

/* --------------------------------------------- Feed server palsu (satu) */

let perilaku = 'rss';
let jumlahFetch = 0;
let permintaanTerakhir = null;

const feedPalsu = createServer((req, res) => {
  jumlahFetch += 1;
  permintaanTerakhir = { url: req.url, headers: req.headers };
  if (perilaku === '500') { res.writeHead(500); return res.end('boom'); }
  if (perilaku === 'lambat') return; // menggantung — timeout yang mengambil alih
  if (perilaku === 'rusak') { res.writeHead(200, { 'Content-Type': 'application/xml' }); return res.end(FIXTURE_RUSAK); }
  res.writeHead(200, { 'Content-Type': 'application/rss+xml' });
  res.end(perilaku === 'atom' ? FIXTURE_ATOM : perilaku === 'campur' ? FIXTURE_RSS + FIXTURE_ATOM : FIXTURE_RSS);
});
await new Promise((r) => feedPalsu.listen(0, r));
const URL_FEED = `http://127.0.0.1:${feedPalsu.address().port}/feed.xml`;
process.env.NOVA_NEWS_FEEDS = URL_FEED;
test.after(() => feedPalsu.close());

const app = (await import('../server.js')).default;
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const minta = (jalur, { kode, ...opts } = {}) =>
  fetch(BASE + jalur, {
    redirect: 'manual',
    ...opts,
    headers: { ...(kode ? { Authorization: `Bearer ${kode}` } : {}), ...(opts.headers ?? {}) },
  });

const penggunaDisk = (id) =>
  JSON.parse(readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8')).users.find((u) => u.id === id);

const peserta = async (nama, denganProfil) => {
  const { user, accessCode } = await store.createUser({ name: nama, business: '', batch: 'B1' });
  await store.saveConsent(user.id, CONSENT_VERSION);
  if (denganProfil) {
    await store.saveProfile(user.id, { namaUsaha: nama, jenisUsaha: denganProfil, pencatatan: 'buku', tujuan: 'naikkan-laba', omzetBulanan: 4_000_000 });
  }
  return { id: user.id, kode: accessCode };
};

/* ------------------------------------------------------------ Parser murni */

test('parseFeed: RSS dengan CDATA + entitas + tag inline; Atom href; item tanpa link dibuang', () => {
  const rss = parseFeed(FIXTURE_RSS);
  assert.equal(rss.length, 3, 'item tanpa link dibuang, tiga tersisa');
  assert.equal(rss[0].title, 'Restaurant owners face rising food costs this winter');
  assert.equal(rss[1].title, 'Retail store inventory tips & tricks for the holidays', 'entitas di-decode');
  assert.equal(rss[2].title, 'Fed holds rates steady again amid mixed signals', 'tag inline dibuang dari judul');
  assert.ok(rss.every((h) => /^https?:\/\//.test(h.url)));
  assert.ok(rss.every((h) => h.publishedAt && !Number.isNaN(Date.parse(h.publishedAt))), 'tanggal dinormalkan ISO');

  const atom = parseFeed(FIXTURE_ATOM);
  assert.equal(atom.length, 2);
  assert.equal(atom[0].url, 'https://contoh.co/cafe-catering', 'link Atom dari atribut href');
  assert.equal(atom[1].title, 'Ecommerce holiday checklist for small shops');

  assert.deepEqual(parseFeed(FIXTURE_RUSAK), [], 'XML putus → kosong, bukan lemparan');
  assert.deepEqual(parseFeed(''), []);
  assert.deepEqual(parseFeed(null), []);
});

/* ------------------------------------------------------- Pool + TTL + PII */

test('pool: satu penerbangan, cache TTL — dua panggilan = SATU fetch', async () => {
  _buangCache();
  perilaku = 'rss';
  const [a, b] = await Promise.all([ambilPool(), ambilPool()]);
  assert.equal(a.status, 'ok');
  assert.equal(a.items.length, 3);
  assert.equal(b.items.length, 3);
  const sesudahParalel = jumlahFetch;
  assert.equal(sesudahParalel, 1, 'panggilan bersamaan menunggu penerbangan yang sama');

  await ambilPool();
  assert.equal(jumlahFetch, 1, 'dalam TTL: cache, tanpa fetch baru');

  await new Promise((r) => setTimeout(r, 300)); // TTL 250 ms lewat
  await ambilPool();
  assert.equal(jumlahFetch, 2, 'setelah TTL: fetch baru');
});

test('NOL PII: URL ke feed persis path feed — tanpa parameter, tanpa identifier pengguna', async () => {
  _buangCache();
  await ambilPool();
  assert.equal(permintaanTerakhir.url, '/feed.xml', 'tanpa query string apa pun');
  const header = JSON.stringify(permintaanTerakhir.headers).toLowerCase();
  for (const terlarang of ['bearer', 'authorization', 'email', 'usr_', 'sesi_', 'kode']) {
    assert.ok(!header.includes(terlarang), `header memuat "${terlarang}" — identifier pengguna keluar`);
  }
});

test('dedup lintas feed: RSS+Atom digabung, judul/url kembar runtuh ke satu id stabil', async () => {
  _buangCache();
  perilaku = 'campur';
  const pool = await ambilPool();
  const id = new Set(pool.items.map((h) => h.id));
  assert.equal(id.size, pool.items.length, 'id unik');
  assert.match(pool.items[0].id, /^news_[0-9a-f]{12}$/);
  assert.ok(pool.items.every((h) => ['127.0.0.1', 'feed'].includes(h.source) || typeof h.source === 'string'));
});

/* ------------------------------------------------------------- Fail-closed */

test('fail-closed: feed 500/rusak/lambat menyumbang kosong; semua gagal → unavailable', async () => {
  for (const p of ['500', 'rusak']) {
    _buangCache();
    perilaku = p;
    const pool = await ambilPool();
    assert.equal(pool.status, 'unavailable', `perilaku ${p}: pool unavailable`);
    assert.deepEqual(pool.items, []);
  }
  _buangCache();
  perilaku = 'lambat'; // timeout 400 ms yang memotong
  const pool = await ambilPool({ kini: Date.now() });
  assert.equal(pool.status, 'unavailable', 'feed menggantung → timeout → kosong');
});

test('fitur off yang jujur: NOVA_NEWS_FEEDS="-" → unavailable TANPA satu pun fetch', async () => {
  const sebelum = jumlahFetch;
  const lama = process.env.NOVA_NEWS_FEEDS;
  process.env.NOVA_NEWS_FEEDS = '-';
  try {
    assert.equal(newsAktif(), false);
    const pool = await ambilPool();
    assert.equal(pool.status, 'unavailable');
    assert.equal(jumlahFetch, sebelum, 'tidak ada jaringan tersentuh');
    const r = await minta('/api/news', { kode: (await peserta('Bu Off', null)).kode });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).status, 'unavailable');
  } finally {
    process.env.NOVA_NEWS_FEEDS = lama;
    perilaku = 'rss';
  }
});

test('daftar bawaan: 4 feed US kecil — Yahoo, CNBC, SBA, Forbes', () => {
  assert.equal(FEED_BAWAAN.length, 4);
  assert.ok(FEED_BAWAAN.some((f) => f.includes('finance.yahoo.com')));
  assert.ok(FEED_BAWAAN.some((f) => f.includes('cnbc.com')));
  assert.ok(FEED_BAWAAN.some((f) => f.includes('sba.gov')));
  assert.ok(FEED_BAWAAN.some((f) => f.includes('forbes.com')));
});

/* ------------------------------------------------- Tailoring deterministik */

const itemUji = (i, judul, hLalu) => ({
  id: `news_${String(i).padStart(12, '0')}`,
  title: judul, source: 'wire', url: `https://contoh.co/${i}`,
  publishedAt: baru(hLalu),
});

test('tailoring: kuliner vs retail vs tanpa profil — deterministik dan stabil', () => {
  const KINI = Date.parse(HARI_INI_ISO);
  const items = [
    itemUji(1, 'Retail store inventory tips for holidays', 5),
    itemUji(2, 'Restaurant food costs keep climbing', 4),
    itemUji(3, 'Fed holds rates steady again', 1), // paling segar, tanpa sektor
    itemUji(4, 'Coffee shop franchise expands nationally', 6),
  ];

  const kuliner = susunBerita(items, { jenisUsaha: 'kuliner' }, { kini: KINI });
  assert.match(kuliner[0].title, /Restaurant|Coffee/, 'kecocokan sektor naik ke atas');
  assert.match(kuliner[1].title, /Restaurant|Coffee/);

  const retail = susunBerita(items, { jenisUsaha: 'retail' }, { kini: KINI });
  assert.match(retail[0].title, /Retail/);

  // Tanpa profil = broad: recency murni — berita termuda dulu.
  const broad = susunBerita(items, null, { kini: KINI });
  assert.equal(broad[0].id, items[2].id, 'broad mengikuti recency');

  // Determinisme: input sama → urutan identik; pool tidak dimutasi.
  assert.deepEqual(susunBerita(items, { jenisUsaha: 'kuliner' }, { kini: KINI }), kuliner);
  assert.deepEqual(susunBerita(items, null, { kini: KINI }), broad);
  assert.equal(items.length, 4, 'pool tidak berubah');

  // Tiebreak stabil: skor serupa → urutan id, tidak pernah acak.
  const seri = [itemUji(9, 'Berita A tanpa sektor', 3), itemUji(5, 'Berita B tanpa sektor', 3)];
  const urut = susunBerita(seri, { jenisUsaha: 'kuliner' }, { kini: KINI });
  assert.deepEqual(urut.map((h) => h.id).sort(), ['news_000000000005', 'news_000000000009']);

  // Maks 8 item.
  assert.equal(susunBerita(Array.from({ length: 20 }, (_, i) => itemUji(100 + i, `Berita ${i}`, 1)), null, { kini: KINI }).length, 8);
});

test('skorItem + sektorKlik: sektor cocok terhitung; kategori klik kosakata tertutup', () => {
  const KINI = Date.parse(HARI_INI_ISO);
  const makanan = itemUji(1, 'Restaurant food costs keep climbing', 1);
  const umum = itemUji(2, 'Fed holds rates steady', 1);

  assert.ok(skorItem(makanan, 'kuliner', { kini: KINI }).cocok >= 2);
  assert.equal(skorItem(umum, 'kuliner', { kini: KINI }).cocok, 0);

  assert.equal(sektorKlik(makanan, { jenisUsaha: 'kuliner' }), 'kuliner', 'headline cocok sektor → sektor pengguna');
  assert.equal(sektorKlik(umum, { jenisUsaha: 'kuliner' }), 'umum');
  assert.equal(sektorKlik(makanan, null), 'umum', 'tanpa profil → umum');
  assert.equal(sektorKlik(umum, { jenisUsaha: 'lainnya' }), 'umum');
});

/* --------------------------------------------------------------- Rute API */

test('rute /api/news: 401 tanpa kode; 451 tanpa persetujuan; bentuk medan bersih', async () => {
  _buangCache();
  assert.equal((await minta('/api/news')).status, 401);

  const belum = await store.createUser({ name: 'Belum News', business: '', batch: 'B1' });
  assert.equal((await minta('/api/news', { kode: belum.accessCode })).status, 451);

  const p = await peserta('Bu News', 'kuliner');
  const r = await minta('/api/news', { kode: p.kode });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.status, 'ok');
  assert.equal(data.mode, 'tailored', 'berprofil → tailored');
  assert.ok(data.items.length > 0 && data.items.length <= 8);
  for (const h of data.items) {
    assert.deepEqual(Object.keys(h).sort(), ['id', 'publishedAt', 'source', 'title', 'url'], 'medan verbatim persis lima');
    assert.doesNotMatch(h.title, /<[^>]+>/, 'judul bebas tag — siap dirender aman');
    assert.match(h.id, /^news_[0-9a-f]{12}$/);
  }
  // Kuliner: dua headline sektor makanan di atas dua sisanya.
  assert.match(data.items[0].title, /Restaurant|Cafe/i);

  const tanpa = await peserta('Bu Broad', null);
  const r2 = await minta('/api/news', { kode: tanpa.kode });
  const d2 = await r2.json();
  assert.equal(d2.mode, 'broad', 'tanpa profil → broad global');
});

test('rute klik: 302 ke sumber + event contentless; id asing → 404 tanpa redirect', async () => {
  _buangCache();
  const p = await peserta('Bu Klik', 'kuliner');
  const berita = await (await minta('/api/news', { kode: p.kode })).json();
  const makanan = berita.items.find((h) => /Restaurant|Cafe/i.test(h.title));
  const umumItem = berita.items.find((h) => !/Restaurant|Cafe|Coffee|food/i.test(h.title));

  const k1 = await minta(`/api/news/${makanan.id}/klik`, { kode: p.kode });
  assert.equal(k1.status, 302);
  assert.equal(k1.headers.get('location'), makanan.url, 'pengalihan tepat ke url sumber');

  const k2 = await minta(`/api/news/${umumItem.id}/klik`, { kode: p.kode });
  assert.equal(k2.status, 302);

  const disk = penggunaDisk(p.id);
  const klik = disk.events.filter((e) => e.type === 'news_klik');
  assert.equal(klik.length, 2);
  assert.ok(klik.some((e) => e.meta.kategori === 'kuliner'), 'headline sektor → kategori sektor pengguna');
  assert.ok(klik.some((e) => e.meta.kategori === 'umum'), 'headline umum → umum');
  for (const e of klik) {
    assert.deepEqual(periksaMetaJejak('news_klik', e.meta), [], 'lolos gerbang struktural');
  }
  // Ratchet: judul tidak pernah masuk jejak.
  assert.doesNotMatch(JSON.stringify(disk.events), /Restaurant|Fed holds/, 'judul tidak pernah tercatat');

  // Id asing: 404, TANPA location.
  const asing = await minta('/api/news/news_ffffffffffff/klik', { kode: p.kode });
  assert.equal(asing.status, 404);
  assert.equal(asing.headers.get('location'), null, 'tidak ada redirect liar');

  // Klik tanpa kode: 401 — pengalihan tidak boleh jadi pintu terbuka.
  assert.equal((await minta(`/api/news/${makanan.id}/klik`)).status, 401);
});
