const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  regions: [],
  region: null,
  heightImage: null,
  reliefImage: null,
  heightPixels: null,
  reliefPixels: null,
  view: "2d",
  start: { x: 0.68, y: 0.18 },
  end: { x: 0.27, y: 0.78 },
  route: [],
  selecting: "start",
  risk: 7,
  layers: { terrain: true, risk: true, grid: true },
  camera: { yaw: -0.55, pitch: 0.78, zoom: 1 },
  drag: null,
  moon: { offset: 0, zoom: 1, drag: null },
};

const terrainCanvas = $("#terrainCanvas");
const terrainCtx = terrainCanvas.getContext("2d");
const moonCanvas = $("#moonCanvas");
const moonCtx = moonCanvas.getContext("2d");
const profileCanvas = $("#profileCanvas");
const profileCtx = profileCanvas.getContext("2d");
const samplingCanvas = document.createElement("canvas");
const samplingCtx = samplingCanvas.getContext("2d", { willReadFrequently: true });
const moonTexture = new Image();
moonTexture.src = "assets/moon-color.jpg";

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function formatSigned(value, positive, negative) {
  return `${Math.abs(value).toFixed(2)}°${value >= 0 ? positive : negative}`;
}
function regionCoordinate(region, point) {
  const lat = region.lat + (0.5 - point.y) * region.span;
  const lon = region.lon + (point.x - 0.5) * region.span;
  return { lat, lon };
}
function elevationAt(point) {
  if (!state.heightPixels || !state.region) return 0;
  const x = clamp(Math.round(point.x * 767), 0, 767);
  const y = clamp(Math.round(point.y * 767), 0, 767);
  const gray = state.heightPixels[(y * 768 + x) * 4];
  return lerp(state.region.minElevation, state.region.maxElevation, gray / 255);
}
function sampleGray(x, y) {
  if (!state.heightPixels) return 0;
  const px = clamp(Math.round(x * 767), 0, 767);
  const py = clamp(Math.round(y * 767), 0, 767);
  return state.heightPixels[(py * 768 + px) * 4] / 255;
}

function resizeCanvas(canvas, ctx) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width: rect.width, height: rect.height, dpr };
}

function populateRegions() {
  const select = $("#regionSelect");
  select.innerHTML = state.regions.map((r) => `<option value="${r.id}">${r.name} · ${r.subtitle.split("·")[0]}</option>`).join("");
  select.addEventListener("change", () => {
    const region = state.regions.find((item) => item.id === select.value);
    previewRegion(region);
  });
  previewRegion(state.regions[0]);
}

function previewRegion(region) {
  state.region = region;
  $("#regionCoordinates").textContent = `${formatSigned(region.lat, "N", "S")}  ${formatSigned(region.lon, "E", "W")}`;
  $("#regionPreview").style.backgroundImage = `linear-gradient(90deg,rgba(5,18,25,.1),rgba(5,18,25,.1)),url('${region.reliefAsset}')`;
}

async function loadRegion(region) {
  state.region = region;
  $("#canvasLoading").hidden = false;
  const [heightImage, reliefImage] = await Promise.all([loadImage(region.heightAsset), loadImage(region.reliefAsset)]);
  state.heightImage = heightImage;
  state.reliefImage = reliefImage;
  samplingCanvas.width = samplingCanvas.height = 768;
  samplingCtx.drawImage(heightImage, 0, 0, 768, 768);
  state.heightPixels = samplingCtx.getImageData(0, 0, 768, 768).data;
  samplingCtx.clearRect(0, 0, 768, 768);
  samplingCtx.drawImage(reliefImage, 0, 0, 768, 768);
  state.reliefPixels = samplingCtx.getImageData(0, 0, 768, 768).data;

  $("#plannerRegionName").textContent = region.name;
  $("#plannerRegionSubtitle").textContent = region.subtitle;
  $("#mapRegionLabel").textContent = `${region.name} · ${region.span.toFixed(0)}° × ${region.span.toFixed(0)}°`;
  const north = region.lat + region.span / 2;
  const south = region.lat - region.span / 2;
  const west = region.lon - region.span / 2;
  const east = region.lon + region.span / 2;
  $("#mapBounds").textContent = `${formatSigned(south,"N","S")}—${formatSigned(north,"N","S")} · ${formatSigned(west,"E","W")}—${formatSigned(east,"E","W")}`;
  $("#scaleLabel").textContent = `${Math.round(region.widthKm / 4)} km`;
  state.start = { x: 0.68, y: 0.18 };
  state.end = { x: 0.27, y: 0.78 };
  state.route = [];
  state.selecting = "start";
  updatePointLabels();
  $("#canvasLoading").hidden = true;
  planRoute();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function updatePointLabels() {
  for (const [key, selector] of [["start", "#startCoord"], ["end", "#endCoord"]]) {
    if (!state[key]) { $(selector).textContent = "未选择"; continue; }
    const c = regionCoordinate(state.region, state[key]);
    $(selector).textContent = `${formatSigned(c.lat,"N","S")} · ${formatSigned(c.lon,"E","W")}`;
  }
  $("#mapHint").textContent = state.selecting === "start" ? "单击地图重新设置起点" : "单击地图设置终点";
}

function terrainSlope(point) {
  const delta = 1 / 767;
  const dx = elevationAt({ x: clamp(point.x + delta, 0, 1), y: point.y }) - elevationAt({ x: clamp(point.x - delta, 0, 1), y: point.y });
  const dy = elevationAt({ x: point.x, y: clamp(point.y + delta, 0, 1) }) - elevationAt({ x: point.x, y: clamp(point.y - delta, 0, 1) });
  const metersX = state.region.widthKm * 1000 / 767 * 2;
  const metersY = state.region.heightKm * 1000 / 767 * 2;
  return Math.atan(Math.hypot(dx / metersX, dy / metersY)) * 180 / Math.PI;
}

function planRoute() {
  if (!state.start || !state.end || !state.heightPixels) return;
  const size = 82;
  const start = { x: Math.round(state.start.x * (size - 1)), y: Math.round(state.start.y * (size - 1)) };
  const goal = { x: Math.round(state.end.x * (size - 1)), y: Math.round(state.end.y * (size - 1)) };
  const key = (x, y) => y * size + x;
  const pointFromGrid = (x, y) => ({ x: x / (size - 1), y: y / (size - 1) });
  const open = [{ ...start, f: 0 }];
  const heapPush = (item) => {
    open.push(item);
    let index = open.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (open[parent].f <= open[index].f) break;
      [open[parent], open[index]] = [open[index], open[parent]];
      index = parent;
    }
  };
  const heapPop = () => {
    const first = open[0];
    const last = open.pop();
    if (open.length && last) {
      open[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1, right = left + 1;
        let smallest = index;
        if (left < open.length && open[left].f < open[smallest].f) smallest = left;
        if (right < open.length && open[right].f < open[smallest].f) smallest = right;
        if (smallest === index) break;
        [open[index], open[smallest]] = [open[smallest], open[index]];
        index = smallest;
      }
    }
    return first;
  };
  const cameFrom = new Map();
  const gScore = new Map([[key(start.x, start.y), 0]]);
  const closed = new Set();
  const directions = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
  const riskWeight = state.risk * 0.78;
  let iterations = 0;
  let found = false;

  while (open.length && iterations++ < 28000) {
    const current = heapPop();
    const currentKey = key(current.x, current.y);
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);
    if (current.x === goal.x && current.y === goal.y) { found = true; break; }

    for (const [dx, dy] of directions) {
      const nx = current.x + dx, ny = current.y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const nextKey = key(nx, ny);
      if (closed.has(nextKey)) continue;
      const p = pointFromGrid(nx, ny);
      const slope = terrainSlope(p);
      if (slope > 18 && !(nx === goal.x && ny === goal.y)) continue;
      const distance = dx && dy ? Math.SQRT2 : 1;
      const roughness = Math.pow(slope / 12, 1.65);
      const tentative = (gScore.get(currentKey) ?? Infinity) + distance * (1 + roughness * riskWeight);
      if (tentative < (gScore.get(nextKey) ?? Infinity)) {
        cameFrom.set(nextKey, currentKey);
        gScore.set(nextKey, tentative);
        const heuristic = Math.hypot(goal.x - nx, goal.y - ny);
        heapPush({ x: nx, y: ny, f: tentative + heuristic });
      }
    }
  }

  if (!found) {
    state.route = [state.start, state.end];
  } else {
    const path = [];
    let cursor = key(goal.x, goal.y);
    path.push(pointFromGrid(goal.x, goal.y));
    while (cursor !== key(start.x, start.y) && cameFrom.has(cursor)) {
      cursor = cameFrom.get(cursor);
      path.push(pointFromGrid(cursor % size, Math.floor(cursor / size)));
    }
    state.route = simplifyPath(path.reverse());
  }
  updateRouteMetrics();
  drawTerrain();
}

function simplifyPath(path) {
  if (path.length < 3) return path;
  const result = [path[0]];
  let previousAngle = null;
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i - 1], b = path[i], c = path[i + 1];
    const angle = Math.atan2(c.y - a.y, c.x - a.x);
    if (previousAngle === null || Math.abs(angle - previousAngle) > 0.08 || i % 5 === 0) result.push(b);
    previousAngle = angle;
  }
  result.push(path[path.length - 1]);
  return result;
}

function updateRouteMetrics() {
  if (state.route.length < 2) return;
  let distance = 0, climb = 0, maxSlope = 0;
  const elevations = state.route.map(elevationAt);
  for (let i = 1; i < state.route.length; i++) {
    const a = state.route[i - 1], b = state.route[i];
    const dx = (b.x - a.x) * state.region.widthKm;
    const dy = (b.y - a.y) * state.region.heightKm;
    const horizontal = Math.hypot(dx, dy);
    const dz = elevations[i] - elevations[i - 1];
    distance += Math.hypot(horizontal, dz / 1000);
    climb += Math.max(0, dz);
    maxSlope = Math.max(maxSlope, Math.atan2(Math.abs(dz), horizontal * 1000) * 180 / Math.PI);
  }
  $("#distanceMetric").textContent = `${distance.toFixed(1)} km`;
  $("#climbMetric").textContent = `${Math.round(climb)} m`;
  $("#slopeMetric").textContent = `${maxSlope.toFixed(1)}°`;
  $("#nodeMetric").textContent = `${state.route.length}`;
  drawProfile(elevations);
}

function drawProfile(values) {
  const { width, height } = resizeCanvas(profileCanvas, profileCtx);
  profileCtx.clearRect(0, 0, width, height);
  if (values.length < 2) return;
  const min = Math.min(...values), max = Math.max(...values);
  const pad = 8;
  profileCtx.beginPath();
  values.forEach((value, index) => {
    const x = pad + index / (values.length - 1) * (width - pad * 2);
    const y = height - pad - (value - min) / Math.max(max - min, 1) * (height - pad * 2);
    if (!index) profileCtx.moveTo(x, y); else profileCtx.lineTo(x, y);
  });
  const gradient = profileCtx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "#5ce1d0"); gradient.addColorStop(1, "#ffd25a");
  profileCtx.strokeStyle = gradient; profileCtx.lineWidth = 1.6; profileCtx.stroke();
  profileCtx.fillStyle = "#6f858d"; profileCtx.font = "9px system-ui";
  profileCtx.fillText(`${Math.round(max)} m`, 8, 10);
  profileCtx.fillText(`${Math.round(min)} m`, 8, height - 3);
}

function drawTerrain() {
  if (!state.reliefImage) return;
  const { width, height } = resizeCanvas(terrainCanvas, terrainCtx);
  terrainCtx.clearRect(0, 0, width, height);
  if (state.view === "3d") draw3d(width, height); else draw2d(width, height);
}

function mapRect(width, height) {
  const margin = 18;
  const size = Math.min(width - margin * 2, height - margin * 2);
  return { x: (width - size) / 2, y: (height - size) / 2, size };
}

function draw2d(width, height) {
  const rect = mapRect(width, height);
  terrainCtx.save();
  terrainCtx.shadowColor = "rgba(59,220,210,.15)"; terrainCtx.shadowBlur = 25;
  if (state.layers.terrain) terrainCtx.drawImage(state.reliefImage, rect.x, rect.y, rect.size, rect.size);
  else { terrainCtx.fillStyle = "#0f252d"; terrainCtx.fillRect(rect.x, rect.y, rect.size, rect.size); }
  terrainCtx.shadowBlur = 0;
  if (state.layers.risk) drawRiskOverlay(rect);
  if (state.layers.grid) drawGrid(rect);
  drawRoute2d(rect);
  terrainCtx.strokeStyle = "rgba(109,222,214,.45)"; terrainCtx.lineWidth = 1; terrainCtx.strokeRect(rect.x, rect.y, rect.size, rect.size);
  terrainCtx.restore();
}

function drawRiskOverlay(rect) {
  const cells = 34;
  const cell = rect.size / cells;
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
    const slope = terrainSlope({ x: (x + .5) / cells, y: (y + .5) / cells });
    if (slope < 4) continue;
    const alpha = clamp((slope - 4) / 18, 0, 1) * .42;
    terrainCtx.fillStyle = `rgba(255,77,91,${alpha})`;
    terrainCtx.fillRect(rect.x + x * cell, rect.y + y * cell, cell + .5, cell + .5);
  }
}

function drawGrid(rect) {
  terrainCtx.beginPath();
  const steps = 20;
  for (let i = 1; i < steps; i++) {
    const p = rect.x + rect.size * i / steps;
    terrainCtx.moveTo(p, rect.y); terrainCtx.lineTo(p, rect.y + rect.size);
    const q = rect.y + rect.size * i / steps;
    terrainCtx.moveTo(rect.x, q); terrainCtx.lineTo(rect.x + rect.size, q);
  }
  terrainCtx.strokeStyle = "rgba(174,245,235,.13)"; terrainCtx.lineWidth = .6; terrainCtx.stroke();
}

function drawRoute2d(rect) {
  if (state.route.length > 1) {
    terrainCtx.beginPath();
    state.route.forEach((point, index) => {
      const x = rect.x + point.x * rect.size, y = rect.y + point.y * rect.size;
      if (!index) terrainCtx.moveTo(x, y); else terrainCtx.lineTo(x, y);
    });
    terrainCtx.strokeStyle = "rgba(0,0,0,.72)"; terrainCtx.lineWidth = 6; terrainCtx.lineJoin = "round"; terrainCtx.stroke();
    terrainCtx.strokeStyle = "#ffd25a"; terrainCtx.lineWidth = 2.5; terrainCtx.stroke();
  }
  drawMarker2d(rect, state.start, "S", "#65ea84");
  drawMarker2d(rect, state.end, "E", "#ff5d6c");
}

function drawMarker2d(rect, point, label, color) {
  if (!point) return;
  const x = rect.x + point.x * rect.size, y = rect.y + point.y * rect.size;
  terrainCtx.beginPath(); terrainCtx.arc(x, y, 9, 0, Math.PI * 2);
  terrainCtx.fillStyle = color; terrainCtx.fill(); terrainCtx.strokeStyle = "rgba(1,8,10,.8)"; terrainCtx.lineWidth = 2; terrainCtx.stroke();
  terrainCtx.fillStyle = "#041011"; terrainCtx.font = "800 9px system-ui"; terrainCtx.textAlign = "center"; terrainCtx.textBaseline = "middle"; terrainCtx.fillText(label, x, y + .5);
}

function project3d(point, width, height) {
  const h = sampleGray(point.x, point.y);
  let x = (point.x - .5) * 2;
  let y = (point.y - .5) * 2;
  const z = h * .34;
  const cy = Math.cos(state.camera.yaw), sy = Math.sin(state.camera.yaw);
  const xp = x * cy - y * sy;
  const yp = x * sy + y * cy;
  const cp = Math.cos(state.camera.pitch), sp = Math.sin(state.camera.pitch);
  const screenY = yp * cp - z * sp;
  const depth = yp * sp + z * cp;
  const perspective = 1 / (2.8 + depth * .34);
  const scale = Math.min(width, height) * 1.34 * state.camera.zoom;
  return { x: width / 2 + xp * scale * perspective, y: height / 2 + screenY * scale * perspective + height * .06, depth };
}

function reliefColor(x, y, shade = 1) {
  const px = clamp(Math.round(x * 767), 0, 767), py = clamp(Math.round(y * 767), 0, 767);
  const index = (py * 768 + px) * 4;
  const r = state.reliefPixels[index], g = state.reliefPixels[index + 1], b = state.reliefPixels[index + 2];
  return `rgb(${Math.round(r * shade)},${Math.round(g * shade)},${Math.round(b * shade)})`;
}

function draw3d(width, height) {
  terrainCtx.fillStyle = "#04090e"; terrainCtx.fillRect(0, 0, width, height);
  const steps = 60;
  const cells = [];
  for (let y = 0; y < steps; y++) for (let x = 0; x < steps; x++) {
    const p = [
      project3d({ x:x/steps, y:y/steps }, width, height),
      project3d({ x:(x+1)/steps, y:y/steps }, width, height),
      project3d({ x:(x+1)/steps, y:(y+1)/steps }, width, height),
      project3d({ x:x/steps, y:(y+1)/steps }, width, height),
    ];
    cells.push({ x, y, p, depth:p.reduce((sum,v)=>sum+v.depth,0)/4 });
  }
  cells.sort((a,b)=>b.depth-a.depth);
  for (const cell of cells) {
    const u = (cell.x + .5) / steps, v = (cell.y + .5) / steps;
    const slope = terrainSlope({ x:u, y:v });
    let shade = .72 + sampleGray(u,v) * .42;
    terrainCtx.beginPath(); terrainCtx.moveTo(cell.p[0].x,cell.p[0].y); cell.p.slice(1).forEach(p=>terrainCtx.lineTo(p.x,p.y)); terrainCtx.closePath();
    terrainCtx.fillStyle = state.layers.terrain ? reliefColor(u,v,shade) : "#123039"; terrainCtx.fill();
    if (state.layers.risk && slope > 5) { terrainCtx.fillStyle = `rgba(255,72,86,${clamp((slope-5)/20,0,.5)})`; terrainCtx.fill(); }
    if (state.layers.grid && (cell.x%4===0 || cell.y%4===0)) { terrainCtx.strokeStyle="rgba(174,245,235,.08)"; terrainCtx.lineWidth=.5; terrainCtx.stroke(); }
  }
  if (state.route.length > 1) {
    terrainCtx.beginPath(); state.route.forEach((point,index)=>{const p=project3d(point,width,height); if(!index)terrainCtx.moveTo(p.x,p.y-2);else terrainCtx.lineTo(p.x,p.y-2);});
    terrainCtx.strokeStyle="rgba(0,0,0,.8)";terrainCtx.lineWidth=6;terrainCtx.lineJoin="round";terrainCtx.stroke();
    terrainCtx.strokeStyle="#ffd25a";terrainCtx.lineWidth=2.5;terrainCtx.stroke();
  }
  drawMarker3d(state.start,"S","#65ea84",width,height); drawMarker3d(state.end,"E","#ff5d6c",width,height);
}

function drawMarker3d(point,label,color,width,height) {
  if(!point)return; const p=project3d(point,width,height);
  terrainCtx.beginPath();terrainCtx.arc(p.x,p.y-3,8,0,Math.PI*2);terrainCtx.fillStyle=color;terrainCtx.fill();terrainCtx.strokeStyle="#061012";terrainCtx.lineWidth=2;terrainCtx.stroke();
  terrainCtx.fillStyle="#041011";terrainCtx.font="800 8px system-ui";terrainCtx.textAlign="center";terrainCtx.textBaseline="middle";terrainCtx.fillText(label,p.x,p.y-2.5);
}

function drawMoon() {
  const { width, height } = resizeCanvas(moonCanvas, moonCtx);
  moonCtx.clearRect(0,0,width,height);
  const radius = Math.min(width,height) * .43 * state.moon.zoom;
  const cx=width/2, cy=height/2;
  moonCtx.save(); moonCtx.beginPath(); moonCtx.arc(cx,cy,radius,0,Math.PI*2); moonCtx.clip();
  if(moonTexture.complete) {
    const texH=radius*2, texW=texH*2;
    let offset=((state.moon.offset%1)+1)%1*texW;
    for(let k=-1;k<=1;k++) moonCtx.drawImage(moonTexture,cx-radius-offset+k*texW,cy-radius,texW,texH);
  } else { moonCtx.fillStyle="#9eb0b2";moonCtx.fillRect(cx-radius,cy-radius,radius*2,radius*2); }
  let shade=moonCtx.createRadialGradient(cx-radius*.28,cy-radius*.35,radius*.1,cx,cy,radius*1.05);
  shade.addColorStop(0,"rgba(210,238,239,.18)");shade.addColorStop(.55,"rgba(16,31,37,.05)");shade.addColorStop(1,"rgba(0,4,7,.72)");moonCtx.fillStyle=shade;moonCtx.fillRect(cx-radius,cy-radius,radius*2,radius*2);
  moonCtx.restore();
  moonCtx.beginPath();moonCtx.arc(cx,cy,radius,0,Math.PI*2);moonCtx.strokeStyle="rgba(106,199,211,.34)";moonCtx.lineWidth=1.2;moonCtx.stroke();
  requestAnimationFrame(drawMoon);
}

function setPlannerVisible(visible) {
  $("#globeView").hidden = visible;
  $("#plannerView").hidden = !visible;
  window.scrollTo(0, 0);
  if(visible) setTimeout(drawTerrain,0);
}

function canvasPoint(event) {
  const rect=terrainCanvas.getBoundingClientRect();
  const map=mapRect(rect.width,rect.height);
  return { x:clamp((event.clientX-rect.left-map.x)/map.size,0,1), y:clamp((event.clientY-rect.top-map.y)/map.size,0,1) };
}

function setupEvents() {
  $("#enterPlanner").addEventListener("click", async()=>{setPlannerVisible(true);await loadRegion(state.region);});
  $("#brandButton").addEventListener("click",()=>setPlannerVisible(false));
  $("#aboutButton").addEventListener("click",()=>$("#aboutDialog").showModal());
  $("#closeDialog").addEventListener("click",()=>$("#aboutDialog").close());
  $("#riskSlider").addEventListener("input",(event)=>{state.risk=+event.target.value;$("#riskValue").textContent=state.risk;});
  $("#riskSlider").addEventListener("change",planRoute);
  $("#planRoute").addEventListener("click",planRoute);
  $("#clearRoute").addEventListener("click",()=>{state.start=null;state.end=null;state.route=[];state.selecting="start";updatePointLabels();drawTerrain();drawProfile([]);});
  $("#exportRoute").addEventListener("click",exportRoute);
  $$(".view-switch button").forEach(button=>button.addEventListener("click",()=>{$$(".view-switch button").forEach(b=>b.classList.remove("active"));button.classList.add("active");state.view=button.dataset.view;terrainCanvas.style.cursor=state.view==="3d"?"grab":"crosshair";drawTerrain();}));
  for(const [selector,key] of [["#terrainToggle","terrain"],["#riskToggle","risk"],["#gridToggle","grid"]]) $(selector).addEventListener("change",event=>{state.layers[key]=event.target.checked;drawTerrain();});

  terrainCanvas.addEventListener("click",event=>{
    if(state.view!=="2d" || state.drag?.moved)return;
    const point=canvasPoint(event);
    if(state.selecting==="start"){state.start=point;state.selecting="end";}else{state.end=point;state.selecting="start";}
    state.route=[];updatePointLabels();drawTerrain();if(state.start&&state.end)planRoute();
  });
  terrainCanvas.addEventListener("pointermove",event=>{
    if(state.view==="3d"&&state.drag){const dx=event.clientX-state.drag.x,dy=event.clientY-state.drag.y;state.camera.yaw+=dx*.008;state.camera.pitch=clamp(state.camera.pitch+dy*.006,.22,1.25);state.drag={x:event.clientX,y:event.clientY,moved:true};drawTerrain();return;}
    if(state.view==="2d"&&state.region){const p=canvasPoint(event),c=regionCoordinate(state.region,p);$("#cursorReadout").textContent=`${formatSigned(c.lat,"N","S")} · ${formatSigned(c.lon,"E","W")} · ${Math.round(elevationAt(p))} m`;}
  });
  terrainCanvas.addEventListener("pointerdown",event=>{if(state.view==="3d"){terrainCanvas.setPointerCapture(event.pointerId);state.drag={x:event.clientX,y:event.clientY,moved:false};terrainCanvas.style.cursor="grabbing";}});
  terrainCanvas.addEventListener("pointerup",()=>{state.drag=null;if(state.view==="3d")terrainCanvas.style.cursor="grab";});
  terrainCanvas.addEventListener("wheel",event=>{if(state.view!=="3d")return;event.preventDefault();state.camera.zoom=clamp(state.camera.zoom*(event.deltaY>0?.92:1.08),.65,1.8);drawTerrain();},{passive:false});

  moonCanvas.addEventListener("pointerdown",event=>{moonCanvas.setPointerCapture(event.pointerId);state.moon.drag={x:event.clientX,offset:state.moon.offset};});
  moonCanvas.addEventListener("pointermove",event=>{if(state.moon.drag)state.moon.offset=state.moon.drag.offset-(event.clientX-state.moon.drag.x)/600;});
  moonCanvas.addEventListener("pointerup",()=>state.moon.drag=null);
  moonCanvas.addEventListener("wheel",event=>{event.preventDefault();state.moon.zoom=clamp(state.moon.zoom*(event.deltaY>0?.94:1.06),.78,1.18);},{passive:false});
  window.addEventListener("resize",()=>{drawTerrain();drawProfile(state.route.map(elevationAt));});
}

function exportRoute() {
  if(!state.route.length)return;
  const payload={
    demo:"LunarNav",source:["NASA LRO WAC","NASA LOLA"],region:state.region,
    conservativeFactor:state.risk,
    waypoints:state.route.map((point,index)=>({index,...regionCoordinate(state.region,point),elevationM:Math.round(elevationAt(point))})),
  };
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=`lunar-route-${state.region.id}.json`;link.click();URL.revokeObjectURL(link.href);
}

async function init() {
  try {
    const response=await fetch("assets/terrain-meta.json");
    state.regions=await response.json();
    populateRegions();setupEvents();drawMoon();
  } catch(error) {
    console.error(error);$("#regionSelect").innerHTML="<option>数据加载失败，请通过本地服务器打开</option>";
  }
}

init();
