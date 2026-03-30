# TX 分片参数自适应设计方案

## 1. 现状分析

### 1.1 问题描述

部分串口驱动（尤其是 USB-CDC 虚拟串口）在一次性写入大量数据时会丢包。FPBInject 提供了 TX 分片（fragmentation）作为 workaround：

| 参数 | 配置项 | 默认值 | 说明 |
|------|--------|--------|------|
| 发送分片大小 | `serial_tx_fragment_size` | 0（禁用） | 每次 `ser.write()` 的最大字节数 |
| 发送分片延迟 | `serial_tx_fragment_delay` | 2ms | 分片之间的等待时间 |

当 `serial_tx_fragment_size > 0` 时，`send_cmd()` 会将命令拆成多个小块发送：

```python
# serial_protocol.py send_cmd()
if tx_fragment_size > 0 and len(data_bytes) > tx_fragment_size:
    for i in range(0, len(data_bytes), tx_fragment_size):
        chunk = data_bytes[i : i + tx_fragment_size]
        ser.write(chunk)
        ser.flush()
        time.sleep(tx_fragment_delay)
```

### 1.2 用户痛点

1. **默认禁用**：`serial_tx_fragment_size=0`，对于负载能力弱的串口，首次连接后注入直接失败
2. **需要手动调参**：用户必须先运行"吞吐测试"，发现 Phase 1 报 `fragment needed`，然后手动去配置面板设置分片大小和延迟
3. **吞吐测试不自动探测最优分片参数**：Phase 1 只检测"是否需要分片"（256B echo 是否成功），不探测最优分片大小
4. **参数不持久化到测试结果**：吞吐测试的"应用推荐参数"只设置 upload/download chunk size，不设置 TX fragment 参数

### 1.3 吞吐测试三阶段现状

| 阶段 | 测试内容 | 输出 | 问题 |
|------|---------|------|------|
| Phase 1 | 256B echo 是否成功 | `fragment_needed: bool` | 只判断是否需要，不探测最优值 |
| Phase 2 | 递增 echo 找设备缓冲区上限 | `recommended_upload_chunk_size` | ✅ 正常 |
| Phase 3 | 递增 echoback 找下载上限 | `recommended_download_chunk_size` | ✅ 正常 |

### 1.4 关键观察

Phase 1 失败时，Phase 2 也必然失败（因为 Phase 2 的 echo 命令同样需要大块写入）。当前代码在 Phase 1 失败后仍然执行 Phase 2，Phase 2 从 16B 开始也会失败，最终返回 `recommended_upload_chunk_size=0`。

实际上 Phase 1 失败意味着：**不是设备缓冲区小，而是 PC→设备的串口驱动本身就丢数据**。这时候需要的不是减小 upload chunk，而是启用 TX 分片。

## 2. 设计方案

### 2.1 核心思路

在 Phase 1 检测到 `fragment_needed=true` 时，自动探测最优 TX 分片参数，然后用分片模式重新执行 Phase 2/3。

### 2.2 新增 Phase 1.5：TX 分片参数探测

当 Phase 1 的 256B echo 失败时，插入一个探测阶段：

```
Phase 1:   256B echo → 失败 → fragment_needed=true
Phase 1.5: 探测最优 fragment_size 和 fragment_delay
Phase 2:   用探测到的分片参数重新测试 upload chunk
Phase 3:   用探测到的分片参数测试 download chunk
```

#### Phase 1.5 探测算法

```python
def _phase_fragment_size_probe(self, timeout=2.0):
    """探测最优 TX 分片大小和延迟。

    策略：固定 delay=5ms，从大到小尝试 fragment_size，
    找到能让 256B echo 成功的最大 fragment_size。
    然后固定 fragment_size，从小到大尝试减小 delay。
    """
    test_delay = 0.005  # 5ms 起步，保守值
    test_sizes = [128, 64, 32, 16, 8]  # 从大到小

    # Step 1: 找最大可用 fragment_size
    best_size = 0
    for size in test_sizes:
        self.device.serial_tx_fragment_size = size
        self.device.serial_tx_fragment_delay = test_delay
        probe = self._probe_echo(256, timeout=timeout)
        if probe["passed"]:
            best_size = size
            break

    if best_size == 0:
        # 所有分片大小都失败，串口可能有更严重的问题
        self.device.serial_tx_fragment_size = 0
        return {"success": False, "error": "All fragment sizes failed"}

    # Step 2: 固定 fragment_size，尝试减小 delay
    best_delay = test_delay
    test_delays = [0.003, 0.002, 0.001]  # 逐步减小
    for delay in test_delays:
        self.device.serial_tx_fragment_delay = delay
        # 多次验证稳定性
        passed = all(
            self._probe_echo(256, timeout=timeout)["passed"]
            for _ in range(3)
        )
        if passed:
            best_delay = delay
        else:
            break

    return {
        "success": True,
        "recommended_fragment_size": best_size,
        "recommended_fragment_delay": best_delay,
    }
```

### 2.3 修改 `test_serial_throughput` 主流程

```python
def test_serial_throughput(self, ...):
    # Phase 1: TX Fragment probe
    frag = self._phase_fragment_probe(timeout=timeout)
    results["fragment_needed"] = frag["needed"]

    if frag["needed"]:
        # Phase 1.5: 探测最优分片参数
        frag_params = self._phase_fragment_size_probe(timeout=timeout)
        results["phases"]["fragment_probe"] = frag_params

        if frag_params["success"]:
            # 应用探测到的参数，后续 Phase 2/3 使用分片模式
            self.device.serial_tx_fragment_size = frag_params["recommended_fragment_size"]
            self.device.serial_tx_fragment_delay = frag_params["recommended_fragment_delay"]
            results["recommended_fragment_size"] = frag_params["recommended_fragment_size"]
            results["recommended_fragment_delay"] = frag_params["recommended_fragment_delay"]
        else:
            results["success"] = False
            results["error"] = "TX fragmentation probe failed"
            return results

    # Phase 2: Upload chunk probe (now works with fragmentation if needed)
    upload = self._phase_upload_probe(...)

    # Phase 3: Download chunk probe
    download = self._phase_download_probe(...)
```

### 2.4 前端"应用推荐参数"增加分片参数

当前 `fpbTestSerial` 只应用 upload/download chunk size。改为同时应用分片参数：

```javascript
if (apply) {
    const uploadInput = document.getElementById('uploadChunkSize');
    const downloadInput = document.getElementById('downloadChunkSize');
    if (uploadInput) uploadInput.value = recUpload;
    if (downloadInput) downloadInput.value = recDownload;

    // 新增：应用 TX 分片参数
    if (data.recommended_fragment_size) {
        const fragInput = document.getElementById('serialTxFragmentSize');
        const delayInput = document.getElementById('serialTxFragmentDelay');
        if (fragInput) fragInput.value = data.recommended_fragment_size;
        if (delayInput) delayInput.value = data.recommended_fragment_delay * 1000; // ms
    }

    await saveConfig(true);
}
```

### 2.5 连接后自动探测（可选增强）

在首次连接成功后，自动执行一次轻量级 fragment 探测（只做 Phase 1），如果检测到需要分片，自动设置参数并提示用户：

```python
# connection.py api_connect() 连接成功后
if device.serial_tx_fragment_size == 0:
    # 快速检测是否需要分片（单次 256B echo）
    protocol = FPBProtocol(device)
    probe = protocol._probe_echo(256, timeout=1.0)
    if not probe["passed"]:
        # 自动设置保守的分片参数
        device.serial_tx_fragment_size = 64
        device.serial_tx_fragment_delay = 0.005
        return jsonify({
            "success": True,
            "port": port,
            "warning": "fragment_auto_enabled",
            "fragment_size": 64,
            "fragment_delay": 5,
        })
```

前端收到 `warning: "fragment_auto_enabled"` 时提示：

> 检测到串口需要发送分片，已自动设置 TX Fragment=64B, Delay=5ms。
> 建议运行"吞吐测试"获取最优参数。

## 3. 改动文件清单

| 文件 | 改动 | 工作量 |
|------|------|--------|
| `core/serial_protocol.py` | 新增 `_phase_fragment_size_probe()`；修改 `test_serial_throughput()` 流程 | 中 |
| `app/routes/fpb.py` | `api_fpb_test_serial` 返回新增字段 | 小 |
| `static/js/features/fpb.js` | `fpbTestSerial` 应用分片参数；显示探测结果 | 小 |
| `app/routes/connection.py` | 连接后自动 fragment 探测（可选） | 中 |
| `static/js/core/connection.js` | 处理 `fragment_auto_enabled` warning | 小 |
| `static/js/locales/*.js` | 新增提示文本 i18n | 小 |
| `tests/test_serial_protocol.py` | Phase 1.5 探测测试 | 中 |
| `tests/test_fpb_routes.py` | 吞吐测试返回值测试 | 小 |

总计约 4h。

## 4. 用户体验对比

### 改造前（负载能力弱的串口）

1. 连接设备 ✅
2. 点击注入 → 失败 ❌（串口丢数据）
3. 用户困惑，不知道原因
4. 手动运行吞吐测试 → 看到 "fragment needed"
5. 手动去配置面板设置 TX Fragment=64, Delay=5ms
6. 再次注入 → 成功 ✅

### 改造后

1. 连接设备 → 自动检测到需要分片 → 自动设置保守参数 → 提示用户 ✅
2. 点击注入 → 成功 ✅（使用自动设置的分片参数）
3. （可选）运行吞吐测试 → 自动探测最优分片参数 → 一键应用 ✅

## 5. 不变的部分

- 分片机制本身（`send_cmd` 里的分片逻辑）不改
- 对于不需要分片的串口（大多数情况），行为完全不变
- 配置面板的手动设置入口保留，高级用户仍可手动调参
- Phase 2/3 的探测算法不变
