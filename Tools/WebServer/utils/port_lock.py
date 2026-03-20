#!/usr/bin/env python3

# MIT License
# Copyright (c) 2025 - 2026 _VIFEXTech

"""
Serial port lock utility for FPBInject.

Provides file-based locking to prevent multiple processes from
accessing the same serial port simultaneously.
"""

import hashlib
import logging
import os
import sys
import tempfile

logger = logging.getLogger(__name__)

# Lock directory
_LOCK_DIR = os.path.join(tempfile.gettempdir(), "fpbinject-locks")


def _lock_path_for_port(port: str) -> str:
    """Get the lock file path for a given serial port."""
    port_hash = hashlib.md5(port.encode()).hexdigest()[:8]
    return os.path.join(_LOCK_DIR, f"fpbinject-{port_hash}.lock")


class PortLock:
    """File-based lock for serial port exclusive access.

    Uses fcntl (Unix) or msvcrt (Windows) for advisory file locking.
    The lock is automatically released when the file descriptor is closed
    or the process exits.
    """

    def __init__(self, port: str):
        self._port = port
        self._lock_path = _lock_path_for_port(port)
        self._lock_fd = None

    @property
    def port(self) -> str:
        return self._port

    def acquire(self) -> bool:
        """Try to acquire the lock. Returns True on success, False if held."""
        try:
            os.makedirs(_LOCK_DIR, exist_ok=True)
        except OSError as e:
            logger.warning(f"Cannot create lock dir {_LOCK_DIR}: {e}")
            return True  # Fail open: allow operation if lock dir is broken

        try:
            self._lock_fd = open(self._lock_path, "w")
        except OSError as e:
            logger.warning(f"Cannot create lock file {self._lock_path}: {e}")
            return True  # Fail open: allow operation if lock dir is broken

        try:
            if sys.platform == "win32":
                import msvcrt

                msvcrt.locking(self._lock_fd.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(self._lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)

            # Write owner info
            self._lock_fd.write(f"{os.getpid()}\n")
            self._lock_fd.flush()
            logger.debug(f"Acquired port lock for {self._port}")
            return True

        except (BlockingIOError, OSError):
            # Lock held by another process
            owner = self.get_owner_pid()
            logger.debug(f"Port lock for {self._port} held by PID {owner}")
            self._lock_fd.close()
            self._lock_fd = None
            return False

    def release(self):
        """Release the lock."""
        if self._lock_fd is None:
            return

        try:
            if sys.platform == "win32":
                import msvcrt

                msvcrt.locking(self._lock_fd.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(self._lock_fd, fcntl.LOCK_UN)
        except OSError:
            pass

        try:
            self._lock_fd.close()
        except OSError:
            pass
        self._lock_fd = None

        try:
            os.unlink(self._lock_path)
        except OSError:
            pass

        logger.debug(f"Released port lock for {self._port}")

    def is_locked(self) -> bool:
        """Check if the port is locked by another process (non-destructive)."""
        if not os.path.exists(self._lock_path):
            return False

        try:
            fd = open(self._lock_path, "w")
        except OSError:
            return True

        try:
            if sys.platform == "win32":
                import msvcrt

                msvcrt.locking(fd.fileno(), msvcrt.LK_NBLCK, 1)
                msvcrt.locking(fd.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                fcntl.flock(fd, fcntl.LOCK_UN)
            fd.close()
            return False  # Was able to lock → not held
        except (BlockingIOError, OSError):
            fd.close()
            return True  # Could not lock → held by someone

    def get_owner_pid(self) -> str:
        """Read the PID of the lock owner from the lock file."""
        try:
            with open(self._lock_path, "r") as f:
                return f.read().strip()
        except (OSError, ValueError):
            return "unknown"

    def __enter__(self):
        if not self.acquire():
            raise PortLockError(
                f"Serial port {self._port} is locked by another process "
                f"(PID: {self.get_owner_pid()})"
            )
        return self

    def __exit__(self, *args):
        self.release()

    def __del__(self):
        self.release()


class PortLockError(Exception):
    """Raised when a port lock cannot be acquired."""

    pass
