# 外部 GDB 接入技术评估报告

## 1. 背景与目标

当前 FPBInject WebServer 已内置完整的 GDB 集成链路：

```
┌──────────┐    HTTP/SSE    ┌─────────────────────────────────────┐
│ Browser  │ ◄────────────► │          Flask WebServer             │
│ (前端)   │                │                                     │
└──────────┘                │  GDBSession (arm-none-eabi-gdb)     │
                            │    ↕ GDB/MI (pygdbmi)               │
                            │  GDBRSPBridge (TCP :auto-port)      │
                            │    ↕ fl read/write                  │
                            │  SerialProtocol → DeviceWorker      │
                            └──────────────┬──────────────────────┘
                                           │ UART
                                           ▼
                                    ┌──────────────┐
                                    │ Device (NuttX)│
                                    └──────────────┘
```

内部 GDB 子进程通过 `pygdbmi` 以 GDB/MI 协议驱动，仅用于符号查询、类型解析、内存格式化等**只读操作**。用户无法直接与 GDB 交互。

**目标**：支持外部 GDB 客户端（命令行 `arm-none-eabi-gdb` 或 IDE 调试器）连接到 WebServer 内部的 RSP Bridge，获得**原生 GDB 交互体验**，包括：

- `print`、`ptype`、`x/` 等命令直接使用
- 变量自动补全、表达式求值
- IDE（VS Code + Cortex-Debug、CLion）集成调试界面
- 自定义 GDB Python 脚本

## 2. 现有架构分析

### 2.1 GDB RSP Bridge (`core/gdb_bridge.py`)

| 特性 | 现状 |
|------|------|
| 监听地址 | `127.0.0.1`（仅本机） |
| 端口分配 | 动态（`listen_port=0`，OS 自动分配） |
| 客户端数量 | **单连接**（`_accept_loop` 串行处理，一个断开才接下一个） |
| 协议实现 | 最小集：`m`/`M`（内存读写）、`g`（伪寄存器）、`?`/`qSupported`（握手） |
| 内存访问 | 通过回调函数 `read_memory_fn` / `write_memory_fn` 桥接到串口 |
| 线程安全 | 回调函数由 `DeviceWorker` 的 `_run_serial_op()` 调度，串口访问已序列化 |

### 2.2 GDB Session (`core/gdb_session.py`)

| 特性 | 现状 |
|------|------|
| GDB 进程 | `arm-none-eabi-gdb --interpreter=mi3 --nx -q` |
| 通信方式 | `pygdbmi.IoManager`（stdin/stdout pipe） |
| 连接目标 | `target remote 127.0.0.1:<bridge_port>` |
| 用途 | 符号查询、类型解析、内存格式化（只读） |
| 生命周期 | 随串口连接启动/停止 |

### 2.3 关键约束

1. **串口单通道**：所有内存访问（内部 GDB + 外部 GDB + Web 前端）最终都走同一个串口，必须通过 `DeviceWorker` 序列化
2. **RSP 单连接**：当前 `GDBRSPBridge` 一次只服务一个 GDB 客户端
3. **无执行控制**：设备持续运行，不支持 halt/resume/breakpoint（FPB 仅用于函数重定向，非调试断点）

## 3. 技术方案

### 方案 A：独立外部 RSP Bridge（推荐）

新增一个**独立的 RSP Bridge 实例**，专门服务外部 GDB 连接，与内部 GDB 使用的 Bridge 并行运行。

```
                            ┌─────────────────────────────────────────┐
                            │            Flask WebServer               │
┌──────────┐   HTTP/SSE    │                                         │
│ Browser  │ ◄────────────► │  [内部] GDBSession ◄──► RSP Bridge :N  │
└──────────┘                │                            ↕            │
                            │                     read_memory_fn      │
┌──────────┐   GDB RSP     │  [外部] RSP Bridge :3333 ──┤            │
│ 外部 GDB │ ◄────────────► │         (固定端口)          ↕            │
│ (CLI/IDE)│                │                     DeviceWorker        │
└──────────┘                │                       ↕ UART           │
                            └───────────────────────┬─────────────────┘
                                                    ▼
                                             ┌──────────────┐
                                             │    Device     │
                                             └──────────────┘
```

**核心思路**：

- 内部 Bridge（动态端口）：继续服务内部 `GDBSession`，不变
- 外部 Bridge（固定端口 3333）：新实例，服务外部 GDB 客户端
- 两个 Bridge 共享同一组 `read_memory_fn` / `write_memory_fn` 回调
- 串口访问通过 `DeviceWorker` 自动序列化，无竞争风险

**实现改动**：

```python
# core/gdb_manager.py 新增

DEFAULT_EXTERNAL_RSP_PORT = 3333  # 外部 GDB 固定端口

def start_external_gdb_server(state, read_memory_fn, write_memory_fn,
                               port=DEFAULT_EXTERNAL_RSP_PORT) -> bool:
    """启动面向外部 GDB 的 RSP Bridge。"""
    if state.external_gdb_bridge and state.external_gdb_bridge.is_running:
        return True

    bridge = GDBRSPBridge(
        read_memory_fn=read_memory_fn,
        write_memory_fn=write_memory_fn,
        listen_port=port,
    )
    actual_port = bridge.start()
    state.external_gdb_bridge = bridge
    logger.info(f"External GDB RSP server on port {actual_port}")
    return True
```

外部用户连接方式：

```bash
# 终端
arm-none-eabi-gdb firmware.elf -ex "target remote :3333"

# 然后可以正常使用 GDB 命令
(gdb) print my_global_var
(gdb) ptype struct my_struct
(gdb) x/16wx 0x20000000
(gdb) info variables pattern
```

**优点**：
- 改动最小（~50 行），复用现有 `GDBRSPBridge` 类
- 内部/外部 GDB 完全隔离，互不影响
- 串口序列化已由 `DeviceWorker` 保证

**缺点**：
- 外部 GDB 的内存读写与内部 GDB / Web 前端共享串口带宽
- 外部 GDB 执行大量内存读取时可能影响前端响应速度

### 方案 B：替换模式（外部 GDB 接管内部 GDB 的 Bridge）

当外部 GDB 需要连接时，停止内部 `GDBSession`，将其 RSP Bridge 端口暴露给外部。

```
模式切换：
  [内部模式] GDBSession ◄──► RSP Bridge :N     （Web 前端驱动）
       ↓ 用户切换
  [外部模式] 外部 GDB   ◄──► RSP Bridge :3333  （用户直接交互）
```

**优点**：
- 无串口带宽竞争（同一时刻只有一个 GDB）
- 实现简单

**缺点**：
- 外部模式下 Web 前端的符号查询、Watch 面板等功能**全部不可用**
- 模式切换需要重启 GDB，有 2-5s ELF 加载开销
- 用户体验割裂

### 方案 C：GDB 多客户端代理

实现一个 RSP 协议多路复用代理，允许多个 GDB 客户端共享同一个 RSP 通道。

**缺点**：
- RSP 协议是有状态的（线程选择、断点状态等），多路复用极其复杂
- 业界无成熟的 RSP multiplexer 实现
- 投入产出比极低，**不推荐**

### 方案对比

| 维度 | 方案 A（独立 Bridge） | 方案 B（替换模式） | 方案 C（多路复用） |
|------|---------------------|-------------------|-------------------|
| 实现复杂度 | 低（~50 行） | 中（~150 行） | 极高（>1000 行） |
| Web 前端影响 | 无影响 | 外部模式下不可用 | 无影响 |
| 串口竞争 | 有（已序列化） | 无 | 有 |
| 外部 GDB 体验 | 完整 | 完整 | 完整 |
| IDE 集成 | ✅ | ✅ | ✅ |
| 推荐度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐ |

## 4. 方案 A 详细设计

### 4.1 RSP Bridge 改造

当前 `GDBRSPBridge` 已具备完整的 RSP 协议处理能力，无需修改协议层。仅需：

1. **`state.py`**：新增 `external_gdb_bridge` 字段
2. **`gdb_manager.py`**：新增 `start_external_gdb_server()` / `stop_external_gdb_server()`
3. **`connection.py`**：在串口连接成功后自动启动外部 RSP Bridge
4. **前端**：在连接状态面板显示外部 GDB 端口号，方便用户复制

### 4.2 监听地址配置

为支持远程调试（GDB 运行在另一台机器），监听地址应可配置：

```python
# config_schema.py 新增配置项
"external_gdb_port": 3333,        # 0 = 禁用
"external_gdb_listen": "0.0.0.0", # 或 "127.0.0.1" 仅本机
```

### 4.3 连接生命周期

```
串口连接成功
  → start_gdb()           # 内部 GDB（已有逻辑）
  → start_external_gdb_server()  # 外部 RSP Bridge（新增）

串口断开
  → stop_gdb()            # 停止内部 GDB
  → stop_external_gdb_server()   # 停止外部 RSP Bridge

外部 GDB 连接/断开
  → RSP Bridge 自动处理（已有 _accept_loop）
  → 前端 SSE 通知连接状态变化（可选增强）
```

### 4.4 多客户端支持增强（可选）

当前 `GDBRSPBridge._accept_loop` 是串行的（一个客户端断开后才接受下一个）。对于外部 Bridge，可增强为：

- 支持客户端断开后自动接受新连接（已支持）
- 可选：支持同时多个外部 GDB 连接（需要为每个连接创建独立线程，串口访问仍通过 DeviceWorker 序列化）

当前串行模式已足够满足需求，多客户端为后续增强项。

### 4.5 安全考虑

| 风险 | 缓解措施 |
|------|----------|
| 外部 GDB 写入任意内存 | RSP Bridge 的 `M` 包已桥接到 `fl write`，设备固件侧可限制写入范围 |
| 网络暴露 | 默认监听 `127.0.0.1`；远程调试需用户显式配置 `0.0.0.0` |
| 串口带宽争抢 | `DeviceWorker` 队列序列化，最坏情况是延迟增加，不会数据损坏 |
| 外部 GDB 发送 `c`/`s` 命令 | RSP Bridge 已伪实现（立即返回 `S05`），不影响设备运行 |

## 5. 外部 GDB 使用场景

### 5.1 命令行交互

```bash
$ arm-none-eabi-gdb path/to/firmware.elf
(gdb) target remote :3333
Remote debugging using :3333
0x00000000 in ?? ()

(gdb) print g_my_config
$1 = {enabled = 1, threshold = 42, name = "hello"}

(gdb) ptype struct lv_obj_t
type = struct lv_obj_t {
    struct lv_obj_t *parent;
    lv_ll_t child_ll;
    lv_area_t coords;
    ...
}

(gdb) x/4wx 0x20010000
0x20010000: 0x12345678 0xdeadbeef 0x00000000 0xffffffff

(gdb) set *(int *)0x20010000 = 0x42
(gdb) print *(struct my_config *)0x20010000
```

### 5.2 VS Code Cortex-Debug 集成

```jsonc
// .vscode/launch.json
{
    "type": "cortex-debug",
    "request": "attach",
    "name": "FPBInject GDB",
    "executable": "${workspaceFolder}/firmware.elf",
    "servertype": "external",
    "gdbTarget": "localhost:3333",
    "device": "Cortex-M4",
    "svdFile": "${workspaceFolder}/device.svd"
}
```

### 5.3 GDB Python 脚本

```bash
$ arm-none-eabi-gdb firmware.elf \
    -ex "target remote :3333" \
    -ex "source my_analysis.py" \
    -batch
```

用户可编写自定义 GDB Python 脚本进行批量分析、自动化测试等。

## 6. 已知限制

| 限制 | 原因 | 影响 |
|------|------|------|
| 无断点/单步 | 设备持续运行，fl 协议无 halt 能力 | 外部 GDB 仅能做内存读写和符号查询，不能做传统调试 |
| 寄存器为伪数据 | fl 协议无寄存器读取命令 | `info registers` 返回全零，不影响变量查看 |
| 内存读取有延迟 | 串口通信 + fl 协议开销 | 大范围 `x/` 命令可能需要数秒 |
| 变量值为"快照" | 设备持续运行，读取非原子 | 大结构体的成员可能不一致（与 Web 前端相同限制） |
| `continue`/`step` 无效 | 伪实现，立即返回 SIGTRAP | GDB 会显示"程序已停止"，但实际设备在运行 |

## 7. 实现计划

| 阶段 | 内容 | 工作量 |
|------|------|--------|
| Phase 1 | 新增外部 RSP Bridge 实例 + 配置项 + 启停逻辑 | 0.5 天 |
| Phase 2 | 前端显示外部 GDB 端口 + 连接状态 | 0.5 天 |
| Phase 3 | 文档：外部 GDB 使用指南（CLI / VS Code / CLion） | 0.5 天 |
| Phase 4（可选） | 多客户端支持 + 连接数限制 + 带宽优先级 | 1 天 |

**总计**：核心功能 1-1.5 天，含文档和可选增强约 2.5 天。

## 8. 结论

支持外部 GDB 接入在技术上**完全可行且改动极小**。现有架构已具备所有必要组件：

- `GDBRSPBridge` 类可直接复用，无需修改协议层
- `DeviceWorker` 已提供串口访问序列化，无并发风险
- `read_memory_fn` / `write_memory_fn` 回调机制天然支持多消费者

**推荐方案 A（独立外部 RSP Bridge）**，核心改动约 50 行 Python 代码，即可让用户通过标准 GDB 命令行或 IDE 调试器直接连接，获得原生 GDB 交互体验。
