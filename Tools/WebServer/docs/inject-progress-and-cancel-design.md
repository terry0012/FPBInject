# 注入进度增强：速度/ETA/取消 设计方案

## 1. 现状分析

### 1.1 注入流程概览

```
前端 fpb.js                API fpb.py                  fpb_inject.py              serial_protocol.py
    │                          │                            │                          │
    ├─ POST /inject/stream ──► ├─ Thread + Queue ─────────► ├─ compile_inject() ──────►│
    │                          │  SSE progress_queue         │  (两次编译)               │
    │  onStatus(compiling) ◄── ├─ put({stage:compiling}) ◄──┤                          │
    │                          │                            ├─ alloc() ────────────────►├─ send_cmd()
    │                          │                            ├─ upload() ───────────────►├─ 逐 chunk 发送
    │  onProgress(%) ◄──────── ├─ put({uploaded,total}) ◄───┤  progress_callback() ◄───┤  每 chunk 回调
    │                          │                            ├─ tpatch/dpatch/patch ───►├─ send_cmd()
    │  onResult(success) ◄──── ├─ put({type:result}) ◄──────┤                          │
    │                          ├─ put(None) ◄───────────────┤                          │
```

### 1.2 当前 SSE 事件格式

```json
{"type": "status",   "stage": "compiling"}
{"type": "progress", "uploaded": 128, "total": 1024, "percent": 12.5}
{"type": "result",   "success": true, "compile_time": 0.5, "upload_time": 1.2, ...}
```

### 1.3 缺失项

| 功能 | 文件传输 (transfer.py) | 注入 (fpb.py) | 差距 |
|------|----------------------|---------------|------|
| 逐包进度 | ✅ | ✅ | — |
| 实时速度 (B/s) | ✅ speed 字段 | ❌ | 后端未计算 |
| ETA 估算 (秒) | ✅ eta 字段 | ❌ | 后端未计算 |
| 已用时间 | ✅ elapsed 字段 | ❌ | 后端未计算 |
| 取消操作 | ✅ /transfer/cancel + AbortController | ❌ | 完全没有 |
| 丢包率统计 | ✅ stats 字段 | ❌ | 底层有但未暴露 |

### 1.4 底层能力

`serial_protocol.py` 的 `upload()` 方法已经：
- 按 chunk 循环发送，每个 chunk 后调用 `progress_callback(data_offset, total)`
- 返回 `{"bytes", "chunks", "time", "speed"}` 统计

`app/utils/sse.py` 已有通用 `sse_response()` + 心跳 + 超时。

`static/js/core/sse.js` 已有通用 `consumeSSEStream()` + AbortController 支持。

**结论**：基础设施完备，只需在注入路由层补齐速度/ETA 计算和取消检查。

## 2. 设计方案

### 2.1 增强 progress 事件（速度 + ETA）

改造 `app/routes/fpb.py` 中 `api_fpb_inject_stream` 和 `api_fpb_inject_multi_stream` 的 `progress_callback`：

**改造前**：
```python
def progress_callback(uploaded, total):
    progress_queue.put({
        "type": "progress",
        "uploaded": uploaded,
        "total": total,
        "percent": round((uploaded / total) * 100, 1) if total > 0 else 0,
    })
```

**改造后**：
```python
import time as _time

upload_state = {"start_time": 0, "last_time": 0, "last_bytes": 0}

def progress_callback(uploaded, total):
    now = _time.time()

    # 首包初始化
    if upload_state["start_time"] == 0:
        upload_state["start_time"] = now
        upload_state["last_time"] = now
        upload_state["last_bytes"] = 0

    elapsed = now - upload_state["start_time"]
    interval = now - upload_state["last_time"]

    # 每 100ms 更新一次瞬时速度，避免抖动
    if interval > 0.1:
        speed = (uploaded - upload_state["last_bytes"]) / interval
        upload_state["last_time"] = now
        upload_state["last_bytes"] = uploaded
    else:
        speed = uploaded / elapsed if elapsed > 0 else 0

    remaining = total - uploaded
    eta = remaining / speed if speed > 0 else 0

    progress_queue.put({
        "type": "progress",
        "uploaded": uploaded,
        "total": total,
        "percent": round((uploaded / total) * 100, 1) if total > 0 else 0,
        "speed": round(speed, 1),
        "eta": round(eta, 1),
        "elapsed": round(elapsed, 1),
    })
```

这与 `transfer.py` 的 `api_transfer_upload` 中的速度/ETA 计算逻辑完全一致。

### 2.2 取消机制

#### 2.2.1 后端

参照 `transfer.py` 的 `_transfer_cancelled` 模式：

```python
# app/routes/fpb.py

_inject_cancelled = threading.Event()

@bp.route("/fpb/inject/cancel", methods=["POST"])
def api_fpb_inject_cancel():
    _inject_cancelled.set()
    log_info("Inject cancel requested")
    return jsonify({"success": True, "message": "Cancel requested"})
```

在 `inject_task` 中，将 cancel event 传入 `progress_callback`，每个 chunk 前检查：

```python
def progress_callback(uploaded, total):
    if _inject_cancelled.is_set():
        raise FPBInjectCancelled("Inject cancelled by user")
    # ... 正常的 speed/eta 计算 ...
```

`serial_protocol.py` 的 `upload()` 在 `progress_callback` 抛异常时会被外层 try/except 捕获，中断上传循环。

需要在 `inject_task` 的 `do_inject` 中捕获取消异常：

```python
def do_inject():
    _inject_cancelled.clear()  # 每次注入开始时清除
    fpb.enter_fl_mode()
    try:
        # ... 编译 ...

        success, result = fpb.inject(
            ..., progress_callback=progress_callback
        )

        if success:
            progress_queue.put({"type": "result", "success": True, **result})
        else:
            progress_queue.put({"type": "result", "success": False, **result})
    except FPBInjectCancelled:
        progress_queue.put({
            "type": "result",
            "success": False,
            "error": "Cancelled",
            "cancelled": True,
        })
    finally:
        fpb.exit_fl_mode()
        progress_queue.put(None)
```

#### 2.2.2 取消的安全性

注入过程中取消可能发生在三个阶段：

| 阶段 | 取消后果 | 安全性 |
|------|---------|--------|
| 编译中 | 编译进程被中断，无副作用 | ✅ 安全 |
| 上传中 | 设备 RAM 中有部分数据，但 FPB 未配置 | ✅ 安全（内存会在下次 alloc 时被覆盖） |
| FPB 配置中 | patch/tpatch/dpatch 是原子操作，不可中断 | ⚠️ 此阶段不检查取消 |

设计决策：**只在上传阶段的 chunk 间隙检查取消**，编译阶段也可检查（在两次 compile_inject 之间），FPB 配置阶段不检查。

#### 2.2.3 前端

在 `fpb.js` 的注入函数中添加 AbortController 和取消按钮：

```javascript
let injectAbortController = null;

async function fpbInjectStream() {
    injectAbortController = new AbortController();

    // 显示取消按钮
    showInjectCancelButton(true);

    try {
        const data = await consumeSSEStream(
            '/api/fpb/inject/stream',
            { method: 'POST', headers: {...}, body: ... },
            {
                onProgress(ev) {
                    updateInjectProgress(ev.percent, ev.speed, ev.eta);
                },
                onStatus(ev) { ... },
            },
            injectAbortController,
        );
    } catch (e) {
        if (e.name === 'AbortError') {
            // 用户取消，发送后端取消请求
            await fetch('/api/fpb/inject/cancel', { method: 'POST' });
            log.warn('Inject cancelled');
        }
    } finally {
        showInjectCancelButton(false);
        injectAbortController = null;
    }
}

function cancelInject() {
    if (injectAbortController) {
        injectAbortController.abort();
    }
}
```

### 2.3 前端进度条 UI 增强

当前进度条只显示百分比文字，改为显示速度和 ETA：

```
[████████░░░░░░░░░░░░] 45.2%  128 B/s  ETA 3.2s
```

改造 `onProgress` 回调：

```javascript
onProgress(ev) {
    const percent = ev.percent || 0;
    const speed = ev.speed || 0;
    const eta = ev.eta || 0;

    if (progressFill) progressFill.style.width = `${percent}%`;
    if (progressText) {
        const speedStr = formatSpeed(speed);     // "128 B/s" / "1.2 KB/s"
        const etaStr = eta > 0 ? `ETA ${eta.toFixed(1)}s` : '';
        progressText.textContent = `${percent.toFixed(1)}%  ${speedStr}  ${etaStr}`;
    }
}
```

`formatSpeed()` 已在 `transfer.js` 中实现，需要提取到公共位置或直接复用。

### 2.4 multi-inject 的取消与进度

multi-inject 在循环注入多个函数时，取消检查点更多：

```python
for idx, (target_func, inject_func) in enumerate(injection_targets):
    # 每个函数开始前检查取消
    if _inject_cancelled.is_set():
        progress_queue.put({
            "type": "result", "success": False,
            "error": "Cancelled", "cancelled": True,
            "successful_count": idx, "total_count": len(injection_targets),
        })
        break

    # ... 注入当前函数 ...
```

进度事件增加速度/ETA 后，前端 multi-inject 的 `onProgress` 也同步更新。

## 3. 改造文件清单

| 文件 | 改动 | 工作量 |
|------|------|--------|
| `app/routes/fpb.py` | progress_callback 增加 speed/eta/elapsed；新增 cancel 端点和 `_inject_cancelled` event；inject_task 中捕获取消异常 | 中 |
| `fpb_inject.py` | inject() 和 inject_multi() 在关键点检查 cancel callback（可选） | 小 |
| `static/js/features/fpb.js` | onProgress 显示 speed/eta；添加 AbortController + cancel 按钮逻辑 | 中 |
| `templates/partials/sidebar_fpb.html` | 进度条区域添加取消按钮 | 小 |
| `static/css/workbench.css` | 取消按钮样式 | 小 |

总计约 3h。

## 4. SSE 事件格式（改造后）

### 4.1 单函数注入 `/fpb/inject/stream`

```
← {"type":"status",   "stage":"compiling"}
← {"type":"progress", "uploaded":128,  "total":1024, "percent":12.5, "speed":256.0, "eta":3.5, "elapsed":0.5}
← {"type":"progress", "uploaded":256,  "total":1024, "percent":25.0, "speed":280.0, "eta":2.7, "elapsed":1.0}
← ...
← {"type":"result",   "success":true, "compile_time":0.5, "upload_time":1.2, "code_size":1024, ...}
```

取消时：
```
← {"type":"result", "success":false, "error":"Cancelled", "cancelled":true}
```

### 4.2 多函数注入 `/fpb/inject/multi/stream`

```
← {"type":"status",   "stage":"compiling"}
← {"type":"status",   "stage":"injecting", "index":0, "name":"func_a", "total":3}
← {"type":"progress", "uploaded":128, "total":512, "percent":25.0, "speed":200.0, "eta":1.5, "elapsed":0.6}
← ...
← {"type":"status",   "stage":"injecting", "index":1, "name":"func_b", "total":3}
← {"type":"progress", "uploaded":64,  "total":256, "percent":25.0, "speed":180.0, "eta":1.1, "elapsed":0.4}
← ...
← {"type":"result",   "success":true, "successful_count":3, "total_count":3, ...}
```

### 4.3 取消端点 `POST /fpb/inject/cancel`

```json
{"success": true, "message": "Cancel requested"}
```

## 5. 不变的部分

- 串口协议层 `serial_protocol.py` 不改动，`upload()` 的 `progress_callback` 签名不变
- 同步端点 `/fpb/inject` 和 `/fpb/inject/multi` 保持不变
- SSE 基础设施 `sse.py` 和 `sse.js` 不改动
- 文件传输模块不受影响
