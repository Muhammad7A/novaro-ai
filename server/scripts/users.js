#!/usr/bin/env node
/**
 * Alat pengelola peserta.
 *
 *   npm run users -- list
 *   npm run users -- add "Bu Sari" "Warung Bu Sari" --batch B1
 *   npm run users -- batch usr_ab12cd34 B2
 *   npm run users -- acak --yes
 *   npm run users -- reset usr_ab12cd34
 *   npm run users -- remove usr_ab12cd34
 *
 * Kode akses hanya ditampilkan sekali saat dibuat atau di-reset — yang tersimpan
 * di server hanyalah hash-nya, jadi kode tidak bisa dibaca ulang dari file data.
 */
import { randomInt } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runBackup } from '../lib/backup.js';
import { tanggalWIB } from '../lib/cashbook.js';
import { BATCH_SAH, normalBatch, store } from '../lib/store.js';

const [, , command, ...args] = process.argv;

const HERE = path.dirname(fileURLToPath(import.meta.url));
/* Sama dengan tujuan `npm run export` — dan sama-sama sudah diabaikan Git. */
const EXPORT_DIR = path.join(HERE, '..', 'export');

function box(lines) {
  const width = Math.max(...lines.map((l) => l.length)) + 2;
  console.log('┌' + '─'.repeat(width) + '┐');
  for (const line of lines) console.log('│ ' + line.padEnd(width - 1) + '│');
  console.log('└' + '─'.repeat(width) + '┘');
}

function usage() {
  console.log(`
Pengelola peserta Novaro

  npm run users -- list                              Tampilkan semua peserta
  npm run users -- add "<nama>" ["<usaha>"]          Tambah peserta + kode akses
  npm run users -- massal <jumlah>                   Buat banyak kode sekaligus + CSV untuk diisi tangan
  npm run users -- nama <userId> "<nama>" ["<usaha>"]
                                                     Ganti nama sementara dengan nama sebenarnya
  npm run users -- reset <userId>                    Buat ulang kode akses
  npm run users -- remove <userId> --yes             Hapus peserta beserta datanya (permanen)

Sejak self-paced (RESEARCH-DEPENDENCY-REMOVAL.md), tidak ada penetapan jadwal
maupun kelompok B1/B2 — batch hanya menyisakan flag 'DEMO' untuk showroom.
`);
}

/** Nilai batch dari argumen --batch, atau '' bila tidak diberikan. */
function batchDariArgs(list) {
  const i = list.indexOf('--batch');
  if (i < 0) return { batch: '', salah: null };
  const mentah = list[i + 1] ?? '';
  const batch = normalBatch(mentah);
  return { batch, salah: batch ? null : mentah };
}

/**
 * Argumen posisional saja — bendera dan nilainya dibuang.
 *
 * Ditulis sebagai pemindaian, bukan `filter`, karena `--batch` memakan argumen
 * BERIKUTNYA: menyaring "nilai yang sama dengan args[indexOf('--batch')+1]"
 * membuang nama peserta ketika benderanya tidak ada sama sekali (indexOf
 * mengembalikan −1, dan args[0] justru namanya).
 */
function posisional(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i] === '--batch') { i++; continue; } // lewati bendera beserta nilainya
    if (list[i].startsWith('--')) continue;
    out.push(list[i]);
  }
  return out;
}

/** Pengacakan Fisher–Yates memakai sumber acak kriptografis, bukan Math.random. */
function kocok(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

switch (command) {
  case 'list': {
    const users = await store.listUsers();
    if (!users.length) {
      console.log('\nBelum ada pengguna. Tambahkan dengan:  npm run users -- add "Nama" "Nama Usaha"\n');
      break;
    }
    const hitung = { B1: 0, B2: 0, '': 0 };
    for (const u of users) hitung[u.batch ?? ''] = (hitung[u.batch ?? ''] ?? 0) + 1;
    const belum = hitung[''] ?? 0;
    console.log(
      `\n${users.length} peserta terdaftar  ·  B1: ${hitung.B1}  ·  B2: ${hitung.B2}` +
        (belum ? `  ·  belum berkelompok: ${belum}` : '') +
        '\n',
    );
    for (const u of users) {
      const t = u.usage;
      const cache = (t.cacheBacaTokens ?? 0) + (t.cacheTulisTokens ?? 0);
      const tanda = u.batch ? `[${u.batch}]` : '[ - ]';
      console.log(`  ${tanda} ${u.id}  ${u.name}${u.business ? ` — ${u.business}` : ''}`);
      console.log(
        `     profil: ${u.hasProfile ? 'terisi' : 'belum'} · transaksi: ${u.transaksi} · pesan: ${u.messages} · permintaan AI: ${t.requests}`,
      );
      console.log(
        `     token: ${t.inputTokens} masuk / ${t.outputTokens} keluar${cache ? ` / ${cache} lewat cache` : ''}`,
      );
    }
    console.log('');
    break;
  }

  case 'add': {
    const [name, business = ''] = posisional(args);
    const { batch, salah } = batchDariArgs(args);
    if (!name) {
      console.error('Nama peserta wajib diisi.\n  npm run users -- add "Bu Sari" "Warung Bu Sari" --batch B1');
      process.exitCode = 1;
      break;
    }
    if (salah !== null) {
      console.error(`\nKelompok "${salah}" tidak dikenali. Pilihannya: ${BATCH_SAH.join(', ')}.\n`);
      process.exitCode = 1;
      break;
    }
    const { user, accessCode } = await store.createUser({ name, business, batch });
    console.log('\nPeserta dibuat.\n');
    box([
      `Nama       : ${user.name}`,
      `Usaha      : ${user.business || '-'}`,
      `Kelompok   : ${user.batch || '- (belum ditetapkan)'}`,
      `ID         : ${user.id}`,
      `Kode akses : ${accessCode}`,
    ]);
    console.log('\nBerikan kode akses ini ke peserta. Kode tidak bisa dilihat lagi setelah ini —');
    console.log('kalau hilang, buat ulang dengan:  npm run users -- reset ' + user.id);
    if (!user.batch) {
      console.log('\nKelompok belum ditetapkan. Setelah perekrutan selesai, acak semuanya sekaligus:');
      console.log('  npm run users -- acak --yes');
    }
    console.log('');
    break;
  }

  /*
   * Membuat banyak kode akses sekaligus, untuk dibagikan sebelum nama
   * pesertanya diketahui.
   *
   * Alur perekrutan sebenarnya berjalan terbalik dari `add`: kartu kode dicetak
   * dulu, dibawa ke lapangan, lalu nama pemiliknya ditulis tangan saat kartunya
   * diserahkan. `add` memaksa nama ada lebih dulu, sehingga 50 peserta berarti
   * 50 kali mengetik perintah dan 50 kode yang tersebar di layar riwayat.
   *
   * Nama sementara ("Peserta 01") diganti belakangan dengan `nama`, memakai
   * userId dari berkas CSV yang ditulis perintah ini.
   */
  case 'massal': {
    const jumlah = Number(posisional(args)[0]);
    if (!Number.isInteger(jumlah) || jumlah < 1 || jumlah > 500) {
      console.error('\nJumlah harus bilangan bulat 1–500.\n  npm run users -- massal 50 --batch B1\n');
      process.exitCode = 1;
      break;
    }
    const { batch, salah } = batchDariArgs(args);
    if (salah !== null) {
      console.error(`\nKelompok "${salah}" tidak dikenali. Pilihannya: ${BATCH_SAH.join(', ')}.\n`);
      process.exitCode = 1;
      break;
    }

    const lebar = String(jumlah).length;
    const dibuat = [];
    for (let i = 1; i <= jumlah; i++) {
      const nama = `Peserta ${String(i).padStart(lebar, '0')}`;
      const { user, accessCode } = await store.createUser({ name: nama, business: '', batch });
      dibuat.push({ nomor: i, id: user.id, nama, kode: accessCode });
    }

    /*
     * Berkasnya ditulis 0600 dan diletakkan di `export/`, yang sudah diabaikan
     * Git. Isinya kode akses dalam bentuk terbaca — satu-satunya salinan yang
     * ada, karena server hanya menyimpan hash-nya.
     */
    await mkdir(EXPORT_DIR, { recursive: true });
    const stempel = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const berkas = path.join(EXPORT_DIR, `kode-akses-${stempel}.csv`);
    const baris = [
      'nomor,userId,namaSementara,kodeAkses,namaAsli,namaUsaha,noHP,tanggalDiserahkan',
      ...dibuat.map((d) => `${d.nomor},${d.id},${d.nama},${d.kode},,,,`),
    ];
    await writeFile(berkas, baris.join('\n') + '\n', { mode: 0o600 });

    console.log(`\n${jumlah} kode akses dibuat${batch ? ` untuk kelompok ${batch}` : ''}.\n`);
    for (const d of dibuat) {
      console.log(`  ${String(d.nomor).padStart(lebar, ' ')}.  ${d.kode}   ${d.id}`);
    }
    console.log(`\nDaftar lengkap (dengan kolom kosong untuk ditulis tangan):\n  ${berkas}\n`);
    console.log('Kode di atas TIDAK bisa ditampilkan lagi — server hanya menyimpan hash-nya.');
    console.log('Simpan berkas itu di luar repositori dan jangan pernah mengunggahnya.\n');
    console.log('Setelah nama pesertanya diketahui:');
    console.log('  npm run users -- nama <userId> "<nama asli>" ["<nama usaha>"]\n');
    if (!batch) {
      console.log('Kelompok belum ditetapkan. Setelah perekrutan selesai:');
      console.log('  npm run users -- acak --yes\n');
    }
    break;
  }

  /*
   * Mengganti nama sementara dengan nama sebenarnya.
   *
   * Tanpa ini, `massal` menjadi jalan buntu: kodenya sudah dibagikan dan tidak
   * bisa dibuat ulang tanpa membatalkan kartu yang sudah di tangan peserta,
   * tetapi datanya selamanya tercatat atas nama "Peserta 07".
   */
  case 'nama': {
    const [id, namaBaru, usahaBaru] = posisional(args);
    if (!id || !namaBaru) {
      console.error('\n  npm run users -- nama usr_ab12cd34 "Bu Sari" "Warung Bu Sari"\n');
      process.exitCode = 1;
      break;
    }
    const user = await store.renameUser(id, { name: namaBaru, business: usahaBaru });
    if (!user) {
      console.error(`\nPeserta ${id} tidak ditemukan.\n`);
      process.exitCode = 1;
      break;
    }
    console.log(`\n${id} sekarang bernama "${user.name}"${user.business ? ` (${user.business})` : ''}.\n`);
    break;
  }

  case 'reset': {
    const [userId] = args;
    if (!userId) {
      console.error('Sertakan userId.  npm run users -- reset usr_xxxx');
      process.exitCode = 1;
      break;
    }
    const code = await store.resetAccessCode(userId);
    if (!code) {
      console.error(`Pengguna ${userId} tidak ditemukan.`);
      process.exitCode = 1;
      break;
    }
    console.log('\nKode akses diperbarui.\n');
    box([`ID         : ${userId}`, `Kode akses : ${code}`]);
    console.log('\nKode lama sudah tidak berlaku.\n');
    break;
  }

  /*
   * Penghapusan adalah satu-satunya perintah di sini yang tidak bisa dibatalkan,
   * dan dulu ia justru satu-satunya yang tidak meminta konfirmasi — sementara
   * `backup restore`, yang jauh lebih mudah dipulihkan, sudah meminta --yes.
   * Sekarang: harus --yes, dan cadangan dibuat lebih dulu secara otomatis.
   */
  case 'remove': {
    const userId = args.find((a) => !a.startsWith('--'));
    if (!userId) {
      console.error('Sertakan userId.  npm run users -- remove usr_xxxx --yes');
      process.exitCode = 1;
      break;
    }

    const target = (await store.listUsers()).find((u) => u.id === userId);
    if (!target) {
      console.error(`\nPengguna ${userId} tidak ditemukan.\n`);
      process.exitCode = 1;
      break;
    }

    if (!args.includes('--yes')) {
      console.error(
        `\nIni akan MENGHAPUS PERMANEN seluruh data berikut:\n\n` +
          `  [${target.batch || '-'}] ${target.id}  ${target.name}${target.business ? ` — ${target.business}` : ''}\n` +
          `  ${target.transaksi} transaksi buku kas · ${target.messages} pesan · profil ${target.hasProfile ? 'terisi' : 'kosong'}\n\n` +
          'Buku kas itu miliknya. Tawarkan dulu agar dia mengunduh datanya (Profil → Unduh data saya).\n\n' +
          `Kalau memang yakin, ulangi dengan --yes:\n  npm run users -- remove ${userId} --yes\n`,
      );
      process.exitCode = 1;
      break;
    }

    const cadangan = await runBackup({ quiet: true });
    const ok = await store.deleteUser(userId);
    console.log(`\nPengguna ${userId} dihapus beserta profil, buku kas, dan riwayat chat-nya.`);
    if (cadangan.file) console.log(`Cadangan sebelum penghapusan: ${cadangan.file}`);
    console.log('');
    if (!ok) process.exitCode = 1;
    break;
  }

  default:
    usage();
}
