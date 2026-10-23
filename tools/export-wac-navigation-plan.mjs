/** Export the actual navigation grid without reimplementing its geometry. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2];
if (!output) throw new Error('Usage: node tools/export-wac-navigation-plan.mjs OUTPUT_DIRECTORY [BUNDLE_DIRECTORY]');
const source = await readFile(path.join(root, 'dist/sphere-grid.js'));
const grid = await import('data:text/javascript;base64,' + source.toString('base64'));
const layerSource = await readFile(path.join(root, 'dist/lfm-layers.js'), 'utf8');
const activeBase = layerSource.match(/const BASE = '([^']+)'/)[1];
const bundle = process.argv[3] || path.join(root, 'dist', activeBase);
const manifest = JSON.parse(await readFile(path.join(bundle, 'manifest.json')));
if (manifest.body !== 'Moon' || manifest.radius_m !== 1737400 || !manifest.tasks.wac) throw new Error('Invalid WAC bundle');
const tiles = [];
for (let face=0; face<6; face++) for (let row=0; row<grid.CELLS_PER_FACE; row++) for (let col=0; col<grid.CELLS_PER_FACE; col++) {
  const tile = grid.tileFromFaceCell(face,row,col);
  if (grid.tileFromCoordinate(tile.lat,tile.lon).id !== tile.id) throw new Error('Grid roundtrip mismatch: '+tile.id);
  const dimensions = grid.tileDimensionsKm(tile);
  const vectors = manifest.tasks.wac.vector_tiles[tile.id] || [];
  const boundary = [];
  for (let edge=0;edge<4;edge++) for(let i=0;i<256;i++) {
    const t=i/256, points=[[t,0],[1,t],[1-t,1],[0,1-t]];
    boundary.push(grid.tileCoordinate(tile,...points[edge]));
  }
  boundary.push(boundary[0]);
  tiles.push({...tile, dimensions_km:dimensions, boundary_lonlat:boundary.map(p=>[p.lon,p.lat]),
    existing_observation_chunks:vectors, existing_candidate_chunk_count:vectors.length,
    production_status:'pending_coverage_audit', valid_input_coverage_fraction:null,
    note:'Candidate chunks are an index, not proof of complete input coverage. Boundary longitudes may cross the date line.'});
}
const data={body:'Moon',radius_m:grid.MOON_RADIUS_KM*1000,tile_scheme:'spherified-cube',
  cells_per_face_side:grid.CELLS_PER_FACE,tile_count:tiles.length,
  grid_source_sha256:createHash('sha256').update(source).digest('hex'),
  existing_science_version:manifest.version,task:'wac',tiles};
if (tiles.length!==grid.TILE_COUNT || new Set(tiles.map(t=>t.id)).size!==1944) throw new Error('Tile count mismatch');
await mkdir(output,{recursive:true});
await writeFile(path.join(output,'navigation-tiles.json'),JSON.stringify(data,null,2)+'\n');
console.log(JSON.stringify({tiles:tiles.length,with_existing_candidate_chunks:tiles.filter(t=>t.existing_candidate_chunk_count>0).length,grid_roundtrip:'passed',output}));
