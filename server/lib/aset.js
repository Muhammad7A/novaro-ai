/**
 * Aset statis yang dikompresi SEKALI, bukan pada tiap permintaan.
 *
 * ------------------------------------------------------------------
 * KENAPA BUKAN MIDDLEWARE KOMPRESI BIASA
 *
 * Aplikasi ini mengalirkan jawaban AI sebagai Server-Sent Events. Middleware
 * kompresi umum menahan keluaran sampai penyangganya penuh — dan untuk aliran
 * yang memang menetes sedikit demi sedikit, itu berarti peserta menunggu layar
 * kosong sampai seluruh jawaban selesai, lalu semuanya muncul sekaligus.
 * Persis kebalikan dari alasan aliran itu dipakai.
 *
 * Ada bendera dan penyaring untuk mengakalinya, tapi semuanya menaruh kode
 * baru di jalur SETIAP permintaan, termasuk jalur chat. Di sini tidak perlu:
 * yang besar hanya tiga berkas statis, dan ketiganya bisa dikompresi sekali di
 * awal lalu disajikan apa adanya. Jalur `/api/` tidak tersentuh sama sekali.
 *
 * ------------------------------------------------------------------
 * BERAPA YANG DIHEMAT, DAN UNTUK SIAPA
 *
 *   index.html    124,9 KB  ->  34,8 KB
 *   modul.js       39,3 KB  ->  13,9 KB
 *   validasi.html  31,0 KB  ->   9,2 KB
 *   muat pertama  164,2 KB  ->  48,7 KB   (hemat ~70%)
 *
 * Yang membayar selisih itu adalah kuota prabayar pemilik warung, tiap kali
 * dia membuka aplikasi dari ponselnya. Untuk penelitian yang salah satu
 * ukurannya adalah apakah alat ini terasa mudah dipakai, 115 KB yang tidak
 * perlu diunduh setiap hari bukan detail teknis.
 *
 * ------------------------------------------------------------------
 * KESEGARAN
 *
 * Berkas di disk di-`stat` pada tiap permintaan (murah) dan dibaca ulang hanya
 * bila waktu ubahnya berubah. Tanpa itu, `npm run dev` akan menyajikan HTML
 * lama setelah diedit — `node --watch` hanya memantau berkas yang di-import,
 * dan `public/index.html` tidak pernah di-import oleh siapa pun.
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

/** gzip tingkat 9: dibayar sekali, diunduh berkali-kali. */
const GZIP = { level: 9 };

const sidik = (buf) => `"${createHash('sha256').update(buf).digest('base64url').slice(0, 20)}"`;

/**
 * Apakah klien benar-benar MAU menerima gzip?
 *
 * Sebelumnya cukup `/\bgzip\b/`, yang keliru pada dua bentuk yang sah:
 *
 *   Accept-Encoding: gzip;q=0        -> "jangan kirim gzip" (cocok, lalu dikirim)
 *   Accept-Encoding: *               -> "apa saja boleh"    (tidak cocok, tak dikirim)
 *
 * Yang pertama yang berbahaya: klien menyatakan tidak sanggup membuka gzip,
 * lalu menerima gzip — dan yang tampil di layarnya adalah sampah biner. Klien
 * seperti itu jarang, tapi ia ada justru pada peramban lama dan proxy kantor,
 * dan kegagalannya total, bukan sebagian.
 *
 * q=0 berarti "tolak" (RFC 9110 §12.5.3). Tanda `*` dipakai sebagai cadangan
 * hanya bila gzip tidak disebut namanya sendiri.
 */
export function terimaGzip(header) {
  const teks = String(header ?? '').toLowerCase();
  if (!teks) return false;

  let bintang = null;
  for (const bagian of teks.split(',')) {
    const [namaMentah, ...param] = bagian.split(';');
    const nama = namaMentah.trim();
    if (nama !== 'gzip' && nama !== '*') continue;

    const q = param.map((p) => p.trim()).find((p) => p.startsWith('q='));
    const nilai = q ? Number(q.slice(2)) : 1;
    const boleh = Number.isFinite(nilai) && nilai > 0;

    if (nama === 'gzip') return boleh; // penyebutan langsung selalu menang
    bintang = boleh;
  }
  return bintang ?? false;
}

function bungkus(mentah, tipe) {
  const buf = Buffer.isBuffer(mentah) ? mentah : Buffer.from(mentah, 'utf8');
  return { mentah: buf, gzip: gzipSync(buf, GZIP), etag: sidik(buf), tipe };
}

/** Aset dari nilai yang dihitung di memori (mis. kurikulum). */
export function asetDariNilai(isi, tipe) {
  const siap = bungkus(isi, tipe);
  return { ...siap, segarkan: async () => siap };
}

/**
 * Aset dari berkas di disk, dibaca ulang hanya bila berkasnya berubah.
 */
export function asetDariBerkas(jalur, tipe) {
  let siap = null;
  let tanda = null;

  const segarkan = async () => {
    const s = await stat(jalur);
    const kini = `${s.size}:${s.mtimeMs}`;
    if (!siap || kini !== tanda) {
      siap = bungkus(await readFile(jalur), tipe);
      tanda = kini;
    }
    return siap;
  };

  return { segarkan };
}

/**
 * Penangan Express untuk sebuah aset.
 *
 * `Vary: Accept-Encoding` wajib ada: tanpa itu, cache di tengah jalan (peramban,
 * proxy kantor, CDN) bisa menyimpan jawaban ter-gzip lalu menyajikannya ke
 * klien yang tidak mengerti gzip — yang akan melihat halaman berisi sampah biner.
 */
export function sajikanAset(aset, { cacheControl = 'no-cache' } = {}) {
  return async (req, res, next) => {
    let siap;
    try {
      siap = await aset.segarkan();
    } catch (err) {
      return next(err);
    }

    res.setHeader('Content-Type', siap.tipe);
    res.setHeader('ETag', siap.etag);
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('Vary', 'Accept-Encoding');

    // Peramban yang sudah punya salinan sama tidak perlu mengunduh apa pun.
    if (req.headers['if-none-match'] === siap.etag) return res.status(304).end();

    const pakaiGzip = terimaGzip(req.headers['accept-encoding']);
    const badan = pakaiGzip ? siap.gzip : siap.mentah;
    if (pakaiGzip) res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Length', String(badan.length));

    // HEAD tidak boleh membawa badan; `res.end(buf)` polos akan mengirimnya.
    if (req.method === 'HEAD') return res.end();
    res.end(badan);
  };
}
