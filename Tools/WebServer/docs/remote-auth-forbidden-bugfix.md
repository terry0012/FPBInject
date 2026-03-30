# 远程访问 API 认证失败修复（Forbidden JSON 解析错误）

## 问题背景

2026-03-30 通过局域网 IP 访问 WebServer 时，浏览器登录后选择端口时前端控制台持续报错：

```
[INFO] initTerminals: FPBInject Workbench Ready
[ERROR] refreshPorts: Failed to refresh ports: SyntaxError: Unexpected token 'F', "Forbidden" is not valid JSON
[ERROR] refreshPorts: Failed to refresh ports: SyntaxError: Unexpected token 'F', "Forbidden" is not valid JSON
...
```

页面本身能正常加载，但所有 `/api/*` 请求均失败。

## 根因分析

问题涉及两个层面：认证 token 未随 API 请求发送、以及错误响应格式不兼容。

### 1. Cookie 认证不可靠

认证流程设计如下：

```
用户访问 http://192.168.x.x:5500?token=abc123
  ├── middleware: 从 URL query 读取 token → 通过 → 返回页面 + Set-Cookie
  ├── JS (scripts.html): 从 URL 提取 token → 写入 document.cookie → 清除 URL 参数
  └── DOMContentLoaded → refreshPorts() → fetch('/api/ports')
        └── 浏览器应自动携带 cookie → middleware 验证
```

但实际上 cookie 在某些浏览器/网络环境下未被正确携带到后续 API 请求中。可能原因包括：

- 服务端 `Set-Cookie`（httponly）与 JS `document.cookie` 对同名 cookie 的竞争
- 部分浏览器对 HTTP（非 HTTPS）站点的 cookie 策略限制
- `SameSite=Lax` 在某些跨网段场景下的行为差异

由于前端 `fetch()` 调用没有任何 fallback 认证机制，cookie 一旦失效就无法恢复。

### 2. 错误响应格式不匹配

middleware 对认证失败统一返回纯文本：

```python
response = app.make_response(("Forbidden", 403))
```

但前端对所有 API 响应直接调用 `res.json()`：

```javascript
const res = await fetch('/api/ports');
const data = await res.json();  // ← "Forbidden" 不是合法 JSON，抛出 SyntaxError
```

## 修复策略

### 修复 1：前端 fetch 自动附加 Token Header

在 `scripts.html` 中将 URL token 保存到内存，并包装 `window.fetch` 对所有 `/api/` 请求自动附加 `X-Auth-Token` header：

```javascript
// 保存 token 到内存
window.__fpbAuthToken = urlToken;

// 包装 fetch，自动附加 header
const _origFetch = window.fetch;
window.fetch = function(url, opts) {
  const token = window.__fpbAuthToken;
  if (token && typeof url === 'string' && url.startsWith('/api/')) {
    opts = opts || {};
    opts.headers = new Headers(opts.headers || {});
    if (!opts.headers.has('X-Auth-Token')) {
      opts.headers.set('X-Auth-Token', token);
    }
  }
  return _origFetch.call(this, url, opts);
};
```

这样即使 cookie 失效，API 请求仍能通过 header 认证。

### 修复 2：SSE 连接附加 Token 参数

`EventSource` 不支持自定义 header，改为在 URL 中附加 query 参数：

```javascript
let sseUrl = '/api/logs/stream';
if (window.__fpbAuthToken) {
  sseUrl += `?token=${window.__fpbAuthToken}`;
}
logEventSource = new EventSource(sseUrl);
```

### 修复 3：Middleware 对 API 路由返回 JSON 错误

区分 API 路由和页面路由的 403 响应格式：

```python
if req_token != token:
    if request.path.startswith("/api/"):
        response = jsonify({"success": False, "error": "Forbidden"})
        response.status_code = 403
    else:
        response = app.make_response(("Forbidden", 403))
```

### 修复 4：前端 refreshPorts 增加响应状态检查

在解析 JSON 前先检查 HTTP 状态码，避免对错误响应调用 `res.json()` 导致异常：

```javascript
const res = await fetch('/api/ports');
if (!res.ok) {
  const data = await res.json().catch(() => ({}));
  log.error(`Failed to refresh ports: ${data.error || res.statusText}`);
  return;
}
const data = await res.json();
```

## 修改文件

| 文件 | 修改内容 |
|------|---------|
| `templates/partials/scripts.html` | 保存 token 到 `window.__fpbAuthToken`；包装 `fetch` 自动附加 `X-Auth-Token` header |
| `app/middleware.py` | `/api/` 路径 403 返回 JSON 格式；移除未使用的 `abort` 导入 |
| `static/js/core/connection.js` | `refreshPorts()` 增加 `res.ok` 检查，优雅处理错误响应 |
| `static/js/core/logs.js` | SSE `EventSource` URL 附加 `?token=` 参数 |

## 测试验证

### Python 后端

| 测试用例 | 说明 |
|---------|------|
| `test_api_route_returns_json_on_403` (新增) | 验证 `/api/` 路径 403 返回 JSON `{"success": false, "error": "Forbidden"}` |
| `test_non_api_route_returns_plain_text_on_403` (新增) | 验证非 API 路径 403 仍返回纯文本 `Forbidden` |
| 原有 11 个 auth 测试 | 全部通过，无回归 |

### JS 前端

| 测试用例 | 说明 |
|---------|------|
| `handles non-ok response (e.g. 403 Forbidden)` (新增) | 验证 `refreshPorts` 处理 403 不崩溃 |
| `includes auth token in EventSource URL when set` (新增) | 验证 SSE URL 包含 `?token=xxx` |
| `does not add token param when no auth token` (新增) | 验证无 token 时 URL 不变 |
| 原有 1568 个前端测试 | 全部通过，无回归 |

### 格式化与 Lint

- `black --check`：通过
- `prettier --check`：通过
- `flake8`：通过（修复了 `abort` 未使用导入）

## 认证机制总结

修复后，远程访问的认证有三层保障：

```
API 请求认证优先级:
  1. X-Auth-Token header  ← fetch wrapper 自动附加（本次新增）
  2. ?token= query param  ← EventSource 使用（本次新增）
  3. fpbinject_token cookie ← 原有机制（作为 fallback）
```

localhost 访问不受影响，始终免认证。
