import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { compileRoom } from './shapes.js';
import { buildThings } from './things.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BG = 0xdcdad5;

// ---------- colours ----------
// low = cool, high = warm, so heights read at a glance
const RAMP = ['#3c4f8c', '#3b7fa0', '#4f9c84', '#9bb36a', '#d8b25e', '#d8875a', '#c15f58']
  .map(c => new THREE.Color(c));
function ramp(t) {
  t = Math.min(Math.max(t, 0), 1) * (RAMP.length - 1);
  const i = Math.min(Math.floor(t), RAMP.length - 2);
  return RAMP[i].clone().lerp(RAMP[i + 1], t - i);
}
const CATS = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#edc948',
  '#b07aa1', '#ff9da7', '#9c755f', '#86bcb6', '#8cd17d', '#d4a6c8']
  .map(c => new THREE.Color(c));

// ---------- three.js ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
scene.fog = new THREE.Fog(BG, 1e5, 1e6);
const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 1e6);
camera.position.set(80, 60, 80);

const hemi = new THREE.HemisphereLight(0xffffff, 0x6f7786, 1.05);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.7);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.4;
scene.add(sun, sun.target);
const lamp = new THREE.PointLight(0xffffff, 0, 0, 1); // camera light when inside
scene.add(lamp);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.zoomToCursor = true;
controls.screenSpacePanning = true;
controls.addEventListener('change', requestRender);


const clipTop = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e9);
const clipBottom = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e9);

// ---------- state ----------
let saved = {};
try { saved = JSON.parse(localStorage.holomap2 || '{}'); } catch (e) {}
const S = {
  base: params.get('maps') || 'maps/',
  versions: [], version: 0,
  mapText: null, map: null, live: true,
  rooms: new Map(), order: [],
  selected: null, hovered: null,
  inside: null, saved: null,
  hidden: new Set(),            // districts switched off
  colourBy: saved.colourBy || 'height',
  roofOpen: true,
  labels: saved.labels !== false,
  win: null,                    // [low, high] heights shown, or null = all
  world: null,                  // box around all rooms
  job: 0, pending: 0, errors: [],
};
const save = () => {
  try { localStorage.holomap2 = JSON.stringify({ colourBy: S.colourBy, labels: S.labels }); }
  catch (e) {}
};

// ---------- worker ----------
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const meshCache = new Map();
worker.onmessage = e => {
  const m = e.data;
  if (m.job !== S.job) return;
  if (m.done) { S.pending = 0; setStatus(); return; }
  S.pending--;
  if (m.error) { showError(m.error); return; }
  meshCache.set(m.key, m.mesh);
  for (const r of S.rooms.values()) if (r.key === m.key) attachMesh(r, m.mesh);
  worldChanged();
  setStatus();
};
const geoKey = rj => JSON.stringify([rj.prims || [], rj.blend || 0]);

// ---------- loading ----------
async function fetchText(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}
async function findVersions() {
  const load = async base => {
    const j = JSON.parse(await fetchText(base + 'index.json'));
    const list = Array.isArray(j) ? j : (j.maps || []);
    return list.map(x => typeof x === 'string'
      ? { file: x, label: x.replace(/\.json$/, '') }
      : { file: x.file, label: x.label || x.file.replace(/\.json$/, '') });
  };
  try { S.versions = await load(S.base); }
  catch (e) {
    if (params.get('maps')) throw e;
    S.base = 'examples/demo/';
    S.versions = await load(S.base);
  }
  const i = S.versions.findIndex(v => v.label === params.get('v'));
  S.version = i >= 0 ? i : S.versions.length - 1;
}
async function poll() {
  if (!S.live || !S.versions.length) return;
  const v = S.versions[S.version];
  try {
    const txt = await fetchText(S.base + v.file);
    if (txt !== S.mapText) useMapText(txt, v.file);
  } catch (e) { showError(String(e.message || e)); }
}
function useMapText(txt, file) {
  let map;
  try { map = JSON.parse(txt); }
  catch (e) { showError(`${file} is not valid JSON: ${e.message}`); return; }
  S.mapText = txt;
  S.errors = [];
  setMap(map);
}
function showError(msg) {
  if (!S.errors.includes(msg)) S.errors.push(msg);
  setStatus();
}

// ---------- rooms ----------
const group = new THREE.Group();
scene.add(group);

function setMap(map) {
  const first = !S.map;
  S.map = map;
  $('title').textContent = map.name || 'holomap';
  document.title = (map.name ? map.name + ' · ' : '') + 'holomap';
  const seen = new Set();
  const todo = [];
  S.order = [];
  (map.rooms || []).forEach((rj, i) => {
    if (!rj || !rj.name) return;
    if (seen.has(rj.name)) { showError(`Two rooms are called "${rj.name}"`); return; }
    seen.add(rj.name);
    S.order.push(rj.name);
    let r = S.rooms.get(rj.name);
    if (!r) {
      r = { name: rj.name, key: null, mesh: null, solids: [] };
      // each room can lift its own roof, on top of the layer cut
      r.roof = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e9);
      r.clip = [clipTop, clipBottom, r.roof];
      S.rooms.set(rj.name, r);
    }
    r.json = rj; r.index = i; r.district = rj.district || '';
    const tk = JSON.stringify(rj.things || []);
    if (r.thingKey !== tk) { r.thingKey = tk; rebuildThings(r); }
    const own = geoKey(rj);
    if (r.ownKey !== own) {
      r.ownKey = own;
      try { r.sdf = compileRoom(rj); } catch (e) { showError(e.message); r.sdf = null; }
    }
  });
  // a room's mesh depends on itself and the rooms that overlap it
  const list = S.order.map(n => S.rooms.get(n)).filter(r => r.sdf);
  const touch = (a, b) => [0, 1, 2].every(i =>
    a.sdf.bbox.min[i] <= b.sdf.bbox.max[i] && a.sdf.bbox.max[i] >= b.sdf.bbox.min[i]);
  for (const r of list) {
    const nb = list.filter(o => o !== r && touch(r, o));
    const key = JSON.stringify([r.ownKey, nb.map(o => o.ownKey).sort()]);
    if (r.key === key) continue;
    r.key = key;
    if (meshCache.has(key)) attachMesh(r, meshCache.get(key));
    else todo.push({ key, room: r.json, neighbours: nb.map(o => o.json) });
  }
  for (const [name, r] of S.rooms) {
    if (seen.has(name)) continue;
    if (r.mesh) { group.remove(r.mesh); r.mesh.geometry.dispose(); }
    if (r.thingGroup) scene.remove(r.thingGroup);
    if (r.label) r.label.remove();
    S.rooms.delete(name);
  }
  if (S.selected && !S.rooms.has(S.selected)) S.selected = null;
  if (S.inside && !S.rooms.has(S.inside)) leaveRoom(false);
  const unique = [...new Map(todo.map(t => [t.key, t])).values()];
  if (unique.length) {
    S.job++; S.pending = unique.length;
    worker.postMessage({ job: S.job, rooms: unique });
  }
  buildDistricts(); buildResults(); showCard();
  worldChanged(); setStatus();
  if (first) {
    const wait = () => (S.pending > 0) ? setTimeout(wait, 80) : frameAll(false);
    wait();
  }
}
const anyMesh = () => [...S.rooms.values()].some(r => r.mesh);

function attachMesh(r, m) {
  const c = [0, 1, 2].map(i => (m.bbox.min[i] + m.bbox.max[i]) / 2);
  const p = new Float32Array(m.positions.length);
  for (let i = 0; i < p.length; i += 3) {
    p[i] = m.positions[i] - c[0];
    p[i + 1] = m.positions[i + 1] - c[1];
    p[i + 2] = m.positions[i + 2] - c[2];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(p.length), 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeBoundingBox(); g.computeBoundingSphere();
  if (r.mesh) { r.mesh.geometry.dispose(); r.mesh.geometry = g; }
  else {
    r.mesh = new THREE.Mesh(g, roomMaterial(r.clip));
    r.mesh.castShadow = r.mesh.receiveShadow = true;
    r.mesh.userData.name = r.name;
    group.add(r.mesh);
  }
  r.mesh.position.set(...c);
  r.bbox = m.bbox;
  const gb = g.boundingBox;
  r.extent = new THREE.Box3(gb.min.clone().add(r.mesh.position), gb.max.clone().add(r.mesh.position));
  r.insidePoint = new THREE.Vector3(...m.inside);
  r.depth = m.depth;
  // a few surface points for the side view
  const n = p.length / 3, stepN = Math.max(1, Math.floor(n / 1500));
  r.samples = [];
  for (let i = 0; i < n; i += stepN) {
    r.samples.push(m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]);
  }
}

const shown = r => !S.hidden.has(r.district);

function rebuildThings(r) {
  if (r.thingGroup) {
    scene.remove(r.thingGroup);
    r.thingGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  }
  const t = buildThings(r.json.things, r.clip, r.name);
  r.thingGroup = t.group;
  r.solids = t.solids;
  r.thingGroup.visible = false;
  scene.add(r.thingGroup);
  for (const e of t.errors) showError(e);
}

// Solid, matte rooms. Inside a room, faint 1 m lines on the floor
// and walls help you judge size and see that you are moving.
const gridU = { value: 0 };
function roomMaterial(clip) {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.85, metalness: 0,
    side: THREE.DoubleSide, shadowSide: THREE.DoubleSide,
    clippingPlanes: clip, clipShadows: true,
  });
  m.onBeforeCompile = sh => {
    sh.uniforms.uGrid = gridU;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;\nvarying vec3 vWn;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWn = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uGrid;
varying vec3 vWp;
varying vec3 vWn;
float gline(float c) { float w = fwidth(c); return 1.0 - smoothstep(0.0, 1.2 * w, abs(fract(c - 0.5) - 0.5)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
if (uGrid > 0.0) {
  // the outward normal points down on floors, up on ceilings
  float floorK = smoothstep(-0.6, -0.85, vWn.y);
  float ceilK = smoothstep(0.6, 0.85, vWn.y);
  float flr = floorK + ceilK;
  float l = flr * max(gline(vWp.x), gline(vWp.z)) + (1.0 - flr) * gline(vWp.y);
  diffuseColor.rgb *= (1.0 - 0.28 * l) * (1.0 + 0.18 * floorK) * (1.0 - 0.3 * ceilK);
}`);
  };
  return m;
}

// ---------- world, colours, layers ----------
let bandSize = 10;
function worldChanged() {
  const b = new THREE.Box3();
  for (const r of S.rooms.values()) if (r.extent) b.union(r.extent);
  S.world = b.isEmpty() ? null : b;
  if (S.world) {
    const size = S.world.getSize(new THREE.Vector3());
    const c = S.world.getCenter(new THREE.Vector3());
    const R = size.length() / 2 + 1;
    sun.position.copy(c).add(new THREE.Vector3(0.45, 1, 0.3).normalize().multiplyScalar(R * 2));
    sun.target.position.copy(c);
    const sc = sun.shadow.camera;
    sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R;
    sc.near = 0.1; sc.far = R * 4;
    sc.updateProjectionMatrix();
  }
  // bands about one storey of a typical room, so rooms at
  // different depths get different colours
  if (S.world) {
    const hs = [...S.rooms.values()].filter(r => r.extent)
      .map(r => r.extent.max.y - r.extent.min.y).sort((a, b) => a - b);
    const med = hs[Math.floor(hs.length / 2)] || 10;
    const H = S.world.max.y - S.world.min.y;
    bandSize = niceStep(Math.min(Math.max(med * 1.2, H / 24), H / 4));
  } else bandSize = 10;
  recolour();
  drawElev();
  applyStates();
}
const bandLow = () => Math.floor(S.world.min.y / bandSize) * bandSize;
const bandCount = () => Math.max(1, Math.ceil((S.world.max.y - bandLow()) / bandSize));
function niceStep(x) {
  if (!(x > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  for (const m of [1, 2, 5, 10]) if (x <= m * p) return m * p;
  return 10 * p;
}
function colourAt(r, y) {
  if (S.colourBy === 'district') {
    const ds = districtList();
    return r.district ? CATS[ds.indexOf(r.district) % CATS.length].clone()
      : new THREE.Color('#9aa1ab');
  }
  if (S.colourBy === 'room') return CATS[r.index % CATS.length].clone();
  if (!S.world) return RAMP[0].clone();
  // height: one colour per band, so floors at the same depth match
  const lo = bandLow(), n = bandCount();
  const band = Math.min(Math.max(Math.floor((y - lo) / bandSize), 0), n - 1);
  const col = ramp(n > 1 ? band / (n - 1) : 0.5);
  if (band % 2) col.offsetHSL(0, 0, -0.035);
  return col;
}
// with a room selected, the others go pale so it stands out
const PALE = new THREE.Color('#ecebe7');
function recolour() {
  for (const r of S.rooms.values()) {
    if (!r.mesh) continue;
    const pale = S.selected && !S.inside && r.name !== S.selected;
    const pos = r.mesh.geometry.attributes.position, col = r.mesh.geometry.attributes.color;
    const oy = r.mesh.position.y;
    if (S.colourBy === 'height') {
      for (let i = 0; i < pos.count; i++) {
        const c = colourAt(r, pos.getY(i) + oy);
        if (pale) c.lerp(PALE, 0.7);
        col.setXYZ(i, c.r, c.g, c.b);
      }
    } else {
      const c = colourAt(r, 0);
      if (pale) c.lerp(PALE, 0.7);
      for (let i = 0; i < pos.count; i++) col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }
  for (const r of S.rooms.values()) {
    if (!r.thingGroup) continue;
    const pale = S.selected && !S.inside && r.name !== S.selected;
    for (const m of r.thingGroup.children) {
      m.material.color.copy(m.userData.base);
      if (pale) m.material.color.lerp(PALE, 0.7);
    }
  }
  buildDistricts();
  requestRender();
}

function setWindow(w) {
  if (w && S.world) {
    let [lo, hi] = w;
    const wl = S.world.min.y, wh = S.world.max.y;
    const t = Math.max(hi - lo, Math.min(1, wh - wl));
    lo = Math.max(wl, Math.min(lo, wh - t)); hi = lo + t;
    S.win = (lo <= wl + 1e-6 && hi >= wh - 1e-6) ? null : [lo, hi];
  } else S.win = null;
  applyStates(); drawElev();
}
function stepWindow(dir) {
  if (!S.world) return;
  const wl = S.world.min.y, wh = S.world.max.y;
  const t = S.win ? S.win[1] - S.win[0] : Math.max(bandSize * 2, (wh - wl) / 4);
  if (!S.win) { setWindow(dir > 0 ? [wl, wl + t] : [wh - t, wh]); return; }
  setWindow([S.win[0] + dir * t, S.win[1] + dir * t]);
}

// ---------- states each change ----------
function applyStates() {
  const inWin = r => !S.win || !r.extent
    || (r.extent.max.y >= S.win[0] && r.extent.min.y <= S.win[1]);
  clipTop.constant = S.win && !S.inside ? S.win[1] + 0.05 : 1e9;
  clipBottom.constant = S.win && !S.inside ? -(S.win[0] - 0.05) : 1e9;
  for (const r of S.rooms.values()) {
    if (!r.mesh) continue;
    r.mesh.visible = shown(r) && (S.inside ? true : inWin(r));
    if (r.thingGroup) r.thingGroup.visible = r.mesh.visible;
    // the selected room's roof lifts so you can see what is inside
    r.roof.constant = (S.roofOpen && !S.inside && r.name === S.selected && r.extent)
      ? roofHeight(r) : 1e9;
  }
  // inside: no sun (the ceiling would shade everything); light from
  // above and a lamp at the camera that fades with distance
  lamp.intensity = S.inside ? 14 : 0;
  sun.intensity = S.inside ? 0 : 2.7;
  hemi.intensity = S.inside ? 0.7 : 1.05;
  gridU.value = S.inside ? 1 : 0;
  $('range').textContent = S.win
    ? `showing y ${fmt(S.win[0])} to ${fmt(S.win[1])} ${units()}`
    : `all heights · y ${S.world ? fmt(S.world.min.y) + ' to ' + fmt(S.world.max.y) : '…'} ${units()}`;
  requestRender();
}
function roofHeight(r) {
  const lo = r.extent.min.y, h = r.extent.max.y - lo;
  return lo + Math.min(Math.max(h * 0.85, 2.6), h - 0.25);
}
const units = () => (S.map && S.map.units) || 'm';
const fmt = v => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)).replace(/\.0$/, '');

// rooms between the camera and the selected room fade out
const fadeRay = new THREE.Ray();
function updateFades() {
  const target = !S.inside && S.selected && S.rooms.get(S.selected);
  let center = null, dist = 0;
  if (target && target.extent) {
    center = target.extent.getCenter(new THREE.Vector3());
    dist = camera.position.distanceTo(center);
    fadeRay.set(camera.position, center.clone().sub(camera.position).normalize());
  }
  const hit = new THREE.Vector3();
  for (const r of S.rooms.values()) {
    if (!r.mesh) continue;
    let fade = false;
    if (center && r !== target && r.extent) {
      if (r.extent.containsPoint(camera.position)) fade = true;
      else if (fadeRay.intersectBox(r.extent, hit)
        && camera.position.distanceTo(hit) < dist - 0.5
        && !r.extent.containsPoint(center)) fade = true;
    }
    if (r.thingGroup) r.thingGroup.visible = r.mesh.visible && !fade;
    const m = r.mesh.material;
    if (m.transparent !== fade) {
      m.transparent = fade; m.opacity = fade ? 0.16 : 1;
      m.depthWrite = !fade; m.needsUpdate = true;
      r.mesh.castShadow = !fade;
    }
  }
}

// ---------- camera ----------
let anim = null;
function flyTo(pos, target, ms = 650, done) {
  anim = { t0: performance.now(), ms, p0: camera.position.clone(), p1: pos.clone(),
    q0: controls.target.clone(), q1: target.clone(), done };
  requestRender();
}
function visibleBox() {
  const b = new THREE.Box3();
  for (const r of S.rooms.values()) if (r.mesh && r.mesh.visible && r.extent) b.union(r.extent);
  if (S.win && !b.isEmpty()) { b.min.y = Math.max(b.min.y, S.win[0]); b.max.y = Math.min(b.max.y, S.win[1]); }
  return b;
}
function frameBox(b, dir, animate = true) {
  if (b.isEmpty()) return;
  const c = b.getCenter(new THREE.Vector3());
  const rad = Math.max(b.getSize(new THREE.Vector3()).length() / 2, 2);
  const dist = rad / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.85;
  if (!dir) {
    dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(1, 0.7, 1);
    dir.normalize();
  }
  const pos = c.clone().addScaledVector(dir, dist);
  if (animate) flyTo(pos, c); else { camera.position.copy(pos); controls.target.copy(c); requestRender(); }
}
function frameAll(animate = true) {
  if (S.inside) leaveRoom(false);
  frameBox(visibleBox(), new THREE.Vector3(1, 0.75, 1.15).normalize(), animate);
}
function frameRoom(r) {
  if (!r.extent) return;
  if (S.inside) leaveRoom(false);
  frameBox(r.extent.clone().expandByScalar(Math.max(4, r.extent.getSize(new THREE.Vector3()).length() * 0.3)));
}
function setView(v) {
  if (S.inside) leaveRoom(false);
  const dirs = { '3d': [1, 0.75, 1.15], top: [0.001, 1, 0.02], side: [0, 0.02, 1] };
  frameBox(visibleBox(), new THREE.Vector3(...dirs[v]).normalize());
}

// ---------- inside a room ----------
// Inside, you walk like a player: eyes 1.6 m up, gravity, steps up
// to 0.8 m are climbed (stairs), Space jumps, things are solid and
// you can stand on them. V switches to flying.
const look = { yaw: 0, pitch: 0 };
const keys = new Set();
const EYE = 1.6, STEP = 0.8, GRAV = 22, JUMP = 7.4, BODY = 0.28;
const walk = { feet: new THREE.Vector3(), vy: 0, ground: false, fly: false, start: null };
function lookDir() {
  const cp = Math.cos(look.pitch);
  return new THREE.Vector3(-Math.sin(look.yaw) * cp, Math.sin(look.pitch), -Math.cos(look.yaw) * cp);
}
// distance into the nearest room's open space (negative = inside)
function airD(x, y, z) {
  let best = Infinity, room = null;
  for (const r of S.rooms.values()) {
    if (!r.sdf || !r.bbox || !shown(r)) continue;
    const b = r.bbox;
    if (x < b.min[0] || y < b.min[1] || z < b.min[2]
      || x > b.max[0] || y > b.max[1] || z > b.max[2]) continue;
    const d = r.sdf.eval(x, y, z);
    if (d < best) { best = d; room = r; }
  }
  return { d: best, room };
}
function airAt(p) {
  const a = airD(p.x, p.y, p.z);
  return a.d < 0 ? a : null;
}
function inThing(x, y, z, pad) {
  for (const r of S.rooms.values()) {
    if (!shown(r)) continue;
    for (const s of r.solids) {
      const b = s.box;
      if (y >= b.min.y && y <= b.max.y && x >= b.min.x - pad && x <= b.max.x + pad
        && z >= b.min.z - pad && z <= b.max.z + pad) return true;
    }
  }
  return false;
}
// the highest floor or thing top at or below (x, yTop, z)
function groundBelow(x, yTop, z) {
  let y = yTop, d = airD(x, y, z).d;
  if (d >= 0) return null;
  let step = 0;
  for (let i = 0; i < 900 && d < 0; i++) {
    step = Math.max(-d * 0.9, 0.05);
    y -= step;
    d = airD(x, y, z).d;
    if (y < yTop - 500) return null;
  }
  // find the floor surface exactly between the last two samples
  let lo = y, hi = y + step;
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    if (airD(x, mid, z).d < 0) hi = mid; else lo = mid;
  }
  let g = hi;
  for (const r of S.rooms.values()) {
    if (!shown(r)) continue;
    for (const s of r.solids) {
      const b = s.box;
      if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z
        && b.max.y <= yTop + 1e-3 && b.max.y > g) g = b.max.y;
    }
  }
  return g;
}
// Is there space for a body here? Points around the body must all be
// in open space. (Testing points, not distances, so seams where two
// shapes or rooms join don't count as walls.)
const inAir = (x, y, z) => airD(x, y, z).d < 0;
function bodyFits(x, y, z) {
  if (walk.fly) { // flying, you are just a camera: fits through low gaps
    const e = y + EYE, q = 0.18;
    return inAir(x, e, z) && inAir(x + q, e, z) && inAir(x - q, e, z) && inAir(x, e, z + q)
      && inAir(x, e, z - q) && inAir(x, e + q, z) && inAir(x, e - q, z) && !inThing(x, e, z, 0.15);
  }
  for (const h of [0.35, 1.0, EYE + 0.12]) {
    const yy = y + h;
    if (!inAir(x, yy, z) || !inAir(x + BODY, yy, z) || !inAir(x - BODY, yy, z)
      || !inAir(x, yy, z + BODY) || !inAir(x, yy, z - BODY)) return false;
  }
  return !inThing(x, y + 0.45, z, BODY) && !inThing(x, y + EYE - 0.1, z, BODY);
}

function enterRoom(r, at) {
  if (!r.insidePoint) return;
  if (!S.inside) S.saved = { pos: camera.position.clone(), target: controls.target.clone() };
  const p = at || r.insidePoint.clone();
  const d = controls.target.clone().sub(camera.position); d.y = 0;
  if (d.lengthSq() < 1e-6) d.set(0, 0, -1);
  d.normalize();
  look.yaw = Math.atan2(-d.x, -d.z); look.pitch = -0.05;
  controls.enabled = false;
  S.inside = r.name; S.selected = r.name;
  // stand on the floor below that point, if there is room to stand
  const g = groundBelow(p.x, p.y, p.z);
  walk.vy = 0; walk.ground = true;
  if (g !== null && bodyFits(p.x, g, p.z)) { walk.fly = false; walk.feet.set(p.x, g, p.z); }
  else { walk.fly = true; walk.feet.set(p.x, p.y - EYE, p.z); }
  walk.start = walk.feet.clone();
  const eye = walk.feet.clone(); eye.y += EYE;
  flyTo(eye, eye.clone().add(lookDir()), 750, setWhere);
  recolour(); applyStates(); showCard(); setWhere();
}
function leaveRoom(animate = true) {
  if (!S.inside) return;
  S.inside = null; controls.enabled = true; keys.clear();
  if (S.saved) {
    if (animate) flyTo(S.saved.pos, S.saved.target, 600);
    else { camera.position.copy(S.saved.pos); controls.target.copy(S.saved.target); }
  }
  S.saved = null;
  recolour(); applyStates(); showCard(); setWhere();
}
function toggleFly() {
  walk.fly = !walk.fly; walk.vy = 0;
  setWhere();
}

function tryStep(dx, dz) {
  const f = walk.feet;
  const nx = f.x + dx, nz = f.z + dz;
  if (walk.fly) {
    if (bodyFits(nx, f.y, nz)) { f.x = nx; f.z = nz; return true; }
    return false;
  }
  const g = groundBelow(nx, f.y + STEP, nz);
  if (g === null) return false;                 // a wall
  const ny = g > f.y ? g : f.y;                 // step up onto stairs
  if (!bodyFits(nx, ny, nz)) return false;
  f.x = nx; f.z = nz; f.y = ny;
  return true;
}
function walkStep(dt) {
  if (!S.inside || anim) return false;
  const f = walk.feet;
  const before = f.clone();
  const fw = lookDir(); fw.y = 0; fw.normalize();
  const right = new THREE.Vector3(-fw.z, 0, fw.x), v = new THREE.Vector3();
  if (keys.has('w') || keys.has('ArrowUp')) v.add(fw);
  if (keys.has('s') || keys.has('ArrowDown')) v.sub(fw);
  if (keys.has('d') || keys.has('ArrowRight')) v.add(right);
  if (keys.has('a') || keys.has('ArrowLeft')) v.sub(right);
  const sp = walk.fly ? flySpeed() : (keys.has('Shift') ? 9 : 4.5);
  if (v.lengthSq()) {
    v.normalize().multiplyScalar(sp * dt);
    // small sub-steps so fast moves don't skip through thin walls
    const n = Math.ceil(v.length() / 0.25);
    for (let i = 0; i < n; i++) {
      const dx = v.x / n, dz = v.z / n;
      if (!tryStep(dx, dz) && !tryStep(dx, 0)) tryStep(0, dz);
    }
  }
  if (walk.fly) {
    let up = 0;
    if (keys.has('e') || keys.has(' ')) up += 1;
    if (keys.has('q')) up -= 1;
    if (up) {
      const ny = f.y + up * sp * dt;
      if (bodyFits(f.x, ny, f.z)) f.y = ny;
    }
  } else {
    if (keys.has(' ') && walk.ground) { walk.vy = JUMP; walk.ground = false; }
    walk.vy -= GRAV * dt;
    const ny = f.y + walk.vy * dt;
    const g = groundBelow(f.x, f.y + 0.05, f.z);
    const floor = g === null ? -Infinity : g;
    if (ny <= floor) { f.y = floor; walk.vy = 0; walk.ground = true; }
    else if (walk.vy > 0 && !inAir(f.x, ny + EYE + 0.12, f.z)) { walk.vy = 0; }
    else { f.y = ny; walk.ground = ny - floor < 0.02; }
    // fell out of the map: back to where you came in
    if (S.world && f.y < S.world.min.y - 30) { f.copy(walk.start); walk.vy = 0; }
  }
  camera.position.set(f.x, f.y + EYE, f.z);
  // which room you are in now (stay in the current one while in it)
  const cur = S.rooms.get(S.inside);
  const e = camera.position;
  if (!(cur && cur.sdf && cur.sdf.eval(e.x, e.y, e.z) < 0)) {
    const a = airD(e.x, e.y, e.z);
    if (a.room && a.d < 0 && a.room.name !== S.inside) {
      S.inside = a.room.name; S.selected = a.room.name; showCard();
    }
  }
  const moved = !before.equals(f);
  if (moved) setWhere();
  return moved || walk.vy !== 0 || keys.size > 0;
}
function flySpeed() {
  const r = S.rooms.get(S.inside);
  const b = r ? THREE.MathUtils.clamp(r.depth * 1.2, 3, 30) : 5;
  return keys.has('Shift') ? b * 3 : b;
}
function setWhere() {
  const w = $('where');
  if (!S.inside) { w.style.display = 'none'; return; }
  w.style.display = 'block';
  w.innerHTML = '';
  const b = document.createElement('b'); b.textContent = S.inside;
  const mode = document.createElement('button');
  mode.textContent = walk.fly ? 'flying (V to walk)' : 'walking (V to fly)';
  mode.onclick = () => { toggleFly(); canvas.focus(); };
  const out = document.createElement('button');
  out.textContent = 'leave (Esc)';
  out.onclick = () => leaveRoom();
  const help = walk.fly
    ? ' · drag to look · WASD move · Q/E down/up · shift faster '
    : ' · drag to look · WASD walk · Space jump · shift run ';
  w.append('Inside ', b, ` · y ${fmt(walk.feet.y)}`, help, mode, ' ', out);
}

// ---------- mouse ----------
let drag = null;
canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, moved: 0 }; });
addEventListener('pointerup', () => { lastDrag = drag ? drag.moved : 0; drag = null; });
canvas.addEventListener('pointermove', e => {
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = e.clientX; drag.y = e.clientY;
    if (S.inside && !anim) {
      look.yaw -= dx * 0.004;
      look.pitch = THREE.MathUtils.clamp(look.pitch - dy * 0.004, -1.5, 1.5);
      requestRender();
    }
    return;
  }
  hover(e);
});
canvas.addEventListener('pointerleave', () => { if (S.hovered) { S.hovered = null; requestRender(); } });
addEventListener('wheel', e => {
  if (e.target !== canvas || !S.inside) return;
  e.preventDefault(); e.stopPropagation();
  if (!anim) {
    const f = lookDir(); f.y = 0; f.normalize().multiplyScalar(-Math.sign(e.deltaY) * 0.8);
    tryStep(f.x, f.z);
    camera.position.set(walk.feet.x, walk.feet.y + EYE, walk.feet.z);
  }
  requestRender();
}, { passive: false, capture: true });

const ray = new THREE.Raycaster();
function pick(e) {
  const rect = canvas.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
  const targets = [];
  for (const r of S.rooms.values()) {
    if (!r.mesh || !r.mesh.visible || r.mesh.material.transparent) continue;
    targets.push(r.mesh);
    if (r.thingGroup && r.thingGroup.visible) targets.push(...r.thingGroup.children);
  }
  // skip anything cut away (layer band, lifted roof)
  const kept = h => {
    const r = S.rooms.get(h.object.userData.name || h.object.userData.room);
    return r && r.clip.every(pl => pl.distanceToPoint(h.point) >= -0.02);
  };
  const hits = ray.intersectObjects(targets, false).filter(kept);
  if (!hits.length) return null;
  let h = hits[0];
  // inside a room, its own walls don't count as a pick
  if (S.inside) h = hits.find(x => x.object.userData.thing || x.object.userData.name !== S.inside) || hits[0];
  const name = h.object.userData.name || h.object.userData.room;
  return { room: S.rooms.get(name), point: h.point, thing: h.object.userData.thing || null };
}
let hoverT = 0;
function hover(e) {
  const now = performance.now();
  if (now - hoverT < 80) return;
  hoverT = now;
  const h = pick(e);
  const name = h && !S.inside ? h.room.name : null;
  if (name !== S.hovered) { S.hovered = name; requestRender(); }
  const tip = $('tip');
  if (h && h.thing && h.thing.name) {
    tip.textContent = h.thing.name + (h.thing.note ? ' · ' + h.thing.note : '');
    tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 12 + 'px';
    tip.style.display = 'block';
  } else tip.style.display = 'none';
}
let lastDrag = 0;
canvas.addEventListener('click', e => {
  if (lastDrag > 4) return;          // that was a drag, not a click
  const h = pick(e);
  if (S.inside) return;
  select(h ? h.room.name : null);
});
canvas.addEventListener('dblclick', e => {
  const h = pick(e);
  if (!h) return;
  const r = h.room;
  let at = null;
  if (r.sdf) {
    const dir = h.point.clone().sub(camera.position).normalize();
    for (let t = 0.3; t < 15; t += 0.3) {
      const q = h.point.clone().addScaledVector(dir, t);
      if (r.sdf.eval(q.x, q.y, q.z) < -Math.min(1.2, r.depth * 0.6)) { at = q; break; }
    }
  }
  enterRoom(r, at);
});
function select(name) {
  if (name === S.selected) return;
  S.selected = name;
  recolour(); applyStates(); showCard(); buildResults();
}

// ---------- keys ----------
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') {
    if (e.key === 'Escape') { e.target.value = ''; buildResults(); e.target.blur(); }
    return;
  }
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === 'Escape') { if (S.inside) leaveRoom(); else select(null); return; }
  if (S.inside && k === 'v') { toggleFly(); return; }
  if (S.inside && ('wasdqe '.includes(k) || k.startsWith('Arrow') || k === 'Shift')) {
    keys.add(k); e.preventDefault(); requestRender(); return;
  }
  if (!S.inside && k === 'Enter' && S.selected) { enterRoom(S.rooms.get(S.selected)); return; }
  if (k === 'Shift') { keys.add(k); return; }
  if (k === 'f') frameAll();
  else if (k === 'h') setWindow(null);
  else if (k === '[') stepWindow(-1);
  else if (k === ']') stepWindow(1);
  else if (k === '/') { e.preventDefault(); $('search').focus(); }
});
addEventListener('keyup', e => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
addEventListener('blur', () => keys.clear());

// ---------- side view (layers panel) ----------
const elev = $('elev');
const ex = elev.getContext('2d');
let sideAxis = 'x';
const PADL = 40, PADR = 6, PADY = 8;
function elevMap() {
  const w = elev.clientWidth, h = elev.clientHeight;
  const b = S.world;
  if (!b) return null;
  const a0 = b.min[sideAxis], a1 = b.max[sideAxis];
  const y0 = b.min.y, y1 = b.max.y;
  const sx = (w - PADL - PADR) / Math.max(a1 - a0, 1e-6);
  const sy = (h - 2 * PADY) / Math.max(y1 - y0, 1e-6);
  return {
    w, h, toX: a => PADL + (a - a0) * sx, toY: y => h - PADY - (y - y0) * sy,
    fromY: py => y0 + (h - PADY - py) / sy, y0, y1,
  };
}
function drawElev() {
  const dpr = devicePixelRatio || 1;
  const w = elev.clientWidth, h = elev.clientHeight;
  if (elev.width !== Math.round(w * dpr)) { elev.width = Math.round(w * dpr); elev.height = Math.round(h * dpr); }
  ex.setTransform(dpr, 0, 0, dpr, 0, 0);
  ex.clearRect(0, 0, w, h);
  const M = elevMap();
  if (!M) return;
  // height ruler, coloured like the height bands
  const lo = bandLow(), n = bandCount();
  for (let i = 0; i < n; i++) {
    const a = Math.max(lo + i * bandSize, M.y0), b = Math.min(lo + (i + 1) * bandSize, M.y1);
    const c = ramp(n > 1 ? i / (n - 1) : 0.5); if (i % 2) c.offsetHSL(0, 0, -0.035);
    ex.fillStyle = '#' + c.getHexString();
    ex.fillRect(PADL - 8, M.toY(b), 5, M.toY(a) - M.toY(b));
  }
  ex.fillStyle = '#6b7280'; ex.font = '10px -apple-system, system-ui, sans-serif';
  ex.textAlign = 'right'; ex.textBaseline = 'middle';
  const labelEvery = Math.max(1, Math.ceil(n / 8));
  for (let i = 0; i <= n; i += labelEvery) {
    const y = lo + i * bandSize;
    if (y < M.y0 - 1e-6 || y > M.y1 + 1e-6) continue;
    ex.fillText(fmt(y), PADL - 11, M.toY(y));
  }
  // every room, seen from the side
  for (const n2 of S.order) {
    const r = S.rooms.get(n2);
    if (!r.samples || !shown(r)) continue;
    const s = r.samples, ai = sideAxis === 'x' ? 0 : 2;
    const sel = r.name === S.selected;
    const flat = S.colourBy !== 'height' ? '#' + colourAt(r, 0).getHexString() : null;
    for (let i = 0; i < s.length; i += 3) {
      ex.fillStyle = sel ? '#151a24' : flat || '#' + colourAt(r, s[i + 1]).getHexString();
      ex.fillRect(M.toX(s[i + ai]) - 1, M.toY(s[i + 1]) - 1, 2, 2);
    }
  }
  // the band of heights being shown
  if (S.win) {
    const t = M.toY(S.win[1]), b = M.toY(S.win[0]);
    ex.fillStyle = 'rgba(243,242,239,.8)';
    ex.fillRect(PADL - 2, 0, w, t); ex.fillRect(PADL - 2, b, w, h - b);
    ex.strokeStyle = '#23707a'; ex.lineWidth = 2;
    ex.strokeRect(PADL - 2, t, w - PADL + 1, b - t);
  }
  // where you are
  const at = S.inside ? camera.position : controls.target;
  ex.fillStyle = '#151a24';
  const px = M.toX(at[sideAxis]), py = M.toY(at.y);
  ex.beginPath(); ex.moveTo(px, py - 5); ex.lineTo(px + 4, py + 3); ex.lineTo(px - 4, py + 3); ex.fill();
}
let edrag = null;
elev.addEventListener('pointerdown', e => {
  const M = elevMap(); if (!M) return;
  elev.setPointerCapture(e.pointerId);
  const r = elev.getBoundingClientRect(), py = e.clientY - r.top, y = M.fromY(py);
  edrag = null;
  if (S.win) {
    const t = M.toY(S.win[1]), b = M.toY(S.win[0]);
    if (Math.abs(py - t) < 7) edrag = { mode: 'top' };
    else if (Math.abs(py - b) < 7) edrag = { mode: 'bottom' };
    else if (py > t && py < b) edrag = { mode: 'move', y, win: [...S.win] };
  }
  if (!edrag) {
    const thick = S.win ? S.win[1] - S.win[0] : Math.max(bandSize * 2, (M.y1 - M.y0) / 4);
    setWindow([y - thick / 2, y + thick / 2]);
    edrag = { mode: 'move', y, win: [...(S.win || [M.y0, M.y1])] };
  }
});
elev.addEventListener('pointermove', e => {
  const M = elevMap(); if (!M) return;
  const r = elev.getBoundingClientRect(), py = e.clientY - r.top, y = M.fromY(py);
  if (!edrag) {
    let cur = 'pointer';
    if (S.win && (Math.abs(py - M.toY(S.win[1])) < 7 || Math.abs(py - M.toY(S.win[0])) < 7)) cur = 'row-resize';
    else if (S.win && py > M.toY(S.win[1]) && py < M.toY(S.win[0])) cur = 'grab';
    elev.style.cursor = cur; return;
  }
  const min = Math.max(bandSize / 4, 0.5);
  if (!S.win) return;
  if (edrag.mode === 'top') setWindow([S.win[0], Math.max(y, S.win[0] + min)]);
  else if (edrag.mode === 'bottom') setWindow([Math.min(y, S.win[1] - min), S.win[1]]);
  else setWindow([edrag.win[0] + y - edrag.y, edrag.win[1] + y - edrag.y]);
});
elev.addEventListener('pointerup', () => { edrag = null; });
elev.addEventListener('dblclick', () => setWindow(null));
$('sideName').addEventListener('click', () => {
  sideAxis = sideAxis === 'x' ? 'z' : 'x';
  $('sideName').textContent = sideAxis === 'x' ? 'side view ↻' : 'other side ↻';
  drawElev();
});
$('sideName').textContent = 'side view ↻';
$('sideName').style.cursor = 'pointer';
$('sideName').title = 'Look from the other side';
$('up').onclick = () => stepWindow(1);
$('down').onclick = () => stepWindow(-1);
$('all').onclick = () => setWindow(null);

// ---------- districts ----------
function districtList() {
  const ds = [];
  for (const n of S.order) { const d = S.rooms.get(n).district; if (d && !ds.includes(d)) ds.push(d); }
  return ds;
}
function buildDistricts() {
  const box = $('districts');
  const ds = districtList();
  box.innerHTML = '';
  if (!ds.length) return;
  const t = document.createElement('div'); t.className = 'label-sm'; t.textContent = 'districts';
  box.append(t);
  ds.forEach((d, i) => {
    const l = document.createElement('label');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !S.hidden.has(d);
    cb.onchange = () => {
      if (cb.checked) S.hidden.delete(d); else S.hidden.add(d);
      if (S.inside && !shown(S.rooms.get(S.inside))) leaveRoom(false);
      applyStates(); drawElev(); buildResults();
    };
    const chip = document.createElement('span'); chip.className = 'chip';
    chip.style.background = S.colourBy === 'district' ? '#' + CATS[i % CATS.length].getHexString() : '#c9ccd2';
    const name = document.createElement('span'); name.textContent = d;
    l.append(cb, chip, name);
    box.append(l);
  });
}

// ---------- search ----------
function buildResults() {
  const q = $('search').value.trim().toLowerCase();
  const box = $('results');
  box.innerHTML = '';
  if (document.activeElement !== $('search') && !q) return;
  let n = 0;
  for (const name of S.order) {
    if (q && !name.toLowerCase().includes(q)) continue;
    const r = S.rooms.get(name);
    const d = document.createElement('div');
    if (name === S.selected) d.className = 'on';
    const a = document.createElement('span'); a.textContent = name;
    const b = document.createElement('span'); b.className = 'd';
    b.textContent = [r.district, r.extent ? 'y ' + fmt(r.extent.min.y) : ''].filter(Boolean).join(' · ');
    d.append(a, b);
    d.onmousedown = ev => { ev.preventDefault(); goTo(r); };
    box.append(d);
    if (++n >= 200) break;
  }
}
function goTo(r) {
  if (!shown(r)) { S.hidden.delete(r.district); buildDistricts(); }
  if (S.win && r.extent && (r.extent.max.y < S.win[0] || r.extent.min.y > S.win[1])) setWindow(null);
  select(r.name);
  if (S.inside) enterRoom(r); else frameRoom(r);
}
$('search').addEventListener('input', buildResults);
$('search').addEventListener('focus', buildResults);
$('search').addEventListener('blur', () => setTimeout(() => { $('results').innerHTML = ''; }, 100));
$('search').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const q = e.target.value.trim().toLowerCase();
    const name = S.order.find(n => n.toLowerCase().includes(q));
    if (name) { goTo(S.rooms.get(name)); e.target.blur(); }
  }
});

// ---------- room card ----------
function linksOf(name) {
  const out = [...(S.rooms.get(name).json.links || [])];
  for (const n of S.order) {
    if ((S.rooms.get(n).json.links || []).includes(name) && !out.includes(n)) out.push(n);
  }
  return out;
}
function showCard() {
  const card = $('card');
  const r = S.selected && S.rooms.get(S.selected);
  if (!r) { card.hidden = true; return; }
  card.hidden = false;
  card.innerHTML = '';
  const h = document.createElement('div'); h.className = 'name'; h.textContent = r.name;
  card.append(h);
  if (r.district) { const d = document.createElement('div'); d.className = 'muted'; d.textContent = r.district; card.append(d); }
  const dl = document.createElement('dl');
  const row = (k, v) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd);
  };
  if (r.extent) {
    const e = r.extent, u = units();
    row('height', `y ${fmt(e.min.y)} to ${fmt(e.max.y)} ${u}`);
    row('tall', `${fmt(e.max.y - e.min.y)} ${u}`);
    row('size', `${fmt(e.max.x - e.min.x)} × ${fmt(e.max.z - e.min.z)} ${u}`);
  }
  card.append(dl);
  const tags = r.json.tags || [];
  if (tags.length) {
    const t = document.createElement('div'); t.className = 'tags';
    for (const tag of tags) { const s = document.createElement('span'); s.textContent = tag; t.append(s); }
    card.append(t);
  }
  if (r.json.note) { const n = document.createElement('div'); n.className = 'note'; n.textContent = r.json.note; card.append(n); }
  const ls = linksOf(r.name);
  if (ls.length) {
    const lab = document.createElement('div'); lab.className = 'label-sm'; lab.textContent = 'connects to';
    const box = document.createElement('div'); box.className = 'links';
    for (const n of ls) {
      const s = document.createElement('span'); s.textContent = n;
      const t = S.rooms.get(n);
      if (t) s.onclick = () => goTo(t); else { s.className = 'missing'; s.title = 'No room with this name'; }
      box.append(s);
    }
    card.append(lab, box);
  }
  // what is in the room
  const names = (r.json.things || []).map(t => t.name).filter(Boolean);
  if (names.length) {
    const counts = new Map();
    for (const n of names) counts.set(n, (counts.get(n) || 0) + 1);
    const c = document.createElement('div'); c.className = 'contents';
    // counts help for crates and drums; for stairs and steps they're noise
    c.textContent = 'In here: ' + [...counts].map(([n, k]) => (k > 1 && k <= 8) ? `${n} ×${k}` : n).join(', ');
    card.append(c);
  }
  const go = document.createElement('button');
  go.className = 'primary';
  go.style.width = '100%'; go.style.marginTop = '8px'; go.style.padding = '7px';
  go.textContent = S.inside === r.name ? 'Leave room (Esc)' : 'Enter room (Enter)';
  go.onclick = () => (S.inside === r.name ? leaveRoom() : enterRoom(r));
  card.append(go);
  const row2 = document.createElement('div'); row2.className = 'btnrow';
  const fr = document.createElement('button'); fr.textContent = 'zoom to';
  fr.onclick = () => frameRoom(r);
  const lay = document.createElement('button'); lay.textContent = 'its layer';
  lay.title = 'Show only the heights this room spans';
  lay.onclick = () => r.extent && setWindow([r.extent.min.y - 0.5, r.extent.max.y + 0.5]);
  const roof = document.createElement('button');
  roof.textContent = S.roofOpen ? 'close roof' : 'lift roof';
  roof.title = 'The selected room has its roof lifted so you can see inside';
  roof.onclick = () => { S.roofOpen = !S.roofOpen; applyStates(); showCard(); };
  if (!S.inside) row2.append(fr, lay, roof); else row2.append(lay);
  card.append(row2);
}

// ---------- labels ----------
const labelBox = $('labels');
function drawLabels() {
  const want = [];
  for (const n of S.order) {
    const r = S.rooms.get(n);
    if (!r.mesh || !r.mesh.visible || !r.extent || r.mesh.material.transparent) continue;
    const pri = r.name === S.selected ? 3 : r.name === S.hovered ? 2 : S.labels ? 1 : 0;
    if (!pri || r.name === S.inside || (S.inside && pri < 2)) continue;
    // pin the name to the room itself (a ring's middle is empty)
    const ip = r.insidePoint;
    const top = Math.min(ip.y + r.depth, S.win ? S.win[1] : Infinity);
    const p = new THREE.Vector3(ip.x, top, ip.z);
    const d = camera.position.distanceTo(p);
    p.project(camera);
    if (p.z > 1 || Math.abs(p.x) > 1.05 || Math.abs(p.y) > 1.05) continue;
    want.push({ r, pri, d, x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight });
  }
  want.sort((a, b) => b.pri - a.pri || a.d - b.d);
  const placed = [], used = new Set();
  for (const w of want) {
    const wd = w.r.name.length * 7 + 14, ht = 20;
    const box = { l: w.x - wd / 2, r: w.x + wd / 2, t: w.y - ht - 4, b: w.y };
    if (w.pri < 2 && placed.some(o => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t)) continue;
    placed.push(box);
    let el = w.r.label;
    if (!el) el = w.r.label = document.createElement('div');
    el.textContent = w.pri === 2 ? w.r.name + '  ·  double-click to enter' : w.r.name;
    el.className = w.pri === 3 ? 'sel' : '';
    el.style.left = w.x + 'px'; el.style.top = w.y - 4 + 'px';
    if (!el.parentNode) labelBox.append(el);
    used.add(w.r.name);
  }
  for (const r of S.rooms.values()) if (r.label && !used.has(r.name)) r.label.remove();
}

// ---------- toolbar ----------
function seg(id, value, on) {
  for (const b of $(id).querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.v === value);
    b.onclick = () => on(b.dataset.v);
  }
}
const setColour = v => { S.colourBy = v; save(); seg('colourBy', v, setColour); recolour(); drawElev(); };
seg('colourBy', S.colourBy, setColour);
seg('views', '', v => setView(v));
$('labelsBtn').textContent = S.labels ? 'names: on' : 'names: off';
$('labelsBtn').onclick = () => {
  S.labels = !S.labels; save();
  $('labelsBtn').textContent = S.labels ? 'names: on' : 'names: off';
  requestRender();
};
$('frameBtn').onclick = () => frameAll();
$('helpBtn').onclick = () => { const h = $('help'); h.style.display = h.style.display === 'block' ? 'none' : 'block'; };

function buildVersions() {
  const box = $('versions');
  box.innerHTML = '';
  box.style.display = S.versions.length > 1 ? '' : 'none';
  S.versions.forEach((v, i) => {
    const b = document.createElement('button');
    b.textContent = v.label; b.classList.toggle('on', i === S.version);
    b.onclick = () => {
      if (i === S.version) return;
      S.version = i; S.mapText = null;
      const u = new URL(location); u.searchParams.set('v', v.label); history.replaceState(null, '', u);
      buildVersions(); poll();
    };
    box.append(b);
  });
}
function setStatus() {
  const box = $('status');
  box.innerHTML = '';
  const lines = [];
  if (S.pending > 0) lines.push(`Building rooms… ${S.pending} left`);
  if (!S.live) lines.push('Dropped file: not watching for changes');
  if (lines.length) box.append(lines.join('\n'));
  for (const err of S.errors.slice(-4)) {
    const d = document.createElement('div'); d.className = 'err'; d.textContent = err; box.append(d);
  }
  box.style.display = box.childNodes.length ? 'block' : 'none';
}

// ---------- drop a file ----------
addEventListener('dragover', e => { e.preventDefault(); $('drop').style.display = 'flex'; });
addEventListener('dragleave', () => { $('drop').style.display = 'none'; });
addEventListener('drop', async e => {
  e.preventDefault(); $('drop').style.display = 'none';
  const f = e.dataTransfer.files[0]; if (!f) return;
  S.live = false; S.versions = [{ label: f.name.replace(/\.json$/, ''), file: f.name }];
  S.version = 0; buildVersions(); S.map = null;
  useMapText(await f.text(), f.name);
});

// ---------- render ----------
let needRender = true;
function requestRender() { needRender = true; }
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  drawElev(); requestRender();
}
addEventListener('resize', resize);
resize();

let last = performance.now(), elevT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  let busy = false;
  if (anim) {
    const t = Math.min((now - anim.t0) / anim.ms, 1), k = t * t * (3 - 2 * t);
    camera.position.lerpVectors(anim.p0, anim.p1, k);
    controls.target.lerpVectors(anim.q0, anim.q1, k);
    camera.lookAt(controls.target);
    if (t >= 1) { const d = anim.done; anim = null; if (d) d(); }
    busy = true;
  } else if (S.inside) {
    if (walkStep(dt)) busy = true;
    controls.target.copy(camera.position).add(lookDir());
    camera.lookAt(controls.target);
  } else if (controls.update()) busy = true;
  if (!needRender && !busy) return;
  needRender = false;

  const dist = S.inside ? 10 : camera.position.distanceTo(controls.target);
  const size = S.world ? S.world.getSize(new THREE.Vector3()).length() : 100;
  camera.near = S.inside ? 0.03 : Math.max(dist / 3000, 0.03);
  camera.far = Math.max(size * 20, dist * 20, 500);
  camera.updateProjectionMatrix();
  scene.fog.near = S.inside ? 40 : dist + size * 0.6;
  scene.fog.far = S.inside ? 160 : dist + size * 2.5;
  lamp.position.copy(camera.position);
  updateFades();
  renderer.render(scene, camera);
  drawLabels();
  if (now - elevT > 120) { elevT = now; drawElev(); }
}
requestAnimationFrame(frame);

// ---------- start ----------
(async () => {
  try { await findVersions(); buildVersions(); await poll(); }
  catch (e) { showError('No maps found: ' + (e.message || e)); }
  setInterval(poll, 1000);
})();

window.holomap = { state: S, camera, look, enterRoom, leaveRoom, setWindow, select, requestRender };
