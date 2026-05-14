# Spider with Axioms — Presentation

Interactive HTML presentation for an academic seminar on rewriting an
IPC-2018 Spider Solitaire PDDL domain with derived predicates.
Live Fast Downward demo, side-by-side code comparisons, and result charts.

**Live:** https://manuel-buser.com/projects/spider-axioms/

## What's in here

| path | what it is |
|---|---|
| `web/` | static page + tiny Python stdlib server with an SSE endpoint that spawns `fast-downward.py` |
| `pddl/` | the two PDDL encodings (`Spider_NoAxioms`, `Spider_Axioms`) + opt instances |
| `systemd/spider-axioms.service` | systemd unit that runs `web/server.py` on the VPS |
| `nginx/spider-axioms.conf` | nginx location + rate-limit snippet for `/projects/spider-axioms/` |

## Run locally

```bash
# in WSL or any Linux box with Python 3
cd web
FD_SCRIPT=/path/to/fast-downward.py PROJECT_ROOT=../pddl bash run.sh
# → http://localhost:8000
```

## Deploy

The presentation runs behind nginx with a `proxy_pass` to the local Python
server. See [`nginx/spider-axioms.conf`](nginx/spider-axioms.conf) for the
nginx integration and [`systemd/spider-axioms.service`](systemd/spider-axioms.service)
for the unit file.
