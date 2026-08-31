/**
 * Uji pembatalan panggilan AI.
 *
 * Berkas TERSENDIRI, dan itu disengaja: `lib/claude.js` menyimpan klien
 * Anthropic-nya di tingkat modul (`let client`), sehingga alamat layanan yang
 * dipakai terkunci pada panggilan PERTAMA di dalam satu proses. Uji yang
 * ditumpangkan ke berkas lain akan diam-diam berbicara ke server tiruan milik
 * uji sebelumnya — lalu lulus tanpa pernah menguji apa pun.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-batal-uji-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { store } = await import('../lib/store.js');
const { CONSENT_VERSION } = await import('../lib/consent.js');
const app = (await import('../server.js')).default;

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const { accessCode } = await store.createUser({ name: 'Bu Sari', business: 'Warung Bu Sari' });

const minta = (jalur, { kode, ...opts } = {}) =>
  fetch(BASE + jalur, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(kode ? { Authorization: `Bearer ${kode}` } : {}),
      ...(opts.headers ?? {}),
    },
  });

test('menutup aplikasi saat menunggu rekomendasi ikut menghentikan panggilan AI', async () => {
  /*
   * Rute chat sudah membatalkan panggilannya saat peserta pergi; rute
   * rekomendasi dulu tidak — padahal justru di sinilah jatahnya paling besar
   * (`max_tokens: 32000` dengan penalaran adaptif) dan waktunya paling lama.
   * Peserta yang menutup peramban tetap membayar penyusunan yang tidak akan
   * pernah dia lihat, dan biayanya bahkan tidak tercatat di jejak tokennya
   * karena `recordUsage` tidak pernah sempat jalan.
   *
   * Diuji sampai ke HULU: layanan AI tiruan mencatat kapan sambungan dari
   * server ini benar-benar tertutup. Memeriksa status HTTP saja tidak
   * membuktikan apa pun — permintaan yang dibatalkan memang tidak menghasilkan
   * jawaban, entah panggilan hulunya berhenti atau terus berjalan.
   */
  let hulunyaDihubungi = false;
  let hulunyaDitutup = false;

  const palsu = createServer((req, res) => {
    hulunyaDihubungi = true;
    req.on('data', () => {});
    // Sengaja tidak pernah menjawab: meniru penyusunan yang masih berjalan.
    res.on('close', () => {
      hulunyaDitutup = true;
    });
  });
  await new Promise((r) => palsu.listen(0, r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${palsu.address().port}`;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-uji';

  try {
    await minta('/api/consent', {
      kode: accessCode, method: 'POST', body: JSON.stringify({ versi: CONSENT_VERSION }),
    });
    const profil = await minta('/api/profile', {
      kode: accessCode, method: 'PUT',
      body: JSON.stringify({
        namaUsaha: 'Warung Uji', jenisUsaha: 'kuliner', pencatatan: 'buku',
        tujuan: 'ajukan-kur', omzetBulanan: 27000000,
      }),
    });
    assert.equal(profil.status, 200, 'profil wajib tersimpan — tanpa profil rutenya menolak sebelum memanggil AI');

    const batal = new AbortController();
    const permintaan = fetch(`${BASE}/api/recommendations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessCode}` },
      signal: batal.signal,
    }).catch(() => null);

    const tunggu = async (cek) => {
      for (let i = 0; i < 150 && !cek(); i++) await new Promise((r) => setTimeout(r, 20));
    };

    await tunggu(() => hulunyaDihubungi);
    assert.ok(hulunyaDihubungi, 'layanan AI tiruan tidak pernah dihubungi — ujinya tidak menguji apa pun');

    batal.abort(); // peserta menutup aplikasi
    await permintaan;

    await tunggu(() => hulunyaDitutup);
    assert.ok(
      hulunyaDitutup,
      'peserta sudah pergi tapi panggilan ke layanan AI masih berjalan — tokennya tetap ditagih',
    );
  } finally {
    palsu.close();
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_API_KEY;
  }
});
