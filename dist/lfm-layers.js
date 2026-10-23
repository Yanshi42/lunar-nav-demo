import { coordinateVector, vectorFaceUv } from './sphere-grid.js';

const BASE = 'assets/lfm-20261023-native12/';
const CONFIG = {
  ice: { title: '基地水冰潜力', color: '#62dce8', note: '南北极拼接 · 模型预测冰赋存潜力' },
  wac: { title: 'WAC 撞击坑', color: '#ffd25a', note: '完整导航分片 · 连续科学影像推理' },
};
const $ = (q) => document.querySelector(q);
const itemLabel = (item) => item.task === 'ice' ? `${item.center[1] > 0 ? '北极' : '南极'}拼接 · ${item.source_count} 张输入` : item.label;
const node = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
};

export function localCoordinate(tile, lon, lat) {
  const uv = vectorFaceUv(coordinateVector(lat, lon));
  if (uv.face !== tile.face) return null;
  return { x: (uv.u + 1) * 9 - tile.col, y: (1 - uv.v) * 9 - tile.row };
}

export function intersectsTile(item, tile) {
  if (item.navigation_tile) return item.navigation_tile === tile.id;
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const line of item.coverage) for (const [lon, lat] of line) {
    const p = localCoordinate(tile, lon, lat);
    if (!p) continue;
    xmin = Math.min(xmin, p.x); xmax = Math.max(xmax, p.x);
    ymin = Math.min(ymin, p.y); ymax = Math.max(ymax, p.y);
  }
  return xmin <= 1 && xmax >= 0 && ymin <= 1 && ymax >= 0;
}

async function json(path) {
  const response = await fetch(BASE + path);
  if (!response.ok) throw new Error(`数据请求失败 (${response.status})`);
  return response.json();
}

function strokeLines(ctx, lines, project) {
  ctx.beginPath();
  for (const line of lines) {
    let pen = false;
    for (const [lon, lat] of line) {
      const p = project(lon, lat);
      if (!p || p.visible === false) { pen = false; continue; }
      if (pen) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
      pen = true;
    }
  }
  ctx.stroke();
}

export class LfmLayers {
  constructor(onChange, onJump) {
    this.onChange = onChange;
    this.onJump = onJump;
    this.enabled = new Set(['wac', 'ice']);
    this.catalogs = new Map();
    this.overviews = new Map();
    this.selectedObservations = {};
    this.vectorCache = new Map();
    this.pending = new Map();
    this.status = new Map();
    this.metadata = new Map();
    this.opacity = .65;
    this.tile = null;
    this.region = [];
    this.iceImage = null;
    this.icePixels = null;
    this.generation = 0;
    this.detailGeneration = 0;
  }

  async init() {
    try {
      this.manifest = await json('manifest.json');
      if (this.manifest.body !== 'Moon' || this.manifest.radius_m !== 1737400) throw new Error('图层天体信息不匹配');
      this.navigationCoverage = await json('navigation-coverage.json');
      if (this.navigationCoverage.body !== 'Moon' || this.navigationCoverage.radius_m !== 1737400) throw new Error('覆盖统计天体信息不匹配');
      if (this.navigationCoverage.science_version !== this.manifest.version) throw new Error('覆盖统计与科学图层版本不匹配');
      this.renderControls();
      await Promise.all(['wac', 'ice'].map((task) => this.load(task)));
      await this.setTile(this.tile);
      this.bindDetail();
    } catch (error) {
      document.querySelectorAll('.lfm-controls').forEach((el) => el.replaceChildren(node('p', `LFM 图层暂不可用：${error.message}`, 'lfm-note')));
      console.error(error);
    }
  }

  renderControls() {
    for (const host of document.querySelectorAll('.lfm-controls')) {
      host.replaceChildren(node('p', 'LFM 科学图层', 'lfm-heading'));
      for (const [task, config] of Object.entries(CONFIG)) {
        const row = node('label', undefined, 'toggle-row lfm-toggle');
        const text = node('span');
        text.append(node('b', config.title), node('small', config.note));
        const input = node('input'); input.type = 'checkbox'; input.dataset.task = task;
        input.checked = this.enabled.has(task);
        input.onchange = () => this.toggle(task, input.checked);
        row.style.setProperty('--task-color', config.color);
        row.append(text, input); host.append(row);
      }
      const label = node('label', '结果透明度', 'slider-label');
      const range = node('input'); range.type = 'range'; range.min = '0'; range.max = '100'; range.value = '65';
      range.setAttribute('aria-label', 'LFM 结果透明度');
      range.oninput = () => {
        this.opacity = +range.value / 100;
        document.querySelectorAll('.lfm-controls input[type=range]').forEach((el) => { el.value = range.value; });
        this.paintDetail(); this.onChange();
      };
      host.append(label, range);
      host.append(node('p', '撞击坑候选分数 ≥ 0.3；水冰颜色表示模型赋存潜力，非实测含量。', 'lfm-note'));
      host.append(node('p', '黄色标记已发布的 WAC 整片，青色标记极区水冰范围；未发布区域不代表不存在目标。', 'lfm-note'));
      const status = node('p', '目录加载中…', 'lfm-status'); status.setAttribute('role', 'status'); host.append(status);
      if (host.id === 'lfmPlanner' && this.manifest.presentation !== 'complete_navigation_tiles') {
        const observations = node('div', undefined, 'lfm-observation-controls');
        observations.append(node('p', '候选按单次观测显示，可切换影像；不同观测的同一地物未合并。', 'lfm-note'));
        for (const task of ['wac']) {
          const label = node('label', `${task.toUpperCase()} 显示观测`);
          const choice = node('select'); choice.dataset.observation = task;
          choice.setAttribute('aria-label', `${task.toUpperCase()} 显示观测`);
          choice.onchange = () => { this.selectedObservations[task] = choice.value; this.setTile(this.tile); };
          label.append(choice); observations.append(label);
        }
        host.append(observations);
      }
      const select = node('select'); select.className = 'lfm-products'; select.setAttribute('aria-label', '选择 LFM 结果');
      select.onchange = () => this.openDetail(select.value);
      host.append(select);
      const browse = node('button', '查看所选结果', 'secondary-button lfm-open'); browse.type = 'button';
      browse.onclick = () => this.openDetail(select.value); host.append(browse);
      const hint = node('p', 'WAC 按完整导航分片发布。水冰为南北极历史模型拼接，包含训练、验证与测试区域；当前科学结果尚未覆盖全月。', 'lfm-note');
      host.append(hint);
      const experiment = node('a', 'WAC 同地点输入对照（原景／拼接）', 'lfm-note');
      experiment.href = 'wac-input-control/'; experiment.target = '_blank'; experiment.rel = 'noopener';
      host.append(experiment);
      const trainedTrial = node('a', 'f4-r01-c10 · 整片撞击坑检测与对比', 'lfm-note');
      trainedTrial.href = 'wac-trained-preview.html'; trainedTrial.target = '_blank'; trainedTrial.rel = 'noopener';
      host.append(trainedTrial);
    }
    this.updateControls();
  }

  async load(task) {
    if (this.catalogs.has(task)) return this.catalogs.get(task);
    if (this.pending.has(task)) return this.pending.get(task);
    this.status.set(task, 'loading'); this.updateControls();
    const promise = json(this.manifest.tasks[task].catalog).then((data) => {
      this.catalogs.set(task, data.items); this.overviews.set(task, data.overview); this.status.set(task, 'ready'); return data.items;
    }).catch((error) => {
      this.status.set(task, 'error'); throw error;
    }).finally(() => {
      this.pending.delete(task); this.updateControls(); this.onChange();
    });
    this.pending.set(task, promise);
    return promise;
  }

  async toggle(task, checked) {
    if (checked) this.enabled.add(task); else this.enabled.delete(task);
    document.querySelectorAll(`.lfm-controls [data-task="${task}"]`).forEach((input) => { input.checked = checked; });
    this.updateControls(); this.onChange();
    try { if (checked) await this.load(task); await this.setTile(this.tile); }
    catch (error) { this.updateControls(); console.error(error); }
  }

  allItems() {
    return [...this.enabled].flatMap((task) => this.catalogs.get(task) || []);
  }

  updateControls() {
    const messages = [...this.enabled].map((task) => {
      const config = CONFIG[task], status = this.status.get(task);
      if (status === 'error') return `${config.title}：加载失败，请关闭后重试`;
      if (status !== 'ready') return `${config.title}：加载中`;
      const count = this.manifest.tasks[task];
      const inRegion = this.tile ? this.region.filter((i) => i.task === task).length : null;
      if (task === 'ice') return `${config.title}：${inRegion === null ? `${count.product_count} 幅极区拼接 / ${count.input_count} 张输入` : inRegion ? '本片位于极区预测范围，可叠加查看' : '本片没有水冰预测覆盖'}`;
      return `${config.title}：${inRegion === null ? `${count.input_count} 张输入` : inRegion ? `${inRegion} 个完整分片结果` : '本片尚未发布整片预测'}`;
    });
    for (const host of document.querySelectorAll('.lfm-controls')) {
      const global = host.id === 'lfmHome';
      const items = (global ? this.allItems() : [...this.region]).sort((a, b) => Number(b.input_cohort === 'new_region') - Number(a.input_cohort === 'new_region'));
      const select = host.querySelector('.lfm-products');
      if (!select) continue;
      const previous = select.value;
      select.replaceChildren(node('option', items.length ? '选择一个结果查看详情…' : '当前没有可查看结果'));
      select.firstChild.value = '';
      for (const item of items) {
        const option = node('option', `${item.input_cohort === 'new_region' ? '新区域 · ' : ''}${CONFIG[item.task].title} · ${itemLabel(item)}`);
        option.value = item.id; select.append(option);
      }
      if (items.some((i) => i.id === previous)) select.value = previous;
      host.querySelector('.lfm-open').disabled = items.length === 0;
      const status = host.querySelector('.lfm-status');
      status.textContent = global ? [...this.enabled].map((task) => {
        const s = this.manifest?.tasks[task];
        return `${CONFIG[task].title}：${this.status.get(task) === 'ready' ? task === 'ice' ? `${s.product_count} 幅极区拼接 / ${s.input_count} 张输入` : `${s.product_count} 个完整导航片 / ${s.candidate_count} 个候选` : this.status.get(task) === 'error' ? '加载失败，请关闭后重试' : '加载中'}`;
      }).join('；') : messages.join('；');
      if (this.enabled.has('wac') && this.navigationCoverage) {
        const coverage = this.navigationCoverage;
        if (global) status.textContent += `；WAC 正式整片覆盖全月 ${(coverage.summary.moon_surface_fraction * 100).toFixed(4)}% · ${coverage.summary.with_valid_input}/1944 片已发布 · ${coverage.summary.complete_tiles} 片完整覆盖`;
        else if (this.tile) {
          const cell = coverage.tiles[this.tile.id];
          if (cell) status.textContent += `；本片整片预测覆盖 ${(cell.inferred_coverage_fraction * 100).toFixed(2)}%（${cell.inferred_area_km2.toFixed(1)} / ${cell.cell_area_km2.toFixed(1)} km²）`;
        }
      }
      if (!this.enabled.size) status.textContent = '科学图层已关闭';
      for (const choice of host.querySelectorAll('[data-observation]')) {
        const task = choice.dataset.observation;
        const options = this.tile && this.enabled.has(task) ? this.manifest.tasks[task].vector_tiles?.[this.tile.id] || [] : [];
        choice.parentElement.hidden = !options.length;
        choice.replaceChildren();
        if (options.length && !options.some((o) => o.id === this.selectedObservations[task])) this.selectedObservations[task] = options[0].id;
        for (const observation of options) {
          const option = node('option', `${observation.id} · ${observation.count} 候选`);
          option.value = observation.id; choice.append(option);
        }
        choice.value = this.selectedObservations[task] || '';
      }
      const observations = host.querySelector('.lfm-observation-controls');
      if (observations) observations.hidden = ![...observations.querySelectorAll('label')].some((label) => !label.hidden);
    }
  }

  async getMetadata(item) {
    if (!this.metadata.has(item.id)) {
      const promise = json(item.metadata).catch((error) => { this.metadata.delete(item.id); throw error; });
      this.metadata.set(item.id, promise);
    }
    return this.metadata.get(item.id);
  }

  async setTile(tile) {
    const generation = ++this.generation;
    this.tile = tile; this.iceImage = null; this.icePixels = null;
    this.region = tile ? this.allItems().filter((item) => intersectsTile(item, tile)) : [];
    this.regionBoxes = [];
    this.updateControls(); this.onChange();
    if (!tile) return;
    try {
      const work = [];
      if (this.enabled.has('ice') && this.manifest.tasks.ice.tiles.includes(tile.id)) {
        work.push((async () => {
          const image = new Image(); image.src = BASE + `ice-tiles/${tile.id}.png`; await image.decode();
          if (generation !== this.generation) return;
          this.iceImage = image;
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
          const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
          this.icePixels = ctx.getImageData(0, 0, 512, 512).data;
        })());
      }
      for (const task of ['wac']) {
        if (!this.enabled.has(task)) continue;
        const options = this.manifest.tasks[task].vector_tiles?.[tile.id] || [];
        const choice = options.find((o) => o.id === this.selectedObservations[task]) || options[0];
        if (choice) this.selectedObservations[task] = choice.id;
        if (choice) {
          if (!this.vectorCache.has(choice.file)) {
            this.vectorCache.set(choice.file, json(choice.file).catch((error) => { this.vectorCache.delete(choice.file); throw error; }));
            while (this.vectorCache.size > 16) this.vectorCache.delete(this.vectorCache.keys().next().value);
          }
          work.push(this.vectorCache.get(choice.file).then((data) => {
            if (generation === this.generation) this.regionBoxes.push(...data.features.map((box) => ({ ...box, task })));
          }));
        }
      }
      await Promise.all(work);
      if (generation === this.generation) this.onChange();
    } catch (error) {
      if (generation === this.generation) document.querySelector('#lfmPlanner .lfm-status').textContent = `当前分片结果加载失败：${error.message}`;
      console.error(error);
    }
  }

  drawGlobe(globe, g) {
    const ctx = globe.ctx;
    ctx.save(); ctx.globalAlpha = this.opacity; ctx.lineWidth = 1.2;
    const overviewItems = [...this.enabled].flatMap((task) => {
      const overview = this.overviews.get(task);
      return overview ? [{ task, coverage: overview.coverage, markers: overview.centers }] : this.catalogs.get(task) || [];
    });
    for (const item of overviewItems) {
      ctx.strokeStyle = CONFIG[item.task].color;
      strokeLines(ctx, item.coverage, (lon, lat) => globe.project(lat, lon, g));
      for (const [lon, lat] of item.markers || []) {
        const p = globe.project(lat, lon, g);
        if (p.visible) { ctx.fillStyle = CONFIG[item.task].color; ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fill(); }
      }
      if (item.center && item.task !== 'ice') {
        const p = globe.project(item.center[1], item.center[0], g);
        if (p.visible) { ctx.fillStyle = CONFIG[item.task].color; ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fill(); }
      }
    }
    ctx.restore();
  }

  drawVectors(ctx, project, projectLocal) {
    for (const item of this.region) {
      if (!this.enabled.has(item.task)) continue;
      const active = this.manifest.tasks[item.task].vector_tiles?.[this.tile.id]?.some((o) => o.id === this.selectedObservations[item.task]);
      if (active && item.observation && item.observation !== this.selectedObservations[item.task]) continue;
      ctx.strokeStyle = CONFIG[item.task].color; ctx.lineWidth = 1.2;
      strokeLines(ctx, item.coverage, project);
      if (item.task !== 'ice') {
        const p = project(...item.center);
        if (p) { ctx.fillStyle = CONFIG[item.task].color; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); }
      }
    }
    for (const box of this.regionBoxes || []) {
      if (!this.enabled.has(box.task)) continue;
      if (box.local_lines) {
        ctx.strokeStyle = CONFIG[box.task].color; ctx.lineWidth = 1;
        ctx.beginPath();
        for (const line of box.local_lines) {
          let pen = false;
          for (const [x, y] of line) {
            const p = projectLocal({ x, y });
            if (!p) { pen = false; continue; }
            if (pen) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
            pen = true;
          }
        }
        ctx.stroke(); continue;
      }
      const polys = box.geometry.type === 'Polygon' ? [box.geometry.coordinates] : box.geometry.coordinates;
      ctx.strokeStyle = CONFIG[box.task].color; ctx.lineWidth = 1;
      strokeLines(ctx, polys.flat(), project);
    }
  }

  draw2d(ctx, rect) {
    if (!this.tile) return;
    ctx.save(); ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.size, rect.size); ctx.clip();
    ctx.globalAlpha = this.opacity;
    if (this.enabled.has('ice') && this.iceImage) { ctx.imageSmoothingEnabled = false; ctx.drawImage(this.iceImage, rect.x, rect.y, rect.size, rect.size); }
    this.drawVectors(ctx, (lon, lat) => {
      const p = localCoordinate(this.tile, lon, lat);
      return p ? { x: rect.x + p.x * rect.size, y: rect.y + p.y * rect.size } : null;
    }, (p) => ({ x: rect.x + p.x * rect.size, y: rect.y + p.y * rect.size }));
    ctx.restore();
  }

  cellColor(x, y) {
    if (!this.enabled.has('ice') || !this.icePixels) return null;
    const i = (Math.min(511, Math.floor(y * 512)) * 512 + Math.min(511, Math.floor(x * 512))) * 4;
    const p = this.icePixels;
    return p[i + 3] ? `rgba(${p[i]},${p[i + 1]},${p[i + 2]},${this.opacity})` : null;
  }

  draw3d(ctx, project) {
    if (!this.tile) return;
    ctx.save(); ctx.globalAlpha = this.opacity;
    this.drawVectors(ctx, (lon, lat) => {
      const p = localCoordinate(this.tile, lon, lat);
      return p && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 ? project(p) : null;
    }, (p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 ? project(p) : null);
    ctx.restore();
  }

  inspect(point) {
    const nearby = this.region.filter((item) => {
      const active = this.manifest.tasks[item.task].vector_tiles?.[this.tile.id]?.some((o) => o.id === this.selectedObservations[item.task]);
      if (active && item.observation && item.observation !== this.selectedObservations[item.task]) return false;
      const p = localCoordinate(this.tile, ...item.center);
      return p && Math.hypot(point.x - p.x, point.y - p.y) < .04;
    });
    return nearby.length ? this.openDetail(nearby[0].id) : false;
  }

  bindDetail() {
    $('#lfmDetailClose').onclick = () => { this.detailGeneration++; $('#lfmDetail').close(); };
    // A queued close event from the previous result can arrive after a new open.
    $('#lfmDetail').addEventListener('close', () => { if (!$('#lfmDetail').open) this.detailGeneration++; });
    $('#lfmDetailZoom').oninput = () => this.paintDetail();
    $('#lfmDetailOpacity').oninput = () => this.paintDetail();
    $('#lfmDetailJump').onclick = async () => {
      if (!this.detailItem) return;
      const item = this.detailItem;
      if (item.observation) this.selectedObservations[item.task] = item.observation;
      $('#lfmDetail').close(); await this.onJump(item.center[1], item.center[0]);
    };
    $('#lfmDetailCanvas').onclick = (event) => {
      if (!this.detailMeta?.boxes) return;
      const canvas = $('#lfmDetailCanvas'), rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width * canvas.width;
      const y = (event.clientY - rect.top) / rect.height * canvas.height;
      const hits = this.detailMeta.boxes.filter(({ box: [x1, y1, x2, y2] }) => x >= x1 && x <= x2 && y >= y1 && y <= y2).sort((a, b) => b.score - a.score);
      $('#lfmDetailProbe').textContent = hits.length ? `候选 ${hits[0].id} · 分数 ${hits[0].score.toFixed(4)} · 合并来源 ${hits[0].source_count} 个` : '此像素未落入保留的候选框；不代表没有撞击坑。';
    };
  }

  async openDetail(id) {
    const item = this.allItems().find((entry) => entry.id === id) || this.region[0] || this.allItems()[0];
    if (!item) return false;
    const generation = ++this.detailGeneration;
    this.detailItem = item; this.detailMeta = null; this.detailInput = null; this.detailPrediction = null;
    $('#lfmDetailTitle').textContent = CONFIG[item.task].title;
    $('#lfmDetailSource').textContent = `${itemLabel(item)} · ${item.id}`;
    $('#lfmDetailInfo').textContent = '正在加载整片结果…';
    $('#lfmDetailProbe').textContent = '';
    $('#lfmDetailCanvas').getContext('2d').clearRect(0, 0, $('#lfmDetailCanvas').width, $('#lfmDetailCanvas').height);
    $('#lfmDetailDownload').hidden = true; $('#lfmDetailMetadata').hidden = true;
    $('#lfmDetailZoom').value = '1'; $('#lfmDetailOpacity').value = '65';
    $('#lfmDetailModel').textContent = '';
    if (!$('#lfmDetail').open) $('#lfmDetail').showModal();
    try {
      const loadImage = async (path) => { if (!path) return null; const img = new Image(); img.src = BASE + path; await img.decode(); return img; };
      const [meta, input, prediction] = await Promise.all([this.getMetadata(item), loadImage(item.input), loadImage(item.prediction)]);
      if (generation !== this.detailGeneration) return true;
      this.detailMeta = meta; this.detailInput = input; this.detailPrediction = prediction;
      const splitLabel = item.splits.map((split) => ({ train: '训练', val: '验证', test: '测试', unlabelled: '下游无标注新区域' })[split] || split).join('/');
      $('#lfmDetailInfo').textContent = item.task === 'ice'
        ? `${item.width} × ${item.height} 格网 · ${item.resolution_m.toFixed(0)} m/px · ${item.source_count} 张输入拼接 · ${splitLabel}区域 · 显示范围 0–1`
        : `${item.width} × ${item.height} 显示格网 · 科学输入 ${item.resolution_m.toFixed(0)} m/px · 完整导航分片 · ${meta.boxes.length} 个候选（分数 ≥0.3）`;
      $('#lfmDetailProbe').textContent = item.task === 'ice' ? '冰赋存潜力，非实测含量。色标仅显示 0–1，下载保留原始浮点值。' : item.task === 'imp' ? '灰度科学影像叠加正类得分；得分未校准为概率。' : '点击整片影像中的候选轮廓查看检测分数。' + (meta.accuracy_note ? ' ' + meta.accuracy_note : '');
      const modelHashes = meta.model_checkpoints ? Object.entries(meta.model_checkpoints).map(([route, value]) => `${route === 'large' ? '大坑' : '小坑'}模型 SHA256：${value.sha256}`).join('\n') : `模型 SHA256：${meta.checkpoint_sha256}`;
      $('#lfmDetailModel').textContent = `${modelHashes}\n输入：${meta.source_ids.join(', ')}\n科学来源：${(meta.source_urls || []).filter(Boolean).join(', ')}\n月球坐标系：${meta.crs_wkt}\n科学栅格像素变换：${(meta.science_grid?.transform || meta.transform).join(', ')}`;
      for (const [selector, href] of [['#lfmDetailDownload', item.download], ['#lfmDetailMetadata', item.metadata]]) {
        const link = $(selector); link.href = BASE + href; link.download = href.split('/').at(-1); link.hidden = false;
      }
      $('#lfmDetailDownload').textContent = meta.boxes ? item.download_scope === 'source' ? '下载该影像候选 GeoJSON' : '下载整片撞击坑 GeoJSON' : '下载原生预测 GeoTIFF';
      this.paintDetail();
    } catch (error) {
      if (generation === this.detailGeneration) $('#lfmDetailInfo').textContent = `结果加载失败：${error.message}`;
      console.error(error);
    }
    return true;
  }

  paintDetail() {
    if (!this.detailMeta || !$('#lfmDetail').open) return;
    const canvas = $('#lfmDetailCanvas'), ctx = canvas.getContext('2d'), item = this.detailItem;
    canvas.width = item.width; canvas.height = item.height;
    const available = Math.max(220, $('#lfmDetailViewport').clientWidth - 24);
    canvas.style.width = `${Math.min(item.width, available) * +$('#lfmDetailZoom').value}px`;
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.imageSmoothingEnabled = false;
    if (this.detailInput) ctx.drawImage(this.detailInput, 0, 0);
    ctx.globalAlpha = this.detailInput ? +$('#lfmDetailOpacity').value / 100 : 1;
    if (this.detailPrediction) ctx.drawImage(this.detailPrediction, 0, 0);
    ctx.strokeStyle = CONFIG[item.task].color; ctx.lineWidth = Math.max(1, item.width / 700);
    for (const candidate of this.detailMeta.boxes || []) {
      if (candidate.pixel_lines) {
        ctx.beginPath();
        for (const line of candidate.pixel_lines) line.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
        ctx.stroke();
      } else { const [x1,y1,x2,y2]=candidate.box; ctx.strokeRect(x1,y1,x2-x1,y2-y1); }
    }
    ctx.globalAlpha = 1;
  }
}
