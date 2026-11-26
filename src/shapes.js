// Room shapes -> signed distance functions.
// Negative = inside the room (the space you can walk in).
// Shared by the main page (inside tests) and the worker (meshing).

const D2R = Math.PI / 180;

// ---------- noise (for cave walls) ----------
function hash(x, y, z) {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let fx = x - xi, fy = y - yi, fz = z - zi;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const c000 = hash(xi, yi, zi), c100 = hash(xi + 1, yi, zi);
  const c010 = hash(xi, yi + 1, zi), c110 = hash(xi + 1, yi + 1, zi);
  const c001 = hash(xi, yi, zi + 1), c101 = hash(xi + 1, yi, zi + 1);
  const c011 = hash(xi, yi + 1, zi + 1), c111 = hash(xi + 1, yi + 1, zi + 1);
  const x00 = c000 + (c100 - c000) * fx, x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx, x11 = c011 + (c111 - c011) * fx;
  const y0 = x00 + (x10 - x00) * fy, y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}
function fbm(x, y, z, oct) {
  let a = 0.5, s = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * (vnoise(x * f, y * f, z * f) * 2 - 1);
    f *= 2.03; a *= 0.5;
  }
  return s;
}

// ---------- helpers ----------
function bboxOf(points, pad) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let i = 0; i < 3; i++) {
    mn[i] = Math.min(mn[i], p[i] - pad);
    mx[i] = Math.max(mx[i], p[i] + pad);
  }
  return { min: mn, max: mx };
}
function unionBox(a, b) {
  return {
    min: a.min.map((v, i) => Math.min(v, b.min[i])),
    max: a.max.map((v, i) => Math.max(v, b.max[i])),
  };
}
// rotation in degrees, applied X then Y then Z (same as three.js 'XYZ')
function rotation(deg) {
  const [a, b, c] = deg.map(v => v * D2R);
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  const cc = Math.cos(c), sc = Math.sin(c);
  // R = Rx * Ry * Rz (row-major)
  return [
    cb * cc, -cb * sc, sb,
    ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb,
    sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb,
  ];
}
function need(pr, room, ...keys) {
  for (const k of keys) {
    if (pr[k] === undefined) {
      throw new Error(`room "${room}": ${pr.type} needs "${k}"`);
    }
  }
}

// ---------- shapes ----------
function box(pr, room) {
  need(pr, room, 'center', 'size');
  const c = pr.center, h = pr.size.map(v => v / 2);
  const R = pr.rotate ? rotation(pr.rotate) : null;
  const corners = [];
  for (let i = 0; i < 8; i++) {
    const l = [i & 1 ? h[0] : -h[0], i & 2 ? h[1] : -h[1], i & 4 ? h[2] : -h[2]];
    if (R) {
      corners.push([
        c[0] + R[0] * l[0] + R[1] * l[1] + R[2] * l[2],
        c[1] + R[3] * l[0] + R[4] * l[1] + R[5] * l[2],
        c[2] + R[6] * l[0] + R[7] * l[1] + R[8] * l[2],
      ]);
    } else corners.push([c[0] + l[0], c[1] + l[1], c[2] + l[2]]);
  }
  return {
    bbox: bboxOf(corners, 0),
    eval(x, y, z) {
      let px = x - c[0], py = y - c[1], pz = z - c[2];
      if (R) { // local = R^T * p
        const qx = R[0] * px + R[3] * py + R[6] * pz;
        const qy = R[1] * px + R[4] * py + R[7] * pz;
        const qz = R[2] * px + R[5] * py + R[8] * pz;
        px = qx; py = qy; pz = qz;
      }
      const qx = Math.abs(px) - h[0], qy = Math.abs(py) - h[1], qz = Math.abs(pz) - h[2];
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
      return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0);
    },
  };
}

function segment(a, b, r) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const bb = bax * bax + bay * bay + baz * baz || 1e-9;
  return (x, y, z) => {
    const pax = x - a[0], pay = y - a[1], paz = z - a[2];
    let t = (pax * bax + pay * bay + paz * baz) / bb;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = pax - bax * t, dy = pay - bay * t, dz = paz - baz * t;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
  };
}
function capsule(pr, room) {
  need(pr, room, 'a', 'b', 'radius');
  return { bbox: bboxOf([pr.a, pr.b], pr.radius), eval: segment(pr.a, pr.b, pr.radius) };
}
function polyline(pr, room) {
  need(pr, room, 'points', 'radius');
  const segs = [];
  for (let i = 0; i + 1 < pr.points.length; i++) {
    segs.push(segment(pr.points[i], pr.points[i + 1], pr.radius));
  }
  return {
    bbox: bboxOf(pr.points, pr.radius),
    eval(x, y, z) {
      let d = Infinity;
      for (const s of segs) { const v = s(x, y, z); if (v < d) d = v; }
      return d;
    },
  };
}
function ellipsoid(pr, room) {
  need(pr, room, 'center', 'radii');
  const c = pr.center, r = pr.radii, n = pr.noise || null;
  const amp = n ? n.amp : 0, freq = n ? n.freq : 1, oct = n ? (n.octaves || 3) : 0;
  const pad = Math.max(...r) + amp;
  return {
    bbox: { min: c.map(v => v - pad), max: c.map(v => v + pad) },
    eval(x, y, z) {
      const px = x - c[0], py = y - c[1], pz = z - c[2];
      const k0 = Math.hypot(px / r[0], py / r[1], pz / r[2]);
      const k1 = Math.hypot(px / (r[0] * r[0]), py / (r[1] * r[1]), pz / (r[2] * r[2]));
      let d = k1 < 1e-9 ? -Math.min(...r) : k0 * (k0 - 1) / k1;
      if (n) d += amp * fbm(x * freq, y * freq, z * freq, oct);
      return d;
    },
  };
}
// stairs: the air above each step, rising from "from" to "to"
function stairs(pr, room) {
  need(pr, room, 'from', 'to', 'steps', 'width', 'height');
  const f = pr.from, t = pr.to, n = Math.max(1, pr.steps | 0);
  const dx = t[0] - f[0], dz = t[2] - f[2], dy = t[1] - f[1];
  const len = Math.hypot(dx, dz);
  const yaw = Math.atan2(-dz, dx) / D2R;
  const parts = [];
  for (let i = 0; i < n; i++) {
    const s0 = i / n, sm = (i + 0.5) / n;
    const bottom = f[1] + dy * s0;
    parts.push(box({
      center: [f[0] + dx * sm, bottom + pr.height / 2, f[2] + dz * sm],
      size: [len / n + 0.05, pr.height, pr.width],
      rotate: [0, yaw, 0],
    }, room));
  }
  let bbox = parts[0].bbox;
  for (const p of parts) bbox = unionBox(bbox, p.bbox);
  return {
    bbox,
    eval(x, y, z) {
      let d = Infinity;
      for (const p of parts) { const v = p.eval(x, y, z); if (v < d) d = v; }
      return d;
    },
  };
}

export const SHAPES = { box, capsule, polyline, ellipsoid, stairs };

function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

// One room of the map -> { bbox, eval }
export function compileRoom(r) {
  const name = r.name || '(unnamed room)';
  const adds = [], cuts = [];
  for (const pr of r.prims || []) {
    const make = SHAPES[pr.type];
    if (!make) throw new Error(`room "${name}": unknown shape "${pr.type}"`);
    (pr.op === 'cut' ? cuts : adds).push(make(pr, name));
  }
  if (!adds.length) throw new Error(`room "${name}": has no shapes`);
  const blend = r.blend || 0;
  let bbox = adds[0].bbox;
  for (const a of adds) bbox = unionBox(bbox, a.bbox);
  bbox = { min: bbox.min.map(v => v - blend), max: bbox.max.map(v => v + blend) };
  return {
    bbox,
    eval(x, y, z) {
      let d = adds[0].eval(x, y, z);
      for (let i = 1; i < adds.length; i++) d = smin(d, adds[i].eval(x, y, z), blend);
      for (const c of cuts) { const v = -c.eval(x, y, z); if (v > d) d = v; }
      return d;
    },
  };
}
