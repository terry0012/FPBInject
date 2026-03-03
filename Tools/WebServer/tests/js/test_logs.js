/**
 * Tests for core/logs.js
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
  MockTerminal,
  browserGlobals,
} = require('./mocks');

module.exports = function (w) {
  describe('Log Polling Functions (core/logs.js)', () => {
    it('startLogPolling is a function', () =>
      assertTrue(typeof w.startLogPolling === 'function'));
    it('stopLogPolling is a function', () =>
      assertTrue(typeof w.stopLogPolling === 'function'));
    it('fetchLogs is a function', () =>
      assertTrue(typeof w.fetchLogs === 'function'));
  });

  describe('startLogPolling Function', () => {
    it('resets log IDs', () => {
      w.FPBState.toolLogNextId = 100;
      w.FPBState.rawLogNextId = 200;
      w.FPBState.slotUpdateId = 300;
      w.startLogPolling();
      assertEqual(w.FPBState.toolLogNextId, 0);
      assertEqual(w.FPBState.rawLogNextId, 0);
      assertEqual(w.FPBState.slotUpdateId, 0);
      w.stopLogPolling();
    });

    it('sets logPollInterval', () => {
      w.FPBState.logPollInterval = null;
      w.startLogPolling();
      assertTrue(w.FPBState.logPollInterval !== null);
      w.stopLogPolling();
    });

    it('stops existing polling before starting', () => {
      w.startLogPolling();
      const firstInterval = w.FPBState.logPollInterval;
      w.startLogPolling();
      assertTrue(w.FPBState.logPollInterval !== null);
      w.stopLogPolling();
    });
  });

  describe('stopLogPolling Function', () => {
    it('clears logPollInterval', () => {
      w.startLogPolling();
      w.stopLogPolling();
      assertEqual(w.FPBState.logPollInterval, null);
    });

    it('handles null interval gracefully', () => {
      w.FPBState.logPollInterval = null;
      w.stopLogPolling();
      assertEqual(w.FPBState.logPollInterval, null);
    });
  });

  describe('fetchLogs Function', () => {
    it('is async function', () => {
      assertTrue(w.fetchLogs.constructor.name === 'AsyncFunction');
    });

    it('fetches from /api/logs with correct params', async () => {
      w.FPBState.toolLogNextId = 5;
      w.FPBState.rawLogNextId = 10;
      w.FPBState.slotUpdateId = 15;
      w.FPBState.toolTerminal = new MockTerminal();
      w.FPBState.rawTerminal = new MockTerminal();
      w.FPBState.slotStates = Array(8)
        .fill()
        .map(() => ({ occupied: false }));
      setFetchResponse('/api/logs', { tool_next: 6, raw_next: 11 });
      await w.fetchLogs();
      // Should complete without error
      assertTrue(true);
      w.FPBState.toolTerminal = null;
      w.FPBState.rawTerminal = null;
    });

    it('updates toolLogNextId from response', async () => {
      w.FPBState.toolLogNextId = 0;
      w.FPBState.rawLogNextId = 0;
      w.FPBState.slotUpdateId = 0;
      w.FPBState.toolTerminal = new MockTerminal();
      w.FPBState.rawTerminal = new MockTerminal();
      w.FPBState.slotStates = Array(8)
        .fill()
        .map(() => ({ occupied: false }));
      setFetchResponse('/api/logs', { tool_next: 100, raw_next: 200 });
      await w.fetchLogs();
      assertEqual(w.FPBState.toolLogNextId, 100);
      assertEqual(w.FPBState.rawLogNextId, 200);
      w.FPBState.toolTerminal = null;
      w.FPBState.rawTerminal = null;
    });

    it('writes tool_logs to output', async () => {
      const mockTerm = new MockTerminal();
      w.FPBState.toolTerminal = mockTerm;
      w.FPBState.rawTerminal = new MockTerminal();
      w.FPBState.toolLogNextId = 0;
      w.FPBState.rawLogNextId = 0;
      w.FPBState.slotUpdateId = 0;
      w.FPBState.slotStates = Array(8)
        .fill()
        .map(() => ({ occupied: false }));
      setFetchResponse('/api/logs', {
        tool_next: 1,
        raw_next: 0,
        tool_logs: ['Test log message 1', 'Test log message 2'],
      });
      await w.fetchLogs();
      assertTrue(mockTerm._writes.length >= 2);
      w.FPBState.toolTerminal = null;
      w.FPBState.rawTerminal = null;
    });

    it('writes raw_data to serial terminal', async () => {
      const mockRawTerm = new MockTerminal();
      w.FPBState.toolTerminal = new MockTerminal();
      w.FPBState.rawTerminal = mockRawTerm;
      w.FPBState.toolLogNextId = 0;
      w.FPBState.rawLogNextId = 0;
      w.FPBState.slotUpdateId = 0;
      w.FPBState.slotStates = Array(8)
        .fill()
        .map(() => ({ occupied: false }));
      setFetchResponse('/api/logs', {
        tool_next: 0,
        raw_next: 1,
        raw_data: 'Serial data here',
      });
      await w.fetchLogs();
      assertTrue(mockRawTerm._writes.length > 0);
      w.FPBState.toolTerminal = null;
      w.FPBState.rawTerminal = null;
    });

    it('updates slot states from slot_data', async () => {
      w.FPBState.toolTerminal = new MockTerminal();
      w.FPBState.rawTerminal = new MockTerminal();
      w.FPBState.toolLogNextId = 0;
      w.FPBState.rawLogNextId = 0;
      w.FPBState.slotUpdateId = 0;
      w.FPBState.slotStates = Array(8)
        .fill()
        .map(() => ({ occupied: false }));
      setFetchResponse('/api/logs', {
        tool_next: 0,
        raw_next: 0,
        slot_update_id: 1,
        slot_data: {
          slots: [
            {
              id: 0,
              occupied: true,
              func: 'test_func',
              orig_addr: '0x1000',
              target_addr: '0x2000',
              code_size: 100,
            },
            { id: 1, occupied: false },
            { id: 2, occupied: false },
            { id: 3, occupied: false },
            { id: 4, occupied: false },
            { id: 5, occupied: false },
          ],
          memory: { is_dynamic: true, used: 100 },
        },
      });
      await w.fetchLogs();
      assertTrue(w.FPBState.slotStates[0].occupied);
      assertEqual(w.FPBState.slotStates[0].func, 'test_func');
      w.FPBState.toolTerminal = null;
      w.FPBState.rawTerminal = null;
    });

    it('handles non-ok response gracefully', async () => {
      w.FPBState.toolTerminal = new MockTerminal();
      w.FPBState.rawTerminal = new MockTerminal();
      w.FPBState.slotStates = Array(8)
        .fill()
        .map(() => ({ occupied: false }));
      setFetchResponse('/api/logs', { _ok: false, _status: 500 });
      await w.fetchLogs();
      assertTrue(true);
      w.FPBState.toolTerminal = null;
      w.FPBState.rawTerminal = null;
    });

    it('handles empty tool_logs array', async () => {
      w.FPBState.toolTerminal = new MockTerminal();
      w.FPBState.rawTerminal = new MockTerminal();
      w.FPBState.toolLogNextId = 0;
      w.FPBState.rawLogNextId = 0;
      w.FPBState.slotUpdateId = 0;
      w.FPBState.slotStates = Array(8)
        .fill()
        .map(() => ({ occupied: false }));
      setFetchResponse('/api/logs', {
        tool_next: 0,
        raw_next: 0,
        tool_logs: [],
      });
      await w.fetchLogs();
      assertTrue(true);
      w.FPBState.toolTerminal = null;
      w.FPBState.rawTerminal = null;
    });

    it('handles missing slot_data gracefully', async () => {
      w.FPBState.toolTerminal = new MockTerminal();
      w.FPBState.rawTerminal = new MockTerminal();
      w.FPBState.toolLogNextId = 0;
      w.FPBState.rawLogNextId = 0;
      w.FPBState.slotUpdateId = 0;
      w.FPBState.slotStates = Array(8)
        .fill()
        .map(() => ({ occupied: false }));
      setFetchResponse('/api/logs', {
        tool_next: 0,
        raw_next: 0,
        slot_update_id: 1,
      });
      await w.fetchLogs();
      assertTrue(true);
      w.FPBState.toolTerminal = null;
      w.FPBState.rawTerminal = null;
    });

    it('does not update slots if slot_update_id not increased', async () => {
      w.FPBState.toolTerminal = new MockTerminal();
      w.FPBState.rawTerminal = new MockTerminal();
      w.FPBState.toolLogNextId = 0;
      w.FPBState.rawLogNextId = 0;
      w.FPBState.slotUpdateId = 5;
      w.FPBState.slotStates = Array(8)
        .fill()
        .map(() => ({ occupied: false }));
      setFetchResponse('/api/logs', {
        tool_next: 0,
        raw_next: 0,
        slot_update_id: 3,
        slot_data: { slots: [{ occupied: true }] },
      });
      await w.fetchLogs();
      assertTrue(!w.FPBState.slotStates[0].occupied);
      w.FPBState.toolTerminal = null;
      w.FPBState.rawTerminal = null;
    });

    it('handles slot_data with memory info', async () => {
      w.FPBState.toolTerminal = new MockTerminal();
      w.FPBState.rawTerminal = new MockTerminal();
      w.FPBState.toolLogNextId = 0;
      w.FPBState.rawLogNextId = 0;
      w.FPBState.slotUpdateId = 0;
      w.FPBState.slotStates = Array(8)
        .fill()
        .map(() => ({ occupied: false }));
      setFetchResponse('/api/logs', {
        tool_next: 0,
        raw_next: 0,
        slot_update_id: 1,
        slot_data: {
          slots: Array(8)
            .fill()
            .map(() => ({ occupied: false })),
          memory: {
            is_dynamic: false,
            base: 0x20000000,
            size: 4096,
            used: 1024,
          },
        },
      });
      await w.fetchLogs();
      const memEl = browserGlobals.document.getElementById('memoryInfo');
      assertContains(memEl.innerHTML, '1024');
      w.FPBState.toolTerminal = null;
      w.FPBState.rawTerminal = null;
    });

    it('handles empty response text', async () => {
      w.FPBState.toolTerminal = new MockTerminal();
      w.FPBState.rawTerminal = new MockTerminal();
      w.FPBState.slotStates = Array(8)
        .fill()
        .map(() => ({ occupied: false }));
      // Simulate empty response
      const origFetch = browserGlobals.fetch;
      browserGlobals.fetch = async () => ({
        ok: true,
        headers: { get: () => 'application/json' },
        text: async () => '',
      });
      global.fetch = browserGlobals.fetch;
      await w.fetchLogs();
      assertTrue(true);
      browserGlobals.fetch = origFetch;
      global.fetch = origFetch;
      w.FPBState.toolTerminal = null;
      w.FPBState.rawTerminal = null;
    });

    it('handles invalid JSON response', async () => {
      w.FPBState.toolTerminal = new MockTerminal();
      w.FPBState.rawTerminal = new MockTerminal();
      w.FPBState.slotStates = Array(8)
        .fill()
        .map(() => ({ occupied: false }));
      const origFetch = browserGlobals.fetch;
      browserGlobals.fetch = async () => ({
        ok: true,
        headers: { get: () => 'application/json' },
        text: async () => 'not valid json',
      });
      global.fetch = browserGlobals.fetch;
      await w.fetchLogs();
      assertTrue(true);
      browserGlobals.fetch = origFetch;
      global.fetch = origFetch;
      w.FPBState.toolTerminal = null;
      w.FPBState.rawTerminal = null;
    });

    it('handles non-json content type', async () => {
      w.FPBState.toolTerminal = new MockTerminal();
      w.FPBState.rawTerminal = new MockTerminal();
      w.FPBState.slotStates = Array(8)
        .fill()
        .map(() => ({ occupied: false }));
      const origFetch = browserGlobals.fetch;
      browserGlobals.fetch = async () => ({
        ok: true,
        headers: { get: () => 'text/html' },
        text: async () => '<html></html>',
      });
      global.fetch = browserGlobals.fetch;
      await w.fetchLogs();
      assertTrue(true);
      browserGlobals.fetch = origFetch;
      global.fetch = origFetch;
      w.FPBState.toolTerminal = null;
      w.FPBState.rawTerminal = null;
    });

    it('handles fetch exception', async () => {
      w.FPBState.toolTerminal = new MockTerminal();
      w.FPBState.rawTerminal = new MockTerminal();
      w.FPBState.slotStates = Array(8)
        .fill()
        .map(() => ({ occupied: false }));
      const origFetch = browserGlobals.fetch;
      browserGlobals.fetch = async () => {
        throw new Error('Network error');
      };
      global.fetch = browserGlobals.fetch;
      await w.fetchLogs();
      assertTrue(true);
      browserGlobals.fetch = origFetch;
      global.fetch = origFetch;
      w.FPBState.toolTerminal = null;
      w.FPBState.rawTerminal = null;
    });

    it('handles whitespace-only response', async () => {
      w.FPBState.toolTerminal = new MockTerminal();
      w.FPBState.rawTerminal = new MockTerminal();
      w.FPBState.slotStates = Array(8)
        .fill()
        .map(() => ({ occupied: false }));
      const origFetch = browserGlobals.fetch;
      browserGlobals.fetch = async () => ({
        ok: true,
        headers: { get: () => 'application/json' },
        text: async () => '   \n\t  ',
      });
      global.fetch = browserGlobals.fetch;
      await w.fetchLogs();
      assertTrue(true);
      browserGlobals.fetch = origFetch;
      global.fetch = origFetch;
      w.FPBState.toolTerminal = null;
      w.FPBState.rawTerminal = null;
    });

    it('handles null content-type header', async () => {
      w.FPBState.toolTerminal = new MockTerminal();
      w.FPBState.rawTerminal = new MockTerminal();
      w.FPBState.slotStates = Array(8)
        .fill()
        .map(() => ({ occupied: false }));
      const origFetch = browserGlobals.fetch;
      browserGlobals.fetch = async () => ({
        ok: true,
        headers: { get: () => null },
        text: async () => '{}',
      });
      global.fetch = browserGlobals.fetch;
      await w.fetchLogs();
      assertTrue(true);
      browserGlobals.fetch = origFetch;
      global.fetch = origFetch;
      w.FPBState.toolTerminal = null;
      w.FPBState.rawTerminal = null;
    });

    it('updates all slot states from response', async () => {
      w.FPBState.toolTerminal = new MockTerminal();
      w.FPBState.rawTerminal = new MockTerminal();
      w.FPBState.toolLogNextId = 0;
      w.FPBState.rawLogNextId = 0;
      w.FPBState.slotUpdateId = 0;
      w.FPBState.slotStates = Array(8)
        .fill()
        .map(() => ({ occupied: false }));
      setFetchResponse('/api/logs', {
        tool_next: 0,
        raw_next: 0,
        slot_update_id: 1,
        slot_data: {
          slots: [
            {
              id: 0,
              occupied: true,
              func: 'func0',
              orig_addr: '0x1000',
              target_addr: '0x2000',
              code_size: 100,
            },
            {
              id: 1,
              occupied: true,
              func: 'func1',
              orig_addr: '0x1100',
              target_addr: '0x2100',
              code_size: 200,
            },
            { id: 2, occupied: false },
            { id: 3, occupied: false },
            { id: 4, occupied: false },
            { id: 5, occupied: false },
          ],
        },
      });
      await w.fetchLogs();
      assertTrue(w.FPBState.slotStates[0].occupied);
      assertTrue(w.FPBState.slotStates[1].occupied);
      assertEqual(w.FPBState.slotStates[0].func, 'func0');
      assertEqual(w.FPBState.slotStates[1].func, 'func1');
      w.FPBState.toolTerminal = null;
      w.FPBState.rawTerminal = null;
    });

    it('uses slot.id to correctly index slotStates (non-sequential)', async () => {
      w.FPBState.toolTerminal = new MockTerminal();
      w.FPBState.rawTerminal = new MockTerminal();
      w.FPBState.toolLogNextId = 0;
      w.FPBState.rawLogNextId = 0;
      w.FPBState.slotUpdateId = 0;
      w.FPBState.slotStates = Array(8)
        .fill()
        .map(() => ({ occupied: false }));
      // Simulate device returning Slot[0] empty, Slot[7] occupied
      setFetchResponse('/api/logs', {
        tool_next: 0,
        raw_next: 0,
        slot_update_id: 1,
        slot_data: {
          fpb_version: 2,
          slots: [
            { id: 0, occupied: false },
            { id: 1, occupied: false },
            { id: 2, occupied: false },
            { id: 3, occupied: false },
            { id: 4, occupied: false },
            { id: 5, occupied: false },
            { id: 6, occupied: false },
            {
              id: 7,
              occupied: true,
              func: 'hook_func',
              orig_addr: '0x2C9091DC',
              target_addr: '0x3D0B4B91',
              code_size: 65,
            },
          ],
        },
      });
      await w.fetchLogs();
      // Slot 7 should be occupied
      assertTrue(w.FPBState.slotStates[7].occupied);
      assertEqual(w.FPBState.slotStates[7].func, 'hook_func');
      assertEqual(w.FPBState.slotStates[7].orig_addr, '0x2C9091DC');
      assertEqual(w.FPBState.slotStates[7].code_size, 65);
      // Other slots should remain empty
      assertTrue(!w.FPBState.slotStates[0].occupied);
      assertTrue(!w.FPBState.slotStates[6].occupied);
      w.FPBState.toolTerminal = null;
      w.FPBState.rawTerminal = null;
    });

    it('correctly handles sparse slot data (only occupied slots)', async () => {
      w.FPBState.toolTerminal = new MockTerminal();
      w.FPBState.rawTerminal = new MockTerminal();
      w.FPBState.toolLogNextId = 0;
      w.FPBState.rawLogNextId = 0;
      w.FPBState.slotUpdateId = 0;
      w.FPBState.slotStates = Array(8)
        .fill()
        .map(() => ({ occupied: false }));
      // Device returns only Slot[2] and Slot[5] as occupied
      setFetchResponse('/api/logs', {
        tool_next: 0,
        raw_next: 0,
        slot_update_id: 1,
        slot_data: {
          slots: [
            { id: 0, occupied: false },
            { id: 1, occupied: false },
            {
              id: 2,
              occupied: true,
              func: 'slot2_func',
              orig_addr: '0x08001000',
              target_addr: '0x20001000',
              code_size: 32,
            },
            { id: 3, occupied: false },
            { id: 4, occupied: false },
            {
              id: 5,
              occupied: true,
              func: 'slot5_func',
              orig_addr: '0x08002000',
              target_addr: '0x20002000',
              code_size: 48,
            },
            { id: 6, occupied: false },
            { id: 7, occupied: false },
          ],
        },
      });
      await w.fetchLogs();
      assertTrue(!w.FPBState.slotStates[0].occupied);
      assertTrue(!w.FPBState.slotStates[1].occupied);
      assertTrue(w.FPBState.slotStates[2].occupied);
      assertEqual(w.FPBState.slotStates[2].func, 'slot2_func');
      assertTrue(!w.FPBState.slotStates[3].occupied);
      assertTrue(!w.FPBState.slotStates[4].occupied);
      assertTrue(w.FPBState.slotStates[5].occupied);
      assertEqual(w.FPBState.slotStates[5].func, 'slot5_func');
      assertTrue(!w.FPBState.slotStates[6].occupied);
      assertTrue(!w.FPBState.slotStates[7].occupied);
      w.FPBState.toolTerminal = null;
      w.FPBState.rawTerminal = null;
    });
  });

  // ===== SSE Streaming Tests =====
  describe('SSE Streaming Functions (core/logs.js)', () => {
    it('startLogStreaming is a function', () =>
      assertTrue(typeof w.startLogStreaming === 'function'));
    it('stopLogStreaming is a function', () =>
      assertTrue(typeof w.stopLogStreaming === 'function'));
    it('processLogData is a function', () =>
      assertTrue(typeof w.processLogData === 'function'));
  });

  describe('startLogStreaming Function', () => {
    it('resets log IDs', () => {
      w.FPBState.toolLogNextId = 100;
      w.FPBState.rawLogNextId = 200;
      w.FPBState.slotUpdateId = 300;
      // Mock EventSource
      const origEventSource = global.EventSource;
      global.EventSource = function () {
        this.close = () => {};
        this.onopen = null;
        this.onmessage = null;
        this.onerror = null;
        this.addEventListener = () => {};
      };
      w.startLogStreaming();
      assertEqual(w.FPBState.toolLogNextId, 0);
      assertEqual(w.FPBState.rawLogNextId, 0);
      assertEqual(w.FPBState.slotUpdateId, 0);
      w.stopLogStreaming();
      global.EventSource = origEventSource;
    });

    it('falls back to polling when EventSource not supported', () => {
      const origEventSource = global.EventSource;
      global.EventSource = function () {
        throw new Error('Not supported');
      };
      w.FPBState.logPollInterval = null;
      w.startLogStreaming();
      // Should have fallen back to polling
      assertTrue(w.FPBState.logPollInterval !== null);
      w.stopLogPolling();
      global.EventSource = origEventSource;
    });
  });

  describe('stopLogStreaming Function', () => {
    it('sets logStreamActive to false', () => {
      w.FPBState.logStreamActive = true;
      w.stopLogStreaming();
      assertEqual(w.FPBState.logStreamActive, false);
    });

    it('handles called without active stream', () => {
      w.FPBState.logStreamActive = false;
      w.stopLogStreaming();
      assertEqual(w.FPBState.logStreamActive, false);
    });
  });

  describe('processLogData Function', () => {
    it('updates toolLogNextId from data', () => {
      w.FPBState.toolLogNextId = 0;
      w.processLogData({ tool_next: 42 });
      assertEqual(w.FPBState.toolLogNextId, 42);
    });

    it('updates rawLogNextId from data', () => {
      w.FPBState.rawLogNextId = 0;
      w.processLogData({ raw_next: 99 });
      assertEqual(w.FPBState.rawLogNextId, 99);
    });

    it('writes tool logs to terminal', () => {
      const mockTerm = new MockTerminal();
      w.FPBState.toolTerminal = mockTerm;
      w.processLogData({ tool_logs: ['Log message 1', 'Log message 2'] });
      assertTrue(mockTerm._writes.length >= 2);
      w.FPBState.toolTerminal = null;
    });

    it('writes raw data to serial terminal', () => {
      const mockTerm = new MockTerminal();
      w.FPBState.rawTerminal = mockTerm;
      w.FPBState.terminalPaused = false;
      w.processLogData({ raw_data: 'serial output' });
      assertTrue(
        mockTerm._writes.some((wr) => wr.msg && wr.msg.includes('serial')),
      );
      w.FPBState.rawTerminal = null;
    });

    it('updates slotStates from slot_data', () => {
      w.FPBState.slotUpdateId = 0;
      w.FPBState.slotStates = Array(8)
        .fill()
        .map(() => ({ occupied: false }));
      w.processLogData({
        slot_update_id: 1,
        slot_data: {
          slots: [{ id: 0, occupied: true, func: 'test_func' }],
        },
      });
      assertEqual(w.FPBState.slotUpdateId, 1);
      assertTrue(w.FPBState.slotStates[0].occupied);
      assertEqual(w.FPBState.slotStates[0].func, 'test_func');
    });

    it('handles empty data gracefully', () => {
      w.processLogData({});
      assertTrue(true);
    });
  });

  describe('SSE EventSource Callbacks', () => {
    it('onopen stops polling and sets logStreamActive', () => {
      let esInstance = null;
      const origEventSource = global.EventSource;
      global.EventSource = function () {
        esInstance = this;
        this.close = () => {};
        this.onopen = null;
        this.onmessage = null;
        this.onerror = null;
        this.addEventListener = () => {};
      };

      w.FPBState.logPollInterval = 123;
      w.startLogStreaming();

      // Simulate onopen callback
      if (esInstance && esInstance.onopen) {
        esInstance.onopen();
      }
      assertEqual(w.FPBState.logStreamActive, true);

      w.stopLogStreaming();
      global.EventSource = origEventSource;
    });

    it('onmessage processes valid JSON data', () => {
      let esInstance = null;
      const origEventSource = global.EventSource;
      global.EventSource = function () {
        esInstance = this;
        this.close = () => {};
        this.onopen = null;
        this.onmessage = null;
        this.onerror = null;
        this.addEventListener = () => {};
      };

      w.FPBState.rawLogNextId = 0;
      w.startLogStreaming();

      // Simulate onmessage with valid data
      if (esInstance && esInstance.onmessage) {
        esInstance.onmessage({ data: JSON.stringify({ raw_next: 55 }) });
      }
      assertEqual(w.FPBState.rawLogNextId, 55);

      w.stopLogStreaming();
      global.EventSource = origEventSource;
    });

    it('onmessage handles invalid JSON gracefully', () => {
      let esInstance = null;
      const origEventSource = global.EventSource;
      global.EventSource = function () {
        esInstance = this;
        this.close = () => {};
        this.onopen = null;
        this.onmessage = null;
        this.onerror = null;
        this.addEventListener = () => {};
      };

      w.startLogStreaming();

      // Simulate onmessage with invalid JSON
      if (esInstance && esInstance.onmessage) {
        esInstance.onmessage({ data: 'not valid json' });
      }
      // Should not throw
      assertTrue(true);

      w.stopLogStreaming();
      global.EventSource = origEventSource;
    });

    it('onerror falls back to polling after max retries', () => {
      let esInstance = null;
      const origEventSource = global.EventSource;
      const origSetTimeout = global.setTimeout;
      const timeoutCallbacks = [];

      // Mock setTimeout to capture callbacks
      global.setTimeout = (cb) => {
        timeoutCallbacks.push(cb);
        return 1;
      };

      global.EventSource = function () {
        esInstance = this;
        this.close = () => {};
        this.onopen = null;
        this.onmessage = null;
        this.onerror = null;
        this.addEventListener = () => {};
      };

      w.FPBState.logPollInterval = null;
      w.startLogStreaming();

      // First error - should auto-retry
      if (esInstance && esInstance.onerror) {
        esInstance.onerror();
      }
      // Execute auto-retry timeout callback
      if (timeoutCallbacks.length > 0) {
        timeoutCallbacks.shift()();
      }

      // Second error - should auto-retry
      if (esInstance && esInstance.onerror) {
        esInstance.onerror();
      }
      if (timeoutCallbacks.length > 0) {
        timeoutCallbacks.shift()();
      }

      // Third error - should fall back to polling
      if (esInstance && esInstance.onerror) {
        esInstance.onerror();
      }

      // Should have fallen back to polling (no more setTimeout for retry)
      assertTrue(w.FPBState.logPollInterval !== null);

      w.stopLogPolling();
      w.stopLogStreaming();
      global.EventSource = origEventSource;
      global.setTimeout = origSetTimeout;
    });
  });
};
