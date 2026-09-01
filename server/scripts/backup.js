#!/usr/bin/env node
/**
 * Alat cadangan data pilot.
 *
 *   npm run backup                        buat satu cadangan sekarang
 *   npm run backup -- list                lihat cadangan yang ada
 *   npm run backup -- restore <berkas>    pulihkan (perlu --yes)
 *
 * Server sudah mencadangkan sendiri tiap 24 jam, tapi perintah ini dipakai untuk
 * cadangan sebelum perubahan besar, untuk cron di luar proses server, dan —
 * yang paling penting — untuk memulihkan.
 */
import { KEEP, BACKUP_DIR, listBackups, listSnapshots, restoreBackup, runBackup } from '../lib/backup.js';

const [, , perintah = 'create', ...args] = process.argv;
const rupiahBytes = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`);
const baris = (b) => {
  const jumlah = b.pengguna === null ? 'RUSAK — tidak bisa dibaca' : `${b.pengguna} pengguna`;
  console.log(`  ${b.file}`);
  console.log(`     ${b.dibuat.slice(0, 19).replace('T', ' ')} · ${rupiahBytes(b.bytes)} · ${jumlah}`);
};

switch (perintah) {
  case 'create': {
    const hasil = await runBackup();
    if (hasil.skipped === 'data-rusak' || hasil.skipped === 'bukan-basis-data') process.exitCode = 1;
    break;
  }

  case 'list': {
    const list = await listBackups();
    const jepretan = await listSnapshots();
    if (!list.length && !jepretan.length) {
      console.log(`\nBelum ada cadangan di ${BACKUP_DIR}\nBuat sekarang:  npm run backup\n`);
      break;
    }
    console.log(`\n${list.length} cadangan berkala (disimpan maksimal ${KEEP}):\n`);
    for (const b of list) baris(b);

    if (jepretan.length) {
      // Dipisah dengan sengaja: ini data SEBELUM pemulihan, bukan cadangan harian.
      // Menyatukannya pernah membuat daftar ini menyarankan berkas yang salah.
      console.log(`\n${jepretan.length} jepretan sebelum pemulihan (tidak dirotasi, hanya jaring pengaman):\n`);
      for (const b of jepretan) baris(b);
    }

    if (list.length) console.log(`\nUntuk memulihkan:  npm run backup -- restore ${list[0].file} --yes\n`);
    else console.log('\nBelum ada cadangan berkala. Buat sekarang:  npm run backup\n');
    break;
  }

  case 'restore': {
    const berkas = args.find((a) => !a.startsWith('--'));
    if (!berkas) {
      console.error('Sertakan nama berkas cadangan.\n  npm run backup -- list\n  npm run backup -- restore users-2026-07-31T02-00-00.json --yes');
      process.exitCode = 1;
      break;
    }
    if (!args.includes('--yes')) {
      console.error(
        `\nPemulihan akan MENIMPA data yang sedang berjalan dengan isi ${berkas}.\n` +
          'Data yang sekarang tetap disalin dulu, jadi langkah ini bisa dibatalkan.\n\n' +
          `Kalau yakin, ulangi dengan --yes:\n  npm run backup -- restore ${berkas} --yes\n`,
      );
      process.exitCode = 1;
      break;
    }
    try {
      const r = await restoreBackup(berkas);
      console.log(`\nDipulihkan dari ${r.dari} — ${r.pengguna} pengguna.`);
      if (r.salinanSebelumnya) console.log(`Data sebelumnya disimpan sebagai ${r.salinanSebelumnya}`);
      console.log('\nJalankan ulang server agar membaca data yang baru.\n');
    } catch (err) {
      console.error(`\nGagal memulihkan: ${err.message}\n`);
      process.exitCode = 1;
    }
    break;
  }

  default:
    console.log(`
Alat cadangan Novaro

  npm run backup                        Buat cadangan sekarang
  npm run backup -- list                Daftar cadangan yang tersimpan
  npm run backup -- restore <berkas> --yes   Pulihkan dari cadangan
`);
}
