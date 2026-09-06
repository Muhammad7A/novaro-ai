#!/usr/bin/env bash
# ============================================================
# Sinkron workspace Emergent dengan GitHub main — TANPA kredit Emergent.
#
# Jalankan di terminal VS Code Emergent:
#     bash /app/sync.sh
#
# Yang dilakukan: pulihkan HOME, tarik commit terbaru dari GitHub main,
# dan samakan workspace persis dengan repo (reset --hard). Berkas
# untracked (credentials/, server/data/, backend/.env bila ada) AMAN —
# reset --hard tidak pernah menyentuh berkas untracked.
#
# Setelah ini: klik Publish di Emergent.
#
# CATATAN KEAMANAN: skrip ini memuat token GitHub READ-ONLY yang
# diperbarui berkala. Setelah kontes selesai, cabut token di GitHub
# dan ganti barisnya (atau hapus skrip ini dari repo).
# ============================================================
set -e
export HOME=/root
git config --global user.name "Muhammad7A" 2>/dev/null || true
git config --global user.email "github@emergent.sh" 2>/dev/null || true
git remote remove origin 2>/dev/null || true
git remote add origin https://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@github.com/Muhammad7A/nova-explorer-emergent.git
git fetch origin
git reset --hard origin/main
git remote remove origin
rm -f .git/FETCH_HEAD
echo ""
echo "=== HEAD ==="
git log --oneline -1
echo "=== env produksi ==="
grep -E "NOVA_STORAGE|PUBLIC_HOST|FORCE_HTTPS" frontend/.env || echo "(bersih)"
echo ""
echo "Selesai — workspace = GitHub main. Lanjut: klik Publish di Emergent."
