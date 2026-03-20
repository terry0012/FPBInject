# CLI 与 WebServer GUI 共存整改方案

## 1. 现状分析

### 1.1 三套入口，三套独立状态

当前系统存在三个独立的入口点，各自维护独立的设备状态：

| 入口 | 文件 | 状态管理 | 串口生命周期 |
|------|------|----------|-------------|
| WebServer GUI | `main.py` | 全局单例 `AppState` (core/state.py) | 持久连接，auto-connect 恢复 |
| CLI | `cli/fpb_cli.py` | 局部 `DeviceState` 实例 | 一次性：连接→执行→断开 |
| MCP Server | `fpb_mcp_server.py` | 模块级 `_cli_instance` (复用 CLI) | 会话级持久连接 |

三者之间没有任何进程间通信机制，完全独立运行。

### 1.2 核心冲突：串口独占

串口是操作系统级独占资源，同一时刻只能被一个进程打开。

**冲突场景矩阵：**

| 场景 | 结果 | 原因 |
|------|------|------|
| CLI offline + WebServer 运行 | ✅ 无冲突 | CLI 仅做 ELF 分析，不碰串口 |
| CLI `--port X` + WebServer 连接同一端口 | ❌ 失败 | 串口独占，后来者 `serial.Serial()` 抛异常 |
| MCP `connect(X)` + WebServer 连接同一端口 | ❌ 失败 | 同上 |
| CLI `--port X` + MCP `connect(X)` | ❌ 失败 | 同上 |
| CLI `--port X` + WebServer 连接不同端口 | ✅ 无冲突 | 不同物理资源 |

**关键问题：** 没有任何检测或协调机制。用户在 WebServer GUI 已连接设备的情况下运行 CLI `--port` 命令，只会得到一个不友好的 `serial.SerialException`，没有提示 WebServer 正在占用。

### 1.3 状态不同步

CLI 和 WebServer 各自维护独立的 `DeviceState`：

- **CLI 的 `DeviceState`** (cli/fpb_cli.py:46)：精简版，仅包含串口连接和基本配置
- **WebServer 的 `DeviceState`** (core/state.py)：完整版，包含注入状态、日志、slot 缓存、auto-inject 状态等

两者的问题：
1. CLI 注入后，WebServer 不知道 slot 状态已变化（`cached_slots` 过期）
2. CLI 修改了设备内存，WebServer 的 watch expression 不会更新
3. WebServer 的 `config.json` 持久化配置，CLI 完全不读取也不写入

### 1.4 MCP Server 的特殊问题

`fpb_mcp_server.py` 直接复用 `FPBCLI` 类，维护一个模块级 `_cli_instance`：

```python
_cli_instance: Optional[FPBCLI] = None  # 会话级持久连接
```

MCP Server 的 `connect()` 会长期持有串口，与 WebServer 的行为完全一样，但两者互不知晓。如果用户同时使用 IDE 的 MCP 集成和浏览器中的 WebServer GUI，必然冲突。

### 1.5 CLI 重复实现的 DeviceState

CLI 在 `cli/fpb_cli.py:46` 自己定义了一个简化版 `DeviceState`，而不是复用 `core/state.py` 中的 `DeviceState`。这导致：
- 两套 `DeviceState` 的字段不一致（CLI 缺少 `auto_inject_*`、`tool_log`、`worker` 等）
- `FPBInject` 类接收的 `device_state` 接口不统一
- 新增配置项需要在两处同步维护

---

## 2. 整改方案

### 2.1 方案选型

| 方案 | 描述 | 复杂度 | 推荐 |
|------|------|--------|------|
| A. CLI 代理模式 | CLI 通过 HTTP API 委托 WebServer 执行设备操作 | 中 | ✅ 推荐 |
| B. 锁文件互斥 | 用文件锁协调串口访问 | 低 | 部分采用 |
| C. 共享进程 | CLI 和 WebServer 共享同一进程 | 高 | 不推荐 |

**推荐方案：A + B 组合** — CLI 优先通过 WebServer API 代理设备操作，当 WebServer 未运行时回退到直连模式，并用锁文件防止冲突。

### 2.2 架构设计

```
┌─────────────────────────────────────────────────┐
│                  用户                             │
│         ┌──────────┐  ┌──────────┐               │
│         │ Browser  │  │ Terminal │               │
│         └────┬─────┘  └────┬─────┘               │
│              │              │                     │
│              ▼              ▼                     │
│     ┌────────────┐  ┌────────────┐               │
│     │ WebServer  │  │    CLI     │               │
│     │   GUI      │  │ fpb_cli.py │               │
│     └─────┬──────┘  └─────┬──────┘               │
│           │                │                     │
│           │         ┌──────┴──────┐              │
│           │         │ WebServer   │              │
│           │         │ 运行中?     │              │
│           │         └──┬──────┬───┘              │
│           │        Yes │      │ No               │
│           │            ▼      ▼                  │
│           │     ┌────────┐ ┌────────┐            │
│           │     │HTTP API│ │直连模式│            │
│           │     │ 代理   │ │+锁文件 │            │
│           │     └───┬────┘ └───┬────┘            │
│           │         │          │                 │
│           ▼         ▼          ▼                 │
│     ┌──────────────────────────────┐             │
│     │     串口设备 (独占资源)       │             │
│     └──────────────────────────────┘             │
└─────────────────────────────────────────────────┘
```

### 2.3 详细设计

#### Phase 1：统一 DeviceState（低风险，立即可做）

**目标：** 消除 CLI 中重复定义的 `DeviceState`，复用 `core/state.py`。

**改动：**

1. 在 `core/state.py` 的 `DeviceState` 中提取一个轻量基类或 Protocol：

```python
# core/state.py

class DeviceStateBase:
    """CLI 和 WebServer 共用的最小设备状态接口"""
    def __init__(self):
        self.ser = None
        self.elf_path = None
        self.compile_commands_path = None
        self.ram_start = 0x20000000
        self.ram_size = 0x10000
        self.inject_base = 0x20001000
        self.cached_slots = None
        self.slot_update_id = 0
        self.upload_chunk_size = 128
        self.download_chunk_size = 1024
        self.serial_tx_fragment_size = 0
        self.serial_tx_fragment_delay = 0.002
        self.transfer_max_retries = 10

    def add_tool_log(self, message):
        pass  # CLI 可覆盖为 stderr 输出
```

2. `cli/fpb_cli.py` 的 `DeviceState` 改为继承 `DeviceStateBase`，只添加 `connect()`/`disconnect()` 方法。

3. WebServer 的 `DeviceState` 同样继承 `DeviceStateBase`，保留所有扩展字段。

**收益：** 新增配置项只需改一处，`FPBInject` 类的接口契约明确。

#### Phase 2：CLI 代理模式（核心改动）

**目标：** CLI 检测 WebServer 是否运行，如果运行则通过 HTTP API 代理设备操作。

**新增模块：** `cli/server_proxy.py`

```python
# cli/server_proxy.py

class ServerProxy:
    """通过 WebServer HTTP API 代理设备操作"""

    def __init__(self, base_url="http://127.0.0.1:5500", token=None):
        self.base_url = base_url
        self.token = token

    def is_server_running(self) -> bool:
        """探测 WebServer 是否在运行"""
        try:
            resp = requests.get(f"{self.base_url}/api/status", timeout=1)
            return resp.status_code == 200
        except:
            return False

    def is_device_connected(self) -> bool:
        """检查 WebServer 是否已连接设备"""
        resp = self._get("/api/status")
        return resp.get("connected", False)

    def inject(self, target_func, source_file, **kwargs) -> dict:
        """通过 WebServer API 执行注入"""
        return self._post("/api/fpb/inject", {
            "target_func": target_func,
            "source_file": source_file,
            **kwargs
        })

    def unpatch(self, comp=0, all_patches=False) -> dict:
        return self._post("/api/fpb/unpatch", {"comp": comp, "all": all_patches})

    def info(self) -> dict:
        return self._get("/api/fpb/info")

    # ... 其他设备操作的代理方法
```

**CLI 主流程改动：**

```python
# cli/fpb_cli.py 的 FPBCLI.__init__ 中

def __init__(self, ...):
    self._proxy = None

    # 如果需要设备操作，先尝试代理模式
    if port or self._needs_device(command):
        proxy = ServerProxy()
        if proxy.is_server_running():
            if proxy.is_device_connected():
                self._proxy = proxy
                logging.info("Using WebServer proxy mode")
            elif port:
                # WebServer 运行但未连接，CLI 不应直连（会冲突）
                logging.warning(
                    "WebServer is running. Use WebServer GUI to connect, "
                    "or stop WebServer first."
                )
```

**代理模式下的命令执行：**

```python
def inject(self, target_func, source_file, ...):
    if self._proxy:
        result = self._proxy.inject(target_func, source_file, ...)
        self.output_json(result)
        return
    # 原有直连逻辑...
```

#### Phase 3：锁文件机制（安全网）

**目标：** 当 WebServer 未运行时，CLI 直连模式下用锁文件防止多实例冲突。

**锁文件位置：** `/tmp/fpbinject-<port_hash>.lock`

```python
# utils/port_lock.py

import fcntl
import hashlib

class PortLock:
    LOCK_DIR = "/tmp"

    def __init__(self, port: str):
        port_hash = hashlib.md5(port.encode()).hexdigest()[:8]
        self._lock_path = f"{self.LOCK_DIR}/fpbinject-{port_hash}.lock"
        self._lock_fd = None

    def acquire(self) -> bool:
        """尝试获取串口锁，失败返回 False"""
        self._lock_fd = open(self._lock_path, 'w')
        try:
            fcntl.flock(self._lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self._lock_fd.write(f"{os.getpid()}\n")
            self._lock_fd.flush()
            return True
        except BlockingIOError:
            owner_pid = self._read_owner()
            return False

    def release(self):
        if self._lock_fd:
            fcntl.flock(self._lock_fd, fcntl.LOCK_UN)
            self._lock_fd.close()
            try:
                os.unlink(self._lock_path)
            except:
                pass

    def _read_owner(self) -> str:
        try:
            with open(self._lock_path) as f:
                return f.read().strip()
        except:
            return "unknown"
```

**WebServer 集成：** 在 `main.py` 的 `restore_state()` 中，auto-connect 成功后获取锁；disconnect 时释放锁。

**CLI 集成：** 直连模式下，`connect()` 前先 `acquire()`，失败则提示用户。

#### Phase 4：WebServer 新增 CLI 专用 API（可选增强）

为 CLI 代理模式提供更精确的 API 端点：

```
POST /api/cli/inject     - 同步注入，返回完整结果
POST /api/cli/unpatch    - 同步 unpatch
GET  /api/cli/info       - 获取设备信息
POST /api/cli/mem-read   - 内存读取
POST /api/cli/mem-write  - 内存写入
POST /api/cli/file-list  - 文件列表
```

这些端点与现有 GUI API 的区别：
- 同步返回（CLI 不需要 SSE 推送）
- JSON 输出格式与 CLI 现有格式兼容
- 不触发 GUI 的状态推送（避免干扰前端）

---

## 3. MCP Server 整改

MCP Server 当前直接实例化 `FPBCLI`，应改为与 CLI 相同的代理优先策略：

```python
# fpb_mcp_server.py

def _get_cli(...):
    global _cli_instance
    if _cli_instance is None:
        # 优先尝试代理模式
        proxy = ServerProxy()
        if proxy.is_server_running():
            _cli_instance = ProxyCLI(proxy)  # 代理包装
        else:
            _cli_instance = FPBCLI(...)  # 直连
    return _cli_instance
```

---

## 4. 实施计划

| 阶段 | 内容 | 改动范围 | 风险 |
|------|------|----------|------|
| Phase 1 | 统一 DeviceState 基类 | `core/state.py`, `cli/fpb_cli.py` | 低 |
| Phase 2 | CLI 代理模式 | 新增 `cli/server_proxy.py`，改 `cli/fpb_cli.py` | 中 |
| Phase 3 | 锁文件机制 | 新增 `utils/port_lock.py`，改 `main.py`, `cli/fpb_cli.py` | 低 |
| Phase 4 | CLI 专用 API | 新增 `app/routes/cli_api.py` | 低 |
| Phase 5 | MCP Server 适配 | 改 `fpb_mcp_server.py` | 低 |

建议按 Phase 1 → 3 → 2 → 4 → 5 的顺序实施。Phase 1 和 3 是独立的安全改进，可以先落地；Phase 2 是核心功能，依赖 Phase 4 的 API；Phase 5 最后适配。

---

## 5. 向后兼容

- CLI 的所有现有命令行参数和 JSON 输出格式保持不变
- `--port` 参数仍然可用，代理模式对用户透明
- WebServer 的所有现有 API 不受影响
- 新增 `--direct` 参数强制 CLI 使用直连模式（跳过代理检测）
- 新增 `--server-url` 参数指定非默认的 WebServer 地址
