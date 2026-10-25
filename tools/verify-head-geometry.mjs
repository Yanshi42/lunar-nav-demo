import fs from 'node:fs';
import assert from 'node:assert/strict';
import { circleVectors, coordinatesOf, tileCircle, HEAD_RADIUS_KM } from '../dist/head-geometry.js';
import { coordinateVector, tileFromCoordinate, tileFromFaceCell, tileCoordinate, vectorFaceUv } from '../dist/sphere-grid.js';
const data=JSON.parse(fs.readFileSync(new URL('../dist/assets/head-catalog/head.json',import.meta.url)));
assert.equal(data.records.length,5185);assert.equal(HEAD_RADIUS_KM,1737.4);
const radians=x=>x*Math.PI/180;
function distance(lon,lat,x,y){const a=Math.sin(radians(y-lat)/2)**2+Math.cos(radians(lat))*Math.cos(radians(y))*Math.sin(radians(x-lon)/2)**2;return 2*1737.4*Math.asin(Math.sqrt(Math.min(1,a)));}
let maxRadial=0, samples=0;
const records=data.records.map(([lon,lat,diameter],i)=>({id:`Head-${String(i+1).padStart(5,'0')}`,lon,lat,diameter,center:coordinateVector(lat,lon),radius:diameter/(2*1737.4)}));
for(const r of records)for(const vector of circleVectors(r.lon,r.lat,r.diameter,16)){
 assert.ok(Math.abs(Math.hypot(...vector)-1)<1e-12);
 const p=coordinatesOf(vector),error=Math.abs(distance(r.lon,r.lat,p.lon,p.lat)-r.diameter/2);maxRadial=Math.max(error,maxRadial);samples++;assert.ok(error<1e-6,`${r.id} radial error ${error}`);
}
const cases=new Set([0,records.length-1]);
for(const key of ['lat','lon','diameter']){cases.add(records.reduce((a,r,i)=>r[key]<records[a][key]?i:a,0));cases.add(records.reduce((a,r,i)=>r[key]>records[a][key]?i:a,0));}
for(const r of records){const uv=vectorFaceUv(r.center);if(Math.max(Math.abs(uv.u),Math.abs(uv.v))>.998)cases.add(records.indexOf(r));}
let vertices=0,caseCount=0,maxClippedError=0,seamCases=0;
for(const i of cases){
 const r=records[i],home=tileFromCoordinate(r.lat,r.lon),tiles=new Map();
 for(let row=Math.max(0,home.row-1);row<=Math.min(17,home.row+1);row++)for(let col=Math.max(0,home.col-1);col<=Math.min(17,home.col+1);col++){const t=tileFromFaceCell(home.face,row,col);tiles.set(t.id,t);}
 // Follow the actual circumference across faces and the date line.
 for(const v of circleVectors(r.lon,r.lat,r.diameter,32)){const c=coordinatesOf(v),t=tileFromCoordinate(c.lat,c.lon);tiles.set(t.id,t);}
 assert.ok(tileCircle(r,home).localCenter,`${r.id} missing own centre`);
 for(const t of tiles.values()){
  const g=tileCircle(r,t);caseCount++;if(t.face!==home.face&&g.localLines.length)seamCases++;
  for(const line of g.localLines)for(const [x,y] of line){
   assert.ok(x>=0&&x<=1&&y>=0&&y<=1,'Unclipped point');const p=tileCoordinate(t,x,y),error=Math.abs(distance(r.lon,r.lat,p.lon,p.lat)-r.diameter/2);maxClippedError=Math.max(maxClippedError,error);vertices++;assert.ok(error<.25,`${r.id}/${t.id} clipped edge departs from reference circle:${error}km`);
  }
 }
}
assert.ok(seamCases>0);assert.ok(vertices>1000);
console.log(JSON.stringify({status:'passed',all_source_records:records.length,radial_samples:samples,max_radial_error_km:maxRadial,tile_cases:caseCount,seam_cases:seamCases,vertices,max_clipped_error_km:maxClippedError,scope:'Independent longitude/latitude haversine distances; full source coverage and seam/polar/date-line geometry; approximate circles, not crater rims.'}));
