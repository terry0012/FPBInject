/**
 * Tests for features/quick-commands.js
 */
const {
  describe,
  it,
  assertEqual,
  assertTrue,
  assertFalse,
} = require('./framework');
const {
  browserGlobals,
  resetMocks,
  MockTerminal,
  setFetchResponse,
  getFetchCalls,
  createMockElement,
  getElement,
} = require('./mocks');

module.exports = function (w) {
  describe('Quick Commands (features/quick-commands.js)', () => {
    // ===== Function exports =====
    it('loadQuickCommands is a function', () =>
      assertTrue(typeof w.loadQuickCommands === 'function'));
    it('saveQuickCommands is a function', () =>
      assertTrue(typeof w.saveQuickCommands === 'function'));
    it('renderQuickCommands is a function', () =>
      assertTrue(typeof w.renderQuickCommands === 'function'));
    it('executeQuickCommand is a function', () =>
      assertTrue(typeof w.executeQuickCommand === 'function'));
    it('openQuickCommandEditor is a function', () =>
      assertTrue(typeof w.openQuickCommandEditor === 'function'));
    it('closeQuickCommandEditor is a function', () =>
      assertTrue(typeof w.closeQuickCommandEditor === 'function'));
    it('saveQuickCommand is a function', () =>
      assertTrue(typeof w.saveQuickCommand === 'function'));
    it('deleteQuickCommand is a function', () =>
      assertTrue(typeof w.deleteQuickCommand === 'function'));
    it('duplicateQuickCommand is a function', () =>
      assertTrue(typeof w.duplicateQuickCommand === 'function'));
    it('exportQuickCommands is a function', () =>
      assertTrue(typeof w.exportQuickCommands === 'function'));
    it('importQuickCommands is a function', () =>
      assertTrue(typeof w.importQuickCommands === 'function'));
    it('clearAllQuickCommands is a function', () =>
      assertTrue(typeof w.clearAllQuickCommands === 'function'));
    it('testRunQuickCommand is a function', () =>
      assertTrue(typeof w.testRunQuickCommand === 'function'));
    it('generateId is a function', () =>
      assertTrue(typeof w.generateId === 'function'));
    it('unescapeCommand is a function', () =>
      assertTrue(typeof w.unescapeCommand === 'function'));
    it('escapeCommandForDisplay is a function', () =>
      assertTrue(typeof w.escapeCommandForDisplay === 'function'));
    it('sendSerialData is a function', () =>
      assertTrue(typeof w.sendSerialData === 'function'));
    it('stopMacroExecution is a function', () =>
      assertTrue(typeof w.stopMacroExecution === 'function'));
    it('hideQcContextMenus is a function', () =>
      assertTrue(typeof w.hideQcContextMenus === 'function'));
    it('moveToGroup is a function', () =>
      assertTrue(typeof w.moveToGroup === 'function'));
    it('initQuickCommands is a function', () =>
      assertTrue(typeof w.initQuickCommands === 'function'));
  });

  // ===== Escape handling =====
  describe('Quick Commands - Escape Handling', () => {
    it('unescapeCommand converts \\n to newline', () => {
      assertEqual(w.unescapeCommand('hello\\n'), 'hello\n');
    });

    it('unescapeCommand converts \\r to carriage return', () => {
      assertEqual(w.unescapeCommand('hello\\r'), 'hello\r');
    });

    it('unescapeCommand converts \\t to tab', () => {
      assertEqual(w.unescapeCommand('a\\tb'), 'a\tb');
    });

    it('unescapeCommand converts \\x1b to ESC', () => {
      assertEqual(w.unescapeCommand('\\x1b[0m'), '\x1b[0m');
    });

    it('unescapeCommand converts \\\\ to backslash', () => {
      assertEqual(w.unescapeCommand('path\\\\file'), 'path\\file');
    });

    it('unescapeCommand handles multiple escapes', () => {
      assertEqual(w.unescapeCommand('a\\nb\\tc\\r'), 'a\nb\tc\r');
    });

    it('unescapeCommand handles empty string', () => {
      assertEqual(w.unescapeCommand(''), '');
    });

    it('escapeCommandForDisplay converts newline to \\n', () => {
      assertEqual(w.escapeCommandForDisplay('hello\n'), 'hello\\n');
    });

    it('escapeCommandForDisplay converts tab to \\t', () => {
      assertEqual(w.escapeCommandForDisplay('a\tb'), 'a\\tb');
    });

    it('escapeCommandForDisplay round-trips with unescape', () => {
      const original = 'cmd\\narg\\t--flag';
      const unescaped = w.unescapeCommand(original);
      const reescaped = w.escapeCommandForDisplay(unescaped);
      assertEqual(reescaped, original);
    });
  });

  // ===== ID generation =====
  describe('Quick Commands - ID Generation', () => {
    it('generateId returns string starting with qc_', () => {
      const id = w.generateId();
      assertTrue(typeof id === 'string');
      assertTrue(id.startsWith('qc_'));
    });

    it('generateId returns unique IDs', () => {
      const ids = new Set();
      for (let i = 0; i < 50; i++) {
        ids.add(w.generateId());
      }
      assertEqual(ids.size, 50);
    });
  });

  // ===== Storage =====
  describe('Quick Commands - Storage', () => {
    it('loadQuickCommands returns empty array when no data', () => {
      const origGet = browserGlobals.localStorage.getItem;
      browserGlobals.localStorage.getItem = () => null;
      const result = w.loadQuickCommands();
      assertTrue(Array.isArray(result));
      assertEqual(result.length, 0);
      browserGlobals.localStorage.getItem = origGet;
    });

    it('loadQuickCommands returns parsed data', () => {
      const cmds = [
        { id: 'qc_1', name: 'test', type: 'single', command: 'ps\\n' },
      ];
      const origGet = browserGlobals.localStorage.getItem;
      browserGlobals.localStorage.getItem = (key) => {
        if (key === 'fpbinject-quick-commands') return JSON.stringify(cmds);
        return null;
      };
      const result = w.loadQuickCommands();
      assertEqual(result.length, 1);
      assertEqual(result[0].name, 'test');
      browserGlobals.localStorage.getItem = origGet;
    });

    it('loadQuickCommands handles invalid JSON gracefully', () => {
      const origGet = browserGlobals.localStorage.getItem;
      browserGlobals.localStorage.getItem = () => 'not-json{{{';
      const result = w.loadQuickCommands();
      assertTrue(Array.isArray(result));
      assertEqual(result.length, 0);
      browserGlobals.localStorage.getItem = origGet;
    });

    it('saveQuickCommands stores data in localStorage', () => {
      let savedKey = null;
      let savedValue = null;
      const origSet = browserGlobals.localStorage.setItem;
      browserGlobals.localStorage.setItem = (k, v) => {
        savedKey = k;
        savedValue = v;
      };
      const cmds = [{ id: 'qc_1', name: 'test' }];
      w.saveQuickCommands(cmds);
      assertEqual(savedKey, 'fpbinject-quick-commands');
      const parsed = JSON.parse(savedValue);
      assertEqual(parsed.length, 1);
      assertEqual(parsed[0].name, 'test');
      browserGlobals.localStorage.setItem = origSet;
    });
  });

  // ===== Execution =====
  describe('Quick Commands - Execution', () => {
    it('executeQuickCommand returns early if not connected', async () => {
      w.FPBState.isConnected = false;
      const origGet = browserGlobals.localStorage.getItem;
      browserGlobals.localStorage.getItem = () =>
        JSON.stringify([{ id: 'qc_1', type: 'single', command: 'test\\n' }]);
      await w.executeQuickCommand('qc_1');
      // Should not throw
      browserGlobals.localStorage.getItem = origGet;
    });

    it('executeQuickCommand sends single command via fetch', async () => {
      w.FPBState.isConnected = true;
      w.FPBState.toolTerminal = new MockTerminal();
      const origGet = browserGlobals.localStorage.getItem;
      browserGlobals.localStorage.getItem = () =>
        JSON.stringify([
          { id: 'qc_1', type: 'single', command: 'ps\\n', appendNewline: true },
        ]);

      let sentData = null;
      const origFetch = global.fetch;
      global.fetch = async (url, opts) => {
        if (url === '/api/serial/send') {
          sentData = JSON.parse(opts.body).data;
        }
        return { ok: true, json: async () => ({ success: true }) };
      };

      await w.executeQuickCommand('qc_1');
      assertEqual(sentData, 'ps\n');

      global.fetch = origFetch;
      browserGlobals.localStorage.getItem = origGet;
      w.FPBState.isConnected = false;
      w.FPBState.toolTerminal = null;
    });

    it('executeQuickCommand handles unknown ID gracefully', async () => {
      w.FPBState.isConnected = true;
      w.FPBState.toolTerminal = new MockTerminal();
      const origGet = browserGlobals.localStorage.getItem;
      browserGlobals.localStorage.getItem = () => JSON.stringify([]);
      await w.executeQuickCommand('nonexistent');
      // Should not throw
      browserGlobals.localStorage.getItem = origGet;
      w.FPBState.isConnected = false;
      w.FPBState.toolTerminal = null;
    });

    it('sendSerialData calls fetch with correct payload', async () => {
      w.FPBState.isConnected = true;
      let fetchUrl = null;
      let fetchBody = null;
      const origFetch = global.fetch;
      global.fetch = async (url, opts) => {
        fetchUrl = url;
        fetchBody = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ success: true }) };
      };

      await w.sendSerialData('hello\n');
      assertEqual(fetchUrl, '/api/serial/send');
      assertEqual(fetchBody.data, 'hello\n');

      global.fetch = origFetch;
      w.FPBState.isConnected = false;
    });

    it('sendSerialData handles fetch error gracefully', async () => {
      const origFetch = browserGlobals.fetch;
      browserGlobals.fetch = async () => {
        throw new Error('Network error');
      };
      // Should not throw
      await w.sendSerialData('test');
      browserGlobals.fetch = origFetch;
    });
  });

  // ===== Macro execution =====
  describe('Quick Commands - Macro Execution', () => {
    it('stopMacroExecution does not throw when no macro running', () => {
      w.stopMacroExecution();
      // Should not throw
      assertTrue(true);
    });
  });

  // ===== Editor modal =====
  describe('Quick Commands - Editor Modal', () => {
    it('closeQuickCommandEditor removes show class', () => {
      const modal = browserGlobals.document.getElementById(
        'quickCommandEditorModal',
      );
      modal.classList.add('show');
      w.closeQuickCommandEditor();
      assertFalse(modal.classList.contains('show'));
    });

    it('openQuickCommandEditor adds show class for new command', () => {
      // Set up required DOM elements via getElementById (auto-registers in mockElements)
      const modal = browserGlobals.document.getElementById(
        'quickCommandEditorModal',
      );
      browserGlobals.document.getElementById('quickCommandEditorTitle');
      browserGlobals.document.getElementById('qcName');
      browserGlobals.document.getElementById('qcCommand');
      const appendNl =
        browserGlobals.document.getElementById('qcAppendNewline');
      appendNl.type = 'checkbox';
      browserGlobals.document.getElementById('qcGroup');
      browserGlobals.document.getElementById('qcNewGroup');
      browserGlobals.document.getElementById('qcTestRunBtn');

      // Create radio buttons
      const radioSingle = createMockElement('_radio_single');
      radioSingle.type = 'radio';
      radioSingle.name = 'qcType';
      radioSingle.value = 'single';
      radioSingle.checked = true;
      const radioMacro = createMockElement('_radio_macro');
      radioMacro.type = 'radio';
      radioMacro.name = 'qcType';
      radioMacro.value = 'macro';
      radioMacro.checked = false;

      // Mock querySelector for radio buttons
      const origQS = browserGlobals.document.querySelector;
      browserGlobals.document.querySelector = (sel) => {
        if (sel.includes('value="single"')) return radioSingle;
        if (sel.includes('value="macro"')) return radioMacro;
        if (sel.includes('.qc-item')) return null;
        return origQS ? origQS(sel) : null;
      };

      const origGet = browserGlobals.localStorage.getItem;
      browserGlobals.localStorage.getItem = () => JSON.stringify([]);

      w.openQuickCommandEditor();
      assertTrue(modal.classList.contains('show'));

      browserGlobals.localStorage.getItem = origGet;
      browserGlobals.document.querySelector = origQS;
    });
  });

  // ===== Context menu =====
  describe('Quick Commands - Context Menu', () => {
    it('hideQcContextMenus hides both menus', () => {
      const menu1 = browserGlobals.document.getElementById('qcContextMenu');
      menu1.style.display = 'block';
      const menu2 = browserGlobals.document.getElementById('qcSectionMenu');
      menu2.style.display = 'block';

      w.hideQcContextMenus();
      assertEqual(menu1.style.display, 'none');
      assertEqual(menu2.style.display, 'none');
    });

    it('hideQcContextMenus handles missing elements', () => {
      // Remove mock elements
      const origGetEl = browserGlobals.document.getElementById;
      browserGlobals.document.getElementById = (id) => {
        if (id === 'qcContextMenu' || id === 'qcSectionMenu') return null;
        return origGetEl(id);
      };
      // Should not throw
      w.hideQcContextMenus();
      browserGlobals.document.getElementById = origGetEl;
    });
  });

  // ===== Export =====
  describe('Quick Commands - Export', () => {
    it('exportQuickCommands alerts when no commands', () => {
      const origGet = browserGlobals.localStorage.getItem;
      browserGlobals.localStorage.getItem = () => JSON.stringify([]);
      let alertMsg = null;
      const origAlert = global.alert;
      global.alert = (msg) => {
        alertMsg = msg;
      };

      w.exportQuickCommands();
      assertTrue(alertMsg !== null);

      global.alert = origAlert;
      browserGlobals.localStorage.getItem = origGet;
    });

    it('exportQuickCommands creates download link when commands exist', () => {
      const origGet = browserGlobals.localStorage.getItem;
      browserGlobals.localStorage.getItem = () =>
        JSON.stringify([
          { id: 'qc_1', name: 'test', type: 'single', command: 'ps\\n' },
        ]);

      let clickCalled = false;
      const origCreateEl = browserGlobals.document.createElement;
      browserGlobals.document.createElement = (tag) => {
        const el = origCreateEl(tag);
        if (tag === 'a') {
          el.click = () => {
            clickCalled = true;
          };
        }
        return el;
      };

      // Mock URL.createObjectURL and revokeObjectURL
      const origURL = global.URL;
      global.URL = {
        createObjectURL: () => 'blob:test',
        revokeObjectURL: () => {},
      };

      w.exportQuickCommands();
      assertTrue(clickCalled);

      global.URL = origURL;
      browserGlobals.document.createElement = origCreateEl;
      browserGlobals.localStorage.getItem = origGet;
    });
  });

  // ===== Clear all =====
  describe('Quick Commands - Clear All', () => {
    it('clearAllQuickCommands does nothing when empty', () => {
      const origGet = browserGlobals.localStorage.getItem;
      browserGlobals.localStorage.getItem = () => JSON.stringify([]);
      // Should not throw or prompt
      w.clearAllQuickCommands();
      browserGlobals.localStorage.getItem = origGet;
    });

    it('clearAllQuickCommands clears on confirm', () => {
      const origGet = browserGlobals.localStorage.getItem;
      let savedValue = null;
      const origSet = browserGlobals.localStorage.setItem;
      browserGlobals.localStorage.getItem = () =>
        JSON.stringify([{ id: 'qc_1', name: 'test' }]);
      browserGlobals.localStorage.setItem = (k, v) => {
        savedValue = v;
      };
      const origConfirm = browserGlobals.confirm;
      browserGlobals.confirm = () => true;

      w.clearAllQuickCommands();
      assertEqual(savedValue, '[]');

      browserGlobals.confirm = origConfirm;
      browserGlobals.localStorage.setItem = origSet;
      browserGlobals.localStorage.getItem = origGet;
    });

    it('clearAllQuickCommands does not clear on cancel', () => {
      const origGet = browserGlobals.localStorage.getItem;
      let setCalled = false;
      const origSet = browserGlobals.localStorage.setItem;
      browserGlobals.localStorage.getItem = () =>
        JSON.stringify([{ id: 'qc_1', name: 'test' }]);
      browserGlobals.localStorage.setItem = () => {
        setCalled = true;
      };
      const origConfirm = global.confirm;
      global.confirm = () => false;

      w.clearAllQuickCommands();
      assertFalse(setCalled);

      global.confirm = origConfirm;
      browserGlobals.localStorage.setItem = origSet;
      browserGlobals.localStorage.getItem = origGet;
    });
  });

  // ===== Duplicate =====
  describe('Quick Commands - Duplicate', () => {
    it('duplicateQuickCommand creates a copy with new ID', () => {
      const cmds = [
        {
          id: 'qc_1',
          name: 'test',
          type: 'single',
          command: 'ps\\n',
          group: null,
        },
      ];
      const origGet = browserGlobals.localStorage.getItem;
      let savedValue = null;
      const origSet = browserGlobals.localStorage.setItem;
      browserGlobals.localStorage.getItem = () => JSON.stringify(cmds);
      browserGlobals.localStorage.setItem = (k, v) => {
        savedValue = v;
      };

      w.duplicateQuickCommand('qc_1');
      const saved = JSON.parse(savedValue);
      assertEqual(saved.length, 2);
      assertTrue(saved[1].id !== 'qc_1');
      assertTrue(saved[1].name.includes('copy'));

      browserGlobals.localStorage.setItem = origSet;
      browserGlobals.localStorage.getItem = origGet;
    });

    it('duplicateQuickCommand does nothing for unknown ID', () => {
      const origGet = browserGlobals.localStorage.getItem;
      let setCalled = false;
      const origSet = browserGlobals.localStorage.setItem;
      browserGlobals.localStorage.getItem = () => JSON.stringify([]);
      browserGlobals.localStorage.setItem = () => {
        setCalled = true;
      };

      w.duplicateQuickCommand('nonexistent');
      assertFalse(setCalled);

      browserGlobals.localStorage.setItem = origSet;
      browserGlobals.localStorage.getItem = origGet;
    });
  });

  // ===== Delete =====
  describe('Quick Commands - Delete', () => {
    it('deleteQuickCommand removes command on confirm', () => {
      const cmds = [
        { id: 'qc_1', name: 'test' },
        { id: 'qc_2', name: 'keep' },
      ];
      const origGet = browserGlobals.localStorage.getItem;
      let savedValue = null;
      const origSet = browserGlobals.localStorage.setItem;
      browserGlobals.localStorage.getItem = () => JSON.stringify(cmds);
      browserGlobals.localStorage.setItem = (k, v) => {
        savedValue = v;
      };
      const origConfirm = browserGlobals.confirm;
      browserGlobals.confirm = () => true;

      w.deleteQuickCommand('qc_1');
      const saved = JSON.parse(savedValue);
      assertEqual(saved.length, 1);
      assertEqual(saved[0].id, 'qc_2');

      browserGlobals.confirm = origConfirm;
      browserGlobals.localStorage.setItem = origSet;
      browserGlobals.localStorage.getItem = origGet;
    });

    it('deleteQuickCommand does not remove on cancel', () => {
      const cmds = [{ id: 'qc_1', name: 'test' }];
      const origGet = browserGlobals.localStorage.getItem;
      let setCalled = false;
      const origSet = browserGlobals.localStorage.setItem;
      browserGlobals.localStorage.getItem = () => JSON.stringify(cmds);
      browserGlobals.localStorage.setItem = () => {
        setCalled = true;
      };
      const origConfirm = global.confirm;
      global.confirm = () => false;

      w.deleteQuickCommand('qc_1');
      assertFalse(setCalled);

      global.confirm = origConfirm;
      browserGlobals.localStorage.setItem = origSet;
      browserGlobals.localStorage.getItem = origGet;
    });

    it('deleteQuickCommand does nothing for unknown ID', () => {
      const origGet = browserGlobals.localStorage.getItem;
      browserGlobals.localStorage.getItem = () => JSON.stringify([]);
      // Should not throw or prompt
      w.deleteQuickCommand('nonexistent');
      browserGlobals.localStorage.getItem = origGet;
    });
  });

  // ===== Test Run =====
  describe('Quick Commands - Test Run', () => {
    it('testRunQuickCommand returns early if not connected', () => {
      w.FPBState.isConnected = false;
      // Should not throw
      w.testRunQuickCommand();
    });
  });
};
