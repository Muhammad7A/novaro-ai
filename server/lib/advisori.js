/**
 * Rekam advisori — memori nasihat yang append-only.
 *
 * ------------------------------------------------------------------
 * KENAPA BERKAS INI ADA
 *
 * Hari ini nasihat aplikasi ini menguap: `user.recommendations` adalah SATU
 * slot yang ditimpa setiap kali penyusunan baru selesai, chat terbuang pada
 * 60 giliran, dan hasil check-up tidak pernah meninggalkan layar. Tidak ada
 * catatan tentang apa yang pernah disarankan, atas angka yang mana, dan
 * apakah nasihatnya kejadian. Tanpa memori itu tidak ada akuntabilitas
 * nasihat — dan tanpa akuntabilitas, lapisan AI ini tidak pernah menjadi
 * lebih pintar dari saran hari ini. (Sesi G, Path B: memori advisori.)
 *
 * Rekam advisori BUKAN slot baru dan BUKAN jalur tulis uang: ia riwayat
 * append-only dari keluaran sanitizer yang SAMA dengan yang sudah dipakai
 * rute. Angka-angka usaha tetap milik kernel; yang disimpan di sini hanya
 * nasihatnya dan SIDIK angka yang menjadi dasarnya — bukan salinan angkanya.
 *
 * ------------------------------------------------------------------
 * ATURAN MAIN
 *
 *   - APPEND-ONLY: rekam tidak pernah diedit. Status "kedaluwarsa" atau
 *     "digantikan" adalah TURUNAN saat dibaca, bukan medan yang diubah —
 *     tanpa mesin keadaan, tanpa sapuan (disiplin yang sama dengan penolakan
 *     Stored-FinancialState di FINANCIAL-DATA-MODEL).
 *   - TRIM TERTIB: kap per jenis (MAKS_PER_JENIS), yang tertua dibuang saat
 *     menulis yang baru. Tanpa trim, toko satu-berkas ini menanggung utang
 *     byte yang menagih tepat saat program berhasil — aturan berhenti-berlayar
 *     lama: array persisten baru WAJIB punya kebijakan pangkas.
 *   - DASAR ANGKA ADALAH SIDIK, bukan salinan: hash kanonik atas profil dan
 *     baris transaksi saat nasihat disusun. Angkanya selalu bisa dihitung
 *     ulang oleh kernel yang murni; yang disimpan cukup untuk MEMBUKTIKAN
 *     state mana yang dilihat penasihat saat itu.
 *   - PROVENANSI WARISAN SESI D: `sumber` dari kosakata tertutup, `model`
 *     hanya ikut bila pemanggil benar-benar tahu — tidak pernah dikarang.
 *   - evaluasiAdvisori MURNI dan gagal-aman: satu-satunya metode hari ini
 *     adalah komparasi bulan (komparsi-bulan) atas keluaran kernel; apa pun
 *     yang kurang (bulan belum lengkap, bulan dasar tak ada) jatuh ke
 *     `tak-terukur` — bukan tebakan yang berpura-pura yakin.
 */
import { createHash, randomBytes } from 'node:crypto';

import { tanggalWIB } from './cashbook.js';

/** Kosakata tertutup jenis advisori. Menambah jenis = keputusan yang disadari, bukan string baru. */
export const JENIS_ADVISORI = ['rekomendasi', 'checkup'];

/** Asal keluaran — kosakata yang sama dengan stempel provenansi Sesi D. */
export const SUMBER_ADVISORI = ['ai', 'sistem'];

/**
 * Kap riwayat per jenis. 24 nasihat ≈ dua tahun saran bulanan untuk satu
 * jenis — riwayat yang cukup untuk menjawab "apa yang pernah disarankan",
 * dengan jejak byte yang terbatas di depan (toko satu-berkas menulis ulang
 * seluruh berkas pada tiap flush).
 */
export const MAKS_PER_JENIS = 24;

/**
 * Umur berlaku nasihat, dalam hari — disiplin yang sama dengan jendela
 * peringatan fokus harian (UMUR_MAKS_PERINGATAN_HARI): nasihat tanpa tanggal
 * yang bisa dipercaya tidak boleh tampil segar, dan nasihat yang lewat jendela
 * tidak boleh dihitung sebagai pembanding.
 */
export const UMUR_BERLAKU_HARI = 30;

/**
 * Stempel skema fitur (M1-lite): nama fitur dibekukan di satu tabel yang
 * ditinjau, versi naik saat bentuknya berubah. Stempel ini metadata riset —
 * TIDAK PERNAH menjadi penentu perilaku (jalur baca memutuskan dari medan
 * baris, bukan dari stempel; disiplin FINANCIAL-DATA-MODEL §1.4).
 */
export const VERSI_FITUR_ADVISORI = 1;

/**
 * Merakit satu rekam advisori dari keluaran sanitizer.
 *
 * `isi` adalah keluaran sanitizer PERSIS — bukan slot berstempel: stempel
 * (dibuat/sumber/model) hidup di kepala rekam, sekali, bukan disalin ke dalam
 * isi. Pemeriksaan di sini sengaja tipis: kontrak bentuk adalah milik
 * sanitizer; merekam bukan pembersih kedua (pembersih kedua adalah dua kontrak
 * yang bisa saling menyalahkan).
 *
 * @param {{
 *   jenis: 'rekomendasi'|'checkup',
 *   isi: object,
 *   sumber?: 'ai'|'sistem',
 *   model?: string|null,
 *   dasarAngka: {bulan: string, hash: string},
 *   kini?: Date,
 * }} masukan
 */
export function buatAdvisori({ jenis, isi, sumber = 'ai', model = null, dasarAngka, kini = new Date() }) {
  if (!JENIS_ADVISORI.includes(jenis)) {
    throw new Error(`jenis advisori tidak dikenal: ${jenis}`);
  }
  if (!SUMBER_ADVISORI.includes(sumber)) {
    throw new Error(`sumber advisori tidak dikenal: ${sumber}`);
  }
  if (!isi || typeof isi !== 'object' || Array.isArray(isi)) {
    throw new Error('isi advisori wajib obyek keluaran sanitizer.');
  }
  if (!dasarAngka || typeof dasarAngka.bulan !== 'string' || typeof dasarAngka.hash !== 'string') {
    throw new Error('advisori tanpa sidik dasar angka tidak boleh direkam.');
  }

  const waktu = kini instanceof Date ? kini : new Date(kini);
  return {
    id: `adv_${randomBytes(6).toString('hex')}`,
    jenis,
    dibuat: waktu.toISOString(),
    // Model dicatat HANYA bila pemanggil benar-benar tahu; kekosongan berarti
    // "belum ada pencatatan identitas", bukan versi karangan.
    ...(model ? { model: String(model) } : {}),
    sumber,
    dasarAngka,
    isi,
    berlakuHingga: new Date(waktu.getTime() + UMUR_BERLAKU_HARI * 86_400_000).toISOString(),
  };
}

/**
 * Sidik dasar angka saat nasihat disusun: bulan WIB + hash kanonik atas
 * profil dan baris transaksi. Chat, jejak, dan rekomendasi lama sengaja
 * tidak ikut — yang membentuk angka adalah profil dan buku kas saja, dan
 * itulah yang bisa dihitung ulang kernel.
 */
export function digestDasarAngka(user, kini = new Date()) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ profil: user.profile ?? null, transaksi: user.transactions ?? [] }));
  return {
    bulan: tanggalWIB(kini).slice(0, 7),
    hash: `sha256:${hash.digest('hex')}`,
  };
}

/**
 * Memangkas daftar advisori: per jenis, sisakan MAKS_PER_JENIS yang TERBARU.
 * Urutan relatif sisanya dipertahankan (terlama dulu) supaya riwayat tetap
 * terbaca seperti pembukuan, dan yang dibuang selalu yang tertua — bukan yang
 * kebetulan di depan.
 *
 * @returns {Array} daftar baru yang sudah dipangkas — masukan tidak diubah.
 */
export function pangkasAdvisori(daftar, maksPerJenis = MAKS_PER_JENIS) {
  const hitung = {};
  const sisanya = [];
  for (let i = daftar.length - 1; i >= 0; i--) {
    const rekam = daftar[i];
    const kunci = rekam?.jenis ?? '?';
    hitung[kunci] = (hitung[kunci] ?? 0) + 1;
    if (hitung[kunci] <= maksPerJenis) sisanya.push(rekam);
  }
  return sisanya.reverse();
}

/**
 * Bulan kalender berikutnya ('2026-08' → '2026-09', '2026-12' → '2027-01'),
 * atau null bila bentuknya bukan YYYY-MM. UTC sengaja: ini aritmetika bulan
 * kalender, bukan jam dinding WIB.
 */
function bulanBerikut(bulan) {
  const cocok = /^(\d{4})-(\d{2})$/.exec(String(bulan ?? ''));
  if (!cocok) return null;
  const d = new Date(Date.UTC(Number(cocok[1]), Number(cocok[2]) - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 7);
}

/**
 * Nilai hasil penilaian satu advisori — MURNI, tanpa rute, tanpa penulisan.
 *
 * Metode v1: `komparsi-bulan`. Bulan periksa adalah PERSIS bulan sesudah bulan
 * dasar: jendela berlaku 30 hari menutup paling jauh bulan berikutnya, jadi
 * pembanding yang lebih jauh adalah atribusi yang sudah tidak jujur. Kedua
 * bulan wajib `bulanLengkap: true` dari kernel — membandingkan sebagian bulan
 * dengan bulan penuh adalah persis dusta `setara` yang sudah pernah ditutup.
 *
 * Arah per dimensi memakai angka kernel apa adanya: naik = membaik untuk
 * laba bersih, margin, dan saldo kas (semuanya semakin besar semakin baik).
 * TIDAK ada ambang baru — arah sebuah angka bukan rumus baru. Atribusi per
 * butir saran sengaja `tak-terukur` di v1: butiran adalah nasihat berbentuk
 * teks, dan peta modul→dimensi yang membuatnya terukur adalah kerja fase 2.
 *
 * @param {object} advisori rekam advisori (memakai dasarAngka.bulan dan isi)
 * @param {object} metricsKini peta bulan → keluaran computeMetrics
 *   (minimal {labaBersih, marginBersih, saldoKas, bulanLengkap}) — PEMANGGIL
 *   yang wajib mengisi dari kernel; fungsi ini tidak pernah menghitung angka.
 * @param {{kini?: Date}} opts jam untuk dinilaiAt (selalu parameter — konvensi kas)
 * @returns {object} evaluasi {status: 'terukur'|'tak-terukur', ...}
 */
export function evaluasiAdvisori(advisori, metricsKini, { kini = new Date() } = {}) {
  const dasar = {
    advisoriId: advisori?.id ?? null,
    jenis: advisori?.jenis ?? null,
    dinilaiAt: kini.toISOString(),
    metode: 'komparsi-bulan',
  };
  const takTerukur = (sebab) => ({ ...dasar, status: 'tak-terukur', sebab });

  if (advisori?.jenis !== 'rekomendasi') {
    return takTerukur('jenis ini belum punya metode penilaian bulanan');
  }
  const bulanDasar = advisori?.dasarAngka?.bulan;
  if (!bulanDasar) return takTerukur('bulan dasar tidak tercatat');
  const bulanCek = bulanBerikut(bulanDasar);
  if (!bulanCek) return takTerukur('bulan dasar tidak sah');

  const mDasar = metricsKini?.[bulanDasar];
  const mCek = metricsKini?.[bulanCek];
  if (!mDasar || !mCek) {
    return takTerukur('angka bulan saran atau bulan periksa belum tersedia');
  }
  if (mDasar.bulanLengkap !== true || mCek.bulanLengkap !== true) {
    return takTerukur('ada bulan yang belum lengkap — sebagian bulan tidak dibandingkan');
  }

  const dimensi = {};
  for (const nama of ['labaBersih', 'marginBersih', 'saldoKas']) {
    const angkaDasar = Number(mDasar[nama]);
    const angkaKini = Number(mCek[nama]);
    if (!Number.isFinite(angkaDasar) || !Number.isFinite(angkaKini)) {
      dimensi[nama] = { status: 'tak-terukur' };
      continue;
    }
    dimensi[nama] = {
      dasar: angkaDasar,
      kini: angkaKini,
      status: angkaKini > angkaDasar ? 'membaik' : angkaKini < angkaDasar ? 'memburuk' : 'tetap',
    };
  }

  return {
    ...dasar,
    status: 'terukur',
    bulanDasar,
    bulanCek,
    dimensi,
    perItem: (advisori.isi?.rekomendasi ?? []).map((_, indeks) => ({
      indeks,
      status: 'tak-terukur',
    })),
  };
}
