#!/usr/bin/env python3
"""
Test cases for CLI-GUI coexistence features.

Tests the integration of ServerProxy and PortLock into FPBCLI.
"""

import http.server
import io
import json
import os
import sys
import tempfile
import threading
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent))

from cli.fpb_cli import FPBCLI, FPBCLIError, main
from utils.port_lock import PortLock


class _MockHandler(http.server.BaseHTTPRequestHandler):
    """Mock HTTP handler simulating WebServer API."""

    responses = {}

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in self.responses:
            body = json.dumps(self.responses[path]).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        self.rfile.read(content_length) if content_length else b""
        path = self.path.split("?")[0]
        if path in self.responses:
            body = json.dumps(self.responses[path]).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass


class TestFPBCLIProxyMode(unittest.TestCase):
    """Test FPBCLI proxy mode when WebServer is running."""

    @classmethod
    def setUpClass(cls):
        _MockHandler.responses = {
            "/api/status": {
                "success": True,
                "connected": True,
                "port": "/dev/ttyACM0",
            },
            "/api/fpb/info": {
                "success": True,
                "info": {"version": "1.0", "slots": 6},
            },
            "/api/fpb/inject": {"success": True, "result": "injected"},
            "/api/fpb/unpatch": {"success": True, "message": "unpatched"},
            "/api/fpb/mem-read": {"success": True, "hex_dump": "00 01 02"},
            "/api/fpb/mem-write": {"success": True, "message": "written"},
        }
        cls.server = http.server.HTTPServer(("127.0.0.1", 0), _MockHandler)
        cls.port = cls.server.server_address[1]
        cls.server_url = f"http://127.0.0.1:{cls.port}"
        cls.server_thread = threading.Thread(target=cls.server.serve_forever)
        cls.server_thread.daemon = True
        cls.server_thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def _make_cli(self, port="/dev/ttyACM0"):
        """Create FPBCLI that will use proxy mode."""
        return FPBCLI(
            port=port,
            server_url=self.server_url,
        )

    def test_proxy_detected(self):
        """CLI detects running WebServer and enters proxy mode."""
        cli = self._make_cli()
        self.assertIsNotNone(cli._proxy)
        self.assertTrue(cli._device_state.connected)
        self.assertIsNone(cli._port_lock)
        cli.cleanup()

    def test_proxy_info(self):
        """info() works through proxy."""
        cli = self._make_cli()
        buf = io.StringIO()
        with redirect_stdout(buf):
            cli.info()
        result = json.loads(buf.getvalue())
        self.assertTrue(result["success"])
        self.assertEqual(result["info"]["slots"], 6)
        cli.cleanup()

    def test_proxy_unpatch(self):
        """unpatch() works through proxy."""
        cli = self._make_cli()
        buf = io.StringIO()
        with redirect_stdout(buf):
            cli.unpatch(comp=0)
        result = json.loads(buf.getvalue())
        self.assertTrue(result["success"])
        cli.cleanup()

    def test_proxy_inject(self):
        """inject() works through proxy."""
        cli = self._make_cli()
        with tempfile.NamedTemporaryFile(mode="w", suffix=".c", delete=False) as f:
            f.write("/* FPB_INJECT */\nvoid test(void) {}\n")
            src = f.name
        try:
            buf = io.StringIO()
            with redirect_stdout(buf):
                cli.inject("test", src)
            result = json.loads(buf.getvalue())
            self.assertTrue(result["success"])
        finally:
            os.unlink(src)
            cli.cleanup()

    def test_proxy_mem_read(self):
        """mem_read() works through proxy."""
        cli = self._make_cli()
        buf = io.StringIO()
        with redirect_stdout(buf):
            cli.mem_read(0x20000000, 64)
        result = json.loads(buf.getvalue())
        self.assertTrue(result["success"])
        cli.cleanup()

    def test_proxy_mem_write(self):
        """mem_write() works through proxy."""
        cli = self._make_cli()
        buf = io.StringIO()
        with redirect_stdout(buf):
            cli.mem_write(0x20000000, "DEADBEEF")
        result = json.loads(buf.getvalue())
        self.assertTrue(result["success"])
        cli.cleanup()


class TestFPBCLIDirectMode(unittest.TestCase):
    """Test --direct flag bypasses proxy detection."""

    @classmethod
    def setUpClass(cls):
        _MockHandler.responses = {
            "/api/status": {"success": True, "connected": True},
        }
        cls.server = http.server.HTTPServer(("127.0.0.1", 0), _MockHandler)
        cls.port = cls.server.server_address[1]
        cls.server_url = f"http://127.0.0.1:{cls.port}"
        cls.server_thread = threading.Thread(target=cls.server.serve_forever)
        cls.server_thread.daemon = True
        cls.server_thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    @patch("cli.fpb_cli.serial.Serial")
    def test_direct_skips_proxy(self, mock_serial):
        """--direct flag forces direct serial connection."""
        mock_serial.return_value = MagicMock()
        cli = FPBCLI(
            port="/dev/ttyACM0",
            direct=True,
            server_url=self.server_url,
        )
        self.assertIsNone(cli._proxy)
        self.assertTrue(cli._device_state.connected)
        self.assertIsNotNone(cli._port_lock)
        cli.cleanup()


class TestFPBCLIPortLockIntegration(unittest.TestCase):
    """Test port lock integration in FPBCLI."""

    @patch("cli.fpb_cli.serial.Serial")
    def test_port_lock_acquired_on_connect(self, mock_serial):
        """Port lock is acquired when connecting directly."""
        mock_serial.return_value = MagicMock()
        # No server running → direct mode
        cli = FPBCLI(
            port="/dev/test-cli-lock-1",
            server_url="http://127.0.0.1:19999",  # No server
        )
        self.assertIsNotNone(cli._port_lock)
        cli.cleanup()

    @patch("cli.fpb_cli.serial.Serial")
    def test_port_lock_released_on_cleanup(self, mock_serial):
        """Port lock is released on cleanup."""
        mock_serial.return_value = MagicMock()
        cli = FPBCLI(
            port="/dev/test-cli-lock-2",
            server_url="http://127.0.0.1:19999",
        )
        cli.cleanup()
        self.assertIsNone(cli._port_lock)
        # Lock should be released - another lock should succeed
        lock2 = PortLock("/dev/test-cli-lock-2")
        self.assertTrue(lock2.acquire())
        lock2.release()

    @patch("cli.fpb_cli.serial.Serial")
    def test_port_lock_conflict(self, mock_serial):
        """Second CLI on same port fails with FPBCLIError."""
        mock_serial.return_value = MagicMock()
        cli1 = FPBCLI(
            port="/dev/test-cli-lock-3",
            server_url="http://127.0.0.1:19999",
        )
        with self.assertRaises(FPBCLIError) as ctx:
            FPBCLI(
                port="/dev/test-cli-lock-3",
                server_url="http://127.0.0.1:19999",
            )
        self.assertIn("locked", str(ctx.exception).lower())
        cli1.cleanup()


class TestFPBCLINoPortNoProxy(unittest.TestCase):
    """Test CLI without port (offline mode) - no proxy, no lock."""

    def test_offline_no_proxy_no_lock(self):
        """Offline CLI has no proxy and no lock."""
        cli = FPBCLI()
        self.assertIsNone(cli._proxy)
        self.assertIsNone(cli._port_lock)
        self.assertFalse(cli._device_state.connected)
        cli.cleanup()


class TestFPBCLIServerUrlArg(unittest.TestCase):
    """Test --server-url argument."""

    def test_custom_server_url(self):
        """Custom server URL is passed through."""
        cli = FPBCLI(server_url="http://192.168.1.100:8080")
        # No port specified, so no proxy attempt
        self.assertIsNone(cli._proxy)
        cli.cleanup()


class TestMainNewArgs(unittest.TestCase):
    """Test new CLI arguments in main()."""

    @patch("cli.fpb_cli.FPBCLI")
    @patch("sys.argv", ["fpb_cli.py", "--direct", "--port", "/dev/ttyACM0", "info"])
    def test_direct_arg_passed(self, mock_cli_cls):
        """--direct argument is passed to FPBCLI."""
        mock_cli = MagicMock()
        mock_cli_cls.return_value = mock_cli
        main()
        call_kwargs = mock_cli_cls.call_args
        self.assertTrue(call_kwargs.kwargs.get("direct", False))

    @patch("cli.fpb_cli.FPBCLI")
    @patch(
        "sys.argv",
        [
            "fpb_cli.py",
            "--server-url",
            "http://myhost:9000",
            "--port",
            "/dev/ttyACM0",
            "info",
        ],
    )
    def test_server_url_arg_passed(self, mock_cli_cls):
        """--server-url argument is passed to FPBCLI."""
        mock_cli = MagicMock()
        mock_cli_cls.return_value = mock_cli
        main()
        call_kwargs = mock_cli_cls.call_args
        self.assertEqual(call_kwargs.kwargs.get("server_url"), "http://myhost:9000")


if __name__ == "__main__":
    unittest.main()
