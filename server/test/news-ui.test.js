/**
 * Uji kartu berita dasbor (W1 news feed UI) — renderer murni + pin wiring.
 *
 * Renderer kartu hidup di index.html dalam penanda BERITA-KARTU-MURNI
 * (kontrak: murni, tanpa DOM, tanpa state halaman) sehingga bisa diekstrak
 * dan diuji langsung di Node tanpa peramban. Wiring klik (fetch rute
 * tercatat + tab baru noopener) dipin pada teks sumber halaman.
 *
 *   npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AKAR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(AKAR, 'public', 'index.html'), 'utf8');

const MULA = '/* BERITA-KARTU-MURNI';
const AKHIR = '/* /BERITA-KARTU-MURNI */';
const awalBlok = html.indexOf(MULA);
assert.ok(awalBlok >= 0, 'penanda pembuka blok murni ditemukan');
// Penanda pembuka adalah komentar multi-baris — mulai SETELAH penutupnya.
const blok = html.slice(html.indexOf('\n', html.indexOf('*/', awalBlok)) + 1, html.indexOf(AKHIR));
assert.ok(blok.length > 200, 'blok murni tidak kosong');

const { beritaKartuHtml, umurBerita } = new Function(`${blok}; return { beritaKartuHtml, umurBerita };`)();

const KINI = Date.parse('2026-09-28T12:00:00.000Z');
const item = (i, title, source, hLalu) => ({
  id: `news_${String(i).padStart(12, '0')}`,
  title, source,
  publishedAt: new Date(KINI - hLalu * 3600_000).toISOString(),
  url: `https://contoh.co/${i}`,
});

const PAYLOAD_BROAD = {
  status: 'ok', mode: 'broad',
  items: [item(1, 'Fed holds rates steady', 'CNBC', 2), item(2, 'Small business hiring slows', 'Yahoo Finance', 6)],
};
const PAYLOAD_TAILORED = {
  status: 'ok', mode: 'tailored',
  items: [item(3, 'Restaurant food costs climb', 'Forbes', 1), item(4, 'Cafe catering boom', 'SBA', 3)],
};

/* ------------------------------------------------------------ Label mode */

test('label mode: broad = Top business headlines; tailored = For your business: sektor', () => {
  const broad = beritaKartuHtml(PAYLOAD_BROAD, { sektor: null, kini: KINI });
  assert.ok(broad.includes('Top business headlines'), 'judul broad');
  assert.ok(!broad.includes('For your business'), 'broad tidak menyebut sektor');

  const kuliner = beritaKartuHtml(PAYLOAD_TAILORED, { sektor: 'kuliner', kini: KINI });
  // Label sektor = kosakata milik aplikasi (konstanta), bukan teks pihak
  // ketiga — tampil mentah, tanpa escape ganda.
  assert.ok(kuliner.includes('For your business: Food & Dining'), 'judul dinamis membawa sektor');

  const retail = beritaKartuHtml(PAYLOAD_TAILORED, { sektor: 'retail', kini: KINI });
  assert.ok(retail.includes('For your business: Retail'));

  // Sekor tanpa label map ('lainnya'/null) dengan mode tailored → label
  // broad yang jujur, bukan nama sektor karangan.
  const kosong = beritaKartuHtml(PAYLOAD_TAILORED, { sektor: 'lainnya', kini: KINI });
  assert.ok(kosong.includes('Top business headlines'));
});

/* ------------------------------------------------- Sub-label sumber+umur */

test('sub-label item: sumber + umur — "CNBC · 2h ago"', () => {
  const kartu = beritaKartuHtml(PAYLOAD_BROAD, { kini: KINI });
  assert.ok(kartu.includes('CNBC · 2h ago'));
  assert.ok(kartu.includes('Yahoo Finance · 6h ago'));

  assert.equal(umurBerita(new Date(KINI - 30 * 60_000).toISOString(), KINI), '30m ago');
  assert.equal(umurBerita(new Date(KINI - 3 * 86400_000).toISOString(), KINI), '3d ago');
  assert.equal(umurBerita('bukan-tanggal', KINI), '', 'tanpa tanggal valid → kosong');
  const tanpaTanggal = beritaKartuHtml(
    { status: 'ok', mode: 'broad', items: [{ ...item(9, 'X', 'SBA', 0), publishedAt: null }] },
    { kini: KINI },
  );
  assert.ok(tanpaTanggal.includes('>SBA<'), 'sub-label hanya sumber bila umur tak diketahui');
});

/* ------------------------------------------------- Kejujuran unavailable */

test('unavailable: kartu singkat News unavailable — TANPA skeleton palsu', () => {
  for (const payload of [{ status: 'unavailable', items: [] }, null, { status: 'ok', mode: 'broad', items: [] }]) {
    const kartu = beritaKartuHtml(payload, { kini: KINI });
    assert.ok(kartu.includes('News unavailable right now.'));
    assert.ok(!kartu.includes('berita-list'), 'tidak ada baris item pura-pura');
    assert.ok(!kartu.includes('Loading') && !kartu.includes('Memuat'), 'tanpa skeleton berpura-pura memuat');
  }
});

/* ------------------------------------------------------ Escape pihak ketiga */

test('XSS: judul skrip dan url berbahaya tidak pernah jadi markup/atribut hidup', () => {
  const jahat = beritaKartuHtml(
    { status: 'ok', mode: 'broad', items: [item(1, '<script>alert(1)</script>', 'Feed', 1)] },
    { kini: KINI },
  );
  assert.ok(!jahat.includes('<script'), 'tag skrip tidak pernah lolos sebagai markup');
  assert.ok(jahat.includes('&lt;script&gt;'), 'judul tersimpan ter-escape');

  const urlJahat = beritaKartuHtml(
    {
      status: 'ok', mode: 'broad',
      items: [{ ...item(2, 'Judul aman', 'Feed', 1), url: 'https://x.co/a" onmouseover="alert(1)' }],
    },
    { kini: KINI },
  );
  assert.ok(!urlJahat.includes('" onmouseover='), 'injeksi atribut diputus oleh escape');
  assert.ok(urlJahat.includes('href="https://x.co/a&quot;'), 'kutip dalam url ter-escape di atribut');

  const sumberJahat = beritaKartuHtml(
    {
      status: 'ok', mode: 'broad',
      items: [{ ...item(3, 'Aman', "<b src='x'>Sumber", 1) }],
    },
    { kini: KINI },
  );
  assert.ok(sumberJahat.includes('&lt;b src='), 'sumber juga teks pihak ketiga yang di-escape');
});

/* ------------------------------------------------------------ Pin wiring */

test('wiring klik: rute tercatat ditembak Bearer + sumber dibuka noopener', () => {
  assert.ok(html.includes('data-klik-berita='), 'jangkar klik ber-id item');
  assert.ok(html.includes('fetch(`/api/news/${id}/klik`'), 'rute redirect server yang dipanggil');
  assert.ok(html.includes("redirect: 'manual'"), 'fetch tidak mengikuti redirect lintas asal');
  assert.ok(html.includes("Authorization: 'Bearer ' + token"), 'klik membawa identitas — peristiwa tercatat milik siapa');
  assert.ok(html.includes("window.open(a.href, '_blank', 'noopener,noreferrer')"), 'sumber dibuka tab baru noopener');
  assert.ok(html.includes('e.preventDefault()'), 'href asli tidak dieksekusi dua kali');
});

test('wiring dasbor: slot kartu, loader, badge kejujuran — nol klaim di luar headline', () => {
  assert.ok(html.includes('id="kartuBerita"'), 'slot kartu di dasbor');
  assert.ok(html.includes('isiKartuBerita();'), 'loader ikut siklus render dasbor');
  assert.ok(html.includes('Headlines as published'), 'badge jujur: apa adanya dari penerbit');
  const blokKartu = html.slice(html.indexOf('function beritaKartuHtml'), html.indexOf(AKHIR));
  assert.ok(!/summary|ringkasan|diresume|rewritten/i.test(blokKartu), 'tanpa ringkasan/rewrite — news bukan permukaan AI');
});
