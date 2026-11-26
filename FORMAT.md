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
