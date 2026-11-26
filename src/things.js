// Things inside rooms: crates, machines, pillars, platforms,
// catwalks, pipes... Each one is a simple solid shape.
import * as THREE from 'three';

const D2R = Math.PI / 180;
export const THING_COLOR = '#b9b2a6';

function geometryFor(t) {
  switch (t.type) {
    case 'box': {
      const s = t.size || [1, 1, 1];
      return new THREE.BoxGeometry(s[0], s[1], s[2]);
    }
    case 'cylinder':
      return new THREE.CylinderGeometry(
        t.radiusTop ?? t.radius ?? 0.5, t.radius ?? 0.5, t.height ?? 1, 28);
    case 'cone':
      return new THREE.ConeGeometry(t.radius ?? 0.5, t.height ?? 1, 28);
    case 'sphere':
      return new THREE.SphereGeometry(t.radius ?? 0.5, 28, 18);
    case 'pipe': {
      const pts = (t.points || []).map(p => new THREE.Vector3(...p));
      if (pts.length < 2) return null;
      const path = new THREE.CurvePath();
      for (let i = 0; i + 1 < pts.length; i++) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
      return new THREE.TubeGeometry(path, Math.max(8, pts.length * 12), t.radius ?? 0.2, 12, false);
    }
    default:
      return null;
  }
}

// Returns { group, solids, errors }. solids are boxes you can stand
// on and bump into (used when walking).
export function buildThings(things, clipPlanes, roomName) {
  const group = new THREE.Group();
  const solids = [];
  const errors = [];
  (things || []).forEach((t, i) => {
    const g = geometryFor(t);
    if (!g) { errors.push(`room "${roomName}": thing ${i + 1} has unknown type "${t.type}" or is missing fields`); return; }
    const color = new THREE.Color(t.color || THING_COLOR);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      color, roughness: 0.7, metalness: 0.05,
      clippingPlanes: clipPlanes, clipShadows: true,
    }));
    m.userData.base = color.clone();
    m.userData.thing = t;
    m.userData.room = roomName;
    if (t.type !== 'pipe') {
      m.position.set(...(t.center || [0, 0, 0]));
      if (t.rotate) m.rotation.set(t.rotate[0] * D2R, t.rotate[1] * D2R, t.rotate[2] * D2R);
    }
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    if (t.solid ?? t.type !== 'pipe') {
      m.updateMatrixWorld(true);
      g.computeBoundingBox();
      solids.push({ box: g.boundingBox.clone().applyMatrix4(m.matrixWorld), thing: t });
    }
  });
  return { group, solids, errors };
}
