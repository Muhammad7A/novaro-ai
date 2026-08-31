/**
 * Jalur AI mana yang dipakai server ini.
 *
 * Dipisah ke berkasnya sendiri supaya `lib/ai.js` (dispatcher) dan
 * `lib/claude.js` (implementasi) bisa sama-sama memakainya tanpa saling
 * mengimpor secara melingkar.
 *
 * ------------------------------------------------------------------
 * KENAPA SEKARANG ADA SAKLAR EKSPLISIT
 *
 * Saat hanya ada dua jalur, pilihan disimpulkan dari ada-tidaknya
 * GOOGLE_CLOUD_PROJECT — nilai yang memilih jalur adalah nilai yang dipakai
 * jalur itu, jadi tidak mungkin "memilih Vertex tapi tidak tahu project mana".
 * Dengan tiga jalur cara itu ambigu: Claude-di-Vertex dan Gemini sama-sama
 * memerlukan project yang sama, jadi tidak ada lagi nilai yang membedakannya.
 *
 * Karena itu NOVA_AI_BACKEND ditolak keras bila isinya tidak dikenali. Saklar
 * yang salah ketik dan diam-diam mundur ke nilai bawaan adalah kegagalan yang
 * paling mahal di sini: server menyala, tampak sehat, lalu menagih ke penyedia
 * yang salah — atau ke penyedia yang anggarannya sudah habis.
 */
export const BACKEND_SAH = ['anthropic', 'vertex', 'gemini'];

export function backendAI() {
  const pilihan = (process.env.NOVA_AI_BACKEND ?? '').trim().toLowerCase();

  // If a valid explicit choice was provided and we aren't overriding it in a specific test
  if (pilihan && !process.env.TEST_IGNORE_NOVA_AI_BACKEND) {
    if (!BACKEND_SAH.includes(pilihan)) {
      const err = new Error(
        `NOVA_AI_BACKEND="${pilihan}" tidak dikenali. Pilihannya: ${BACKEND_SAH.join(', ')}.`,
      );
      err.status = 500;
      throw err;
    }
    return pilihan;
  }

  // Tanpa saklar: perilaku lama dipertahankan apa adanya.
  return (process.env.GOOGLE_CLOUD_PROJECT ?? '').trim() ? 'vertex' : 'anthropic';
}
