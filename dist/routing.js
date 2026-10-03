const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

class MinHeap {
  constructor() { this.items = []; }
  push(value) {
    const a = this.items; a.push(value); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.items, first = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      while (true) {
        const l = i * 2 + 1, r = l + 1;
        let j = i;
        if (l < a.length && a[l].f < a[j].f) j = l;
        if (r < a.length && a[r].f < a[j].f) j = r;
        if (i === j) break;
        [a[i], a[j]] = [a[j], a[i]]; i = j;
      }
    }
    return first;
  }
  get length() { return this.items.length; }
}

export class Router {
  constructor(terrain, gridSize = 128) {
    this.terrain = terrain;
    this.n = gridSize;
    this.heights = null;
    this.slopes = null;
  }

  prepare() {
    const n = this.n, terrain = this.terrain;
    this.heights = new Float32Array(n * n);
    this.slopes = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      this.heights[y * n + x] = terrain.elevation({ x: x / (n - 1), y: y / (n - 1) });
    }
    const mx = terrain.widthKm * 1000 / (n - 1), my = terrain.heightKm * 1000 / (n - 1);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const left = this.heights[y * n + Math.max(0, x - 1)];
      const right = this.heights[y * n + Math.min(n - 1, x + 1)];
      const up = this.heights[Math.max(0, y - 1) * n + x];
      const down = this.heights[Math.min(n - 1, y + 1) * n + x];
      const dx = (right - left) / (mx * (x === 0 || x === n - 1 ? 1 : 2));
      const dy = (down - up) / (my * (y === 0 || y === n - 1 ? 1 : 2));
      this.slopes[y * n + x] = Math.atan(Math.hypot(dx, dy)) * 180 / Math.PI;
    }
  }

  path(startPoint, endPoint, risk = 7) {
    if (!this.heights) this.prepare();
    const n = this.n, terrain = this.terrain;
    const toIndex = (point) => clamp(Math.round(point.y * (n - 1)), 0, n - 1) * n
      + clamp(Math.round(point.x * (n - 1)), 0, n - 1);
    const start = toIndex(startPoint), goal = toIndex(endPoint);
    if (start === goal) return { points: [startPoint, endPoint], cost: 0 };
    const g = new Float64Array(n * n); g.fill(Infinity); g[start] = 0;
    const previous = new Int32Array(n * n); previous.fill(-1);
    const visited = new Uint8Array(n * n);
    const heap = new MinHeap();
    const stepX = terrain.widthKm / (n - 1), stepY = terrain.heightKm / (n - 1);
    const goalX = goal % n, goalY = Math.floor(goal / n);
    const heuristic = (x, y) => Math.hypot((goalX - x) * stepX, (goalY - y) * stepY);
    heap.push({ id: start, f: heuristic(start % n, Math.floor(start / n)) });
    const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];

    while (heap.length) {
      const current = heap.pop();
      if (visited[current.id]) continue;
      visited[current.id] = 1;
      if (current.id === goal) break;
      const x = current.id % n, y = Math.floor(current.id / n);
      for (const [dx, dy] of neighbors) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= n || ny < 0 || ny >= n) continue;
        const next = ny * n + nx;
        if (visited[next]) continue;
        const slope = (this.slopes[current.id] + this.slopes[next]) / 2;
        const step = Math.hypot(dx * stepX, dy * stepY);
        const penalty = 1 + (risk / 7) * Math.pow(slope / 11, 1.55) * 1.6
          + Math.max(0, slope - 22) ** 2 * 10;
        const candidate = g[current.id] + step * penalty;
        if (candidate < g[next]) {
          g[next] = candidate; previous[next] = current.id;
          heap.push({ id: next, f: candidate + heuristic(nx, ny) });
        }
      }
    }
    if (!Number.isFinite(g[goal])) return null;
    const points = [endPoint];
    let cursor = goal;
    while (cursor !== start && previous[cursor] !== -1) {
      cursor = previous[cursor];
      points.push({ x: cursor % n / (n - 1), y: Math.floor(cursor / n) / (n - 1) });
    }
    points.reverse(); points[0] = startPoint;
    return { points: this.smooth(points), cost: g[goal] };
  }

  smooth(points) {
    if (points.length < 3) return points;
    let result = points;
    for (let pass = 0; pass < 2; pass++) {
      const next = [result[0]];
      for (let i = 0; i < result.length - 1; i++) {
        const a = result[i], b = result[i + 1];
        next.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y });
        next.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
      }
      next.push(result[result.length - 1]);
      result = next;
    }
    return result;
  }

  async ordered(points, risk, onProgress = () => {}) {
    const legs = [];
    for (let i = 0; i < points.length - 1; i++) {
      onProgress(i + 1, points.length - 1);
      const leg = this.path(points[i], points[i + 1], risk);
      if (!leg) return null;
      legs.push(leg);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return { order: points, legs, route: legs.flatMap((leg, i) => i ? leg.points.slice(1) : leg.points) };
  }

  async unordered(start, targets, end, risk, onProgress = () => {}) {
    if (targets.length < 2 || targets.length > 8) return null;
    const nodes = [...(start ? [start] : []), ...targets, ...(end ? [end] : [])];
    const cache = new Map();
    const pairKey = (a, b) => `${Math.min(a, b)}:${Math.max(a, b)}`;
    const total = nodes.length * (nodes.length - 1) / 2;
    let done = 0;
    for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
      const leg = this.path(nodes[a], nodes[b], risk);
      if (!leg) return null;
      cache.set(pairKey(a, b), leg);
      onProgress(++done, total);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const targetOffset = start ? 1 : 0;
    const endIndex = end ? nodes.length - 1 : null;
    const n = targets.length, full = (1 << n) - 1;
    const dp = Array.from({ length: 1 << n }, () => new Float64Array(n).fill(Infinity));
    const back = Array.from({ length: 1 << n }, () => new Int8Array(n).fill(-1));
    const cost = (a, b) => cache.get(pairKey(a, b)).cost;
    for (let i = 0; i < n; i++) dp[1 << i][i] = start ? cost(0, targetOffset + i) : 0;
    for (let mask = 1; mask <= full; mask++) for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i)) || !Number.isFinite(dp[mask][i])) continue;
      for (let j = 0; j < n; j++) {
        if (mask & (1 << j)) continue;
        const next = mask | (1 << j);
        const candidate = dp[mask][i] + cost(targetOffset + i, targetOffset + j);
        if (candidate < dp[next][j]) { dp[next][j] = candidate; back[next][j] = i; }
      }
    }
    let last = -1, best = Infinity;
    for (let i = 0; i < n; i++) {
      const value = dp[full][i] + (end ? cost(targetOffset + i, endIndex) : 0);
      if (value < best) { best = value; last = i; }
    }
    const visitIndices = [];
    let mask = full;
    while (last >= 0) {
      visitIndices.push(targetOffset + last);
      const previous = back[mask][last];
      mask &= ~(1 << last);
      last = previous;
    }
    visitIndices.reverse();
    const orderIndices = [...(start ? [0] : []), ...visitIndices, ...(end ? [endIndex] : [])];
    const legs = [];
    for (let i = 0; i < orderIndices.length - 1; i++) {
      const a = orderIndices[i], b = orderIndices[i + 1];
      const leg = cache.get(pairKey(a, b));
      legs.push(a < b ? leg : { cost: leg.cost, points: [...leg.points].reverse() });
    }
    return {
      order: orderIndices.map((index) => nodes[index]),
      visitOrder: visitIndices.map((index) => index - targetOffset + 1),
      legs,
      route: legs.flatMap((leg, i) => i ? leg.points.slice(1) : leg.points),
      cost: best,
    };
  }
}
