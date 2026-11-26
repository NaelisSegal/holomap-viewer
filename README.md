# holomap

A 3D map viewer for game levels with tangled, layered spaces: caves,
underground halls, shafts, catwalks, tunnels, floating platforms.
You describe the level in a JSON file (rooms made of simple shapes,
plus the things inside them), and holomap shows it as a solid model
that you can turn around, slice by height, and **walk around inside
like a player**.

It is made so that an **AI can write the maps**: the format is plain
JSON with metres for units, there is a guide written for AI models
([AI_GUIDE.md](AI_GUIDE.md)), and a checker that catches the usual
mistakes. You can also write maps by hand, or make them with code.

![The demo level: the pump hall with its roof lifted](screenshot.png)

## Try it

You need Python 3. Nothing to install.

```sh
git clone <this repo>
cd holomap
python3 holomap.py
```

This opens the demo level, *The Old Pumping Station*, in your browser:
a gatehouse, stairs down to a pump hall with catwalks and pumps, a
flooded cistern with a hidden room, a shaft you climb on spiral steps,
a cave, and a tunnel that loops back to the start.

- **Click a room** to select it. Its roof lifts so you can see what is
  inside, the other rooms go pale, and its card shows its size, notes,
  what it connects to and what is in it.
- **Enter it**: press the *Enter room* button, press Enter, or
  double-click the room.
- **Inside**: drag to look, WASD to walk, Space to jump, Shift to run.
  Stairs and slopes are climbed, things are solid and you can stand
  on them. V switches to flying (for low crawlways or getting
  around fast). Esc leaves.
- **Layers** (left): a side view of the whole level. Drag a band over
  it to show only those heights; the 3D view is sliced to match.
- Colour by height (default), district or room; 3D / top / side views;
  search with `/`.

## Use it for your own game

Make a folder for your maps and point holomap at it:

```sh
python3 holomap.py path/to/my-maps
```

Every `.json` map in the folder can be opened. Save a file and the
page updates by itself, so you can keep the viewer open while you (or
an AI) edit the map. On Windows, use `py holomap.py ...`.

### Adding a room

A room is the open space a player can be in, built from shapes. This
is a whole map with one room:

```json
{
  "name": "My level",
  "units": "m",
  "rooms": [
    {
      "name": "Guard post",
      "district": "outer wall",
      "note": "First room after the gate.",
      "links": ["Gate tunnel"],
      "prims": [
        { "type": "box", "center": [0, 2, 0], "size": [8, 4, 6] }
      ],
      "things": [
        { "type": "box", "name": "table", "center": [0, 0.4, 0], "size": [2, 0.8, 1] }
      ]
    }
  ]
}
```

- `center` and `size` are in metres, and **y is up**. This box's
  floor is at y 0, because its centre is 2 m up and it is 4 m tall.
- **Rooms connect where their shapes overlap.** To join two rooms,
  make the shapes overlap by about half a metre; that overlap becomes
  the doorway. `links` lists the connections for the room card.
- **Things** are solid objects inside a room: crates, machines,
  pillars, catwalks, platforms, stairs made of step blocks. You walk
  on them and bump into them.
- Shapes: `box`, `capsule`, `polyline` (a tunnel through points),
  `ellipsoid` (with optional rough cave walls), `stairs`. Things:
  `box`, `cylinder`, `cone`, `sphere`, `pipe`.

The full list of fields is in [FORMAT.md](FORMAT.md).

### Check a map

```sh
node tools/check.mjs path/to/my-maps/level.json
```

This reports rooms that are linked but don't actually overlap (no way
through), links to rooms that don't exist, things stuck in walls, and
rooms too low to stand in. It needs Node.js.

### Make a map with code

Maps are just JSON, so any script can write them. In
[`examples/demo/make_level.py`](examples/demo/make_level.py), the
whole demo level is built with Python: small helpers place crates,
flights of stairs and spiral steps up a shaft. Run it to rebuild
`level.json`.

### Let an AI make the map

Give your AI model [AI_GUIDE.md](AI_GUIDE.md) and describe the
level you want. The guide explains the format, the rules that keep
rooms connected and walkable, and asks the model to run the checker.
Keep holomap open on the folder and walk through each version as it
arrives.

## Several versions of a level

Put several map files in one folder to switch between them (for
example the same place before and after an event). Add `holomap.json`
to choose their order and labels; see [FORMAT.md](FORMAT.md).

## Licence

MIT. See [LICENSE](LICENSE).
