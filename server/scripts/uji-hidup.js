#!/usr/bin/env node
/**
 * Uji hidup: bukti TERSIMPAN bahwa runtime yang TERDEPLOY benar-benar
 * melakukan satu panggilan AI nyata.
 *
 *   node scripts/uji-hidup.js --base https://<alamat-layanan>.run.app
 *   node scripts/uji-hidup.js --health-only          (tanpa panggilan AI)
 *
 * ------------------------------------------------------------------
 * KENAPA `npm run smoke` TIDAK CUKUP
 *
 * smoke.js mengimpor lib/ai.js DI DALAM PROSESNYA SENDIRI: yang dibuktikan
 * adalah kredensial mesin yang menjalankan skrip. Cloud Run punya identitas
 * lain — service account layanan — dan tidak ada satu pun uji lokal yang
 * bisa meminjamnya. Selama tidak ada artefak bertanggal dari panggilan yang
 * MELEWATI layanan terdeploy, bukti AI Cloud Run tetap L0 (keputusan §17–18).
 *
 * Rantai buktinya: /api/health (layanan hidup, konfigurasi terbaca) →
 * /api/demo (jalur terautentikasi nyata tanpa rahasia apa pun) → SATU
 * panggilan AI nyata yang dijalankan service account layanan:
 *
 *   chat     (bawaan, --ai-route chat) — /api/chat dialirkan sebagai SSE;
 *            buktinya paling lengkap: potongan benar-benar mengalir, server
 *            mencatat pemakaian tokennya, dan label model dilaporkan sendiri
 *            oleh peristiwa done. Riwayat giliran uji DIHAPUS lagi lewat
 *            DELETE /api/chat — akun demo tidak menumpuk sisa uji.
 *   checkup  (--ai-route checkup) — /api/checkup, satu panggilan JSON
 *            terbatas. Jalur rung inilah yang dinamai keputusan §18; pilih
 *            bila revisi yang dideploy sudah membuktikan rutenya sendiri.
 *   interview (--ai-route interview) — rantai sidecar interviu (W1):
 *            mulai → giliran → selesai → examiner terbaca di riwayat.
 *            Sidecar OFF di layanan = skipped 'sidecar off' (hijau jujur);
 *            examiner 'unavailable' = gagal jujur (rantai belum lengkap).
 *   proposal (--ai-route proposal) — rantai T1 surface #1: scan (token
 *            diterbitkan) → konfirmasi satu-ketuk via /api/cashbook (baris
 *            origin 'proposal') → replay token (wajib 409 duplikat).
 *            Fitur NOVA_PROPOSAL_SCAN + NOVA_PROPOSAL_SECRET harus aktif di
 *            layanan; rung ini justru rung pembuktiannya sebelum exposure.
 *   rekomendasi (--ai-route rekomendasi) — /api/recommendations, satu
 *            panggilan JSON untuk penyusunan termahal di aplikasi. Slot
 *            rekomendasi akun demo tertimpa apa adanya (satu slot, tanpa
 *            akumulasi), jadi jalur ini tidak butuh langkah pembersihan.
 *            Provenansi model yang tersimpan di slot dilaporkan apa adanya
 *            di artefak — bukti identitas sekaligus bukti penyimpanan.
 *
 * Keduanya murah dan terbatas (puluhan rupiah), tidak menyentuh baris
 * keuangan apa pun — mereka hanya MELIHAT angka demo lalu mencatat pemakaian
 * token. Akun yang dipakai adalah akun demo fiktif, bukan peserta penelitian.
 *
 * ------------------------------------------------------------------
 * YANG TIDAK PERNAH DITULIS KE ARTEFAK
 *
 * Kode akses demo adalah kredensial (keluar dari /api/demo), jadi dipakai
 * lalu DIBUANG — tidak pernah masuk artefak atau stdout. Nilai env layanan
 * (mis. DATABASE_URL, kode validasi) hanya direkam SEBAGAI NAMA; nilainya
 * direkam hanya untuk lima kunci yang aman. Artefak boleh berisi hasil AI
 * atas data demo fiktif, jangan berisi apa pun tentang peserta sungguhan.
 */

import { execFile, exec } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';

const execFileP = promisify(execFile);
const execP = promisify(exec);

const VERSI_ALAT = '1.0.0';
const SCHEMA_VERSI = 1;

/*
 * Pertanyaan uji: tetap, singkat, tanpa data keuangan apa pun. Tetap supaya
 * hasil antar-run bisa dibandingkan; tanpa data keuangan supaya yang dikirim
 * ke penyedia hanya profil demo fiktif yang sudah ada di server.
 */
const PESAN_UJI =
  'Ini uji kesehatan sistem. Balas dengan SATU kalimat pendek: sebutkan satu manfaat mencatat kas harian.';

/** Kunci env layanan yang nilainya BOLEH direkam. Sisanya nama saja. */
const ENV_BOLEH_DIISI = new Set([
  'CLOUD_ML_REGION',
  'VERTEX_REGION',
  'GEMINI_MODEL',
  'NOVA_AI_BACKEND',
  'NODE_ENV',
]);

/** Peran IAM yang menjadi prasyarat jalur Gemini/Vertex — untuk artefak. */
const PERAN_KUNCI = 'roles/aiplatform.user';

/* ------------------------------------------------------------ fungsi murni */

/**
 * Membaca log langkah deploy Cloud Build (deploy.log hasil `tee`) untuk
 * menemukan alamat layanan dan nama revisi. Keduanya bersifat best-effort:
 * log berisi progres gcloud yang bentuknya bisa berubah, jadi yang dicari
 * hanyalah pola yang stabil — URL *.run.app dan nama revisi layanan.
 *
 * @param {string} teks isi deploy.log
 * @returns {{baseUrl: string|null, revision: string|null}}
 */
export function parseDeployLog(teks) {
  // Host run.app memuat titik (mis. novaexplorer-532597100979.asia-southeast2),
  // jadi kelas karakternya harus menerima titik juga.
  const baseUrl = teks.match(/https:\/\/[a-z0-9.-]+\.run\.app/i)?.[0] ?? null;
  const revision = teks.match(/\b([a-z][a-z0-9-]*-\d{5}-[a-z0-9]+)\b/)?.[1] ?? null;
  return { baseUrl, revision };
}

/**
 * Menyaring daftar env layanan menjadi bukti yang AMAN direkam:
 * nilai hanya untuk ENV_BOLEH_DIISI, sisanya kehadiran saja.
 * Secret yang terpasang (valueFrom) dicatat sebagai nama + tanda terpasang.
 *
 * @param {{name: string, value?: string, valueFrom?: object}[]} envList
 */
export function saringEnv(envList) {
  const bernilai = {};
  const hanyaNama = [];
  for (const e of envList ?? []) {
    if (ENV_BOLEH_DIISI.has(e.name) && typeof e.value === 'string') {
      bernilai[e.name] = e.value;
    } else {
      hanyaNama.push({ nama: e.name, secret: Boolean(e.valueFrom) });
    }
  }
  return { bernilai, hanyaNama };
}

/**
 * Perkiraan biaya satu panggilan, per backend, dengan tarif yang disebut
 * sumber dan tanggalnya. Tarif berubah — yang benar adalah angka pemakaian
 * token (bukti dari penyedia); angka rupiah di sini hanya PERKIRAAN.
 *
 * cache_read untuk Gemini disengaja TIDAK diberi diskon (tarif cache belum
 * terverifikasi) — perkiraan menjadi batas atas, bukan batas bawah. Lebih
 * baik lebih mahal di kertas daripada menggembungkan keyakinan hemat.
 *
 * @param {string} backend 'gemini' | 'anthropic' | 'vertex'
 * @param {{input_tokens?: number, output_tokens?: number,
 *          cache_read_input_tokens?: number, cache_creation_input_tokens?: number}} usage
 * @returns {object|null} null bila backend tidak dikenali — bukan angka tebak-tebakan
 */
export function perkiraanBiaya(backend, usage) {
  const tarif = {
    gemini: {
      input: 0.3, output: 2.5, cacheBuat: 0, cacheBaca: 0.3,
      asal: 'Google — Gemini 2.5 Flash, tarif standar Vertex AI/Gemini API',
      asOf: '2026-09-11',
      catatan: 'cache_read dihargai setara input (diskon cache tidak diterapkan — batas atas)',
    },
    anthropic: {
      input: 3, output: 15, cacheBuat: 3.75, cacheBaca: 0.3,
      asal: 'Anthropic — daftar harga claude-3-5-sonnet-20241022',
      asOf: '2026-09-11',
      catatan: 'cache 1.25x / 0.1x dari tarif input standar',
    },
    vertex: {
      input: 3, output: 15, cacheBuat: 3.75, cacheBaca: 0.3,
      asal: 'Anthropic — daftar harga Claude (diasumsikan sama di Vertex, partner model)',
      asOf: '2026-09-11',
      catatan: 'ASUMSI: tarif Vertex mengikuti daftar Anthropic — verifikasi bila dipakai untuk keputusan biaya',
    },
  }[backend];
  if (!tarif) return null;

  const n = (v) => Number(v) || 0;
  const u = usage ?? {};
  const usd =
    (n(u.input_tokens) * tarif.input +
      n(u.output_tokens) * tarif.output +
      n(u.cache_creation_input_tokens) * tarif.cacheBuat +
      n(u.cache_read_input_tokens) * tarif.cacheBaca) /
    1e6;
  const KURS = 16_500; // kurs kerja smoke.js — perkiraan, bukan kurs harian
  return {
    usd: Number(usd.toFixed(6)),
    idrPerkiraan: Math.round(usd * KURS),
    tarif,
  };
}

/** Memotong teks untuk artefak/layar. */
export function potong(teks, n = 200) {
  const s = String(teks ?? '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/* --------------------------------------------------------------- utilitas */

function kandidatGcloud() {
  return process.platform === 'win32' ? ['gcloud.cmd', 'gcloud'] : ['gcloud'];
}

async function jalankan(cmd, args, viaShell) {
  if (!viaShell) {
    const { stdout } = await execFileP(cmd, args, { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  }
  // Jalur shell (hanya fallback Windows untuk gcloud.cmd): perintahnya
  // dirangkai jadi SATU string supaya Node tidak memprotes penyambungan
  // argumen (DEP0190). Argumennya konstanta skrip atau ketikan operator.
  const rangkai = [cmd, ...args].map((s) => (/[\s"]/.test(s) ? JSON.stringify(s) : s)).join(' ');
  const { stdout } = await execP(rangkai, { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

async function gcloud(args, catatan) {
  for (const cmd of kandidatGcloud()) {
    try {
      return await jalankan(cmd, args, false);
    } catch (err) {
      /*
       * Node ≥20.12 menolak mengeksekusi .cmd/.bat tanpa shell (EINVAL —
       * mitigasi CVE-2024-27980), dan di Windows gcloud adalah gcloud.cmd.
       * Satu-satunya jalan adalah lewat shell. Argumennya selalu konstanta
       * skrip atau bendera yang diketik operatornya sendiri — tidak ada input
       * jarak jauh yang pernah sampai ke sini.
       */
      if (err?.code === 'EINVAL') {
        try {
          return await jalankan(cmd, args, true);
        } catch (err2) {
          catatan.push(`gcloud ${args[0]} gagal: ${potong(err2?.message ?? err2, 160)}`);
          return null;
        }
      }
      if (err?.code === 'ENOENT') continue; // kandidat ini tidak ada, coba berikutnya
      catatan.push(`gcloud ${args[0]} gagal: ${potong(err?.message ?? err, 160)}`);
      return null;
    }
  }
  catatan.push('gcloud tidak ditemukan di PATH — bukti identitas runtime dilewati');
  return null;
}

/** fetch dengan batas waktu; mengembalikan {status, body} tanpa pernah melempar. */
async function ambil(url, opts = {}, timeoutMs = 60_000) {
  const mulai = Date.now();
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
    const teks = await res.text();
    let body = null;
    try {
      body = JSON.parse(teks);
    } catch {
      body = teks;
    }
    return { status: res.status, body, ms: Date.now() - mulai, teks };
  } catch (err) {
    return { status: 0, body: null, ms: Date.now() - mulai, teks: '', galat: potong(err?.cause?.message ?? err?.message ?? err, 200) };
  }
}

function gagal(langkah, status, alasan, ekstra = {}) {
  return { langkah, status, lulus: false, alasan, ...ekstra };
}

/**
 * Satu giliran chat nyata: /api/chat dialirkan sebagai SSE (event: delta →
 * done). Yang dibuktikan bukan isi jawabannya, melainkan BAHWA potongan
 * mengalir, server mencatat pemakaian tokennya, dan label model yang dipakai
 * runtime dilaporkan sendiri oleh peristiwa `done`.
 *
 * Riwayat giliran ini DIHAPUS sendiri oleh pemanggilnya lewat DELETE /api/chat
 * — akun demo tidak boleh menumpuk sisa uji.
 */
async function langkahPercakapan(base, kode, timeoutMs) {
  const res = await ambil(
    `${base}/api/chat`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kode}` },
      body: JSON.stringify({
        message: PESAN_UJI,
      }),
    },
    timeoutMs,
  );

  if (res.status !== 200) {
    return { lulus: false, status: res.status, ms: res.ms, alasan: res.galat ?? `status ${res.status}: ${potong(res.teks, 200)}` };
  }

  // Parsing SSE: baris "event: <nama>" diikuti "data: <json>".
  let event = null;
  let potongan = 0;
  let panjangJawaban = 0;
  let selesai = null;
  let galat = null;
  for (const baris of res.teks.split('\n')) {
    if (baris.startsWith('event: ')) {
      event = baris.slice(7).trim();
      continue;
    }
    if (!baris.startsWith('data: ')) continue;
    let data;
    try {
      data = JSON.parse(baris.slice(6));
    } catch {
      continue;
    }
    if (event === 'delta') {
      potongan += 1;
      panjangJawaban += String(data.text ?? '').length;
    } else if (event === 'done') {
      selesai = data;
    } else if (event === 'error') {
      galat = data?.error ?? 'galat tak dikenal dari aliran';
    }
  }

  if (galat) return { lulus: false, status: 200, ms: res.ms, alasan: `aliran error: ${potong(galat, 200)}` };
  if (!selesai) {
    return { lulus: false, status: 200, ms: res.ms, alasan: 'peristiwa done tidak pernah tiba (aliran terpotong?)' };
  }
  if (potongan === 0 || panjangJawaban === 0) {
    return { lulus: false, status: 200, ms: res.ms, alasan: 'tidak ada satu pun potongan delta yang mengalir' };
  }

  const sukses = {
    langkah: 'percakapan',
    lulus: true,
    status: 200,
    ms: res.ms,
    model: selesai.model ?? null,
    potonganMengalir: potongan,
    panjangJawaban,
    terpotong: Boolean(selesai.terpotong),
    anggaranSesudah: selesai.anggaran ?? null,
    pesan: PESAN_UJI,
  };
  // Dulu smoke.js menetapkan: jawaban terpotong = gagal. Aturan yang sama
  // berlaku di sini — max_tokens yang kurang adalah masalah konfigurasi.
  if (sukses.terpotong) {
    return { ...sukses, lulus: false, alasan: 'jawaban terpotong (max_tokens terlalu kecil untuk pertanyaan uji)' };
  }
  return sukses;
}

/** Jalur checkup (pilihan --ai-route checkup): satu panggilan JSON terbatas. */
async function langkahCheckup(base, kode, timeoutMs) {
  const res = await ambil(
    `${base}/api/checkup`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kode}` },
      body: '{}',
    },
    timeoutMs,
  );
  const hasil = res.body?.hasil;
  const lulus = res.status === 200 && hasil && typeof hasil === 'object' && Object.keys(hasil).length > 0;
  return lulus
    ? {
        langkah: 'checkup',
        lulus: true, status: res.status, ms: res.ms,
        hasil: potongObjek(hasil),
        anggaranSesudah: res.body?.anggaran ?? null,
      }
    : gagal('checkup', res.status, res.galat ?? `status ${res.status}: ${potong(res.teks, 300)}`, { ms: res.ms });
}

/**
 * Penilai jawaban /api/recommendations — MURNI, dieksor untuk uji.
 *
 * Yang membuktikan rung ini bukan sekadar 200: slot rekomendasi harus benar
 * bentuknya (ada butir), membawa provenansi aslinya (sumber, dan model bila
 * server mengenalinya — tidak pernah ditebak di sini), dan anggaran server
 * ikut di jawaban — delta itulah yang membuktikan provider benar-benar
 * dipakai. Prosa ringkasan dipotong; artefak boleh berisi hasil AI atas data
 * demo fiktif, bukan data peserta.
 *
 * @returns {object} rekam langkah {langkah:'rekomendasi', lulus, ...} —
 *   rekam gagal lengkapnya dirakit langkahRekomendasi (butuh galat transport).
 */
export function rekamRekomendasi(body, status, ms) {
  const rekomendasi = body?.recommendations;
  const sah =
    status === 200 &&
    rekomendasi && typeof rekomendasi === 'object' &&
    Array.isArray(rekomendasi.rekomendasi) && rekomendasi.rekomendasi.length > 0;
  if (!sah) {
    return {
      langkah: 'rekomendasi',
      lulus: false,
      status,
      ms,
      alasan:
        status !== 200
          ? `status ${status}`
          : !rekomendasi || typeof rekomendasi !== 'object'
            ? 'jawaban tanpa slot rekomendasi'
            : 'slot rekomendasi tanpa satu pun butir',
    };
  }
  return {
    langkah: 'rekomendasi',
    lulus: true,
    status,
    ms,
    jumlah: rekomendasi.rekomendasi.length,
    jumlahPeringatan: Array.isArray(rekomendasi.peringatan) ? rekomendasi.peringatan.length : 0,
    jumlahTarget: Array.isArray(rekomendasi.targetBulanIni) ? rekomendasi.targetBulanIni.length : 0,
    // Provenansi apa adanya dari slot tersimpan — bukti identitas sekaligus
    // bukti bahwa yang dibaca adalah rekam yang baru ditulis.
    sumber: rekomendasi.sumber ?? null,
    model: rekomendasi.model ?? null,
    pratinjau: potongObjek({ ringkasan: rekomendasi.ringkasan }),
    anggaranSesudah: body?.anggaran ?? null,
  };
}

/** Jalur rekomendasi (pilihan --ai-route rekomendasi): satu panggilan JSON. */
async function langkahRekomendasi(base, kode, timeoutMs) {
  const res = await ambil(
    `${base}/api/recommendations`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kode}` },
      body: '{}',
    },
    timeoutMs,
  );
  const hasil = rekamRekomendasi(res.body, res.status, res.ms);
  return hasil.lulus
    ? hasil
    : gagal('rekomendasi', res.status, res.galat ?? `status ${res.status}: ${potong(res.teks, 300)}`, { ms: res.ms });
}

/* ------------------- Rung proposal (T1 surface #1, fase 5) --------------- */

/**
 * Citra uji PNG deterministik (grayscale murni, tanpa dependensi). Isinya
 * sengaja polos: yang diuji rung ini adalah RANTAINYA (token → konfirmasi →
 * replay), bukan kualitas OCR — sanitasiHasilNota tidak pernah menolak hasil
 * kosong, jadi citra polos pun menghasilkan usulan bertoken.
 */
export function gambarNotaUji(lebar = 64, tinggi = 32) {
  const crc = (buf) => {
    let c, tabel = crc.tabel ?? (crc.tabel = Array.from({ length: 256 }, (_, n) => {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    }));
    c = 0xffffffff;
    for (const b of buf) c = tabel[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const potongan = (jenis, isi) => {
    const panjang = Buffer.alloc(4);
    panjang.writeUInt32BE(isi.length);
    const nama = Buffer.from(jenis, 'ascii');
    const batal = Buffer.alloc(4);
    batal.writeUInt32BE(crc(Buffer.concat([nama, isi])));
    return Buffer.concat([panjang, nama, isi, batal]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lebar, 0);
  ihdr.writeUInt32BE(tinggi, 4);
  ihdr[8] = 8;  // kedalaman bit
  ihdr[9] = 0;  // grayscale
  const mentah = Buffer.alloc(tinggi * (1 + lebar), 0xee); // baris filter-0 + piksel abu muda
  const idat = deflateSync(mentah);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    potongan('IHDR', ihdr),
    potongan('IDAT', idat),
    potongan('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Penilai langkah scan rung proposal — MURNI, dieksor untuk uji.
 *
 * 200 saja tidak cukup: jawaban harus membawa usulan BERTOKEN (fitur aktif +
 * rahasia terpasang di layanan terdeploy). 200 tanpa proposal = fitur mati —
 * kegagalan konfigurasi yang jujur disebut, bukan dilewati.
 */
export function rekamProposalScan(body, status, ms) {
  if (status === 200 && body?.proposal?.token) {
    return {
      langkah: 'proposal-scan', lulus: true, status, ms,
      proposalId: body.proposal.id ?? null,
      tingkat: body.hasil?.tingkat ?? null,
      anggaranSesudah: body.anggaran ?? null,
    };
  }
  return {
    langkah: 'proposal-scan',
    lulus: false,
    status,
    ms,
    alasan: status === 200
      ? 'jawaban tanpa usulan bertoken — NOVA_PROPOSAL_SCAN/NOVA_PROPOSAL_SECRET tidak aktif di layanan ini'
      : `status ${status}`,
  };
}

/**
 * Penilai langkah konfirmasi — MURNI. Baris sah = lahir lewat mutator dengan
 * origin 'proposal' + proposalId yang sama dengan usulan; edit-angka sebelum
 * simpan adalah alur resmi (manusia yang memutuskan angkanya).
 */
export function rekamProposalKonfirmasi(body, status, ms, proposalId) {
  const trx = body?.transaction;
  if (status === 201 && trx?.origin === 'proposal' && (!proposalId || trx.proposalId === proposalId)) {
    return { langkah: 'proposal-konfirmasi', lulus: true, status, ms, transactionId: trx.id ?? null };
  }
  return {
    langkah: 'proposal-konfirmasi',
    lulus: false,
    status,
    ms,
    alasan: status !== 201
      ? `status ${status}`
      : `baris tidak lahir dari usulan (origin: ${trx?.origin ?? 'tanpa-baris'})`,
  };
}

/** Penilai langkah replay — MURNI: token terkonsumsi wajib ditolak 409 duplikat. */
export function rekamProposalReplay(body, status, ms) {
  const lulus = status === 409 && body?.kode === 'duplikat';
  return { langkah: 'proposal-replay', lulus, status, ms, ...(lulus ? {} : { alasan: `status ${status} (kode: ${body?.kode ?? 'tanpa-kode'}) — token sekali pakai tidak tertolak` }) };
}

/**
 * Jalur proposal (pilihan --ai-route proposal): scan → konfirmasi satu-ketuk →
 * replay. Membuktikan rantai T1 surface #1 secara live: token diterbitkan
 * runtime terdeploy, dikonsumsi mutator (origin 'proposal'), dan sekali pakai.
 * Baris uji mendarat di AKUN DEMO fiktif — bukan peserta; tanpa pembersihan
 * (satu baris per eksekusi rung, akun demo sekali pakai).
 */
async function langkahProposal(base, kode, timeoutMs) {
  const HARI = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

  const scan = await ambil(`${base}/api/scan-nota`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${kode}` },
    body: gambarNotaUji(),
  }, timeoutMs);
  const rekamScan = rekamProposalScan(scan.body, scan.status, scan.ms);
  if (!rekamScan.lulus) return { ...rekamScan, langkah: 'proposal' };

  const konfirmasi = await ambil(`${base}/api/cashbook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kode}` },
    body: JSON.stringify({
      jenis: 'keluar', kategori: 'operasional', jumlah: 1000,
      keterangan: 'uji-hidup proposal', tanggal: HARI,
      proposalToken: scan.body.proposal.token,
    }),
  }, timeoutMs);
  const rekamKonfirmasi = rekamProposalKonfirmasi(konfirmasi.body, konfirmasi.status, konfirmasi.ms, rekamScan.proposalId);

  // Replay token yang sama: SATU usulan tidak boleh menjadi dua baris.
  const replay = await ambil(`${base}/api/cashbook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kode}` },
    body: JSON.stringify({
      jenis: 'keluar', kategori: 'operasional', jumlah: 1000,
      keterangan: 'uji-hidup proposal', tanggal: HARI,
      proposalToken: scan.body.proposal.token,
    }),
  }, timeoutMs);
  const rekamReplay = rekamProposalReplay(replay.body, replay.status, replay.ms);

  const lulus = rekamKonfirmasi.lulus && rekamReplay.lulus;
  return {
    langkah: 'proposal',
    lulus,
    status: konfirmasi.status,
    ms: scan.ms + konfirmasi.ms,
    scan: rekamScan,
    konfirmasi: rekamKonfirmasi,
    replay: rekamReplay,
    anggaranSesudah: rekamScan.anggaranSesudah,
    ...(lulus ? {} : { alasan: [rekamKonfirmasi, rekamReplay].filter((r) => !r.lulus).map((r) => `${r.langkah}: ${r.alasan}`).join('; ') }),
  };
}

/** Membersihkan jejak percakapan uji dari akun demo — best-effort, dicatat. */
async function langkahPembersihan(base, kode, timeoutMs) {
  const res = await ambil(
    `${base}/api/chat`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${kode}` } },
    timeoutMs,
  );
  return { langkah: 'pembersihan', lulus: res.status >= 200 && res.status < 300, status: res.status, ms: res.ms };
}

/* ------------------- Rung interviu (W1 fase 3, tanpa panggilan live) ----- */

/**
 * Penilai langkah mulai rung interviu — MURNI, dieksor untuk uji.
 *
 * 503 = fitur sidecar OFF di layanan terdeploy — itu bukan kegagalan rantai:
 * rung MELAPORKAN 'skipped: sidecar off' dan tetap hijau (bukti yang jujur
 * adalah "fitur belum dibuka", bukan drama merah). 200 harus membawa
 * intakeId + pertanyaan pembuka.
 */
export function rekamInterviuMulai(body, status, ms) {
  if (status === 503) {
    return { langkah: 'interview-mulai', lulus: true, skipped: 'sidecar off', status, ms };
  }
  const sah = status === 200 && /^int_[0-9a-f]{12}$/.test(String(body?.intakeId ?? '')) &&
    typeof body?.pertanyaan === 'string' && body.pertanyaan.length > 0;
  return sah
    ? { langkah: 'interview-mulai', lulus: true, status, ms, intakeId: body.intakeId }
    : { langkah: 'interview-mulai', lulus: false, status, ms, alasan: `status ${status} / bentuk jawaban mulai tidak sah` };
}

/** Penilai giliran selesai — MURNI: coverage wajib angka 0..1, selesai true. */
export function rekamInterviuSelesai(body, status, ms) {
  const c = body?.coverage;
  const sah = status === 200 && body?.selesai === true && typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= 1;
  return sah
    ? { langkah: 'interview-selesai', lulus: true, status, ms, coverage: c }
    : { langkah: 'interview-selesai', lulus: false, status, ms, alasan: `status ${status} / penutupan tanpa coverage yang sah` };
}

/**
 * Penilai hasil examiner di riwayat — MURNI. verdict 'ok'/'insufficient'
 * lulus (insufficient = data jujur, bukan galat); 'unavailable' GAGAL dengan
 * alasan jujur: sidecar hidup untuk interviu tapi examiner-nya tidak — itu
 * rung yang belum lengkap, bukan mode off.
 */
export function rekamExaminerRiwayat(body) {
  const e = body?.examiner;
  if (!e || !['ok', 'insufficient', 'unavailable'].includes(e.verdict)) {
    return { langkah: 'interview-examiner', lulus: false, alasan: 'riwayat tidak membawa hasil examiner' };
  }
  if (e.verdict === 'unavailable') {
    return { langkah: 'interview-examiner', lulus: false, alasan: 'examiner sidecar tidak terjangkau saat penutupan interviu' };
  }
  return {
    langkah: 'interview-examiner', lulus: true,
    verdict: e.verdict, coverage: e.coverage ?? null,
    jumlahArea: Array.isArray(e.perArea) ? e.perArea.length : 0,
  };
}

/**
 * Jalur interviu (pilihan --ai-route interview): mulai → giliran → selesai →
 * examiner terbaca di riwayat. Akun demo sekali pakai; TANPA panggilan live
 * dari sesi builder — eksekusinya milik deploy nanti. Saat layanan menjawab
 * 503 di mulai (sidecar off), rung dilaporkan SKIPPED — hijau, bukan gagal.
 */
async function langkahInterview(base, kode, timeoutMs) {
  const mulai = await ambil(`${base}/api/interview/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kode}` },
    body: '{}',
  }, timeoutMs);
  const rekamMulai = rekamInterviuMulai(mulai.body, mulai.status, mulai.ms);
  if (rekamMulai.skipped) {
    return { langkah: 'interview', lulus: true, skipped: rekamMulai.skipped, status: mulai.status };
  }
  if (!rekamMulai.lulus) return { ...rekamMulai, langkah: 'interview' };

  const giliran = await ambil(`${base}/api/interview/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kode}` },
    body: JSON.stringify({ jawaban: 'Kas akhir bulan lalu sekitar dua ribu dolar, dengan prive delapan ratus.' }),
  }, timeoutMs);
  let rekamSelesai = rekamInterviuSelesai(giliran.body, giliran.status, giliran.ms);
  // Sidecar uji mungkin butuh giliran kedua — jawab lagi bila belum selesai.
  if (rekamSelesai.lulus === false && giliran.status === 200 && giliran.body?.selesai === false) {
    const giliran2 = await ambil(`${base}/api/interview/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${kode}` },
      body: JSON.stringify({ jawaban: 'Prive diambil sekali sepekan, dan tidak ada utang kartu yang berjalan.' }),
    }, timeoutMs);
    rekamSelesai = rekamInterviuSelesai(giliran2.body, giliran2.status, giliran2.ms);
  }
  if (!rekamSelesai.lulus) return { ...rekamSelesai, langkah: 'interview' };

  const riwayat = await ambil(`${base}/api/advisori/riwayat`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${kode}` },
  }, timeoutMs);
  const rekamExaminer = riwayat.status === 200
    ? rekamExaminerRiwayat(riwayat.body)
    : { langkah: 'interview-examiner', lulus: false, alasan: `riwayat status ${riwayat.status}` };

  const lulus = rekamSelesai.lulus && rekamExaminer.lulus;
  return {
    langkah: 'interview',
    lulus,
    status: giliran.status,
    ms: mulai.ms + giliran.ms,
    mulai: rekamMulai,
    selesai: rekamSelesai,
    examiner: rekamExaminer,
    ...(lulus ? {} : { alasan: [rekamSelesai, rekamExaminer].filter((r) => r.lulus === false).map((r) => `${r.langkah}: ${r.alasan}`).join('; ') }),
  };
}

/* ------------------------------------------------------------ orkestrasi */

/**
 * Menjalankan seluruh rantai. Dipisah dari argv supaya bisa diuji tanpa
 * efek samping (lihat blok eksekusi-langsung di bawah).
 *
 * @param {{baseUrl: string, layanan?: string, region?: string, project?: string,
 *          revision?: string|null, healthOnly?: boolean, timeoutMs?: number,
 *          aiRoute?: 'chat'|'checkup'|'rekomendasi'|'proposal'|'interview'}} sasaran
 * @returns {Promise<object>} artefak
 */
export async function jalankanUji(sasaran) {
  const artefak = {
    alat: 'uji-hidup',
    versiAlat: VERSI_ALAT,
    schemaVersi: SCHEMA_VERSI,
    mulai: new Date().toISOString(),
    hasil: 'GAGAL',
    ruteAi: sasaran.aiRoute ?? 'chat',
    sasaran: {
      baseUrl: sasaran.baseUrl,
      layanan: sasaran.layanan ?? null,
      region: sasaran.region ?? null,
      project: sasaran.project ?? null,
      revision: sasaran.revision ?? null,
    },
    identitasRuntime: null,
    konfigurasiTerbaca: null,
    langkah: {},
    perkiraanBiaya: null,
    catatan: [],
  };
  const catatan = artefak.catatan;
  const base = sasaran.baseUrl.replace(/\/+$/, '');

  /* ---- Bukti identitas runtime via gcloud (baca-saja, best-effort) ---- */
  if (sasaran.project && sasaran.region && sasaran.layanan) {
    const describe = await gcloud(
      [
        'run', 'services', 'describe', sasaran.layanan,
        '--region', sasaran.region, '--project', sasaran.project, '--format=json',
      ],
      catatan,
    );
    if (describe) {
      try {
        const svc = JSON.parse(describe);
        const env = svc?.spec?.template?.spec?.containers?.[0]?.env ?? [];
        const { bernilai, hanyaNama } = saringEnv(env);
        // Revisi yang melayani 100% trafik lebih jujur daripada revisi
        // terbaru: layanan ini (dibuat alat lain) tidak mengisi
        // latestCreatedRevision sama sekali, tapi traffic.revisionName selalu
        // ada — dan dialah yang benar-benar menjawab uji ini.
        artefak.sasaran.revision ??=
          svc?.status?.latestCreatedRevision ??
          svc?.status?.traffic?.find((t) => t.percent > 0)?.revisionName ??
          null;
        artefak.sasaran.baseUrl ??= svc?.status?.url ?? null;
        artefak.identitasRuntime = {
          serviceAccount: svc?.spec?.template?.spec?.serviceAccountName ?? '(default compute SA)',
          sumber: 'gcloud run services describe (baca-saja)',
        };
        artefak.konfigurasiTerbaca = {
          env: bernilai,
          envLainHanyaNama: hanyaNama,
          catatan: 'nilai env lain sengaja TIDAK direkam; secret hanya dicatat sebagai nama',
        };
      } catch (err) {
        catatan.push(`describe tidak terurai: ${potong(err?.message ?? err, 160)}`);
      }
    }
    const iam = await gcloud(
      ['projects', 'get-iam-policy', sasaran.project, '--format=json'], catatan,
    );
    if (iam && artefak.identitasRuntime) {
      try {
        const sa = artefak.identitasRuntime.serviceAccount;
        const policy = JSON.parse(iam);
        const peran = (policy.bindings ?? [])
          .filter((b) => (b.members ?? []).some((m) => typeof m === 'string' && m.endsWith(`${sa}`)))
          .map((b) => b.role);
        artefak.identitasRuntime.peran = peran;
        artefak.identitasRuntime[PERAN_KUNCI] = peran.includes(PERAN_KUNCI);
      } catch (err) {
        catatan.push(`iam-policy tidak terurai: ${potong(err?.message ?? err, 160)}`);
      }
    }
    const api = await gcloud(
      [
        'services', 'list', '--enabled', '--project', sasaran.project,
        '--filter=config.name=aiplatform.googleapis.com', '--format=value(config.name)',
      ],
      catatan,
    );
    if (api !== null) {
      artefak.identitasRuntime ??= {};
      artefak.identitasRuntime.apiVertexAktif = api.includes('aiplatform.googleapis.com');
    }
  }

  /* ------------------------- Langkah 1: health ------------------------- */
  const kesehatan = await ambil(`${base}/api/health`, {}, sasaran.timeoutMs);
  const sehat = kesehatan.status === 200 && kesehatan.body?.ok === true;
  artefak.langkah.kesehatan = sehat
    ? {
        langkah: 'kesehatan',
        lulus: true, status: kesehatan.status, ms: kesehatan.ms,
        model: kesehatan.body.model, aiConfigured: kesehatan.body.aiConfigured,
        penyimpanan: kesehatan.body.penyimpanan,
      }
    : gagal('kesehatan', kesehatan.status,
        kesehatan.galat ?? `ok!=true atau bukan 200: ${potong(kesehatan.teks, 200)}`,
        { ms: kesehatan.ms });
  if (!sehat) return artefak;
  if (kesehatan.body.aiConfigured !== true) {
    artefak.langkah.kesehatan = gagal('kesehatan', 200,
      `aiConfigured=false — konfigurasi AI layanan terdeploy tidak lengkap (model terbaca: ${kesehatan.body.model})`);
    return artefak;
  }

  if (sasaran.healthOnly) {
    artefak.hasil = 'LULUS (health-only — tanpa panggilan AI; ini BUKAN bukti jalur AI)';
    artefak.selesai = new Date().toISOString();
    return artefak;
  }

  /* --------------------------- Langkah 2: demo ------------------------- */
  const demo = await ambil(
    `${base}/api/demo`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    sasaran.timeoutMs,
  );
  const kode = demo.body?.code;
  const demoLulus = demo.status === 200 && typeof kode === 'string' && kode.length > 0;
  artefak.langkah.demo = demoLulus
    ? {
        langkah: 'demo',
        lulus: true, status: demo.status, ms: demo.ms,
        demoUserId: demo.body.user?.id ?? null,
        akunDemo: demo.body.user?.name ?? null,
        anggaranSebelum: demo.body.anggaran ?? null,
        kode: 'DIREDAKSI — kode akses tidak pernah direkam',
      }
    : gagal('demo', demo.status,
        demo.galat ?? `status ${demo.status}: ${potong(demo.teks, 200)}`,
        { ms: demo.ms });
  if (!demoLulus) return artefak;

  /* -------------------- Langkah 3: SATU panggilan AI ------------------- */

  let langkahAi;
  if (sasaran.aiRoute === 'checkup') {
    langkahAi = await langkahCheckup(base, kode, sasaran.timeoutMs);
  } else if (sasaran.aiRoute === 'rekomendasi') {
    langkahAi = await langkahRekomendasi(base, kode, sasaran.timeoutMs);
    // Slot rekomendasi tertimpa isi barunya — tanpa akumulasi sisa uji,
    // tanpa langkah pembersihan.
  } else if (sasaran.aiRoute === 'proposal') {
    langkahAi = await langkahProposal(base, kode, sasaran.timeoutMs);
    // Satu baris uji mendarat di akun demo fiktif — sekali pakai, tanpa
    // pembersihan; replay-nya justru bagian dari bukti (409 duplikat).
  } else if (sasaran.aiRoute === 'interview') {
    langkahAi = await langkahInterview(base, kode, sasaran.timeoutMs);
    // Sidecar off di layanan = skipped jujur (hijau), bukan gagal; sidecar
    // on = rantai mulai→giliran→selesai→examiner terbukti.
  } else {
    langkahAi = await langkahPercakapan(base, kode, sasaran.timeoutMs);
    // Riwayat giliran uji dihapus lagi — akun demo tidak menumpuk sisa uji.
    artefak.langkah.pembersihan = await langkahPembersihan(base, kode, sasaran.timeoutMs);
  }
  artefak.langkah[langkahAi.langkah] = langkahAi;

  const sebelum = demo.body.anggaran;
  const sesudah = langkahAi.lulus ? langkahAi.anggaranSesudah : null;
  const pakaiHarian = sesudah?.harian && sebelum?.harian
    ? sesudah.harian.terpakai - sebelum.harian.terpakai
    : null;
  const pakaiMingguan = sesudah?.mingguan && sebelum?.mingguan
    ? sesudah.mingguan.terpakai - sebelum.mingguan.terpakai
    : null;

  if (langkahAi.lulus) {
    // Server tidak mengirim pemisahan input/output ke klien — yang bisa
    // direkam adalah DELTA penghitung anggarannya sendiri (hitungToken).
    // Itu bukti dari sisi server bahwa provider benar-benar dipakai.
    langkahAi.tokenTerpakai = {
      harian: pakaiHarian,
      mingguan: pakaiMingguan,
      sumber: 'anggaran server sebelum/sesudah (hitungToken)',
    };
    if (!pakaiHarian) {
      langkahAi.lulus = false;
      langkahAi.alasan = 'penghitung anggaran server tidak berubah — pemakaian provider tidak terbukti';
    } else {
      // Delta anggaran bukan pemisahan input/output — dihargai dengan tarif
      // OUTPUT (paling mahal) supaya perkiraannya batas atas, bukan batas bawah.
      artefak.perkiraanBiaya = {
        ...perkiraanBiaya('gemini', { input_tokens: 0, output_tokens: pakaiHarian }),
        basis: `delta anggaran ${pakaiHarian} token unit-anggaran, dihargai dengan tarif output`,
      };
    }
  }

  artefak.hasil = langkahAi.lulus ? 'LULUS' : 'GAGAL';
  artefak.selesai = new Date().toISOString();
  return artefak;
}

/** Truncates semua string dalam objek hasil AI (data demo fiktif, tetap dijaga kecil). */
function potongObjek(obj, n = 160) {
  if (typeof obj === 'string') return potong(obj, n);
  if (Array.isArray(obj)) return obj.slice(0, 6).map((v) => potongObjek(v, n));
  if (obj && typeof obj === 'object') {
    const keluar = {};
    for (const [k, v] of Object.entries(obj)) keluar[k] = potongObjek(v, n);
    return keluar;
  }
  return obj;
}

/* ------------------------------------------------------------- CLI utama */

export function bacaArgv(argv) {
  const opsi = {
    base: process.env.NOVA_BASE_URL ?? '',
    layanan: 'novaexplorer',
    region: null,
    project: null,
    revision: null,
    deployLog: '/workspace/deploy.log',
    healthOnly: argv.includes('--health-only'),
    aiRoute: 'chat',
    timeoutMs: 90_000,
    tanpaGcloud: argv.includes('--no-gcloud'),
  };
  const nilai = (bendera) => {
    const i = argv.indexOf(bendera);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  opsi.base = nilai('--base') ?? opsi.base;
  opsi.layanan = nilai('--service') ?? opsi.layanan;
  opsi.region = nilai('--region') ?? opsi.region;
  opsi.project = nilai('--project') ?? opsi.project;
  opsi.revision = nilai('--revision') ?? opsi.revision;
  const rute = nilai('--ai-route');
  // `nilai` mengembalikan undefined saat bendera absen (bukan null): tanpa
  // --ai-route, default 'chat' di atas yang berlaku. CI memanggil persis begitu.
  if (rute !== undefined && rute !== null) {
    if (rute !== 'chat' && rute !== 'checkup' && rute !== 'rekomendasi' && rute !== 'proposal' && rute !== 'interview') {
      throw new Error(`--ai-route harus 'chat', 'checkup', 'rekomendasi', 'proposal', atau 'interview', diterima: ${rute}`);
    }
    opsi.aiRoute = rute;
  }
  if (nilai('--out')) opsi.out = nilai('--out');
  const t = nilai('--timeout-ms');
  if (t) opsi.timeoutMs = Number(t) || opsi.timeoutMs;

  // 1. log deploy Cloud Build (jika ada di lingkungan CI)
  if (!opsi.base && opsi.deployLog && existsSync(opsi.deployLog)) {
    const temuan = parseDeployLog(readFileSync(opsi.deployLog, 'utf8'));
    opsi.base = temuan.baseUrl ?? '';
    opsi.revision ??= temuan.revision;
  }
  // 2. gcloud — tanpa --base dan tanpa log, tanyakan sendiri ke Cloud Run
  if (!opsi.base && !opsi.tanpaGcloud && opsi.project && opsi.region) {
    // describe dijalankan di dalam jalankanUji; di sini hanya penanda
    opsi.tanyaGcloud = true;
  }
  return opsi;
}

function sifatArtefak(artefak) {
  const waktu = new Date();
  const tgl = waktu.toISOString().slice(0, 10);
  const jam = waktu.toISOString().slice(11, 19).replace(/:/g, '');
  const siapa = [artefak.sasaran.layanan ?? 'layanan', artefak.sasaran.region ?? 'region']
    .join('-').replace(/[^a-z0-9-]/gi, '');
  return `uji-hidup-${tgl}T${jam}Z-${siapa}.json`;
}

export async function utama(argv = process.argv.slice(2)) {
  const opsi = bacaArgv(argv);

  if (!opsi.base && !(opsi.tanyaGcloud && opsi.project && opsi.region)) {
    console.error(`
  Uji hidup butuh alamat layanan terdeploy.
    node scripts/uji-hidup.js --base https://<layanan>.run.app
  atau kirim --project dan --region (dan gcloud terpasang) agar alamatnya
  dicari sendiri lewat 'gcloud run services describe' (baca-saja).
`);
    process.exitCode = 1;
    return null;
  }

  if (!opsi.base) {
    const describe = await gcloud(
      [
        'run', 'services', 'describe', opsi.layanan,
        '--region', opsi.region, '--project', opsi.project, '--format=value(status.url)',
      ],
      [],
    );
    opsi.base = describe?.trim().split('\n')[0] ?? '';
    if (!opsi.base) {
      console.error('  Alamat layanan tidak bisa ditemukan lewat gcloud.');
      process.exitCode = 1;
      return null;
    }
  }

  if (!opsi.base.startsWith('https://') && !opsi.base.includes('localhost') && !opsi.base.includes('127.0.0.1')) {
    console.error('  --base harus https:// (atau localhost untuk uji lokal).');
    process.exitCode = 1;
    return null;
  }

  console.log(`\n  Uji hidup — ${opsi.base}`);
  console.log(`  Mulai : ${new Date().toISOString()}`);
  if (opsi.healthOnly) console.log('  Mode  : health-only (tanpa panggilan AI)\n');

  const artefak = await jalankanUji({
    baseUrl: opsi.base,
    layanan: opsi.layanan,
    region: opsi.region,
    project: opsi.project,
    revision: opsi.revision,
    healthOnly: opsi.healthOnly,
    aiRoute: opsi.aiRoute,
    timeoutMs: opsi.timeoutMs,
  });

  const berkas = opsi.out ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'test_reports', sifatArtefak(artefak));
  try {
    mkdirSync(dirname(berkas), { recursive: true });
    writeFileSync(berkas, JSON.stringify(artefak, null, 2) + '\n');
    console.log(`  Artefak: ${berkas}`);
  } catch (err) {
    // Kegagalan menulis artefak tidak boleh membuang buktinya — cetak utuh.
    console.error(`  ARTEFAK TIDAK TERTULIS (${err?.message ?? err}) — isi artefak di bawah:`);
    console.log(JSON.stringify(artefak, null, 2));
  }

  for (const l of Object.values(artefak.langkah)) {
    const tanda = l.lulus ? 'LULUS' : 'GAGAL';
    console.log(`  [${tanda}] ${l.langkah ?? '?'} — status ${l.status ?? '-'} · ${l.ms ?? '?'} ms${l.alasan ? ` · ${l.alasan}` : ''}`);
  }
  if (artefak.langkah.kesehatan?.lulus) {
    console.log(`  Model terbaca: ${artefak.langkah.kesehatan.model} (aiConfigured=${artefak.langkah.kesehatan.aiConfigured})`);
  }
  const c = artefak.langkah.percakapan;
  if (c?.lulus) {
    console.log(`  Panggilan AI (${artefak.ruteAi}): model ${c.model} · ${c.potonganMengalir} potongan mengalir · ${c.panjangJawaban} karakter · ${c.tokenTerpakai?.harian ?? '?'} token unit-anggaran`);
  }
  if (artefak.perkiraanBiaya?.idrPerkiraan !== undefined && artefak.perkiraanBiaya?.usd !== null) {
    console.log(`  Perkiraan biaya panggilan ini: ~Rp ${artefak.perkiraanBiaya.idrPerkiraan} (batas atas — ${artefak.perkiraanBiaya.tarif?.asal ?? '?'}, ${artefak.perkiraanBiaya.tarif?.asOf ?? '?'})`);
  }
  console.log(`\n  HASIL: ${artefak.hasil}\n`);
  if (!artefak.hasil.startsWith('LULUS')) process.exitCode = 1;
  return artefak;
}

/* Diuji lewat test/uji-hidup.test.js — impor modul ini TIDAK boleh berjalan. */
const dijalankanLangsung =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (dijalankanLangsung) {
  await utama();
}
