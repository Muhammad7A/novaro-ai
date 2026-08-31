/**
 * Lapisan pengamanan HTTP.
 *
 * Tiga hal yang ditangani di sini, semuanya berangkat dari satu kenyataan:
 * kode akses peserta ikut di header SETIAP permintaan. Kalau kode itu terbaca
 * orang lain, dia mendapat seluruh pembukuan keuangan peserta tersebut — bukan
 * sepotong, tapi semuanya.
 *
 *   1. Memaksa HTTPS       — supaya kodenya tidak pernah lewat jaringan terbuka.
 *   2. Header keamanan     — mempersempit akibat bila ada celah lain.
 *   3. Pembatas login      — supaya percobaan menebak kode tidak bisa tanpa batas
 *                            dan tidak berlalu tanpa terlihat.
 */
import { setTimeout as tidur } from 'node:timers/promises';

import { jamWIB } from './cashbook.js';
import { log } from './log.js';

/* ------------------------------------------------------------------ HTTPS */

/**
 * Menolak permintaan yang datang lewat HTTP polos.
 *
 * Dinyalakan dengan FORCE_HTTPS=1 di server produksi. Nginx tetap yang memasang
 * sertifikatnya; middleware ini yang memastikan aplikasi tidak pernah diam-diam
 * melayani permintaan tanpa enkripsi kalau konfigurasi proxy-nya keliru.
 *
 * Butuh `trust proxy` menyala agar `req.secure` membaca X-Forwarded-Proto.
 */
/*
 * Nama host tujuan pengalihan.
 *
 * Header `Host` datang dari klien, jadi memantulkannya begitu saja menjadikan
 * server ini alat pengalih ke mana pun: `Host: situs-jahat.test` menghasilkan
 * 308 ke situs itu, di bawah nama domain program. Untuk peserta yang diajari
 * "klik tautan dari pendamping", itu justru jalur yang paling mudah dipakai.
 *
 * Karena itu PUBLIC_HOST dipakai bila diatur. Bila tidak, header Host masih
 * dipakai tapi harus berbentuk nama host wajar — dan startup mengingatkan.
 */
const PUBLIC_HOST = (process.env.PUBLIC_HOST ?? '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const HOST_WAJAR = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i;

export function hostTujuan(req) {
  if (PUBLIC_HOST) return PUBLIC_HOST;
  const host = String(req.headers?.host ?? '');
  return HOST_WAJAR.test(host) ? host : null;
}

export function forceHttps(req, res, next) {
  if (req.secure) return next();

  // Peramban yang mengetik alamat tanpa https:// dialihkan, bukan ditolak.
  if (req.method === 'GET' || req.method === 'HEAD') {
    const host = hostTujuan(req);
    if (!host) {
      return res.status(400).json({ error: 'Alamat tujuan tidak dikenali.' });
    }
    return res.redirect(308, `https://${host}${req.originalUrl}`);
  }
  // Permintaan yang membawa data tidak dialihkan — pengalihan tetap
  // mengirim kode aksesnya sekali lewat jaringan terbuka.
  return res.status(403).json({ error: 'Sambungan tidak aman. Aplikasi ini hanya melayani HTTPS.' });
}

/** Apakah PUBLIC_HOST sudah diatur? Dipakai peringatan saat start. */
export const punyaPublicHost = () => Boolean(PUBLIC_HOST);

/* --------------------------------------------------------- Header keamanan */

/*
 * CSP disusun dari apa yang halaman ini benar-benar muat: tidak ada apa pun
 * dari domain luar.
 *
 * Font Google sengaja dihapus. Ia membuat ponsel setiap peserta menghubungi
 * server Google pada setiap kali halaman dibuka, sementara teks persetujuan
 * hanya menyebut Anthropic sebagai pihak ketiga. Untuk program penelitian
 * kecil, menyelaraskan keduanya lebih baik dilakukan dengan menghapus
 * permintaannya, bukan menambah paragraf ke persetujuannya. Efek sampingnya
 * menguntungkan: halaman tetap tampil utuh di sinyal buruk dan saat luring.
 *
 * `'unsafe-inline'` pada script-src memang melemahkan — seluruh aplikasi ini
 * satu berkas dengan skrip inline, jadi tanpa itu halamannya mati. Yang tetap
 * didapat: skrip dari domain luar tidak bisa dimuat sama sekali, dan itulah
 * jalur yang biasa dipakai untuk membesarkan sebuah celah XSS menjadi
 * pencurian data. Menghapusnya butuh memecah berkas + nonce, bukan pekerjaan
 * lima menit — dicatat di README sebagai batas yang disadari.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders(req, res, next) {
  /*
   * Jawaban API memuat pembukuan keuangan dan hanya dijaga kode akses di header.
   * Tanpa no-store, isinya boleh disimpan cache peramban dan tetap terbaca dari
   * disk (atau tombol "kembali") setelah peserta keluar.
   */
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  /*
   * Tidak ada bagian aplikasi ini yang pantas muncul di mesin pencari.
   *
   * Alamatnya memang harus bisa dibuka siapa pun yang memegang kodenya, tapi
   * halaman masuk program penelitian yang terindeks akan mengundang lalu lintas
   * yang tidak ada gunanya — dan tiap percobaan kode asing ikut memakan
   * pembatas login peserta yang sah, karena beberapa peserta berbagi satu
   * alamat IP di jaringan seluler.
   *
   * Header ini menutup semuanya sekaligus, termasuk /modul.js dan jawaban API
   * yang tidak punya tempat menaruh meta tag.
   */
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');

  /*
   * HSTS hanya dikirim lewat sambungan yang sudah aman. Mengirimnya lewat HTTP
   * tidak ada gunanya, dan memasangnya saat pengembangan lokal akan mengunci
   * localhost ke HTTPS di peramban selama berbulan-bulan.
   */
  if (req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
}

/* --------------------------------------------------------- Pembatas login */

const JENDELA_MS = 15 * 60 * 1000; // 15 menit
/*
 * 20, bukan 10. Operator seluler Indonesia memakai CGNAT secara luas: beberapa
 * peserta bisa keluar lewat satu alamat IP publik yang sama. Dengan batas 10,
 * tiga peserta yang masing-masing salah ketik empat kali akan saling mengunci —
 * dan panduan akan salah mendiagnosisnya sebagai satu orang yang ceroboh.
 * Ruang tebakannya 32^8 ≈ 1,1 triliun, jadi menaikkan batas ini tidak membuat
 * penebakan jadi praktis; yang dijaga memang bukan itu (lihat catatan di bawah).
 */
const MAKS_GAGAL = Number(process.env.LOGIN_MAX_ATTEMPTS) || 20;
/** Jeda tetap pada setiap kegagalan — memperlambat penebakan tanpa mengunci siapa pun. */
const JEDA_GAGAL_MS = 250;

/** ip -> timestamp[] percobaan yang gagal */
const gagal = new Map();

// Membersihkan sisa catatan lama supaya peta ini tidak tumbuh selamanya.
const pembersih = setInterval(() => {
  const batas = Date.now() - JENDELA_MS;
  for (const [ip, waktu] of gagal) {
    const sisa = waktu.filter((t) => t > batas);
    if (sisa.length) gagal.set(ip, sisa);
    else gagal.delete(ip);
  }
}, JENDELA_MS);
pembersih.unref?.();

const terkini = (ip) => (gagal.get(ip) ?? []).filter((t) => t > Date.now() - JENDELA_MS);

/**
 * Apakah alamat ini sedang terkunci? Mengembalikan pesan galat, atau null.
 *
 * Ruang tebakannya memang besar (32^8 ≈ 1,1 triliun), jadi menebak satu kode
 * tertentu tidak praktis. Yang dicegah di sini bukan itu, melainkan dua hal
 * yang lebih nyata: percobaan tanpa batas yang membebani server, dan serangan
 * yang berlangsung tanpa meninggalkan jejak apa pun di log.
 */
export function kodeTerkunci(ip) {
  const recent = terkini(ip);
  if (recent.length < MAKS_GAGAL) return null;
  const bebas = new Date(recent[0] + JENDELA_MS);
  log.warn('keamanan', 'akses diblokir sementara', { ip, percobaan: recent.length, menit: JENDELA_MS / 60000 });
  return `Terlalu banyak percobaan kode akses. Coba lagi setelah ${jamWIB(bebas)}.`;
}

/**
 * Mencatat satu percobaan kode yang gagal, dari rute mana pun.
 *
 * Dipakai juga oleh pemeriksaan header Authorization, bukan hanya oleh rute
 * login. Sebelumnya hanya `/api/login` yang dijaga, sehingga siapa pun bisa
 * menebak kode lewat `GET /api/me` tanpa batas DAN tanpa meninggalkan satu baris
 * pun di log — persis dua hal yang seharusnya dicegah pembatas ini.
 *
 * Menahan jawaban seperempat detik memperlambat penebakan otomatis jauh lebih
 * banyak daripada batas kerasnya, dan tidak pernah mengunci peserta sungguhan.
 */
export async function catatGagal(ip, jalur = '') {
  const daftar = [...terkini(ip), Date.now()];
  gagal.set(ip, daftar);
  log.warn('keamanan', 'kode akses salah', { ip, jalur: jalur || undefined, percobaan: daftar.length });
  await jedaGagal();
}

/** Jeda tetap sesudah kode yang salah, supaya penolakan tidak pernah jadi jalur cepat. */
export const jedaGagal = () => tidur(JEDA_GAGAL_MS);

/** Kode yang benar mengosongkan hitungan — peserta yang salah ketik lalu berhasil tidak tersisa jatah. */
export function catatBerhasil(ip) {
  gagal.delete(ip);
}

/**
 * Memeriksa satu kode akses, lengkap dengan pembatas percobaan.
 *
 * URUTANNYA PENTING: kode yang BENAR diterima lebih dulu, bahkan ketika alamat
 * itu sedang terkunci. Memeriksa kunci lebih dulu terasa lebih ketat, tapi
 * akibatnya justru kebalikannya — di jaringan seluler Indonesia beberapa peserta
 * berbagi satu alamat IP publik, jadi satu tetangga (atau satu pemindai) yang
 * salah menebak akan mengunci peserta yang kodenya benar-benar valid, termasuk
 * yang sedang di tengah mencatat transaksi.
 *
 * Yang dijaga pembatas ini adalah penebakan, dan penebakan tetap terjaga penuh:
 * kode yang salah dibatasi jumlahnya, ditahan seperempat detik, dan dicatat di
 * log. Penyerang tidak punya kode yang benar — jadi jalur cepat ini tidak
 * memberinya apa pun.
 *
 * @returns {Promise<{user: object} | {status: number, error: string}>}
 */
export async function periksaKodeAkses(ip, code, cari, jalur = '') {
  const user = await cari(code);
  if (user) {
    catatBerhasil(ip);
    return { user };
  }
  const terkunci = kodeTerkunci(ip);
  if (terkunci) {
    await jedaGagal();
    return { status: 429, error: terkunci };
  }
  await catatGagal(ip, jalur);
  return { status: 401, error: null };
}

/** Untuk uji — mengosongkan catatan percobaan. */
export function resetLoginGuard() {
  gagal.clear();
}
