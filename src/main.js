import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { compileRoom } from './shapes.js';
import { roomMaterial, autoColor } from './look.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ---------- three.js ----------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, logarithmicDepthBuffer: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 1e6);
camera.position.set(80, 60, 80);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.zoomToCursor = true;
controls.screenSpacePanning = true;
controls.addEventListener('change', requestRender);

const LOOKS = {
  wireframe: { bg: '#04060c', fog: '#04060c' },
  washed: { bg: '#0a121c', fog: '#1b2a36' },
};
let look = 'wireframe';
try { if (localStorage.holomapLook in LOOKS) look = localStorage.holomapLook; } catch (e) {}

// ---------- state ----------
const S = {
  base: params.get('maps') || 'maps/',
  versions: [],        // [{label, file}]
  version: 0,
  mapText: null,
  map: null,
  live: true,          // poll the file for changes
  rooms: new Map(),    // name -> room record
  order: [],           // names in map order
  selected: null,
  isolate: false,
  district: params.get('d') || '',
  inside: null,        // name of the room the camera is in
  cutY: Infinity,
  saved: null,         // camera before going inside
  job: 0,
  pending: 0,
  errors: [],
};

// ---------- worker ----------
const worker = new Worker(new URL('./worker.js', import.meta.url),
  { type: 'module' });
const meshCache = new Map(); // geometry key -> mesh data
worker.onmessage = e => {
  const m = e.data;
  if (m.job !== S.job) return;
  if (m.done) { S.pending = 0; setStatus(); return; }
  S.pending--;
  if (m.error) { S.errors.push(m.error); setStatus(); return; }
  meshCache.set(m.key, m.mesh);
  for (const r of S.rooms.values()) if (r.key === m.key) attachMesh(r, m.mesh);
  setStatus();
  requestRender();
};

function geoKey(room) {
  return JSON.stringify([room.prims || [], room.blend || 0]);
}

// ---------- loading ----------
async function fetchText(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}

async function findVersions() {
  const tryBase = async base => {
    const txt = await fetchText(base + 'index.json');
    const j = JSON.parse(txt);
    const list = Array.isArray(j) ? j : (j.maps || []);
    return list.map(x => typeof x === 'string'
      ? { file: x, label: x.replace(/\.json$/, '') }
      : { file: x.file, label: x.label || x.file.replace(/\.json$/, '') });
  };
  try {
    S.versions = await tryBase(S.base);
  } catch (e) {
    if (params.get('maps')) throw e;
    S.base = 'examples/demo/';
    S.versions = await tryBase(S.base);
  }
  const want = params.get('v');
  const i = S.versions.findIndex(v => v.label === want);
  S.version = i >= 0 ? i : S.versions.length - 1;
}

async function poll() {
  if (!S.live || !S.versions.length) return;
  const v = S.versions[S.version];
  try {
    const txt = await fetchText(S.base + v.file);
    if (txt !== S.mapText) useMapText(txt, v.file);
  } catch (e) {
    showError(String(e.message || e));
  }
}

function useMapText(txt, file) {
  let map;
  try { map = JSON.parse(txt); }
  catch (e) { showError(`${file}: not valid JSON (${e.message})`); return; }
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

  const rooms = (map.rooms || []).filter(r => r && r.name);
  const seen = new Set();
  S.order = [];
  const todo = [];
  rooms.forEach((rj, i) => {
    if (seen.has(rj.name)) { showError(`two rooms are called "${rj.name}"`); return; }
    seen.add(rj.name);
    S.order.push(rj.name);
    const key = geoKey(rj);
    let r = S.rooms.get(rj.name);
    if (!r) {
      r = { name: rj.name, mesh: null, key: null };
      S.rooms.set(rj.name, r);
    }
    r.json = rj;
    r.index = i;
    r.district = rj.district || '';
    r.color = rj.color ? new THREE.Color(rj.color) : autoColor(i);
    if (r.mesh) r.mesh.material.uniforms.uColor.value.copy(r.color);
    if (r.key !== key) {
      r.key = key;
      try { r.sdf = compileRoom(rj); }
      catch (e) { showError(String(e.message)); r.sdf = null; }
      if (meshCache.has(key)) attachMesh(r, meshCache.get(key));
      else if (r.sdf) todo.push({ key, room: rj });
    }
  });
  for (const [name, r] of S.rooms) {
    if (!seen.has(name)) {
      if (r.mesh) { group.remove(r.mesh); r.mesh.geometry.dispose(); }
      S.rooms.delete(name);
    }
  }
  if (S.selected && !S.rooms.has(S.selected)) S.selected = null;
  if (S.inside && !S.rooms.has(S.inside)) leaveRoom();

  const unique = [...new Map(todo.map(t => [t.key, t])).values()];
  if (unique.length) {
    S.job++;
    S.pending = unique.length;
    // smaller rooms first so the map fills in quickly
    unique.sort((a, b) => size(a.room) - size(b.room));
    worker.postMessage({ job: S.job, rooms: unique });
  }
  buildDistricts();
  buildList();
  showCard();
  applyStates();
  setStatus();
  if (first) {
    const wait = () => (S.pending > 0 && !anyMesh())
      ? setTimeout(wait, 100) : frameAll(false);
    wait();
  }
}
function size(rj) {
  try {
    const b = compileRoom(rj).bbox;
    return (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);
  } catch (e) { return 0; }
}
function anyMesh() {
  for (const r of S.rooms.values()) if (r.mesh) return true;
  return false;
}

function attachMesh(r, m) {
  const g = new THREE.BufferGeometry();
  const c = [
    (m.bbox.min[0] + m.bbox.max[0]) / 2,
    (m.bbox.min[1] + m.bbox.max[1]) / 2,
    (m.bbox.min[2] + m.bbox.max[2]) / 2,
  ];
  // centre the geometry so see-through rooms sort by distance
  const p = new Float32Array(m.positions.length);
  for (let i = 0; i < p.length; i += 3) {
    p[i] = m.positions[i] - c[0];
    p[i + 1] = m.positions[i + 1] - c[1];
    p[i + 2] = m.positions[i + 2] - c[2];
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  if (r.mesh) {
    r.mesh.geometry.dispose();
    r.mesh.geometry = g;
  } else {
    r.mesh = new THREE.Mesh(g, roomMaterial(r.color));
    r.mesh.userData.name = r.name;
    group.add(r.mesh);
  }
  r.mesh.position.set(...c);
  r.bbox = m.bbox;
  // the real size of the room, from its surface (for the card)
  const gb = g.boundingBox;
  r.extent = {
    min: [gb.min.x + c[0], gb.min.y + c[1], gb.min.z + c[2]],
    max: [gb.max.x + c[0], gb.max.y + c[1], gb.max.z + c[2]],
  };
  r.insidePoint = new THREE.Vector3(...m.inside);
  r.depth = m.depth;
  applyStates();
}

function visible(r) {
  return !S.district || r.district === S.district;
}

function applyStates() {
  const L = LOOKS[look];
  for (const r of S.rooms.values()) {
    if (!r.mesh) continue;
    const u = r.mesh.material.uniforms;
    const vis = visible(r);
    r.mesh.visible = vis;
    u.uWashed.value = look === 'washed' ? 1 : 0;
    u.uSelected.value = r.name === S.selected && r.name !== S.inside ? 1 : 0;
    u.uInside.value = r.name === S.inside ? 1 : 0;
    let dim = 1;
    if (S.isolate && S.selected && r.name !== S.selected) dim = 0.07;
    else if (S.inside && r.name !== S.inside) dim = 0.35;
    u.uDim.value = dim;
    u.uClipY.value = S.cutY;
    u.uFogColor.value.set(L.fog);
  }
  scene.background = new THREE.Color(L.bg);
  requestRender();
}

// ---------- camera helpers ----------
function worldBox(onlyVisible = true) {
  const b = new THREE.Box3();
  for (const r of S.rooms.values()) {
    if (!r.bbox || (onlyVisible && !visible(r))) continue;
    b.expandByPoint(new THREE.Vector3(...r.bbox.min));
    b.expandByPoint(new THREE.Vector3(...r.bbox.max));
  }
  return b;
}
function worldSize() {
  const b = worldBox(false);
  return b.isEmpty() ? 100 : b.getSize(new THREE.Vector3()).length();
}

let anim = null;
function flyTo(pos, target, ms = 600, done) {
  anim = {
    t0: performance.now(), ms,
    p0: camera.position.clone(), p1: pos.clone(),
    q0: controls.target.clone(), q1: target.clone(), done,
  };
  requestRender();
}

function frameBox(b, animate = true) {
  if (b.isEmpty()) return;
  const c = b.getCenter(new THREE.Vector3());
  const r = Math.max(b.getSize(new THREE.Vector3()).length() / 2, 2);
  const dist = r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.9;
  let dir = camera.position.clone().sub(controls.target);
  if (dir.lengthSq() < 1e-6) dir.set(1, 0.8, 1);
  dir.normalize();
  if (dir.y < 0.25) { dir.y = 0.6; dir.normalize(); }
  const pos = c.clone().addScaledVector(dir, dist);
  if (animate) flyTo(pos, c);
  else { camera.position.copy(pos); controls.target.copy(c); requestRender(); }
}
function frameAll(animate = true) {
  if (S.inside) leaveRoom(false);
  frameBox(worldBox(), animate);
}
function frameRoom(r) {
  if (!r.bbox) return;
  if (S.inside) leaveRoom(false);
  frameBox(new THREE.Box3(
    new THREE.Vector3(...r.bbox.min), new THREE.Vector3(...r.bbox.max)));
}

// ---------- inside a room ----------
// Inside, the camera looks around from where it stands and moves
// with keys. It can't leave through walls: it only moves into
// space that belongs to a room.
const look3 = { yaw: 0, pitch: 0 };
const keys = new Set();

function airAt(p) {
  let best = null, bestD = Infinity;
  for (const r of S.rooms.values()) {
    if (!r.sdf || !r.bbox || !visible(r)) continue;
    const b = r.bbox;
    if (p.x < b.min[0] || p.y < b.min[1] || p.z < b.min[2]
      || p.x > b.max[0] || p.y > b.max[1] || p.z > b.max[2]) continue;
    const d = r.sdf.eval(p.x, p.y, p.z);
    if (d < bestD) { bestD = d; best = r; }
  }
  return bestD < 0 ? { room: best, d: bestD } : null;
}

function enterRoom(r, at) {
  if (!r.insidePoint) return;
  if (!S.inside) {
    S.saved = { pos: camera.position.clone(), target: controls.target.clone() };
  }
  const p = at || r.insidePoint.clone();
  const dir = controls.target.clone().sub(camera.position);
  dir.y = 0;
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
  dir.normalize();
  look3.yaw = Math.atan2(-dir.x, -dir.z);
  look3.pitch = -0.15;
  controls.enabled = false;
  S.inside = r.name;
  S.selected = r.name;
  const ahead = lookDir();
  flyTo(p, p.clone().add(ahead), 700);
  applyStates(); showCard(); buildList(); setWhere();
}
function leaveRoom(animate = true) {
  if (!S.inside) return;
  S.inside = null;
  controls.enabled = true;
  keys.clear();
  if (S.saved && animate) flyTo(S.saved.pos, S.saved.target, 600);
  else if (S.saved) {
    camera.position.copy(S.saved.pos); controls.target.copy(S.saved.target);
  }
  S.saved = null;
  applyStates(); setWhere();
}
function lookDir() {
  const cp = Math.cos(look3.pitch);
  return new THREE.Vector3(
    -Math.sin(look3.yaw) * cp, Math.sin(look3.pitch), -Math.cos(look3.yaw) * cp);
}
function moveInside(delta) {
  const p = camera.position;
  const margin = 0.15;
  const ok = q => { const a = airAt(q); return a && a.d < -margin ? a : null; };
  let next = p.clone().add(delta);
  let a = ok(next);
  if (!a) { // slide along walls: try each axis on its own
    next = p.clone();
    for (const ax of ['x', 'y', 'z']) {
      const t = next.clone(); t[ax] += delta[ax];
      if (ok(t)) next = t;
    }
    a = ok(next);
    if (!a) return;
  }
  p.copy(next);
  // stay in the current room while still in it
  const cur = S.rooms.get(S.inside);
  if (cur && cur.sdf && cur.sdf.eval(p.x, p.y, p.z) < 0) { setWhere(); return; }
  if (a.room.name !== S.inside) {
    S.inside = a.room.name;
    S.selected = a.room.name;
    applyStates(); showCard(); buildList();
  }
  setWhere();
}

let dragging = null;
canvas.addEventListener('pointerdown', e => {
  dragging = { x: e.clientX, y: e.clientY, moved: 0 };
});
addEventListener('pointerup', () => { dragging = null; });
canvas.addEventListener('pointermove', e => {
  if (dragging) {
    const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y;
    dragging.moved += Math.abs(dx) + Math.abs(dy);
    dragging.x = e.clientX; dragging.y = e.clientY;
    if (S.inside && !anim) {
      look3.yaw -= dx * 0.004;
      look3.pitch = THREE.MathUtils.clamp(look3.pitch - dy * 0.004, -1.5, 1.5);
      requestRender();
    }
  }
  hoverAt(e);
});
// on window, in the capture phase, so it runs before the orbit
// controls and can stop shift+scroll from zooming
addEventListener('wheel', e => {
  if (e.target !== canvas) return;
  if (e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    cutBy(e.deltaY || e.deltaX);
    return;
  }
  if (S.inside) {
    e.preventDefault();
    if (anim) return;
    moveInside(lookDir().multiplyScalar(-Math.sign(e.deltaY) * speed() * 0.25));
    requestRender();
  }
}, { passive: false, capture: true });

function speed() {
  const r = S.rooms.get(S.inside);
  const base = r ? THREE.MathUtils.clamp(r.depth * 1.2, 2, 30) : 5;
  return keys.has('Shift') ? base * 3 : base;
}

// ---------- section cut ----------
function cutBy(dy) {
  const b = worldBox();
  if (b.isEmpty()) return;
  const h = b.max.y - b.min.y;
  const cur = Number.isFinite(S.cutY) ? S.cutY : b.max.y;
  let y = cur - Math.sign(dy) * Math.max(h / 60, 0.5);
  if (y >= b.max.y) y = Infinity;
  else y = Math.max(y, b.min.y);
  S.cutY = y;
  applyStates(); setStatus();
}

// ---------- picking ----------
const ray = new THREE.Raycaster();
function pick(e) {
  const rect = canvas.getBoundingClientRect();
  const m = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1);
  ray.setFromCamera(m, camera);
  const targets = [];
  for (const r of S.rooms.values()) {
    if (!r.mesh || !r.mesh.visible) continue;
    if (S.isolate && S.selected && r.name !== S.selected) continue;
    targets.push(r.mesh);
  }
  const hits = ray.intersectObjects(targets, false)
    .filter(h => h.point.y <= S.cutY);
  if (!hits.length) return null;
  // inside a room, the walls around you come first: skip them
  if (S.inside) {
    const other = hits.find(h => h.object.userData.name !== S.inside);
    const h = other || hits[0];
    return { room: S.rooms.get(h.object.userData.name), point: h.point };
  }
  return { room: S.rooms.get(hits[0].object.userData.name), point: hits[0].point };
}

let hoverT = 0;
function hoverAt(e) {
  const now = performance.now();
  if (now - hoverT < 90 || dragging) return;
  hoverT = now;
  const h = pick(e);
  const tip = $('tip');
  if (h) {
    tip.textContent = h.room.name;
    tip.style.left = e.clientX + 14 + 'px';
    tip.style.top = e.clientY + 10 + 'px';
    tip.style.display = 'block';
  } else tip.style.display = 'none';
}
canvas.addEventListener('pointerleave', () => { $('tip').style.display = 'none'; });

canvas.addEventListener('click', e => {
  if (dragging && dragging.moved > 4) return;
  const h = pick(e);
  select(h ? h.room.name : null);
});
canvas.addEventListener('dblclick', e => {
  const h = pick(e);
  if (!h) return;
  const r = h.room;
  // go to where you clicked, a little way into the room
  let at = null;
  if (r.sdf) {
    const dir = h.point.clone().sub(camera.position).normalize();
    for (let t = 0.5; t < 12; t += 0.5) {
      const q = h.point.clone().addScaledVector(dir, t);
      if (r.sdf.eval(q.x, q.y, q.z) < -Math.min(1.2, r.depth * 0.6)) { at = q; break; }
    }
  }
  enterRoom(r, at);
});

function select(name) {
  S.selected = name;
  if (!name && S.isolate) S.isolate = false;
  applyStates(); showCard(); buildList();
}

// ---------- keys ----------
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === 'Escape') {
    if (S.inside) leaveRoom();
    else if (S.isolate) { S.isolate = false; applyStates(); }
    else select(null);
    return;
  }
  if (k === 'f') { frameAll(); return; }
  if (k === 'i') {
    if (S.selected) { S.isolate = !S.isolate; applyStates(); setStatus(); }
    return;
  }
  if (S.inside && 'wasdqe'.includes(k) || k === 'Shift'
    || k.startsWith('Arrow')) {
    keys.add(k);
    if (S.inside) { e.preventDefault(); requestRender(); }
  }
});
addEventListener('keyup', e => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  keys.delete(k);
});
addEventListener('blur', () => keys.clear());

function keyMove(dt) {
  if (!S.inside || anim || !keys.size) return false;
  const f = lookDir(); f.y = 0; f.normalize();
  const right = new THREE.Vector3(-f.z, 0, f.x);
  const v = new THREE.Vector3();
  if (keys.has('w') || keys.has('ArrowUp')) v.add(f);
  if (keys.has('s') || keys.has('ArrowDown')) v.sub(f);
  if (keys.has('d') || keys.has('ArrowRight')) v.add(right);
  if (keys.has('a') || keys.has('ArrowLeft')) v.sub(right);
  if (keys.has('e')) v.y += 1;
  if (keys.has('q')) v.y -= 1;
  if (v.lengthSq() === 0) return false;
  v.normalize().multiplyScalar(speed() * dt);
  moveInside(v);
  return true;
}

// ---------- panels ----------
function buildDistricts() {
  const ds = [];
  for (const n of S.order) {
    const d = S.rooms.get(n).district;
    if (d && !ds.includes(d)) ds.push(d);
  }
  $('districtRow').hidden = ds.length === 0;
  const sel = $('district');
  if (S.district && !ds.includes(S.district)) S.district = '';
  sel.innerHTML = '<option value="">all</option>';
  for (const d of ds) {
    const o = document.createElement('option');
    o.value = o.textContent = d;
    sel.append(o);
  }
  sel.value = S.district;
}
$('district').addEventListener('change', e => {
  S.district = e.target.value;
  const u = new URL(location);
  if (S.district) u.searchParams.set('d', S.district); else u.searchParams.delete('d');
  history.replaceState(null, '', u);
  if (S.inside) leaveRoom(false);
  applyStates(); buildList(); frameAll();
});

function buildVersions() {
  $('versionRow').hidden = S.versions.length < 2;
  const box = $('versions');
  box.innerHTML = '';
  S.versions.forEach((v, i) => {
    const b = document.createElement('button');
    b.textContent = v.label;
    b.classList.toggle('on', i === S.version);
    b.onclick = () => setVersion(i);
    box.append(b);
  });
}
function setVersion(i) {
  if (i === S.version) return;
  S.version = i;
  S.mapText = null;
  const u = new URL(location);
  u.searchParams.set('v', S.versions[i].label);
  history.replaceState(null, '', u);
  buildVersions();
  poll();
}

function buildList() {
  const q = $('search').value.trim().toLowerCase();
  const box = $('rooms');
  box.innerHTML = '';
  for (const n of S.order) {
    const r = S.rooms.get(n);
    if (!visible(r)) continue;
    if (q && !n.toLowerCase().includes(q)) continue;
    const d = document.createElement('div');
    d.textContent = n;
    if (n === S.selected) d.className = 'on';
    if (!S.district && r.district) {
      const t = document.createElement('span');
      t.className = 'd'; t.textContent = r.district;
      d.prepend(t);
    }
    d.onclick = () => { select(n); frameRoom(r); };
    d.ondblclick = () => enterRoom(r);
    box.append(d);
  }
}
$('search').addEventListener('input', buildList);

function linksOf(name) {
  const out = [...(S.rooms.get(name).json.links || [])];
  for (const n of S.order) {
    const o = S.rooms.get(n).json;
    if ((o.links || []).includes(name) && !out.includes(n)) out.push(n);
  }
  return out;
}

function showCard() {
  const r = S.selected && S.rooms.get(S.selected);
  if (!r) {
    $('name').textContent = 'nothing selected';
    $('info').textContent = 'click a room';
    $('note').textContent = '';
    $('links').innerHTML = '';
    return;
  }
  $('name').textContent = r.name;
  const lines = [];
  if (r.district) lines.push(r.district);
  if (r.extent) {
    const b = r.extent, u = (S.map && S.map.units) || 'm';
    const w = b.max[0] - b.min[0], l = b.max[2] - b.min[2], h = b.max[1] - b.min[1];
    lines.push(`${fmt(w)} × ${fmt(l)} ${u}, ${fmt(h)} ${u} tall`);
    lines.push(`floor at y ${fmt(b.min[1])}`);
  }
  const tags = r.json.tags || [];
  if (tags.length) lines.push(tags.join(', '));
  $('info').textContent = lines.join('\n');
  $('note').textContent = r.json.note || '';
  const box = $('links');
  box.innerHTML = '';
  const ls = linksOf(r.name);
  if (ls.length) {
    const t = document.createElement('div');
    t.className = 'dim'; t.textContent = 'links to';
    box.append(t);
  }
  for (const n of ls) {
    const s = document.createElement('span');
    s.textContent = n;
    const target = S.rooms.get(n);
    if (!target) s.style.opacity = 0.5;
    s.onclick = () => {
      if (!target) return;
      if (!visible(target)) { S.district = ''; buildDistricts(); applyStates(); }
      select(n);
      if (S.inside) enterRoom(target); else frameRoom(target);
    };
    box.append(s);
  }
}
const fmt = v => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)).replace(/\.0$/, '');

for (const b of document.querySelectorAll('#looks button')) {
  b.classList.toggle('on', b.dataset.look === look);
  b.onclick = () => {
    look = b.dataset.look;
    try { localStorage.holomapLook = look; } catch (e) {}
    for (const o of document.querySelectorAll('#looks button')) {
      o.classList.toggle('on', o === b);
    }
    applyStates();
  };
}

let gridStep = 1;
function setStatus() {
  const lines = [];
  if (S.pending > 0) lines.push(`building rooms… ${S.pending} left`);
  if (Number.isFinite(S.cutY)) lines.push(`cut at y ${fmt(S.cutY)} (shift+scroll)`);
  if (S.isolate) lines.push('isolated (I or Esc to undo)');
  lines.push(`grid lines every ${fmt(gridStep)} m, bold every ${fmt(gridStep * 5)} m`);
  if (!S.live) lines.push('dropped file (not watching for changes)');
  const box = $('status');
  box.textContent = lines.join('\n');
  for (const err of S.errors.slice(-4)) {
    const d = document.createElement('div');
    d.className = 'err'; d.textContent = err;
    box.append(d);
  }
}
function setWhere() {
  $('where').textContent = S.inside
    ? `inside ${S.inside}` : '';
}

// ---------- drop a file ----------
addEventListener('dragover', e => { e.preventDefault(); $('drop').style.display = 'flex'; });
addEventListener('dragleave', () => { $('drop').style.display = 'none'; });
addEventListener('drop', async e => {
  e.preventDefault();
  $('drop').style.display = 'none';
  const f = e.dataTransfer.files[0];
  if (!f) return;
  S.live = false;
  S.versions = [{ label: f.name.replace(/\.json$/, ''), file: f.name }];
  S.version = 0;
  buildVersions();
  S.map = null;
  useMapText(await f.text(), f.name);
});

// ---------- render loop ----------
let needRender = true;
function requestRender() { needRender = true; }
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  requestRender();
}
addEventListener('resize', resize);
resize();

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  let busy = false;

  if (anim) {
    const t = Math.min((now - anim.t0) / anim.ms, 1);
    const k = t * t * (3 - 2 * t);
    camera.position.lerpVectors(anim.p0, anim.p1, k);
    controls.target.lerpVectors(anim.q0, anim.q1, k);
    if (S.inside) camera.lookAt(controls.target);
    if (t >= 1) { const d = anim.done; anim = null; if (d) d(); }
    busy = true;
  } else if (S.inside) {
    if (keyMove(dt)) busy = true;
    controls.target.copy(camera.position).add(lookDir());
    camera.lookAt(controls.target);
  }
  if (!S.inside && !anim) {
    if (controls.update()) busy = true;
  }
  if (!needRender && !busy) return;
  needRender = false;

  // near/far and grid spacing follow how far away you're looking
  const dist = S.inside ? 8 : camera.position.distanceTo(controls.target);
  const size = worldSize();
  camera.near = S.inside ? 0.03 : Math.max(dist / 2000, 0.03);
  camera.far = Math.max(size * 20, dist * 20, 500);
  camera.updateProjectionMatrix();
  let step = 1;
  while (step * 60 < dist) step *= 5;
  if (step !== gridStep) { gridStep = step; setStatus(); }
  const fogDist = S.inside ? 80 : Math.max(size * 1.5, dist * 3);
  for (const r of S.rooms.values()) {
    if (!r.mesh) continue;
    const u = r.mesh.material.uniforms;
    u.uCam.value.copy(camera.position);
    u.uStep.value = step;
    u.uFogDist.value = fogDist;
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// ---------- start ----------
(async () => {
  try {
    await findVersions();
    buildVersions();
    await poll();
  } catch (e) {
    showError('no maps found: ' + (e.message || e));
  }
  setInterval(poll, 1000);
})();

// for poking at the viewer from the browser console
window.holomap = { state: S, camera, enterRoom, leaveRoom, airAt };
