// Levels exported from a game engine (glTF / .glb). The real level
// geometry is shown, sliced and walked through just like rooms.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

// fast raycasts and collision tests against big meshes
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const D2R = Math.PI / 180;
const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
loader.setDRACOLoader(draco);

// spec: { file, position, rotate (degrees), scale }
// Returns a list of meshes in world space, each with a BVH.
export async function loadModel(url, spec) {
  const gltf = await loader.loadAsync(url);
  const root = gltf.scene;
  const holder = new THREE.Group();
  holder.add(root);
  if (spec.position) holder.position.set(...spec.position);
  if (spec.rotate) holder.rotation.set(spec.rotate[0] * D2R, spec.rotate[1] * D2R, spec.rotate[2] * D2R);
  if (spec.scale !== undefined) {
    const s = Array.isArray(spec.scale) ? spec.scale : [spec.scale, spec.scale, spec.scale];
    holder.scale.set(...s);
  }
  holder.updateMatrixWorld(true);
  const meshes = [];
  root.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    // bake the object's placement into the geometry, so every test
    // below can work in world space
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundsTree();
    const originals = (Array.isArray(o.material) ? o.material : [o.material]).map(m => m.clone());
    const m = new THREE.Mesh(g, originals.length > 1 ? originals : originals[0]);
    m.userData.original = m.material;
    m.userData.model = spec.file;
    m.userData.meshName = o.name || '';
    m.castShadow = m.receiveShadow = true;
    meshes.push(m);
  });
  return meshes;
}

const _sphere = new THREE.Sphere();
export function sphereHits(meshes, x, y, z, r) {
  _sphere.center.set(x, y, z); _sphere.radius = r;
  for (const m of meshes) {
    if (!m.visible && !m.userData.alwaysSolid) continue;
    const bb = m.geometry.boundingBox;
    if (x + r < bb.min.x || x - r > bb.max.x || y + r < bb.min.y || y - r > bb.max.y
      || z + r < bb.min.z || z - r > bb.max.z) continue;
    if (m.geometry.boundsTree.intersectsSphere(_sphere)) return true;
  }
  return false;
}

const _ray = new THREE.Ray(), _down = new THREE.Vector3(0, -1, 0);
// first surface straight below (x, y, z), or null
export function floorBelow(meshes, x, y, z, maxDrop = 500) {
  _ray.origin.set(x, y, z); _ray.direction.copy(_down);
  let best = null;
  for (const m of meshes) {
    const bb = m.geometry.boundingBox;
    if (x < bb.min.x || x > bb.max.x || z < bb.min.z || z > bb.max.z || bb.min.y > y) continue;
    const hit = m.geometry.boundsTree.raycastFirst(_ray, THREE.DoubleSide);
    if (hit && hit.point.y <= y && y - hit.point.y <= maxDrop
      && (best === null || hit.point.y > best)) best = hit.point.y;
  }
  return best;
}
