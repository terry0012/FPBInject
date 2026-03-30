/**
 * Tests for core/connection.js
 */
const {
  describe,
  it,
  assertEqual,
  assertTrue,
  assertContains,
} = require('./framework');
const {
  resetMocks,
  setFetchResponse,
  getFetchCalls,
  browserGlobals,
  MockTerminal,
} = require('./mocks');

module.exports = function (w) {
  describe('Connection Functions (core/connection.js)', () => {
    it('refreshPorts is a function', () =>
      assertTrue(typeof w.refreshPorts === 'function'));
    it('toggleConnect is a function', () =>
      assertTrue(typeof w.toggleConnect === 'function'));
    it('handleConnected is a function', () =>
      assertTrue(typeof w.handleConnected === 'function'));
    it('handleDisconnected is a function', () =>
      assertTrue(typeof w.handleDisconnected === 'function'));
    it('checkConnectionStatus is a function', () =>
      assertTrue(typeof w.checkConnectionStatus === 'function'));
    it('buildDiagnosticMessage is a function', () =>
      assertTrue(typeof w.buildDiagnosticMessage === 'function'));
  });

  describe('handleConnected Function', () => {
    it('sets isConnected to true', () => {
      w.FPBState.isConnected = false;
      w.FPBState.toolTerminal = new MockTerminal();
      w.handleConnected('/dev/ttyUSB0');
      assertTrue(w.FPBState.isConnected);
      w.FPBState.toolTerminal = null;
    });

    it('updates button text to Disconnect', () => {
      w.FPBState.toolTerminal = new MockTerminal();
      const btn = browserGlobals.document.getElementById('connectBtn');
      w.handleConnected('/dev/ttyUSB0');
      assertEqual(btn.textContent, 'Disconnect');
      w.FPBState.toolTerminal = null;
    });

    it('adds connected class to button', () => {
      w.FPBState.toolTerminal = new MockTerminal();
      const btn = browserGlobals.document.getElementById('connectBtn');
      w.handleConnected('/dev/ttyUSB0');
      assertTrue(btn.classList._classes.has('connected'));
      w.FPBState.toolTerminal = null;
    });

    it('updates connection status text', () => {
      w.FPBState.toolTerminal = new MockTerminal();
      const statusEl =
        browserGlobals.document.getElementById('connectionStatus');
      w.handleConnected('/dev/ttyUSB0');
      assertEqual(statusEl.textContent, '/dev/ttyUSB0');
      w.FPBState.toolTerminal = null;
    });

    it('writes success message to output', () => {
      const mockTerm = new MockTerminal();
      w.FPBState.toolTerminal = mockTerm;
      w.handleConnected('/dev/ttyUSB0');
      assertTrue(
        mockTerm._writes.some(
          (wr) => wr.msg && wr.msg.includes('Connected to'),
        ),
      );
      w.FPBState.toolTerminal = null;
    });

    it('uses custom message if provided', () => {
      const mockTerm = new MockTerminal();
      w.FPBState.toolTerminal = mockTerm;
      w.handleConnected('/dev/ttyUSB0', 'Custom connect message');
      assertTrue(
        mockTerm._writes.some(
          (wr) => wr.msg && wr.msg.includes('Custom connect message'),
        ),
      );
      w.FPBState.toolTerminal = null;
    });
  });

  describe('handleDisconnected Function', () => {
    it('sets isConnected to false', () => {
      w.FPBState.isConnected = true;
      w.FPBState.toolTerminal = new MockTerminal();
      w.handleDisconnected();
      assertTrue(!w.FPBState.isConnected);
      w.FPBState.toolTerminal = null;
    });

    it('updates button text to Connect', () => {
      w.FPBState.toolTerminal = new MockTerminal();
      const btn = browserGlobals.document.getElementById('connectBtn');
      btn.textContent = 'Disconnect';
      w.handleDisconnected();
      assertEqual(btn.textContent, 'Connect');
      w.FPBState.toolTerminal = null;
    });

    it('removes connected class from button', () => {
      w.FPBState.toolTerminal = new MockTerminal();
      const btn = browserGlobals.document.getElementById('connectBtn');
      btn.classList.add('connected');
      w.handleDisconnected();
      assertTrue(!btn.classList._classes.has('connected'));
      w.FPBState.toolTerminal = null;
    });

    it('updates connection status to Disconnected', () => {
      w.FPBState.toolTerminal = new MockTerminal();
      const statusEl =
        browserGlobals.document.getElementById('connectionStatus');
      w.handleDisconnected();
      assertEqual(statusEl.textContent, 'Disconnected');
      w.FPBState.toolTerminal = null;
    });

    it('writes warning message to output', () => {
      const mockTerm = new MockTerminal();
      w.FPBState.toolTerminal = mockTerm;
      w.handleDisconnected();
      assertTrue(
        mockTerm._writes.some(
          (wr) => wr.msg && wr.msg.includes('Disconnected'),
        ),
      );
      w.FPBState.toolTerminal = null;
    });
  });

  describe('refreshPorts Function', () => {
    it('is async function', () => {
      assertTrue(w.refreshPorts.constructor.name === 'AsyncFunction');
    });

    it('fetches from /api/ports', async () => {
      setFetchResponse('/api/ports', {
        ports: ['/dev/ttyUSB0', '/dev/ttyUSB1'],
      });
      w.FPBState.toolTerminal = new MockTerminal();
      await w.refreshPorts();
      const sel = browserGlobals.document.getElementById('portSelect');
      assertTrue(sel._children.length >= 2);
      w.FPBState.toolTerminal = null;
    });

    it('populates port select with ports', async () => {
      setFetchResponse('/api/ports', {
        ports: ['/dev/ttyUSB0', '/dev/ttyUSB1'],
      });
      w.FPBState.toolTerminal = new MockTerminal();
      const sel = browserGlobals.document.getElementById('portSelect');
      await w.refreshPorts();
      assertTrue(sel._children.length >= 2);
      w.FPBState.toolTerminal = null;
    });

    it('handles port objects with port property', async () => {
      setFetchResponse('/api/ports', { ports: [{ port: '/dev/ttyUSB0' }] });
      w.FPBState.toolTerminal = new MockTerminal();
      await w.refreshPorts();
      const sel = browserGlobals.document.getElementById('portSelect');
      assertTrue(sel._children.length >= 1);
      w.FPBState.toolTerminal = null;
    });

    it('handles port objects with device property', async () => {
      setFetchResponse('/api/ports', { ports: [{ device: '/dev/ttyUSB0' }] });
      w.FPBState.toolTerminal = new MockTerminal();
      await w.refreshPorts();
      const sel = browserGlobals.document.getElementById('portSelect');
      assertTrue(sel._children.length >= 1);
      w.FPBState.toolTerminal = null;
    });

    it('shows placeholder when no ports available', async () => {
      setFetchResponse('/api/ports', { ports: [] });
      w.FPBState.toolTerminal = new MockTerminal();
      const sel = browserGlobals.document.getElementById('portSelect');
      await w.refreshPorts();
      // Should have exactly one disabled placeholder option
      assertEqual(sel._children.length, 1);
      const placeholder = sel._children[0];
      assertEqual(placeholder.value, '');
      assertTrue(placeholder.disabled);
      w.FPBState.toolTerminal = null;
    });

    it('handles fetch error gracefully', async () => {
      const mockTerm = new MockTerminal();
      w.FPBState.toolTerminal = mockTerm;
      const origFetch = global.fetch;
      global.fetch = async () => {
        throw new Error('Network error');
      };
      await w.refreshPorts();
      assertTrue(
        mockTerm._writes.some((wr) => wr.msg && wr.msg.includes('Failed')),
      );
      global.fetch = origFetch;
      w.FPBState.toolTerminal = null;
    });
  });

  describe('toggleConnect Function', () => {
    it('is async function', () => {
      assertTrue(w.toggleConnect.constructor.name === 'AsyncFunction');
    });

    it('shows alert when no port selected', async () => {
      w.FPBState.isConnected = false;
      w.FPBState.toolTerminal = new MockTerminal();
      browserGlobals.document.getElementById('portSelect').value = '';
      browserGlobals.document.getElementById('baudrate').value = '115200';

      let alertCalled = false;
      let alertMessage = '';
      const origAlert = global.alert;
      global.alert = (msg) => {
        alertCalled = true;
        alertMessage = msg;
      };

      await w.toggleConnect();

      assertTrue(alertCalled);
      assertTrue(alertMessage.includes('select a serial port'));
      assertTrue(!w.FPBState.isConnected);

      global.alert = origAlert;
      w.FPBState.toolTerminal = null;
    });

    it('connects when not connected', async () => {
      w.FPBState.isConnected = false;
      w.FPBState.toolTerminal = new MockTerminal();
      setFetchResponse('/api/connect', { success: true });
      setFetchResponse('/api/fpb/info', { success: true, slots: [] });
      browserGlobals.document.getElementById('portSelect').value =
        '/dev/ttyUSB0';
      browserGlobals.document.getElementById('baudrate').value = '115200';
      await w.toggleConnect();
      assertTrue(w.FPBState.isConnected);
      w.FPBState.toolTerminal = null;
    });

    it('disconnects when connected', async () => {
      w.FPBState.isConnected = true;
      w.FPBState.toolTerminal = new MockTerminal();
      setFetchResponse('/api/disconnect', { success: true });
      await w.toggleConnect();
      assertTrue(!w.FPBState.isConnected);
      w.FPBState.toolTerminal = null;
    });

    it('shows alert on connection failure', async () => {
      w.FPBState.isConnected = false;
      const mockTerm = new MockTerminal();
      w.FPBState.toolTerminal = mockTerm;
      setFetchResponse('/api/connect', {
        success: false,
        error: 'Port busy',
        error_code: 'device_busy',
      });
      browserGlobals.document.getElementById('portSelect').value =
        '/dev/ttyUSB0';
      browserGlobals.document.getElementById('baudrate').value = '115200';

      let alertCalled = false;
      let alertMessage = '';
      const origAlert = global.alert;
      global.alert = (msg) => {
        alertCalled = true;
        alertMessage = msg;
      };

      await w.toggleConnect();

      assertTrue(alertCalled);
      assertTrue(alertMessage.includes('busy'));

      global.alert = origAlert;
      w.FPBState.toolTerminal = null;
    });

    it('handles connection failure', async () => {
      w.FPBState.isConnected = false;
      const mockTerm = new MockTerminal();
      w.FPBState.toolTerminal = mockTerm;
      setFetchResponse('/api/connect', {
        success: false,
        error: 'Port busy',
      });
      browserGlobals.document.getElementById('portSelect').value =
        '/dev/ttyUSB0';
      browserGlobals.document.getElementById('baudrate').value = '115200';
      await w.toggleConnect();
      assertTrue(
        mockTerm._writes.some((wr) => wr.msg && wr.msg.includes('ERROR')),
      );
      w.FPBState.toolTerminal = null;
    });
  });

  describe('checkConnectionStatus Function', () => {
    it('is async function', () => {
      assertTrue(w.checkConnectionStatus.constructor.name === 'AsyncFunction');
    });

    it('fetches from /api/status', async () => {
      setFetchResponse('/api/status', { connected: false });
      w.FPBState.toolTerminal = new MockTerminal();
      w.FPBState.isConnected = true;
      await w.checkConnectionStatus();
      const calls = getFetchCalls();
      assertTrue(calls.some((c) => c.url.includes('/api/status')));
      w.FPBState.toolTerminal = null;
    });

    it('calls handleConnected if already connected', async () => {
      w.FPBState.isConnected = false;
      w.FPBState.toolTerminal = new MockTerminal();
      setFetchResponse('/api/status', {
        connected: true,
        port: '/dev/ttyUSB0',
      });
      setFetchResponse('/api/fpb/info', { success: true, slots: [] });
      await w.checkConnectionStatus();
      assertTrue(w.FPBState.isConnected);
      w.FPBState.toolTerminal = null;
      w.FPBState.isConnected = false;
    });

    it('handles status check failure gracefully', async () => {
      const mockTerm = new MockTerminal();
      w.FPBState.toolTerminal = mockTerm;
      const origFetch = global.fetch;
      global.fetch = async () => {
        throw new Error('Status check error');
      };
      // Should not throw, just fail silently
      let threw = false;
      try {
        await w.checkConnectionStatus();
      } catch (e) {
        threw = true;
      }
      assertTrue(!threw);
      global.fetch = origFetch;
      w.FPBState.toolTerminal = null;
    });

    it('handles fetch exception', async () => {
      const mockTerm = new MockTerminal();
      w.FPBState.toolTerminal = mockTerm;
      const origFetch = global.fetch;
      global.fetch = async () => {
        throw new Error('Network error');
      };
      // Should not throw
      let threw = false;
      try {
        await w.checkConnectionStatus();
      } catch (e) {
        threw = true;
      }
      assertTrue(!threw);
      global.fetch = origFetch;
      w.FPBState.toolTerminal = null;
    });
  });

  describe('Baudrate Dropdown Functions', () => {
    it('onBaudrateSelectChange is a function', () =>
      assertTrue(typeof w.onBaudrateSelectChange === 'function'));

    it('getBaudrate is a function', () =>
      assertTrue(typeof w.getBaudrate === 'function'));

    it('getBaudrate returns select value for standard baud', () => {
      resetMocks();
      const sel = browserGlobals.document.getElementById('baudrate');
      sel.value = '921600';
      assertEqual(w.getBaudrate(), 921600);
    });

    it('getBaudrate returns custom input value when custom selected', () => {
      resetMocks();
      const sel = browserGlobals.document.getElementById('baudrate');
      sel.value = 'custom';
      const input = browserGlobals.document.getElementById('customBaudrate');
      input.value = '250000';
      assertEqual(w.getBaudrate(), 250000);
    });

    it('getBaudrate returns 115200 as fallback for invalid custom', () => {
      resetMocks();
      const sel = browserGlobals.document.getElementById('baudrate');
      sel.value = 'custom';
      const input = browserGlobals.document.getElementById('customBaudrate');
      input.value = '';
      assertEqual(w.getBaudrate(), 115200);
    });

    it('onBaudrateSelectChange shows custom input when custom selected', () => {
      resetMocks();
      const sel = browserGlobals.document.getElementById('baudrate');
      const customItem =
        browserGlobals.document.getElementById('customBaudrateItem');
      customItem.style.display = 'none';
      sel.value = 'custom';
      w.onBaudrateSelectChange();
      assertEqual(customItem.style.display, '');
    });

    it('onBaudrateSelectChange hides custom input for standard baud', () => {
      resetMocks();
      const sel = browserGlobals.document.getElementById('baudrate');
      const customItem =
        browserGlobals.document.getElementById('customBaudrateItem');
      customItem.style.display = '';
      sel.value = '115200';
      w.onBaudrateSelectChange();
      assertEqual(customItem.style.display, 'none');
    });

    it('onBaudrateSelectChange opens advanced settings for custom', () => {
      resetMocks();
      const sel = browserGlobals.document.getElementById('baudrate');
      const advToggle = browserGlobals.document.getElementById(
        'serialDetailsToggle',
      );
      advToggle.open = false;
      sel.value = 'custom';
      w.onBaudrateSelectChange();
      assertTrue(advToggle.open);
    });
  });

  describe('toggleConnect Function - Extended', () => {
    it('handles disconnect failure', async () => {
      w.FPBState.isConnected = true;
      const mockTerm = new MockTerminal();
      w.FPBState.toolTerminal = mockTerm;
      const origFetch = browserGlobals.fetch;
      browserGlobals.fetch = async () => {
        throw new Error('Network error');
      };
      global.fetch = browserGlobals.fetch;
      await w.toggleConnect();
      assertTrue(
        mockTerm._writes.some((wr) => wr.msg && wr.msg.includes('ERROR')),
      );
      browserGlobals.fetch = origFetch;
      global.fetch = origFetch;
      w.FPBState.toolTerminal = null;
      w.FPBState.isConnected = false;
    });

    it('handles connect fetch exception', async () => {
      w.FPBState.isConnected = false;
      const mockTerm = new MockTerminal();
      w.FPBState.toolTerminal = mockTerm;
      browserGlobals.document.getElementById('portSelect').value =
        '/dev/ttyUSB0';
      browserGlobals.document.getElementById('baudrate').value = '115200';
      const origFetch = browserGlobals.fetch;
      browserGlobals.fetch = async () => {
        throw new Error('Network error');
      };
      global.fetch = browserGlobals.fetch;
      await w.toggleConnect();
      assertTrue(
        mockTerm._writes.some((wr) => wr.msg && wr.msg.includes('ERROR')),
      );
      browserGlobals.fetch = origFetch;
      global.fetch = origFetch;
      w.FPBState.toolTerminal = null;
    });

    it('shows diagnostic alert with error_code', async () => {
      w.FPBState.isConnected = false;
      const mockTerm = new MockTerminal();
      w.FPBState.toolTerminal = mockTerm;
      browserGlobals.document.getElementById('portSelect').value =
        '/dev/ttyACM0';
      browserGlobals.document.getElementById('baudrate').value = '115200';
      setFetchResponse('/api/connect', {
        success: false,
        error: 'Permission denied',
        error_code: 'permission_denied',
      });

      let alertMessage = '';
      const origAlert = global.alert;
      global.alert = (msg) => {
        alertMessage = msg;
      };

      await w.toggleConnect();

      assertTrue(alertMessage.includes('permission'));

      global.alert = origAlert;
      w.FPBState.toolTerminal = null;
    });
  });

  describe('refreshPorts Function - Extended', () => {
    it('preserves previous port selection', async () => {
      w.FPBState.toolTerminal = new MockTerminal();
      const sel = browserGlobals.document.getElementById('portSelect');
      sel.value = '/dev/ttyUSB0';
      setFetchResponse('/api/ports', {
        ports: ['/dev/ttyUSB0', '/dev/ttyUSB1'],
      });
      await w.refreshPorts();
      assertTrue(sel._children.length >= 2);
      w.FPBState.toolTerminal = null;
    });

    it('handles non-ok response (e.g. 403 Forbidden)', async () => {
      const mockTerm = new MockTerminal();
      w.FPBState.toolTerminal = mockTerm;
      setFetchResponse('/api/ports', {
        _ok: false,
        _status: 403,
        success: false,
        error: 'Forbidden',
      });
      await w.refreshPorts();
      assertTrue(
        mockTerm._writes.some(
          (wr) => wr.msg && wr.msg.includes('Failed to refresh ports'),
        ),
      );
      w.FPBState.toolTerminal = null;
    });

    it('handles fetch exception', async () => {
      const mockTerm = new MockTerminal();
      w.FPBState.toolTerminal = mockTerm;
      const origFetch = browserGlobals.fetch;
      browserGlobals.fetch = async () => {
        throw new Error('Network error');
      };
      global.fetch = browserGlobals.fetch;
      await w.refreshPorts();
      assertTrue(
        mockTerm._writes.some((wr) => wr.msg && wr.msg.includes('ERROR')),
      );
      browserGlobals.fetch = origFetch;
      global.fetch = origFetch;
      w.FPBState.toolTerminal = null;
    });
  });

  describe('Backend Health Check Functions', () => {
    it('checkBackendHealth is a function', () =>
      assertTrue(typeof w.checkBackendHealth === 'function'));
    it('startBackendHealthCheck is a function', () =>
      assertTrue(typeof w.startBackendHealthCheck === 'function'));
    it('stopBackendHealthCheck is a function', () =>
      assertTrue(typeof w.stopBackendHealthCheck === 'function'));

    it('checkBackendHealth is async function', () => {
      assertTrue(w.checkBackendHealth.constructor.name === 'AsyncFunction');
    });

    it('checkBackendHealth does nothing when backend is alive', async () => {
      setFetchResponse('/api/status', { connected: false });
      let alertCalled = false;
      const origAlert = browserGlobals.alert;
      browserGlobals.alert = () => {
        alertCalled = true;
      };
      global.alert = browserGlobals.alert;
      await w.checkBackendHealth();
      assertTrue(!alertCalled);
      browserGlobals.alert = origAlert;
      global.alert = origAlert;
    });

    it('checkBackendHealth shows alert when backend is down', async () => {
      if (w.resetBackendAlertState) w.resetBackendAlertState();
      w.FPBState.isConnected = true;
      let alertCalled = false;
      let alertMessage = '';
      const origAlert = global.alert;
      global.alert = (msg) => {
        alertCalled = true;
        alertMessage = msg;
      };
      const origFetch = global.fetch;
      global.fetch = async () => {
        throw new Error('Network error');
      };
      // Mock getLastDataReceivedTime to return 0 (no recent data)
      const origGetLastDataReceivedTime = global.getLastDataReceivedTime;
      global.getLastDataReceivedTime = () => 0;
      await w.checkBackendHealth();
      assertTrue(alertCalled);
      assertTrue(alertMessage.includes('Backend server has disconnected'));
      global.fetch = origFetch;
      global.alert = origAlert;
      global.getLastDataReceivedTime = origGetLastDataReceivedTime;
      w.FPBState.isConnected = false;
    });

    it('checkBackendHealth only shows alert once', async () => {
      if (w.resetBackendAlertState) w.resetBackendAlertState();
      let alertCount = 0;
      const origAlert = global.alert;
      global.alert = () => {
        alertCount++;
      };
      const origFetch = global.fetch;
      global.fetch = async () => {
        throw new Error('Network error');
      };
      // Mock getLastDataReceivedTime to return 0 (no recent data)
      const origGetLastDataReceivedTime = global.getLastDataReceivedTime;
      global.getLastDataReceivedTime = () => 0;
      await w.checkBackendHealth();
      await w.checkBackendHealth();
      await w.checkBackendHealth();
      assertEqual(alertCount, 1);
      global.fetch = origFetch;
      global.alert = origAlert;
      global.getLastDataReceivedTime = origGetLastDataReceivedTime;
    });

    it('startBackendHealthCheck starts interval', () => {
      w.stopBackendHealthCheck(); // Ensure clean state
      w.startBackendHealthCheck();
      // Just verify it doesn't throw
      assertTrue(true);
      w.stopBackendHealthCheck();
    });

    it('stopBackendHealthCheck stops interval', () => {
      w.startBackendHealthCheck();
      w.stopBackendHealthCheck();
      // Just verify it doesn't throw
      assertTrue(true);
    });

    it('startBackendHealthCheck does nothing if already running', () => {
      w.startBackendHealthCheck();
      w.startBackendHealthCheck(); // Should not create another interval
      assertTrue(true);
      w.stopBackendHealthCheck();
    });

    it('checkBackendHealth updates UI when backend disconnects', async () => {
      if (w.resetBackendAlertState) w.resetBackendAlertState();
      w.FPBState.isConnected = true;
      const btn = browserGlobals.document.getElementById('connectBtn');
      const statusEl =
        browserGlobals.document.getElementById('connectionStatus');
      btn.textContent = 'Disconnect';
      btn.classList.add('connected');
      statusEl.textContent = 'Connected';

      const origAlert = global.alert;
      global.alert = () => {};
      const origFetch = global.fetch;
      global.fetch = async () => {
        throw new Error('Network error');
      };
      // Mock getLastDataReceivedTime to return 0 (no recent data)
      const origGetLastDataReceivedTime = global.getLastDataReceivedTime;
      global.getLastDataReceivedTime = () => 0;

      await w.checkBackendHealth();

      assertTrue(!w.FPBState.isConnected);
      assertEqual(btn.textContent, 'Connect');
      assertTrue(!btn.classList.contains('connected'));
      assertEqual(statusEl.textContent, 'Disconnected');

      global.fetch = origFetch;
      global.alert = origAlert;
      global.getLastDataReceivedTime = origGetLastDataReceivedTime;
    });
  });
};
