#!/usr/bin/env python3
"""Lightweight HTTP server that processes Hermes slash commands in-process.

Usage: python3 /opt/command_proxy.py [--port PORT]

Accepts POST /command with {"command": "/name arg", "session_id": "..."}
Returns {"output": "...", "status": "ok"|"error"}
"""
import argparse
import importlib
import io
import json
import os
import sys
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

_HERMES_HOME = Path("/opt/hermes")
if _HERMES_HOME.exists():
    sys.path.insert(0, str(_HERMES_HOME))

_HOST = "0.0.0.0"
_PORT = 9120


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self._cors()
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        self._cors()
        if self.path != "/command":
            self._json(404, {"status": "error", "output": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length)
            body = json.loads(raw) if raw else {}
        except Exception as exc:
            self._json(400, {"status": "error", "output": str(exc)})
            return
        command = (body.get("command") or "").strip()
        if not command:
            self._json(400, {"status": "error", "output": "missing command"})
            return
        try:
            output = _run_command(command)
        except Exception as exc:
            self._json(500, {"status": "error", "output": f"{exc}\n{traceback.format_exc()}"})
            return
        self._json(200, {"status": "ok", "output": output})

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, status: int, data: dict) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


def _run_command(command: str) -> str:
    cmd = command if command.startswith("/") else f"/{command}"
    from hermes_cli.main import create_hermes_cli
    from rich.console import Console
    cli = create_hermes_cli(argv=["--cli"])
    buf = io.StringIO()
    cli.console = Console(file=buf, force_terminal=False, width=120)
    import contextlib
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
        cli.process_command(cmd)
    return buf.getvalue().rstrip() or "(no output)"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=_PORT)
    args = parser.parse_args()
    server = HTTPServer((_HOST, args.port), Handler)
    print(f"command proxy listening on {_HOST}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
