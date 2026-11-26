#!/usr/bin/env python3
"""Builds the demo level, "The Old Pumping Station", as level.json.

This file also shows how to make a map with code instead of writing
the JSON by hand: rooms are plain dicts, and helpers like crates()
or spiral_steps() place many things at once.

    python3 make_level.py        (writes level.json next to this file)

Layout, top to bottom (y is up, 1 unit = 1 metre):
  Gatehouse (y 0)  ->  Stairwell  ->  Landing  ->  Service corridor
  ->  Pump hall, entered high up on a catwalk; stairs down to the floor
      with three big pumps; a control room off the catwalk
  ->  Drain tunnel (sloping down) -> Flooded cistern with pillars
      -> crawlway to a hidden Valve room
  ->  Shaft up from the cistern, climbed on a spiral of steps
  ->  Overgrown cave off the top of the shaft
  ->  Maintenance tunnel rising back to the Back door near the start
So the level loops: you can come back up to the surface another way.
"""
import json, math, os

R = round
rooms = []


def room(name, district, prims, things=(), links=(), tags=(), note="", blend=0):
    r = {"name": name, "district": district, "tags": list(tags), "note": note,
         "links": list(links), "prims": prims, "things": list(things)}
    if blend:
        r["blend"] = blend
    rooms.append(r)
    return r


def box(center, size, rotate=None, op=None):
    p = {"type": "box", "center": [R(v, 2) for v in center], "size": [R(v, 2) for v in size]}
    if rotate:
        p["rotate"] = rotate
    if op:
        p["op"] = op
    return p


# ---------- things (solid objects inside rooms) ----------
STEEL, RUST, WOOD, STONE, MOSS, PAINT = "#8f979e", "#9a6a4f", "#a98a62", "#a39d93", "#7f9a6a", "#c9a548"


def t_box(name, center, size, color=STEEL, rotate=None, **kw):
    t = {"type": "box", "name": name, "center": [R(v, 2) for v in center],
         "size": [R(v, 2) for v in size], "color": color}
    if rotate:
        t["rotate"] = rotate
    t.update(kw)
    return t


def t_cyl(name, center, radius, height, color=STEEL, **kw):
    t = {"type": "cylinder", "name": name, "center": [R(v, 2) for v in center],
         "radius": radius, "height": height, "color": color}
    t.update(kw)
    return t


def crates(x, floor, z, n=3, color=WOOD):
    out = []
    for i in range(n):
        s = 1.2 if i % 2 == 0 else 1.0
        out.append(t_box("crate", [x + (i % 2) * 1.4, floor + s / 2 + (0 if i < 2 else 1.2), z + (i // 2) * 0.2], [s, s, s], color))
    return out


def railing(name, a, b, y, color=STEEL):
    """A thin rail between two points at height y (not solid)."""
    return {"type": "pipe", "name": name, "points": [[a[0], y, a[1]], [b[0], y, b[1]]],
            "radius": 0.05, "color": color}


def flight(x0, z0, y0, dx, dz, rise, steps, width, name="stairs", color=STEEL):
    """A straight flight of step blocks (things you can walk up)."""
    out = []
    run = math.hypot(dx, dz) / steps
    yaw = math.degrees(math.atan2(-dz, dx))
    for i in range(steps):
        t = (i + 0.5) / steps
        top = y0 + rise * (i + 1) / steps
        out.append(t_box(name, [x0 + dx * t, top - 0.15, z0 + dz * t], [run + 0.05, 0.3, width], color, rotate=[0, R(yaw, 1), 0]))
    return out


def spiral_steps(cx, cz, radius, y0, y1, steps, color=STONE):
    """Stone steps sticking out of a round shaft wall, climbing round it."""
    out = []
    for i in range(steps):
        a = i * 0.42
        y = y0 + (y1 - y0) * (i + 1) / steps
        x, z = cx + radius * math.cos(a), cz + radius * math.sin(a)
        out.append(t_box("step", [x, y - 0.15, z], [2.2, 0.3, 2.0], color, rotate=[0, R(-math.degrees(a), 1), 0]))
    return out


# ---------- surface ----------
room("Gatehouse", "surface",
     [box([0, 2, 0], [10, 4, 9])],
     things=[t_box("bench", [-3, 0.25, 3.4], [3, 0.5, 0.8], WOOD),
             t_box("notice board", [-4.9, 1.8, -1], [0.1, 1.2, 2], PAINT, solid=False),
             t_cyl("lamp post", [3.5, 1.5, 3.2], 0.1, 3, STEEL),
             *crates(-3.5, 0, -3)],
     links=["Stairwell", "Back door"], tags=["start"],
     note="Where the player starts. A small concrete hut over the stairs down.")

# stairwell: two flights down to a landing
room("Stairwell", "pump works",
     [{"type": "stairs", "from": [3, 0, -1.5], "to": [19, -8, -1.5], "steps": 16, "width": 3, "height": 3.6}],
     things=[{"type": "pipe", "name": "handrail", "points": [[3.2, 1, -2.9], [19, -7, -2.9]], "radius": 0.05, "color": STEEL}],
     links=["Gatehouse", "Landing"], tags=["stairs"])
room("Landing", "pump works",
     [box([21.5, -6.2, -1.5], [6, 3.6, 6])],
     things=[t_box("fuse box", [24.4, -6.5, -3.5], [0.3, 1.2, 0.8], PAINT)],
     links=["Stairwell", "Service corridor"])
room("Service corridor", "pump works",
     [box([21.5, -6.2, -14.5], [3.2, 3.6, 23])],
     things=[{"type": "pipe", "name": "water pipe", "points": [[22.8, -4.8, -4], [22.8, -4.8, -23]], "radius": 0.18, "color": RUST}],
     links=["Landing", "Pump hall"], tags=["corridor"])

# ---------- the pump hall ----------
HALL_FLOOR, HALL_TOP = -26, -3.6
hall_things = []
# catwalk along the north wall at the corridor's floor height (-8)
hall_things += [t_box("catwalk", [21.5, -8.2, -26.3], [34, 0.4, 2.6], STEEL)]
hall_things += [railing("catwalk rail", (5, -27.6), (38, -27.6), -7)]
# catwalk along the east wall to the control room
hall_things += [t_box("catwalk", [37.2, -8.2, -33], [2.6, 0.4, 12], STEEL)]
# stairs from the west end of the catwalk down to the floor, two flights
hall_things += flight(6.2, -27.7, -8.0, 0, -9, -9, 18, 2.2)      # down to -17
hall_things += [t_box("stair landing", [6.2, -17.2, -38.5], [2.4, 0.4, 3], STEEL)]
hall_things += flight(6.2, -40, -17.0, 0, -9, -9, 18, 2.2)       # down to -26
# three pumps on the floor, with pipes going into the wall
for i, x in enumerate((15, 23.5, 32)):
    hall_things += [t_cyl("pump", [x, HALL_FLOOR + 3.5, -44], 2.6, 7, RUST),
                    {"type": "cone", "center": [x, HALL_FLOOR + 7.9, -44], "radius": 2.6, "height": 1.8, "color": RUST},
                    {"type": "pipe", "name": "outflow pipe", "points": [[x, HALL_FLOOR + 6, -46.4], [x, HALL_FLOOR + 6, -53], [x, HALL_TOP - 0.6, -53]], "radius": 0.7, "color": STEEL},
                    t_box("pump base", [x, HALL_FLOOR + 0.25, -44], [6.5, 0.5, 6.5], STONE)]
hall_things += [t_box("workbench", [30, HALL_FLOOR + 0.45, -31], [3, 0.9, 1.2], WOOD),
                t_box("tool rack", [33, HALL_FLOOR + 1, -29.4], [2.5, 2, 0.3], STEEL),
                *crates(10, HALL_FLOOR, -50, 4),
                t_cyl("oil drum", [12.5, HALL_FLOOR + 0.6, -31], 0.45, 1.2, PAINT),
                t_cyl("oil drum", [13.5, HALL_FLOOR + 0.6, -31.4], 0.45, 1.2, PAINT)]
room("Pump hall", "pump works",
     [box([21.5, (HALL_FLOOR + HALL_TOP) / 2, -40.5], [34, HALL_TOP - HALL_FLOOR, 30])],
     things=hall_things,
     links=["Service corridor", "Control room", "Drain tunnel"], tags=["big room", "hub"],
     note="You come in high up on the catwalk. Stairs at the west end lead down to the pumps.")
room("Control room", "pump works",
     [box([42, -6.2, -36], [8, 3.6, 7])],
     things=[t_box("control desk", [44.5, -7.55, -36], [1.2, 0.9, 5], STEEL),
             t_box("chair", [43, -7.6, -35], [0.6, 0.8, 0.6], PAINT),
             t_box("chair", [43, -7.6, -37.2], [0.6, 0.8, 0.6], PAINT),
             t_box("logbook shelf", [42, -6.8, -39.3], [3, 2.4, 0.4], WOOD)],
     links=["Pump hall"], tags=["room"],
     note="Looks down over the pump hall from the east catwalk.")

# ---------- down to the cistern ----------
room("Drain tunnel", "cistern",
     [{"type": "capsule", "a": [6, -24.5, -52], "b": [-18, -33.5, -64], "radius": 2.0}],
     links=["Pump hall", "Flooded cistern"], tags=["tunnel"],
     note="A round drain sloping down from the pump hall floor.")
cistern_pillars = [box([x, -33, z], [1.6, 10, 1.6], op="cut")
                   for x in (-38, -30, -22) for z in (-72, -64, -56)]
room("Flooded cistern", "cistern",
     [box([-30, -32, -64], [26, 8, 26])] + cistern_pillars,
     things=[t_box("water (knee deep)", [-30, -35.65, -64], [25.9, 0.7, 25.9], "#5f8fa8", solid=False),
             t_box("broken boat", [-25, -34.9, -59], [1.4, 0.6, 3.6], WOOD, rotate=[0, 25, 4]),
             *crates(-40.5, -36, -54, 2)],
     links=["Drain tunnel", "Shaft", "Crawlway"], tags=["big room"],
     note="A wide brick cistern held up by nine pillars, with knee-deep water.")
room("Crawlway", "cistern",
     [box([-47.5, -35.2, -64], [10, 1.6, 1.6])],
     links=["Flooded cistern", "Valve room"], tags=["secret"],
     note="Too low to stand: you have to crawl (fly mode) to get through.")
room("Valve room", "cistern",
     [box([-55, -34, -64], [6, 4, 6])],
     things=[t_cyl("big valve wheel", [-57.8, -33.5, -64], 1.0, 0.2, RUST, rotate=[0, 0, 90]),
             t_box("chest", [-54, -35.6, -62], [1.2, 0.8, 0.8], PAINT)],
     links=["Crawlway"], tags=["secret"],
     note="Hidden room at the end of the crawlway. Turning the valve drains the cistern.")

# ---------- the shaft and the cave ----------
SHAFT = (-30, -82)
room("Shaft", "caves",
     [{"type": "capsule", "a": [SHAFT[0], -30, SHAFT[1]], "b": [SHAFT[0], -6, SHAFT[1]], "radius": 6},
      box([SHAFT[0], -33, SHAFT[1]], [10.5, 6, 10.5]),
     ],
     things=spiral_steps(SHAFT[0], SHAFT[1], 4.6, -36, -10.6, 38),
     links=["Flooded cistern", "Overgrown cave"], tags=["vertical"],
     note="A round shaft. Climb the stone steps that spiral up the wall.")
room("Overgrown cave", "caves",
     [{"type": "ellipsoid", "center": [-54, -7, -86], "radii": [17, 6.5, 11],
       "noise": {"amp": 1.6, "freq": 0.12, "octaves": 3}},
      {"type": "capsule", "a": [-34, -8.5, -83], "b": [-42, -8.5, -85], "radius": 2.2}],
     things=[{"type": "sphere", "name": "boulder", "center": [-50, -11.5, -82], "radius": 1.8, "color": STONE},
             {"type": "sphere", "name": "boulder", "center": [-60, -11.8, -91], "radius": 1.4, "color": STONE},
             {"type": "cone", "name": "glow-moss mound", "center": [-56, -11.6, -80], "radius": 1.6, "height": 1.2, "color": MOSS},
             {"type": "cone", "name": "glow-moss mound", "center": [-46, -11.8, -90], "radius": 1.2, "height": 0.9, "color": MOSS},
             {"type": "cylinder", "name": "old tree root", "center": [-62, -6, -84], "radius": 0.5, "radiusTop": 0.25, "height": 9, "color": "#7a5e45", "rotate": [0, 0, 25]}],
     links=["Shaft", "Maintenance tunnel"], tags=["cave"],
     note="A natural cave the shaft broke into. Roots come through the roof.")

# ---------- back to the surface ----------
room("Maintenance tunnel", "caves",
     [{"type": "polyline", "radius": 1.8,
       "points": [[-68, -9.5, -88], [-74, -8, -70], [-66, -5.5, -40], [-40, -2, -18], [-14, 1.4, 2]]}],
     things=[{"type": "pipe", "name": "cable", "points": [[-68, -8, -89.5], [-75.6, -6.4, -70], [-67.6, -3.9, -40], [-41, -0.5, -19.5], [-15, 2.9, 0.6]], "radius": 0.08, "color": "#3b3b3b"}],
     links=["Overgrown cave", "Back door"], tags=["tunnel", "shortcut"],
     note="A long tunnel slowly rising back towards the gatehouse.")
room("Back door", "surface",
     [box([-9, 1.6, 2], [9, 3.6, 4])],
     things=[t_box("locked door", [-5.6, 1.3, 2], [0.15, 2.6, 1.6], PAINT, solid=False, note="opens from the gatehouse side")],
     links=["Maintenance tunnel", "Gatehouse"], tags=["shortcut"],
     note="Opens into the gatehouse once unlocked: the shortcut back to the start.")

level = {"name": "The Old Pumping Station", "units": "m", "rooms": rooms}
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "level.json")
with open(out, "w") as f:
    json.dump(level, f, indent=1)
print(f"wrote {out}: {len(rooms)} rooms, {sum(len(r['things']) for r in rooms)} things")
