import { coordinateVector, vectorCoordinate, tileVector, vectorFaceUv, CELLS_PER_FACE, MOON_RADIUS_KM } from './sphere-grid.js';
export const HEAD_RADIUS_KM = MOON_RADIUS_KM;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v) => { const n = Math.hypot(...v); return v.map(x => x / n); };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const FACES = [
  [[1,0,0],[0,1,0],[0,0,1]], [[-1,0,0],[0,1,0],[0,0,-1]],
  [[0,0,-1],[0,1,0],[1,0,0]], [[0,0,1],[0,1,0],[-1,0,0]],
  [[1,0,0],[0,0,-1],[0,1,0]], [[1,0,0],[0,0,1],[0,-1,0]],
];
export function angularDistance(a, b) {
  return Math.atan2(Math.hypot(a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]), clamp(dot(a,b),-1,1));
}
export function circleVectors(lon, lat, diameter, steps = 64) {
  const p=lat*Math.PI/180, l=lon*Math.PI/180, c=coordinateVector(lat,lon);
  const north=[-Math.sin(p)*Math.sin(l),Math.cos(p),-Math.sin(p)*Math.cos(l)];
  const east=[Math.cos(l),0,-Math.sin(l)], radius=diameter/(2*HEAD_RADIUS_KM), cr=Math.cos(radius), sr=Math.sin(radius);
  return Array.from({length:steps+1},(_,i)=>{
    const angle=2*Math.PI*(i%steps)/steps, cn=Math.cos(angle), se=Math.sin(angle);
    return c.map((x,k)=>cr*x+sr*(cn*north[k]+se*east[k]));
  });
}
// Clip great-circle segments to the four planes of a cube face before projecting.
// This keeps seams and polar circles continuous without drawing artificial edges.
function clipFace(a, b, face) {
  const [u,v,n]=FACES[face];
  for(const axis of [u,v]) for(const sign of [-1,1]) {
    const normal=n.map((x,i)=>x+sign*axis[i]), da=dot(a,normal), db=dot(b,normal);
    if(da < -1e-12 && db < -1e-12) return null;
    if(da < 0 || db < 0) {
      const t=clamp(da/(da-db),0,1), p=unit(a.map((x,i)=>x+t*(b[i]-x)));
      if(da < 0) a=p; else b=p;
    }
  }
  return [a,b];
}
function onFace(vector, face) {
  const [u,v]=FACES[face], x=dot(vector,u), y=dot(vector,v), difference=x*x-y*y, term=3-2*difference;
  const vs=clamp((term-Math.sqrt(Math.max(0,term*term-24*y*y)))/2,0,1), us=clamp(vs+2*difference,0,1);
  return {u:Math.sign(x)*Math.sqrt(us),v:Math.sign(y)*Math.sqrt(vs)};
}
function inTile(vector, tile) {
  const uv=onFace(vector,tile.face);
  return [(uv.u+1)*CELLS_PER_FACE/2-tile.col,(1-uv.v)*CELLS_PER_FACE/2-tile.row];
}
function clipSquare(a,b) {
  let low=0,high=1;const dx=b[0]-a[0],dy=b[1]-a[1];
  for(const [p,q] of [[-dx,a[0]],[dx,1-a[0]],[-dy,a[1]],[dy,1-a[1]]]) {
    if(Math.abs(p)<1e-15) {if(q<0)return null;continue;}
    const t=q/p;if(p<0)low=Math.max(low,t);else high=Math.min(high,t);if(low>high)return null;
  }
  return [low,high].map(t=>[clamp(a[0]+t*dx,0,1),clamp(a[1]+t*dy,0,1)]);
}
export function localCenter(crater,tile) {
  const uv=vectorFaceUv(crater.center);
  if(uv.face!==tile.face)return null;
  const x=(uv.u+1)*CELLS_PER_FACE/2-tile.col,y=(1-uv.v)*CELLS_PER_FACE/2-tile.row;
  return x>=0&&x<=1&&y>=0&&y<=1 ? [x,y] : null;
}
export function tileCircle(crater,tile,steps=512) {
  const ring=circleVectors(crater.lon,crater.lat,crater.diameter,steps), lines=[];
  for(let i=1;i<ring.length;i++) {
    const face=clipFace(ring[i-1],ring[i],tile.face);if(!face)continue;
    const segment=clipSquare(inTile(face[0],tile),inTile(face[1],tile));if(!segment)continue;
    const last=lines.at(-1);
    if(last&&Math.hypot(last.at(-1)[0]-segment[0][0],last.at(-1)[1]-segment[0][1])<1e-9)last.push(segment[1]);
    else lines.push(segment);
  }
  return {...crater,localLines:lines,localCenter:localCenter(crater,tile)};
}
export function catalogueForTile(craters,tile) {
  const center=tileVector(tile,.5,.5);let radius=0;
  for(const x of [0,.25,.5,.75,1])for(const y of [0,.25,.5,.75,1])radius=Math.max(radius,angularDistance(center,tileVector(tile,x,y)));
  const result=[];
  for(const crater of craters) {
    const separation=angularDistance(crater.center,center);
    if(separation>crater.radius+radius+.0005)continue;
    const item=tileCircle(crater,tile);
    if(item.localLines.length||item.localCenter||separation<crater.radius)result.push(item);
  }
  return result;
}
export function coordinatesOf(vector) { return vectorCoordinate(vector); }
