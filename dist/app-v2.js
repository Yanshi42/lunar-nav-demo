import { LunarGlobe, tileFromCoordinate } from "./globe.js";
import { Terrain } from "./terrain.js";
import { Router } from "./routing.js";

const $ = (query) => document.querySelector(query);
const $$ = (query) => [...document.querySelectorAll(query)];
const terrain = new Terrain($("#terrainCanvas"), $("#profileCanvas"));
const presets = {
  copernicus: [9.62, -20.08],
  taurus: [20.19, 30.77],
  tycho: [-43.31, -11.36],
  "south-pole": [-87.5, 15],
};
const state = {
  tile: tileFromCoordinate(...presets.copernicus),
  globe: null,
  router: null,
  mode: "ordered",
  tool: null,
  start: null,
  end: null,
  points: [],
  result: null,
  risk: 7,
  generation: 0,
  ppd: 16,
};

function signed(value, positive, negative) {
  return `${Math.abs(value).toFixed(2)}°${value >= 0 ? positive : negative}`;
}

function position(point) {
  return {
    lat: state.tile.north - point.y * 5,
    lon: state.tile.west + point.x * 5,
  };
}

function shortCoordinate(point) {
  if (!point) return "未选择";
  const c = position(point);
  return `${signed(c.lat, "N", "S")} · ${signed(c.lon, "E", "W")}`;
}

function tileLabel(tile) {
  return `${signed(tile.south, "N", "S")}–${signed(tile.north, "N", "S")} / ${signed(tile.west, "E", "W")}–${signed(tile.east, "E", "W")}`;
}

async function drawPreview(tile) {
  const canvas = $("#regionPreview");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const box = canvas.getBoundingClientRect();
  canvas.width = Math.round(box.width * dpr);
  canvas.height = Math.round(box.height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#10242d"; ctx.fillRect(0, 0, box.width, box.height);
  const img = new Image();
  img.onload = () => {
    if (tile.id !== state.tile.id) return;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    const pixels = state.ppd * 5;
    ctx.drawImage(img, tile.col * pixels, 0, pixels, pixels, 0, 0, box.width, box.height);
  };
  img.src = `assets/relief-band-${String(tile.row).padStart(2, "0")}.jpg`;
}

function selectTile(tile, centerGlobe = false) {
  state.tile = tile;
  $("#latInput").value = tile.lat.toFixed(1);
  $("#lonInput").value = tile.lon.toFixed(1);
  $("#regionCoordinates").textContent = `${signed(tile.lat, "N", "S")}  ${signed(tile.lon, "E", "W")}`;
  $("#mapRegionLabel").textContent = `月面分片 ${tile.id.toUpperCase()} · 5° × 5°`;
  $("#mapBounds").textContent = tileLabel(tile);
  state.globe?.select(tile);
  if (centerGlobe) state.globe?.centerOn(tile.lat, tile.lon);
  drawPreview(tile);
}

function setTool(tool) {
  state.tool = tool;
  for (const [name, selector] of [["start", "#chooseStart"], ["end", "#chooseEnd"], ["point", "#addPoint"]]) {
    $(selector).classList.toggle("active", tool === name);
  }
  const labels = { start: "请在二维地图上点击起点", end: "请在二维地图上点击终点",
    point: state.mode === "ordered" ? "请在二维地图上点击途经点，可连续添加" : "请在二维地图上点击目标点，可连续添加" };
  $("#mapHint").textContent = labels[tool] || "先选择上面的点位类型，再点击地图";
  $("#terrainCanvas").style.cursor = terrain.view === "3d" ? "grab" : tool ? "crosshair" : "default";
}

function setMode(mode) {
  state.generation++;
  $("#planRoute").disabled = false;
  $("#planRoute").textContent = "规划安全路径";
  state.mode = mode;
  state.start = state.end = null;
  state.points = [];
  state.result = null;
  terrain.route = [];
  $("#orderedMode").classList.toggle("active", mode === "ordered");
  $("#unorderedMode").classList.toggle("active", mode === "unordered");
  $("#addPointLabel").textContent = mode === "ordered" ? "增加途经点" : "增加目标点";
  $("#modeDescription").textContent = mode === "ordered"
    ? "起点 → 途经点 → 终点，按添加顺序连接。"
    : "添加 2–8 个目标点；起点和终点可选，自动求最短访问顺序。";
  refreshPoints();
  setTool(mode === "ordered" ? "start" : "point");
  clearMetrics();
}

function refreshPoints() {
  $("#startCoord").textContent = shortCoordinate(state.start);
  $("#endCoord").textContent = shortCoordinate(state.end);
  const list = $("#pointList");
  list.replaceChildren();
  state.points.forEach((point, index) => {
    const row = document.createElement("div"); row.className = "point-item";
    const label = document.createElement("span");
    label.textContent = `${state.mode === "ordered" ? "途经" : "目标"} ${index + 1}`;
    const text = document.createTextNode(shortCoordinate(point));
    const button = document.createElement("button"); button.type = "button"; button.textContent = "×";
    button.setAttribute("aria-label", `删除${state.mode === "ordered" ? "途经" : "目标"}点 ${index + 1}`);
    button.onclick = () => { state.points.splice(index, 1); refreshPoints(); planRoute(); };
    row.append(label, text, button); list.append(row);
  });
  terrain.points = [
    ...(state.start ? [{ ...state.start, label: "S", color: "#65ea84" }] : []),
    ...state.points.map((point, index) => ({ ...point, label: `${index + 1}`, color: "#ffd25a" })),
    ...(state.end ? [{ ...state.end, label: "E", color: "#ff5d6c" }] : []),
  ];
  terrain.draw();
}

function clearMetrics() {
  for (const selector of ["#distanceMetric", "#climbMetric", "#slopeMetric", "#nodeMetric"]) $(selector).textContent = "—";
  $("#visitOrder").textContent = "";
  terrain.profile([]);
}

function routeReady() {
  return state.mode === "ordered" ? Boolean(state.start && state.end) : state.points.length >= 2;
}

async function planRoute() {
  const generation = ++state.generation;
  const button = $("#planRoute");
  button.disabled = false;
  button.textContent = "规划安全路径";
  state.result = null;
  terrain.route = [];
  clearMetrics(); terrain.draw();
  if (!routeReady() || !state.router) {
    $("#mapHint").textContent = state.mode === "ordered" ? "请选择起点与终点" : "请至少添加 2 个目标点";
    return;
  }
  button.disabled = true;
  button.textContent = "正在规划…";
  const progress = (done, total) => { $("#mapHint").textContent = `计算地形路径 ${done}/${total}`; };
  try {
    let result;
    if (state.mode === "ordered") result = await state.router.ordered([state.start, ...state.points, state.end], state.risk, progress);
    else result = await state.router.unordered(state.start, state.points, state.end, state.risk, progress);
    if (generation !== state.generation) return;
    if (!result) { $("#mapHint").textContent = "当前坡度约束下无法连通，请移动点位或选择邻近地形"; return; }
    state.result = result;
    terrain.route = result.route;
    terrain.draw(); terrain.profile(result.route);
    const values = result.route.map((point) => terrain.elevation(point));
    let km = 0, climb = 0, maximum = 0;
    for (let i = 1; i < result.route.length; i++) {
      const a = result.route[i - 1], b = result.route[i];
      const horizontal = Math.hypot((b.x - a.x) * terrain.widthKm, (b.y - a.y) * terrain.heightKm);
      const dz = values[i] - values[i - 1];
      km += Math.hypot(horizontal, dz / 1000);
      climb += Math.max(0, dz);
      maximum = Math.max(maximum, Math.atan2(Math.abs(dz), horizontal * 1000) * 180 / Math.PI);
    }
    $("#distanceMetric").textContent = `${km.toFixed(1)} km`;
    $("#climbMetric").textContent = `${Math.round(climb)} m`;
    $("#slopeMetric").textContent = `${maximum.toFixed(1)}°`;
    $("#nodeMetric").textContent = `${result.route.length}`;
    $("#visitOrder").textContent = state.mode === "unordered"
      ? `访问顺序：${state.start ? "起点 → " : ""}${result.visitOrder.map((index) => `目标 ${index}`).join(" → ")}${state.end ? " → 终点" : ""}`
      : `访问顺序：起点${state.points.map((_, i) => ` → 途经 ${i + 1}`).join("")} → 终点`;
    $("#mapHint").textContent = "路线已更新。可继续调整点位或地形保守系数。";
  } catch (error) {
    if (generation === state.generation) $("#mapHint").textContent = `规划失败：${error.message}`;
    console.error(error);
  } finally {
    if (generation === state.generation) { button.disabled = false; button.textContent = "规划安全路径"; }
  }
}

async function enterPlanner() {
  $("#globeView").hidden = true;
  $("#plannerView").hidden = false;
  $("#canvasLoading").hidden = false;
  window.scrollTo(0, 0);
  try {
    await terrain.load(state.tile);
    state.router = new Router(terrain, state.ppd * 5);
    state.router.prepare();
    $("#plannerRegionName").textContent = `月面分片 ${state.tile.id.toUpperCase()}`;
    $("#plannerRegionSubtitle").textContent = tileLabel(state.tile);
    $("#scaleLabel").textContent = `${Math.round(terrain.widthKm / 4)} km`;
    $("#canvasLoading").hidden = true;
    setMode("ordered");
    terrain.draw();
  } catch (error) {
    $("#canvasLoading").textContent = error.message;
    console.error(error);
  }
}

function setupPlannerEvents() {
  $("#enterPlanner").onclick = enterPlanner;
  $("#brandButton").onclick = () => { $("#plannerView").hidden = true; $("#globeView").hidden = false; state.globe?.invalidate(); window.scrollTo(0, 0); };
  $("#orderedMode").onclick = () => setMode("ordered");
  $("#unorderedMode").onclick = () => setMode("unordered");
  $("#chooseStart").onclick = () => setTool("start");
  $("#chooseEnd").onclick = () => setTool("end");
  $("#addPoint").onclick = () => setTool("point");
  $("#planRoute").onclick = planRoute;
  $("#clearRoute").onclick = () => setMode(state.mode);
  $("#riskSlider").oninput = (event) => { state.risk = +event.target.value; $("#riskValue").textContent = state.risk; };
  $("#riskSlider").onchange = planRoute;
  $("#heightSlider").oninput = (event) => {
    terrain.camera.exaggeration = +event.target.value;
    $("#heightValue").textContent = `${terrain.camera.exaggeration}×`;
    terrain.draw();
  };
  $$(".view-switch button").forEach((button) => button.onclick = () => {
    $$(".view-switch button").forEach((other) => other.classList.toggle("active", other === button));
    terrain.view = button.dataset.view;
    $("#terrainCanvas").style.cursor = terrain.view === "3d" ? "grab" : state.tool ? "crosshair" : "default";
    if (terrain.view === "3d") $("#mapHint").textContent = "三维视图可拖动旋转；切回二维选择点位";
    else setTool(state.tool);
    terrain.draw();
  });
  for (const [selector, key] of [["#terrainToggle", "terrain"], ["#riskToggle", "risk"], ["#gridToggle", "grid"]]) {
    $(selector).onchange = (event) => { terrain.layers[key] = event.target.checked; terrain.draw(); };
  }
  $("#terrainCanvas").addEventListener("click", (event) => {
    if (terrain.view !== "2d" || !state.tool) return;
    const point = terrain.localPoint(event);
    if (!point) return;
    if (state.tool === "start") { state.start = point; setTool(state.mode === "ordered" && !state.end ? "end" : null); }
    else if (state.tool === "end") { state.end = point; setTool(state.mode === "ordered" && !state.start ? "start" : null); }
    else {
      if (state.points.length >= 8) { $("#mapHint").textContent = "最多添加 8 个点"; return; }
      state.points.push(point);
    }
    refreshPoints();
    planRoute();
  });
  $("#terrainCanvas").addEventListener("pointermove", (event) => {
    if (terrain.view === "3d" && terrain.drag) {
      const dx = event.clientX - terrain.drag.x, dy = event.clientY - terrain.drag.y;
      terrain.camera.yaw += dx * 0.007;
      terrain.camera.pitch = Math.max(0.22, Math.min(1.25, terrain.camera.pitch + dy * 0.005));
      terrain.drag = { x: event.clientX, y: event.clientY };
      terrain.draw();
      return;
    }
    if (terrain.view === "2d" && terrain.values) {
      const point = terrain.localPoint(event);
      if (point) {
        const p = position(point);
        $("#cursorReadout").textContent = `${signed(p.lat, "N", "S")} · ${signed(p.lon, "E", "W")} · ${Math.round(terrain.elevation(point))} m`;
      }
    }
  });
  $("#terrainCanvas").addEventListener("pointerdown", (event) => {
    if (terrain.view !== "3d") return;
    terrain.canvas.setPointerCapture(event.pointerId);
    terrain.drag = { x: event.clientX, y: event.clientY };
    terrain.canvas.style.cursor = "grabbing";
  });
  $("#terrainCanvas").addEventListener("pointerup", () => { terrain.drag = null; if (terrain.view === "3d") terrain.canvas.style.cursor = "grab"; });
  $("#terrainCanvas").addEventListener("wheel", (event) => {
    if (terrain.view !== "3d") return;
    event.preventDefault(); terrain.camera.zoom = Math.max(0.65, Math.min(1.8, terrain.camera.zoom * (event.deltaY > 0 ? 0.93 : 1.07))); terrain.draw();
  }, { passive: false });
  $("#exportRoute").onclick = () => {
    if (!state.result) { $("#mapHint").textContent = "请先规划路线"; return; }
    const data = {
      source: `NASA LRO WAC / LOLA ${state.ppd} ppd`,
      tile: state.tile,
      mode: state.mode,
      terrainConservatism: state.risk,
      heightExaggerationDisplayOnly: terrain.camera.exaggeration,
      visitOrder: state.result.visitOrder || null,
      points: state.result.route.map((point, index) => ({ index, ...position(point), elevationM: Math.round(terrain.elevation(point)) })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `lunar-route-${state.tile.id}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
}

async function init() {
  const manifest = await (await fetch("assets/terrain-meta.json")).json();
  state.ppd = manifest.ppd;
  terrain.ppd = manifest.ppd;
  $(".source-stamp").innerHTML = `<span>DATA</span>LRO WAC · LOLA ${manifest.ppd} ppd`;
  $("#dataResolution").textContent = `LOLA 全球高程 · ${manifest.ppd} px/°`;
  $("#aboutResolution").textContent = `${manifest.ppd} 像素 / 度`;
  $("#aboutTilePixels").textContent = `${manifest.ppd * 5} × ${manifest.ppd * 5}`;
  const texture = new Image();
  texture.src = "assets/moon-color.jpg";
  await texture.decode();
  state.globe = new LunarGlobe($("#moonCanvas"), texture, (tile) => selectTile(tile));
  selectTile(state.tile, true);
  $("#regionSelect").onchange = (event) => {
    const [lat, lon] = presets[event.target.value];
    selectTile(tileFromCoordinate(lat, lon), true);
  };
  $("#locateButton").onclick = () => {
    const lat = +$("#latInput").value, lon = +$("#lonInput").value;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return;
    selectTile(tileFromCoordinate(lat, lon), true);
  };
  $("#aboutButton").onclick = () => $("#aboutDialog").showModal();
  $("#closeDialog").onclick = () => $("#aboutDialog").close();
  setupPlannerEvents();
}

init().catch((error) => { console.error(error); $("#regionCoordinates").textContent = "数据加载失败，请刷新页面"; });
