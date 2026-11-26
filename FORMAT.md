# Map format

A map is one JSON file. Lengths are in metres, so if one game unit is
one metre, the numbers match your game. y is up.

```json
{
  "name": "My level",
  "units": "m",
  "rooms": [
    {
      "name": "Main hall",
      "district": "north",
      "tags": ["hub"],
      "note": "Anything you want to remember about this room.",
      "links": ["Side tunnel"],
      "color": "#7fd3c0",
      "blend": 0,
      "prims": [
        { "type": "box", "center": [0, 4, 0], "size": [30, 8, 20] }
      ]
    }
  ]
}
```

Every room is the empty space you can walk in, built from one or
more shapes ("prims"). Shapes in the same room join together.

## Level models

A map can show a level exported from a game engine (glTF, `.glb` or
`.gltf`) with `models`:

```json
"models": [
  { "file": "castle.glb", "position": [0, 0, 0], "rotate": [0, 0, 0], "scale": 1 }
]
```

| field      | needed | what it does |
| ---------- | ------ | ------------ |
| `file`     | yes    | path of the model, next to the map |
| `position` | no     | move it, in metres |
| `rotate`   | no     | turn it, degrees around x, y, z |
| `scale`    | no     | one number, or [x, y, z] (0.01 for centimetres) |

When a map has a model, its rooms become **named areas**: the model's
geometry is drawn and walked on, and the rooms only mark where each
area is (with a tint when selected). They don't need to overlap.
A `.glb` file in the maps folder that no map uses also opens on its
own.

## Room fields

| field      | needed | what it does |
| ---------- | ------ | ------------ |
| `name`     | yes    | must be unique; links and selection use it |
| `prims`    | yes    | the shapes that make up the room |
| `district` | no     | groups rooms; the district menu filters by it |
| `tags`     | no     | list of words, shown on the room card |
| `note`     | no     | free text, shown on the room card |
| `links`    | no     | names of rooms this one connects to (shown on the card, both ways) |
| `color`    | no     | any CSS colour; otherwise one is picked for you |
| `blend`    | no     | metres of smooth melting between this room's shapes |
| `things`   | no     | solid objects inside the room (see below) |

## Shapes

| type        | fields |
| ----------- | ------ |
| `box`       | `center` [x,y,z], `size` [w,h,d], optional `rotate` [x,y,z] in degrees |
| `capsule`   | `a` [x,y,z], `b` [x,y,z], `radius`: a tube with round ends |
| `polyline`  | `points` [[x,y,z], ...], `radius`: a tube through all the points |
| `ellipsoid` | `center`, `radii` [x,y,z], optional `noise` {`amp`, `freq`, `octaves`} for rough cave walls |
| `stairs`    | `from` [x,y,z], `to` [x,y,z], `steps`, `width`, `height` (air above each step) |

Add `"op": "cut"` to a shape to carve it out of the room instead
(pillars, shelves, a rock in the middle of a cave).

## Things

Things are solid objects inside a room: furniture, machines, crates,
pillars, catwalks, platforms, step blocks. When you walk inside, you
stand on them and bump into them. Positions are in the same world
coordinates as the room.

| type       | fields |
| ---------- | ------ |
| `box`      | `center`, `size` [w,h,d], optional `rotate` [x,y,z] in degrees |
| `cylinder` | `center`, `radius`, `height`, optional `radiusTop`, `rotate` |
| `cone`     | `center`, `radius`, `height`, optional `rotate` |
| `sphere`   | `center`, `radius` |
| `pipe`     | `points` [[x,y,z], ...], `radius` (not solid unless `"solid": true`) |

Every thing can also have:

| field   | what it does |
| ------- | ------------ |
| `name`  | shown when you point at it, and listed on the room card |
| `note`  | shown after the name when you point at it |
| `color` | any CSS colour |
| `solid` | `false` to walk through it (water, cables, signs) |

`center` is the middle of the object, so a 1 m crate on a floor at
y 0 has `"center": [x, 0.5, z]`.

## Walking

Inside, the player is 1.8 m tall (eyes at 1.6 m) and about 0.6 m
wide, steps up at most 0.8 m, and jumps about 1.2 m. Plan stairs,
slopes and ledges to match, or the player can't get through.
`node tools/check.mjs map.json` checks links and things.

## Versions

Put several map files in one folder to switch between them (for
example the same place before and after something happens).
Rooms with the same name stay selected when you switch.

To set the order and labels, add `holomap.json` to the folder:

```json
{ "maps": [
  { "file": "before.json", "label": "before" },
  { "file": "after.json", "label": "after" }
] }
```

Without it, every `.json` file in the folder is listed in name order.
