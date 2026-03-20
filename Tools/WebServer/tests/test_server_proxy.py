#!/usr/bin/env python3
"""
Test cases for cli/server_proxy.py
"""

import http.server
import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import URLError

sys.path.insert(0, str(Path(__file__).parent.parent))

from cli.server_proxy import ServerProxy, DEFAULT_SERVER_URL


class TestServerProxyInit(unittest.TestCase):
    """Test ServerProxy initialization."""

    def test_default_url(self):
        proxy = ServerProxy()
        self.assertEqual(proxy.base_url, DEFAULT_SERVER_URL)
        self.assertIsNone(proxy.token)

    def test_custom_url(self):
        proxy = ServerProxy(base_url="http://localhost:8080")
        self.assertEqual(proxy.base_url, "http://localhost:8080")

    def test_trailing_slash_stripped(self):
        proxy = ServerProxy(base_url="http://localhost:8080/")
        self.assertEqual(proxy.base_url, "http://localhost:8080")

    def test_with_token(self):
        proxy = ServerProxy(token="abc123")
        self.assertEqual(proxy.token, "abc123")


class TestServerProxyBuildUrl(unittest.TestCase):
    """Test URL building."""

    def test_simple_path(self):
        proxy = ServerProxy(base_url="http://localhost:5500")
        url = proxy._build_url("/api/status")
        self.assertEqual(url, "http://localhost:5500/api/status")

    def test_with_token(self):
        proxy = ServerProxy(base_url="http://localhost:5500", token="tok123")
        url = proxy._build_url("/api/status")
        self.assertEqual(url, "http://localhost:5500/api/status?token=tok123")

    def test_with_token_existing_query(self):
        proxy = ServerProxy(base_url="http://localhost:5500", token="tok123")
        url = proxy._build_url("/api/status?foo=bar")
        self.assertEqual(url, "http://localhost:5500/api/status?foo=bar&token=tok123")


class _MockHTTPHandler(http.server.BaseHTTPRequestHandler):
    """Simple mock HTTP handler for testing."""

    # Class-level response configuration
    responses = {}

    def do_GET(self):
        path = self.path.split("?")[0]  # Strip query params
        if path in self.responses:
            body = json.dumps(self.responses[path]).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length:
            self.rfile.read(content_length)
        path = self.path.split("?")[0]
        if path in self.responses:
            resp_body = json.dumps(self.responses[path]).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(resp_body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # Suppress log output


class TestServerProxyWithMockServer(unittest.TestCase):
    """Integration tests with a real HTTP server."""

    @classmethod
    def setUpClass(cls):
        """Start a mock HTTP server."""
        _MockHTTPHandler.responses = {
            "/api/status": {"success": True, "connected": True, "port": "/dev/ttyACM0"},
            "/api/fpb/info": {
                "success": True,
                "info": {"version": "1.0", "slots": 6},
            },
            "/api/fpb/inject": {"success": True, "result": "injected"},
            "/api/fpb/unpatch": {"success": True, "message": "unpatched"},
            "/api/fpb/mem-read": {"success": True, "hex_dump": "00 01 02"},
            "/api/fpb/mem-write": {"success": True, "message": "written"},
        }
        cls.server = http.server.HTTPServer(("127.0.0.1", 0), _MockHTTPHandler)
        cls.port = cls.server.server_address[1]
        cls.base_url = f"http://127.0.0.1:{cls.port}"
        cls.server_thread = threading.Thread(target=cls.server.serve_forever)
        cls.server_thread.daemon = True
        cls.server_thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def _proxy(self):
        return ServerProxy(base_url=self.base_url)

    def test_is_server_running(self):
        proxy = self._proxy()
        self.assertTrue(proxy.is_server_running())

    def test_is_device_connected(self):
        proxy = self._proxy()
        self.assertTrue(proxy.is_device_connected())

    def test_get_status(self):
        proxy = self._proxy()
        status = proxy.get_status()
        self.assertTrue(status["success"])
        self.assertEqual(status["port"], "/dev/ttyACM0")

    def test_info(self):
        proxy = self._proxy()
        result = proxy.info()
        self.assertTrue(result["success"])
        self.assertEqual(result["info"]["slots"], 6)

    def test_inject(self):
        proxy = self._proxy()
        # Create a temp source file
        with tempfile.NamedTemporaryFile(mode="w", suffix=".c", delete=False) as f:
            f.write("/* FPB_INJECT */\nvoid test(void) {}\n")
            src_path = f.name
        try:
            result = proxy.inject(
                target_func="test",
                source_file=src_path,
            )
            self.assertTrue(result["success"])
        finally:
            os.unlink(src_path)

    def test_inject_nonexistent_source(self):
        """inject with nonexistent source file still sends request."""
        proxy = self._proxy()
        result = proxy.inject(
            target_func="test",
            source_file="/nonexistent/file.c",
        )
        # Server still responds (source_content will be empty)
        self.assertTrue(result["success"])

    def test_unpatch(self):
        proxy = self._proxy()
        result = proxy.unpatch(comp=0)
        self.assertTrue(result["success"])

    def test_unpatch_all(self):
        proxy = self._proxy()
        result = proxy.unpatch(all_patches=True)
        self.assertTrue(result["success"])

    def test_mem_read(self):
        proxy = self._proxy()
        result = proxy.mem_read(0x20000000, 64)
        self.assertTrue(result["success"])

    def test_mem_write(self):
        proxy = self._proxy()
        result = proxy.mem_write(0x20000000, "DEADBEEF")
        self.assertTrue(result["success"])


class TestServerProxyNoServer(unittest.TestCase):
    """Test behavior when no server is running."""

    def test_is_server_running_false(self):
        proxy = ServerProxy(base_url="http://127.0.0.1:19999")
        self.assertFalse(proxy.is_server_running())

    def test_is_device_connected_false(self):
        proxy = ServerProxy(base_url="http://127.0.0.1:19999")
        self.assertFalse(proxy.is_device_connected())

    def test_info_raises(self):
        proxy = ServerProxy(base_url="http://127.0.0.1:19999")
        with self.assertRaises(URLError):
            proxy.info()


class TestServerProxyWithToken(unittest.TestCase):
    """Test token authentication in proxy."""

    @classmethod
    def setUpClass(cls):
        _MockHTTPHandler.responses = {
            "/api/status": {"success": True, "connected": False},
        }
        cls.server = http.server.HTTPServer(("127.0.0.1", 0), _MockHTTPHandler)
        cls.port = cls.server.server_address[1]
        cls.base_url = f"http://127.0.0.1:{cls.port}"
        cls.server_thread = threading.Thread(target=cls.server.serve_forever)
        cls.server_thread.daemon = True
        cls.server_thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def test_token_appended_to_url(self):
        proxy = ServerProxy(base_url=self.base_url, token="secret")
        # is_server_running makes a GET to /api/status?token=secret
        self.assertTrue(proxy.is_server_running())

    def test_device_not_connected(self):
        proxy = ServerProxy(base_url=self.base_url)
        self.assertFalse(proxy.is_device_connected())


if __name__ == "__main__":
    unittest.main()
