import { CELLS_PER_FACE, coordinateVector, faceVector, tileFromCoordinate,
  tileVector, vectorCoordinate } from "./sphere-grid.js";
const norm = (v) => { const d = Math.hypot(...v) || 1; return v.map((x) => x / d); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const conjugate = (q) => [-q[0], -q[1], -q[2], q[3]];
const multiply = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const rotate = (q, v) => {
  const u = q.slice(0, 3), uv = cross(u, v), uuv = cross(u, uv);
  return v.map((value, i) => value + 2 * (uv[i] * q[3] + uuv[i]));
};
const fromTo = (a, b) => {
  const axis = cross(a, b);
  const w = 1 + dot(a, b);
  if (w < 1e-7) return [...norm(cross(a, Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), 0];
  return norm([...axis, w]);
};
export class LunarGlobe {
  constructor(canvas, texture, onSelect) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.texture = texture;
    this.onSelect = onSelect;
    this.orientation = [0, 0, 0, 1];
    this.zoom = 1;
    this.selected = null;
    this.hover = null;
    this.drag = null;
    this.pending = false;
    this.textureCanvas = document.createElement("canvas");
    this.textureCanvas.width = texture.naturalWidth;
    this.textureCanvas.height = texture.naturalHeight;
    this.textureCanvas.getContext("2d", { willReadFrequently: true }).drawImage(texture, 0, 0);
    this.pixels = this.textureCanvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, texture.naturalWidth, texture.naturalHeight).data;
    this.raster = document.createElement("canvas");
    this.rasterCtx = this.raster.getContext("2d");
    this.bind();
    this.invalidate();
  }

  geometry() {
    const box = this.canvas.getBoundingClientRect();
    return { width: box.width, height: box.height, cx: box.width / 2, cy: box.height / 2,
      radius: Math.min(box.width, box.height) * 0.43 * this.zoom };
  }

  localPoint(event) {
    const box = this.canvas.getBoundingClientRect();
    const g = this.geometry();
    const x = (event.clientX - box.left - g.cx) / g.radius;
    const y = (g.cy - (event.clientY - box.top)) / g.radius;
    const r2 = x * x + y * y;
    if (r2 > 1) return null;
    return [x, y, Math.sqrt(1 - r2)];
  }

  coordinateAt(event) {
    const eye = this.localPoint(event);
    if (!eye) return null;
    const world = rotate(conjugate(this.orientation), eye);
    return vectorCoordinate(world);
  }

  centerOn(lat, lon) {
    this.orientation = fromTo(coordinateVector(lat, lon), [0, 0, 1]);
    this.invalidate();
  }

  select(tile) { this.selected = tile; this.invalidate(); }

  bind() {
    this.canvas.addEventListener("pointerdown", (event) => {
      const v = this.localPoint(event);
      if (!v) return;
      this.canvas.setPointerCapture(event.pointerId);
      this.drag = { previous: v, x: event.clientX, y: event.clientY, moved: false };
    });
    this.canvas.addEventListener("pointermove", (event) => {
      const coord = this.coordinateAt(event);
      this.hover = coord ? tileFromCoordinate(coord.lat, coord.lon) : null;
      if (this.drag) {
        const next = this.localPoint(event);
        if (next) {
          this.orientation = norm(multiply(fromTo(this.drag.previous, next), this.orientation));
          this.drag.previous = next;
        }
        if (Math.hypot(event.clientX - this.drag.x, event.clientY - this.drag.y) > 4) this.drag.moved = true;
      }
      this.invalidate();
    });
    this.canvas.addEventListener("pointerup", (event) => {
      if (this.drag && !this.drag.moved) {
        const coord = this.coordinateAt(event);
        if (coord) this.onSelect(tileFromCoordinate(coord.lat, coord.lon));
      }
      this.drag = null;
    });
    this.canvas.addEventListener("pointercancel", () => { this.drag = null; });
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.zoom = Math.min(1.22, Math.max(0.72, this.zoom * (event.deltaY > 0 ? 0.94 : 1.06)));
      this.invalidate();
    }, { passive: false });
    window.addEventListener("resize", () => this.invalidate());
  }

  invalidate() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; this.draw(); });
  }

  draw() {
    const g = this.geometry();
    if (!g.width || !g.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(g.width * dpr);
    this.canvas.height = Math.round(g.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, g.width, g.height);

    const size = Math.min(500, Math.max(260, Math.round(g.radius * 2)));
    this.raster.width = this.raster.height = size;
    const image = this.rasterCtx.createImageData(size, size);
    const output = image.data;
    const source = this.pixels;
    const texW = this.texture.naturalWidth, texH = this.texture.naturalHeight;
    const inverse = conjugate(this.orientation);
    const half = size / 2;
    const light = [-0.42, 0.48, 0.77];
    for (let py = 0; py < size; py++) {
      const ey = (half - py - 0.5) / half;
      for (let px = 0; px < size; px++) {
        const ex = (px + 0.5 - half) / half;
        const d2 = ex * ex + ey * ey;
        if (d2 > 1) continue;
        const ez = Math.sqrt(1 - d2);
        const world = rotate(inverse, [ex, ey, ez]);
        const lon = Math.atan2(world[0], world[2]);
        const lat = Math.asin(Math.max(-1, Math.min(1, world[1])));
        const tx = Math.min(texW - 1, Math.max(0, Math.floor((lon / (2 * Math.PI) + 0.5) * texW)));
        const ty = Math.min(texH - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * texH)));
        const src = (ty * texW + tx) * 4, dst = (py * size + px) * 4;
        const illumination = Math.max(0.22, 0.39 + 0.65 * (ex * light[0] + ey * light[1] + ez * light[2]));
        output[dst] = source[src] * illumination;
        output[dst + 1] = source[src + 1] * illumination;
        output[dst + 2] = source[src + 2] * illumination;
        output[dst + 3] = 255;
      }
    }
    this.rasterCtx.putImageData(image, 0, 0);
    this.ctx.save();
    this.ctx.shadowColor = "rgba(79, 174, 199, .22)";
    this.ctx.shadowBlur = 42;
    this.ctx.drawImage(this.raster, g.cx - g.radius, g.cy - g.radius, g.radius * 2, g.radius * 2);
    this.ctx.restore();
    this.ctx.beginPath(); this.ctx.arc(g.cx, g.cy, g.radius, 0, Math.PI * 2);
    this.ctx.strokeStyle = "rgba(120, 204, 213, .48)"; this.ctx.lineWidth = 1; this.ctx.stroke();
    this.drawGrid(g);
    if (this.hover) this.drawTile(this.hover, g, "rgba(255, 210, 90, .7)", 1.2);
    if (this.selected) this.drawTile(this.selected, g, "#69f2df", 2.5);
  }

  project(lat, lon, g) {
    return this.projectVector(coordinateVector(lat, lon), g);
  }

  projectVector(vector, g) {
    const eye = rotate(this.orientation, vector);
    return { x: g.cx + eye[0] * g.radius, y: g.cy - eye[1] * g.radius, visible: eye[2] >= 0 };
  }

  drawGrid(g) {
    const ctx = this.ctx;
    ctx.strokeStyle = "rgba(175, 240, 236, .12)";
    ctx.lineWidth = 0.55;
    const samples = CELLS_PER_FACE * 6;
    for (let face = 0; face < 6; face++) for (let axis = 0; axis < 2; axis++) {
      for (let line = 0; line <= CELLS_PER_FACE; line++) {
        const fixed = -1 + line * 2 / CELLS_PER_FACE;
        ctx.beginPath(); let pen = false;
        for (let step = 0; step <= samples; step++) {
          const free = -1 + step * 2 / samples;
          const p = this.projectVector(faceVector(face, axis ? free : fixed, axis ? fixed : free), g);
          if (p.visible) { if (!pen) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); pen = true; }
          else pen = false;
        }
        ctx.stroke();
      }
    }
  }

  drawTile(tile, g, color, width) {
    const ctx = this.ctx;
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    ctx.beginPath(); let drawn = false;
    for (let edge = 0; edge < 4; edge++) {
      for (let step = 0; step <= 10; step++) {
        const t = step / 10;
        const p = this.projectVector(tileVector(tile,
          corners[edge][0] * (1 - t) + corners[edge + 1][0] * t,
          corners[edge][1] * (1 - t) + corners[edge + 1][1] * t), g);
        if (p.visible) { if (!drawn) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); drawn = true; }
        else drawn = false;
      }
    }
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.shadowColor = color; ctx.shadowBlur = width * 6; ctx.stroke(); ctx.shadowBlur = 0;
    const center = this.project(tile.lat, tile.lon, g);
    if (center.visible) {
      ctx.beginPath(); ctx.arc(center.x, center.y, width + 2, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
    }
  }
}
