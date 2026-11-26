#!/usr/bin/env python3
"""Run holomap on your own maps.

    python3 holomap.py path/to/your/maps [--port 4030]

Serves the viewer and the .json maps in that folder, then opens
your browser. Edit a map and save: the page updates by itself.
The order of versions comes from holomap.json in the folder if it
is there (see FORMAT.md), otherwise every .json map, sorted, plus
any .glb / .gltf level model that no map uses.
"""
import http.server, json, os, sys, threading, webbrowser
from functools import partial

HERE = os.path.dirname(os.path.abspath(__file__))


def map_list(folder):
    cfg = os.path.join(folder, "holomap.json")
    if os.path.exists(cfg):
        with open(cfg, encoding="utf-8") as f:
            return json.load(f).get("maps", [])
    skip = {"holomap.json", "index.json"}
    names = sorted(os.listdir(folder))
    maps = [n for n in names if n.endswith(".json") and n not in skip]
    # a level model is listed on its own only if no map uses it
    used = set()
    for n in maps:
        try:
            with open(os.path.join(folder, n), encoding="utf-8") as f:
                used |= {m.get("file") for m in json.load(f).get("models", [])}
        except Exception:
            pass
    return maps + [n for n in names
                   if n.lower().endswith((".glb", ".gltf")) and n not in used]


class Handler(http.server.SimpleHTTPRequestHandler):
    maps = "."

    def translate_path(self, path):
        clean = path.split("?", 1)[0].split("#", 1)[0]
        if clean.startswith("/maps/"):
            rel = clean[len("/maps/"):]
            full = os.path.normpath(os.path.join(self.maps, rel))
            if os.path.commonpath([full, self.maps]) != self.maps:
                return os.path.join(self.maps, "__nope__")
            return full
        return super().translate_path(path)

    def do_GET(self):
        if self.path.split("?")[0] == "/maps/index.json":
            body = json.dumps({"maps": map_list(self.maps)}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


def main():
    args = [a for a in sys.argv[1:] if a != "--no-open"]
    port = 4030
    if "--port" in args:
        i = args.index("--port")
        port = int(args[i + 1])
        del args[i:i + 2]
    folder = os.path.abspath(args[0] if args else os.path.join(HERE, "examples", "demo"))
    if not os.path.isdir(folder):
        sys.exit(f"not a folder: {folder}")
    Handler.maps = folder
    srv = http.server.ThreadingHTTPServer(
        ("127.0.0.1", port), partial(Handler, directory=HERE))
    url = f"http://localhost:{port}/"
    print(f"holomap: {url}  (maps from {folder})")
    if "--no-open" not in sys.argv:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
