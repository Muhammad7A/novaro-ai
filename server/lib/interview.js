/**
 * Klien sidecar interviu — kontrak SIDECAR INTERVIEW API v1.
 *
 * ------------------------------------------------------------------
 * STATUS KONTRAK (jujur, dibaca sebelum menimbang apa pun)
 *
 * Blok "SIDECAR INTERVIEW API v1" yang dimaksud misi W1 fase 1–2 tidak
 * ikut dalam teks misi yang diterima dan tidak ada di dokumen repo
 * (ENTERPRISE-OVERHAUL-PLAN.md hanya MENAMAI fase kontrak). Maka kontrak
 * v1 ini ditulis DI SINI sebagai satu-sumber — dibatasi persis pada yang
 * misi tetapkan (env, timeout 10 dtk, kegagalan bertipe, intakeId +
 * jumlahDiscrepancy + coverage). Bila blok milik owner berbeda, inilah
 * satu berkas yang direkonsiliasi — klien dan uji menunduk kepadanya.
 *
 * ------------------------------------------------------------------
 * SIDECAR INTERVIEW API v1 (satu-sumber: berkas ini)
 *
 *   POST {URL}/v1/intakes
 *     Authorization : Bearer <NOVA_INTERVIEW_SECRET>
 *     body          : { profil: <obyek profil usaha>, metrik: <digest angka kernel> }
 *     200           : { intakeId: 'int_[0-9a-f]{12}', jumlahDiscrepancy: <int>,
 *                       pertanyaan: <string> }
 *
 *   POST {URL}/v1/intakes/{intakeId}/turns
 *     Authorization : sama
 *     body          : { jawaban: <string> } — teks bebas DITERUSKAN, tidak
 *                     pernah tersimpan di sisi Novaro
 *     200           : { pertanyaan: <string|null>, selesai: <bool>,
 *                       coverage: <angka 0..1>, jumlahDiscrepancy?: <int> }
 *       selesai=true  → pertanyaan null, coverage final.
 *
 *   Kegagalan BERTIPE (satu percobaan — TANPA retry; spambul menagih mahal
 *   dan kegagalan yang jujur lebih berguna daripada ulangan diam-diam):
 *     sidecar-mati   → sambungan gagal / timeout / bentuk jawaban bukan JSON
 *     auth-gagal     → 401/403 dari sidecar (rahasia salah/belum dipasang)
 *     payload-rusak  → 200 tapi bentuknya melanggar kontrak di atas
 *
 * ------------------------------------------------------------------
 * GERBANG (fail-closed)
 *
 *   NOVA_INTERVIEW_SIDECAR_URL kosong → sidecarTersedia()=false → fitur OFF
 *   di rute mana pun, tanpa satu pun panggilan. Rahasia dari
 *   NOVA_INTERVIEW_SECRET; dikirim HANYA ke sidecar, tidak pernah direkam.
 */
export const TIMEOUT_MS = Number(process.env.NOVA_INTERVIEW_TIMEOUT_MS) || 10_000;
export const BATAS_JAWABAN = 2000; // teks bebas di relay — dipotong, bukan ditolak

/** Id intake bentuk kontrak — divalidasi sebelum dipakai menyusun URL. */
const POLA_INTAKE_ID = /^int_[0-9a-f]{12}$/;

/**
 * Gerbang fitur: sidecar TERKONFIGURASI. Ini kejujuran konfigurasi ('on' =
 * ada URL untuk dipanggil), bukan janji sidecar hidup — kegagalan panggilan
 * tetap terjadi saat runtime dan ditanggung sebagai kegagalan bertipe.
 */
export function sidecarTersedia() {
  return Boolean((process.env.NOVA_INTERVIEW_SIDECAR_URL ?? '').trim());
}

function konfigurasi() {
  const url = (process.env.NOVA_INTERVIEW_SIDECAR_URL ?? '').trim().replace(/\/+$/, '');
  const rahasia = (process.env.NOVA_INTERVIEW_SECRET ?? '').trim();
  if (!url) {
    const err = new Error('Sidecar interviu belum dikonfigurasi.');
    err.kode = 'sidecar-mati';
    err.status = 503;
    throw err;
  }
  if (!rahasia) {
    const err = new Error('Rahasia sidecar interviu belum dipasang.');
    err.kode = 'auth-gagal';
    err.status = 502;
    throw err;
  }
  return { url, rahasia };
}

const galat = (kode, status, pesan) => {
  const e = new Error(pesan);
  e.kode = kode;
  e.status = status;
  return e;
};

/**
 * Satu panggilan ke sidecar — tanpa retry. Menerjemahkan semua kegagalan ke
 * tiga tipe kontrak; yang lain tidak boleh bocor ke pemanggil.
 */
async function panggil(jalur, tubuh) {
  const { url, rahasia } = konfigurasi();
  const kontrol = new AbortController();
  const pengatur = setTimeout(() => kontrol.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${url}${jalur}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rahasia}`,
      },
      body: JSON.stringify(tubuh),
      signal: kontrol.signal,
    });
  } catch {
    return Promise.reject(galat('sidecar-mati', 503, 'Sidecar interviu tidak dapat dihubungi.'));
  } finally {
    clearTimeout(pengatur);
  }

  if (res.status === 401 || res.status === 403) {
    return Promise.reject(galat('auth-gagal', 502, 'Sidecar interviu menolak kredensial server ini.'));
  }
  if (!res.ok) {
    return Promise.reject(galat('sidecar-mati', 503, `Sidecar interviu menjawab status ${res.status}.`));
  }

  let isi;
  try {
    isi = await res.json();
  } catch {
    return Promise.reject(galat('payload-rusak', 502, 'Jawaban sidecar interviu bukan JSON yang sah.'));
  }
  return isi;
}

const sahInt = (v, maks = 1_000_000) => Number.isInteger(v) && v >= 0 && v <= maks;
const sahCoverage = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/**
 * Memulai intake: kirim profil + digest metrik (angka dari kernel — bukan
 * teks bebas peserta), terima id + hitungan discrepancy awal + pertanyaan
 * pembuka. Payload kontrak diverifikasi ulang DI SINI — janji jaringan
 * bukan pemeriksaan server (disiplin sanitizer yang sama dengan jalur AI).
 */
export async function mulaiInterviu({ profil, metrik }) {
  const isi = await panggil('/v1/intakes', { profil: profil ?? null, metrik: metrik ?? null });
  if (
    !isi || typeof isi !== 'object' ||
    !POLA_INTAKE_ID.test(String(isi.intakeId ?? '')) ||
    !sahInt(isi.jumlahDiscrepancy) ||
    typeof isi.pertanyaan !== 'string' || !isi.pertanyaan.trim()
  ) {
    throw galat('payload-rusak', 502, 'Jawaban pembuka sidecar tidak lengkap sesuai kontrak.');
  }
  return { intakeId: isi.intakeId, jumlahDiscrepancy: isi.jumlahDiscrepancy, pertanyaan: isi.pertanyaan };
}

/**
 * Satu giliran jawaban. `jawaban` teks bebas peserta — diteruskan apa adanya
 * (dipotong batas), TIDAK PERNAH kembali sebagai sesuatu yang tersimpan.
 * `selesai=true` menutup intake: pertanyaan null, coverage final.
 */
export async function kirimJawaban({ intakeId, jawaban }) {
  if (!POLA_INTAKE_ID.test(String(intakeId ?? ''))) {
    throw galat('payload-rusak', 502, 'Id interviu tidak dikenali.');
  }
  const isi = await panggil(`/v1/intakes/${intakeId}/turns`, { jawaban: String(jawaban ?? '').slice(0, BATAS_JAWABAN) });
  if (
    !isi || typeof isi !== 'object' ||
    typeof isi.selesai !== 'boolean' ||
    !sahCoverage(isi.coverage) ||
    (isi.selesai ? isi.pertanyaan !== null : typeof isi.pertanyaan !== 'string' || !isi.pertanyaan.trim())
  ) {
    throw galat('payload-rusak', 502, 'Jawaban giliran sidecar tidak lengkap sesuai kontrak.');
  }
  const hasil = { pertanyaan: isi.pertanyaan, selesai: isi.selesai, coverage: isi.coverage };
  // Hitungan discrepancy akhir ikut bila sidecar mengirimnya di giliran
  // terakhir — opsional per kontrak; yang salah bentuk tidak dipercaya.
  if (isi.jumlahDiscrepancy !== undefined) {
    if (!sahInt(isi.jumlahDiscrepancy)) {
      throw galat('payload-rusak', 502, 'Hitungan discrepancy akhir tidak sah.');
    }
    hasil.jumlahDiscrepancy = isi.jumlahDiscrepancy;
  }
  return hasil;
}
