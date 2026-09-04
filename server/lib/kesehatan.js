/**
 * Pemeriksaan kesehatan — dan pemeriksaan saat start.
 *
 * ------------------------------------------------------------------
 * KENAPA `{ ok: true }` SAJA BERBAHAYA
 *
 * Sebelumnya `/api/health` menjawab sehat tanpa menyentuh apa pun. Sebagai
 * probe Load Balancer, jawaban seperti itu bukan sekadar kurang berguna — ia
 * menyesatkan ke arah yang paling merugikan: instance yang disk datanya gagal
 * ter-mount (salah `NOVA_DATA_DIR`, volume belum terpasang, disk penuh) akan
 * dinyatakan SEHAT, terus menerima peserta, dan setiap transaksi yang mereka
 * catat hari itu masuk ke tempat yang akan lenyap.
 *
 * Karena itu probe di sini benar-benar menyentuh penyimpanan: membaca berkas
 * data, lalu menulis dan menghapus satu berkas kecil. Kalau salah satunya
 * gagal, jawabannya 503 — dan Load Balancer menarik instance itu keluar,
 * persis seperti yang seharusnya.
 *
 * ------------------------------------------------------------------
 * KENAPA HASILNYA DI-CACHE
 *
 * Probe Load Balancer datang tiap beberapa detik, selamanya. Menulis berkas
 * pada setiap probe berarti ribuan penulisan sehari yang tidak ada gunanya,
 * pada disk yang sama dengan data peserta. Hasilnya disimpan sebentar; yang
 * dijaga adalah "apakah penyimpanan masih hidup", dan itu tidak berubah dalam
 * hitungan detik.
 *
 * Kegagalan TIDAK ikut di-cache selama itu — begitu ada yang gagal, probe
 * berikutnya memeriksa ulang, supaya pemulihan langsung terbaca.
 */
import { open, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { log } from './log.js';
import { JENIS_PENYIMPANAN, pingPenyimpanan, pilihPenyimpanan } from './db.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.NOVA_DATA_DIR
  ? path.resolve(process.env.NOVA_DATA_DIR)
  : path.join(HERE, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'users.json');

/**
 * Selang cache untuk hasil yang SEHAT. Kegagalan tidak pernah di-cache.
 *
 * Bisa diatur lewat lingkungan supaya cocok dengan selang probe Load Balancer
 * yang dipakai — dan supaya uji bisa menetapkannya secara pasti alih-alih
 * bergantung pada jam dinding.
 */
const CACHE_MS = Number(process.env.NOVA_HEALTH_CACHE_MS ?? 15_000);

/**
 * Jeda minimum antar penghitungan ulang jumlah peserta.
 *
 * Menghitung peserta berarti mem-parse SELURUH berkas data. Terukur: pada 300
 * peserta itu 571 ms sekali jalan — dan bila dilakukan pada tiap probe (tiap 15
 * detik, selamanya) menjadi 3,8% satu inti CPU terpakai terus-menerus dan
 * 287 GB dibaca dari disk per hari, hanya untuk menjawab "apakah kamu sehat".
 *
 * Liveness sendiri tidak memerlukannya: "bisa dibaca" dan "bisa ditulis" bisa
 * dibuktikan dengan `stat` + membaca kepala berkas + satu penulisan uji, dan
 * itu berbiaya tetap berapa pun besar datanya. Jumlah peserta adalah medan
 * PEMANTAUAN — berguna untuk melihat data hilang, tapi tidak menentukan sehat
 * atau tidaknya instance ini.
 *
 * Akibat yang disadari: berkas yang rusak di bagian TENGAH atau AKHIR baru
 * ketahuan pada penghitungan penuh berikutnya — paling lama satu menit. Untuk
 * probe yang menarik instance keluar dari Load Balancer, jeda satu menit jauh
 * lebih murah daripada beban tetap di atas.
 */
const HITUNG_MIN_MS = Number(process.env.NOVA_HEALTH_COUNT_MS ?? 60_000);

/** Berapa byte kepala berkas yang dibaca untuk membuktikan ia masih basis data kita. */
const KEPALA_BYTE = 4096;

let terakhir = null; // { pada: number, hasil: object }
let hitungan = null; // { sidik: string, pada: number, jumlah: number }

/**
 * Membuktikan folder data benar-benar bisa ditulis.
 *
 * Berkas ujinya memakai PID supaya dua proses (server dan perintah CLI) tidak
 * pernah saling menimpa atau saling menghapus berkas uji yang sama.
 */
async function bisaMenulis() {
  const uji = path.join(DATA_DIR, `.tulis-uji-${process.pid}`);
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(uji, String(Date.now()), 'utf8');
    await unlink(uji);
    return { ok: true };
  } catch (err) {
    return { ok: false, alasan: err.code ?? err.message };
  }
}

/** Sidik jari berkas — sama bentuknya dengan store.js: isi yang sama, berkas yang sama. */
async function sidikBerkas(s) {
  return `${s.ino}:${s.size}:${s.mtimeMs}`;
}

/**
 * Menghitung peserta dengan mem-parse seluruh berkas — MAHAL, jadi ditahan.
 *
 * Dilewati bila berkasnya belum berubah (sidik jari sama: jumlahnya mustahil
 * berubah), atau bila baru saja dihitung. `menyeluruh` memaksa hitung ulang;
 * dipakai pemeriksaan saat start, satu-satunya saat berkas rusak paling perlu
 * ketahuan sebelum satu peserta pun masuk.
 */
async function hitungPeserta(sidik, { menyeluruh = false } = {}) {
  const segar = hitungan && hitungan.sidik === sidik;
  const barusan = hitungan && Date.now() - hitungan.pada < HITUNG_MIN_MS;
  if (!menyeluruh && (segar || barusan)) {
    return { ok: true, jumlah: hitungan.jumlah, diukurPada: hitungan.pada };
  }
  try {
    const isi = JSON.parse(await readFile(DB_PATH, 'utf8'));
    if (!Array.isArray(isi?.users)) return { ok: false, alasan: 'bentuk-berkas-tidak-dikenali' };
    hitungan = { sidik, pada: Date.now(), jumlah: isi.users.length };
    return { ok: true, jumlah: hitungan.jumlah, diukurPada: hitungan.pada };
  } catch (err) {
    hitungan = null;
    return { ok: false, alasan: err.code ?? 'berkas-rusak' };
  }
}

/**
 * Membuktikan berkas data bisa dibaca dan bentuknya masih benar.
 *
 * Berkas yang BELUM ADA dianggap sehat: itu keadaan sah sebelum peserta
 * pertama ditambahkan. Yang tidak sehat adalah berkas yang ada tapi tidak bisa
 * dibuka atau sudah bukan basis data ini — dan bedanya penting, karena yang
 * pertama normal dan yang kedua berarti jangan menerima peserta.
 *
 * Hanya KEPALA berkas yang dibaca (4 KB). Itu cukup membuktikan berkasnya bisa
 * dibuka dan masih berbentuk basis data Novaro, dengan biaya yang tidak
 * bertambah walau datanya tumbuh menjadi ratusan megabita.
 */
async function bisaMembaca({ menyeluruh = false } = {}) {
  let s;
  try {
    s = await stat(DB_PATH);
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: true, kosong: true, peserta: 0 };
    return { ok: false, alasan: err.code ?? err.message };
  }

  let kepala;
  try {
    const fh = await open(DB_PATH, 'r');
    try {
      const buf = Buffer.alloc(Math.min(KEPALA_BYTE, Math.max(s.size, 1)));
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      kepala = buf.subarray(0, bytesRead).toString('utf8');
    } finally {
      await fh.close();
    }
  } catch (err) {
    return { ok: false, alasan: err.code ?? err.message };
  }

  if (!kepala.trimStart().startsWith('{') || !kepala.includes('"users"')) {
    return { ok: false, alasan: 'bentuk-berkas-tidak-dikenali' };
  }

  const jumlah = await hitungPeserta(await sidikBerkas(s), { menyeluruh });
  if (!jumlah.ok) return { ok: false, alasan: jumlah.alasan };
  return { ok: true, kosong: false, peserta: jumlah.jumlah, diukurPada: jumlah.diukurPada };
}

/**
 * Status kesehatan penyimpanan.
 *
 * Jalur json diperiksa lewat berkas (baca+tulis, seperti sejak awal).
 * Jalur postgres/mongo diperiksa lewat PING SUNGGUHAN ke server — probe
 * yang menyatakan sehat tanpa menyentuh penyimpanannya adalah probe yang
 * menyesatkan, dan di produksi penyimpanan justru satu-satunya hal yang
 * tidak boleh diam-diam rusak.
 *
 * @returns {Promise<{sehat: boolean, jenis: string, baca: object, tulis: object, peserta: number|null}>}
 */
export async function periksaPenyimpanan({ menyeluruh = false } = {}) {
  if (!menyeluruh && terakhir && terakhir.hasil.sehat && Date.now() - terakhir.pada < CACHE_MS) {
    return terakhir.hasil;
  }

  if (JENIS_PENYIMPANAN !== 'json') {
    const ping = await pingPenyimpanan();
    const hasil = {
      jenis: JENIS_PENYIMPANAN,
      sehat: Boolean(ping?.ok),
      baca: ping?.ok ? 'ok' : (ping?.alasan ?? 'tidak-terjangkau'),
      tulis: ping?.ok ? 'ok' : (ping?.alasan ?? 'tidak-terjangkau'),
      peserta: ping?.ok ? (ping.peserta ?? 0) : null,
      pesertaDiukurPada: ping?.ok ? new Date().toISOString() : null,
    };
    if (hasil.sehat) terakhir = { pada: Date.now(), hasil };
    return hasil;
  }

  const [baca, tulis] = await Promise.all([bisaMembaca({ menyeluruh }), bisaMenulis()]);
  const hasil = {
    jenis: 'json',
    sehat: baca.ok && tulis.ok,
    baca: baca.ok ? 'ok' : baca.alasan,
    tulis: tulis.ok ? 'ok' : tulis.alasan,
    // Jumlah peserta ikut supaya "data hilang" terlihat dari pemantauan, bukan
    // hanya dari baris saat start yang cuma tercetak sekali. Angkanya boleh
    // berumur sampai satu menit — lihat HITUNG_MIN_MS.
    peserta: baca.ok ? (baca.peserta ?? 0) : null,
    pesertaDiukurPada: baca.ok && baca.diukurPada ? new Date(baca.diukurPada).toISOString() : null,
  };

  terakhir = { pada: Date.now(), hasil };
  return hasil;
}

/**
 * Syarat produksi: ketika NOVA_REQUIRE_PERSISTENT_STORE=1, penyimpanan
 * berkas JSON (fana di container) TIDAK BOLEH dipakai — server memilih
 * berhenti daripada menerima catatan pengguna yang pasti lenyap saat
 * redeploy. Murni dan membaca env saat DIPANGGIL, supaya teruji langsung.
 *
 * @returns {{lulus: boolean, jenis: string, pesan?: string}}
 */
export function cekSyaratProduksi(env = process.env) {
  const jenis = pilihPenyimpanan(env);
  if (String(env.NOVA_REQUIRE_PERSISTENT_STORE ?? '').trim() !== '1') {
    return { lulus: true, jenis };
  }
  if (jenis === 'json') {
    return {
      lulus: false,
      jenis,
      pesan:
        'NOVA_REQUIRE_PERSISTENT_STORE=1 tetapi tidak ada DATABASE_URL/MONGO_URI — ' +
        'sistem berkas container FANA: seluruh data lenyap saat redeploy. ' +
        'Isi MONGO_URI (MongoDB terkelola Emergent) atau DATABASE_URL, ' +
        'atau kosongkan NOVA_REQUIRE_PERSISTENT_STORE bila ini memang lingkungan demo.',
    };
  }
  return { lulus: true, jenis };
}

/**
 * Pemeriksaan sekali saat start — dan MENOLAK JALAN kalau gagal.
 *
 * Baris "Pengguna: N termuat" yang sudah ada hanya membuktikan data bisa
 * DIBACA. Disk yang ter-mount read-only, atau folder milik pengguna lain,
 * lolos pemeriksaan itu dengan mulus — lalu setiap penyimpanan peserta gagal
 * satu per satu sepanjang hari, masing-masing sebagai galat terpisah yang
 * tidak pernah dibaca siapa pun.
 *
 * Berhenti dengan keras di sini justru yang paling aman: proses yang mati
 * berulang TERLIHAT (systemd mencatatnya, Cloud Run memberi tanda), sedangkan
 * penyimpanan yang gagal diam-diam tidak terlihat sampai ada peserta yang
 * kehilangan pembukuan tiga bulan.
 */
export async function wajibBisaMenyimpan() {
  // Pagar produksi lebih dulu: JSON fana + syarat persisten = jangan menyala.
  const syarat = cekSyaratProduksi();
  if (!syarat.lulus) {
    log.error('kesehatan', 'penyimpanan persisten wajib tapi tidak terpasang — server tidak dinyalakan', {
      jenis: syarat.jenis,
    });
    console.error(`
  ────────────────────────────────────────────────────────────────
  SERVER TIDAK DINYALAKAN — penyimpanan persisten tidak terpasang.

    Jenis aktif : ${syarat.jenis} (berkas JSON — fana di container)
    Penyebab    : ${syarat.pesan}

  Produksi dengan pengguna sungguhan tidak boleh menulis ke sistem
  berkas yang lenyap saat redeploy. Menyalakan server dalam keadaan ini
  berarti menerima catatan yang pasti hilang tanpa memberi tahu siapa pun.
  ────────────────────────────────────────────────────────────────
`);
    process.exit(1);
  }

  /*
   * Peringatan (bukan penghentian) untuk produksi JSON tanpa syarat
   * eksplisit: preview/demo memang sengaja begini, tetap boleh menyala —
   * tapi keputusan itu berhak terbaca di log, bukan berlalu diam-diam.
   */
  if (String(process.env.NODE_ENV ?? '') === 'production' && JENIS_PENYIMPANAN === 'json') {
    log.warn('kesehatan', 'NODE_ENV=production dengan penyimpanan JSON fana — data lenyap saat redeploy', {
      jenis: 'json',
    });
    console.warn(`
  ⚠  PRODUKSI MENYIMPAN KE BERKAS JSON (fana di container).
     Setiap redeploy mengganti container dan menghapus seluruh data.
     Untuk pengguna sungguhan: pasang MONGO_URI/DATABASE_URL dan
     NOVA_REQUIRE_PERSISTENT_STORE=1. Untuk demo/preview: abaikan.
`);
  }

  // Menyeluruh: saat start adalah satu-satunya saat berkas rusak paling perlu
  // ketahuan, sebelum satu peserta pun sempat masuk.
  const hasil = await periksaPenyimpanan({ menyeluruh: true });
  if (hasil.sehat) return hasil;

  log.error('kesehatan', 'penyimpanan tidak bisa dipakai — server tidak dinyalakan', {
    jenis: hasil.jenis,
    dataDir: DATA_DIR,
    baca: hasil.baca,
    tulis: hasil.tulis,
  });
  console.error(`
  ────────────────────────────────────────────────────────────────
  SERVER TIDAK DINYALAKAN — penyimpanan tidak bisa dipakai.

    Jenis  : ${hasil.jenis}
    Folder : ${DATA_DIR}
    Baca   : ${hasil.baca}
    Tulis  : ${hasil.tulis}

  Yang biasanya menjadi penyebabnya:
    - NOVA_DATA_DIR menunjuk folder yang salah atau belum ada
    - disk/volume belum ter-mount di jalur itu
    - folder milik pengguna lain (periksa: ls -ld ${DATA_DIR})
    - disk penuh (periksa: df -h)
    - untuk mongo/postgres: URI salah, server tidak terjangkau, atau
      kredensial ditolak — periksa MONGO_URI / DATABASE_URL

  Perbaiki dulu. Menyalakan server dengan penyimpanan yang tidak bisa
  ditulis berarti menerima catatan peserta yang tidak akan pernah tersimpan.
  ────────────────────────────────────────────────────────────────
`);
  process.exit(1);
}

export { DATA_DIR };
