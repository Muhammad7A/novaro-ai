/**
 * Novaro — server aplikasi.
 *
 * Menyajikan aplikasi web dan menjadi perantara aman ke Claude Sonnet 5.
 * Kunci API hanya ada di server; browser tidak pernah melihatnya.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import express from 'express';

if (process.env.GOOGLE_CREDENTIALS_B64 && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  try {
    const credPath = path.join(os.tmpdir(), 'gcp-sa-key.json');
    const decoded = Buffer.from(process.env.GOOGLE_CREDENTIALS_B64.trim(), 'base64').toString('utf8');
    fs.writeFileSync(credPath, decoded, { encoding: 'utf8', mode: 0o600 });
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
  } catch (e) {
    console.error('Gagal mendekode GOOGLE_CREDENTIALS_B64:', e.message);
  }
}

import {
  JENIS,
  KATEGORI,
  currentMonth,
  jamWIB,
  isMonthComplete,
  isMonthReliable,
  isValidKategori,
  lastMonths,
  monthsWithData,
  perubahanPersen,
  saringTransaksi,
  summarizeMonth,
  summarizeRange,
  tanggalTerlama,
  todayISO,
  transactionsForMonth,
} from './lib/cashbook.js';
import { PERKIRAAN, cekAnggaran, ringkasAnggaran } from './lib/anggaran.js';
import { scheduleBackups } from './lib/backup.js';
import { JENIS_PENYIMPANAN } from './lib/db.js';
import { analyzeCheckup, analyzeLatihanAi, analyzeNota, backendAI, describeError, generateRecommendations, isConfigured, modelAktif, streamChat } from './lib/ai.js';
import { CONSENT_TEXT, CONSENT_VERSION, hasConsented } from './lib/consent.js';
import { asetDariBerkas, asetDariNilai, sajikanAset } from './lib/aset.js';
import { forceHttps, catatGagal, hostTujuan, periksaKodeAkses, punyaPublicHost, securityHeaders } from './lib/guard.js';
import { periksaPenyimpanan, wajibBisaMenyimpan } from './lib/kesehatan.js';
import { log } from './lib/log.js';
import { jadwalUntukAI, ringkasJadwal } from './lib/jadwal.js';
import { JALUR, KURIKULUM, SESI_HARIAN, materiModul, nomorModulSah, ringkasKemajuan } from './lib/kurikulum.js';
import { PROFIL_FIELDS, computeMetrics, metricsToText } from './lib/metrics.js';
import { cashbookContext, LABEL } from './lib/prompts.js';
import { susunKonteksUsaha } from './lib/konteks-usaha.js';
import { susunFokusHarian } from './lib/fokus-harian.js';
import { bulanCheckpoint, catatTindakAdvisori, evaluasiTertunda } from './lib/advisori.js';
import { deteksiKonteks } from './lib/deteksi.js';
import { buatIdProposal, proposalScanAktif, terbitkanToken } from './lib/proposal.js';
import { kirimJawaban, mulaiInterviu, panggilExaminer, barisCoverageKonteks, sidecarTersedia } from './lib/interview.js';
import { modulPraktikTerverifikasi } from './lib/praktik.js';
import { adaLatihan, periksa, sanitasiLatihanAI, soalPublik } from './lib/latihan.js';
import { GalatMutasi, store } from './lib/store.js';
import { tolakTopik } from './lib/batas-topik.js';
import { FORMAT_TOKEN_SESI, emailSah, tokenBaru } from './lib/autentikasi.js';
import { kirimSurel } from './lib/surel.js';
import { PENYEDIA_OAUTH, penyediaSiap, urlOtorisasi, uriPanggilanBalik } from './lib/oauth.js';
import { KODE_DEMO, isiDemoPenuh, lanjutkanDemo, personaDemo, PERSONA_DEMO } from './lib/demo-data.js';
import { kenaliGambar, sanitasiHasilNota } from './lib/nota.js';
import { sanitasiCheckup } from './lib/checkup.js';
import { sanitasiRekomendasi } from './lib/rekomendasi.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_HOUR) || 40;

const app = express();
app.disable('x-powered-by');

/*
 * Di belakang Nginx, alamat IP asli ada di X-Forwarded-For. Tanpa ini semua
 * permintaan terlihat datang dari 127.0.0.1 — dan satu penyerang akan mengunci
 * pembatas login untuk SEMUA peserta sekaligus.
 *
 * Sengaja tidak dinyalakan secara default: kalau aplikasi ini terbuka langsung
 * ke internet tanpa proxy, mempercayai header itu justru membuat pembatasnya
 * bisa dilewati dengan memalsukan X-Forwarded-For.
 */
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

if (process.env.FORCE_HTTPS === '1') app.use(forceHttps);
app.use(securityHeaders);

/* ------------------------------------------------------- Scan nota (foto) */

/*
 * Batas ukuran foto nota. 4 MB jauh melampaui foto hasil kompres peramban
 * (klien mengecilkan ke sisi 1600px sebelum mengirim) — batas ini untuk
 * berkas yang dipaksakan lewat curl, bukan untuk kamera sungguhan.
 */
const NOTA_MAKS_BYTE = 4 * 1024 * 1024;

/**
 * Membaca foto nota → USULAN transaksi. Tidak pernah menyimpan.
 *
 * Rute ini didaftar SEBELUM `express.json` global di bawah, dan membawa
 * parser tubuhnya sendiri: foto adalah biner (bukan JSON) dan batas 256 kb
 * milik API teks tidak masuk akal untuk gambar. Parser `express.raw` hanya
 * aktif untuk content-type gambar yang dikenali — payload lain tiba di
 * handler sebagai tubuh kosong dan ditolak di pemeriksaan pertama.
 *
 * Alur keamanannya berlapis:
 *   1. autentikasi + persetujuan + anggaran + batas laju (sama dengan AI lain),
 *   2. jenis berkas disimpulkan dari ISI byte (magic number) — header
 *      Content-Type dari klien tidak pernah dipercaya,
 *   3. hasil AI dibersihkan `sanitasiHasilNota` sebelum dikirim ke layar,
 *   4. dan yang paling penting: rute ini tidak punya akses penyimpanan sama
 *      sekali. Simpan hanya lewat /api/cashbook yang sama dengan input
 *      manual, setelah peserta menekan tombolnya sendiri.
 *
 * Foto tidak pernah ditulis ke disk dan isinya tidak pernah dicatat ke log —
 * yang dicatat hanya panjang berkas dan status akhirnya.
 */
app.post(
  '/api/scan-nota',
  authenticate,
  requireConsent,
  anggaranToken('nota'),
  rateLimit,
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: NOTA_MAKS_BYTE }),
  async (req, res) => {
    const gambar = req.body;
    if (!Buffer.isBuffer(gambar) || gambar.length === 0) {
      return res.status(400).json({ error: 'The receipt file was not received. Try picking or photographing the image again.' });
    }

    // Jenis berkas dari byte, bukan dari header — header bisa apa saja.
    const mime = kenaliGambar(gambar);
    if (!mime) {
      return res.status(400).json({ error: 'This file is not a recognized image. Use JPG, PNG, or WebP.' });
    }

    if (!isConfigured()) {
      return res.status(503).json({ error: 'The AI service is not configured on this server, so receipt scanning is unavailable.' });
    }

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    try {
      const { data: mentah, usage } = await analyzeNota({
        imageBase64: gambar.toString('base64'),
        mimeType: mime,
        signal: controller.signal,
      });
      const hasil = sanitasiHasilNota(mentah);
      /*
       * Rel proposal T1 surface #1 (addendum §25, 2026-09-12) — default MATI.
       * Saat gerbang env terbuka DAN rahasia terpasang, scan sekalian
       * menerbitkan id usulan + token sekali-pakai; peristiwa proposal_shown
       * menunggangi tulisan usage yang memang sudah terjadi (§9.3 — nol
       * tulisan baru). Rahasia tidak terpasang: jalur proposal mati dengan
       * log galat keras, scan biasa tetap hidup (degradasi jujur R6) — dan
       * TIDAK ada peristiwa shown tanpa token, supaya data keputusan tidak
       * berisi usulan yang mustahil dikonfirmasi.
       */
      let proposal = null;
      if (proposalScanAktif()) {
        const id = buatIdProposal();
        const token = terbitkanToken({ proposalId: id, tingkat: hasil.tingkat });
        if (token) {
          proposal = { id, token };
        } else {
          log.error('nota', 'NOVA_PROPOSAL_SCAN aktif tanpa NOVA_PROPOSAL_SECRET — token tidak diterbitkan, jalur proposal mati', { userId: req.user.id });
        }
      }
      if (proposal) {
        await store.catatProposalScan(req.user.id, { id: proposal.id, tingkat: hasil.tingkat }, usage);
      } else {
        await store.recordUsage(req.user.id, usage);
      }
      log.info('nota', 'nota selesai dibaca', { userId: req.user.id, bytes: gambar.length, tingkat: hasil.tingkat });
      // Anggaran ikut seperti rute rekomendasi — rung uji-hidup proposal
      // membuktikan pemakaian provider lewat delta penghitung ini.
      res.json({
        hasil,
        ...(proposal ? { proposal } : {}),
        anggaran: await anggaranUntuk(req.user),
      });
    } catch (err) {
      if (controller.signal.aborted) {
        log.info('nota', 'dibatalkan peserta sebelum selesai', { userId: req.user.id });
        return;
      }
      // describeError menangani galat SDK; galat bawaan lib/nota.js (status
      // 502 hasil format tidak terbaca) dilewatkan apa adanya.
      const { status, message } = describeError(err);
      if (isServiceFailure(status)) req.refundRateLimit?.();
      log.error('nota', 'analisis nota gagal', { userId: req.user.id, status, bytes: gambar.length, sebab: err?.message ?? String(err) });
      res.status(status).json({ error: message });
    }
  },
);

app.use(express.json({ limit: '256kb' }));

/**
 * Penolakan EKSPLISIT satu usulan scan (T1 surface #1, fase 5).
 *
 * Bukan pintu simpan dan bukan uang: satu peristiwa contentless saja, lewat
 * store.tolakProposal yang idempoten. Alasan (bila ada) kosakata tertutup —
 * divalidasi di store; rute hanya membatasi bentuk id.
 */
app.post('/api/proposal/tolak', authenticate, requireConsent, async (req, res) => {
  const proposalId = String(req.body?.proposalId ?? '').trim();
  if (!/^prop_[0-9a-f]{12}$/.test(proposalId)) {
    return res.status(400).json({ error: 'Unknown proposal id.' });
  }
  const alasanBersih = req.body?.alasan == null ? '' : String(req.body.alasan).trim();
  try {
    const hasil = await store.tolakProposal(req.user.id, proposalId, alasanBersih);
    if (!hasil) return res.status(404).json({ error: 'User not found.' });
    res.json(hasil);
  } catch (err) {
    if (err instanceof GalatMutasi) {
      return res.status(err.status).json({ error: err.message, kode: err.kode });
    }
    throw err;
  }
});

/* ---------------------------------------------------------------- Autentikasi */

/**
 * Membaca kredensial dari header Authorization: Bearer <token>.
 *
 * Dua bentuk yang sah, dua-duanya dijaga pembatas yang sama:
 *   kode akses (jalur legacy — bentuk NOVA-XXXX-XXXX) dan token sesi
 *   (jalur baru, prefiks `sesi_`). Penebakan salah satu bentuk lewat rute
 *   mana pun tetap dibatasi, ditunda, dan tercatat — memilih jenis token
 *   tidak boleh menjadi cara memilih pagar.
 */
async function authenticate(req, res, next) {
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const lewatSesi = FORMAT_TOKEN_SESI.test(token);
  const cari = lewatSesi ? (t) => store.cariDenganSesi(t) : (c) => store.findByAccessCode(c);
  const hasil = await periksaKodeAkses(req.ip ?? 'tak-dikenal', token, cari, req.path);
  if (!hasil.user) {
    return res.status(hasil.status).json({
      error:
        hasil.error ??
        (lewatSesi
          ? 'Sign-in session not recognized. Please request a new sign-in link.'
          : 'Access code not recognized. Ask the operator for a new code.'),
    });
  }
  // Token sesi dicatat di req supaya rute keluar tahu persis mana yang dicabut.
  if (lewatSesi) req.sesiToken = token;
  req.user = hasil.user;
  next();
}

/* --------------------------------------------------- Pembatas pemakaian AI */

const hits = new Map(); // userId -> timestamp[]

function rateLimit(req, res, next) {
  const now = Date.now();
  const windowStart = now - 60 * 60 * 1000;
  const recent = (hits.get(req.user.id) ?? []).filter((t) => t > windowStart);
  if (recent.length >= RATE_LIMIT) {
    const nextSlot = new Date(recent[0] + 60 * 60 * 1000);
    return res.status(429).json({
      error: `Batas pemakaian AI tercapai (${RATE_LIMIT} permintaan per jam). Coba lagi setelah ${jamWIB(nextSlot)}.`,
    });
  }
  recent.push(now);
  hits.set(req.user.id, recent);

  /*
   * Jatah dipesan di depan supaya dua permintaan bersamaan tidak sama-sama lolos.
   * Kalau ternyata AI-nya memang tidak bisa dipakai (kunci API belum diatur,
   * layanan sedang penuh), jatahnya dikembalikan — pengguna tidak boleh kehilangan
   * kuota untuk kegagalan yang bukan salahnya.
   */
  req.refundRateLimit = () => {
    const list = hits.get(req.user.id);
    const i = list ? list.lastIndexOf(now) : -1;
    if (i >= 0) list.splice(i, 1);
  };
  next();
}

/** Kegagalan di sisi layanan, bukan akibat permintaan pengguna. */
const isServiceFailure = (status) => status === 503 || status === 429 || status === 502;

/** Ditempelkan ke jawaban yang berhenti karena kepanjangan, dan ikut tersimpan. */
const POTONG = 'Sorry, this answer was cut off for length. Try asking again with a more focused question to get the rest.';

/* ------------------------------------------------------- Anggaran token */

/**
 * Menjaga TAGIHAN, bukan ledakan permintaan.
 *
 * `rateLimit` di atas membatasi berapa sering; ini membatasi berapa mahal.
 * Keduanya perlu: menekan "Perbarui rekomendasi" dua belas kali dalam semalam
 * tidak melanggar batas per jam mana pun, tapi bisa menghabiskan biaya program
 * sebulan. Jatahnya diperiksa SEBELUM permintaan dikirim, memakai perkiraan
 * biaya — batas yang baru diperiksa sesudahnya bukan batas, melainkan laporan.
 */
function anggaranToken(jenis) {
  return async (req, res, next) => {
    const jejakToken = await store.getTokenLog(req.user.id);
    /*
     * `jenis` boleh berupa fungsi supaya rute chat bisa memilih perkiraan yang
     * lebih besar saat materi modul ikut terkirim. Anggaran yang diperiksa
     * dengan angka yang terlalu kecil sama saja dengan tidak diperiksa.
     */
    const kunci = typeof jenis === 'function' ? jenis(req) : jenis;
    const tolak = cekAnggaran(jejakToken, PERKIRAAN[kunci] ?? PERKIRAAN.chat);
    if (!tolak) return next();
    await store.logEvent(req.user.id, 'anggaran_habis', { jenis: tolak.jenis }, { jedaMs: 60 * 60 * 1000 });
    return res.status(429).json({ error: tolak.pesan, anggaranHabis: tolak.jenis });
  };
}

/** Sisa jatah peserta, ikut dikirim agar tampilan bisa menunjukkannya lebih dulu. */
async function anggaranUntuk(user) {
  return ringkasAnggaran(await store.getTokenLog(user.id));
}

/* ------------------------------------------------------------- Persetujuan */

/**
 * Menolak penulisan data dari peserta yang belum menyetujui versi teks saat ini.
 *
 * Dipasang di server, bukan hanya di tampilan. Persetujuan yang hanya dijaga
 * oleh layar depan bukan persetujuan — ia cuma tombol yang bisa dilewati.
 * Rute baca tetap terbuka supaya aplikasi bisa memuat dan menampilkan teksnya.
 */
function requireConsent(req, res, next) {
  if (hasConsented(req.user)) return next();
  return res.status(451).json({
    error: 'Your agreement to the terms is required before data can be saved.',
    consentRequired: true,
    consent: CONSENT_TEXT,
  });
}

/* -------------------------------------------------- Angka nyata vs perkiraan */

/**
 * Menghitung indikator keuangan pengguna.
 *
 * Kalau buku kas bulan berjalan sudah cukup terisi, angka nyata dipakai dan
 * perkiraan di profil diabaikan. Kalau belum, perkiraan yang dipakai. Sumbernya
 * selalu ikut dikembalikan supaya pengguna tahu angka itu datang dari mana.
 */
async function metricsFor(user) {
  const transactions = await store.getTransactions(user.id);
  const month = currentMonth();
  const summary = summarizeMonth(transactions, month);
  const real = isMonthReliable(summary) ? summary : null;
  return {
    metrics: computeMetrics(user.profile ?? {}, real, summary),
    transactions,
    summary,
  };
}

/**
 * Metrik untuk bulan TERTENTU dari transaksi yang sudah dimuat — aturan
 * sumber angka yang sama dengan metricsFor (bulan yang tercatat cukup rapat
 * memakai catatan nyata, sisanya perkiraan profil). Dipakai garis waktu
 * kesehatan; transaksinya sengaja diterima dari pemanggil supaya enam bulan
 * tidak membaca berkas data enam kali.
 */
function metricsForBulan(user, transactions, ringkasan) {
  const real = isMonthReliable(ringkasan) ? ringkasan : null;
  return { metrics: computeMetrics(user.profile ?? {}, real, ringkasan) };
}

/* ------------------------------------------------- Memori advisori (Sesi G) */

/**
 * Peta bulan → angka inti untuk evaluasi checkpoint dan deteksi konteks.
 *
 * Bulan dianggap layak dibandingkan HANYA bila lengkap kalender DAN tercatat
 * cukup rapat (isMonthComplete + isMonthReliable — ambang milik kernel,
 * nol ambang baru di sini). Bila tidak, bulanLengkap false dan penilaian
 * jatuh ke tak-terukur — sebagian bulan tidak pernah dibandingkan dengan
 * bulan penuh. Saat layak, angka dihitung dari buku kas (ringkasan yang layak
 * dipakai sebagai sumber nyata), jadi label "dihitung sistem dari angka buku
 * kas" di permukaan tampilan adalah benar, bukan slogan.
 */
function petaBulanInti(transactions, profile, bulanList) {
  const peta = {};
  for (const bulan of bulanList) {
    const ringkasan = summarizeMonth(transactions, bulan);
    const layak = isMonthComplete(ringkasan) && isMonthReliable(ringkasan);
    if (!layak) {
      peta[bulan] = { bulanLengkap: false };
      continue;
    }
    const metrics = computeMetrics(profile ?? {}, ringkasan, ringkasan);
    peta[bulan] = {
      labaBersih: metrics.labaBersih,
      marginBersih: metrics.marginBersih,
      saldoKas: metrics.saldoKas,
      prive: metrics.prive,
      bulanLengkap: true,
    };
  }
  return peta;
}

/**
 * Checkpoint hasil nasihat — dibaca saat dibaca, tanpa penjadwal (substrate
 * penjadwal tidak ada di deploy ini, dan memang tidak dibutuhkan: checkpoint
 * adalah fakta bulan, bukan jam dinding). Mengembalikan jumlah evaluasi yang
 * baru saja direkam; 0 berarti tidak ada penulisan sama sekali, jadi
 * pembacaan yang sering tetap murah.
 */
async function evaluasiSaatDibaca(userId) {
  const user = await store.findUserById(userId);
  const advisoris = user?.advisori ?? [];
  if (!advisoris.length) return 0;

  const bulanKini = currentMonth();
  const sudah = new Set((user.evaluasiAdvisori ?? []).map((e) => e?.advisoriId));
  const kandidat = advisoris.filter((a) => {
    if (a?.jenis !== 'rekomendasi' || sudah.has(a.id)) return false;
    const cek = bulanCheckpoint(a?.dasarAngka?.bulan);
    // Tanpa bulan checkpoint yang sah = jatuh tempo seketika: kejujuran
    // "tak terukur" untuk rekam rusak direkam, bukan didiamkan.
    return !cek || bulanKini > cek;
  });
  if (!kandidat.length) return 0;

  const bulanPerlu = new Set();
  for (const a of kandidat) {
    if (a.dasarAngka?.bulan) {
      bulanPerlu.add(a.dasarAngka.bulan);
      bulanPerlu.add(bulanCheckpoint(a.dasarAngka.bulan));
    }
  }
  const transactions = await store.getTransactions(userId);
  const peta = petaBulanInti(transactions, user.profile, [...bulanPerlu].filter(Boolean));

  const tertunda = evaluasiTertunda(advisoris, user.evaluasiAdvisori ?? [], peta);
  if (!tertunda.length) return 0;
  const tersimpan = await store.tambahEvaluasiAdvisori(userId, tertunda);
  return tersimpan.length;
}

/* ------------------------------------------------------------------ Validasi */

const asNumber = (v, max) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
};

/*
 * Batas bawah tanggal transaksi kini tinggal DI lib/cashbook.js — dipakai rute
 * ini untuk kalimat galat yang ramah, dan dipakai MUTATOR penyimpan sebagai
 * penegak terakhirnya. Dua tempat pernah menyalin konstanta ini sendiri-
 * sendiri; konstanta kembar itulah yang paling mudah saling tertinggal.
 */

function sanitizeProfile(body = {}) {
  const errors = [];
  const text = (v, maxLen) => String(v ?? '').trim().slice(0, maxLen);

  const profile = {
    namaUsaha: text(body.namaUsaha, 80),
    jenisUsaha: PROFIL_FIELDS.jenisUsaha.includes(body.jenisUsaha) ? body.jenisUsaha : '',
    lokasi: text(body.lokasi, 80),
    lamaUsahaBulan: asNumber(body.lamaUsahaBulan, 1200),
    jumlahKaryawan: asNumber(body.jumlahKaryawan, 1000),
    produkUtama: text(body.produkUtama, 120),
    omzetBulanan: asNumber(body.omzetBulanan, 1e12),
    belanjaBulanan: asNumber(body.belanjaBulanan, 1e12),
    biayaOperasional: asNumber(body.biayaOperasional, 1e12),
    cicilanBulanan: asNumber(body.cicilanBulanan, 1e12),
    pencatatan: PROFIL_FIELDS.pencatatan.includes(body.pencatatan) ? body.pencatatan : '',
    rekeningTerpisah: Boolean(body.rekeningTerpisah),
    punyaNib: Boolean(body.punyaNib),
    tujuan: PROFIL_FIELDS.tujuan.includes(body.tujuan) ? body.tujuan : '',
    tantangan: text(body.tantangan, 500),
  };

  if (!profile.namaUsaha) errors.push('Nama usaha wajib diisi.');
  if (!profile.jenisUsaha) errors.push('Jenis usaha wajib dipilih.');
  if (!profile.pencatatan) errors.push('Cara pencatatan saat ini wajib dipilih.');
  if (!profile.tujuan) errors.push('Tujuan utama wajib dipilih.');
  if (profile.omzetBulanan <= 0) errors.push('Omzet bulanan wajib diisi dengan angka lebih dari 0.');

  return { profile, errors };
}

/* -------------------------------------------------------------------- Rute */

/**
 * Probe kesehatan — benar-benar menyentuh penyimpanan.
 *
 * Menjawab 503 bila folder data tidak bisa dibaca atau ditulis, supaya Load
 * Balancer menarik instance ini keluar. Jawaban `{ok:true}` yang tidak pernah
 * memeriksa apa pun justru berbahaya: instance yang disknya gagal ter-mount
 * akan dinyatakan sehat dan terus menerima catatan peserta yang akan lenyap.
 *
 * Tidak menyebut jalur folder apa pun — probe ini terbuka tanpa kode akses.
 */
app.get('/api/health', async (req, res) => {
  const penyimpanan = await periksaPenyimpanan();
  res.status(penyimpanan.sehat ? 200 : 503).json({
    ok: penyimpanan.sehat,
    model: modelAktif(),
    aiConfigured: isConfigured(),
    penyimpanan: { jenis: penyimpanan.jenis ?? 'json', baca: penyimpanan.baca, tulis: penyimpanan.tulis, peserta: penyimpanan.peserta },
  });
});

app.post('/api/login', async (req, res) => {
  const hasil = await periksaKodeAkses(
    req.ip ?? 'tak-dikenal',
    req.body?.code,
    (c) => store.findByAccessCode(c),
    '/api/login',
  );
  if (!hasil.user) {
    return res
      .status(hasil.status)
      .json({ error: hasil.error ?? 'Kode akses tidak dikenali. Periksa kembali penulisannya.' });
  }
  const user = hasil.user;
  const { metrics } = await metricsFor(user);
  await store.logEvent(user.id, 'login');
  res.json({
    user: store.publicUser(user),
    metrics: user.profile ? metrics : null,
    aiConfigured: isConfigured(),
    // Identitas runtime utk label tampilan — peramban tidak menebak model.
    model: modelAktif(),
    consent: hasConsented(user) ? null : CONSENT_TEXT,
    anggaran: await anggaranUntuk(user),
    belajar: ringkasJadwal(user),
  });
});

/* ------------------------------------------------------------- Masuk demo */

/*
 * Juru putar akun demo: tiap permintaan mendapat akun berikutnya.
 *
 * Rotasi, bukan acak: lima akun yang dipakai bergantian membagi beban
 * cache dan membuat "peserta demo" tampak hidup bergiliran, bukan satu
 * akun yang dipakati seribu tangan. Dengan max-instances=1, penghitung
 * dalam proses cukup — dua instance pun akan tetap membagi lima akun
 * yang sama, hanya urutannya yang bisa saling menyisipkan.
 */
let giliranDemo = 0;

/*
 * Pembatas khusus rute demo. `periksaKodeAkses` menjaga penebakan KODE;
 * rute ini justru memberikan kode secara sah, jadi yang perlu dijaga
 * berbeda: permintaan tanpa henti yang membebani server. Seseorang yang
 * bermaksud buruk bisa memutar demo ribuan kali per menit untuk menulis
 * kejadian login ke lima akun sekaligus.
 */
const demoJendelaMs = 10 * 60 * 1000;
const demoBatas = 20;
const demoHits = new Map(); // ip -> timestamp[]

function batasiDemo(req, res, next) {
  const ip = req.ip ?? 'tak-dikenal';
  const kini = Date.now();
  const segar = (demoHits.get(ip) ?? []).filter((t) => t > kini - demoJendelaMs);
  if (segar.length >= demoBatas) {
    return res.status(429).json({ error: 'Too many demo requests. Please wait a few minutes.' });
  }
  segar.push(kini);
  demoHits.set(ip, segar);
  next();
}

/**
 * Masuk tanpa kode: server memilih salah satu akun DEMO yang siap.
 *
 * Jawabannya bentuknya sama persis dengan /api/login — plus `code` dan
 * `demo: true` — supaya layar depan memakai jalur masuk yang sama sekali,
 * bukan menyalin logikanya. Kode tetap perlu dikirim balik sebagai Bearer
 * pada tiap permintaan berikutnya, karena autentikasi aplikasi ini memang
 * berbasis kode akses.
 *
 * Akun B1/B2 (peserta penelitian) TIDAK PERNAH terpilih di sini: kandidat
 * hanya kode yang tercatat di KODE_DEMO, dan tiap-tiapnya diverifikasi
 * batch-nya DEMO sebelum dipakai.
 */
app.post('/api/demo', batasiDemo, async (req, res) => {
  const siap = [];
  for (const kode of KODE_DEMO) {
    const u = await store.findByAccessCode(kode);
    if (u?.batch === 'DEMO' && u.profile) siap.push({ kode, user: u });
  }
  if (!siap.length) {
    return res.status(503).json({ error: 'Demo accounts are not ready yet. Please try again shortly.' });
  }

  const { kode, user } = siap[giliranDemo++ % siap.length];
  const { metrics } = await metricsFor(user);
  await store.logEvent(user.id, 'demo_login');
  res.json({
    demo: true,
    code: kode,
    user: store.publicUser(user),
    metrics: user.profile ? metrics : null,
    aiConfigured: isConfigured(),
    // Akun demo telah menyetujui teks yang sama — jangan minta lagi.
    consent: hasConsented(user) ? null : CONSENT_TEXT,
    anggaran: await anggaranUntuk(user),
    belajar: ringkasJadwal(user),
  });
});


/* ------------------------------------------------ Masuk dengan surel (W3) */

/*
 * Pembatas permintaan tautan masuk — menjaga JALUR, bukan tebakan.
 *
 * Berbeda dari pembatas kode akses (menghitung KEGAGALAN), ini menghitung
 * SEMUA permintaan: setiap permintaan yang sah pun berpotensi mengirim surel,
 * dan mengirim surel ke alamat orang lain adalah gangguan meski pelukangnya
 * tidak pernah melihat token-nya.
 */
const batasMagicLink = (() => {
  const JENDELA_MS = 15 * 60 * 1000;
  const MAKS = 10;
  const hit = new Map(); // ip -> timestamp[]
  const bersih = setInterval(() => {
    const batas = Date.now() - JENDELA_MS;
    for (const [ip, waktu] of hit) {
      const sisa = waktu.filter((t) => t > batas);
      if (sisa.length) hit.set(ip, sisa);
      else hit.delete(ip);
    }
  }, JENDELA_MS);
  bersih.unref?.();

  return (ip) => {
    const kini = Date.now();
    const d = (hit.get(ip) ?? []).filter((t) => t > kini - JENDELA_MS);
    if (d.length >= MAKS) {
      hit.set(ip, d);
      log.warn('keamanan', 'permintaan tautan masuk melebihi batas', { ip, percobaan: d.length });
      return false;
    }
    d.push(kini);
    hit.set(ip, d);
    return true;
  };
})();

/** Alamat dasar untuk tautan di dalam surel — produksi memakai PUBLIC_HOST (https), pengembangan memakai host lokal. */
function baseUrl(req) {
  const host = hostTujuan(req) ?? 'localhost';
  const proto = req.secure || punyaPublicHost() ? 'https' : 'http';
  return `${proto}://${host}`;
}

/**
 * Bentuk jawaban masuk yang sama untuk semua jalur (kode, demo, tautan).
 * Layar depan memakai SATU bentuk ini — bukan menyalin logikanya per jalur.
 */
async function payloadMasuk(user, ekstra = {}) {
  const { metrics } = await metricsFor(user);
  return {
    user: store.publicUser(user),
    metrics: user.profile ? metrics : null,
    aiConfigured: isConfigured(),
    model: modelAktif(),
    consent: hasConsented(user) ? null : CONSENT_TEXT,
    anggaran: await anggaranUntuk(user),
    belajar: ringkasJadwal(user),
    ...ekstra,
  };
}

const PESAN_MAGIC_LINK =
  'If that email has an account, a sign-in link has been sent. The link works once and expires in 15 minutes.';

app.post('/api/auth/magic-link', async (req, res) => {
  if (!batasMagicLink(req.ip ?? 'tak-dikenal')) {
    return res.status(429).json({ error: 'Too many sign-in link requests. Please wait a few minutes.' });
  }
  const email = emailSah(req.body?.email);
  if (!email) return res.status(400).json({ error: 'Enter a valid email address.' });

  const token = tokenBaru('ml');
  const userId = await store.aturMagicLink(email, token); // null bila surel tak dikenal
  if (userId) {
    const tautan = `${baseUrl(req)}/?token=${token}`;
    await kirimSurel({
      to: email,
      subject: 'Your Novaro sign-in link',
      text: `Sign in to Novaro:\n\n${tautan}\n\nThis link works once and expires in 15 minutes. If you did not request it, you can ignore this email.`,
    });
  }
  // Respons sama rata untuk surel yang dikenal maupun yang tidak — jumlah
  // akun tidak boleh bisa dihitung dari bedanya jawaban.
  res.json({ ok: true, pesan: PESAN_MAGIC_LINK });
});

app.post('/api/auth/verify', async (req, res) => {
  const token = String(req.body?.token ?? '').trim();
  const hasil = token ? await store.konsumsiMagicLink(token) : null;
  if (!hasil) {
    // Menebak token tautan mesti melewati pagar yang sama dengan menebak kode.
    await catatGagal(req.ip ?? 'tak-dikenal', '/api/auth/verify');
    return res
      .status(401)
      .json({ error: 'This sign-in link is invalid, already used, or expired. Request a new one.' });
  }
  const { user, sesi } = hasil;
  await store.logEvent(user.id, 'login');
  res.json(await payloadMasuk(user, { sesi }));
});

/** Jalur masuk apa saja yang tersedia — dipakai layar depan menyusun pilihan yang jujur. */
app.get('/api/auth/methods', (req, res) => {
  res.json({
    kode: true,
    magicLink: true,
    oauth: { google: penyediaSiap('google', punyaPublicHost() ? hostTujuan(req) : null) },
  });
});

app.post('/api/auth/logout', authenticate, async (req, res) => {
  // Sesi dicabut. Kode akses tidak bisa dicabut dari sini — ia kredensial
  // pemilik, bukan sesi perangkat; keluar dari jalur kode cukup membuang
  // simpanan klien di peramban.
  if (req.sesiToken) await store.cabutSesi(req.sesiToken);
  res.json({ ok: true });
});

/**
 * Memasang surel pada akun milik pengguna yang sedang masuk — jalur migrasi
 * pengguna kode akses ke identitas surel. Tautan verifikasi = tautan masuk
 * yang sama: memakainya sekaligus membuktikan kepemilikan alamat.
 */
app.post('/api/me/email', authenticate, async (req, res) => {
  const email = emailSah(req.body?.email);
  if (!email) return res.status(400).json({ error: 'Enter a valid email address.' });
  try {
    const pub = await store.pasangEmail(req.user.id, email);
    if (!pub) return res.status(404).json({ error: 'Account not found.' });
  } catch (err) {
    if (err instanceof GalatMutasi) return res.status(err.status).json({ error: err.message, kode: err.kode });
    throw err;
  }
  const token = tokenBaru('ml');
  await store.aturMagicLink(email, token);
  await kirimSurel({
    to: email,
    subject: 'Verify your Novaro email',
    text: `Verify your email and sign in to Novaro:\n\n${baseUrl(req)}/?token=${token}\n\nThis link works once and expires in 15 minutes.`,
  });
  res.json({
    ok: true,
    user: store.publicUser(await store.findUserById(req.user.id)),
    pesan: 'Verification link sent. Open it to confirm this address and sign in.',
  });
});

/* --------------------------------------------------- Slot OAuth (W3) */

app.get('/api/auth/oauth/:penyedia/start', (req, res) => {
  const nama = req.params.penyedia;
  if (!PENYEDIA_OAUTH[nama]) return res.status(404).json({ error: 'Unknown sign-in provider.' });
  const host = punyaPublicHost() ? hostTujuan(req) : null;
  if (!penyediaSiap(nama, host)) {
    log.error('oauth', 'jalur OAuth belum dikonfigurasi — gagal-tutup, bukan pura-pura', { penyedia: nama });
    return res.status(503).json({
      error:
        'This sign-in method is not configured yet (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, PUBLIC_HOST).',
    });
  }
  const state = randomBytes(16).toString('base64url');
  res.cookie('oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(req.secure),
    maxAge: 10 * 60 * 1000,
    path: '/api/auth/oauth',
  });
  res.redirect(urlOtorisasi(nama, { state, redirectUri: uriPanggilanBalik(host) }));
});

app.get('/api/auth/oauth/callback', (req, res) => {
  // Infra duluan: callback belum menukar kode. Jawaban 503 yang jujur lebih
  // baik daripada menerima lalu gagal setengah jalan dengan identitas kabur.
  log.error('oauth', 'callback OAuth diterima sebelum penukaran kode diimplementasikan', {});
  return res.status(503).json({ error: 'OAuth sign-in is not implemented yet (infra-first phase).' });
});

/* ------------------------------------------------- Kartu kesehatan usaha */

/*
 * Satu-satunya bentuk data yang boleh keluar lewat kartu yang dibagikan.
 *
 * Dibangun sebagai DAFTAR PUTIH eksplisit — bukan daftar hitam medan yang
 * dibuang. Bedanya nyata saat suatu hari ada medan baru di pengguna: dengan
 * daftar putih, medan itu TIDAK ikut bocor ke halaman publik sampai seseorang
 * sengaja menambahkannya di sini.
 *
 * Yang sengaja TIDAK ADA di sini dan tidak boleh ditambahkan: id internal,
 * tokenKartu (ia kunci halamannya — tertukar dengan isinya adalah kebocoran),
 * codeHash/kode akses, transaksi satu per satu, riwayat chat, jejak penelitian.
 */
function susunKartuPublik(user, metrics) {
  const p = user.profile ?? {};
  const m = metrics ?? {};

  const rekomendasi = (user.recommendations?.rekomendasi ?? []).slice(0, 2).map((r) => ({
    judul: String(r.judul ?? '').slice(0, 120),
    prioritas: ['high', 'medium'].includes(r.prioritas) ? r.prioritas : 'medium',
  }));
  /*
   * Peserta yang belum pernah menyusun rekomendasi tetap layak punya kartu —
   * insight penggantinya disarikan dari metrik yang SUDAH dihitung sistem,
   * bukan angka karangan.
   */
  const insight = rekomendasi.length
    ? rekomendasi
    : [{
        judul: m.statusCicilan === 'safe'
          ? 'Loan payments are within the healthy limit'
          : 'Review loan payments against business profit',
        prioritas: m.statusCicilan === 'safe' ? 'low' : 'high',
      }];

  /*
   * Provenansi insight ikut keluar (medan aditif di daftar putih):
   *   - 'ai'     → judul dari rekomendasi AI tersimpan (rekam lama tanpa
   *                `sumber` tetap 'ai': sebelum Sesi D satu-satunya penulis
   *                objek ini adalah rute AI — demo kini menstempel 'contoh');
   *   - 'contoh' → benih demo susunan kurasi, bukan keluaran model;
   *   - 'sistem' → fallback dari metrik yang dihitung server.
   * `insightDibuat` membawa tanggal penyusunan ASLI — bukan tanggal ambil
   * kartu yang dulu menyamarkan umurnya.
   */
  const sumberInsight = rekomendasi.length
    ? (user.recommendations?.sumber === 'contoh' ? 'contoh' : 'ai')
    : 'sistem';

  return {
    aplikasi: 'Novaro',
    namaUsaha: String(p.namaUsaha || user.business || 'Usaha saya').slice(0, 80),
    jenisUsaha: LABEL.jenisUsaha[p.jenisUsaha] ?? null,
    periode: {
      hariSejakMulai: Number(m.hariSejakMulai) || 0,
      hariTercatatBulanIni: Number(m.hariTercatat) || 0,
      hariBulan: Number(m.hariBulan) || 0,
      bulanLengkap: Boolean(m.bulanLengkap),
    },
    skorKesehatan: Number.isFinite(m.skorKesehatan) ? m.skorKesehatan : null,
    statusKesehatan: m.statusKesehatan ?? null,
    omzet: Number.isFinite(m.omzet) ? Math.round(m.omzet) : null,
    labaBersih: Number.isFinite(m.labaBersih) ? Math.round(m.labaBersih) : null,
    sumberAngka: m.sumber === 'catatan' ? 'catatan' : 'perkiraan',
    konsistensi: {
      hariTercatat: Number(m.hariTercatat) || 0,
      hariBulan: Number(m.hariBulan) || 0,
    },
    insight,
    insightSumber: sumberInsight,
    insightDibuat: rekomendasi.length ? user.recommendations?.generatedAt ?? null : null,
    dibuatPada: new Date().toISOString(),
  };
}

/** Token kartu: diundi, bukan diturunkan dari apa pun yang bisa ditebak. */
const tokenKartuBaru = () => 'kartu_' + randomBytes(18).toString('base64url');
const FORMAT_TOKEN_KARTU = /^kartu_[A-Za-z0-9_-]{20,}$/;

/**
 * Membuat / mengembalikan token kartu pengguna ini. Idempoten: kartu kedua
 * memakai token yang sama, supaya tautan yang pernah dibagikan tidak mati.
 */
app.post('/api/kartu', authenticate, requireConsent, async (req, res) => {
  let token = req.user.tokenKartu;
  if (!token) {
    token = tokenKartuBaru();
    if (!(await store.aturTokenKartu(req.user.id, token))) {
      return res.status(500).json({ error: 'The card could not be created right now. Please try again.' });
    }
  }
  const { metrics } = await metricsFor(req.user);
  res.json({ token, jalur: `/kartu/${token}`, kartu: susunKartuPublik(req.user, metrics) });
});

/**
 * Satu-satunya pintu baca publik untuk kartu: proyeksi daftar putih di atas,
 * dicari lewat token undian — bukan lewat id, kode akses, atau jalur lain.
 * Seluruh endpoint internal tetap di balik autentikasi.
 */
app.get('/api/kartu/publik/:token', async (req, res) => {
  const token = String(req.params.token ?? '');
  if (!FORMAT_TOKEN_KARTU.test(token)) {
    return res.status(404).json({ error: 'Card not found.' });
  }
  const user = await store.cariDenganTokenKartu(token);
  if (!user || !user.profile) {
    return res.status(404).json({ error: 'Card not found.' });
  }
  const { metrics } = await metricsFor(user);
  res.json({ kartu: susunKartuPublik(user, metrics) });
});

app.get('/api/me', authenticate, async (req, res) => {
  const { metrics } = await metricsFor(req.user);
  res.json({
    user: store.publicUser(req.user),
    metrics: req.user.profile ? metrics : null,
    aiConfigured: isConfigured(),
    // Flag jujur konfigurasi sidecar interviu (W1): 'on' = ada URL untuk
    // dipanggil — bukan janji sidecar hidup; kegagalan runtime tetap
    // dilaporkan rute interviu sendiri sebagai kegagalan bertipe.
    sidecar: sidecarTersedia() ? 'on' : 'off',
    consent: hasConsented(req.user) ? null : CONSENT_TEXT,
    anggaran: await anggaranUntuk(req.user),
    belajar: ringkasJadwal(req.user),
  });
});

/* ------------------------------------------------- Konteks usaha personal */

/**
 * Paket "Angka usahamu bulan ini" untuk pembaca modul, hasil check-up, dan
 * dasbor. Sengaja SATU rute: ketiga tempat harus menampilkan versi angka
 * yang sama, dan itu hanya bisa dijamin bila penyusunannya satu tempat
 * (lib/konteks-usaha.js) di atas metrik yang sama (metricsFor +
 * bandingkanBulan — sumber yang sama dengan dasbor).
 *
 * Baca-saja dan tanpa AI: murah, deterministik, dan boleh dipanggil saat
 * membuka modul. Peminta tanpa profil mendapat `konteks: null` — tampilan
 * menyembunyikan kartunya, bukan menampilkan nol yang terlihat seperti data.
 */
app.get('/api/konteks', authenticate, async (req, res) => {
  await store.logEvent(req.user.id, 'konteks_viewed', undefined, { jedaMs: 5 * 60 * 1000 });
  if (!req.user.profile) return res.json({ konteks: null, dibuatPada: new Date().toISOString() });

  const { metrics, transactions } = await metricsFor(req.user);
  const perubahan = bandingkanBulan(transactions);
  res.json({
    konteks: susunKonteksUsaha({ metrics, perubahan }),
    dibuatPada: new Date().toISOString(),
  });
});

/* ------------------------------------------------- Fokus usaha hari ini */

/**
 * SATU hal terpenting hari ini, dipilih aturan tetap di lib/fokus-harian.js
 * di atas metrik yang sama dengan dasbor (metricsFor + bandingkanBulan) —
 * tanpa AI, tanpa rumus baru, dengan ambang yang sudah ada di aplikasi.
 *
 * Sesi berikutnya yang belum dikerjakan DAN sudah terbuka ikut diberikan ke
 * penyusun, supaya fokus positif ("pertahankan") selalu membawa langkah yang
 * bisa dijalankan peserta ini hari ini — bukan sesi yang masih terkunci.
 */
app.get('/api/fokus', authenticate, async (req, res) => {
  await store.logEvent(req.user.id, 'fokus_viewed', undefined, { jedaMs: 5 * 60 * 1000 });

  // Checkpoint hasil nasihat ikut jalan saat dibaca — bila ada yang jatuh
  // tempo, satu penulisan; bila tidak, nol. Kegagalan penilaian tidak boleh
  // mematikan fokus harian: checkpoint mencoba lagi pada bacaan berikutnya.
  try {
    await evaluasiSaatDibaca(req.user.id);
  } catch (err) {
    log.warn('advisori', 'checkpoint tertunda gagal dievaluasi', { userId: req.user.id, sebab: err?.message ?? String(err) });
  }

  const { metrics, transactions } = await metricsFor(req.user);
  const perubahan = bandingkanBulan(transactions);
  const done = req.user.progress?.done ?? {};
  const sesiBerikut = SESI_HARIAN
    .find((m) => !done[m.no]) ?? null;

  res.json({
    fokus: susunFokusHarian({
      punyaProfil: Boolean(req.user.profile),
      metrics,
      perubahan,
      rekomendasi: req.user.recommendations ?? null,
      sesiBerikut,
    }),
    dibuatPada: new Date().toISOString(),
  });
});

/* ------------------------------------------- Riwayat saran (memori advisori) */

/**
 * Memori nasihat: apa yang pernah disarankan, dan apa yang terjadi setelahnya.
 *
 * Checkpoint dievaluasi SAAT DIBACA (lihat evaluasiSaatDibaca). Yang
 * dikembalikan: riwayat terbaru-dulu dengan hasil penilaiannya yang dihitung
 * sistem dari angka buku kas, plus satu deteksi konteks deterministik.
 * Ringkasan nasihat tetap membawa stempel asal-usulnya (sumber/model) —
 * teks AI tidak pernah melewati rute ini tanpa label.
 */
app.get('/api/advisori/riwayat', authenticate, requireConsent, async (req, res) => {
  try {
    // Checkpoint dulu, supaya riwayat yang dikembalikan sudah memuat hasil
    // yang baru saja jatuh tempo. Kegagalan penilaian tidak mematikan
    // pembacaan — checkpoint mencoba lagi pada bacaan berikutnya.
    try {
      await evaluasiSaatDibaca(req.user.id);
    } catch (err) {
      log.warn('advisori', 'checkpoint tertunda gagal dievaluasi', { userId: req.user.id, sebab: err?.message ?? String(err) });
    }

    const user = await store.findUserById(req.user.id);
    const evaluasiPerId = new Map((user?.evaluasiAdvisori ?? []).map((e) => [e.advisoriId, e]));
    // Tap eksplisit "saya sudah coba" — sinyal yang mengalahkan derivasi
    // korelasional bila keduanya ada (ketukan manusia = kata final).
    const tindakPerId = new Map(
      (user?.events ?? []).filter((e) => e.type === 'advisori_ditindaki').map((e) => [e.meta.id, e.ts]),
    );
    const kini = Date.now();
    const riwayat = [...(user?.advisori ?? [])]
      .reverse() // terbaru dulu — riwayat dibaca dari yang paling dekat
      .map((a) => ({
        id: a.id,
        jenis: a.jenis,
        dibuat: a.dibuat,
        sumber: a.sumber,
        // Model apa adanya dari rekam; tak dikenal tetap null — tidak pernah ditebak.
        model: a.model ?? null,
        berlaku: Date.parse(a.berlakuHingga) > kini,
        ringkasan: String(a.isi?.ringkasan ?? a.isi?.insight ?? ''),
        evaluasi: evaluasiPerId.get(a.id) ?? null,
        ditindakiPada: tindakPerId.get(a.id) ?? null,
      }));

    // Deteksi konteks: satu pengamatan deterministik dari bulan lengkap terakhir.
    const transactions = await store.getTransactions(req.user.id);
    const deteksi = deteksiKonteks(petaBulanInti(transactions, user?.profile ?? null, lastMonths(3)));
    // Examiner sidecar interviu (W1 fase 3) — hasil terakhir apa adanya;
    // verdict 'insufficient'/'unavailable' adalah data jujur untuk tampilan.
    res.json({ riwayat, deteksi, examiner: user?.examiner ?? null });
  } catch (err) {
    const { status, message } = describeError(err);
    log.error('advisori', 'riwayat gagal', { userId: req.user.id, status, sebab: err?.message ?? String(err) });
    res.status(status).json({ error: message });
  }
});

/**
 * Tap "saya sudah coba" pada satu advisori (Sesi G lanjutan).
 *
 * Pola rute G-2: authenticate + requireConsent, galat bertipe dari lib.
 * Logikanya (validasi id, idempotensi, append lewat logEvent) milik
 * catatTindakAdvisori di lib/advisori.js — rute hanya pembungkus HTTP.
 */
app.post('/api/advisori/tindak', authenticate, requireConsent, async (req, res) => {
  try {
    const hasil = await catatTindakAdvisori(req.user.id, String(req.body?.advisoriId ?? '').trim());
    if (!hasil) return res.status(404).json({ error: 'Unknown advisory record.' });
    res.json(hasil);
  } catch (err) {
    if (err?.kode === 'id-advisori') {
      return res.status(400).json({ error: err.message });
    }
    const { status, message } = describeError(err);
    log.error('advisori', 'tap tindak lanjut gagal', { userId: req.user.id, status, sebab: err?.message ?? String(err) });
    res.status(status).json({ error: message });
  }
});

/* ------------------------------------------------- Sidecar interviu (W1) */

/**
 * Keadaan giliran interviu — DI MEMORI PROSES, per pengguna, TIDAK di store.
 *
 * Sesi interviu adalah kejadian sesi-layar: satu percakapan yang hidup selama
 * peserta membuka dialognya. Menyimpannya di rekam pengguna berarti teks
 * percakapan mengancam masuk basis data — persis yang ratchet jejak larang.
 * Yang pernah tersimpan hanyalah FAKTA siklusnya (event interview_started/
 * completed yang contentless). Konsekuensinya diakui: server restart =
 * sesi berjalan hilang — peserta memulai interviu lagi; intake yang hilang
 * di sisi Novaro tidak meninggalkan setengah keadaan apa pun.
 */
const sesiInterviu = new Map();

/** Digest angka kernel untuk sidecar — server yang menghitung, bukan peserta. */
function digestMetrik(m) {
  if (!m) return null;
  return {
    omzet: m.omzet ?? 0,
    labaBersih: m.labaBersih ?? 0,
    marginBersih: m.marginBersih ?? 0,
    saldoKas: m.saldoKas ?? 0,
    prive: m.prive ?? 0,
    cicilanSaatIni: m.cicilanSaatIni ?? 0,
    hariTercatat: m.hariTercatat ?? 0,
    hariBerjalan: m.hariBerjalan ?? 0,
    bulanLengkap: m.bulanLengkap === true,
  };
}

const galatInterviu = (err, userId) => {
  // Kegagalan bertipe dari lib/interview.js: jawab jujur, catat kode-nya,
  // dan TIDAK ada yang tersimpan di sisi mana pun.
  const status = [502, 503].includes(err?.status) ? err.status : 502;
  log.warn('interview', 'sidecar gagal', { userId, kode: err?.kode ?? 'sidecar-mati', sebab: err?.message ?? String(err) });
  return { status, body: { error: 'Layanan interviu belum tersedia. Coba lagi sebentar.' } };
};

/**
 * Memulai intake interviu: profil + digest metrik dikirim ke sidecar; yang
 * tersimpan HANYA fakta siklus (interview_started {intakeId, jumlah}).
 * Pertanyaan pembuka hidup di respons dan keadaan memori — tidak di mana pun
 * yang permanen.
 */
app.post('/api/interview/start', authenticate, requireConsent, async (req, res) => {
  try {
    if (!sidecarTersedia()) {
      return res.status(503).json({ error: 'Layanan interviu belum diatur di server ini.' });
    }
    if (sesiInterviu.has(req.user.id)) {
      // Satu interviu aktif per peserta — mulai lagi = lanjutkan yang lama.
      return res.status(409).json({ error: 'Ada interviu yang masih berjalan. Jawab dulu pertanyaan terakhirnya.' });
    }
    const { metrics } = await metricsFor(req.user);
    const hasil = await mulaiInterviu({ profil: req.user.profile ?? null, metrik: digestMetrik(metrics) });
    sesiInterviu.set(req.user.id, { intakeId: hasil.intakeId, dibuat: new Date().toISOString() });
    await store.logEvent(req.user.id, 'interview_started', {
      intakeId: hasil.intakeId,
      jumlah: hasil.jumlahDiscrepancy,
    });
    res.json({ intakeId: hasil.intakeId, jumlahDiscrepancy: hasil.jumlahDiscrepancy, pertanyaan: hasil.pertanyaan });
  } catch (err) {
    const { status, body } = galatInterviu(err, req.user.id);
    res.status(status).json(body);
  }
});

/**
 * Satu giliran jawaban: relay ke sidecar atas sesi yang hidup di memori.
 * Selesai → fakta penutupan (interview_completed {intakeId, coverage}) lalu
 * keadaan memori dibuang. Teks jawaban peserta dan teks pertanyaan sidecar
 * TIDAK PERNAH tersimpan di mana pun.
 */
app.post('/api/interview/answer', authenticate, requireConsent, async (req, res) => {
  try {
    const sesi = sesiInterviu.get(req.user.id);
    if (!sesi) {
      return res.status(409).json({ error: 'Tidak ada interviu yang berjalan. Mulai dulu dari dasbor.' });
    }
    const jawaban = String(req.body?.jawaban ?? '').trim();
    if (!jawaban) {
      return res.status(400).json({ error: 'Jawaban tidak boleh kosong.' });
    }
    const hasil = await kirimJawaban({ intakeId: sesi.intakeId, jawaban });
    if (hasil.selesai) {
      sesiInterviu.delete(req.user.id);
      await store.logEvent(req.user.id, 'interview_completed', {
        intakeId: sesi.intakeId,
        coverage: hasil.coverage,
      });
      /*
       * Examiner (W1 fase 3): setelah done, sidecar menilai cakupan intake.
       * GAGAL-CLOSED: sidecar tak terjangkau / bentuk rusak TIDAK pernah
       * menjatuhkan penutupan interviu — status 'unavailable' tercatat
       * jujur (kejujuran, bukan crash), dan verdict 'insufficient' adalah
       * DATA ("bukti belum cukup"), bukan galat.
       */
      let examiner;
      try {
        examiner = await panggilExaminer({ intakeId: sesi.intakeId });
      } catch (errExaminer) {
        log.warn('interview', 'examiner tak terjangkau — dicatat sebagai unavailable', { userId: req.user.id, kode: errExaminer?.kode ?? 'sidecar-mati' });
        examiner = null;
      }
      const tersimpan = await store.simpanExaminer(req.user.id, examiner
        ? { intakeId: sesi.intakeId, verdict: examiner.verdict, coverage: examiner.coverage, perArea: examiner.perArea }
        : { intakeId: sesi.intakeId, verdict: 'unavailable', coverage: null, perArea: [] });
      res.json({ pertanyaan: null, selesai: true, coverage: hasil.coverage, examiner: tersimpan });
      return;
    }
    res.json({ pertanyaan: hasil.pertanyaan, selesai: hasil.selesai, coverage: hasil.coverage });
  } catch (err) {
    const { status, body } = galatInterviu(err, req.user.id);
    res.status(status).json(body);
  }
});

/* ------------------------------------------- Latihan micro-learning */

/**
 * Soal latihan jalur dasar — kunci jawaban TIDAK PERNAH keluar dari server.
 * Peramban menerima soal bersih, mengirim jawabannya, dan yang menilai tetap
 * lib/latihan.js di sini. Gerbang sesinya sama persis dengan /api/sesi/:no.
 */
app.get('/api/latihan/:no', authenticate, (req, res) => {
  const no = Number(req.params.no);
  if (!nomorModulSah(no)) return res.status(404).json({ error: 'Module not found.' });
  if (!adaLatihan(no)) return res.status(404).json({ error: 'No practice quiz is available for this module yet.' });

  const entri = req.user.progress?.latihan?.[no] ?? {};
  res.json({
    soal: soalPublik(no),
    jawaban: entri.jawaban ?? {},
    lulus: Boolean(entri.lulusPada),
  });
});

/**
 * Nilai satu jawaban. Nilainya server (bukan self-report), salah boleh
 * dicoba ulang tanpa menimpa yang sudah benar, dan "lulus" berarti semua
 * soal benar — bukti paham pertama yang bukan sekadar klik.
 */
app.post('/api/latihan/:no', authenticate, requireConsent, async (req, res) => {
  const no = Number(req.params.no);
  if (!nomorModulSah(no) || !adaLatihan(no)) return res.status(404).json({ error: 'Practice quiz not found.' });

  let hasil;
  try {
    hasil = periksa(no, req.body?.index, req.body?.jawaban);
  } catch (err) {
    return res.status(err.status ?? 400).json({ error: err.message });
  }

  const status = await store.simpanJawabanLatihan(req.user.id, no, Number(req.body.index), hasil.benar, hasil.konsep);
  res.json({ benar: hasil.benar, penjelasan: hasil.penjelasan, konsep: hasil.konsep, status });
});

/**
 * Tantangan AI (opsional): SATU soal tambahan yang disusun dari materi modul
 * dan angka usaha peserta sendiri. Hanya terbuka setelah kuis dasarnya lulus
 * — AI mendongak, bukan menggantikan, penilaian deterministik. Soalnya
 * tersimpan milik server (dengan kunci) dan dinilai server juga.
 */
app.post(
  '/api/latihan/:no/ai',
  authenticate,
  requireConsent,
  anggaranToken('latihanAi'),
  rateLimit,
  async (req, res) => {
    const no = Number(req.params.no);
    if (!nomorModulSah(no) || !adaLatihan(no)) return res.status(404).json({ error: 'Practice quiz not found.' });
    // Gerbang belajarnya dulu, baru urusan layanan AI: tanpa kuis dasar yang
    // lulus, status layanan AI tidak relevan untuk peserta.
    if (!req.user.progress?.latihan?.[no]?.lulusPada) {
      return res.status(400).json({ error: 'Finish the basic quiz first — the AI challenge unlocks after that.' });
    }
    if (!isConfigured()) {
      return res.status(503).json({ error: 'The AI service is not configured on this server, so the AI challenge is unavailable.' });
    }

    const existing = await store.bacaLatihanAI(req.user.id, no);
    if (existing) {
      return res.json({ soal: { pertanyaan: existing.pertanyaan, pilihan: existing.pilihan }, sudahAda: true });
    }

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    try {
      const { metrics, transactions } = await metricsFor(req.user);
      const perubahan = bandingkanBulan(transactions);
      const angkaTeks = metricsToText(metrics) + '\n' + perubahan.kalimat.map((s) => '- ' + s).join('\n');

      const { data, usage } = await analyzeLatihanAi({
        materiTeks: materiModul(no),
        angkaTeks,
        signal: controller.signal,
      });
      const bersih = sanitasiLatihanAI(data);
      await store.recordUsage(req.user.id, usage);
      // Soal AI distempel asal-usulnya — pembaca kelak tahu apa yang menyusunnya.
      const tersimpan = await store.aturLatihanAI(req.user.id, no, bersih, { model: modelAktif() });
      log.info('latihan', 'soal AI dibuat', { userId: req.user.id, modul: no });
      res.json({ soal: { pertanyaan: tersimpan.pertanyaan, pilihan: tersimpan.pilihan }, sudahAda: false });
    } catch (err) {
      if (controller.signal.aborted) {
        log.info('latihan', 'soal AI dibatalkan peserta sebelum selesai', { userId: req.user.id });
        return;
      }
      const { status, message } = describeError(err);
      if (isServiceFailure(status)) req.refundRateLimit?.();
      log.error('latihan', 'soal AI gagal', { userId: req.user.id, status, sebab: err?.message ?? String(err) });
      res.status(status).json({ error: message });
    }
  },
);

/** Menilai jawaban tantangan AI — sekali jawab, hasilnya yang disimpan. */
app.post('/api/latihan/:no/ai/jawab', authenticate, requireConsent, async (req, res) => {
  const no = Number(req.params.no);
  const soal = await store.bacaLatihanAI(req.user.id, no);
  if (!soal) return res.status(404).json({ error: 'No AI challenge has been created for this module yet.' });

  const benar = String(req.body?.jawaban ?? '').trim().toUpperCase() === soal.kunci;
  const hasil = await store.catatJawabanLatihanAI(req.user.id, no, benar);
  res.json({ benar: hasil?.hasilBenar ?? benar, penjelasan: soal.penjelasan, sudahJawab: true });
});

app.put('/api/profile', authenticate, requireConsent, async (req, res) => {
  const { profile, errors } = sanitizeProfile(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  const saved = await store.saveProfile(req.user.id, profile);
  const { metrics } = await metricsFor({ ...req.user, profile: saved });
  res.json({ profile: saved, metrics });
});

app.get('/api/recommendations', authenticate, async (req, res) => {
  res.json({ recommendations: req.user.recommendations ?? null });
});

app.post('/api/recommendations', authenticate, requireConsent, anggaranToken('rekomendasi'), rateLimit, async (req, res) => {
  if (!req.user.profile) {
    return res.status(400).json({ error: 'Fill in your business profile before generating recommendations.' });
  }
  const { metrics, transactions } = await metricsFor(req.user);
  // Seluruh riwayat, bukan 3 bulan terakhir — lihat cashbookContext.
  const cashbook = cashbookContext(transactions);

  /*
   * Peserta yang menutup aplikasi saat menunggu menghentikan panggilannya juga.
   *
   * Ini panggilan termahal di seluruh aplikasi — jatahnya 32.000 token dengan
   * penalaran adaptif, dan waktunya paling lama. Tanpa pembatalan, penyusunan
   * yang tidak akan pernah dibaca siapa pun tetap berjalan sampai selesai dan
   * tetap ditagih, sementara `recordUsage` tidak pernah sempat mencatatnya —
   * jadi biayanya juga tidak muncul di jejak token peserta.
   *
   * `writableEnded` diperiksa karena `close` juga menyala pada penyelesaian
   * yang normal; tanpa penjagaan itu, setiap permintaan yang BERHASIL akan
   * memanggil abort sesudahnya.
   */
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const { data, usage } = await generateRecommendations({
      profile: req.user.profile,
      metrics,
      cashbook,
      // Supaya "modulTerkait" mengarah ke tempat peserta benar-benar berada,
      // bukan ke modul yang baru akan dibukanya dua minggu lagi. Coverage
      // interviu (W1 fase 3) ikut sebagai ANGKA berlabel sistem — bukan
      // proses hasil interviu; null = tidak ada yang bisa dipercaya.
      belajar: {
        kemajuan: [
          ringkasKemajuan(req.user.progress?.done ?? {}),
          jadwalUntukAI(req.user),
          barisCoverageKonteks(req.user.examiner),
        ].filter(Boolean).join('\n'),
      },
      signal: controller.signal,
    });
    /*
     * Janji `json_schema` penyedia diverifikasi ulang di server sebelum disimpan
     * (lib/rekomendasi.js). Ini satu-satunya keluaran AI yang persisten dan dibaca
     * ulang tiga permukaan (Saran, fokus harian, kartu publik) — tubuh yang
     * rusak dari penyedia gagal 502 di sini, bukan tersimpan apa adanya.
     */
    const bersih = sanitasiRekomendasi(data);
    // Satu penulisan, bukan dua: rekomendasi dan pemakaian tokennya mengubah
    // pengguna yang sama pada momen yang sama. Identitas model yang benar
    // benar dipakai ikut tersimpan — stempel provenansi, bukan tebakan.
    const saved = await store.simpanRekomendasi(req.user.id, bersih, usage, { model: modelAktif() });
    res.json({ recommendations: saved, metrics, anggaran: await anggaranUntuk(req.user) });
  } catch (err) {
    /*
     * Peserta sudah pergi: tidak ada yang perlu diberi tahu, dan menulis ke
     * sambungan yang sudah tertutup hanya menghasilkan galat kedua.
     */
    if (controller.signal.aborted) {
      log.info('rekomendasi', 'dibatalkan peserta sebelum selesai', { userId: req.user.id });
      return;
    }
    // describeError menangani keduanya: galat SDK diterjemahkan, galat yang
    // dilempar aplikasi sendiri (status + pesannya) dilewatkan apa adanya.
    const { status, message } = describeError(err);
    if (isServiceFailure(status)) req.refundRateLimit?.();
    log.error('rekomendasi', 'penyusunan gagal', { userId: req.user.id, status, sebab: err?.message ?? String(err) });
    res.status(status).json({ error: message });
  }
});

app.get('/api/chat', authenticate, async (req, res) => {
  res.json({ messages: await store.getChat(req.user.id) });
});

app.delete('/api/chat', authenticate, async (req, res) => {
  await store.clearChat(req.user.id);
  res.json({ ok: true });
});

/** Konsultasi chat — jawaban dialirkan sebagai Server-Sent Events. */
/*
 * Nomor modul yang diminta lewat chat diikutkan ke konteks hanya bila nomornya
 * benar-benar ada — nomor asing tidak pernah diam-diam disisipkan sebagai
 * materi. Sejak self-paced, setiap modul yang sah boleh dibahas kapan saja.
 */
const modulDiminta = (req) => {
  if (!nomorModulSah(req.body?.modul)) return null;
  return Number(req.body.modul);
};
app.post(
  '/api/chat',
  authenticate,
  requireConsent,
  anggaranToken((req) => (modulDiminta(req) ? 'chatModul' : 'chat')),
  rateLimit,
  async (req, res) => {
  const message = String(req.body?.message ?? '').trim().slice(0, 2000);
  if (!message) return res.status(400).json({ error: 'The question cannot be empty.' });

  /*
   * Pagar wilayah regulated advice (W1-0, pola PROHIBITED_STEMS Groundwork):
   * gagal-tutup DI MUKA — janji hasil, penghindaran pajak, representasi hukum,
   * dan rekomendasi investasi spesifik ditolak sebelum model dipanggil.
   * Menolak di muka juga berarti tidak membakar anggaran token untuk
   * pertanyaan yang tidak boleh dijawab.
   */
  const tolakan = tolakTopik(message);
  if (tolakan) {
    return res.status(422).json({ error: tolakan.pesan, topikDitolak: true });
  }

  const history = await store.getChat(req.user.id);
  const { metrics, transactions } = await metricsFor(req.user);
  // Seluruh riwayat, bukan 3 bulan terakhir — lihat cashbookContext.
  const cashbook = cashbookContext(transactions);

  /*
   * Konteks belajar — inilah yang menyatukan modul dengan AI.
   *
   * `kemajuan` selalu ikut (~40 token): tanpa itu model tidak tahu peserta ada
   * di hari keberapa, lalu mengarahkan peserta hari ketiga ke modul titik impas.
   *
   * `materi` hanya ikut kalau pertanyaannya datang dari dalam sebuah modul
   * (~700 token). Gunanya menjaga penjelasan AI tetap sama dengan yang sedang
   * dibaca peserta di layar yang sama — intervensi pendidikan yang isinya
   * berubah-ubah tidak bisa diukur.
   */
  const modul = modulDiminta(req);
  const belajar = {
    // Jadwal ikut supaya model tidak menyuruh peserta hari ke-2 "membaca sesi 5
    // dulu" — saran yang tidak bisa dijalankan, dan yang akan dibaca peserta
    // sebagai aplikasi rusak, bukan sebagai saran yang keliru.
    kemajuan: `${ringkasKemajuan(req.user.progress?.done ?? {})}\n${jadwalUntukAI(req.user)}`,
    materi: modul ? materiModul(modul) : '',
  };

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const controller = new AbortController();
  res.on('close', () => controller.abort());

  try {
    const { text, usage, terpotong } = await streamChat({
      profile: req.user.profile,
      metrics,
      cashbook,
      belajar,
      history,
      message,
      signal: controller.signal,
      onText: (chunk) => send('delta', { text: chunk }),
    });

    /*
     * Jawaban yang terpotong disimpan APA ADANYA plus penandanya. Menyimpannya
     * tanpa tanda berarti peserta membaca setengah nasihat keuangan dan
     * mengiranya utuh; membuangnya berarti dia kehilangan bagian yang sudah
     * benar sekaligus jatah token yang sudah terpakai.
     */
    const isi = terpotong ? `${text}\n\n— ${POTONG}` : text;

    /*
     * Satu penulisan untuk seluruh giliran.
     *
     * Dulu `appendChat` lalu `recordUsage` — dua penulisan penuh berkas basis
     * data untuk satu giliran percakapan, pada jalur yang paling sering
     * dipakai. Digabung juga menghapus jendela di mana percakapannya sudah
     * tersimpan tapi tokennya belum terhitung ke anggaran peserta.
     */
    await store.simpanGiliranChat(
      req.user.id,
      [
        { role: 'user', content: message, ts: new Date().toISOString() },
        { role: 'assistant', content: isi, ts: new Date().toISOString() },
      ],
      usage,
      { modul, model: modelAktif() },
    );

    send('done', { model: modelAktif(), terpotong: Boolean(terpotong), anggaran: await anggaranUntuk(req.user) });
  } catch (err) {
    if (controller.signal.aborted) return res.end();
    // Galat yang sudah membawa status & pesannya sendiri (mis. penolakan sistem
    // keamanan AI) tetap dipakai apa adanya — describeError yang menjaganya,
    // di cabang terakhirnya. Menyaringnya di sini justru mendahului cabang SDK
    // dan mengirim pesan galat mentah ke layar peserta.
    const { status, message: msg } = describeError(err);
    if (isServiceFailure(status)) req.refundRateLimit?.();
    log.error('chat', 'percakapan gagal', { userId: req.user.id, status, sebab: err?.message ?? String(err) });
    send('error', { error: msg });
  }
  res.end();
  },
);

/**
 * Isi satu sesi harian — hanya bila jadwalnya sudah membukanya untuk peserta ini.
 *
 * Modul pustaka tidak lewat sini; isinya sudah ikut di /modul.js karena memang
 * tidak digerbang waktu.
 *
 * Sesi yang belum terbuka dijawab 403 BESERTA tanggal terbukanya. Penolakan
 * tanpa tanggal akan dibaca peserta sebagai aplikasi yang rusak, dan pemilik
 * warung yang mengira alatnya rusak tidak membukanya lagi besok — persis
 * kegagalan yang paling merugikan intervensi tujuh hari.
 */
app.get('/api/sesi/:no', authenticate, (req, res) => {
  if (!nomorModulSah(req.params.no)) return res.status(404).json({ error: 'Module not found.' });
  const m = KURIKULUM.find((x) => x.no === Number(req.params.no));

  if (m.sesi == null) {
    return res.json({ no: m.no, isi: m.isi, praktik: m.praktik, aksi: m.aksi ?? null });
  }

  const jadwal = ringkasJadwal(req.user);
  res.json({ no: m.no, isi: m.isi, praktik: m.praktik, aksi: m.aksi ?? null, jadwal });
});

/* ------------------------------------------------- Umpan balik jawaban AI */

/**
 * Mencatat apakah peserta menganggap satu jawaban AI berguna atau keliru.
 *
 * Ini alat ukur yang selama ini hilang. Tanpa penanda "keliru", events.csv
 * hanya menunjukkan BERAPA BANYAK peserta bertanya, bukan apakah jawabannya
 * layak dipakai untuk mengurus buku kas sungguhan. Satu event `ai_feedback`
 * cukup untuk mengaitkan penilaian itu dengan modul, jumlah token, dan
 * perubahan skor TAM peserta yang sama.
 *
 * Penilaiannya milik peserta sepenuhnya: yang tersimpan adalah apa yang dia
 * tekan, bukan tafsiran sistem atas mutu jawaban. Tidak ada penyimpanan baru —
 * hanya logEvent yang sudah ada.
 */
app.post('/api/feedback', authenticate, requireConsent, async (req, res) => {
  const body = req.body ?? {};
  const rating = body.rating;
  if (rating !== 'up' && rating !== 'down') {
    return res.status(400).json({ error: 'Rating must be "up" or "down".' });
  }

  const meta = { rating };
  if (typeof body.alasan === 'string') {
    // Dipotong di sisi server: alasan bebas-tulis adalah satu-satunya kolom di
    // rute ini yang panjangnya ditentukan peserta.
    const alasan = body.alasan.trim().slice(0, 500);
    if (alasan) meta.alasan = alasan;
  }
  if (body.chatIndex != null && Number.isFinite(Number(body.chatIndex))) {
    meta.chatIndex = Number(body.chatIndex);
  }

  await store.logEvent(req.user.id, 'ai_feedback', meta);
  res.status(201).json({ ok: true });
});

/* ------------------------------------------- Persetujuan & data milik peserta */

app.get('/api/consent', authenticate, (req, res) => {
  res.json({ consent: CONSENT_TEXT, disetujui: hasConsented(req.user), tercatat: req.user.consent ?? null });
});

app.post('/api/consent', authenticate, async (req, res) => {
  if (Number(req.body?.versi) !== CONSENT_VERSION) {
    return res.status(400).json({ error: 'Versi persetujuan tidak cocok. Muat ulang halaman lalu coba lagi.' });
  }
  res.json({ consent: await store.saveConsent(req.user.id, CONSENT_VERSION) });
});

/** Unduh seluruh data sendiri. Buku kas ini milik peserta, bukan milik program. */
app.get('/api/my-data', authenticate, async (req, res) => {
  const data = await store.exportUser(req.user.id);
  if (!data) return res.status(404).json({ error: 'Data tidak ditemukan.' });
  await store.logEvent(req.user.id, 'data_downloaded');
  const nama = `novaro-${req.user.id}-${todayISO()}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nama}"`);
  res.send(JSON.stringify(data, null, 2));
});

/**
 * Berhenti dari program dan hapus seluruh data.
 *
 * Benar-benar dihapus, bukan ditandai nonaktif. Peserta yang menarik diri berhak
 * datanya ikut pergi — termasuk dari ekspor penelitian berikutnya.
 */
app.delete('/api/my-account', authenticate, async (req, res) => {
  if (req.body?.konfirmasi !== 'HAPUS') {
    return res.status(400).json({ error: 'Konfirmasi tidak cocok. Ketik HAPUS untuk melanjutkan.' });
  }
  const ok = await store.deleteUser(req.user.id);
  if (!ok) return res.status(404).json({ error: 'Data tidak ditemukan.' });
  log.info('peserta', 'menarik diri, seluruh datanya dihapus', { userId: req.user.id });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ Buku kas */

/** Bulan dari query, dibatasi ke rentang yang masuk akal. */
function bulanDiminta(raw) {
  const ini = currentMonth();
  if (!/^\d{4}-\d{2}$/.test(raw ?? '')) return ini;
  // Bulan depan tidak pernah punya isi; melayaninya cuma menggambar sebulan kosong.
  if (raw > ini) return ini;
  const terlama = tanggalTerlama().slice(0, 7);
  return raw < terlama ? terlama : raw;
}

/* ------------------------------------------------- Garis waktu kesehatan */

/**
 * Skor kesehatan per bulan — dari catatan NYATA, bukan karangan.
 *
 * Hanya bulan yang benar-benar punya catatan yang muncul; bulan kosong
 * DILEWATI, bukan diisi nol atau angka tebakan. Perhitungannya persis
 * metricsFor: computeMetrics dengan ringkasan bulan bersangkutan, dan
 * bulan yang belum cukup rapat tercatat tetap memakai perkiraan profil
 * sebagai dasar — aturan yang sama dengan dasbor hari ini.
 */
app.get('/api/timeline', authenticate, async (req, res) => {
  const transactions = await store.getTransactions(req.user.id);
  const bulanList = lastMonths(6).reverse(); // terlama dulu — seperti pembukuan

  const titik = [];
  for (const bulan of bulanList) {
    const ringkasan = summarizeMonth(transactions, bulan);
    if (!ringkasan.jumlahTransaksi) continue; // bulan kosong tidak dikarang
    const { metrics } = await metricsForBulan(req.user, transactions, ringkasan);
    titik.push({
      bulan,
      skor: metrics.skorKesehatan,
      status: metrics.statusKesehatan,
    });
  }

  // Tren hanya diklaim bila ada minimal dua titik — satu titik tidak punya arah.
  const tren = titik.length >= 2 ? titik.at(-1).skor - titik[0].skor : null;
  res.json({ titik, tren });
});

/* ------------------------------------------------- Papan kemajuan (demo) */

/*
 * Papan kemajuan komunitas — dibangun HANYA dari akun DEMO.
 *
 * Daftar putih ketat, bukan daftar hitam: satu-satunya akun yang boleh
 * tampil adalah yang bermeta batch === 'DEMO' — nomor demo 101–120, semua
 * persona fiktif dari lib/demo-data.js. Peserta penelitian tidak sekadar
 * "disamarkan namanya": rute ini tidak pernah MEMBACA data mereka sama
 * sekali, jadi tidak ada yang bisa bocor dari sini betapapun salah kodenya.
 *
 * Yang tampil per baris dibatasi eksplisit (medan yang sama filosofinya
 * dengan susunKartuPublik): nama usaha, jenis, skor, omzet, ritme mencatat,
 * dan arah perubahan skor. Bukan: transaksi satu per satu, riwayat chat,
 * id internal, atau apa pun yang bisa mengidentifikasi di luar papan.
 *
 * Angka per akun dihitung metricsFor/metricsForBulan — rumus yang sama
 * dengan dasbor tiap akun, bukan perhitungan kedua. Hasilnya di-cache
 * dalam proses sesaat: papan yang digambar ulang penuh untuk dua puluh
 * orang yang membukanya dalam semenit bukan papan, tapi beban.
 */
let papanCache = { pada: 0, baris: null };
const PAPAN_TTL_MS = 60 * 1000;

app.get('/api/papan', authenticate, async (req, res) => {
  await store.logEvent(req.user.id, 'papan_viewed', undefined, { jedaMs: 5 * 60 * 1000 });

  const kini = Date.now();
  if (!papanCache.baris || kini - papanCache.pada > PAPAN_TTL_MS) {
    const baris = [];
    for (const ringkas of await store.listUsers()) {
      if (ringkas.batch !== 'DEMO') continue;
      const user = await store.findUserById(ringkas.id);
      if (!user?.profile) continue;

      const transactions = await store.getTransactions(user.id);
      const { metrics } = await metricsFor(user);

      // Arah skor: titik-titik yang sama dengan garis waktu kesehatan.
      const titik = [];
      for (const bulan of lastMonths(6).reverse()) {
        const ringkasan = summarizeMonth(transactions, bulan);
        if (!ringkasan.jumlahTransaksi) continue; // bulan kosong tidak dikarang
        titik.push(metricsForBulan(user, transactions, ringkasan).metrics.skorKesehatan);
      }

      baris.push({
        id: user.id,
        nama: String(user.profile.namaUsaha || user.name || 'Usaha contoh').slice(0, 80),
        jenis: LABEL.jenisUsaha[user.profile.jenisUsaha] ?? null,
        skor: metrics.skorKesehatan,
        omzet: Number.isFinite(metrics.omzet) ? Math.round(metrics.omzet) : 0,
        hariTercatat: Number(metrics.hariTercatat) || 0,
        delta: titik.length >= 2 ? titik.at(-1) - titik.at(-2) : null,
      });
    }

    baris.sort((a, b) => b.skor - a.skor);
    papanCache = { pada: kini, baris };
  }

  // Posisi peminta dihitung SAAT diminta, bukan ikut cache — cache hanya
  // menyimpan angka komunitas, bukan hubungannya dengan siapa pun.
  const idxAku = papanCache.baris.findIndex((b) => b.id === req.user.id);

  res.json({
    baris: papanCache.baris.map(({ id, ...tampil }, i) => ({
      peringkat: i + 1,
      nama: tampil.nama,
      jenis: tampil.jenis,
      skor: tampil.skor,
      omzet: tampil.omzet,
      hariTercatat: tampil.hariTercatat,
      delta: tampil.delta,
    })),
    // `aku` hanya terisi bila peminta memang baris demo — peserta penelitian
    // melihat papan yang sama tanpa pernah punya baris di dalamnya.
    aku: idxAku >= 0 ? idxAku + 1 : null,
    dibuatPada: new Date().toISOString(),
  });
});

/* ------------------------------------------------- Apa yang berubah? */

/**
 * Bandingkan bulan berjalan dengan bulan sebelumnya — deterministik, tanpa AI.
 *
 * Angkanya dari summarizeMonth yang sama dengan buku kas dan laporan.
 * "Pengeluaran" yang dibandingkan adalah BIAYA USAHA (bahan + operasional +
 * lainnya): prive dan cicilan bukan biaya, dan memasukkannya membuat
 * perbandingan menudah pemilik yang mengambil prive lebih sering bulan ini.
 * Dipakai dua rute — /api/perubahan dan check-up AI (sebagai konteks angka) —
 * supaya perbandingannya tidak pernah berbeda antar halaman.
 */
function bandingkanBulan(transactions) {
  const [kiniBulan, laluBulan] = lastMonths(2); // lastMonths: [berjalan, sebelumnya]

  const ringkas = (bulan) => {
    const s = summarizeMonth(transactions, bulan);
    return {
      bulan,
      ada: s.jumlahTransaksi > 0,
      omzet: s.penjualan + s.lainMasuk,
      pengeluaran: s.belanjaBahan + s.operasional + s.lainKeluar,
      labaBersih: s.labaBersih,
      pencatatan: s.jumlahTransaksi,
    };
  };

  const dulu = ringkas(laluBulan);
  const kiniR = ringkas(kiniBulan);
  const ubah = {};
  for (const kunci of ['omzet', 'pengeluaran', 'labaBersih', 'pencatatan']) {
    ubah[kunci] = perubahanPersen(dulu[kunci], kiniR[kunci]);
  }

  // Kalimat penjelasan — deterministik, dibangun dari angka yang sudah sahih.
  const arah = (perubahan, naik, turun, datar) =>
    perubahan === null ? datar : perubahan > 0 ? naik : perubahan < 0 ? turun : datar;
  const kalimat = [
    ubah.omzet !== null && kiniR.omzet > 0
      ? arah(ubah.omzet,
          `Omzet naik ${ubah.omzet}% dibanding bulan sebelumnya.`,
          `Omzet turun ${Math.abs(ubah.omzet)}% dibanding bulan sebelumnya.`,
          'Omzet tetap dibanding bulan sebelumnya.')
      : 'Belum cukup data untuk membandingkan omzet dengan bulan sebelumnya.',
    ubah.pengeluaran !== null && kiniR.pengeluaran > 0
      ? arah(ubah.pengeluaran,
          `Pengeluaran usaha naik ${ubah.pengeluaran}% — periksa pos mana yang tumbuh.`,
          `Pengeluaran usaha turun ${Math.abs(ubah.pengeluaran)}% — pengeluaran lebih hemat dari bulan lalu.`,
          'Pengeluaran usaha tetap dibanding bulan sebelumnya.')
      : '',
    ubah.labaBersih !== null && dulu.labaBersih !== 0
      ? arah(ubah.labaBersih,
          'Laba bersih ikut naik — omzet tumbuh lebih cepat daripada biayanya.',
          'Laba bersih turun — biaya tumbuh lebih cepat daripada omzet.',
          'Laba bersih tetap.')
      : '',
    kiniR.pencatatan > 0
      ? arah(ubah.pencatatan,
          `Ritme mencatat naik: ${kiniR.pencatatan} catatan bulan ini vs ${dulu.pencatatan} bulan lalu.`,
          `Ritme mencatat menurun: ${kiniR.pencatatan} catatan bulan ini vs ${dulu.pencatatan} bulan lalu.`,
          `Ritme mencatat konsisten: ${kiniR.pencatatan} catatan.`)
      : 'Belum ada catatan bulan ini.',
  ].filter(Boolean);

  return { lalu: dulu, kini: kiniR, ubah, kalimat };
}

app.get('/api/perubahan', authenticate, async (req, res) => {
  const transactions = await store.getTransactions(req.user.id);
  res.json(bandingkanBulan(transactions));
});

/* ------------------------------------------------- Check-up keuangan (AI) */

/**
 * Check-up usaha — dipicu pengguna, bukan otomatis.
 *
 * AI hanya MENILAI status dari angka yang dikirim (metricsToText + hasil
 * bandingkanBulan); keluarannya bersih dari sanitasiCheckup dan angka di
 * halaman tetap berasal dari perhitungan server. Tagihan dijagai jatah
 * checkup, dibatasi laju, dan dicatat — persis pola rekomendasi.
 */
app.post(
  '/api/checkup',
  authenticate,
  requireConsent,
  anggaranToken('checkup'),
  rateLimit,
  async (req, res) => {
    if (!isConfigured()) {
      return res.status(503).json({ error: 'Layanan AI belum diatur di server ini, jadi check-up belum bisa dipakai.' });
    }

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    try {
      const { metrics, transactions } = await metricsFor(req.user);
      const perubahan = bandingkanBulan(transactions);
      const { data: mentah, usage } = await analyzeCheckup({
        metricsTeks: metricsToText(metrics),
        perubahanTeks: 'Perbandingan bulan ini vs bulan lalu:\n' + perubahan.kalimat.map((s) => '- ' + s).join('\n'),
        signal: controller.signal,
      });
      const hasil = sanitasiCheckup(mentah);
      /*
       * Persist checkup DIAKTIFKAN (keputusan owner YA 2026-09-13 — menutup
       * Open Question #7): hasil yang sama yang tampil di layar ikut direkam
       * sebagai advisori jenis 'checkup' — sanitizer tak berubah, trim per
       * jenis tetap berlaku, provenansi 'ai' + model dari pola Sesi D, dan
       * usage berangkat dalam penulisan yang sama. Gagal di atas sini
       * (penyedia/sanitizer) berarti TIDAK ADA yang ter-append — fail-closed
       * jalur yang sudah ada. Checkup tetap NOL tulisan uang.
       */
      await store.simpanCheckup(req.user.id, hasil, usage, { model: modelAktif() });
      res.json({ hasil, anggaran: await anggaranUntuk(req.user) });
    } catch (err) {
      if (controller.signal.aborted) {
        log.info('checkup', 'dibatalkan peserta sebelum selesai', { userId: req.user.id });
        return;
      }
      const { status, message } = describeError(err);
      if (isServiceFailure(status)) req.refundRateLimit?.();
      log.error('checkup', 'check-up gagal', { userId: req.user.id, status, sebab: err?.message ?? String(err) });
      res.status(status).json({ error: message });
    }
  },
);

app.get('/api/cashbook', authenticate, async (req, res) => {
  const transactions = await store.getTransactions(req.user.id);
  const month = bulanDiminta(req.query.month);

  /*
   * Filter daftar (pencarian/jenis/kategori) — opsional, kumulatif, dan
   * hanya untuk DAFTAR. Ringkasan & grafik tetap dari seluruh transaksi
   * bulan itu: mencari "gas" tidak boleh membuat saldo kas sebulan ikut
   * berubah. Parameter asing/ tidak sah diabaikan, bukan dijadikan galat —
   * filter yang salah ketik cukup berarti "semua".
   */
  const tersaring = saringTransaksi(transactionsForMonth(transactions, month), {
    q: String(req.query.q ?? ''),
    jenis: String(req.query.jenis ?? ''),
    kategori: String(req.query.kategori ?? ''),
  });

  res.json({
    month,
    today: todayISO(),
    kategori: KATEGORI,
    transactions: tersaring,
    terfilter: tersaring.length !== transactionsForMonth(transactions, month).length,
    summary: summarizeMonth(transactions, month),
    monthsAvailable: monthsWithData(transactions),
  });
});

app.post('/api/cashbook', authenticate, requireConsent, async (req, res) => {
  const body = req.body ?? {};
  const jenis = JENIS.includes(body.jenis) ? body.jenis : null;
  const kategori = jenis && isValidKategori(jenis, body.kategori) ? body.kategori : null;
  const jumlah = asNumber(body.jumlah, 1e12);
  const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(body.tanggal ?? '') ? body.tanggal : todayISO();
  const keterangan = String(body.keterangan ?? '').trim().slice(0, 120);

  if (!jenis) return res.status(400).json({ error: 'Jenis transaksi harus "masuk" atau "keluar".' });
  if (!kategori) return res.status(400).json({ error: 'Kategori transaksi tidak dikenali.' });
  if (jumlah <= 0) return res.status(400).json({ error: 'Jumlah harus lebih dari 0.' });
  if (tanggal > todayISO()) return res.status(400).json({ error: 'Tanggal tidak boleh di masa depan.' });
  if (tanggal < tanggalTerlama()) {
    return res.status(400).json({ error: `Tanggal terlalu lama. Periksa tahunnya — paling lama ${tanggalTerlama()}.` });
  }

  /*
   * Id permintaan OPSIONAL dari peramban (`X-Request-Id`): ketukan ganda dan
   * kirim ulang otomatis yang membawa id yang sama ditolak mutator sebagai
   * `duplikat` (409) — satu niat tidak lagi bisa menjadi dua baris. Tanpa
   * header, permintaan berjalan persis seperti dulu dan pengulangan tidak
   * terdeteksi (kelemahan yang diakui, dijelaskan di kontrak mutator).
   * VALIDASINYA TIDAK DI SINI: header apa adanya diteruskan, dan mutator —
   * penegak terakhir — yang menolak bentuk asing. Satu aturan, satu tempat.
   */
  const idPermintaan = String(req.get('x-request-id') ?? '').trim();

  /*
   * Token usulan (T1 surface #1, fase 5): SATU medan tambahan yang dibaca
   * dari tubuh — string, diteruskan APA ADANYA ke mutator. Validasinya bukan
   * urusan rute: mutator (penegak terakhir) memverifikasi HMAC/versi/TTL/jti
   * dan menolak bertipe. Rute kas TETAP satu-satunya pintu simpan — konfirmasi
   * usulan hanyalah permintaan kas yang membawa token (desain FDM §5).
   */
  const proposalToken = typeof body.proposalToken === 'string' ? body.proposalToken.trim() : '';

  let row;
  try {
    row = await store.addTransaction(
      req.user.id,
      { tanggal, jenis, kategori, keterangan, jumlah },
      { aktor: 'manusia', requestId: idPermintaan || undefined, proposalToken: proposalToken || undefined },
    );
  } catch (err) {
    /*
     * Penolakan bertipe dari batas tulis diteruskan apa adanya — bentuk galat
     * tetap `{error}` + ekstra bertipe. Yang bisa sampai ke sini dari rute
     * ini: id permintaan tidak sah (400), id permintaan kembar (409); semua
     * pemeriksaan medan sudah lolos di atas, tapi mutator tetap lapisan
     * terakhir kalau suatu hari pemeriksaan rute berubah.
     */
    if (err instanceof GalatMutasi) {
      return res.status(err.status).json({ error: err.message, kode: err.kode });
    }
    throw err;
  }
  if (!row) {
    // Pengguna lenyap di antara autentikasi dan penulisan — 201 dengan
    // `transaction: null` pernah terjadi di sini; itu bukan keberhasilan.
    return res.status(404).json({ error: 'User not found.' });
  }
  const transactions = await store.getTransactions(req.user.id);
  const month = tanggal.slice(0, 7);
  const thisMonth = currentMonth();

  /*
   * Bukti praktik: transaksi yang BENAR-BENAR tercatat adalah tindakan nyata
   * yang diminta beberapa modul. Penandaannya di sisi server — klik tombol
   * CTA di modul tidak pernah dihitung selesai; hanya baris buku kas yang
   * benar-benar masuk. Praktik yang ditandai juga dibatasi: modul yang sudah
   * selesai dibaca, atau sesi berikutnya yang sedang dijalani peserta.
   */
  const doneKas = req.user.progress?.done ?? {};
  const praktikBaru = modulPraktikTerverifikasi({
    done: doneKas,
    sudah: req.user.progress?.praktik ?? {},
    jenis: 'transaksi',
    sesiBerikutNo: SESI_HARIAN
      .find((x) => !doneKas[x.no])?.no ?? null,
  });
  if (praktikBaru.length) await store.tandaiPraktik(req.user.id, praktikBaru, 'transaksi');
  // Bukti tambahan untuk penelitian sudah disediakan store.addTransaction
  // (event transaction_added) — tidak ada event kedua yang menduplikasinya.

  // Transaksi bisa dicatat mundur ke bulan lalu; ringkasan yang dikembalikan
  // adalah bulan transaksinya, sedangkan metrik selalu bulan berjalan.
  const summary = summarizeMonth(transactions, month);
  const berjalan = month === thisMonth ? summary : summarizeMonth(transactions, thisMonth);

  res.status(201).json({
    transaction: row,
    summary,
    praktikTerverifikasi: praktikBaru,
    metrics: computeMetrics(req.user.profile ?? {}, isMonthReliable(berjalan) ? berjalan : null, berjalan),
  });
});

app.delete('/api/cashbook/:id', authenticate, requireConsent, async (req, res) => {
  const ok = await store.deleteTransaction(req.user.id, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
  const { metrics, summary } = await metricsFor(req.user);
  res.json({ ok: true, summary, metrics });
});

/** Data laporan keuangan siap-peminjam — beberapa bulan sekaligus. */
app.get('/api/report', authenticate, async (req, res) => {
  const count = Math.min(Math.max(Number(req.query.months) || 6, 1), 12);
  // Mengganti pilihan bulan tiga kali tetap satu kali "peserta membuka laporan".
  // Tanpa jeda, tiap penggantian menulis ulang seluruh berkas data.
  await store.logEvent(req.user.id, 'report_viewed', { bulan: count }, { jedaMs: 5 * 60 * 1000 });
  const transactions = await store.getTransactions(req.user.id);

  /*
   * Membuka laporan adalah tindakan nyata yang diminta beberapa modul
   * (sesi 7, anggaran, pajak, berkas KUR) — praktik mereka terverifikasi di
   * sini, dari event yang sama dengan yang selama ini mencatat `report_viewed`.
   */
  const doneLaporan = req.user.progress?.done ?? {};
  const praktikLaporan = modulPraktikTerverifikasi({
    done: doneLaporan,
    sudah: req.user.progress?.praktik ?? {},
    jenis: 'laporan',
    sesiBerikutNo: SESI_HARIAN
      .find((x) => !doneLaporan[x.no])?.no ?? null,
  });
  if (praktikLaporan.length) await store.tandaiPraktik(req.user.id, praktikLaporan, 'laporan');

  const months = lastMonths(count).reverse(); // terlama dulu, seperti pembukuan
  const summaries = summarizeRange(transactions, months);
  const total = summaries.reduce(
    (acc, s) => ({
      penjualan: acc.penjualan + s.penjualan,
      lainMasuk: acc.lainMasuk + s.lainMasuk,
      belanjaBahan: acc.belanjaBahan + s.belanjaBahan,
      operasional: acc.operasional + s.operasional,
      lainKeluar: acc.lainKeluar + s.lainKeluar,
      cicilan: acc.cicilan + s.cicilan,
      prive: acc.prive + s.prive,
      labaBersih: acc.labaBersih + s.labaBersih,
      saldoKas: acc.saldoKas + s.saldoKas,
      jumlahTransaksi: acc.jumlahTransaksi + s.jumlahTransaksi,
    }),
    { penjualan: 0, lainMasuk: 0, belanjaBahan: 0, operasional: 0, lainKeluar: 0, cicilan: 0, prive: 0, labaBersih: 0, saldoKas: 0, jumlahTransaksi: 0 },
  );
  const terisi = summaries.filter((s) => s.jumlahTransaksi > 0);
  /*
   * Rata-rata laba per bulan dihitung HANYA dari bulan yang sudah habis dan
   * terisi. Bulan berjalan yang baru jalan seminggu bukan sebuah bulan: kalau
   * ikut dibagi, satu angka kecil menyeret turun rata-rata — dan justru angka
   * inilah yang dibaca pemberi pinjaman untuk menilai kelayakan. Pemberi memang minta
   * bulan yang sudah selesai (3–6 bulan terakhir), bukan bulan yang sedang jalan.
   */
  const lengkap = summaries.filter(isMonthComplete);
  const dasar = lengkap.length ? lengkap : [];
  const rataLabaBulanan = dasar.length
    ? Math.round(dasar.reduce((s, m) => s + m.labaBersih, 0) / dasar.length)
    : 0;
  const berjalan = summaries.find((s) => !s.lengkap && s.jumlahTransaksi > 0) ?? null;
  // Bulan yang sudah habis dan ada catatannya, tapi terlalu bolong untuk dirata-rata.
  const bulanBolong = terisi
    .filter((s) => s.lengkap && !isMonthComplete(s))
    .map((s) => ({ month: s.month, hariTercatat: s.hariTercatat, hariBulan: s.hariBulan }));

  res.json({
    profile: req.user.profile ?? null,
    // `layakRataRata` menemani setiap bulan supaya tampilan tidak perlu menebak
    // ulang aturannya — satu sumber kebenaran, dipakai grafik, tabel, dan rata-rata.
    summaries: summaries.map((s) => ({ ...s, layakRataRata: isMonthComplete(s) })),
    total,
    bulanTerisi: terisi.length,
    bulanLengkap: lengkap.length,
    bulanBolong,
    rataLabaBulanan,
    // Bulan berjalan dilaporkan terpisah, tidak dicampur ke rata-rata.
    /*
     * `setaraLabaBersih` sengaja TIDAK ikut.
     *
     * Ia pernah dikirim di sini dan tidak pernah dipakai satu baris pun oleh
     * tampilan — medan mati. Membiarkannya bukan sekadar bobot sia-sia,
     * melainkan jebakan: siapa pun yang kelak memakainya akan menaruh angka
     * PROYEKSI di halaman laporan, di sebelah bulan-bulan yang sudah benar
     * terjadi, pada berkas yang dicetak untuk dibawa ke bank. Bulan yang baru
     * berjalan seminggu bisa berfaktor 4x lipat. Yang boleh dilaporkan dari
     * bulan berjalan adalah apa adanya — `labaBersih` — beserta jumlah harinya,
     * dan itulah yang ada di bawah.
     */
    bulanBerjalan: berjalan
      ? {
          month: berjalan.month,
          hariBerjalan: berjalan.hariBerjalan,
          hariBulan: berjalan.hariBulan,
          hariTercatat: berjalan.hariTercatat,
          labaBersih: berjalan.labaBersih,
        }
      : null,
    dibuatPada: new Date().toISOString(),
  });
});

/**
 * Menyaring `done` menjadi hanya nomor modul yang benar-benar ada.
 *
 * Medan ini datang mentah dari peramban dan disimpan apa adanya, lalu ikut
 * terbaca sebagai `modulSelesai` di `users.csv` dan `module_completed` di
 * `events.csv`. Tanpa saringan, satu permintaan boleh menitipkan kunci
 * sembarang — termasuk ribuan kunci karangan — dan angka "modul selesai" di
 * data penelitian menjadi tidak berarti tanpa satu pun tanda bahwa ia dikarang.
 * Nomor yang tidak dikenal dibuang diam-diam: peramban hanya pernah mengirim
 * nomor yang sah, jadi nomor asing berarti bukan dari halaman ini.
 */
function saringProgres(done, user) {
  const bersih = {};
  if (typeof done !== 'object' || !done) return bersih;
  const sudah = user?.progress?.done ?? {};
  for (const [kunci, nilai] of Object.entries(done)) {
    if (!nilai || !nomorModulSah(kunci)) continue;
    const no = Number(kunci);
    /*
     * Sesi yang sudah pernah ditandai selesai TETAP diterima walau sekarang
     * terhitung terkunci. Itu bisa terjadi bila pendamping memperbaiki tanggal
     * mulai ke tanggal yang lebih belakang: tanpa cabang ini, satu koreksi
     * jadwal akan diam-diam menghapus riwayat penyelesaian peserta — dan
     * `module_completed` di events.csv sudah terlanjur mencatat sebaliknya.
     */
    if (sudah[no] || nomorModulSah(no)) bersih[no] = true;
  }
  return bersih;
}

app.put('/api/progress', authenticate, requireConsent, async (req, res) => {
  const body = req.body ?? {};
  /*
   * `checks` dikirim sebagai `undefined` bila peramban memang tidak mengirimnya
   * — BUKAN sebagai `{}`.
   *
   * `store.saveProgress` punya penjaga `progress.checks ?? user.progress?.checks`
   * yang dimaksudkan menjaga data lama agar tidak terhapus. Penjaga itu memakai
   * `??`, yang hanya menangkap null/undefined — sedangkan baris ini dulu selalu
   * mengirim `{}`, sebuah nilai yang bukan nullish. Akibatnya penjaganya menjadi
   * kode mati, dan setiap penyimpanan progres menghapus `checks` lama secara
   * diam-diam. Tampilan memang tidak lagi memakai medan itu, tapi data peserta
   * lama tetap tidak boleh dihapus oleh penyimpanan yang tidak menyebutnya.
   */
  const checksDikirim = typeof body.checks === 'object' && body.checks ? body.checks : undefined;
  const progress = {
    done: saringProgres(body.done, req.user),
    ...(checksDikirim ? { checks: checksDikirim } : {}),
  };
  res.json({ progress: await store.saveProgress(req.user.id, progress) });
});

/* --------------------------------------------------------------- Aset statis */

/*
 * Kurikulum disajikan sebagai skrip biasa, bukan lewat /api/.
 *
 * Isinya sama untuk semua peserta dan tidak memuat satu pun data pribadi, jadi
 * ia tidak perlu kode akses dan JUSTRU sebaiknya boleh disimpan cache peramban:
 * ukurannya ±54 KB, dan jalur /api/ semuanya bertanda `no-store` sehingga akan
 * mengunduh ulang seluruhnya pada tiap kali halaman dibuka. Untuk peserta yang
 * membuka aplikasi ini tiap hari dari ponsel dengan kuota terbatas, itu bukan
 * biaya yang pantas dibayar berulang.
 *
 * Ditulis sebagai skrip klasik, bukan modul ES: skrip utama halaman ini masih
 * memakai fungsi global (ada 16 atribut onclick di HTML-nya), jadi mengubahnya
 * menjadi modul akan mematikan tombol-tombol itu tanpa suara.
 *
 * ETag dari express menangani sisanya — perubahan kurikulum langsung terkirim,
 * yang tidak berubah dijawab 304.
 */
/*
 * Isi tujuh sesi harian TIDAK ikut ke berkas ini.
 *
 * Berkas ini publik, boleh di-cache, dan sama untuk semua orang — itulah yang
 * membuatnya murah. Sifat itu langsung hilang begitu isinya berbeda per peserta,
 * dan berkas publik yang berbeda per peserta adalah kebocoran menunggu waktu
 * bila kelak ada CDN di depannya.
 *
 * Karena itu isinya dibelah menurut apa yang benar-benar perlu dijaga:
 *
 *   22 modul pustaka  37,6 KB  tidak digerbang waktu  -> tetap di sini, di-cache
 *    7 sesi harian    20,5 KB  digerbang jadwal       -> hanya metadatanya (1,5 KB)
 *
 * Metadatanya sengaja tetap dikirim seluruhnya: peserta boleh — dan sebaiknya —
 * melihat peta tujuh harinya sejak hari pertama. Yang dijaga isinya, bukan
 * keberadaannya. Isi satu sesi (rata-rata 2,9 KB) diambil sekali sehari lewat
 * `GET /api/sesi/:no`, yang tahu peserta mana yang sedang bertanya.
 */
const tanpaIsi = ({ isi, praktik, aksi, ...meta }) => ({ ...meta, isiTerpisah: true });
const KURIKULUM_PUBLIK = KURIKULUM.map((m) => (m.sesi == null ? m : tanpaIsi(m)));

const MODUL_JS = `window.NOVA_MODUL=${JSON.stringify(KURIKULUM_PUBLIK)};window.NOVA_JALUR=${JSON.stringify(JALUR)};`;

/*
 * Ketiga aset besar dikompresi SEKALI saat start, bukan pada tiap permintaan.
 *
 * Middleware kompresi umum akan ikut menahan aliran Server-Sent Events di
 * /api/chat — jawaban AI yang seharusnya menetes jadi muncul sekaligus di
 * akhir. Dengan menyiapkan aset di depan, jalur /api/ tidak tersentuh sama
 * sekali. Hematnya: muat pertama 164,2 KB -> 48,7 KB.
 */
const ASET_MODUL = asetDariNilai(MODUL_JS, 'application/javascript; charset=utf-8');
const ASET_APLIKASI = asetDariBerkas(path.join(HERE, 'public', 'index.html'), 'text/html; charset=utf-8');
const ASET_LANDING = asetDariBerkas(path.join(HERE, 'public', 'landing.html'), 'text/html; charset=utf-8');
/*
 * Halaman publik kartu kesehatan. Statik dan tanpa satu pun data pengguna —
 * datanya diambil peramban dari /api/kartu/publik/:token, satu-satunya
 * endpoint yang membaca lewat token bagikan.
 */
const ASET_KARTU = asetDariBerkas(path.join(HERE, 'public', 'kartu.html'), 'text/html; charset=utf-8');
/*
 * Rumus simulasi KUR — berkas YANG SAMA dengan yang diimpor uji node
 * (lib/simulasi-cicilan.js). Satu sumber rumus: peramban menghapusnya sebagai
 * modul lalu menempelkannya ke window.NOVA_SIMULASI, server mengujinya
 * langsung. Sengaja bukan salinan di public/, supaya tidak ada dua berkas
 * rumus yang bisa menyimpang diam-diam.
 */
const ASET_SIMULASI = asetDariBerkas(path.join(HERE, 'lib', 'simulasi-cicilan.js'), 'application/javascript; charset=utf-8');
/*
 * Susunan film Putar Ulang — pola yang sama dengan ASET_SIMULASI di atas:
 * lib/putar-ulang.js diimpor uji node dan dimuat peramban sebagai modul,
 * jadi pengelompokan hari, kumulatif saldo, dan penempelan skor bulanannya
 * tidak pernah punya salinan kedua yang bisa menyimpang diam-diam.
 */
const ASET_PUTAR = asetDariBerkas(path.join(HERE, 'lib', 'putar-ulang.js'), 'application/javascript; charset=utf-8');

app.get('/modul.js', sajikanAset(ASET_MODUL, { cacheControl: 'public, max-age=300' }));
app.get('/simulasi-cicilan.js', sajikanAset(ASET_SIMULASI, { cacheControl: 'public, max-age=300' }));
app.get('/putar-ulang.js', sajikanAset(ASET_PUTAR, { cacheControl: 'public, max-age=300' }));

/*
 * Halaman kartu yang dibagikan. Jalurnya cantik (/kartu/kartu_XXXX…), halaman
 * AMBIL sendiri token dari URL-nya lalu mengambil data lewat endpoint publik.
 * Token asing apa pun tetap disajikan halamannya — halaman yang sama yang
 * menampilkan "kartu tidak ditemukan" dengan rapi, bukan 404 mentah.
 */
app.get('/kartu/:token', sajikanAset(ASET_KARTU, { cacheControl: 'no-cache' }));

/*
 * Landing page publik
 */
app.get('/', sajikanAset(ASET_LANDING, { cacheControl: 'no-cache' }));

/*
 * Halaman aplikasi TIDAK boleh di-cache lama.
 *
 * Ia memuat seluruh skrip aplikasi; salinan lama yang bertahan di ponsel
 * peserta berarti perbaikan yang sudah di-deploy tidak pernah sampai kepadanya,
 * dan tidak ada satu pun tanda bahwa itu sedang terjadi. `no-cache` tetap
 * mengizinkan 304 lewat ETag, jadi yang diunduh ulang hanya kalau memang berubah.
 */
for (const jalur of ['/app', '/index.html']) {
  app.get(jalur, sajikanAset(ASET_APLIKASI, { cacheControl: 'no-cache' }));
}
/*
 * Aplikasi peserta tidak boleh muncul di hasil pencarian.
 *
 * Alamatnya memang perlu bisa dibuka siapa pun yang memegang kodenya, tapi
 * halaman masuk sebuah program penelitian yang terindeks mesin pencari
 * mengundang lalu lintas yang tidak ada gunanya — dan setiap percobaan kode
 * asing ikut memakan pembatas login peserta yang sah.
 */
app.get('/robots.txt', (req, res) => {
  res.type('text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send('User-agent: *\nDisallow: /\n');
});

app.use(express.static(path.join(HERE, 'public'), { extensions: ['html'] }));

/*
 * Alamat yang tidak dikenal: JSON untuk /api, halaman aplikasi untuk sisanya.
 *
 * Sebelumnya semuanya dijawab JSON, jadi peserta yang membuka tautan lama atau
 * salah ketik alamat melihat `{"error":"Alamat tidak ditemukan."}` mentah di
 * layar ponselnya, bukan aplikasinya.
 */
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Alamat tidak ditemukan.' });
  if (req.method === 'GET' || req.method === 'HEAD') {
    return sajikanAset(ASET_APLIKASI, { cacheControl: 'no-cache' })(req, res, next);
  }
  return res.status(404).json({ error: 'Alamat tidak ditemukan.' });
});

// eslint-disable-next-line no-unused-vars -- Express mengenali error handler dari 4 argumen
app.use((err, req, res, next) => {
  log.error('server', 'permintaan gagal', { jalur: req.path, metode: req.method, sebab: err?.message ?? String(err) });
  if (res.headersSent) return res.end();
  /*
   * Galat dari parser tubuh (body-parser) membawa status HTTP sendiri —
   * payload 413 terlalu besar, payload 400 rusak. Menilanya 500 semuanya
   * berarti pemilik usaha yang fotonya kebesaran diberi tahu "server rusak",
   * padahal servernya sehat dan yang perlu dilakukan hanyalah foto ulang.
   */
  const status = err?.status ?? err?.statusCode ?? 500;
  const pesan = status === 413 ? 'Fotonya kebesaran (maksimal 4 MB). Coba lagi — biasanya kamera ponsel bisa diatur.' : 'Terjadi kesalahan di server.';
  res.status(status).json({ error: pesan });
});

/**
 * Baris "Pengguna" saat start.
 *
 * Jumlah pengguna ikut dicetak dengan sengaja. Di beberapa layanan hosting,
 * berkas yang ditulis aplikasi HILANG setiap kali di-deploy ulang — dan aplikasi
 * ini akan diam-diam mulai dari kosong tanpa satu pun pesan galat. Baris ini
 * membuat kehilangan itu langsung terlihat: kalau kemarin 8 dan hari ini 0,
 * datanya hilang, bukan pesertanya yang berhenti.
 *
 * Kegagalan membacanya ditangani di sini, bukan dibiarkan menjadi penolakan
 * janji yang tidak tertangkap — berkas data yang rusak dulu mematikan proses
 * dengan jejak tumpukan mentah, tepat pada saat pengelola paling perlu membaca
 * petunjuk yang jelas.
 */
async function barisPengguna() {
  try {
    const jumlah = (await store.listUsers()).length;
    return `${jumlah} termuat${jumlah === 0 ? '  <-- kalau seharusnya ada isinya, DATA HILANG. Jangan tambah pengguna baru; pulihkan dari cadangan.' : ''}`;
  } catch (err) {
    return `GAGAL DIBACA — ${err.message}\n                <-- berkas data rusak. JANGAN tambah pengguna baru.\n                    Pulihkan dengan: npm run backup -- list`;
  }
}

/**
 * Memastikan seluruh kode demo 101–120 benar-benar terikat ke akun DEMO.
 *
 * Dua keadaan yang ditangani di sini, keduanya idempoten:
 *
 *   1. Kelima akun persona asli (101–105) masih memegang kode NOVA lama —
 *      kodenya diikat ulang ke angka. Data mereka tidak tersentuh sama
 *      sekali; yang berubah hanya hash kodenya.
 *   2. Kode 106–120 belum punya akun — akun DEMO baru dibuat dan diberi
 *      persona bergiliran. Isi datanya menyusul di hidrasi di bawah,
 *      memakai mekanisme pengisian yang sama dengan akun lama.
 *
 * Langkah ini ADA DI SINI, bukan di users-seed.json, karena penyemaian
 * bawaan hanya berjalan pada basis data yang MASIH KOSONG — basis data
 * produksi yang sudah berisi peserta tidak pernah menyentuh berkas seed
 * itu lagi. Satu-satunya tempat yang pasti jalan di setiap penyalaan,
 * di basis data mana pun, adalah hidrasi boot ini.
 */
async function sediakanAkunDemo() {
  for (let i = 0; i < KODE_DEMO.length; i += 1) {
    const kode = KODE_DEMO[i];
    const pemegang = await store.findByAccessCode(kode);
    if (pemegang?.batch === 'DEMO') continue; // sudah terikat — biarkan
    if (pemegang) continue; // kode bentrok dengan peserta sungguhan: mustahil (format beda), tapi jangan menimpa

    if (i < PERSONA_DEMO.length) {
      // 101–105: akun persona aslinya sudah ada sejak seed — ikat ulang.
      const asli = await store.findUserById(PERSONA_DEMO[i].id);
      if (asli) {
        await store.setAccessCode(asli.id, kode);
        continue;
      }
    }

    const buat = await store.createUser({ name: `Demo ${kode}`, business: '', batch: 'DEMO' });
    await store.setAccessCode(buat.user.id, kode);
    // Persona berputar — ditandai di akunnya supaya pembagian tetap
    // sama di penyalaan berikutnya, bukan tergantung urutan iterasi.
    await store.terapkanDemo(buat.user.id, { demoPersona: i % PERSONA_DEMO.length });
  }
}

/**
 * Mengisi akun-akun demo dan melanjutkan riwayatnya sampai hari ini.
 *
 * Mengembalikan jumlah akun yang siap dipakai. Setiap akun diperiksa
 * persona-nya dari ID — generator menolak menyentuh apa pun yang bukan
 * akun DEMO, jadi peserta penelitian tidak mungkin tertimpa dari sini.
 */
async function pastikanDemoSiap() {
  const hariIni = todayISO();
  await sediakanAkunDemo();
  let siap = 0;
  for (const ringkas of await store.listUsers()) {
    if (ringkas.batch !== 'DEMO') continue;
    const user = await store.findUserById(ringkas.id);
    const persona = personaDemo(user);
    if (!persona) continue;

    /*
     * Benih angka: kelima akun asli memakai ID persona (data lama mereka
     * tidak berubah), akun tambahan memakai ID penggunanya sendiri — kalau
     * tidak, semua warung 106–120 akan punya pembukuan identik.
     */
    const kunci = PERSONA_DEMO.some((p) => p.id === user.id) ? undefined : user.id;

    if (!user.profile) {
      await store.terapkanDemo(user.id, isiDemoPenuh(persona, hariIni, kunci));
    } else {
      const lanjutan = lanjutkanDemo(persona, user, hariIni, kunci);
      if (lanjutan) await store.terapkanDemo(user.id, lanjutan);
    }
    siap += 1;
  }
  return siap;
}

/*
 * Server hanya dinyalakan bila berkas ini memang DIJALANKAN, bukan sekadar
 * diimpor. Tanpa penjagaan ini, satu `import './server.js'` dari berkas uji ikut
 * membuka port dan menahan proses tetap hidup selamanya — uji-nya menggantung
 * tanpa satu pun pesan, dan itulah alasan lapisan HTTP ini tidak pernah teruji.
 */
const dijalankanLangsung =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/**
 * Mematikan server dengan rapi.
 *
 * SIGTERM datang pada setiap deploy ulang, setiap `systemctl restart`, dan
 * setiap kali mesinnya dijadwalkan berhenti. Tanpa penanganan ini, proses mati
 * seketika — memotong permintaan yang sedang berjalan, dan bisa berhenti tepat
 * di antara "peserta menekan simpan" dan "berkas tertulis ke disk". Peserta
 * yakin catatannya tersimpan, dan tidak ada satu pun pesan yang mengatakan
 * sebaliknya.
 *
 * Urutannya: berhenti menerima sambungan baru, biarkan yang sedang berjalan
 * selesai, tunggu antrean penulisan kosong, baru keluar. Ada batas waktu keras
 * supaya satu sambungan yang menggantung tidak menahan proses selamanya —
 * systemd dan Cloud Run sama-sama akan membunuh paksa setelah beberapa detik,
 * jadi lebih baik kita yang berhenti lebih dulu, dengan sadar.
 */
const MATI_BATAS_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 8000;

function pasangPenutupan(server) {
  let sedangTutup = false;

  const tutup = async (sinyal) => {
    if (sedangTutup) return;
    sedangTutup = true;
    log.info('server', 'menerima sinyal berhenti, menutup dengan rapi', { sinyal });

    const paksa = setTimeout(() => {
      log.warn('server', 'batas waktu penutupan tercapai, keluar paksa', { batasMs: MATI_BATAS_MS });
      process.exit(1);
    }, MATI_BATAS_MS);
    paksa.unref();

    try {
      await new Promise((selesai) => server.close(selesai));
      await store.selesaikanPenulisan();
      log.info('server', 'seluruh penulisan selesai, berhenti');
      process.exit(0);
    } catch (err) {
      log.error('server', 'gagal menutup dengan rapi', { sebab: err?.message ?? String(err) });
      process.exit(1);
    }
  };

  for (const sinyal of ['SIGTERM', 'SIGINT']) process.on(sinyal, () => tutup(sinyal));
}

if (dijalankanLangsung) {
  /*
   * Penyimpanan diperiksa SEBELUM port dibuka.
   *
   * Menerima peserta lebih dulu lalu menemukan folder datanya tidak bisa
   * ditulis berarti setiap catatan yang mereka masukkan hari itu hilang, satu
   * per satu, tanpa ada yang menyadarinya sampai berhari-hari kemudian.
   */
  await wajibBisaMenyimpan();

  /*
   * Hidrasi demo juga sebelum port dibuka — dengan alasan yang sama.
   *
   * Iklan yang menjanjikan "coba tanpa kode" dan rute yang menjawab 503
   * "akun demo belum siap" adalah dua janji yang saling meniadakan; juri
   * kontes yang datang lebih cepat dari pengisian data adalah kegagalan
   * demo yang paling murah dicegah: tunggu sebentar sebelum menyala.
   *
   * Kegagalan mengisi TIDAK mematikan server — peserta penelitian tidak
   * boleh terhalang oleh masalah akun demo. Akun demo yang gagal diisi
   * terlihat dari log dan dari /api/demo yang menjawab 503.
   */
  try {
    const siap = await pastikanDemoSiap();
    if (siap > 0) console.log(`  Demo        : ${siap} akun terisi (masuk tanpa kode aktif di /api/demo)`);
  } catch (err) {
    log.error('demo', 'gagal mengisi akun demo — rute /api/demo mungkin menjawab 503', { sebab: err?.message ?? String(err) });
  }
}

if (dijalankanLangsung) {
  const server = app.listen(PORT, () => {
  console.log(`\n  Novaro berjalan di http://localhost:${PORT}`);
  console.log(`  Model AI    : ${modelAktif()}`);
  console.log(
    backendAI() === 'anthropic'
      ? `  Layanan AI  : Anthropic langsung — kunci ${isConfigured() ? 'terpasang' : 'BELUM DIATUR, fitur AI nonaktif'}`
      : `  Layanan AI  : ${backendAI() === 'gemini' ? 'Gemini' : 'Claude'} di Vertex AI (project ${process.env.GOOGLE_CLOUD_PROJECT}, region ${process.env.CLOUD_ML_REGION || 'global'})`,
  );
  console.log(`  Batas AI    : ${RATE_LIMIT} permintaan/jam per pengguna`);
  console.log(`  Data        : ${JENIS_PENYIMPANAN === 'json' ? store.DB_PATH : `${JENIS_PENYIMPANAN} (persisten)`}`);

  // Cadangan dinyalakan lebih dulu: kalau pembacaan data gagal, justru itulah
  // saat pencadangan paling tidak boleh ikut batal.
  scheduleBackups();

  barisPengguna().then((baris) => {
    console.log(`  Pengguna    : ${baris}`);
    console.log(`  Cadangan    : otomatis tiap 24 jam (npm run backup -- list)`);
    console.log(`  HTTPS       : ${process.env.FORCE_HTTPS === '1' ? 'dipaksakan' : 'TIDAK dipaksakan (set FORCE_HTTPS=1 di produksi)'}`);
    console.log(`  Trust proxy : ${process.env.TRUST_PROXY ? 'ya' : 'tidak (set TRUST_PROXY=1 bila di belakang Nginx)'}`);
    console.log(`  Log         : ${log.jsonMode() ? 'JSON (siap untuk Cloud Logging)' : 'teks (set LOG_FORMAT=json di produksi)'}`);
    if (process.env.FORCE_HTTPS === '1' && !punyaPublicHost()) {
      console.log(`  Alamat      : PUBLIC_HOST belum diatur — sebaiknya diisi agar pengalihan HTTPS tidak mengikuti header Host dari klien.`);
    }
    console.log(`\n  Tambah pengguna: npm run users -- add "Nama" "Nama Usaha"\n`);
  });
  });

  pasangPenutupan(server);
}

export default app;
// Diuji lewat test/demo.test.js — hidrasi adalah bagian yang menentukan
// apakah /api/demo bisa menjawab 200, jadi jalurnya sendiri ikut diuji.
export { pastikanDemoSiap };
