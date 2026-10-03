import assert from "node:assert/strict";
import { CELLS_PER_FACE, MOON_RADIUS_KM, TILE_COUNT, coordinateVector, faceVector,
  tileCoordinate, tileDimensionsKm, tileFromCoordinate, tileFromFaceCell,
  tileFromVector, tileVector, vectorFaceUv } from "../dist/sphere-grid.js";

const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const triangleArea = (a, b, c) => 2 * Math.atan2(Math.abs(dot(a, cross(b, c))),
  1 + dot(a, b) + dot(b, c) + dot(c, a)) * MOON_RADIUS_KM ** 2;

let minArea = Infinity, maxArea = 0, minWidth = Infinity, maxWidth = 0;
let minPolarWidth = Infinity, maxPolarWidth = 0;
let sumArea = 0;
for (let face = 0; face < 6; face++) for (let row = 0; row < CELLS_PER_FACE; row++) {
  for (let col = 0; col < CELLS_PER_FACE; col++) {
    const tile = tileFromFaceCell(face, row, col);
    const corners = [tileVector(tile, 0, 0), tileVector(tile, 1, 0),
      tileVector(tile, 1, 1), tileVector(tile, 0, 1)];
    const area = triangleArea(corners[0], corners[1], corners[2])
      + triangleArea(corners[0], corners[2], corners[3]);
    const { width, height } = tileDimensionsKm(tile);
    assert.equal(tileFromCoordinate(tile.lat, tile.lon).id, tile.id);
    minArea = Math.min(minArea, area); maxArea = Math.max(maxArea, area); sumArea += area;
    minWidth = Math.min(minWidth, width, height); maxWidth = Math.max(maxWidth, width, height);
    if (Math.abs(tile.lat) > 80) {
      minPolarWidth = Math.min(minPolarWidth, width, height);
      maxPolarWidth = Math.max(maxPolarWidth, width, height);
    }
  }
}
assert.equal(TILE_COUNT, 1944);
assert.ok(Math.abs(sumArea / (4 * Math.PI * MOON_RADIUS_KM ** 2) - 1) < 1e-10);
assert.ok(maxArea / minArea < 1.6);
assert.ok(minPolarWidth > 90);

let maxInverseError = 0;
for (let index = 0; index < 10000; index++) {
  const lat = Math.asin(2 * Math.random() - 1) * 180 / Math.PI;
  const lon = Math.random() * 360 - 180;
  const vector = coordinateVector(lat, lon);
  const { face, u, v } = vectorFaceUv(vector);
  const inverse = faceVector(face, u, v);
  const error = Math.hypot(...vector.map((value, i) => value - inverse[i]));
  maxInverseError = Math.max(maxInverseError, error);
  assert.ok(error < 1e-9);
  const tile = tileFromVector(vector);
  const center = tileCoordinate(tile, 0.5, 0.5);
  assert.ok(Number.isFinite(center.lat) && Number.isFinite(center.lon));
}
console.log(JSON.stringify({ tiles: TILE_COUNT, areaRatio: maxArea / minArea,
  sizeKm: [Math.round(minWidth), Math.round(maxWidth)],
  polarSizeKm: [Math.round(minPolarWidth), Math.round(maxPolarWidth)], maxInverseError }));
