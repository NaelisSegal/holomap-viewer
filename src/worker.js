// Meshes rooms off the main thread so the page stays smooth.
import { meshRoom } from './mesher.js';

self.onmessage = e => {
  const { job, rooms } = e.data;
  for (const { key, room } of rooms) {
    try {
      const m = meshRoom(room);
      self.postMessage({ job, key, mesh: m },
        [m.positions.buffer, m.normals.buffer, m.indices.buffer]);
    } catch (err) {
      self.postMessage({ job, key, error: String(err.message || err) });
    }
  }
  self.postMessage({ job, done: true });
};
