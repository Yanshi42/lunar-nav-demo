const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;

function image(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`无法读取地形资源：${src}`));
    img.src = src;
  });
}

export class Terrain {
  constructor(canvas, profileCanvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.profileCanvas = profileCanvas;
    this.profileCtx = profileCanvas.getContext("2d");
    this.tile = null;
    this.ppd = 16;
    this.values = null;
    this.relief = document.createElement("canvas");
    this.relief.width = this.relief.height = 80;
    this.reliefCtx = this.relief.getContext("2d", { willReadFrequently: true });
    this.riskCanvas = document.createElement("canvas");
    this.riskCanvas.width = this.riskCanvas.height = 256;
    this.view = "2d";
    this.layers = { terrain: true, risk: true, grid: true };
    this.camera = { yaw: -0.45, pitch: 0.68, zoom: 1, exaggeration: 4 };
    this.route = [];
    this.points = [];
    this.drag = null;
    this.changed = false;
    this.canvas.style.touchAction = "none";
    window.addEventListener("resize", () => this.draw());
  }

  async load(tile) {
    const band = String(tile.row).padStart(2, "0");
    const [height, relief] = await Promise.all([
      image(`assets/height-band-${band}.png`),
      image(`assets/relief-band-${band}.jpg`),
    ]);
    const size = this.ppd * 5;
    const cropX = tile.col * size;
    const raw = document.createElement("canvas");
    raw.width = raw.height = size;
    const rawCtx = raw.getContext("2d", { willReadFrequently: true });
    rawCtx.drawImage(height, cropX, 0, size, size, 0, 0, size, size);
    const bytes = rawCtx.getImageData(0, 0, size, size).data;
    const values = new Float32Array(size * size);
    let min = Infinity, max = -Infinity, total = 0;
    for (let i = 0; i < values.length; i++) {
      const elevation = (bytes[i * 4] * 256 + bytes[i * 4 + 1]) * 0.5 - 10000;
      values[i] = elevation;
      min = Math.min(min, elevation); max = Math.max(max, elevation); total += elevation;
    }
    this.tile = tile;
    this.values = values;
    this.size = size;
    this.relief.width = this.relief.height = size;
    this.min = min;
    this.max = max;
    this.mean = total / values.length;
    this.widthKm = Math.PI * 1737.4 / 180 * 5 * Math.cos(tile.lat * Math.PI / 180);
    this.heightKm = Math.PI * 1737.4 / 180 * 5;
    this.reliefCtx.clearRect(0, 0, size, size);
    this.reliefCtx.drawImage(relief, cropX, 0, size, size, 0, 0, size, size);
    this.reliefPixels = this.reliefCtx.getImageData(0, 0, size, size).data;
    this.buildRisk();
    this.draw();
  }

  elevation(point) {
    if (!this.values) return 0;
    const px = clamp(point.x, 0, 1) * (this.size - 1), py = clamp(point.y, 0, 1) * (this.size - 1);
    const x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(this.size - 1, x0 + 1), y1 = Math.min(this.size - 1, y0 + 1);
    const tx = px - x0, ty = py - y0;
    const row0 = lerp(this.values[y0 * this.size + x0], this.values[y0 * this.size + x1], tx);
    const row1 = lerp(this.values[y1 * this.size + x0], this.values[y1 * this.size + x1], tx);
    return lerp(row0, row1, ty);
  }

  slope(point) {
    const dx = 1 / (this.size - 1), dy = dx;
    const west = this.elevation({ x: point.x - dx, y: point.y });
    const east = this.elevation({ x: point.x + dx, y: point.y });
    const north = this.elevation({ x: point.x, y: point.y - dy });
    const south = this.elevation({ x: point.x, y: point.y + dy });
    const mx = 2 * dx * this.widthKm * 1000;
    const my = 2 * dy * this.heightKm * 1000;
    return Math.atan(Math.hypot((east - west) / mx, (south - north) / my)) * 180 / Math.PI;
  }

  buildRisk() {
    const ctx = this.riskCanvas.getContext("2d");
    const data = ctx.createImageData(256, 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const slope = this.slope({ x: x / 255, y: y / 255 });
      const alpha = clamp((slope - 5) / 17, 0, 1) * 112;
      const i = (y * 256 + x) * 4;
      data.data[i] = 255; data.data[i + 1] = 85; data.data[i + 2] = 98; data.data[i + 3] = alpha;
    }
    ctx.putImageData(data, 0, 0);
  }

  resize(canvas, ctx) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width: rect.width, height: rect.height };
  }

  rect(width, height) {
    const size = Math.max(1, Math.min(width - 32, height - 32));
    return { x: (width - size) / 2, y: (height - size) / 2, size };
  }

  localPoint(event) {
    const bounds = this.canvas.getBoundingClientRect();
    const rect = this.rect(bounds.width, bounds.height);
    const x = (event.clientX - bounds.left - rect.x) / rect.size;
    const y = (event.clientY - bounds.top - rect.y) / rect.size;
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
  }

  draw() {
    if (!this.values) return;
    const dim = this.resize(this.canvas, this.ctx);
    if (!dim) return;
    this.ctx.clearRect(0, 0, dim.width, dim.height);
    if (this.view === "3d") this.draw3d(dim.width, dim.height);
    else this.draw2d(dim.width, dim.height);
  }

  draw2d(width, height) {
    const r = this.rect(width, height), ctx = this.ctx;
    ctx.fillStyle = "#0f2731"; ctx.fillRect(r.x, r.y, r.size, r.size);
    if (this.layers.terrain) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(this.relief, r.x, r.y, r.size, r.size);
    }
    if (this.layers.risk) ctx.drawImage(this.riskCanvas, r.x, r.y, r.size, r.size);
    if (this.layers.grid) {
      ctx.beginPath();
      for (let i = 1; i < 40; i++) {
        const p = r.x + i / 40 * r.size, q = r.y + i / 40 * r.size;
        ctx.moveTo(p, r.y); ctx.lineTo(p, r.y + r.size);
        ctx.moveTo(r.x, q); ctx.lineTo(r.x + r.size, q);
      }
      ctx.strokeStyle = "rgba(185, 240, 237, .075)"; ctx.lineWidth = 0.5; ctx.stroke();
    }
    this.strokeRoute((p) => ({ x: r.x + p.x * r.size, y: r.y + p.y * r.size }), 2.7);
    this.points.forEach((point) => this.marker(r.x + point.x * r.size, r.y + point.y * r.size, point.label, point.color));
    ctx.strokeStyle = "rgba(113, 222, 213, .42)"; ctx.lineWidth = 1; ctx.strokeRect(r.x, r.y, r.size, r.size);
  }

  project3d(point, width, height) {
    const x = (point.x - 0.5) * 2, y = (point.y - 0.5) * 2;
    const effectiveKm = Math.max(25, Math.min(this.widthKm, this.heightKm));
    const z = ((this.elevation(point) - this.mean) / (effectiveKm * 1000)) * 2 * this.camera.exaggeration;
    const cy = Math.cos(this.camera.yaw), sy = Math.sin(this.camera.yaw);
    const xp = x * cy - y * sy, yp = x * sy + y * cy;
    const cp = Math.cos(this.camera.pitch), sp = Math.sin(this.camera.pitch);
    const screenY = yp * cp - z * sp, depth = yp * sp + z * cp;
    const perspective = 1 / (2.8 + depth * 0.22);
    const scale = Math.min(width, height) * 1.35 * this.camera.zoom;
    return { x: width / 2 + xp * scale * perspective,
      y: height / 2 + screenY * scale * perspective + height * 0.035, depth };
  }

  color(x, y, shade = 1) {
    const ix = clamp(Math.round(x * (this.size - 1)), 0, this.size - 1);
    const iy = clamp(Math.round(y * (this.size - 1)), 0, this.size - 1);
    const index = (iy * this.size + ix) * 4;
    return `rgb(${Math.round(this.reliefPixels[index] * shade)},${Math.round(this.reliefPixels[index + 1] * shade)},${Math.round(this.reliefPixels[index + 2] * shade)})`;
  }

  draw3d(width, height) {
    const ctx = this.ctx;
    ctx.fillStyle = "#050b11"; ctx.fillRect(0, 0, width, height);
    const n = 92, cells = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const corners = [this.project3d({ x: x / n, y: y / n }, width, height),
        this.project3d({ x: (x + 1) / n, y: y / n }, width, height),
        this.project3d({ x: (x + 1) / n, y: (y + 1) / n }, width, height),
        this.project3d({ x: x / n, y: (y + 1) / n }, width, height)];
      cells.push({ x, y, corners, depth: corners.reduce((sum, p) => sum + p.depth, 0) / 4 });
    }
    cells.sort((a, b) => b.depth - a.depth);
    for (const cell of cells) {
      const u = (cell.x + 0.5) / n, v = (cell.y + 0.5) / n;
      const slope = this.slope({ x: u, y: v });
      ctx.beginPath(); ctx.moveTo(cell.corners[0].x, cell.corners[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(cell.corners[i].x, cell.corners[i].y);
      ctx.closePath();
      ctx.fillStyle = this.layers.terrain ? this.color(u, v, 0.92) : "#12313b";
      ctx.fill();
      if (this.layers.risk && slope > 7) {
        ctx.fillStyle = `rgba(255, 82, 93, ${clamp((slope - 7) / 23, 0, 0.36)})`;
        ctx.fill();
      }
      if (this.layers.grid && (cell.x % 8 === 0 || cell.y % 8 === 0)) {
        ctx.strokeStyle = "rgba(189, 240, 235, .055)"; ctx.lineWidth = 0.45; ctx.stroke();
      }
    }
    this.strokeRoute((p) => { const result = this.project3d(p, width, height); return { x: result.x, y: result.y - 2 }; }, 2.5);
    this.points.forEach((point) => { const p = this.project3d(point, width, height); this.marker(p.x, p.y - 2, point.label, point.color); });
  }

  strokeRoute(project, width) {
    if (this.route.length < 2) return;
    const ctx = this.ctx;
    ctx.beginPath();
    this.route.forEach((point, index) => {
      const p = project(point);
      if (!index) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    });
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(3, 9, 12, .9)"; ctx.lineWidth = width + 4; ctx.stroke();
    ctx.strokeStyle = "#ffd568"; ctx.lineWidth = width; ctx.stroke();
  }

  marker(x, y, label, color) {
    const ctx = this.ctx;
    ctx.beginPath(); ctx.arc(x, y, 10, 0, 2 * Math.PI);
    ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#061017"; ctx.stroke();
    ctx.fillStyle = "#061017"; ctx.font = "800 9px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, x, y + 0.5);
  }

  profile(points) {
    const dim = this.resize(this.profileCanvas, this.profileCtx);
    if (!dim) return;
    const ctx = this.profileCtx;
    ctx.clearRect(0, 0, dim.width, dim.height);
    if (points.length < 2) return;
    const values = points.map((point) => this.elevation(point));
    const min = Math.min(...values), max = Math.max(...values), pad = 8;
    ctx.beginPath();
    values.forEach((value, index) => {
      const x = pad + index / (values.length - 1) * (dim.width - pad * 2);
      const y = dim.height - pad - (value - min) / Math.max(max - min, 1) * (dim.height - pad * 2);
      if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    const gradient = ctx.createLinearGradient(0, 0, dim.width, 0);
    gradient.addColorStop(0, "#5ce1d0"); gradient.addColorStop(1, "#ffd25a");
    ctx.strokeStyle = gradient; ctx.lineWidth = 1.7; ctx.stroke();
    ctx.fillStyle = "#78939a"; ctx.font = "10px system-ui";
    ctx.fillText(`${Math.round(max)} m`, 7, 12);
    ctx.fillText(`${Math.round(min)} m`, 7, dim.height - 4);
  }
}
