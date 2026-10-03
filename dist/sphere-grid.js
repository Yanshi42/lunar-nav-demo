// A spherified cube gives six seamless, nearly equal-area quadrilateral faces.
// Exact congruent squares cannot tile a sphere; this avoids polar convergence.
export const CELLS_PER_FACE = 18;
export const TILE_COUNT = 6 * CELLS_PER_FACE * CELLS_PER_FACE;
export const MOON_RADIUS_KM = 1737.4;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// U points right and V points up when looking at a face from outside.
const FACES = [
  { name: "+Z", u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  { name: "-Z", u: [-1, 0, 0], v: [0, 1, 0], n: [0, 0, -1] },
  { name: "+X", u: [0, 0, -1], v: [0, 1, 0], n: [1, 0, 0] },
  { name: "-X", u: [0, 0, 1], v: [0, 1, 0], n: [-1, 0, 0] },
  { name: "+Y", u: [1, 0, 0], v: [0, 0, -1], n: [0, 1, 0] },
  { name: "-Y", u: [1, 0, 0], v: [0, 0, 1], n: [0, -1, 0] },
];

export function coordinateVector(lat, lon) {
  const p = lat * RAD, l = lon * RAD;
  return [Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)];
}

export function vectorCoordinate(vector) {
  return { lat: Math.asin(clamp(vector[1], -1, 1)) * DEG,
    lon: Math.atan2(vector[0], vector[2]) * DEG };
}

export function faceVector(faceIndex, u, v) {
  const face = FACES[faceIndex];
  const a = u * Math.sqrt(Math.max(0, 0.5 - v * v / 6));
  const b = v * Math.sqrt(Math.max(0, 0.5 - u * u / 6));
  const c = Math.sqrt(Math.max(0, 1 - (u * u + v * v) / 2 + u * u * v * v / 3));
  return [0, 1, 2].map((i) => a * face.u[i] + b * face.v[i] + c * face.n[i]);
}

export function vectorFaceUv(vector) {
  const [x, y, z] = vector;
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  const faceIndex = az >= ax && az >= ay ? (z >= 0 ? 0 : 1)
    : ax >= ay ? (x >= 0 ? 2 : 3) : (y >= 0 ? 4 : 5);
  const face = FACES[faceIndex];
  const localX = dot(vector, face.u), localY = dot(vector, face.v);
  const difference = localX * localX - localY * localY;
  const term = 3 - 2 * difference;
  const vSquared = clamp((term - Math.sqrt(Math.max(0, term * term - 24 * localY * localY))) / 2, 0, 1);
  const uSquared = clamp(vSquared + 2 * difference, 0, 1);
  return { face: faceIndex,
    u: Math.sign(localX) * Math.sqrt(uSquared),
    v: Math.sign(localY) * Math.sqrt(vSquared) };
}

export function tileFromFaceCell(face, row, col) {
  const count = CELLS_PER_FACE;
  const center = faceVector(face, -1 + (col + 0.5) * 2 / count,
    1 - (row + 0.5) * 2 / count);
  const { lat, lon } = vectorCoordinate(center);
  return { face, row, col, lat, lon,
    id: `f${face + 1}-r${String(row + 1).padStart(2, "0")}-c${String(col + 1).padStart(2, "0")}` };
}

export function tileFromVector(vector) {
  const { face, u, v } = vectorFaceUv(vector);
  const col = clamp(Math.floor((u + 1) * CELLS_PER_FACE / 2), 0, CELLS_PER_FACE - 1);
  const row = clamp(Math.floor((1 - v) * CELLS_PER_FACE / 2), 0, CELLS_PER_FACE - 1);
  return tileFromFaceCell(face, row, col);
}

export function tileFromCoordinate(lat, lon) {
  return tileFromVector(coordinateVector(lat, lon));
}

export function tileVector(tile, x, y) {
  const u = -1 + (tile.col + clamp(x, 0, 1)) * 2 / CELLS_PER_FACE;
  const v = 1 - (tile.row + clamp(y, 0, 1)) * 2 / CELLS_PER_FACE;
  return faceVector(tile.face, u, v);
}

export function tileCoordinate(tile, x, y) {
  return vectorCoordinate(tileVector(tile, x, y));
}

export function surfaceDistanceKm(a, b) {
  const cosine = clamp(dot(a, b), -1, 1);
  return MOON_RADIUS_KM * Math.atan2(Math.sqrt(Math.max(0, 1 - cosine * cosine)), cosine);
}

export function tileDistanceKm(tile, a, b) {
  return surfaceDistanceKm(tileVector(tile, a.x, a.y), tileVector(tile, b.x, b.y));
}

export function tileDimensionsKm(tile) {
  return { width: tileDistanceKm(tile, { x: 0, y: 0.5 }, { x: 1, y: 0.5 }),
    height: tileDistanceKm(tile, { x: 0.5, y: 0 }, { x: 0.5, y: 1 }) };
}
