import { coordinateVector, tileCoordinate } from './sphere-grid.js';
import { HEAD_RADIUS_KM, angularDistance, circleVectors, catalogueForTile } from './head-geometry.js';
const BASE='assets/head-catalog/', COLOR='#ee99ff';
const element=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
const distanceToSegment=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],n=dx*dx+dy*dy,t=n?Math.max(0,Math.min(1,((p.x-a[0])*dx+(p.y-a[1])*dy)/n)):0;return Math.hypot(p.x-a[0]-t*dx,p.y-a[1]-t*dy);};

export class HeadCatalogLayer {
  constructor(onChange,onJump) {
    this.onChange=onChange;this.onJump=onJump;this.enabled=true;this.state='loading';this.records=[];this.region=[];this.tile=null;this.selected=null;this.query='';this.cache=new Map();
    this.stats={catalogueCount:0,globalDrawnIds:[],localDrawnIds:[]};
  }
  async init() {
    this.state='loading';this.mount();
    try {
      const response=await fetch(BASE+'head.json');if(!response.ok)throw Error(`HTTP ${response.status}`);
      const data=await response.json();
      if(data.body!=='Moon'||data.radius_km!==HEAD_RADIUS_KM||data.count!==5185||data.records.length!==data.count)throw Error('目录或月球坐标不匹配');
      this.records=data.records.map(([lon,lat,diameter],i)=>{
        if(![lon,lat,diameter].every(Number.isFinite)||Math.abs(lon)>180||Math.abs(lat)>90||diameter<20||diameter>=Math.PI*HEAD_RADIUS_KM)throw Error('目录条目无效');
        return {id:`Head-${String(i+1).padStart(5,'0')}`,row:i+1,lon,lat,diameter,center:coordinateVector(lat,lon),radius:diameter/(2*HEAD_RADIUS_KM),ring:circleVectors(lon,lat,diameter,diameter>=200?96:48)};
      });
      this.source=data;this.state='ready';this.stats.catalogueCount=this.records.length;this.setTile(this.tile);
    } catch(error) {this.state='error';this.error=error.message;this.updateControls();this.onChange();}
  }
  mount() {
    for(const host of document.querySelectorAll('.lfm-controls')) {
      if(host.querySelector('.head-catalog'))continue;
      const panel=element('section',undefined,'head-catalog');panel.setAttribute('aria-label','Head 撞击坑参考目录');
      const row=element('label',undefined,'toggle-row lfm-toggle');row.style.setProperty('--task-color',COLOR);
      const text=element('span');text.append(element('b','Head 撞击坑目录'),element('small','已发表参考 · 全月直径 ≥20 km'));
      const toggle=element('input');toggle.type='checkbox';toggle.dataset.headEnabled='';toggle.checked=this.enabled;
      toggle.onchange=()=>{this.enabled=toggle.checked;this.updateControls();this.onChange();};row.append(text,toggle);panel.append(row);
      const status=element('p','Head 目录加载中…','head-status lfm-note');status.setAttribute('role','status');panel.append(status);
      const controls=element('div',undefined,'head-options');
      const search=element('input');search.type='search';search.placeholder='按目录编号检索，如 00042';search.setAttribute('aria-label','检索Head目录编号');search.className='head-search';search.value=this.query;
      search.oninput=()=>{this.query=search.value;this.updateControls();};controls.append(search);
      const select=element('select');select.className='head-select';select.setAttribute('aria-label','选择Head撞击坑');select.onchange=()=>this.select(select.value);controls.append(select);
      const detail=element('p','选择条目或点击参考圆查看中心和直径。','head-detail lfm-note');controls.append(detail);
      const jump=element('button','定位并查看分片','secondary-button head-jump');jump.type='button';jump.disabled=true;jump.onclick=()=>{if(this.selected)this.onJump(this.selected.lat,this.selected.lon);};controls.append(jump);
      const links=element('p',undefined,'lfm-note head-downloads');
      for(const [label,path,download] of [['完整目录 CSV','HeadCraters.csv',true],['来源与口径','head.json',false],['DeepMoon许可','DeepMoon-LICENSE.md',false]]) {
        const a=element('a',label);a.href=BASE+path;if(download)a.download=path;else{a.target='_blank';a.rel='noopener';}links.append(a,document.createTextNode(' · '));
      }
      controls.append(links);panel.append(controls,element('p','粉紫圆为目录中心与直径生成的参考圆，并非模型预测或精细坑缘。Head编号对应CSV数据行，非官方地名。','lfm-note'));
      host.append(panel);
    }
    this.updateControls();
  }
  updateControls() {
    for(const panel of document.querySelectorAll('.head-catalog')) {
      panel.querySelector('[data-head-enabled]').checked=this.enabled;
      const planner=panel.closest('.lfm-controls').id==='lfmPlanner';
      const status=panel.querySelector('.head-status');
      status.textContent=this.state==='ready'?`Head 全目录 ${this.records.length} 个 · ${this.enabled?'已显示':'已隐藏'}${planner&&this.tile?`；当前分片相关 ${this.region.length} 个`:''}`:this.state==='error'?`Head 加载失败：${this.error}；可刷新重试`:'Head 目录加载中…';
      panel.querySelector('.head-options').hidden=this.state!=='ready';
      const search=panel.querySelector('.head-search');if(document.activeElement!==search)search.value=this.query;
      const select=panel.querySelector('.head-select'),items=(planner?this.region:this.records).filter(r=>r.id.toLowerCase().includes(this.query.trim().toLowerCase()));
      const key=`${planner?this.tile?.id:'global'}:${this.records.length}:${this.query}`;
      if(select.dataset.key!==key) {
        const placeholder=element('option',items.length?`选择条目（${items.length} 个）`:'当前没有匹配条目');placeholder.value='';
        const options=items.map(r=>{const o=element('option',`${r.id} · ${r.diameter.toFixed(2)} km`);o.value=r.id;return o;});
        select.replaceChildren(placeholder,...options);select.dataset.key=key;
      }
      select.value=this.selected?.id||'';
      const item=this.selected;panel.querySelector('.head-detail').textContent=item?`${item.id} · 经度 ${item.lon.toFixed(5)}° · 纬度 ${item.lat.toFixed(5)}° · 直径 ${item.diameter.toFixed(3)} km · CSV数据行 ${item.row}`:'选择条目或点击参考圆查看中心和直径。';
      panel.querySelector('.head-jump').disabled=!item;
    }
  }
  select(id) {this.selected=this.records.find(r=>r.id===id)||null;this.updateControls();this.onChange();}
  setTile(tile) {
    this.tile=tile;
    if(tile&&this.state==='ready') {
      if(!this.cache.has(tile.id)) {
        this.cache.set(tile.id,catalogueForTile(this.records,tile));
        // Bound memory when exploring many cells across the entire Moon.
        if(this.cache.size>64)this.cache.delete(this.cache.keys().next().value);
      }
      this.region=this.cache.get(tile.id);
    } else this.region=[];
    this.updateControls();this.onChange();
  }
  drawGlobe(globe,g) {
    this.stats.globalDrawnIds=[];if(!this.enabled||this.state!=='ready')return;
    const ctx=globe.ctx;ctx.save();ctx.strokeStyle=COLOR;ctx.globalAlpha=.62;ctx.lineWidth=.85;
    for(const item of this.records) {
      ctx.beginPath();let pen=false,visible=false;
      for(const vector of item.ring) {
        const p=globe.projectVector(vector,g);if(!p.visible){pen=false;continue;}
        if(pen)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);pen=true;visible=true;
      }
      ctx.stroke();if(visible)this.stats.globalDrawnIds.push(item.id);
    }
    if(this.selected) {
      ctx.globalAlpha=1;ctx.lineWidth=2.4;ctx.beginPath();let pen=false;
      for(const v of this.selected.ring){const p=globe.projectVector(v,g);if(!p.visible){pen=false;continue;}if(pen)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);pen=true;}ctx.stroke();
      const p=globe.project(this.selected.lat,this.selected.lon,g);if(p.visible){ctx.fillStyle=COLOR;ctx.beginPath();ctx.arc(p.x,p.y,3,0,2*Math.PI);ctx.fill();}
    }
    ctx.restore();
  }
  drawLocal(ctx,project) {
    this.stats.localDrawnIds=[];if(!this.enabled||this.state!=='ready')return;
    ctx.save();ctx.globalAlpha=.82;ctx.strokeStyle=COLOR;ctx.fillStyle=COLOR;
    for(const item of this.region) {
      ctx.lineWidth=item.id===this.selected?.id?2.5:1.15;ctx.beginPath();
      for(const line of item.localLines)for(let i=0;i<line.length;i++){const p=project({x:line[i][0],y:line[i][1]});if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);}ctx.stroke();
      if(item.localLines.length)this.stats.localDrawnIds.push(item.id);
      if(item.localCenter){const p=project({x:item.localCenter[0],y:item.localCenter[1]});ctx.beginPath();ctx.arc(p.x,p.y,item.id===this.selected?.id?3:1.8,0,2*Math.PI);ctx.fill();}
    }
    ctx.restore();
  }
  draw2d(ctx,rect){this.drawLocal(ctx,p=>({x:rect.x+p.x*rect.size,y:rect.y+p.y*rect.size}));}
  draw3d(ctx,project){this.drawLocal(ctx,project);}
  inspect(point) {
    if(!this.enabled||!this.tile)return false;
    const box=document.querySelector('#terrainCanvas').getBoundingClientRect(),tolerance=6/Math.max(1,Math.min(box.width,box.height)-32);let nearest=null,best=tolerance;
    for(const item of this.region) {
      if(item.localCenter){const d=Math.hypot(point.x-item.localCenter[0],point.y-item.localCenter[1]);if(d<best){best=d;nearest=item;}}
      for(const line of item.localLines)for(let i=1;i<line.length;i++){const d=distanceToSegment(point,line[i-1],line[i]);if(d<best){best=d;nearest=item;}}
    }
    if(nearest){this.select(nearest.id);return true;}return false;
  }
  inspectCoordinate(coordinate) {
    if(!this.enabled||this.state!=='ready')return;
    const point=coordinateVector(coordinate.lat,coordinate.lon);let nearest=null,best=.004;
    for(const item of this.records){const d=angularDistance(point,item.center),gap=Math.min(d,Math.abs(d-item.radius));if(gap<best){best=gap;nearest=item;}}
    if(nearest)this.select(nearest.id);
  }
}
