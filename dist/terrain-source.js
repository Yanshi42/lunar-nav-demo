import { tileCoordinate } from "./sphere-grid.js";

const cache = new Map();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

async function bandPixels(kind, row) {
  const key = `${kind}-${row}`;
  if (cache.has(key)) return cache.get(key);
  const pending = new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      resolve({ data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        width: canvas.width, height: canvas.height });
    };
    image.onerror = () => reject(new Error(`无法读取月面地形 ${kind}-${row}`));
    image.src = `assets/${kind}-band-${String(row).padStart(2, "0")}.${kind === "height" ? "png" : "jpg"}`;
  });
  cache.set(key, pending);
  if (cache.size > 12) cache.delete(cache.keys().next().value);
  try { return await pending; }
  catch (error) { cache.delete(key); throw error; }
}

function sourceValue(bands, x, y, channel, ppd) {
  const height = 5 * ppd;
  const band = bands.get(Math.floor(y / height));
  const index = ((y % height) * band.width + x) * 4;
  if (channel === "height") return (band.data[index] * 256 + band.data[index + 1]) * 0.5 - 10000;
  return band.data[index + channel];
}

function sample(bands, x, y, channel, ppd) {
  const width = 360 * ppd;
  const x0 = Math.floor(x) % width, x1 = (x0 + 1) % width;
  const y0 = Math.floor(y), y1 = Math.min(180 * ppd - 1, y0 + 1);
  const tx = x - Math.floor(x), ty = y - y0;
  const a = sourceValue(bands, x0, y0, channel, ppd);
  const b = sourceValue(bands, x1, y0, channel, ppd);
  const c = sourceValue(bands, x0, y1, channel, ppd);
  const d = sourceValue(bands, x1, y1, channel, ppd);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

export async function loadTileRaster(tile, size, ppd, includeHeight = true) {
  const sourceX = new Float32Array(size * size);
  const sourceY = new Float32Array(size * size);
  const rows = new Set();
  const width = 360 * ppd, bandHeight = 5 * ppd;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const index = y * size + x;
    const coordinate = tileCoordinate(tile, (x + 0.5) / size, (y + 0.5) / size);
    sourceX[index] = ((coordinate.lon + 180) * ppd - 0.5 + width) % width;
    sourceY[index] = clamp((90 - coordinate.lat) * ppd - 0.5, 0, 180 * ppd - 1);
    rows.add(Math.floor(sourceY[index] / bandHeight));
    rows.add(Math.floor(Math.min(180 * ppd - 1, Math.floor(sourceY[index]) + 1) / bandHeight));
  }
  const reliefBands = new Map();
  const heightBands = new Map();
  await Promise.all([...rows].map(async (row) => {
    reliefBands.set(row, await bandPixels("relief", row));
    if (includeHeight) heightBands.set(row, await bandPixels("height", row));
  }));
  const relief = new Uint8ClampedArray(size * size * 4);
  const values = includeHeight ? new Float32Array(size * size) : null;
  for (let index = 0; index < size * size; index++) {
    const x = sourceX[index], y = sourceY[index];
    if (values) values[index] = sample(heightBands, x, y, "height", ppd);
    for (let channel = 0; channel < 3; channel++) {
      relief[index * 4 + channel] = sample(reliefBands, x, y, channel, ppd);
    }
    relief[index * 4 + 3] = 255;
  }
  return { values, relief };
}
