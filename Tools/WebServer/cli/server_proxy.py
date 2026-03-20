#!/usr/bin/env python3

# MIT License
# Copyright (c) 2025 - 2026 _VIFEXTech

"""
WebServer proxy for CLI coexistence.

When the WebServer is running, CLI device operations are forwarded
via HTTP API instead of opening a second serial connection.
"""

import json
import logging
import os
from typing import Any, Dict, Optional
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

# Default WebServer URL
DEFAULT_SERVER_URL = "http://127.0.0.1:5500"

# Timeout for probe / API calls (seconds)
_PROBE_TIMEOUT = 2
_API_TIMEOUT = 30


class ServerProxy:
    """Proxy device operations through the running WebServer HTTP API."""

    def __init__(
        self,
        base_url: str = DEFAULT_SERVER_URL,
        token: Optional[str] = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.token = token

    # ------------------------------------------------------------------
    # Low-level HTTP helpers (stdlib only, no requests dependency)
    # ------------------------------------------------------------------

    def _build_url(self, path: str) -> str:
        url = f"{self.base_url}{path}"
        if self.token:
            sep = "&" if "?" in url else "?"
            url += f"{sep}token={self.token}"
        return url

    def _get(self, path: str, timeout: float = _API_TIMEOUT) -> dict:
        url = self._build_url(path)
        req = Request(url, method="GET")
        req.add_header("Accept", "application/json")
        with urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())

    def _post(
        self, path: str, data: Optional[dict] = None, timeout: float = _API_TIMEOUT
    ) -> dict:
        url = self._build_url(path)
        body = json.dumps(data or {}).encode()
        req = Request(url, data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json")
        with urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())

    # ------------------------------------------------------------------
    # Server detection
    # ------------------------------------------------------------------

    def is_server_running(self) -> bool:
        """Check if the WebServer is reachable."""
        try:
            resp = self._get("/api/status", timeout=_PROBE_TIMEOUT)
            return resp.get("success", False)
        except Exception:
            return False

    def is_device_connected(self) -> bool:
        """Check if the WebServer has an active device connection."""
        try:
            resp = self._get("/api/status", timeout=_PROBE_TIMEOUT)
            return resp.get("connected", False)
        except Exception:
            return False

    def get_status(self) -> dict:
        """Get full WebServer status."""
        return self._get("/api/status")

    # ------------------------------------------------------------------
    # Device operations (proxied to WebServer)
    # ------------------------------------------------------------------

    def info(self) -> dict:
        """Get device FPB info via WebServer."""
        return self._get("/api/fpb/info")

    def inject(
        self,
        target_func: str,
        source_file: str,
        elf_path: Optional[str] = None,
        compile_commands: Optional[str] = None,
        patch_mode: str = "trampoline",
        comp: int = -1,
    ) -> dict:
        """Inject a patch via WebServer."""
        # Read source content to send
        source_content = ""
        source_ext = ".c"
        if os.path.exists(source_file):
            with open(source_file, "r", encoding="utf-8") as f:
                source_content = f.read()
            source_ext = os.path.splitext(source_file)[1]

        payload: Dict[str, Any] = {
            "target_func": target_func,
            "source_content": source_content,
            "patch_mode": patch_mode,
            "comp": comp,
            "source_ext": source_ext,
            "original_source_file": os.path.abspath(source_file),
        }
        if elf_path:
            payload["elf_path"] = elf_path
        if compile_commands:
            payload["compile_commands_path"] = compile_commands

        return self._post("/api/fpb/inject", payload)

    def unpatch(self, comp: int = 0, all_patches: bool = False) -> dict:
        """Remove a patch via WebServer."""
        return self._post("/api/fpb/unpatch", {"comp": comp, "all": all_patches})

    def mem_read(self, addr: int, length: int, fmt: str = "hex") -> dict:
        """Read device memory via WebServer."""
        return self._post(
            "/api/fpb/mem-read",
            {"addr": addr, "length": length, "fmt": fmt},
        )

    def mem_write(self, addr: int, data_hex: str) -> dict:
        """Write device memory via WebServer."""
        return self._post(
            "/api/fpb/mem-write",
            {"addr": addr, "data": data_hex},
        )

    def test_serial(
        self, start_size: int = 16, max_size: int = 4096, timeout: float = 2.0
    ) -> dict:
        """Test serial throughput via WebServer."""
        return self._post(
            "/api/fpb/test-serial",
            {"start_size": start_size, "max_size": max_size, "timeout": timeout},
        )

    def file_list(self, path: str = "/") -> dict:
        """List directory contents via WebServer."""
        return self._get(f"/api/transfer/list?path={path}")

    def file_stat(self, path: str) -> dict:
        """Get file stat via WebServer."""
        return self._get(f"/api/transfer/stat?path={path}")

    def file_download(self, remote_path: str) -> dict:
        """Download file via WebServer.

        Uses the simple /api/transfer/download-sync endpoint which returns
        JSON with base64-encoded data (no SSE streaming).
        """
        return self._post(
            "/api/transfer/download-sync",
            {"remote_path": remote_path},
        )
