// Checks a map for mistakes that are easy to make, especially for an
// AI writing maps: rooms that should connect but don't touch, links to
// rooms that don't exist, things floating outside their room.
//
//   node tools/check.mjs path/to/map.json
//
// Prints one line per problem. Exits with 1 if there are errors.
import fs from 'fs';
import { compileRoom } from '../src/shapes.js';

const file = process.argv[2];
if (!file) { console.error('usage: node tools/check.mjs map.json'); process.exit(2); }
let map;
try { map = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch (e) { console.log(`error: ${file} is not valid JSON: ${e.message}`); process.exit(1); }

const errors = [], warnings = [];
// with a level model, rooms are named areas on top of it: they don't
// have to overlap, the model's own geometry decides where you can go
const areaMode = Array.isArray(map.models) && map.models.length > 0;
for (const [i, m] of (map.models || []).entries()) {
  if (!m.file) errors.push(`model ${i + 1} has no "file"`);
  else if (!/\.(glb|gltf)$/i.test(m.file)) warnings.push(`model "${m.file}" is not a .glb or .gltf file`);
  else {
    const path = new URL(m.file, 'file://' + fs.realpathSync(file)).pathname;
    if (!fs.existsSync(path)) errors.push(`model "${m.file}" was not found next to the map`);
  }
}
const rooms = new Map();
for (const [i, r] of (map.rooms || []).entries()) {
  if (!r.name) { errors.push(`room ${i + 1} has no name`); continue; }
  if (rooms.has(r.name)) { errors.push(`two rooms are called "${r.name}"`); continue; }
  try { rooms.set(r.name, { json: r, sdf: compileRoom(r) }); }
  catch (e) { errors.push(e.message); }
}

const overlapBox = (a, b) => {
  const min = [0, 1, 2].map(i => Math.max(a.min[i], b.min[i]));
  const max = [0, 1, 2].map(i => Math.min(a.max[i], b.max[i]));
  return min.every((v, i) => v <= max[i]) ? { min, max } : null;
};
// do the two rooms share any open space (is there a way through)?
function touches(a, b) {
  const box = overlapBox(a.sdf.bbox, b.sdf.bbox);
  if (!box) return false;
  const N = 18;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) for (let k = 0; k <= N; k++) {
    const x = box.min[0] + (box.max[0] - box.min[0]) * i / N;
    const y = box.min[1] + (box.max[1] - box.min[1]) * j / N;
    const z = box.min[2] + (box.max[2] - box.min[2]) * k / N;
    if (a.sdf.eval(x, y, z) < -0.05 && b.sdf.eval(x, y, z) < -0.05) return true;
  }
  return false;
}

const names = [...rooms.keys()];
const touchSet = new Map(names.map(n => [n, new Set()]));
for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
  const a = rooms.get(names[i]), b = rooms.get(names[j]);
  if (touches(a, b)) { touchSet.get(names[i]).add(names[j]); touchSet.get(names[j]).add(names[i]); }
}

for (const [name, r] of rooms) {
  for (const l of r.json.links || []) {
    if (!rooms.has(l)) errors.push(`"${name}" links to "${l}", but there is no room with that name`);
    else if (!areaMode && !touchSet.get(name).has(l)) {
      errors.push(`"${name}" links to "${l}", but their shapes don't overlap, so there is no way through`);
    }
  }
  for (const o of touchSet.get(name)) {
    const linked = (r.json.links || []).includes(o) || (rooms.get(o).json.links || []).includes(name);
    if (!areaMode && !linked && name < o) warnings.push(`"${name}" and "${o}" overlap (there is an opening) but neither lists the other in links`);
  }
  if (!areaMode && rooms.size > 1 && touchSet.get(name).size === 0) warnings.push(`"${name}" doesn't touch any other room`);
  const b = r.sdf.bbox;
  if (!areaMode && b.max[1] - b.min[1] < 1.9) warnings.push(`"${name}" is under 1.9 m tall: a player can't stand up in it`);
  for (const [i, t] of (r.json.things || []).entries()) {
    const label = `"${name}" thing ${i + 1}${t.name ? ` (${t.name})` : ''}`;
    if (!['box', 'cylinder', 'cone', 'sphere', 'pipe'].includes(t.type)) { errors.push(`${label}: unknown type "${t.type}"`); continue; }
    const c = t.type === 'pipe' ? (t.points || [])[0] : t.center;
    if (!c) { errors.push(`${label}: needs ${t.type === 'pipe' ? '"points"' : '"center"'}`); continue; }
    // a big thing can have its middle in a pillar: try a few points
    const sz = t.size || [0, 0, 0];
    const pts = [c, ...[[-1, 0, -1], [1, 0, 1], [-1, 0, 1], [1, 0, -1]].map(o => o.map((v, q) => c[q] + v * sz[q] / 3))];
    if (pts.every(q => r.sdf.eval(q[0], q[1], q[2]) > 0.5)) warnings.push(`${label} is outside the room's space (it would be inside the wall)`);
  }
}

for (const e of errors) console.log('error:   ' + e);
for (const w of warnings) console.log('warning: ' + w);
const nThings = [...rooms.values()].reduce((a, r) => a + (r.json.things || []).length, 0);
console.log(`${rooms.size} rooms, ${nThings} things: ${errors.length} errors, ${warnings.length} warnings`);
process.exit(errors.length ? 1 : 0);
