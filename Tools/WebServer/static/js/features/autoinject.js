/*========================================
  FPBInject Workbench - Auto-Inject Polling Module
  ========================================*/

/* ===========================
   REINJECT CACHE
   =========================== */

// Cache of successfully injected file paths (Set for auto-dedup)
let injectedFilePaths = new Set();

// Called when auto-inject succeeds - cache the file path
function onAutoInjectSuccess(filePath) {
  if (filePath) {
    injectedFilePaths.add(filePath);
    updateReinjectButton();
  }
}

// Clear the inject cache
function clearInjectedPaths() {
  injectedFilePaths.clear();
  updateReinjectButton();
}

// Get count of cached paths
function getInjectedPathCount() {
  return injectedFilePaths.size;
}

// Update reinject button visibility and tooltip
function updateReinjectButton() {
  const btn = document.getElementById('btn-reinject');
  if (!btn) return;

  const count = injectedFilePaths.size;
  btn.disabled = count === 0;
  btn.title = t('tooltips.reinject_all', { count });
}

// Re-inject all cached files
async function reinjectAll() {
  const paths = Array.from(injectedFilePaths);

  if (paths.length === 0) {
    alert(t('messages.no_inject_cache'));
    return;
  }

  // Confirm with user
  const confirmMsg = t('messages.confirm_reinject', { count: paths.length });
  if (!confirm(confirmMsg)) {
    return;
  }

  log.info(`Re-injecting ${paths.length} file(s)...`);

  let successCount = 0;
  let failCount = 0;

  for (const filePath of paths) {
    try {
      await triggerAutoInject(filePath);
      successCount++;
    } catch (e) {
      log.error(`Re-inject failed: ${filePath} - ${e.message}`);
      failCount++;
    }
  }

  // Show result only if there are failures
  if (failCount > 0) {
    alert(
      t('messages.reinject_partial', {
        success: successCount,
        fail: failCount,
      }),
    );
  }
}

// Trigger auto-inject for a specific file (reuse existing backend flow)
async function triggerAutoInject(filePath) {
  const response = await fetch('/api/autoinject/trigger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_path: filePath }),
  });

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || 'Unknown error');
  }
  return result;
}

/* ===========================
   AUTO-INJECT STATUS POLLING
   =========================== */
function startAutoInjectPolling() {
  const state = window.FPBState;
  if (state.autoInjectPollInterval) return;

  state.autoInjectPollInterval = setInterval(pollAutoInjectStatus, 500);
  log.debug('Auto-inject status monitoring started');
}

function stopAutoInjectPolling() {
  const state = window.FPBState;
  if (state.autoInjectPollInterval) {
    clearInterval(state.autoInjectPollInterval);
    state.autoInjectPollInterval = null;
    log.debug('Auto-inject status monitoring stopped');
  }
}

async function pollAutoInjectStatus() {
  const state = window.FPBState;
  try {
    const res = await fetch('/api/watch/auto_inject_status');
    const data = await res.json();

    if (!data.success) return;

    const status = data.status;
    const message = data.message;
    const progress = data.progress || 0;
    const speed = data.speed || 0;
    const eta = data.eta || 0;
    const modifiedFuncs = data.modified_funcs || [];
    const result = data.result || {};
    const sourceFile = data.source_file || null;

    const statusChanged = status !== state.lastAutoInjectStatus;

    if (statusChanged) {
      state.lastAutoInjectStatus = status;

      switch (status) {
        case 'detecting':
          writeToOutput(`[AUTO-INJECT] ${message}`, 'system');
          break;
        case 'generating':
          writeToOutput(`[AUTO-INJECT] ${message}`, 'info');
          if (modifiedFuncs.length > 0) {
            document.getElementById('targetFunc').value = modifiedFuncs[0];
          }
          break;
        case 'compiling':
          writeToOutput(`[AUTO-INJECT] ${message}`, 'info');
          if (modifiedFuncs.length > 0) {
            createPatchPreviewTab(modifiedFuncs[0], sourceFile);
          }
          break;
        case 'injecting':
          writeToOutput(`[AUTO-INJECT] ${message}`, 'info');
          break;
        case 'cancelled':
          writeToOutput(`[AUTO-INJECT] ${message}`, 'warning');
          break;
        case 'success':
          writeToOutput(`[AUTO-INJECT] ${message}`, 'success');
          if (result && Object.keys(result).length > 0) {
            displayAutoInjectStats(result, modifiedFuncs[0] || 'unknown');
          }
          if (modifiedFuncs.length > 0) {
            createPatchPreviewTab(modifiedFuncs[0], sourceFile);
          }
          // Cache the successfully injected file path
          if (sourceFile) {
            onAutoInjectSuccess(sourceFile);
          }
          updateSlotUI();
          fpbInfo();
          break;
        case 'failed':
          writeToOutput(`[AUTO-INJECT] ${message}`, 'error');
          break;
        case 'idle':
          break;
      }

      if (status === 'generating' || status === 'success') {
        await loadPatchSourceFromBackend();
      }
    }

    updateAutoInjectProgress(
      progress,
      status,
      statusChanged,
      speed,
      eta,
      message,
    );
  } catch (e) {
    // Silent error
  }
}

function displayAutoInjectStats(result, targetFunc) {
  const compileTime = result.compile_time || 0;
  const uploadTime = result.upload_time || 0;
  const codeSize = result.code_size || 0;
  const totalTime = result.total_time || compileTime + uploadTime;
  const uploadSpeed = uploadTime > 0 ? Math.round(codeSize / uploadTime) : 0;
  const patchMode = result.patch_mode || 'unknown';

  writeToOutput(`--- Auto-Injection Statistics ---`, 'system');

  const injections = result.injections || [];
  if (injections.length > 0) {
    const successCount = result.successful_count || 0;
    const totalCount = result.total_count || injections.length;
    writeToOutput(
      `Functions:     ${successCount}/${totalCount} injected successfully`,
      'info',
    );

    const failedInjections = [];

    for (const inj of injections) {
      const status = inj.success ? '✓' : '✗';
      const slotInfo = inj.slot >= 0 ? `[Slot ${inj.slot}]` : '';
      writeToOutput(
        `  ${status} ${inj.target_func || 'unknown'} @ ${inj.target_addr || '?'} -> ${inj.inject_func || '?'} @ ${inj.inject_addr || '?'} ${slotInfo}`,
        inj.success ? 'info' : 'error',
      );

      if (!inj.success) {
        failedInjections.push({
          func: inj.target_func || 'unknown',
          error: inj.error || 'Unknown error',
        });
      }
    }

    if (failedInjections.length > 0) {
      const isSlotFull =
        failedInjections.some(
          (f) =>
            f.error.toLowerCase().includes('slot') ||
            f.error.toLowerCase().includes('no free') ||
            f.error.toLowerCase().includes('occupied'),
        ) || successCount < totalCount;

      const failedList = failedInjections
        .map((f) => `  • ${f.func}: ${f.error}`)
        .join('\n');

      let message =
        `⚠️ ${t('messages.injection_failed_count', '{{count}} injection(s) failed!', { count: failedInjections.length })}\n\n` +
        `${t('messages.failed_functions', 'Failed functions')}:\n${failedList}\n\n`;

      if (isSlotFull) {
        message +=
          `${t('messages.slots_full_hint', 'This may be due to FPB Slots being full.')}\n` +
          t(
            'messages.clear_slots_hint',
            'Please clear some Slots in DEVICE INFO panel and try again.',
          );
      }

      setTimeout(() => {
        alert(message);
        const deviceDetails = document.getElementById('details-device');
        if (deviceDetails) {
          deviceDetails.open = true;
        }
      }, 100);
    }
  } else {
    writeToOutput(
      `Target:        ${targetFunc} @ ${result.target_addr || 'unknown'}`,
      'info',
    );
    writeToOutput(
      `Inject func:   ${result.inject_func || 'unknown'} @ ${result.inject_addr || 'unknown'}`,
      'info',
    );
    if (result.slot !== undefined) {
      writeToOutput(`Slot:          ${result.slot}`, 'info');
    }
  }

  writeToOutput(`Compile time:  ${compileTime.toFixed(2)}s`, 'info');
  writeToOutput(
    `Upload time:   ${uploadTime.toFixed(2)}s (${uploadSpeed} B/s)`,
    'info',
  );
  writeToOutput(`Code size:     ${codeSize} bytes`, 'info');
  writeToOutput(`Total time:    ${totalTime.toFixed(2)}s`, 'info');
  writeToOutput(`Injection mode: ${patchMode}`, 'success');
}

async function loadPatchSourceFromBackend() {
  try {
    const res = await fetch('/api/patch/source');
    const data = await res.json();
    if (data.success && data.content) {
      const patchSourceEl = document.getElementById('patchSource');
      if (patchSourceEl && patchSourceEl.value !== data.content) {
        patchSourceEl.value = data.content;
        writeToOutput('[AUTO-INJECT] Patch source updated in editor', 'info');
      }
      return data.content;
    }
  } catch (e) {
    // Silent error
  }
  return null;
}

async function createPatchPreviewTab(funcName, sourceFile = null) {
  const state = window.FPBState;
  let baseName = funcName;
  if (sourceFile) {
    baseName = sourceFile
      .split('/')
      .pop()
      .replace(/\.[^.]+$/, '');
  }
  const tabId = `patch_${baseName}`;
  const tabTitle = `patch_${baseName}.c`;

  let patchContent = '';
  try {
    const res = await fetch('/api/patch/source');
    const data = await res.json();
    if (data.success && data.content) {
      patchContent = data.content;
    }
  } catch (e) {
    patchContent = `// Failed to load patch content for ${funcName}`;
  }

  const existingTab = state.editorTabs.find((t) => t.id === tabId);
  if (existingTab) {
    const existingContent = document.getElementById(`tabContent_${tabId}`);
    if (existingContent) {
      const codeEl = existingContent.querySelector('code');
      if (codeEl) {
        codeEl.textContent = patchContent;
        if (typeof hljs !== 'undefined') {
          hljs.highlightElement(codeEl);
        }
      }
    }
    switchEditorTab(tabId);
    return;
  }

  state.editorTabs.push({
    id: tabId,
    title: tabTitle,
    type: 'preview',
    closable: true,
  });

  const tabsHeader = document.getElementById('editorTabsHeader');
  const tabDiv = document.createElement('div');
  tabDiv.className = 'tab';
  tabDiv.setAttribute('data-tab', tabId);
  tabDiv.innerHTML = `
    <i class="codicon codicon-file-code tab-icon" style="color: #519aba;"></i>
    <span>${tabTitle}</span>
    <span class="tab-badge" style="background: #4caf50; color: white; font-size: 9px; padding: 1px 4px; border-radius: 3px; margin-left: 4px;">Preview</span>
    <div class="tab-close" onclick="closeTab('${tabId}', event)"><i class="codicon codicon-close"></i></div>
  `;
  tabDiv.onclick = () => switchEditorTab(tabId);
  tabsHeader.appendChild(tabDiv);

  const tabsContent = document.querySelector('.editor-tabs-content');
  const contentDiv = document.createElement('div');
  contentDiv.className = 'tab-content';
  contentDiv.id = `tabContent_${tabId}`;

  contentDiv.innerHTML = `
    <div class="code-display" style="height: 100%; overflow: auto;">
      <div style="padding: 4px 8px; background: var(--vscode-editorWidget-background); border-bottom: 1px solid var(--vscode-panel-border); font-size: 11px; color: var(--vscode-descriptionForeground);">
        <i class="codicon codicon-lock" style="margin-right: 4px;"></i>
        ${t('messages.auto_generated_patch_preview', 'Auto-generated patch (read-only preview)')}
      </div>
      <pre style="margin: 0; padding: 8px; height: calc(100% - 30px); overflow: auto;"><code class="language-c">${escapeHtml(patchContent)}</code></pre>
    </div>
  `;
  tabsContent.appendChild(contentDiv);

  if (typeof hljs !== 'undefined') {
    contentDiv.querySelectorAll('pre code').forEach((block) => {
      try {
        hljs.highlightElement(block);
      } catch (e) {
        block.classList.add('hljs');
      }
    });
  }

  switchEditorTab(tabId);
  writeToOutput(`[AUTO-INJECT] Created preview tab: ${tabTitle}`, 'info');
}

function updateAutoInjectProgress(
  progress,
  status,
  statusChanged = false,
  speed = 0,
  eta = 0,
  message = '',
) {
  const state = window.FPBState;
  const allProgressEls = document.querySelectorAll('.inject-progress');

  if (status === 'idle') return;

  // For terminal states (success/failed/cancelled), only update UI on the initial
  // status change. Subsequent polls with the same status must not re-show
  // the progress bar — neither while the hide timer is running, nor after
  // it has already fired and hidden the bar.
  if (
    (status === 'success' || status === 'failed' || status === 'cancelled') &&
    !statusChanged
  )
    return;

  // Show/hide cancel button during active injection
  const cancelBtn = document.getElementById('injectCancelBtn');
  const isActive =
    status === 'compiling' ||
    status === 'injecting' ||
    status === 'detecting' ||
    status === 'generating';
  if (cancelBtn) cancelBtn.style.display = isActive ? 'inline-block' : 'none';

  allProgressEls.forEach((progressEl) => {
    const progressText = progressEl.querySelector(
      '#injectProgressText, .progress-text',
    );
    const progressFill = progressEl.querySelector(
      '#injectProgressFill, .progress-fill',
    );

    if (!progressEl || !progressFill) return;

    progressEl.style.display = 'flex';
    progressFill.style.width = `${progress}%`;

    if (status === 'success') {
      if (progressText)
        progressText.textContent = t(
          'statusbar.auto_inject_complete',
          'Auto-inject complete!',
        );
      progressFill.style.background = '#4caf50';
    } else if (status === 'failed') {
      if (progressText)
        progressText.textContent = t(
          'statusbar.auto_inject_failed',
          'Auto-inject failed!',
        );
      progressFill.style.background = '#f44336';
    } else if (status === 'cancelled') {
      if (progressText)
        progressText.textContent = t('statusbar.cancelled', 'Cancelled');
      progressFill.style.background = '#ff9800';
    } else if (status === 'injecting') {
      // Show function name + speed and ETA during upload phase
      const speedStr =
        speed > 0
          ? typeof window._formatInjectSpeed === 'function'
            ? window._formatInjectSpeed(speed)
            : typeof formatSpeed === 'function'
              ? formatSpeed(speed)
              : `${Math.round(speed)} B/s`
          : '';
      const etaStr = eta > 0 ? `ETA ${eta.toFixed(1)}s` : '';
      const parts = [message || t('statusbar.injecting', 'Injecting...')];
      if (speedStr) parts.push(speedStr);
      if (etaStr) parts.push(etaStr);
      if (progressText) progressText.textContent = parts.join('  ');
      progressFill.style.background = '';
    } else {
      const statusKey = `statusbar.${status}`;
      if (progressText) progressText.textContent = t(statusKey, status);
      progressFill.style.background = '';
    }
  });

  if (status === 'success' || status === 'failed' || status === 'cancelled') {
    if (statusChanged) {
      if (state.autoInjectProgressHideTimer)
        clearTimeout(state.autoInjectProgressHideTimer);
      state.autoInjectProgressHideTimer = setTimeout(() => {
        allProgressEls.forEach((el) => {
          el.style.display = 'none';
          const fill = el.querySelector('#injectProgressFill, .progress-fill');
          if (fill) {
            fill.style.width = '0%';
            fill.style.background = '';
          }
        });
        state.autoInjectProgressHideTimer = null;
      }, 3000);
    }
  } else {
    if (state.autoInjectProgressHideTimer) {
      clearTimeout(state.autoInjectProgressHideTimer);
      state.autoInjectProgressHideTimer = null;
    }
  }
}

// Export for global access
window.startAutoInjectPolling = startAutoInjectPolling;
window.stopAutoInjectPolling = stopAutoInjectPolling;
window.pollAutoInjectStatus = pollAutoInjectStatus;
window.displayAutoInjectStats = displayAutoInjectStats;
window.loadPatchSourceFromBackend = loadPatchSourceFromBackend;
window.createPatchPreviewTab = createPatchPreviewTab;
window.updateAutoInjectProgress = updateAutoInjectProgress;
window.onAutoInjectSuccess = onAutoInjectSuccess;
window.clearInjectedPaths = clearInjectedPaths;
window.getInjectedPathCount = getInjectedPathCount;
window.updateReinjectButton = updateReinjectButton;
window.reinjectAll = reinjectAll;
window.triggerAutoInject = triggerAutoInject;
