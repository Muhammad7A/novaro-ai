/**
 * Uji penyimpanan: pemilihan backend, syarat produksi, dan adapter Mongo.
 *
 * Tiga hal yang paling dijaga:
 *   - prioritas backend eksplisit (DATABASE_URL > MONGO_URI > json) dan
 *     semua nama env Mongo yang lazim dikenali;
 *   - fail-closed produksi: NOVA_REQUIRE_PERSISTENT_STORE=1 tanpa backend
 *     persisten MENOLAK MENYALA — bukan diam-diam memakai berkas fana;
 *   - semantik adapter Mongo: upsert semua + hapus yang tidak ada, sehingga
 *     deleteUser sungguh menghapus (penghapusan menjalar), taburan dari
 *     berkas hanya saat koleksi kosong, dan dokumen rusak dibuang tanpa
 *     menyembunyikan pengguna lain.
 *
 * Adapter diuji dengan koleksi PALSU di memori — semantik yang sama dengan
 * driver sungguhan untuk operasi yang dipakai (find/bulkWrite/deleteMany),
 * tanpa server Mongo di mesin uji.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nova-uji-simpan-'));
process.env.NOVA_DATA_DIR = DATA_DIR;
process.env.PORT = '0';
// Tanpa DATABASE_URL/MONGO_URI: jalur json aktif — kondisi uji yang diinginkan.
delete process.env.DATABASE_URL;
delete process.env.MONGO_URI;
delete process.env.MONGODB_URI;
delete process.env.MONGO_URL;
delete process.env.MONGODB_URL;
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

const { pilihPenyimpanan } = await import('../lib/db.js');
const { cekSyaratProduksi, periksaPenyimpanan } = await import('../lib/kesehatan.js');
const { docDariUser, userDariDoc, muatSemua, simpanSemua, muatAtauSeed, pastikanJalurMongo } =
  await import('../lib/mongo-store.js');

/* ============================================== Seleksi backend (murni) */

test('prioritas: DATABASE_URL menang, lalu Mongo, lalu json', () => {
  assert.equal(pilihPenyimpanan({}), 'json');
  assert.equal(pilihPenyimpanan({ DATABASE_URL: 'postgres://x' }), 'postgres');
  assert.equal(pilihPenyimpanan({ MONGO_URI: 'mongodb://x' }), 'mongo');
  assert.equal(pilihPenyimpanan({ DATABASE_URL: 'postgres://x', MONGO_URI: 'mongodb://x' }), 'postgres');
});

test('NOVA_STORAGE eksplisit menang atas injeksi platform (MONGO_URL otomatis)', () => {
  assert.equal(
    pilihPenyimpanan({ NOVA_STORAGE: 'json', MONGO_URL: 'mongodb://dari-platform' }),
    'json',
    'penghapus env di .env tidak cukup saat platform menyuntik MONGO_URL — override ini jalurnya',
  );
  assert.equal(pilihPenyimpanan({ NOVA_STORAGE: 'mongo', DATABASE_URL: 'postgres://x' }), 'mongo');
  assert.equal(pilihPenyimpanan({ NOVA_STORAGE: 'postgres', MONGO_URI: 'mongodb://x' }), 'postgres');
  assert.equal(pilihPenyimpanan({ NOVA_STORAGE: 'JSON' }), 'json', 'huruf besar dinormalkan');
  // nilai asing diabaikan — jatuh ke prioritas normal
  assert.equal(pilihPenyimpanan({ NOVA_STORAGE: 'mysql', MONGO_URI: 'mongodb://x' }), 'mongo');
});

test('semua nama env Mongo yang lazim dikenali; spasi kosong tidak dihitung', () => {
  for (const k of ['MONGO_URI', 'MONGODB_URI', 'MONGO_URL', 'MONGODB_URL']) {
    assert.equal(pilihPenyimpanan({ [k]: 'mongodb+srv://user:pass@h/db' }), 'mongo', k);
    assert.equal(pilihPenyimpanan({ [k]: '   ' }), 'json', `${k} berisi spasi = tidak terpasang`);
  }
});

/* ================================================ Syarat produksi (fail-closed) */

test('tanpa syarat produksi: json tetap sah (dev/test/preview/demo)', () => {
  const r = cekSyaratProduksi({});
  assert.deepEqual(r, { lulus: true, jenis: 'json' });
});

test('NOVA_REQUIRE_PERSISTENT_STORE=1 + json: MENOLAK, dengan pesan yang bisa dikerjakan', () => {
  const r = cekSyaratProduksi({ NOVA_REQUIRE_PERSISTENT_STORE: '1' });
  assert.equal(r.lulus, false);
  assert.equal(r.jenis, 'json');
  assert.match(r.pesan, /MONGO_URI|DATABASE_URL/);
  assert.match(r.pesan, /FANA|lenyap/i);
});

test('NOVA_REQUIRE_PERSISTENT_STORE=1 + backend persisten: lulus', () => {
  assert.deepEqual(
    cekSyaratProduksi({ NOVA_REQUIRE_PERSISTENT_STORE: '1', MONGO_URI: 'mongodb://x' }),
    { lulus: true, jenis: 'mongo' },
  );
  assert.deepEqual(
    cekSyaratProduksi({ NOVA_REQUIRE_PERSISTENT_STORE: '1', DATABASE_URL: 'postgres://x' }),
    { lulus: true, jenis: 'postgres' },
  );
});

test('nilai selain "1" tidak mengaktifkan syarat (eksplisit, bukan truthy)', () => {
  assert.equal(cekSyaratProduksi({ NOVA_REQUIRE_PERSISTENT_STORE: 'true' }).lulus, true);
  assert.equal(cekSyaratProduksi({ NOVA_REQUIRE_PERSISTENT_STORE: '0' }).lulus, true);
});

/* ==================================================== Health jalur json */

test('periksaPenyimpanan jalur json: sehat dan melaporkan jenisnya', async () => {
  const hasil = await periksaPenyimpanan({ menyeluruh: true });
  assert.equal(hasil.jenis, 'json');
  assert.equal(hasil.sehat, true);
});

/* ---------------------------------------- Koleksi palsu (semantik driver) */

function buatKoleksiPalsu(docsAwal = []) {
  const data = new Map(docsAwal.map((d) => [String(d._id), structuredClone(d)]));
  return {
    data,
    find() {
      // Driver asli: find() mengembalikan KURSOR sinkron, bukan promise.
      return { toArray: async () => [...data.values()].map((d) => structuredClone(d)) };
    },
    async bulkWrite(ops) {
      for (const op of ops) {
        if (!op.replaceOne) throw new Error('hanya replaceOne yang dipakai adapter');
        data.set(String(op.replaceOne.filter._id), structuredClone(op.replaceOne.replacement));
      }
      return ops.length;
    },
    async deleteMany(filter = {}) {
      let n = 0;
      if (!filter || Object.keys(filter).length === 0) {
        n = data.size;
        data.clear();
      } else if (filter._id && Array.isArray(filter._id.$nin)) {
        const sisakan = new Set(filter._id.$nin.map(String));
        for (const k of [...data.keys()]) {
          if (!sisakan.has(k)) {
            data.delete(k);
            n += 1;
          }
        }
      } else {
        throw new Error('bentuk filter deleteMany tidak dikenal di tiruan');
      }
      return n;
    },
    async countDocuments() {
      return data.size;
    },
  };
}

/* ================================================= Bentuk dokumen */

test('dokumen ↔ pengguna: bolak-balik tanpa kehilangan medan; id dari _id', () => {
  const user = { id: 'usr_abc', name: 'Bu Rina', transactions: [{ id: 'trx_1', jumlah: 1000 }], progress: { done: { 1: true } } };
  const doc = docDariUser(user);
  assert.equal(doc._id, 'usr_abc');
  assert.equal(doc.id, 'usr_abc');
  assert.equal(doc.transactions.length, 1);

  const balik = userDariDoc(doc);
  assert.deepEqual(balik, user);
});

test('dokumen tanpa _id ditolak menjadi pengguna (dihitung rusak)', () => {
  assert.equal(userDariDoc(null), null);
  assert.equal(userDariDoc('teks'), null);
  assert.equal(userDariDoc({ name: 'tanpa id' }), null);
});

/* ================================================ muatSemua & simpanSemua */

test('simpanSemua: upsert semua + MENGHAPUS yang tidak ada di memori', async () => {
  const col = buatKoleksiPalsu([
    { _id: 'usr_a', id: 'usr_a', name: 'A' },
    { _id: 'usr_b', id: 'usr_b', name: 'B (akan dihapus)' },
  ]);
  await simpanSemua(col, [
    { id: 'usr_a', name: 'A baru' },
    { id: 'usr_c', name: 'C baru' },
  ]);

  assert.deepEqual([...col.data.keys()].sort(), ['usr_a', 'usr_c'], 'usr_b terhapus — deleteUser menjalar');
  assert.equal(col.data.get('usr_a').name, 'A baru', 'yang ada di memori ditimpa versi baru');
  assert.equal(col.data.get('usr_c').name, 'C baru', 'yang baru di-upsert');
});

test('simpanSemua daftar kosong: menghapus semua (semua pengguna memang dihapus)', async () => {
  const col = buatKoleksiPalsu([{ _id: 'usr_a', id: 'usr_a' }]);
  await simpanSemua(col, []);
  assert.equal(col.data.size, 0);
});

test('simpanSemua menolak diam-diam memasukkan pengguna tanpa id', async () => {
  const col = buatKoleksiPalsu();
  await simpanSemua(col, [{ name: 'tanpa id' }, { id: 'usr_x', name: 'X' }]);
  assert.deepEqual([...col.data.keys()], ['usr_x']);
});

test('muatSemua: dokumen rusak dibuang tanpa menyembunyikan yang sehat', async () => {
  const col = buatKoleksiPalsu([
    { _id: 'usr_a', id: 'usr_a', name: 'A' },
    { name: 'bentuk rusak tanpa _id' },
  ]);
  const { users, rusak } = await muatSemua(col);
  assert.equal(users.length, 1);
  assert.equal(users[0].id, 'usr_a');
  assert.equal(rusak, 1);
});

/* ==================================================== muatAtauSeed */

test('koleksi kosong + ada seed: ditabur sekali, lalu dibaca ulang', async () => {
  const col = buatKoleksiPalsu();
  const dipanggil = [];
  const { users } = await muatAtauSeed(col, async () => {
    dipanggil.push(1);
    return [{ id: 'usr_seed', name: 'Taburan' }];
  });
  assert.equal(users.length, 1);
  assert.equal(users[0].id, 'usr_seed');
  assert.equal(col.data.size, 1, 'seed tersimpan ke koleksi');
  assert.equal(dipanggil.length, 1);
});

test('koleksi sudah berisi: seed TIDAK dipanggil (idempoten)', async () => {
  const col = buatKoleksiPalsu([{ _id: 'usr_a', id: 'usr_a' }]);
  let dipanggil = 0;
  const { users } = await muatAtauSeed(col, async () => {
    dipanggil += 1;
    return [{ id: 'usr_seed' }];
  });
  assert.equal(users.length, 1);
  assert.equal(dipanggil, 0);
  assert.deepEqual([...col.data.keys()], ['usr_a']);
});

test('koleksi kosong + seed kosong: tetap kosong, tanpa taburan kedua', async () => {
  const col = buatKoleksiPalsu();
  const { users } = await muatAtauSeed(col, async () => []);
  assert.equal(users.length, 0);
  assert.equal(col.data.size, 0);
});

/* ================================================== Guard jalur */

test('pastikanJalurMongo menolak di luar jalur mongo', () => {
  // Lingkungan uji: json aktif.
  assert.throws(() => pastikanJalurMongo(), /bukan MongoDB/);
});
