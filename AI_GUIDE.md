# Writing holomap maps: a guide for AI models

You are writing a game level as a holomap map: one JSON file. A person
will open it in the holomap viewer, look at it from outside, slice it
by height, and walk through it like a player. Make it feel like a real
video game level, not a set of boxes.

## The format in short

```json
{
  "name": "Level name",
  "units": "m",
  "rooms": [
    {
      "name": "Unique room name",
      "district": "area name",
      "tags": ["hub"],
      "note": "One or two sentences: what the room is for in the game.",
      "links": ["Names of rooms this one opens into"],
      "prims": [ { "type": "box", "center": [x, y, z], "size": [w, h, d] } ],
      "things": [ { "type": "box", "name": "crate", "center": [x, y, z], "size": [1, 1, 1] } ]
    }
  ]
}
```

- Units are metres. **y is up.** x and z are horizontal.
- A room is open space (air). `prims` are the shapes of that space.
  Shapes in one room join together.
- `things` are solid objects inside the room. The player walks on them
  and can't walk through them.
- Every field is described in FORMAT.md.

## Rules that matter

1. **Overlap to connect.** Two rooms are only joined where their
   shapes overlap. Overlap by 0.5 to 1 m so the doorway is real. A
   gap of even 1 cm means a wall. Every name in `links` must overlap
   that room.
2. **Make it walkable.** A player is 1.8 m tall and 0.6 m wide, steps
   up at most 0.8 m, and jumps about 1.2 m. Corridors need at least
   2.2 m of headroom and 1.2 m of width. Height changes need stairs
   (the `stairs` shape, or step-block things), slopes, or ramps. A
   floor 3 m higher than the next one, with nothing to climb, is a
   dead end. Leave it that way only if that is the design (a drop).
3. **Floors are the bottom of the shape.** A box with centre y = 2 and
   height 4 has its floor at y = 0. Put things on floors: a 1 m crate
   on a floor at y 0 has centre y 0.5.
4. **Use scale like a real game.** Doors are about 1.2 to 3 m wide,
   rooms 4 to 15 m across, big halls 20 to 40 m, shafts 10 to 60 m
   deep. Don't make everything the same size.
5. **Fill the rooms.** Add the things that tell a player where they
   are: machines, furniture, crates, pillars, pipes, catwalks, ledges,
   rubble. Give each thing a `name`. Big rooms need several layers to
   move through (catwalks, platforms, balconies, pits).
6. **Shape the level like a game.** Include a start, loops and
   shortcuts back, vertical movement, landmarks you can see from far
   away, a few side rooms and secrets, and at least one place where
   two layers overlap (a room above another, a bridge over a pit).
7. **Names are unique.** Links and selection use them. Rooms in the
   same area share a `district`.
8. **Write notes.** A room's `note` says what happens there in the
   game. A thing can have a `note` too.

## Tips for the shapes

- `box` for built rooms, with `rotate` [x, y, z] in degrees for angled
  ones.
- `polyline` (points plus radius) for winding tunnels; `capsule` for a
  straight tube or a round shaft.
- `ellipsoid` with `noise` for natural caves.
- `stairs` (from, to, steps, width, height) for built stairways
  between floors.
- `"op": "cut"` on a shape carves it out of the room as solid rock:
  pillars, a central column, a ledge.
- `"blend": 2` on a room melts its shapes together for organic caves.
- Things can be platforms you jump between, catwalks along walls, or
  step blocks that climb a shaft. A step-block flight is several thin
  boxes, each about 0.3 to 0.7 m higher than the last.
- Set `"solid": false` on things a player should pass through (water,
  hanging cables, notices on walls). Pipes are not solid unless you
  say so.

## Before you hand it over

Run the checker and fix every error:

```sh
node tools/check.mjs path/to/map.json
```

It finds links between rooms that don't overlap, missing rooms,
things stuck in walls and rooms too low to stand in. Warnings can be
fine if they are on purpose (a crawlway is meant to be low). Say which
warnings you kept and why.

If you are making a big level, write a small script that builds the
JSON (see `examples/demo/make_level.py`), so you can place repeated
things (stairs, rows of crates, pillars) with loops instead of by hand.
