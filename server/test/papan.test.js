/**
 * Uji rute /api/papan (Papan Kemajuan).
 *
 * Yang paling dijaga rute ini bukan angkanya, tapi SIAPA yang boleh tampil:
 * hanya akun batch DEMO. Uji di bawah membuat peserta sungguhan (batch B1)
 * berdampingan dengan dua akun demo dan memastikan peserta itu tidak pernah
 * muncul — dan bahwa peminta demo tetap menemukan barisnya sendiri, sementara
 * peminta peserta melihat papan yang sama tanpa baris.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-papan-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
process.env.NOVA_AI_BACKEND = 'anthropic';
process.env.ANTHROPIC_API_KEY = '';
delete process.env.GOOGLE_CLOUD_PROJECT;
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { store } = await import('../lib/store.js');
const app = (await import('../server.js')).default;

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

/* ------------------------------------------------- Peranti akun & kas */

const PROFIL_A = {
  namaUsaha: 'Warung Uji A', jenisUsaha: 'kuliner', lokasi: 'Semarang',
  lamaUsahaBulan: 36, jumlahKaryawan: 1, produkUtama: 'Nasi rames',
  omzetBulanan: 10_000_000, belanjaBulanan: 4_000_000, biayaOperasional: 1_000_000,
  cicilanBulanan: 0, pencatatan: 'aplikasi', rekeningTerpisah: true, punyaNib: true,
  tujuan: 'naikkan-laba', tantangan: '',
};
const PROFIL_B = {
  namaUsaha: 'Warung Uji B', jenisUsaha: 'retail', lokasi: 'Semarang',
  lamaUsahaBulan: 6, jumlahKaryawan: 0, produkUtama: 'Sembako',
  omzetBulanan: 10_000_000, belanjaBulanan: 8_500_000, biayaOperasional: 1_500_000,
  cicilanBulanan: 2_000_000, pencatatan: 'kadang', rekeningTerpisah: false, punyaNib: false,
  tujuan: 'rapikan-keuangan', tantangan: '',
};
const PROFIL_PESERTA = {
  ...PROFIL_A,
  namaUsaha: 'Toko Peserta Sungguhan',
};

const hariIni = new Date();
const isoDari = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const bulanLaluISO = (() => {
  const t = new Date(hariIni.getFullYear(), hariIni.getMonth() - 1, 20);
  return isoDari(t.getFullYear(), t.getMonth() + 1, 20);
})();
const bulanIniISO = isoDari(hariIni.getFullYear(), hariIni.getMonth() + 1, 1);

const buatAkun = async (nama, batch, profil, denganRiwayat) => {
  const { user, accessCode } = await store.createUser({ name: nama, business: profil.namaUsaha, batch });
  await store.saveProfile(user.id, profil);
  if (denganRiwayat) {
    // Dua bulan tercatat — cukup untuk titik delta di garis waktunya.
    await store.addTransaction(user.id, { tanggal: bulanLaluISO, jenis: 'masuk', kategori: 'penjualan', keterangan: 'Penjualan bulan lalu', jumlah: 8_000_000 }, { aktor: 'manusia' });
    await store.addTransaction(user.id, { tanggal: bulanLaluISO, jenis: 'keluar', kategori: 'belanja-bahan', keterangan: 'Bahan bulan lalu', jumlah: 3_000_000 }, { aktor: 'manusia' });
    await store.addTransaction(user.id, { tanggal: bulanIniISO, jenis: 'masuk', kategori: 'penjualan', keterangan: 'Penjualan bulan ini', jumlah: 2_000_000 }, { aktor: 'manusia' });
  }
  return { user, accessCode };
};

const demoA = await buatAkun('Demo A', 'DEMO', PROFIL_A, true);
const demoB = await buatAkun('Demo B', 'DEMO', PROFIL_B, false);
const peserta = await buatAkun('Peserta', 'B1', PROFIL_PESERTA, true);

const minta = (kode) =>
  fetch(BASE + '/api/papan', { headers: { Authorization: `Bearer ${kode}` } });

/* ============================================================ Pagarnya */

test('tanpa kode akses: 401', async () => {
  const res = await fetch(BASE + '/api/papan');
  assert.equal(res.status, 401);
});

/* ========================================================= Siapa tampil */

test('hanya akun DEMO yang tampil — peserta sungguhan tidak pernah muncul', async () => {
  const res = await minta(peserta.accessCode);
  assert.equal(res.status, 200);
  const data = await res.json();

  const nama = data.baris.map((b) => b.nama);
  assert.ok(nama.includes('Warung Uji A'), 'akun demo harus tampil');
  assert.ok(nama.includes('Warung Uji B'), 'akun demo kedua harus tampil');
  assert.equal(
    nama.includes('Toko Peserta Sungguhan'), false,
    'peserta penelitian tidak boleh tampil di papan',
  );
  // Peminta peserta: melihat papan yang sama tanpa pernah punya baris di dalamnya.
  assert.equal(data.aku, null);
});

test('terurut skor menurun dan peringkatnya berurutan', async () => {
  const data = await (await minta(peserta.accessCode)).json();
  for (let i = 0; i < data.baris.length; i += 1) {
    assert.equal(data.baris[i].peringkat, i + 1);
    if (i > 0) assert.ok(data.baris[i - 1].skor >= data.baris[i].skor);
  }
});

test('peminta demo menemukan barisnya sendiri lewat `aku`', async () => {
  const data = await (await minta(demoA.accessCode)).json();
  const barisA = data.baris.find((b) => b.nama === 'Warung Uji A');
  assert.ok(barisA, 'barisnya harus ada');
  assert.equal(data.aku, barisA.peringkat);
});

test('delta hanya untuk akun dengan dua bulan catatan; medan baris di daftar putih', async () => {
  const data = await (await minta(demoA.accessCode)).json();
  const barisA = data.baris.find((b) => b.nama === 'Warung Uji A');
  const barisB = data.baris.find((b) => b.nama === 'Warung Uji B');

  assert.equal(typeof barisA.delta, 'number', 'dua bulan tercatat → arah skor ada');
  assert.equal(barisB.delta, null, 'tanpa riwayat cukup → tidak dikarang');

  for (const b of data.baris) {
    assert.deepEqual(Object.keys(b).sort(),
      ['delta', 'hariTercatat', 'jenis', 'nama', 'omzet', 'peringkat', 'skor'],
      'satu-satunya medan yang boleh keluar adalah yang ada di daftar putih rute');
  }
});
