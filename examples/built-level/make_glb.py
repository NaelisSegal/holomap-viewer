#!/usr/bin/env python3
"""Builds ruin.glb, a small "already built" level, the kind of file you
would export from Godot, Unity, Unreal or Blender (File > Export >
glTF 2.0). It stands in for a level from a real game, so holomap's
model support can be tried without one.

    python3 make_glb.py     (writes ruin.glb next to this file)

The level: a walled courtyard with a gate, a well and two trees, a
two-floor tower with stairs inside and a balcony, and a cellar under
the courtyard reached by steps down through an opening.
"""
import json, math, os, struct

meshes = {}   # material name -> (positions, normals, indices)
COLOURS = {"stone": (0.62, 0.6, 0.56), "dark stone": (0.45, 0.44, 0.42), "wood": (0.55, 0.42, 0.28),
           "grass": (0.42, 0.55, 0.32), "leaves": (0.3, 0.45, 0.25), "roof": (0.5, 0.3, 0.25)}


def add(mat, pos, nor, idx):
    P, N, I = meshes.setdefault(mat, ([], [], []))
    base = len(P) // 3
    P += pos; N += nor; I += [base + i for i in idx]


def box(mat, x0, y0, z0, x1, y1, z1):
    """An axis-aligned box from corner to corner."""
    faces = [((1, 0, 0), [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)]),
             ((-1, 0, 0), [(x0, y0, z1), (x0, y1, z1), (x0, y1, z0), (x0, y0, z0)]),
             ((0, 1, 0), [(x0, y1, z0), (x0, y1, z1), (x1, y1, z1), (x1, y1, z0)]),
             ((0, -1, 0), [(x0, y0, z1), (x0, y0, z0), (x1, y0, z0), (x1, y0, z1)]),
             ((0, 0, 1), [(x1, y0, z1), (x1, y1, z1), (x0, y1, z1), (x0, y0, z1)]),
             ((0, 0, -1), [(x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0)])]
    for n, quad in faces:
        pos, nor = [], []
        for v in quad:
            pos += v; nor += n
        add(mat, pos, nor, [0, 1, 2, 0, 2, 3])


def cylinder(mat, cx, y0, cz, r0, y1, r1=None, sides=16):
    r1 = r0 if r1 is None else r1
    for i in range(sides):
        a0, a1 = 2 * math.pi * i / sides, 2 * math.pi * (i + 1) / sides
        p = [(cx + r0 * math.cos(a0), y0, cz + r0 * math.sin(a0)), (cx + r1 * math.cos(a0), y1, cz + r1 * math.sin(a0)),
             (cx + r1 * math.cos(a1), y1, cz + r1 * math.sin(a1)), (cx + r0 * math.cos(a1), y0, cz + r0 * math.sin(a1))]
        am = (a0 + a1) / 2
        n = (math.cos(am), (r0 - r1) / max(y1 - y0, 1e-6), math.sin(am))
        l = math.sqrt(sum(c * c for c in n)); n = tuple(c / l for c in n)
        pos, nor = [], []
        for v in p:
            pos += v; nor += n
        add(mat, pos, nor, [0, 2, 1, 0, 3, 2])
        # caps
        for y, r, up in ((y1, r1, 1), (y0, r0, -1)):
            if r <= 0:
                continue
            tri = [(cx, y, cz), (cx + r * math.cos(a0), y, cz + r * math.sin(a0)), (cx + r * math.cos(a1), y, cz + r * math.sin(a1))]
            pos = [c for v in tri for c in v]
            add(mat, pos, [0, up, 0] * 3, [0, 2, 1] if up > 0 else [0, 1, 2])


# ---- courtyard floor, with an opening for the cellar steps (x 8..11, z -6..4)
box("grass", -20, -0.5, -20, 20, 0, -6)
box("grass", -20, -0.5, 4, 20, 0, 20)
box("grass", -20, -0.5, -6, 8, 0, 4)
box("grass", 11, -0.5, -6, 20, 0, 4)
# ---- outer walls (4 m), gate gap in the south wall at x -2..2
box("stone", -20, 0, -20, 20, 4, -19)
box("stone", -20, 0, -19, -19, 4, 19)
box("stone", 19, 0, -19, 20, 4, 19)
box("stone", -20, 0, 19, -2, 4, 20)
box("stone", 2, 0, 19, 20, 4, 20)
box("dark stone", -2.4, 3.2, 19, 2.4, 4, 20)          # lintel over the gate
# ---- tower: walls x -16..-6, z -16..-6, two floors, door on the east side
T0, T1 = -16, -6
box("stone", T0, 0, T0, T1, 9, T0 + 0.8)               # north
box("stone", T0, 0, T1 - 0.8, T1, 9, T1)               # south
box("stone", T0, 0, T0 + 0.8, T0 + 0.8, 9, T1 - 0.8)   # west
# east wall with a door at ground level and a door to the balcony upstairs
box("stone", T1 - 0.8, 0, T0 + 0.8, T1, 9, -12)
box("stone", T1 - 0.8, 0, -10, T1, 9, T1 - 0.8)
box("stone", T1 - 0.8, 2.6, -12, T1, 4.4, -10)
box("stone", T1 - 0.8, 6.8, -12, T1, 9, -10)
# stairs up the inside of the west wall, z -7.5 -> -14, to the upper floor at 4.4
steps = 11
for i in range(steps):
    z1 = -7.4 - i * 0.6
    box("wood", T0 + 0.8, 0, z1 - 0.6, T0 + 2.2, 0.4 * (i + 1), z1)
# upper floor, leaving a hole over the stairs
box("wood", T0 + 2.2, 4.0, T0 + 0.8, T1 - 0.8, 4.4, T1 - 0.8)
box("wood", T0 + 0.8, 4.0, T0 + 0.8, T0 + 2.2, 4.4, -14.2)
box("roof", T0 - 0.3, 9, T0 - 0.3, T1 + 0.3, 9.5, T1 + 0.3)
# balcony outside the upper door
box("wood", T1, 4.0, -14, -3, 4.4, -8)
box("wood", -3.15, 4.4, -14, -3, 5.4, -8)              # railing
# ---- cellar under the courtyard: x 4..16, z -10..8, floor at -4
C = (4, 16, -10, 8)
box("dark stone", C[0], -4.5, C[2], C[1], -4, C[3])
box("dark stone", C[0] - 0.5, -4.5, C[2] - 0.5, C[1] + 0.5, -0.5, C[2])
box("dark stone", C[0] - 0.5, -4.5, C[3], C[1] + 0.5, -0.5, C[3] + 0.5)
box("dark stone", C[0] - 0.5, -4.5, C[2], C[0], -0.5, C[3])
box("dark stone", C[1], -4.5, C[2], C[1] + 0.5, -0.5, C[3])
# steps down from the courtyard opening (z 4 at the top) to the cellar floor
for i in range(10):
    z0 = 4 - (i + 1) * 1.0
    box("stone", 8, -4, z0, 11, -0.4 * (i + 1), z0 + 1.0)
for i in range(3):                                      # barrels
    cylinder("wood", 13.5, -4, -7 + i * 1.3, 0.5, -2.8, 0.45)
box("wood", 5, -4, 5, 7, -3, 7)                         # crate
# ---- courtyard props
cylinder("dark stone", 2, 0, -2, 1.4, 0.9)              # well
cylinder("dark stone", 2, 0.9, -2, 1.1, 0.95)
for x, z in ((-8, 10), (12, 13)):                       # trees
    cylinder("wood", x, 0, z, 0.35, 3, 0.25)
    cylinder("leaves", x, 2.5, z, 2.2, 6.5, 0)

# ---- write the .glb
bin_ = bytearray()
views, accessors, gl_meshes, materials = [], [], [], []


def push(data, target, comp, count, typ, mn=None, mx=None):
    while len(bin_) % 4:
        bin_.append(0)
    off = len(bin_)
    bin_.extend(data)
    views.append({"buffer": 0, "byteOffset": off, "byteLength": len(data), "target": target})
    a = {"bufferView": len(views) - 1, "componentType": comp, "count": count, "type": typ}
    if mn is not None:
        a["min"], a["max"] = mn, mx
    accessors.append(a)
    return len(accessors) - 1


for name, (P, N, I) in meshes.items():
    n = len(P) // 3
    xs, ys, zs = P[0::3], P[1::3], P[2::3]
    pa = push(struct.pack(f"<{len(P)}f", *P), 34962, 5126, n, "VEC3",
              [min(xs), min(ys), min(zs)], [max(xs), max(ys), max(zs)])
    na = push(struct.pack(f"<{len(N)}f", *N), 34962, 5126, n, "VEC3")
    ia = push(struct.pack(f"<{len(I)}I", *I), 34963, 5125, len(I), "SCALAR")
    materials.append({"name": name, "pbrMetallicRoughness": {
        "baseColorFactor": [*COLOURS[name], 1], "metallicFactor": 0, "roughnessFactor": 0.9}})
    gl_meshes.append({"name": name, "primitives": [{"attributes": {"POSITION": pa, "NORMAL": na},
                                                   "indices": ia, "material": len(materials) - 1}]})

gltf = {"asset": {"version": "2.0", "generator": "holomap make_glb.py"},
        "scene": 0, "scenes": [{"nodes": list(range(len(gl_meshes)))}],
        "nodes": [{"mesh": i, "name": m["name"]} for i, m in enumerate(gl_meshes)],
        "meshes": gl_meshes, "materials": materials, "accessors": accessors,
        "bufferViews": views, "buffers": [{"byteLength": len(bin_)}]}
js = json.dumps(gltf).encode()
js += b" " * ((4 - len(js) % 4) % 4)
while len(bin_) % 4:
    bin_.append(0)
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ruin.glb")
with open(out, "wb") as f:
    f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_)))
    f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
    f.write(struct.pack("<II", len(bin_), 0x004E4942)); f.write(bin_)
print(f"wrote {out}: {sum(len(m[2]) // 3 for m in meshes.values())} triangles")
