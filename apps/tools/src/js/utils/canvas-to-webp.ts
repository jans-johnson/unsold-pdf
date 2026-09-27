/**
 * WebP from a canvas. WebKit (the Mac, iOS and Linux apps) can't encode WebP
 * and quietly returns a PNG instead, so we fall back to libwebp in WASM.
 */
export async function canvasToWebp(
  canvas: HTMLCanvasElement,
  quality = 0.85
): Promise<Blob> {
  const native = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', quality)
  );
  if (native?.type === 'image/webp') return native;
  const { encode } = await import('@jsquash/webp');
  const pixels = canvas
    .getContext('2d')!
    .getImageData(0, 0, canvas.width, canvas.height);
  const webp = await encode(pixels, { quality: Math.round(quality * 100) });
  return new Blob([webp], { type: 'image/webp' });
}
