/*========================================
  FPBInject Workbench - Connection Module
  ========================================*/

/* ===========================
   CONNECTION CONFIGURATION
   =========================== */
const BACKEND_HEALTH_CHECK_INTERVAL = 5000; // 5 seconds

let backendHealthCheckTimer = null;
let backendDisconnectAlertShown = false;

/**
 * Handle baud rate dropdown change.
 * When "custom" is selected, show the custom input and open advanced settings.
 */
function onBaudrateSelectChange() {
  const sel = document.getElementById('baudrate');
  const customItem = document.getElementById('customBaudrateItem');
  const advToggle = document.getElementById('serialDetailsToggle');
  if (!sel || !customItem) return;
  if (sel.value === 'custom') {
    customItem.style.display = '';
    if (advToggle) advToggle.open = true;
    const input = document.getElementById('customBaudrate');
    if (input) input.focus();
  } else {
    customItem.style.display = 'none';
  }
}

/**
 * Get the effective baud rate value from dropdown or custom input.
 */
function getBaudrate() {
  const sel = document.getElementById('baudrate');
  if (sel && sel.value === 'custom') {
    const input = document.getElementById('customBaudrate');
    return parseInt(input?.value) || 115200;
  }
  return parseInt(sel?.value) || 115200;
}

/* ===========================
   CONNECTION DIAGNOSTICS
   =========================== */

/**
 * Build a user-friendly diagnostic alert message based on error_code.
 */
function buildDiagnosticMessage(errorCode, errorMsg) {
  const diagMap = {
    permission_denied: {
      title: t(
        'messages.diag_permission_denied',
        'Serial port permission denied',
      ),
      hint: t(
        'messages.diag_permission_denied_hint',
        'Run: sudo usermod -aG dialout $USER\nThen log out and log back in.',
      ),
    },
    device_not_found: {
      title: t('messages.diag_device_not_found', 'Device not found'),
      hint: t(
        'messages.diag_device_not_found_hint',
        'Check if the USB cable is connected, then click Refresh.',
      ),
    },
    device_busy: {
      title: t('messages.diag_device_busy', 'Serial port is busy'),
      hint: t(
        'messages.diag_device_busy_hint',
        'Close other serial tools (minicom, screen, PuTTY, etc.) and retry.',
      ),
    },
    timeout: {
      title: t('messages.connection_failed', 'Connection failed'),
      hint: t(
        'messages.check_port_hint',
        'Please check if the device is connected and the port is correct.',
      ),
    },
  };

  const diag = diagMap[errorCode];
  if (diag) {
    return `${diag.title}\n\n${diag.hint}`;
  }
  // Fallback: show raw error
  return `${t('messages.connection_failed', 'Connection failed')}: ${errorMsg}\n\n${t('messages.check_port_hint', 'Please check if the device is connected and the port is correct.')}`;
}

/* ===========================
   CONNECTION MANAGEMENT
   =========================== */
async function refreshPorts() {
  try {
    const res = await fetch('/api/ports');
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      log.error(`Failed to refresh ports: ${data.error || res.statusText}`);
      return;
    }
    const data = await res.json();
    const sel = document.getElementById('portSelect');
    const prevValue = sel.value;
    sel.innerHTML = '';

    const ports = data.ports || [];

    // Show placeholder if no ports available
    if (ports.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = t('connection.no_ports', '-- No ports available --');
      opt.disabled = true;
      sel.appendChild(opt);
      return;
    }

    ports.forEach((p) => {
      const opt = document.createElement('option');
      const portName =
        typeof p === 'string' ? p : p.port || p.device || String(p);
      const accessible = typeof p === 'object' ? p.accessible !== false : true;
      opt.value = portName;
      opt.textContent = accessible ? portName : `🔒 ${portName}`;
      sel.appendChild(opt);
    });

    const portValues = ports.map((p) =>
      typeof p === 'string' ? p : p.port || p.device || String(p),
    );
    if (portValues.includes(prevValue)) {
      sel.value = prevValue;
    }
  } catch (e) {
    log.error(`Failed to refresh ports: ${e}`);
  }
}

function handleConnected(port, message = null) {
  const btn = document.getElementById('connectBtn');
  const statusEl = document.getElementById('connectionStatus');
  const state = window.FPBState;

  state.isConnected = true;
  btn.textContent = t('connection.disconnect', 'Disconnect');
  btn.classList.add('connected');
  statusEl.textContent = port;
  log.success(message || `Connected to ${port}`);
  startLogStreaming();
  fpbInfo();
  updateDisabledState();
  updateGdbServerStatus();

  // Start ELF file watcher
  if (typeof startElfWatcherPolling === 'function') {
    startElfWatcherPolling();
  }
}

function handleDisconnected() {
  const btn = document.getElementById('connectBtn');
  const statusEl = document.getElementById('connectionStatus');
  const state = window.FPBState;

  state.isConnected = false;
  btn.textContent = t('connection.connect', 'Connect');
  btn.classList.remove('connected');
  statusEl.textContent = t('connection.status.disconnected', 'Disconnected');
  log.warn('Disconnected');
  stopLogStreaming();
  stopLogPolling();
  updateDisabledState();
  hideGdbServerStatus();

  // Stop ELF file watcher
  if (typeof stopElfWatcherPolling === 'function') {
    stopElfWatcherPolling();
  }
}

async function toggleConnect() {
  const btn = document.getElementById('connectBtn');
  const state = window.FPBState;

  if (!state.isConnected) {
    const port = document.getElementById('portSelect').value;
    const baud = getBaudrate();
    const dataBits = document.getElementById('dataBits')?.value || '8';
    const parity = document.getElementById('parity')?.value || 'none';
    const stopBits = document.getElementById('stopBits')?.value || '1';
    const flowControl = document.getElementById('flowControl')?.value || 'none';
    const dtrOnConnect =
      document.getElementById('dtrOnConnect')?.checked || false;
    const rtsOnConnect =
      document.getElementById('rtsOnConnect')?.checked || false;

    // Check if port is selected
    if (!port) {
      alert(
        t('messages.no_port_selected', 'Please select a serial port first.'),
      );
      return;
    }

    btn.disabled = true;
    btn.textContent = t('connection.connecting', 'Connecting...');

    try {
      const res = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port,
          baudrate: baud,
          data_bits: parseInt(dataBits),
          parity,
          stop_bits: parseFloat(stopBits),
          flow_control: flowControl,
          dtr_on_connect: dtrOnConnect,
          rts_on_connect: rtsOnConnect,
        }),
      });
      const data = await res.json();

      if (data.success) {
        handleConnected(port, `Connected to ${port} @ ${baud} baud`);
        btn.disabled = false;
        return;
      }

      const errorMsg = data.error || 'Connection failed';
      const errorCode = data.error_code || null;
      log.error(`Connection failed: ${errorMsg}`);
      alert(buildDiagnosticMessage(errorCode, errorMsg));
    } catch (e) {
      log.error(`Connection failed: ${e}`);
      alert(buildDiagnosticMessage(null, e.message || String(e)));
    }

    btn.textContent = t('connection.connect', 'Connect');
    btn.disabled = false;
  } else {
    try {
      await fetch('/api/disconnect', { method: 'POST' });
      handleDisconnected();
    } catch (e) {
      log.error(`Disconnect failed: ${e}`);
    }
  }
}

async function checkConnectionStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;

    const data = await res.json();
    if (data.connected) {
      handleConnected(
        data.port || 'Connected',
        `Auto-connected to ${data.port}`,
      );
    }
  } catch (e) {
    console.warn('Status check failed:', e.message);
  }
}

/**
 * Check if backend server is alive
 * Shows alert if backend becomes unavailable
 */
async function checkBackendHealth() {
  try {
    const res = await fetch('/api/status', {
      method: 'GET',
      signal: AbortSignal.timeout(3000), // 3 second timeout
    });
    if (res.ok) {
      // Backend is alive, reset alert flag
      backendDisconnectAlertShown = false;
    }
  } catch (e) {
    // Check if we've received data from SSE/polling recently
    // If we have, the backend is still alive (just /api/status is slow due to load)
    const lastDataTime =
      typeof getLastDataReceivedTime === 'function'
        ? getLastDataReceivedTime()
        : 0;
    const timeSinceLastData = Date.now() - lastDataTime;

    // If we received data within the last 10 seconds, backend is still alive
    if (lastDataTime > 0 && timeSinceLastData < 10000) {
      backendDisconnectAlertShown = false;
      return;
    }

    // Backend is not responding
    if (!backendDisconnectAlertShown) {
      backendDisconnectAlertShown = true;
      stopBackendHealthCheck();
      stopLogPolling();

      // Update UI to show disconnected state
      const state = window.FPBState;
      if (state.isConnected) {
        state.isConnected = false;
        const btn = document.getElementById('connectBtn');
        const statusEl = document.getElementById('connectionStatus');
        if (btn) {
          btn.textContent = t('connection.connect', 'Connect');
          btn.classList.remove('connected');
        }
        if (statusEl) {
          statusEl.textContent = t(
            'connection.status.disconnected',
            'Disconnected',
          );
        }
        updateDisabledState();
      }

      // Show alert to user
      alert(
        `${t('messages.backend_disconnected', 'Backend server has disconnected.')}\n\n` +
          t(
            'messages.backend_restart_hint',
            'Please restart the server and refresh the page.',
          ),
      );
    }
  }
}

/**
 * Start periodic backend health check
 */
function startBackendHealthCheck() {
  if (backendHealthCheckTimer) return;
  backendHealthCheckTimer = setInterval(
    checkBackendHealth,
    BACKEND_HEALTH_CHECK_INTERVAL,
  );
}

/**
 * Stop backend health check
 */
function stopBackendHealthCheck() {
  if (backendHealthCheckTimer) {
    clearInterval(backendHealthCheckTimer);
    backendHealthCheckTimer = null;
  }
}

/**
 * Reset backend alert state (for testing)
 */
function resetBackendAlertState() {
  backendDisconnectAlertShown = false;
}

/**
 * Update GDB server status in the status bar.
 * Fetches /api/status to get the external GDB port.
 */
async function updateGdbServerStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const data = await res.json();
    const port = data.external_gdb_port;
    const el = document.getElementById('gdbServerStatus');
    const portEl = document.getElementById('gdbServerPort');
    if (el && portEl && port) {
      portEl.textContent = t('statusbar.gdb_server', `GDB :${port}`, {
        port,
      });
      el.style.display = '';
      el.title = `target remote :${port}`;
    } else if (el) {
      el.style.display = 'none';
    }
  } catch (e) {
    // Ignore - status bar is non-critical
  }
}

/**
 * Hide GDB server status in the status bar.
 */
function hideGdbServerStatus() {
  const el = document.getElementById('gdbServerStatus');
  if (el) el.style.display = 'none';
}

// Export for global access
window.refreshPorts = refreshPorts;
window.handleConnected = handleConnected;
window.handleDisconnected = handleDisconnected;
window.toggleConnect = toggleConnect;
window.checkConnectionStatus = checkConnectionStatus;
window.checkBackendHealth = checkBackendHealth;
window.startBackendHealthCheck = startBackendHealthCheck;
window.stopBackendHealthCheck = stopBackendHealthCheck;
window.resetBackendAlertState = resetBackendAlertState;
window.onBaudrateSelectChange = onBaudrateSelectChange;
window.getBaudrate = getBaudrate;
window.updateGdbServerStatus = updateGdbServerStatus;
window.hideGdbServerStatus = hideGdbServerStatus;
window.buildDiagnosticMessage = buildDiagnosticMessage;

// Fix connect button text after translatePage() overwrites it
document.addEventListener('i18n:translated', () => {
  const btn = document.getElementById('connectBtn');
  if (btn && window.FPBState && window.FPBState.isConnected) {
    btn.textContent = t('connection.disconnect', 'Disconnect');
  }
});
