#!/bin/sh
# Menyalin data awal (kalau ada) sebelum server menyala — sekali saja per
# instance, bukan bagian dari alur produksi normal.
#
# ------------------------------------------------------------------
# KENAPA INI ADA
#
# Secret Manager memasang berkas rahasia sebagai baca-saja. Kalau
# NOVA_DATA_DIR/users.json langsung dipasang dari Secret Manager, permintaan
# tulis PERTAMA — event 'login' peserta pertama sekalipun — akan gagal, karena
# lib/store.js menulis lewat tmp+rename di atas berkas yang sama. Skrip ini
# menyalin rahasianya ke lokasi biasa yang bisa ditulis SEBELUM server dimulai,
# supaya salinannya berperilaku seperti berkas data biasa.
#
# ------------------------------------------------------------------
# HANYA DIPAKAI BILA NOVA_SEED_USERS_FILE DIISI
#
# Tanpa env var ini (nilai bawaan), skrip langsung lompat ke server — perilaku
# produksi tidak berubah sama sekali. Isi hanya untuk uji coba: instance
# didaur ulang → foldernya kosong lagi → diisi ulang dari rahasia yang sama.
# Perubahan yang dibuat peserta SELAMA instance hidup tetap hilang saat daur
# ulang — skrip ini tidak memecahkan masalah penyimpanan sementara Cloud Run,
# hanya membuat kondisi awalnya konsisten.
set -eu

sumber=""
if [ -n "${NOVA_SEED_USERS_FILE:-}" ] && [ -f "$NOVA_SEED_USERS_FILE" ]; then
  sumber="$NOVA_SEED_USERS_FILE"
elif [ -f "/app/data/users-seed.json" ]; then
  sumber="/app/data/users-seed.json"
elif [ -f "./data/users-seed.json" ]; then
  sumber="./data/users-seed.json"
fi

if [ -n "$sumber" ]; then
  tujuan="${NOVA_DATA_DIR:-/data}/users.json"
  # Direksi tujuan belum tentu ada di image segar (/tmp dikosongkan Cloud Run).
  mkdir -p "$(dirname "$tujuan")"
  if [ ! -f "$tujuan" ]; then
    sementara="$tujuan.awal.$$"

    # Sengaja BUKAN `cp`.
    #
    # Cloud Run memasang berkas rahasia sebagai symlink ke direktori berversi,
    # dan menukar symlink itu saat volume disiapkan. `cp` mem-stat sumbernya
    # sebelum dan sesudah menyalin; begitu inode-nya berganti di tengah jalan
    # ia menolak menyelesaikan pekerjaan:
    #
    #   cp: skipping file '/secrets/seed-users.json',
    #       as it was replaced while being copied
    #
    # lalu keluar dengan kode 1, `set -e` membunuh skrip, dan kontainer mati
    # sebelum sempat mendengarkan port — tanpa petunjuk apa pun di sisi Cloud
    # Run selain "failed to start and listen on PORT=8080".
    #
    # `cat` membuka berkasnya SEKALI lalu membaca dari deskriptor itu.
    # Penukaran symlink sesudahnya tidak berpengaruh: deskriptornya masih
    # menunjuk inode yang sama, jadi isinya utuh dan konsisten.
    cat "$sumber" > "$sementara"

    # Ditulis ke berkas sementara dulu, sama seperti lib/store.js menulis
    # datanya: kalau pembacaan terpotong, yang rusak hanya berkas sementara,
    # bukan users.json yang akan dibaca server.
    if node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$sementara"; then
      mv "$sementara" "$tujuan"
      echo "docker-entrypoint: data awal disalin ke $tujuan ($sumber)"
    else
      rm -f "$sementara"
      echo "docker-entrypoint: NOVA_SEED_USERS_FILE bukan JSON yang sah — periksa isi secret-nya" >&2
      exit 1
    fi
  fi
fi

exec dumb-init -- node server.js
