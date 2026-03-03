/*========================================
  FPBInject Workbench - Log Polling Module
  ========================================*/

/* ===========================
   SSE (Server-Sent Events) STREAMING
   =========================== */
let logEventSource = null;
let sseRetryCount = 0;
const SSE_MAX_RETRIES = 3;

function startLogStreaming() {
  const state = window.FPBState;
  stopLogStreaming();
  state.toolLogNextId = 0;
  state.rawLogNextId = 0;
  state.slotUpdateId = 0;

  try {
    logEventSource = new EventSource('/api/logs/stream');

    logEventSource.onopen = function () {
      // SSE connected, stop any polling fallback and reset retry count
      stopLogPolling();
      state.logStreamActive = true;
      sseRetryCount = 0;
    };

    logEventSource.onmessage = function (event) {
      try {
        const data = JSON.parse(event.data);
        processLogData(data);
      } catch (e) {
        console.warn('SSE parse error:', e);
      }
    };

    logEventSource.addEventListener('close', function () {
      stopLogStreaming();
    });

    logEventSource.onerror = function () {
      sseRetryCount++;
      stopLogStreaming();
      if (sseRetryCount >= SSE_MAX_RETRIES) {
        // Fall back to polling after max retries
        console.log('SSE failed, falling back to polling');
        startLogPolling();
      } else {
        // Auto-retry SSE connection
        setTimeout(startLogStreaming, 500);
      }
    };
  } catch (e) {
    // SSE not supported, use polling
    startLogPolling();
  }
}

function stopLogStreaming() {
  const state = window.FPBState;
  if (logEventSource) {
    logEventSource.close();
    logEventSource = null;
  }
  state.logStreamActive = false;
}

/* ===========================
   LOG POLLING (FALLBACK)
   =========================== */
function startLogPolling() {
  const state = window.FPBState;
  stopLogPolling();
  state.toolLogNextId = 0;
  state.rawLogNextId = 0;
  state.slotUpdateId = 0;
  state.logPollInterval = setInterval(fetchLogs, 100);
}

function stopLogPolling() {
  const state = window.FPBState;
  if (state.logPollInterval) {
    clearInterval(state.logPollInterval);
    state.logPollInterval = null;
  }
}

function processLogData(data) {
  const state = window.FPBState;

  if (data.tool_next !== undefined) state.toolLogNextId = data.tool_next;
  if (data.raw_next !== undefined) state.rawLogNextId = data.raw_next;

  if (
    data.tool_logs &&
    Array.isArray(data.tool_logs) &&
    data.tool_logs.length > 0
  ) {
    data.tool_logs.forEach((logMsg) => {
      writeToOutput(logMsg, 'info');
    });
  }

  if (data.raw_data && data.raw_data.length > 0) {
    writeToSerial(data.raw_data);
  }

  if (
    data.slot_update_id !== undefined &&
    data.slot_update_id > state.slotUpdateId
  ) {
    state.slotUpdateId = data.slot_update_id;
    if (data.slot_data) {
      if (data.slot_data.fpb_version !== undefined) {
        state.fpbVersion = data.slot_data.fpb_version;
      }
      if (data.slot_data.slots) {
        data.slot_data.slots.forEach((slot) => {
          const slotId = slot.id !== undefined ? slot.id : 0;
          if (slotId < 8) {
            state.slotStates[slotId] = {
              occupied: slot.occupied || false,
              func: slot.func || '',
              orig_addr: slot.orig_addr || '',
              target_addr: slot.target_addr || '',
              code_size: slot.code_size || 0,
            };
          }
        });
        updateSlotUI();
        if (data.slot_data.memory) {
          updateMemoryInfo(data.slot_data.memory);
        }
      }
    }
  }
}

async function fetchLogs() {
  const state = window.FPBState;
  try {
    const res = await fetch(
      `/api/logs?tool_since=${state.toolLogNextId}&raw_since=${state.rawLogNextId}&slot_since=${state.slotUpdateId}`,
    );

    if (!res.ok) return;

    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) return;

    const text = await res.text();
    if (!text || text.trim() === '') return;

    let data;
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      console.warn(
        'Log parse error:',
        parseError,
        'Response:',
        text.substring(0, 100),
      );
      return;
    }

    processLogData(data);
  } catch (e) {
    // Silently fail on polling errors
  }
}

// Export for global access
window.startLogPolling = startLogPolling;
window.stopLogPolling = stopLogPolling;
window.fetchLogs = fetchLogs;
window.startLogStreaming = startLogStreaming;
window.stopLogStreaming = stopLogStreaming;
window.processLogData = processLogData;
