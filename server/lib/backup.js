/**
 * Cadangan berkala untuk `data/users.json`.
 *
 * Seluruh pilot ini bersandar pada satu berkas. Peserta yang pindah dari buku
 * tulis ke aplikasi ini menaruh tiga bulan pembukuannya di sana — dan berbeda
 * dengan buku tulis, dia tidak bisa menyusunnya ulang kalau berkas itu rusak
 * atau terhapus. Kehilangan itu membuat dia LEBIH BURUK karena ikut program ini,
 * dan itu satu-satunya kerugian nyata yang bisa ditimbulkan sistem ini.
 *
 * Karena itu cadangan bukan fitur tambahan, melainkan syarat menjalankan pilot.
 */
import { copyFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { denganKunci } from './kunci.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolver SATU tempat untuk folder data (M0-lite, prasyarat B′ 1).
 *
 * Beberapa berkas dulu menghitungnya sendiri-sendiri dengan rumus yang sama —
 * tempat-tempat yang bisa saling tertinggal begitu aturannya berubah. Sejak
 * sesi G fase 4, backup.js dan store.js memakai fungsi ini; penyusun lain
 * menyusul pada gilirannya masing-masing. Rumusnya TIDAK berubah: env
 * NOVA_DATA_DIR bila terpasang, kalau tidak folder data bawaan repo.
 */
export function direktoriData() {
  return process.env.NOVA_DATA_DIR
    ? path.resolve(process.env.NOVA_DATA_DIR)
    : path.join(HERE, '..', 'data');
}

const DATA_DIR = direktoriData();
const DB_PATH = path.join(DATA_DIR, 'users.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backup');

/**
 * Set-berkas-ter yang dibakukan untuk manifest (M0-lite, bentuk minimal jujur
 * dari FDM M0). Yang TIDAK ada tetap tercantum dengan `ada: false` — berkas
 * yang hilang adalah temuan, bukan hal yang didiamkan. Backend non-JSON
 * (mongo/postgres) tidak dicover manifest ini; pencadangan lib ini memang
 * hanya untuk jalur JSON (lihat scripts/backup.js yang menolak backend lain).
 */
const BERKAS_TER = ['users.json', 'users-seed.json'];
const DIR_TER = ['backup', 'export'];

async function sha256Berkas(p) {
  const isi = await readFile(p);
  return createHash('sha256').update(isi).digest('hex');
}

/**
 * Enumerasi berkas data untuk manifest: set-berkas-ter di atas + isi folder
 * terdaftar (satu tingkat, nama saja). Setiap entri membawa keberadaan,
 * ukuran, dan sidik sha256 (bila ada) — cukup untuk membuktikan "cadangan ini
 * dibuat atas data yang mana", tanpa menyalin isinya.
 */
export async function manifestData() {
  const entri = [];
  for (const nama of BERKAS_TER) {
    const p = path.join(DATA_DIR, nama);
    const s = await stat(p).catch(() => null);
    entri.push(s
      ? { jalur: nama, ada: true, byte: s.size, sha256: await sha256Berkas(p) }
      : { jalur: nama, ada: false });
  }
  for (const dir of DIR_TER) {
    const isi = await readdir(path.join(DATA_DIR, dir)).catch(() => []);
    for (const nama of isi.sort()) {
      const p = path.join(DATA_DIR, dir, nama);
      const s = await stat(p).catch(() => null);
      if (!s?.isFile()) continue;
      entri.push({ jalur: `${dir}/${nama}`, ada: true, byte: s.size, sha256: await sha256Berkas(p) });
    }
  }
  return { dibuat: new Date().toISOString(), dataDir: DATA_DIR, berkas: entri };
}

/** Berapa salinan harian yang disimpan sebelum yang terlama dibuang. */
export const KEEP = Number(process.env.BACKUP_KEEP) || 14;

const stamp = (d = new Date()) => d.toISOString().replace(/[:.]/g, '-').slice(0, 19);

/*
 * Dua jenis berkas hidup di folder ini, dan MEMBEDAKANNYA penting.
 *
 *   cadangan  — salinan berkala. Inilah yang dirotasi dan yang dipulihkan.
 *   jepretan  — salinan data berjalan yang dibuat TEPAT SEBELUM pemulihan,
 *               sebagai jaring pengaman kalau berkas yang dipilih ternyata salah.
 *
 * Dulu keduanya bernama `users-*.json` sehingga sama-sama cocok dengan satu pola.
 * Akibatnya dua-duanya buruk: jepretan ikut memakan jatah rotasi (sehingga jumlah
 * cadangan harian yang benar-benar tersimpan menyusut diam-diam), dan karena
 * "users-sebelum-pulih" berurut SESUDAH "users-2026-…", daftar cadangan menaruh
 * jepretan di posisi teratas — lalu menyarankannya sebagai berkas yang dipulihkan.
 * Itu saran yang salah, diberikan tepat saat pengelola sedang panik.
 *
 * Nama lama tetap dikenali supaya folder yang sudah ada tidak jadi kacau.
 */
const isSnapshot = (name) => /^(users-)?sebelum-pulih-.*\.json$/.test(name);
const isBackup = (name) => /^users-.*\.json$/.test(name) && !isSnapshot(name);

/**
 * Kunci pengurutan cadangan — BUKAN nama berkasnya apa adanya.
 *
 * Nama cadangan berbentuk `users-<stempel>.json`, dan dua cadangan pada detik
 * yang sama diberi akhiran `-2`, `-3`, dst. Diurutkan sebagai teks biasa,
 * akhiran itu justru mendarat SEBELUM berkas dasarnya: pada posisi yang sama
 * `-` (0x2D) lebih kecil daripada `.` (0x2E), sehingga
 *
 *     users-…T02-06-05-2.json   <- dianggap lebih tua
 *     users-…T02-06-05.json
 *
 * padahal yang berakhiran `-2` dibuat SESUDAHNYA. Akibatnya `prune()` memilih
 * berkas yang salah untuk dibuang, dan `listBackups()` menyodorkan urutan yang
 * salah tepat ketika pengelola sedang memilih berkas untuk dipulihkan.
 *
 * Karena itu stempel dan nomor urutnya dipisah, lalu nomornya dibandingkan
 * sebagai angka. Nama yang tidak berbentuk itu dikembalikan apa adanya —
 * berkas asing tidak boleh membuat pengurutannya melempar.
 */
const POLA_NAMA = /^users-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})(?:-(\d+))?\.json$/;

export function kunciUrut(nama) {
  const m = POLA_NAMA.exec(nama);
  if (!m) return `zz|${nama}`; // bentuk tak dikenal: taruh di belakang, urut nama
  return `${m[1]}|${String(m[2] ?? 1).padStart(6, '0')}`;
}

/** Membandingkan dua nama cadangan menurut waktu pembuatannya. */
const urutCadangan = (a, b) => kunciUrut(a).localeCompare(kunciUrut(b));

export { BACKUP_DIR, DB_PATH, isBackup, isSnapshot };

/**
 * Membuat satu salinan, lalu memangkas yang terlama.
 *
 * Sumbernya diperiksa dulu: berkas yang tidak bisa di-parse TIDAK disalin.
 * Menyalin berkas rusak ke folder cadangan akan mendorong keluar salinan sehat
 * yang masih ada — cadangan yang justru menghapus satu-satunya data yang utuh.
 */
export async function runBackup({ quiet = false } = {}) {
  let raw;
  try {
    raw = await readFile(DB_PATH, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      if (!quiet) console.warn('[backup] belum ada data untuk dicadangkan.');
      return { skipped: 'tidak-ada-data' };
    }
    throw err;
  }

  let db;
  try {
    db = JSON.parse(raw);
  } catch {
    // Sengaja tidak menyalin. Cadangan sehat yang sudah ada jangan sampai terdorong keluar.
    console.error('[backup] BERKAS DATA TIDAK BISA DIBACA — pencadangan dibatalkan agar salinan sehat tidak hilang.');
    return { skipped: 'data-rusak' };
  }

  /*
   * Bisa di-parse belum tentu basis data. Berkas berisi `{}` lolos JSON.parse,
   * lalu disalin sebagai "0 pengguna" dan mendorong keluar satu salinan sehat —
   * persis bencana yang pemeriksaan di atas dibuat untuk mencegah, cuma lewat
   * pintu yang lain.
   */
  if (!Array.isArray(db.users)) {
    console.error('[backup] BERKAS DATA BUKAN BASIS DATA Novaro — pencadangan dibatalkan agar salinan sehat tidak hilang.');
    return { skipped: 'bukan-basis-data' };
  }

  await mkdir(BACKUP_DIR, { recursive: true });
  let target = path.join(BACKUP_DIR, `users-${stamp()}.json`);
  // Dua cadangan dalam detik yang sama tidak boleh saling menimpa.
  for (let i = 2; await ada(target); i++) target = path.join(BACKUP_DIR, `users-${stamp()}-${i}.json`);
  await copyFile(DB_PATH, target);

  const dibuang = await prune();

  /*
   * Manifest berpasangan dengan cadangannya (M0-lite): enumerasi berkas-ter
   * data ditulis sebagai manifest-<nama-yang-sama>.json di sampingnya, SETELAH
   * prune — supaya isinya adalah keadaan akhir folder, bukan berkas yang
   * sedang menuju dibuang. Pola nama cadangan (/^users-…/) tidak
   * menyentuhnya; rotasi mengenalinya lewat pasangan nama.
   */
  const manifest = path.join(BACKUP_DIR, path.basename(target).replace(/^users-/, 'manifest-'));
  try {
    await writeFile(manifest, JSON.stringify(await manifestData(), null, 2), 'utf8');
  } catch (err) {
    // Cadangan utama sudah aman; manifest yang gagal adalah temuan, bukan
    // alasan membatalkan pencadangan. Diingat keras supaya terlihat.
    console.error('[backup] manifest gagal ditulis — cadangan tetap tersimpan:', err?.message ?? err);
  }
  const info = {
    file: path.basename(target),
    pengguna: db.users?.length ?? 0,
    bytes: raw.length,
    dibuang,
  };
  if (!quiet) {
    console.log(`[backup] ${info.file} — ${info.pengguna} pengguna, ${info.bytes} byte` + (dibuang.length ? `, ${dibuang.length} salinan lama dibuang` : ''));
  }
  return info;
}

const ada = (p) => stat(p).then(() => true, () => false);

/*
 * Nama berkas dari readdir dianggap "hanya nama", tapi pencadangan ini
 * menyentuh data peserta — satu asumsi yang tidak diperiksa adalah satu
 * asumsi yang salah tanpa suara. Entri yang membawa pemisah direktori
 * atau titik-titik ditolak di satu tempat ini, untuk seluruh fungsi di
 * bawah (prune, rincian) sekaligus.
 */
function namaCadanganSah(f) {
  return typeof f === 'string' && !f.includes('/') && !f.includes('\\') && !f.includes('..') && !path.isAbsolute(f);
}

/** Menyisakan KEEP salinan terbaru. Jepretan pra-pemulihan tidak ikut dirotasi. */
async function prune() {
  const files = (await readdir(BACKUP_DIR).catch(() => [])).filter(isBackup).sort(urutCadangan);
  const buang = files.slice(0, Math.max(0, files.length - KEEP));
  for (const f of buang) {
    if (!namaCadanganSah(f)) continue;
    await unlink(path.join(BACKUP_DIR, f)).catch(() => {});
    // Manifest berpasangan ikut pergi bersama cadangannya — rotasi tidak
    // meninggalkan yatim yang mengaku lebih segar dari kenyataannya.
    await unlink(path.join(BACKUP_DIR, f.replace(/^users-/, 'manifest-'))).catch(() => {});
  }
  return buang;
}

async function rincian(f) {
  if (!namaCadanganSah(f)) return { file: f, path: null, bytes: 0, dibuat: null, pengguna: null };
  const p = path.join(BACKUP_DIR, f);
  const s = await stat(p);
  let pengguna = null;
  try {
    const isi = JSON.parse(await readFile(p, 'utf8'));
    pengguna = Array.isArray(isi.users) ? isi.users.length : null;
  } catch {
    /* rusak — biarkan null supaya terlihat di daftar */
  }
  return { file: f, path: p, bytes: s.size, dibuat: s.mtime.toISOString(), pengguna };
}

/** Daftar cadangan berkala, terbaru dulu. */
export async function listBackups() {
  const files = (await readdir(BACKUP_DIR).catch(() => [])).filter(isBackup).sort(urutCadangan).reverse();
  return Promise.all(files.map(rincian));
}

/** Daftar jepretan pra-pemulihan, terbaru dulu. Dipisah supaya tidak pernah tertukar. */
export async function listSnapshots() {
  const files = (await readdir(BACKUP_DIR).catch(() => [])).filter(isSnapshot).sort().reverse();
  return Promise.all(files.map(rincian));
}

/**
 * Memulihkan dari sebuah cadangan.
 *
 * Data yang sedang berjalan disalin dulu ke `sebelum-pulih-*.json`. Pemulihan
 * yang menimpa tanpa jejak hanya memindahkan kehilangan, bukan mencegahnya —
 * salah pilih berkas tidak boleh berarti kehilangan babak kedua.
 *
 * SELURUHNYA DI DALAM KUNCI YANG SAMA DENGAN `store.js`.
 *
 * Sebelumnya tidak. Berkas ini menulis langsung ke berkas data yang sama tanpa
 * pernah menyentuh kunci itu, sehingga satu siklus tulis server yang sedang
 * berjalan bisa MENIMPA hasil pemulihan tanpa satu pun pesan:
 *
 *     server : update() → ambil kunci → load() (data lama) → mutasi …
 *     restore:                                → rename (data pulihan mendarat)
 *     server : … → flush() → menimpa dengan data lama + mutasi   ← pemulihan hilang
 *
 * Bukan kemungkinan teoretis: PANDUAN-PILOT justru menyuruh memulihkan lebih
 * dulu lalu me-restart server SESUDAHNYA — persis jendela itu. Dan ini operasi
 * yang dijalankan justru ketika pengelola sudah berada dalam masalah.
 *
 * Dengan kunci, keduanya tidak pernah tumpang-tindih: pemulihan menunggu siklus
 * tulis yang sedang berjalan selesai, dan siklus berikutnya membaca ulang dari
 * disk karena sidik jari berkasnya sudah berubah.
 */
export async function restoreBackup(file) {
  const src = path.isAbsolute(file) ? file : path.join(BACKUP_DIR, file);

  const raw = await readFile(src, 'utf8');
  const db = JSON.parse(raw); // sengaja dibiarkan melempar bila rusak
  if (!Array.isArray(db.users)) throw new Error('Berkas cadangan tidak berbentuk basis data Novaro.');

  await mkdir(BACKUP_DIR, { recursive: true });

  return denganKunci(DB_PATH, async () => {
    let sebelum = null;
    try {
      // Namanya sengaja TIDAK diawali "users-": jepretan ini bukan cadangan, tidak
      // ikut rotasi, dan tidak boleh pernah muncul sebagai saran untuk dipulihkan.
      sebelum = path.join(BACKUP_DIR, `sebelum-pulih-${stamp()}.json`);
      await copyFile(DB_PATH, sebelum);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      sebelum = null; // belum ada data berjalan — tidak ada yang perlu diselamatkan
    }

    /*
     * Nama sementara memakai PID: dua pemulihan yang berjalan bersamaan dari
     * proses berbeda tidak boleh memakai berkas antara yang sama.
     */
    const tmp = `${DB_PATH}.${process.pid}.pulih.tmp`;
    await writeFile(tmp, raw, 'utf8');
    await rename(tmp, DB_PATH);

    return { dari: path.basename(src), pengguna: db.users.length, salinanSebelumnya: sebelum && path.basename(sebelum) };
  });
}

/**
 * Menyalakan pencadangan otomatis: sekali saat start, lalu tiap `jam`.
 *
 * Dijalankan di dalam proses server supaya pilot tidak bergantung pada cron yang
 * mungkin tidak pernah dipasang. Untuk produksi sungguhan, pasang juga cron ke
 * luar mesin — cadangan yang ada di disk yang sama tidak menolong bila disknya
 * yang hilang.
 */
export function scheduleBackups(jam = Number(process.env.BACKUP_EVERY_HOURS) || 24) {
  runBackup({ quiet: true }).catch((err) => console.error('[backup] gagal saat start:', err.message));
  const timer = setInterval(
    () => runBackup({ quiet: true }).catch((err) => console.error('[backup] gagal:', err.message)),
    jam * 60 * 60 * 1000,
  );
  timer.unref?.(); // jangan menahan proses tetap hidup
  return timer;
}
