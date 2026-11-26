# holomap

A 3D map viewer for games with tangled, layered spaces: caves,
underground halls, floating platforms, shafts and tunnels. You
describe rooms as simple shapes in a JSON file, and holomap shows
them as a solid model you can turn around, slice by height and walk
inside.

![holomap showing the demo map](screenshot.png)

## What it does

- **Solid rooms, coloured by height.** Low is cool blue, high is
  warm red, in bands about one storey tall, so you can see at a
  glance which rooms sit at the same depth. You can also colour by
  district or by room.
- **Layers panel.** A side view of the whole map with a height
  ruler. Drag a band over it to show only those heights; the 3D view
  is sliced to match, so you look straight into the rooms on that
  layer. Step up and down with the buttons or `[` and `]`.
- **Select a room** and everything else goes pale; rooms in front of
  it fade so you can see it. The card shows its height, size, notes
  and the rooms it connects to.
- **Go inside** (double-click). Walk with WASD. Rooms open into each
  other where their shapes meet, so doorways and shafts are real
  openings, and you walk on into the next room. Walls stop you.
- **Names** on the rooms, top / side / 3D views, district filters,
  search.
- **Versions**: switch between several files of the same place.
- **Live editing**: save the JSON and the map updates by itself.

## Use it with your own maps

You need Python 3 (no installs).

```sh
python3 holomap.py path/to/your/maps
```

This opens the viewer in your browser, showing the `.json` maps in
that folder. On Windows use `py holomap.py ...`. Add `--port 4031`
to pick a different port.

You can also drag a map file onto the page to look at it.

See [FORMAT.md](FORMAT.md) for how to write a map. The demo in
`examples/demo/` uses every kind of shape.

## Controls

| do this              | to |
| -------------------- | -- |
| drag · right-drag · scroll | turn · move · zoom |
| click                | select a room |
| double-click         | go inside |
| Esc                  | back out / clear selection |
| WASD, Q / E          | walk, down / up (inside) |
| shift                | move faster |
| `[` and `]`          | layer below / above |
| H                    | all heights |
| F                    | fit the whole map |
| /                    | search |

## Licence

MIT. See [LICENSE](LICENSE).
