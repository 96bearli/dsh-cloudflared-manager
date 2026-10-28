# dsh-cloudflared-manager

> Cloudflare Tunnel + 本地服务管理器，作为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件使用。

把本机的服务通过 Cloudflare 隧道暴露到公网，并在 DSH 面板里直接启停、看日志、改源码 —— 不需要记一堆命令，也不用开终端。

---

## 功能

**Named 隧道（固定域名）**

- 增删改查 ingress 映射（hostname → 本地端口），写入云端并自动重载
- 配好 API Token 后自动创建/删除 DNS CNAME 记录
- 支持多个根域名（按 hostname 后缀自动匹配对应 zone）
- 一键启停，可设为 DSH 启动时自动拉起

**本地服务管理**

- 用自定义命令定义服务（名称 / 端口 / 启动命令 / 工作目录 / 备注）
- 启动、停止、重启、看日志（面板内 tail）
- 自动探活：PID 文件 + 端口探测 + 进程命令行匹配，三种手段兜底
- 支持无端口服务（如 ssh 反向隧道守护、常驻 worker）
- 停止时连同子进程一起清理（避免 ssh 之类的孤儿进程占住端口）
- **在线查看/编辑服务的启动脚本**，保存后点重启即生效
- 每个服务可写一行**备注**说明用途，点服务名弹出查看

**快速隧道（trycloudflare）**

- 无需 Cloudflare 账号，一条命令把本地端口暴露到临时公网 URL
- 可选 URL 改写代理：直连 `trycloudflare.com` 在部分网络下不可达时，可配置自己的代理前缀，面板会额外给出代理地址（默认关闭）

---

## 安装

### 从 npm 安装（推荐）

```bash
dsh plugin --profile web add dsh-cloudflared-manager
```

装完重启 DSH 即可。这条路径依赖包内的 `cordis.patch.yml` 和 `package.json` 的
`dsh.bundle.patch` 字段——两者都随发布产物一起分发，不需要手工改 profile。

> 若 `dsh plugin` 报 `declares no dsh.bundle`，说明装到的版本低于 1.2.0，升级后再试。

### 从 GitHub 安装

```bash
dsh plugin --profile web add github:96bearli/dsh-cloudflared-manager
```

### 从本地源码安装

```bash
git clone https://github.com/96bearli/dsh-cloudflared-manager.git
dsh plugin --profile web add /path/to/dsh-plugin-cloudflared-manager
```

安装后重启 DSH，会话头部会出现「🌐 隧道」按钮，面板停靠在右侧边栏。

### 手动部署（不用 dsh plugin 命令）

```bash
# 规范副本（客户端静态资源从这里提供）
mkdir -p $DSH_HOME/profiles/web/plugins/dsh-cloudflared-manager
cp plugin/* $DSH_HOME/profiles/web/plugins/dsh-cloudflared-manager/

# 安装副本（host 端 require 实际加载这里）
mkdir -p $DSH_HOME/profiles/node_modules/dsh-cloudflared-manager
cp plugin/* $DSH_HOME/profiles/node_modules/dsh-cloudflared-manager/
```

然后在 `$DSH_HOME/profiles/web/cordis.patch.yml` 的 `insert` 列表里加：

```yaml
- insert:
    - id: dsh-cloudflared-manager
      name: dsh-cloudflared-manager
```

重启 DSH web 进程生效。

---

## 运行环境

**当前版本只支持 Linux x64，并且是按 Docker 容器环境调优的。**

cloudflared 二进制路径与自动安装的 npm 包名都写死为 Linux x64：

```
<运行目录>/node_modules/@farthershore/cloudflared-linux-x64/bin/cloudflared
```

没有做 `process.platform` / `process.arch` 判断——这是有意的取舍：本项目在
Docker 容器（PID 1 为 tini）里运行，容器内固定是 `linux/amd64`，硬编码换来的是
更少的运行期分支。**在 macOS / Windows / ARM 上安装会拿不到可用的二进制。**

容器环境下有三处专门处理：

| 事项 | 处理 |
|---|---|
| `/tmp` 是 tmpfs（内存盘，容器重启即丢） | 日志统一写 `<运行目录>/logs/`，与 PID 文件同处持久卷 |
| 容器内存有限，日志不该吃内存 | 同上，落磁盘而非 tmpfs |
| `pts` / 进程树与宿主机隔离 | 进程探活与停止全部走 `/proc` 与 PID 文件，不依赖 `ps`/`pgrep` |

若要在其他平台使用，需要自行修改 `CLOUDFLARED_BIN` 与 `ensureCloudflared()` 里的
包名（如 `cloudflared-darwin-arm64`），并验证进程探活逻辑。

---

## 配置

运行目录默认为 `$DSH_HOME/cloudflared-setup/`（可用环境变量 `DSH_CF_SETUP` 覆盖）：

```
$DSH_HOME/cloudflared-setup/
├── cf_config.json      # API Token + 账号级配置（敏感，600 权限）
├── config.yml          # Named 隧道本地配置备份
├── credentials.json    # 隧道凭证（敏感）
├── services.json       # 本地服务定义
├── pids/               # PID 文件
└── logs/               # 隧道与服务日志（放持久卷，容器重启不丢）
```

`cf_config.json` 的字段说明见 [`runtime-examples/cf_config.json.example`](./runtime-examples/cf_config.json.example)。

> ⚠️ **`cf_config.json` 和 `credentials.json` 含密钥，权限设为 `600`，绝不要提交到 git。**

### 获取 Cloudflare 凭据

1. **API Token**：Cloudflare 控制台 → My Profile → API Tokens → Create Token，权限需含：
   - Zone → DNS → Edit
   - Zone → Zone → Read
   - Account → Cloudflare Tunnel → Edit
2. **Account ID**：控制台右侧栏，或任意 zone 的 URL 里那串 32 位十六进制。
3. **Tunnel ID**：Zero Trust → Networks → Tunnels 里点进隧道可见。
4. **根域名白名单**：填你要用的根域名，如 `example.com`（不要填子域名）。

也可以在面板的「设置 → Cloudflared 隧道」页签里填写，不用手动改 JSON：
设置页有独立的「根域名白名单」区，可逐个添加/移除，并点「校验可用性」现场确认
每个域名能否写 DNS。

**`credentials.json` 不需要手工准备。** 全新安装时运行目录里没有这个文件，
首次点「启动」时插件会自动生成它：调用 Cloudflare 的
`GET /accounts/{accountId}/cfd_tunnel/{tunnelId}/token`（要求 Token 含
Account → Cloudflare Tunnel → **Read**），把返回的隧道 token 解出来就是
`{ AccountTag, TunnelID, TunnelSecret }`，即 `credentials.json` 的三个字段，
生成后权限自动设为 `600`。

因此只要 API Token + Account ID + Tunnel ID 三项填对，Named 隧道就能直接跑起来。
没配 Token 时插件会在面板上明确提示，并保留手工路径：用该隧道的 token 执行
`cloudflared tunnel run --token <TOKEN>`，或从已有部署拷一份 `credentials.json`。
文件里的 TunnelID 与当前 `tunnelId` 不一致时（换过隧道、或拷了别人的文件），
启动时同样会自动重建。

> **不需要填 Zone ID。** 插件按域名后缀自动解析对应的 zone（要求 Token 有
> Zone:Read 权限）。`zoneId` 字段已废弃：旧版用它做「解析不出 zone 时」的兜底
> 放行，但单个 zoneId 只能对应一个 zone，拿它去建另一个首级域名的记录会让
> Cloudflare 把 hostname 当成该 zone 的子域（落库成 `xxx.other.tld`），
> 正是历史上「映射建歪」的成因。现在白名单是唯一边界。

### 关于 DNS 与 ingress 的一致性

新增/删除映射都是**两步且非原子**：

- 新增：先写 tunnel ingress，再建 DNS CNAME
- 删除：先删 ingress，再删 DNS CNAME

如果第二步失败（例如 Token 缺 Zone:DNS 权限），会出现半完成状态并留下痕迹：

| 场景 | 后果 |
|---|---|
| 新增时 DNS 失败 | 映射已在隧道里，但域名解析不到 —— 访问无响应 |
| 删除时 DNS 失败 | Cloudflare 里残留一条指向 `xxx.cfargotunnel.com` 的 CNAME |

面板会明确报出这类情况（而不是笼统显示"成功"）。看到提示后请到 Cloudflare
DNS 面板核对并手动清理，否则残留记录会一直指向已失效的映射。

---

## 使用

### 本地服务定义

`services.json` 是一个数组：

```json
[
  {
    "name": "我的 Web 应用",
    "port": 8080,
    "command": "/usr/bin/node /opt/app/server.js",
    "cwd": "/opt/app",
    "autoStart": true,
    "note": "主站，对外 example.com"
  }
]
```

| 字段 | 说明 |
|---|---|
| `name` | 唯一名称 |
| `port` | 探活用端口，可为 `null`（无端口服务） |
| `command` | 启动命令，**建议写完整路径**（DSH 的 PATH 不保证覆盖） |
| `cwd` | 工作目录 |
| `autoStart` | DSH 启动时是否自动拉起 |
| `note` | 一行备注，面板里点服务名查看 |

> 新增服务时命令里带上脚本路径（如 `/path/python main.py`），「源码」按钮才能自动定位到文件。

### 面板操作

会话头部「🌐 隧道」→ 右侧栏面板，三个页签：

- **域名映射**：ingress 增删改查、DNS 自动同步、隧道启停
- **本地服务**：服务启停/日志/源码/编辑/删除、自动启动开关
- **快速隧道**：临时公网暴露

---

## HTTP API

插件在 `POST /dsh-cf/api` 暴露 JSON API，请求体格式为 `{"method": "...", "args": {...}}`。

```bash
# 综合状态（最常用）
curl -s -X POST http://127.0.0.1:3080/dsh-cf/api \
  -H 'Content-Type: application/json' \
  -d '{"method":"cf-status"}'

# 带参数的调用：参数必须放在 args 里
curl -s -X POST http://127.0.0.1:3080/dsh-cf/api \
  -H 'Content-Type: application/json' \
  -d '{"method":"cf-svc-stop","args":{"name":"我的 Web 应用"}}'
```

| 分类 | 方法 |
|---|---|
| 状态 | `cf-status` / `cf-version` / `cf-probe` |
| Named 隧道 | `cf-named-list` `cf-named-add` `cf-named-update` `cf-named-delete` `cf-named-start` `cf-named-stop` `cf-named-auto-start-set` |
| 本地服务 | `cf-svc-list` `cf-svc-add` `cf-svc-update` `cf-svc-note-set` `cf-svc-delete` `cf-svc-start` `cf-svc-stop` `cf-svc-restart` `cf-svc-log` `cf-svc-auto-start-get` `cf-svc-auto-start-set` |
| 源码 | `cf-src-read` `cf-src-save` `cf-src-list` |
| 配置 | `cf-cfg-get` `cf-cfg-set` `cf-cfg-test` |
| 快速隧道 | `cf-maps` `cf-map-add` `cf-map-stop` |
| 生命周期 | `cf-auto-start-now` `cf-restart-dsh` |

---

## 本版本不含 CF 优选

本仓库是**精简版**，不包含 CF 优选 IP 扫描与子域名接入（`opt-*` API 与 `optimize.js`）。
需要那部分功能请使用完整版分支。

---

## 依赖

- DSH >= 0.2.0
- `cloudflared` 二进制（插件会自动下载；也可把二进制放到 `vendor/` 下离线使用）
- 无第三方 npm 依赖，也不依赖其他 DSH 插件

---

## 常见问题

**服务显示「已停止」但进程在跑？**
探活有三种手段：PID 文件、端口探测、命令行匹配。无端口服务只能靠命令行匹配，此时请确保 `command` 里有可辨识的脚本路径（如 `/opt/app/server.js` 而不是 `node -e "..."`）。

**改了 `index.js` 不生效？**
host 端代码在 DSH 启动时被 require 进内存，改完必须重启 DSH。`client.js` 只需刷新浏览器。

**停服务后端口还被占着？**
本插件会在停止时清理子进程（读 `/proc/<pid>/stat` 的 ppid 建进程树）。如果仍有残留，通常是服务自己 daemon 化了，需要按进程名单独处理。

**域名打不开但隧道是健康的？**
检查 DNS CNAME 是否指向 `<tunnelId>.cfargotunnel.com` 且已代理（橙云）。没配 API Token 时插件不会自动建 DNS 记录。

**隧道显示健康、连接数正常，域名却全是 502？**
502 表示隧道这一层通了、但后端没人应答：cloudflared 把请求转到了 ingress 里写的本地端口，而那个端口上没有服务在监听。本插件的「健康」只反映 cloudflared 与 Cloudflare 边缘之间的连接数（`connections > 0`），不代表后端存活。排查：看 `cf-status` 返回的 `namedTunnel.ingress` 里的端口列表，逐个 `curl -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/`（返回 `000` 即无服务监听），再把这些服务在「本地服务」页签里建好并启动。

---

## License

[MIT](./LICENSE)
