# Nova Explorer — citra produksi.
#
# Dipakai bila aplikasi dijalankan sebagai kontainer. Untuk Compute Engine
# dengan systemd, berkas ini tidak diperlukan — lihat "Jalan C" di
# CARA-MENJALANKAN.md.
#
# PERINGATAN YANG PALING PENTING SOAL BERKAS INI
#
# Folder data TIDAK boleh berada di dalam kontainer. Filesystem kontainer
# hilang setiap kali ia dibuat ulang — dan bersamanya seluruh pembukuan
# peserta, yang tidak bisa disusun ulang oleh siapa pun. Pasang volume
# sungguhan dan arahkan NOVA_DATA_DIR ke sana:
#
#   docker run -v /var/lib/nova:/data -e NOVA_DATA_DIR=/data ...
#
# Kalau NOVA_DATA_DIR tidak bisa ditulis, server sengaja MENOLAK menyala
# (lihat lib/kesehatan.js) — kontainer yang gagal berulang jauh lebih baik
# daripada kontainer yang menerima catatan lalu membuangnya diam-diam.

FROM node:22-slim

# dumb-init menjadikan Node PID 1 yang benar: SIGTERM dari `docker stop`,
# Cloud Run, atau Kubernetes benar-benar sampai ke aplikasi, sehingga
# penutupan rapi di server.js sempat berjalan dan penulisan yang mengantre
# tidak terpotong di tengah.
RUN apt-get update \
    && apt-get install -y --no-install-recommends dumb-init \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    TZ=Asia/Jakarta \
    LOG_FORMAT=json \
    PORT=3000 \
    NOVA_DATA_DIR=/data

WORKDIR /app

# Dependensi disalin lebih dulu supaya lapisan npm hanya dibangun ulang
# ketika package-lock.json benar-benar berubah.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Berjalan sebagai pengguna tak-istimewa. `node` sudah ada di citra resmi.
RUN mkdir -p /data && chown -R node:node /data /app
RUN chmod +x docker-entrypoint.sh
USER node

EXPOSE 3000

# Probe ini benar-benar memeriksa penyimpanan, bukan sekadar "proses hidup".
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Skrip ini hanya menyalin data awal bila NOVA_SEED_USERS_FILE diisi (uji
# coba), lalu menjalankan dumb-init sebagai PID 1 lewat `exec` — proses
# shell-nya digantikan, bukan diteruskan sebagai anak, jadi SIGTERM tetap
# sampai dumb-init persis seperti sebelumnya. Lihat docker-entrypoint.sh.
ENTRYPOINT ["./docker-entrypoint.sh"]
