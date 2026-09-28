/**
 * Pool headline berita — RSS/Atom minimalis TANPA dependency.
 *
 * ------------------------------------------------------------------
 * DESAIN TERKUNCI (misi owner 2026-09-28 — jangan diubah tanpa alasan
 * tercatat):
 *
 *   - SATU pool per TTL 15 menit untuk SELURUH pengguna — permintaan ke
 *     feed tidak pernah membawa identifier pengguna apa pun (NOL PII
 *     keluar; dipin lewat uji yang memeriksa URL yang dibentuk);
 *   - headline VERBATIM {id, title, source, publishedAt, url} apa adanya
 *     dari feed — TIDAK ada ringkasan/rewrite/AI: news BUKAN permukaan AI;
 *   - tailoring DETERMINISTIK dari profil (skor kecocokan sektor +
 *     recency); tanpa profil = broad global; pool sama, urutan beda;
 *   - fail-closed: feed mati/timeout → tidak menyumbang apa pun; SEMUA
 *     gagal / daftar feed kosong → pool 'unavailable' yang jujur;
 *     TTL cache di memori proses, TANPA scheduler.
 */
import { createHash } from 'node:crypto';

/** Feed bawaan — bisnis/keuangan US kecil. Dapat diganti via NOVA_NEWS_FEEDS. */
export const FEED_BAWAAN = [
  'https://finance.yahoo.com/news/rssindex',                      // Yahoo Finance
  'https://www.cnbc.com/id/10001147/device/rss/rss.html',         // CNBC business
  'https://www.sba.gov/articles.xml',                             // SBA headlines
  'https://www.forbes.com/entrepreneurs/feed/',                   // Forbes entrepreneurs
];

export const TTL_POOL_MS = Number(process.env.NOVA_NEWS_TTL_MS) || 15 * 60 * 1000;
export const TIMEOUT_FEED_MS = Number(process.env.NOVA_NEWS_TIMEOUT_MS) || 8_000;

/** Umur di mana headline dianggap basi — skor recency memudar sampai sini. */
export const UMUR_MAKS_HARI = 14;

/**
 * Kosakata sektor → kata kunci (huruf kecil, cocok pada judul lower-case).
 * Satu baris per jenisUsaha; menambah sektor = baris baru yang terlihat di
 * diff. 'lainnya' sengaja kosong — tanpa sektor berarti broad murni.
 */
export const KATA_KUNCI_SEKTOR = {
  kuliner: ['restaurant', 'food', 'menu', 'cafe', 'dining', 'hospitality', 'coffee', 'kitchen', 'franchise', 'delivery'],
  retail: ['retail', 'store', 'shop', 'ecommerce', 'e-commerce', 'inventory', 'consumer', 'sales', 'boutique'],
  jasa: ['service', 'consulting', 'agency', 'freelance', 'client', 'professional', 'salon', 'repair'],
  produksi: ['manufactur', 'factory', 'supply chain', 'supplier', 'production', 'logistics'],
  online: ['ecommerce', 'e-commerce', 'online', 'digital', 'saas', 'startup', 'creator', 'marketplace'],
  lainnya: [],
};

/* ------------------------------------------------------------ XML minimalis */

const SITI_ENTITAS = (teks) => String(teks ?? '')
  .replace(/<!\[CDATA\[([\s\S]*?)]]>/g, '$1')
  // Entitas didecode DULU, tag dibuang SETELAHNYA: judul "&lt;em&gt;" yang
  // lolos sebagai tag literal justru harus kena strip — urutan terbalik
  // membiarkannya hidup sebagai markup di medan yang katanya bersih.
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/<[^>]+>/g, '') // judul kadang membawa tag inline — buang, bukan render
  .trim();

/** Cari isi pertama dari salah satu tag (penutup paling dekat, bukan greedy). */
const isiTag = (blok, nama) => {
  const cocok = new RegExp(`<${nama}(?:\\s[^>]*)?>([\\s\\S]*?)</${nama}>`, 'i').exec(blok);
  return cocok ? SITI_ENTITAS(cocok[1]) : '';
};

/** Link Atom hidup di atribut href — RSS di isi tag. */
const linkItem = (blok) => {
  const atom = /<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i.exec(blok);
  if (atom?.[1]) return SITI_ENTITAS(atom[1]);
  return isiTag(blok, 'link');
};

const tanggalItem = (blok) => {
  const mentah = isiTag(blok, 'pubDate') || isiTag(blok, 'published') || isiTag(blok, 'updated');
  if (!mentah) return null;
  const t = Date.parse(mentah);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/**
 * Mem-parse SATU dokumen feed (RSS 2.0 atau Atom) menjadi daftar headline
 * mentah. Keras terhadap XML rusak: tanpa item/entry sah → daftar kosong,
 * TIDAK pernah melempar — feed yang rusak menyumbang kosong, pool tetap
 * jujur dari feed yang sehat.
 *
 * @returns {{title: string, url: string, publishedAt: string|null}[]}
 */
export function parseFeed(teks, { maks = 25 } = {}) {
  const isi = String(teks ?? '');
  const hasil = [];
  const polaItem = /<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi;
  let cocok;
  while ((cocok = polaItem.exec(isi)) !== null && hasil.length < maks) {
    const blok = cocok[0];
    const title = isiTag(blok, 'title');
    const url = linkItem(blok);
    if (!title || !url || !/^https?:\/\//i.test(url)) continue;
    hasil.push({ title: title.slice(0, 300), url, publishedAt: tanggalItem(blok) });
  }
  return hasil;
}

/* --------------------------------------------------------------- Pool + TTL */

let cache = null; // {pada: number, pool: {status, items}}
let sedangBerjalan = null; // satu penerbangan sah — TTL pendek, anti badai

const daftarFeed = () => {
  const env = (process.env.NOVA_NEWS_FEEDS ?? '').trim();
  if (env === '') return FEED_BAWAAN; // kosong = daftar bawaan; mati total = '-'
  if (env === '-') return [];
  return env.split(',').map((f) => f.trim()).filter(Boolean).map((f) => (/^https?:\/\//i.test(f) ? f : `https://${f}`));
};

/** Berita MATI TOTAL (fitur off yang jujur, pola sidecar). */
export function newsAktif() {
  return daftarFeed().length > 0;
}

async function ambilSatuFeed(url, sumber) {
  const kontrol = new AbortController();
  const pengatur = setTimeout(() => kontrol.abort(), TIMEOUT_FEED_MS);
  try {
    // GET polos ke URL feed — TANPA parameter, TANPA identifier pengguna.
    const res = await fetch(url, {
      method: 'GET',
      signal: kontrol.signal,
      headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    });
    if (!res.ok) return [];
    const teks = await res.text();
    return parseFeed(teks).map((item) => ({ ...item, source: sumber }));
  } catch {
    return []; // timeout/rusak/jaringan — feed ini menyumbang kosong
  } finally {
    clearTimeout(pengatur);
  }
}

const idStabil = (url, judul) => `news_${createHash('sha256').update(`${url}|${judul}`).digest('hex').slice(0, 12)}`;

/**
 * Mengambil pool headline (ter-cache TTL). SATU penerbangan: pemanggil
 * bersamaan menunggu janji yang sama — pool memang satu untuk semua.
 *
 * @returns {Promise<{status:'ok'|'unavailable', items: Array}>}
 */
export async function ambilPool({ kini = Date.now(), paksa = false } = {}) {
  if (!newsAktif()) return { status: 'unavailable', items: [] };
  if (!paksa && cache && kini - cache.pada < TTL_POOL_MS) return cache.pool;

  if (!sedangBerjalan) {
    sedangBerjalan = (async () => {
      const feed = daftarFeed();
      const jawaban = await Promise.all(feed.map((url) => {
        // Nama sumber = host, dibersihkan — cukup untuk label 'source'.
        let sumber = 'feed';
        try { sumber = new URL(url).hostname.replace(/^www\./, ''); } catch {}
        return ambilSatuFeed(url, sumber);
      }));
      const mentah = jawaban.flat();
      // Satu headline satu identitas: id stabil dari url+judul; duplikat
      // lintas feed (judul sama) runtuh ke satu — pool milik pembaca.
      const perId = new Map();
      for (const h of mentah) {
        const id = idStabil(h.url, h.title);
        if (!perId.has(id)) perId.set(id, { id, title: h.title, source: h.source, publishedAt: h.publishedAt, url: h.url });
      }
      const pool = { status: perId.size ? 'ok' : 'unavailable', items: [...perId.values()] };
      cache = { pada: Date.now(), pool };
      return pool;
    })().finally(() => { sedangBerjalan = null; });
  }
  return sedangBerjalan;
}

/** Untuk uji: buang cache (cache-bust antar skenario dalam satu proses). */
export function _buangCache() {
  cache = null;
  sedangBerjalan = null;
}

/* ------------------------------------------------------- Tailoring murni */

const UMUR_SKOR_MAKS = 10; // bobot maksimum recency — konstanta tunggal, tanpa angka liar

/**
 * Skor satu headline untuk satu sektor — MURNI. Kecocokan sektor: jumlah kata
 * kunci sektor yang muncul di judul (≤3 hit dihitung penuh — selektivitas,
 * bukan banjiri). Recency: memudar linear sampai UMUR_MAKS_HARI.
 */
export function skorItem(item, sektor, { kini = Date.now() } = {}) {
  const judul = item.title.toLowerCase();
  const kata = KATA_KUNCI_SEKTOR[sektor] ?? [];
  const cocok = Math.min(3, kata.reduce((n, k) => n + (judul.includes(k) ? 1 : 0), 0));

  let umurHari = UMUR_MAKS_HARI;
  if (item.publishedAt) {
    const t = Date.parse(item.publishedAt);
    if (Number.isFinite(t)) umurHari = Math.max(0, (kini - t) / 86_400_000);
  }
  const recency = umurHari >= UMUR_MAKS_HARI ? 0 : (UMUR_SKOR_MAKS * (1 - umurHari / UMUR_MAKS_HARI));

  return { cocok, recency, skor: cocok * 10 + recency };
}

/**
 * Menyusun headline untuk satu pengguna — MURNI dan DETERMINISTIK:
 * tiebreak selalu id (urutan stabil untuk input yang sama); pool tidak
 * pernah diubah. Tanpa sektor (profil kosong / 'lainnya') = broad:
 * urutan recency murni. Max 8 item.
 */
export function susunBerita(items, profile, { kini = Date.now(), maks = 8 } = {}) {
  const sektor = KATA_KUNCI_SEKTOR[profile?.jenisUsaha] ? profile.jenisUsaha : null;
  const diurut = [...items]
    .map((item) => ({ item, skor: skorItem(item, sektor, { kini }) }))
    .sort((a, b) =>
      b.skor.skor - a.skor.skor ||
      String(a.item.id).localeCompare(String(b.item.id)),
    )
    .slice(0, maks)
    .map((x) => x.item);
  return diurut;
}

/**
 * Sektor SATU headline untuk pengguna ini — dipakai klik: 'kategori' event
 * adalah SEKTOR pengguna bila headline itu memang cocok sektornya, selain
 * itu 'umum'. Kosakata tertutup — judul TIDAK PERNAH masuk jejak.
 */
export function sektorKlik(item, profile) {
  const sektor = KATA_KUNCI_SEKTOR[profile?.jenisUsaha] ? profile.jenisUsaha : null;
  if (sektor && skorItem(item, sektor).cocok > 0) return sektor;
  return 'umum';
}
