/**
 * A quick check on a photo, on the phone itself (nothing is sent anywhere): is it too dark or too blurry to read?
 * Returns a short plain sentence, or null when the photo looks fine. It only ever WARNS; the person decides.
 */
export async function photoProblem(file: File): Promise<string | null> {
  if (!file.type.startsWith("image/")) return null;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 320 / Math.max(bmp.width, bmp.height));
    const w = Math.max(8, Math.round(bmp.width * scale)), h = Math.max(8, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const { data } = ctx.getImageData(0, 0, w, h);
    const g = new Float32Array(w * h);
    let sum = 0;
    for (let i = 0; i < w * h; i++) { g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]; sum += g[i]; }
    const mean = sum / (w * h);
    // edge strength: the variance of the Laplacian (sharp photos have strong edges; blurred ones are flat)
    let n = 0, s = 0, s2 = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      s += l; s2 += l * l; n++;
    }
    const variance = s2 / n - (s / n) ** 2;
    if (mean < 40) return "This photo is very dark. Please take it again in better light.";
    if (mean > 245) return "This photo is too bright (washed out). Please take it again away from the glare.";
    if (variance < 25) return "This photo looks blurry. Hold the phone steady, move a little closer and take it again.";
    return null;
  } catch {
    return null; // a browser that cannot check simply does not warn
  }
}
