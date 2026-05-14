"""
WSL-side server for the Spider-axioms HTML presentation.

Serves the static page (index.html + assets) and exposes one SSE endpoint
that streams Fast Downward stdout line-by-line, then a final 'done' event
with parsed summary stats.

Usage (inside WSL):
    python3 server.py
    # → http://localhost:8000 from the Windows browser

Configuration via env vars (sensible defaults below):
    FD_SCRIPT       path to fast-downward.py
    PROJECT_ROOT    path to Spider_{Axioms,NoAxioms}/ on Linux
    PORT            HTTP port (default 8000)

stdlib only , no pip install required.
"""
from __future__ import annotations

import http.server
import json
import os
import re
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

PORT          = int(os.environ.get("PORT", "8000"))
# VPS defaults , override locally with env vars for dev
FD_SCRIPT     = os.environ.get(
    "FD_SCRIPT",
    "/srv/fast-downward/fast-downward.py",
)
PROJECT_ROOT  = os.environ.get(
    "PROJECT_ROOT",
    "/srv/spider-axioms-presentation/pddl",
)
STATIC_ROOT   = Path(__file__).resolve().parent

DOMAINS = {
    "noaxioms": f"{PROJECT_ROOT}/Spider_NoAxioms",
    "axioms":   f"{PROJECT_ROOT}/Spider_Axioms",
}

SEARCHES = {
    "blind": "astar(blind())",
    "lmcut": "astar(lmcut())",
    "hmax":  "astar(hmax())",
}

# ---------------------------------------------------------------------------
# FD stdout parsing
# ---------------------------------------------------------------------------

_RE_PLAN_COST    = re.compile(r"Plan cost:\s*(\d+)")
_RE_PLAN_LEN     = re.compile(r"Plan length:\s*(\d+)")
_RE_EXPANDED     = re.compile(r"Expanded\s+(\d+)\s+state")
_RE_TOTAL_TIME   = re.compile(r"Total time:\s*([\d.]+)\s*s")
_RE_SEARCH_TIME  = re.compile(r"Search time:\s*([\d.]+)\s*s")
# "Planner time" is reported by the driver and includes translation,
# preprocessing, search and cleanup. This is what the audience sees as the
# bottom-of-terminal "INFO Planner time: XX.XXs" line.
_RE_PLANNER_TIME = re.compile(r"Planner time:\s*([\d.]+)\s*s")


def update_summary(summary: dict, line: str) -> None:
    for pat, key, cast in [
        (_RE_PLAN_COST,    "cost",         int),
        (_RE_PLAN_LEN,     "length",       int),
        (_RE_EXPANDED,     "expanded",     int),
        (_RE_TOTAL_TIME,   "total_time",   float),
        (_RE_SEARCH_TIME,  "search_time",  float),
        (_RE_PLANNER_TIME, "planner_time", float),
    ]:
        m = pat.search(line)
        if m:
            try:
                summary[key] = cast(m.group(1))
            except ValueError:
                pass


# ---------------------------------------------------------------------------
# Request handler
# ---------------------------------------------------------------------------

class Handler(http.server.SimpleHTTPRequestHandler):
    # Quiet-down per-request log (otherwise SSE streams flood the console).
    # Be defensive: log_message can be called with non-string args (HTTPStatus
    # enums via send_error -> log_error), which would otherwise raise here.
    def log_message(self, fmt: str, *args) -> None:
        first = str(args[0]) if args else ""
        if "/api/run" in first:
            return
        try:
            super().log_message(fmt, *args)
        except Exception:
            pass

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_ROOT), **kwargs)

    # -- routing ------------------------------------------------------------
    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/run":
            self.handle_run(urllib.parse.parse_qs(parsed.query))
            return
        if parsed.path == "/api/health":
            self.send_json({"ok": True})
            return
        super().do_GET()

    def send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # -- SSE FD runner ------------------------------------------------------
    def handle_run(self, qs: dict) -> None:
        enc      = (qs.get("encoding")  or ["axioms"])[0]
        inst     = (qs.get("instance")  or ["p09"])[0]
        search_k = (qs.get("search")    or ["blind"])[0]
        track    = (qs.get("track")     or ["opt"])[0]    # opt | sat

        if enc not in DOMAINS or search_k not in SEARCHES:
            self.send_json({"error": "bad encoding or search"}, status=400)
            return

        domain_dir   = DOMAINS[enc]
        instance_pdl = f"{domain_dir}/instances/{track}_{inst}.pddl"
        if not Path(instance_pdl).is_file():
            # fallback to flat layout (e.g. p01.pddl at root)
            alt = f"{domain_dir}/{inst}.pddl"
            instance_pdl = alt if Path(alt).is_file() else instance_pdl

        cmd = [
            "python3", FD_SCRIPT,
            f"{domain_dir}/domain.pddl",
            instance_pdl,
            "--search", SEARCHES[search_k],
        ]

        # SSE headers
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        # opening hello , confirms the stream is alive even before FD prints
        self._send_event("hello", {
            "encoding": enc, "instance": inst, "search": search_k,
            "cmd": " ".join(cmd),
        })

        start   = time.monotonic()
        summary = {"encoding": enc, "instance": inst, "search": search_k}
        proc: subprocess.Popen | None = None
        # FD's translator writes output.sas to its cwd; the systemd unit
        # marks /srv read-only (ProtectSystem=strict), so run FD in a private
        # /tmp directory and clean up afterwards.
        workdir = tempfile.mkdtemp(prefix="fd-")
        # Force the child Python (FD wrapper + translate) to flush stdout
        # line-by-line so summary lines arrive promptly.
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                cwd=workdir,
                env=env,
            )
            for raw in proc.stdout:                       # type: ignore[union-attr]
                line = raw.rstrip("\n")
                update_summary(summary, line)
                if not self._send_event("line", {"line": line}):
                    proc.terminate()
                    return
            proc.wait()
            summary["wall_clock"] = round(time.monotonic() - start, 3)
            summary["return_code"] = proc.returncode
            self._send_event("done", summary)
        except BrokenPipeError:
            if proc is not None:
                proc.terminate()
        except Exception as exc:                          # pragma: no cover
            self._send_event("error", {"error": str(exc)})
            if proc is not None:
                proc.terminate()
        finally:
            shutil.rmtree(workdir, ignore_errors=True)

    # -- low-level SSE write ------------------------------------------------
    def _send_event(self, event: str, data: dict) -> bool:
        payload = f"event: {event}\ndata: {json.dumps(data)}\n\n"
        try:
            self.wfile.write(payload.encode())
            self.wfile.flush()
            return True
        except (BrokenPipeError, ConnectionResetError):
            return False


# ---------------------------------------------------------------------------
# Threaded server (needed for parallel SSE streams)
# ---------------------------------------------------------------------------

class ThreadedServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def main() -> int:
    # Sanity checks
    if not Path(FD_SCRIPT).is_file():
        print(f"WARNING: FD_SCRIPT not found: {FD_SCRIPT}", file=sys.stderr)
    for enc, root in DOMAINS.items():
        if not Path(root, "domain.pddl").is_file():
            print(f"WARNING: {enc} domain.pddl not found at {root}", file=sys.stderr)

    with ThreadedServer(("127.0.0.1", PORT), Handler) as srv:
        print(f"Spider-axioms presentation server")
        print(f"  static root : {STATIC_ROOT}")
        print(f"  FD script   : {FD_SCRIPT}")
        print(f"  project root: {PROJECT_ROOT}")
        print(f"  listening on: http://localhost:{PORT}")
        print(f"\nCtrl-C to stop.\n", flush=True)
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
