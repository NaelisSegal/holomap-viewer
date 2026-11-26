// Turn one room's distance function into a triangle mesh
// (surface nets). Each room gets its own grid, sized to the
// room, so small rooms stay sharp even in a huge world.
import { compileRoom } from './shapes.js';

const MAX_SAMPLES = 2_500_000;

// neighbours: rooms that overlap this one. Where this room's surface
// lies inside a neighbour, it is left out, so rooms open into each
// other like real doorways instead of being sealed boxes.
export function meshRoom(roomJson, neighbours = [], detail = 1) {
  const room = compileRoom(roomJson);
  const others = [];
  for (const n of neighbours) { try { others.push(compileRoom(n)); } catch (e) {} }
  const { min, max } = room.bbox;
  const ext = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);

  // grid spacing: about 80 cells across the room, never finer
  // than 0.2 m, coarser only if the room is enormous
  let vs = Math.max(ext / (80 * detail), 0.2);
  const dimsFor = s => {
    const pad = 2 * s;
    return [0, 1, 2].map(i => Math.ceil((max[i] - min[i] + 2 * pad) / s) + 1);
  };
  let dims = dimsFor(vs);
  while (dims[0] * dims[1] * dims[2] > MAX_SAMPLES) {
    vs *= 1.15;
    dims = dimsFor(vs);
  }
  const [nx, ny, nz] = dims;
  const pad = 2 * vs;
  const ox = min[0] - pad, oy = min[1] - pad, oz = min[2] - pad;

  // sample the field; also remember the deepest point inside
  const f = new Float32Array(nx * ny * nz);
  let deepest = Infinity, deep = [0, 0, 0];
  let p = 0;
  for (let k = 0; k < nz; k++) {
    const z = oz + k * vs;
    for (let j = 0; j < ny; j++) {
      const y = oy + j * vs;
      for (let i = 0; i < nx; i++, p++) {
        const x = ox + i * vs;
        const d = room.eval(x, y, z);
        f[p] = d;
        if (d < deepest) { deepest = d; deep = [x, y, z]; }
      }
    }
  }

  // prefer the middle of the room if it is nearly as deep
  const mid = [0, 1, 2].map(i => (min[i] + max[i]) / 2);
  const dMid = room.eval(mid[0], mid[1], mid[2]);
  if (dMid <= deepest * 0.85) { deepest = dMid; deep = mid; }

  // one vertex per cell that the surface passes through
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cellVert = new Int32Array(cx * cy * cz).fill(-1);
  const pos = [], nor = [];
  const sx = 1, sy = nx, sz = nx * ny;
  const cornerOff = [
    0, sx, sy, sx + sy, sz, sx + sz, sy + sz, sx + sy + sz,
  ];
  const EDGES = [
    [0, 1], [2, 3], [4, 5], [6, 7], // along x
    [0, 2], [1, 3], [4, 6], [5, 7], // along y
    [0, 4], [1, 5], [2, 6], [3, 7], // along z
  ];
  const cv = new Float32Array(8);
  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        const base = i + j * sy + k * sz;
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          cv[c] = f[base + cornerOff[c]];
          if (cv[c] < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let ax = 0, ay = 0, az = 0, n = 0;
        for (const [a, b] of EDGES) {
          const va = cv[a], vb = cv[b];
          if ((va < 0) === (vb < 0)) continue;
          const t = va / (va - vb);
          ax += (a & 1) + (((b & 1) - (a & 1)) * t);
          ay += ((a >> 1) & 1) + ((((b >> 1) & 1) - ((a >> 1) & 1)) * t);
          az += ((a >> 2) & 1) + ((((b >> 2) & 1) - ((a >> 2) & 1)) * t);
          n++;
        }
        pos.push(
          ox + (i + ax / n) * vs,
          oy + (j + ay / n) * vs,
          oz + (k + az / n) * vs,
        );
        // normal from the exact shape, so lighting is smooth
        const px = pos[pos.length - 3], py = pos[pos.length - 2], pz = pos[pos.length - 1];
        const hh = vs * 0.5;
        const gx = room.eval(px + hh, py, pz) - room.eval(px - hh, py, pz);
        const gy = room.eval(px, py + hh, pz) - room.eval(px, py - hh, pz);
        const gz = room.eval(px, py, pz + hh) - room.eval(px, py, pz - hh);
        const gl = Math.hypot(gx, gy, gz) || 1;
        nor.push(gx / gl, gy / gl, gz / gl);
        cellVert[i + j * cx + k * cx * cy] = pos.length / 3 - 1;
      }
    }
  }

  // how far each surface point is outside the other rooms
  // (negative = inside another room's space)
  const nv = pos.length / 3;
  const ov = new Float32Array(nv).fill(1e9);
  if (others.length) {
    for (let v = 0; v < nv; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      for (const o of others) {
        const b = o.bbox;
        if (x < b.min[0] || y < b.min[1] || z < b.min[2]
          || x > b.max[0] || y > b.max[1] || z > b.max[2]) continue;
        const d = o.eval(x, y, z);
        if (d < ov[v]) ov[v] = d;
      }
    }
  }

  // two triangles for every grid edge that crosses the surface;
  // triangles that reach into another room are cut cleanly where
  // that room starts, so doorways have smooth edges
  const idx = [];
  const cell = (i, j, k) => cellVert[i + j * cx + k * cx * cy];
  const extraOv = [];
  const ovOf = v => (v < nv ? ov[v] : extraOv[v - nv]);
  const cut = (a, b) => { // new point where ov = 0 between a and b
    const da = ovOf(a), db = ovOf(b), t = da / (da - db);
    const n = pos.length / 3;
    for (let q = 0; q < 3; q++) {
      pos.push(pos[a * 3 + q] + (pos[b * 3 + q] - pos[a * 3 + q]) * t);
      nor.push(nor[a * 3 + q] + (nor[b * 3 + q] - nor[a * 3 + q]) * t);
    }
    extraOv.push(0);
    return n;
  };
  const tri = (a, b, c) => {
    const ka = ovOf(a) > 0, kb = ovOf(b) > 0, kc = ovOf(c) > 0;
    const n = ka + kb + kc;
    if (n === 3) { idx.push(a, b, c); return; }
    if (n === 0) return;
    // rotate so the odd one out comes first
    let A = a, B = b, C = c, kA = ka;
    if (kb !== ka && kb !== kc) { A = b; B = c; C = a; kA = kb; }
    else if (kc !== ka && kc !== kb) { A = c; B = a; C = b; kA = kc; }
    const ab = cut(A, B), ac = cut(A, C);
    if (kA) idx.push(A, ab, ac);          // only A is kept
    else idx.push(ab, B, C, ab, C, ac);   // A is dropped
  };
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    // wind the triangles so their front faces point out of the room
    if (flip) { tri(a, b, c); tri(a, c, d); }
    else { tri(a, c, b); tri(a, d, c); }
  };
  // (the 2-cell padding keeps the surface away from the grid edge)
  for (let k = 1; k < cz; k++) {
    for (let j = 1; j < cy; j++) {
      for (let i = 1; i < cx; i++) {
        const v0 = f[i + j * sy + k * sz] < 0;
        if (v0 !== (f[i + 1 + j * sy + k * sz] < 0)) {
          quad(cell(i, j - 1, k - 1), cell(i, j, k - 1),
            cell(i, j, k), cell(i, j - 1, k), v0);
        }
        if (v0 !== (f[i + (j + 1) * sy + k * sz] < 0)) {
          quad(cell(i - 1, j, k - 1), cell(i - 1, j, k),
            cell(i, j, k), cell(i, j, k - 1), v0);
        }
        if (v0 !== (f[i + j * sy + (k + 1) * sz] < 0)) {
          quad(cell(i - 1, j - 1, k), cell(i, j - 1, k),
            cell(i, j, k), cell(i - 1, j, k), v0);
        }
      }
    }
  }

  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nor),
    indices: new Uint32Array(idx),
    bbox: room.bbox,
    inside: deep,          // a point well inside the room
    depth: -deepest,       // how far that point is from the walls
    voxel: vs,
  };
}
