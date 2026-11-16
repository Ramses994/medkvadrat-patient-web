#!/usr/bin/env python3
"""Minimal upstream that echoes Host and X-Forwarded-For for image tests."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import threading

_lock = threading.Lock()
_hits = 0


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self._handle()

    def do_POST(self):
        self._handle()

    def _handle(self):
        global _hits
        if self.path == "/__hits":
            with _lock:
                count = _hits
            raw = json.dumps({"hits": count}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return

        with _lock:
            _hits += 1

        body = {
            "host": self.headers.get("Host"),
            "xff": self.headers.get("X-Forwarded-For"),
            "path": self.path,
            "lk": self.headers.get("X-LK-Client"),
        }
        raw = json.dumps({"success": True, "data": body}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *_args):
        return


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
