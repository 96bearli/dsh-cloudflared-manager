// dsh-cloudflared-manager — host half (static plugin)
// Provides:
//   POST /dsh-cf/api   JSON API:
//     cf-status / cf-maps / cf-map-add / cf-map-stop          （快速隧道 trycloudflare）
//     cf-named-list / cf-named-add / cf-named-update / cf-named-delete / cf-named-start / cf-named-stop （Named 隧道）
//     cf-svc-list / cf-svc-add / cf-svc-update / cf-svc-note-set / cf-svc-delete
//     cf-svc-start / cf-svc-stop / cf-svc-restart / cf-svc-log / cf-svc-auto-start-get|set
//     cf-src-read / cf-src-save / cf-src-list                 （本地服务源码查看/编辑）
//     cf-cfg-get / cf-cfg-set / cf-cfg-test                   （API Token 与账号级配置）
//     cf-restart-dsh                                          （生命周期）
// Named 隧道以"本地 config.yml"模式运行（ingress 可本地增删改查），凭证由 token 生成。
//
// 本版本**不含 CF 优选 IP 扫描**（opt-* API 与 optimize.js）。
// 需要优选功能请用完整版分支。
import { spawn } from 'node:child_process'
import fs from 'node:fs'

export const inject = ['shell', 'webServer']

const PLUGIN_VERSION = '1.10.1'
// ── 运行目录（存放 cf_config.json / services.json / credentials.json / pids/）──
//
// 解析顺序：
//   1. 环境变量 DSH_CF_SETUP（显式指定，最高优先级）
//   2. $DSH_HOME/cloudflared-setup（默认）
//   3. 自动发现：$DSH_HOME 下两级目录里任何含 cf_config.json / services.json 的
//      cloudflared-setup 目录（兼容把工作目录放在 $DSH_HOME/<子目录>/ 下的老部署）
//
// ⚠ 为什么需要第 3 步：不同时期安装的部署，运行目录位置可能不同（例如放在
//   $DSH_HOME 的某个子目录下）。如果只认固定的新默认值，升级后就读不到原有配置，
//   表现为面板全空、服务列表 0 条、隧道 ingress 为空——看起来像"配置全丢了"。
//   这里做一次浅层扫描自动发现，避免这种静默故障，也避免在代码里硬编码
//   任何具体机器的路径。
const SETUP_DIRNAME = 'cloudflared-setup'

function looksLikeSetup(dir) {
  try {
    return fs.existsSync(dir + '/cf_config.json') || fs.existsSync(dir + '/services.json')
  } catch (e) { return false }
}

function resolveCfSetup() {
  if (process.env.DSH_CF_SETUP) return process.env.DSH_CF_SETUP
  const home = process.env.DSH_HOME || '/data/dsh'
  const preferred = home + '/' + SETUP_DIRNAME
  if (looksLikeSetup(preferred)) return preferred
  // 浅层扫描：$DSH_HOME/*/cloudflared-setup 与 $DSH_HOME/*/*/cloudflared-setup
  try {
    for (const a of fs.readdirSync(home)) {
      if (a === 'node_modules' || a.startsWith('.')) continue
      const lvl1 = home + '/' + a
      const c1 = lvl1 + '/' + SETUP_DIRNAME
      if (looksLikeSetup(c1)) return c1
      let subs = []
      try { subs = fs.readdirSync(lvl1) } catch (e) { continue }
      for (const b of subs) {
        if (b === 'node_modules' || b.startsWith('.')) continue
        const c2 = lvl1 + '/' + b + '/' + SETUP_DIRNAME
        if (looksLikeSetup(c2)) return c2
      }
    }
  } catch (e) { /* 读不到 home 就用默认值 */ }
  // 都没有：返回默认值，由后续逻辑按需创建
  return preferred
}
const CF_SETUP = resolveCfSetup()
const CLOUDFLARED_BIN = CF_SETUP + '/node_modules/@farthershore/cloudflared-linux-x64/bin/cloudflared'
const CONFIG_YML = CF_SETUP + '/config.yml'
const CREDENTIALS_JSON = CF_SETUP + '/credentials.json'
const SERVICES_FILE = CF_SETUP + '/services.json'
const CF_CONFIG_FILE = CF_SETUP + '/cf_config.json'   // { apiToken, zoneId, tunnelId, accountId, zoneWhitelist, ... }
const CF_BIN_NAME = 'cloudflared'
const PIDS_DIR = CF_SETUP + '/pids'   // PID 文件持久目录（容器重启保留）
// 日志目录：与 PID 文件一样放在 CF_SETUP 下（持久卷）。
//
// ⚠ 为什么不用 /tmp：本机 DSH 跑在 Docker 容器里（PID 1 是 tini），
//   /tmp 是 tmpfs 内存盘（256M，`df` 可见），**容器重启内容全丢**。
//   日志放 /tmp 的话，隧道/服务出问题重进容器就看不到现场，排查只能靠猜；
//   而 CF_SETUP 在持久卷上（/data/dsh），容器重建后日志仍在。
//   另外 tmpfs 只有 256M，cloudflared 长时间运行写的连接日志会把内存吃掉，
//   放在磁盘上更安全。
const LOGS_DIR = CF_SETUP + '/logs'

// ── 账号相关配置（tunnelId / accountId / zoneWhitelist）──
//
// 这些值随 Cloudflare 账号不同而不同，因此**不硬编码**，统一从 cf_config.json 读取，
// 缺省时返回空并给出明确报错，而不是静默用错别人的 ID。
// 兼容旧版：早期版本把它们写死在代码里，升级后请把值搬到 cf_config.json
// （cf-config-get 会把这些字段一并返回，方便对照）。
const CF_DEFAULTS = {
  tunnelId: '',
  accountId: '',
  zoneWhitelist: [],     // 例：['example.com', 'example.net']
  protocol: '',          // '' = 交给 cloudflared 决定；可选 'http2' / 'quic'
}


// ── 可自选的「首级域名」白名单 ──
//
// 背景（用户实际使用反馈，2026-10-13）：
//   早期 getZoneId() 硬编码单个 zone。于是新增任意 hostname 时都拿同一个 zone
//   去建 CNAME，Cloudflare 会把 hostname 当那个 zone 的子域处理：
//     用户加 fb.other.com → 实际落库成 fb.other.com.example.com（建歪），
//     而真正的 fb.other.com 查无记录 → 域名打不开，看着像"插件只支持一个域名"。
//
// 改法：按 hostname 的后缀匹配出它真正的 zone，再拿那个 zone 的 id 去写记录。
// 白名单是**安全边界**（防止用户误填别人域名时把记录建到不相干的 zone 去），
// 不是能力边界——账号下新增 zone 时把域名加进来即可。
//
// 值现在从 cf_config.json 的 zoneWhitelist 读取（不硬编码，见 CF_DEFAULTS）。


// ── 受管进程追踪（auto-start 生命周期）──
const managedProcs = new Map()  // name -> { proc, type: 'named'|'svc', logPath }

// 服务名 → 日志/PID 文件名（唯一）。
//
// ⚠ 历史 bug（2026-10-28 修复）：原写法是 name.replace(/[^a-zA-Z0-9_-]/g, '_')，
//   把每个非 ASCII 字符压成一个下划线。于是所有中文名服务全部塌缩成同一串下划线：
//     「虚拟世界聊天群」→ dsh-svc-_______
//     「切片调研报告」  → dsh-svc-______      （6 个汉字）
//     「RAG调研报告」   → dsh-svc-RAG____
//   两个不同服务若汉字数相同就**共用同一个 PID 文件和日志文件** →
//   探活时读到别人的存活 pid，把已停的服务判成「运行中」（实测踩中：
//   「切片调研报告」读到了 xray 的 pid，「节奏风报-配音台」读到了 8766 站点的 pid）。
//
//   修法：保留可读前缀，再拼一段名字的哈希，保证不同名字必然不同文件名。
//   纯 ASCII 名（如 bridge-lan-container）哈希后缀也照加，规则统一、不需要特判。
function svcFileKey(name) {
  const raw = String(name == null ? '' : name)
  const readable = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'svc'
  // 简易 32 位 FNV-1a：稳定、无依赖，够用于文件名去重
  let h = 0x811c9dc5
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return readable + '-' + h.toString(16).padStart(8, '0')
}

  function spawnManaged(name, type, command, logPath) {
    // 如果已有同名进程在跑，先杀掉
    const existing = managedProcs.get(name)
    if (existing && existing.proc && !existing.proc.killed) {
      try { existing.proc.kill('SIGTERM') } catch (e) {}
    }
    const proc = spawn('bash', ['-c', `${command} > ${logPath} 2>&1`], {
      detached: false,
      stdio: 'ignore',
    })
    managedProcs.set(name, { proc, type, logPath })
    // ⚠ 历史 bug（2026-10-28 修复）：原先只把 pid 存在内存 Map 里、不落 PID 文件。
    //   于是「autoStart 拉起的进程」在 DSH 重启后：
    //     1) 内存表清空 → managed[] 里看不到它；
    //     2) 没有 PID 文件 → svcRunning 的 PID 探活失效；
    //     3) 只剩端口探活或命令匹配 → 无端口的服务（pocket-aliyun-tunnel、
    //        MiGPT小爱音箱）必然被误判成「未运行」。
    //   现在统一落盘，和 startService 用同一套 PID 文件约定。
    //   注意：这里记的是 bash 包装进程的 pid，服务本体若用 exec 启动则 pid 相同。
    if (type === 'svc' && name.startsWith('svc:')) {
      const svcName = name.slice(4)
      const logName = 'dsh-svc-' + svcFileKey(svcName)
      try {
        fs.mkdirSync(PIDS_DIR, { recursive: true })
        fs.writeFileSync(PIDS_DIR + '/' + logName + '.pid', String(proc.pid))
      } catch (e) { /* 落盘失败不影响启动 */ }
    }
    // 进程退出时从追踪中移除（除非被外部 kill）
    proc.on('close', () => {
      const cur = managedProcs.get(name)
      if (cur && cur.proc === proc) managedProcs.delete(name)
    })
    return proc
  }

  function killManaged(name) {
    const st = managedProcs.get(name)
    if (!st || !st.proc || st.proc.killed) return false
    // ⚠ 杀父也要杀子孙：pocket-aliyun-tunnel 的 ssh 子进程由 bash 守护脚本
    //   fork 出来，只 SIGTERM 父进程会留下孤儿 ssh，反向隧道继续占服务器端口
    //   （详见 stopService 的注释）。
    // ★ 顺序：必须先收集并杀掉子孙，再杀父进程。父进程一死，子进程 ppid 会被
    //   内核重挂到 init(1)，进程树当场断链，之后就再也按 ppid 找不到了。
    const rootPid = st.proc.pid
    if (rootPid) {
      try {
        // 同步收集子孙并强杀（这里不能 await，killManaged 是同步函数）
        const parentOf = new Map()
        for (const d of fs.readdirSync('/proc')) {
          if (!/^\d+$/.test(d)) continue
          try {
            const stat = fs.readFileSync('/proc/' + d + '/stat', 'utf8')
            const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
            const ppid = parseInt(rest[1], 10)
            if (Number.isFinite(ppid)) parentOf.set(Number(d), ppid)
          } catch (e) { /* 进程已退出 */ }
        }
        const victims = []
        const queue = [rootPid]
        const seen = new Set([rootPid])
        while (queue.length) {
          const cur = queue.shift()
          for (const [pid, ppid] of parentOf) {
            if (ppid === cur && !seen.has(pid)) { seen.add(pid); victims.push(pid); queue.push(pid) }
          }
        }
        for (const v of victims) { try { process.kill(v, 'SIGKILL') } catch (e) {} }
      } catch (e) { /* /proc 不可读时忽略，父进程仍会被 SIGTERM */ }
    }
    st.proc.kill('SIGTERM')
    return true
  }

  function killAllManaged() {
    for (const [name, st] of managedProcs) {
      try { st.proc.kill('SIGTERM') } catch (e) {}
    }
    managedProcs.clear()
  }


export function apply(ctx) {
  const MAX_API_BODY = 1024 * 1024

  // ---- shell 适配（DSH 0.2）----
  // 0.2 的 ShellExecutor 是抽象类：只有 execute(spec) → handle → handle.result()，
  // 移除了 0.1.x 的 run(spec)。这里在插件内部适配一次，保持后续调用点不变。
  const shellRun = (() => {
    const real = ctx.shell
    if (real && typeof real.run === 'function') return (spec) => real.run(spec)
    return async (spec) => {
      const handle = await real.execute(spec)
      const result = await handle.result()
      return {
        stdout: { text: (result.stdout && result.stdout.text) || '' },
        stderr: { text: (result.stderr && result.stderr.text) || '' },
        exitCode: result.exitCode === null || result.exitCode === undefined ? 1 : result.exitCode,
      }
    }
  })()

  async function sh(cmd, timeoutMs = 15000) {
    const policy = { mode: 'danger-full-access', workspaceRoot: '/' }
    const spec = ctx.shell.resolve({ command: cmd, timeoutMs, stdoutMaxBytes: 512 * 1024, sandboxPolicy: policy })
    const res = await shellRun(spec)
    const out = ((res.stdout && res.stdout.text) || '') + ((res.stderr && res.stderr.text) || '')
    return { ok: res.exitCode === 0, exitCode: res.exitCode, output: out }
  }

  // 统计 cmdline 匹配指定片段的真实进程（遍历 /proc）。
  //
  // ⚠ 历史 bug（2026-10-28 修复）：原实现把片段直接拼进 shell 的 case 模式
  //   `case "$c" in ${frag}*)`。片段里只要带空格（如 "bash /data/.../pocket-tunnel.sh"），
  //   case 模式就会被拆成两个词 → shell 报 `syntax error near unexpected token`，
  //   整个命令失败、输出里没有数字 → 恒返回 0。
  //   后果：所有靠「命令片段匹配」探活的服务（尤其是没有端口可探测的
  //   pocket-aliyun-tunnel、MiGPT小爱音箱）永远显示「未运行」，而它们其实活得好好的。
  //
  //   修法：不再拼 shell，直接在 Node 里读 /proc/<pid>/cmdline（实测可读）。
  //   既避开引号/转义地狱，也少一次 shell 往返。
  function countProcByCmd(frag) {
    return findPidsByCmd(frag).length
  }

  // ───────────────────── cloudflared metrics 探测 ─────────────────────
  //
  // ⚡ 优化说明：原先 isNamedRunning 与 namedConnections 各自遍历 [20241,20242,20243]
  //   探测 metrics，问题有二：
  //     1) 重复探测——同一次 cf-status 里同一个端口被 curl 两遍；
  //     2) 隧道未运行时，每个失败端口都要等 -m 2 超时，最坏 3×2s×2 处 = 12s。
  //
  //   改为：一次调用同时拿到「是否运行」+「连接数」，并记忆上次命中的端口
  //   （metricsPort），下次优先试它；命中后立即返回，不再遍历无关端口。
  //   实测 metrics 监听在 20241，其余两个是无效探测。
  //
  // ⚠ 历史 bug（2026-10-28 修复）：**快速隧道会把 Named 隧道「带活」**
  //
  //   快速隧道（`tunnel --url http://localhost:PORT`）启动时也会自己开一个
  //   metrics 监听（实测 20241），并导出 cloudflared_tunnel_ha_connections=1。
  //   而 probeMetrics() 原先只问「20241 有没有 metrics 响应」，**不问这个端口
  //   属于哪个进程**，于是：
  //     · 只要存在任意一条快速隧道，Named 隧道就永远显示 running/healthy=true；
  //     · 哪怕根本没建过 Named 隧道（没有 config.yml、没有 pid、没有进程）。
  //   实测复现：只建了一条 8099 的快速隧道，cf-status 返回
  //   namedTunnel {running:true, healthy:true, connections:1}，而
  //   /proc 关联显示 20241 的属主正是那条快速隧道（PID 1084）。
  //   连带影响 cf-named-start 的「已在运行就不重复启动」判断等。
  //
  //   修法（按端口反查进程归属，再按命令行区分模式）：
  //     命中 metrics 端口后，解析该端口的属主 PID，读它的 cmdline：
  //       · 含 `--url`（快速隧道）→ 不算 Named 隧道在跑，继续试下一个候选端口；
  //       · 含 `--config` 或 `tunnel ... run`（Named 模式）→ 才算 Named 隧道。
  //   不做「按固定端口区分」那种改法，因为端口是 cloudflared 自选的，
  //   而且在端口被占用时它会漂移，硬编码反而更脆。
  let metricsPort = 20241

  // 排障用：最近一次因「属主不是 Named 隧道」而跳过的 metrics 端口信息。
  // 典型场景：只有快速隧道在跑时，它占着 20241 并报 ha_connections=1，
  // 这里会记下它的 pid 与命令行，cf-status 里回传给前端，便于一眼看出
  // 「有 quick tunnel 在跑，但它不是 Named 隧道」。
  let metricsPortOwnerNote = null

  /**
   * 按监听端口反查属主 PID：读 /proc/net/tcp{,6} 拿到该 port 的 socket inode，
   * 再在 /proc/<pid>/fd 里找指向同一 inode 的进程。
   * @returns 属主 PID，找不到返回 null。纯 Node 实现（沙箱无 ss/lsof/netstat）。
   */
  function pidOfListeningPort(port) {
    const inodes = new Set()
    for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
      let text
      try { text = fs.readFileSync(file, 'utf8') } catch (e) { continue }
      for (const line of text.split('\n').slice(1)) {
        const cols = line.trim().split(/\s+/)
        if (cols.length < 10 || cols[3] !== '0A') continue   // 0A = LISTEN
        const local = cols[1]
        if (parseInt(local.split(':').pop(), 16) !== port) continue
        inodes.add(cols[9])
      }
    }
    if (inodes.size === 0) return null
    let entries
    try { entries = fs.readdirSync('/proc') } catch (e) { return null }
    for (const d of entries) {
      if (!/^\d+$/.test(d)) continue
      let fds
      try { fds = fs.readdirSync('/proc/' + d + '/fd') } catch (e) { continue }
      for (const fd of fds) {
        let link
        try { link = fs.readlinkSync('/proc/' + d + '/fd/' + fd) } catch (e) { continue }
        const m = /^socket:\[(\d+)\]$/.exec(link)
        if (m && inodes.has(m[1])) return Number(d)
      }
    }
    return null
  }

  /** 读取某 PID 的 cmdline（空格连接）。 */
  function cmdlineOf(pid) {
    try {
      return fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8')
        .split('\0').filter(Boolean).join(' ')
    } catch (e) { return '' }
  }

  /**
   * 判断某 PID 是否真的是「Named 隧道」进程。
   *
   * 判据：命令行是 cloudflared，且带 `tunnel` 子命令，且 **不含** `--url`
   * （`--url` 是快速隧道的标志）。Named 隧道的形态是
   * `cloudflared tunnel --config <path> run`。
   */
  function isNamedTunnelPid(pid) {
    const cmd = cmdlineOf(pid)
    if (!cmd) return false
    if (!cmd.includes('cloudflared')) return false
    if (!/\btunnel\b/.test(cmd)) return false
    // 快速隧道：cloudflared tunnel --url http://localhost:PORT
    if (/(^|\s)--url(\s|=|$)/.test(cmd)) return false
    return true
  }

  /**
   * 返回 { running, connections, port }；单次 shell 往返搞定。
   *
   * running 为 true 的**前提**是该 metrics 端口的属主进程确实是 Named 隧道，
   * 否则快速隧道会被误判成 Named 隧道（见上方历史 bug 说明）。
   */
  async function probeMetrics() {
    // 优先试上次命中的端口，再依次试其余候选
    const candidates = [metricsPort, 20241, 20242, 20243].filter((v, i, a) => a.indexOf(v) === i)
    for (const port of candidates) {
      const r = await sh(
        `out=$(curl -s -m 2 http://127.0.0.1:${port}/metrics 2>/dev/null || true); ` +
        `if [ -n "$out" ]; then ` +
        `echo "UP:1"; ` +
        `echo "$out" | grep -E '^cloudflared_tunnel_ha_connections ' | awk '{print "CONN:"$2}' | head -1; ` +
        `fi`,
        6000,
      )
      const out = r.output || ''
      if (!out.includes('UP:1')) continue

      // 端口有 metrics 响应 ≠ Named 隧道在跑：必须核对属主进程的命令行。
      // 属主反查失败（例如 /proc 不可读）时按「不是 Named 隧道」处理（fail-closed），
      // 宁可漏报也不把快速隧道当成 Named 隧道。
      const owner = pidOfListeningPort(port)
      if (owner === null || !isNamedTunnelPid(owner)) {
        // 是别的 cloudflared（通常是快速隧道）占着这个 metrics 端口，
        // 记下原因便于排障，然后继续试其它候选端口。
        if (owner !== null) metricsPortOwnerNote = { port, pid: owner, cmd: cmdlineOf(owner).slice(0, 160) }
        continue
      }

      metricsPort = port
      const conn = parseInt((out.match(/CONN:(\d+)/) || [])[1], 10)
      return { running: true, connections: Number.isFinite(conn) ? conn : 0, port, pid: owner }
    }
    return { running: false, connections: 0, port: null, pid: null }
  }

  async function isNamedRunning() {
    return (await probeMetrics()).running
  }

  // ---------------- cloudflared 自动安装 ----------------

  async function ensureCloudflared() {
    const chk = await sh(`test -x ${CLOUDFLARED_BIN} && echo yes || echo no`, 5000)
    if ((chk.output || '').includes('yes')) return { ok: true, installed: true }
    // 未安装：通过 npm 安装（npm registry 可达）
    const inst = await sh(
      `mkdir -p ${CF_SETUP} && cd ${CF_SETUP} && npm install --cache ${CF_SETUP}/.npm-cache @farthershore/cloudflared-linux-x64 2>&1 | tail -3`,
      180000,
    )
    const chk2 = await sh(`test -x ${CLOUDFLARED_BIN} && echo yes || echo no`, 5000)
    if ((chk2.output || '').includes('yes')) return { ok: true, installed: true, installedNow: true }
    return { ok: false, error: 'cloudflared 自动安装失败: ' + String(inst.output || '').slice(-200) }
  }

  // ---------------- Cloudflare API（DNS 自动同步） ----------------

  async function readCfConfig() {
    const r = await sh(`cat ${CF_CONFIG_FILE} 2>/dev/null || echo '{}'`, 5000)
    try { const d = JSON.parse(r.output || '{}'); return d && typeof d === 'object' ? d : {} } catch (e) { return {} }
  }

  // ── 账号配置的内存镜像 ──
  //
  // tunnelId / accountId / zoneWhitelist 随账号而变，不能硬编码；但代码里有大量
  // **同步**调用点（resolveApex、buildConfigYaml、cf-status 等），没法逐个改成 await。
  // 所以在这里缓存一份：启动时读一次，任何写配置的动作（cf-cfg-set 等）之后刷新。
  let cfMeta = { ...CF_DEFAULTS }
  async function refreshCfMeta() {
    const cfg = await readCfConfig()
    const list = Array.isArray(cfg.zoneWhitelist) ? cfg.zoneWhitelist : []
    cfMeta = {
      tunnelId: typeof cfg.tunnelId === 'string' ? cfg.tunnelId.trim() : '',
      accountId: typeof cfg.accountId === 'string' ? cfg.accountId.trim() : '',
      zoneWhitelist: list.map((z) => String(z).trim().toLowerCase()).filter(Boolean),
      // 隧道传输协议：'' (交给 cloudflared 决定) | 'http2' | 'quic'。
      // 只接受这两个已知值，避免把用户填错的串写进 config.yml 让 cloudflared 起不来。
      protocol: (cfg.protocol === 'http2' || cfg.protocol === 'quic') ? cfg.protocol : '',
    }
    return cfMeta
  }
  // 同步读取（给同步调用点用）。首次调用前必须先 await refreshCfMeta()。
  const TUNNEL_ID = () => cfMeta.tunnelId
  const ACCOUNT_ID = () => cfMeta.accountId
  const ZONE_WHITELIST = () => cfMeta.zoneWhitelist

  async function autoStart() {
    // 1) Named 隧道
    const cfg = await readCfConfig()
    if (cfg.autoStart) {
      const pidFile = PIDS_DIR + '/dsh-cf-named.pid'
      const alive = await sh(`if [ -s ${pidFile} ]; then kill -0 "$(cat ${pidFile})" 2>/dev/null && echo yes || echo no; else echo no; fi`, 3000)
      if (!(alive.output || '').includes('yes')) {
        // ⚠ 不再直接 spawnManaged：那条路径不检查 config.yml / credentials.json，
        //   文件缺失时 cloudflared 秒退，只在日志里留一行 ENOENT，表面上像
        //   "自动启动没生效"。改走 restartNamedTunnel()，它负责
        //   （a）确保二进制就位（b）校验凭据（c）按当前 ingress 重写 config.yml
        //   （d）校验进程真的活着，失败时给出可读原因。
        try {
          const r = await restartNamedTunnel()
          if (r && r.error) {
            console.error('dsh-cloudflared-manager: Named 隧道自动启动失败:', r.error)
          }
        } catch (e) {
          console.error('dsh-cloudflared-manager: Named 隧道自动启动异常:', e && e.message ? e.message : String(e))
        }
      }
    }
    // 2) 本地服务
    const services = await readServices()
    for (const svc of services) {
      if (!svc.autoStart) continue
      const logName = 'dsh-svc-' + svcFileKey(svc.name || 'svc')
      const pidFile = PIDS_DIR + '/' + logName + '.pid'
      // PID 文件探活
      const pidAlive = await sh(`if [ -s ${pidFile} ]; then kill -0 "$(cat ${pidFile})" 2>/dev/null && echo yes || echo no; else echo no; fi`, 3000)
      let isAlive = (pidAlive.output || '').includes('yes')
      // 端口探活（处理手动启动无 PID 文件的情况）
      if (!isAlive && svc.port) {
        const portCheck = await sh(`curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:${svc.port}/ || true`, 3000)
        const code = (portCheck.output || '').trim()
        isAlive = code !== '' && code !== '000'
      }
      // ⚠ 补充（2026-10-28）：无端口服务（pocket-aliyun-tunnel、MiGPT小爱音箱）
      //   既没有 PID 文件可查（旧版 spawnManaged 不落盘）、也没有端口可探，
      //   原先必然判为「未运行」→ 每次 DSH 启动都重复拉起一份 → 两份互相抢
      //   （ssh -R 端口占用、小爱重复登录）。这里补一道命令片段匹配。
      if (!isAlive) {
        isAlive = countProcByCmd(svcCmdFrag(svc)) > 0
      }
      if (!isAlive) {
        const cwd = svc.cwd || '/'
        const logPath = LOGS_DIR + '/' + logName + '.log'
        spawnManaged('svc:' + svc.name, 'svc',
          `cd ${cwd} && exec ${(svc.command || '').trim()}`,
          logPath)
      }
    }
  }

  async function writeCfConfig(d) {
    const b64 = Buffer.from(JSON.stringify(d, null, 2), 'utf8').toString('base64')
    return sh(`echo '${b64}' | base64 -d > ${CF_CONFIG_FILE}`, 5000)
  }

  async function cfApiGet(cfg, path) {
    const r = await sh(`curl -s -m 15 "https://api.cloudflare.com/client/v4${path}" -H "Authorization: Bearer ${cfg.apiToken}"`, 20000)
    try { return JSON.parse(r.output || '{}') } catch (e) { return { success: false, errors: [{ message: r.output.slice(0, 100) }] } }
  }

  async function cfApiPost(cfg, path, body) {
    const b64 = Buffer.from(JSON.stringify(body || {}), 'utf8').toString('base64')
    // -d 需传解码后的 JSON；在 shell 里先 base64 -d 再交给 curl
    const r = await sh(`curl -s -m 15 -X POST "https://api.cloudflare.com/client/v4${path}" -H "Authorization: Bearer ${cfg.apiToken}" -H "Content-Type: application/json" -d "$(echo '${b64}' | base64 -d)"`, 20000)
    try { return JSON.parse(r.output || '{}') } catch (e) { return { success: false, errors: [{ message: r.output.slice(0, 100) }] } }
  }

  async function cfApiDelete(cfg, path) {
    const r = await sh(`curl -s -m 15 -X DELETE "https://api.cloudflare.com/client/v4${path}" -H "Authorization: Bearer ${cfg.apiToken}"`, 20000)
    try { return JSON.parse(r.output || '{}') } catch (e) { return { success: false, errors: [{ message: r.output.slice(0, 100) }] } }
  }

  async function cfApiPut(cfg, path, body) {
    const b64 = Buffer.from(JSON.stringify(body || {}), 'utf8').toString('base64')
    const r = await sh(`curl -s -m 15 -X PUT "https://api.cloudflare.com/client/v4${path}" -H "Authorization: Bearer ${cfg.apiToken}" -H "Content-Type: application/json" -d "$(echo '${b64}' | base64 -d)"`, 20000)
    try { return JSON.parse(r.output || '{}') } catch (e) { return { success: false, errors: [{ message: r.output.slice(0, 100) }] } }
  }

  // 读云端隧道配置（remotely-managed 隧道的权威 ingress 来源）
  async function cloudIngress(cfg) {
    const res = await cfApiGet(cfg, `/accounts/${ACCOUNT_ID()}/cfd_tunnel/${TUNNEL_ID()}/configurations`)
    if (res.success && res.result && res.result.config && Array.isArray(res.result.config.ingress)) {
      return res.result.config.ingress.map((e) => ({ hostname: e.hostname || null, service: e.service }))
    }
    return null
  }

  // 写云端隧道配置（PUT 全量替换；cloudflared 会自动重载）
  async function setCloudIngress(cfg, entries) {
    const ingress = entries.map((e) => (e.hostname ? { hostname: e.hostname, service: e.service } : { service: e.service }))
    return cfApiPut(cfg, `/accounts/${ACCOUNT_ID()}/cfd_tunnel/${TUNNEL_ID()}/configurations`, {
      config: { ingress, 'warp-routing': { enabled: false } },
    })
  }
  // 获取 zone id（缓存）；token 无 Zone 权限时返回 null
  // ★ 按 hostname 解析出它的 zone（多首级域名支持的核心）
  //
  // 为什么不能再用单个 cfg.zoneId：那是"全局唯一 zone"的旧模型假设，
  // 一旦 hostname 属于另一个首级域名，就会拿着错误的 zone id 去建记录
  // → Cloudflare 把 hostname 当那个 zone 的子域 → 落库成 xxx.other.com（建歪）。
  //
  // 规则：取 hostname 里**命中白名单的最长后缀**作为 apex。用最长匹配是为了
  // 以后支持三级 zone（如 a.b.com）时不至于误判成 b.com。
  //   fb.example.net    → example.net
  //   api.example.com   → example.com
  //   x.example.com.cn  → 不命中（白名单外）
  function resolveApex(hostname) {
    const h = String(hostname || '').trim().toLowerCase().replace(/\.$/, '')
    if (!h) return null
    let best = null
    for (const apex of ZONE_WHITELIST()) {
      if (h === apex || h.endsWith('.' + apex)) {
        if (!best || apex.length > best.length) best = apex
      }
    }
    return best
  }

  // 按 hostname 取 zone id（带进程内缓存，避免面板刷新时反复打 CF API）
  //
  // 缓存键是 apex，不是"唯一 zoneId"——这是与旧 getZoneId 的关键区别。
  // ⚠ 2026-10-28 变更：**移除 cfg.zoneId 兜底放行**。
  //
  //   旧行为：hostname 不在白名单里时，只要配了 cfg.zoneId 就放行，拿这个
  //   zoneId 去建 DNS 记录。这是个安全隐患 + 建歪的根源：
  //     · 白名单本来是安全边界，却被这个兜底开了个后门；
  //     · 单个全局 zoneId 只能对应一个 zone。若拿它去建另一个首级域名的
  //       记录，CF 会把 hostname 当该 zone 的子域，落库成 `xxx.other.tld`
  //       —— 正是历史上「映射建歪」事故的成因。
  //   现在：白名单是**唯一**边界。解析不出 apex 就明确拒绝，不做任何猜测。
  //   zoneId 字段不再参与任何判定（保留读取仅为向后兼容老配置文件，
  //   不再用于放行）。
  const zoneIdCache = new Map()   // apex -> zoneId

  async function getZoneIdForHost(cfg, hostname) {
    const apex = resolveApex(hostname)
    if (apex) {
      if (zoneIdCache.has(apex)) return { zoneId: zoneIdCache.get(apex), apex }
      const res = await cfApiGet(cfg, '/zones?name=' + encodeURIComponent(apex))
      if (res.success && res.result && res.result[0]) {
        const id = res.result[0].id
        zoneIdCache.set(apex, id)
        return { zoneId: id, apex }
      }
      return { zoneId: null, apex, error: `无法解析 ${apex} 的 Zone（Token 是否有 Zone:Read？）` }
    }
    // 白名单外一律拒绝。不再用 cfg.zoneId 兜底。
    const list = ZONE_WHITELIST()
    return {
      zoneId: null, apex: null,
      error: list.length === 0
        ? '尚未配置根域名白名单：请先在「设置」里添加可用的根域名（如 example.com）'
        : `域名不在白名单内（仅支持 ${list.map((z) => 'xxx.' + z).join(' / ')}）`,
    }
  }

  // 创建 CNAME 记录（hostname → tunnel.cfargotunnel.com）
  async function ensureDns(cfg, hostname) {
    const z = await getZoneIdForHost(cfg, hostname)
    if (!z.zoneId) return { ok: false, error: z.error || 'Token 无 Zone 权限，无法自动创建 DNS' }
    const res = await cfApiPost(cfg, `/zones/${z.zoneId}/dns_records`, {
      type: 'CNAME', name: hostname, content: TUNNEL_ID() + '.cfargotunnel.com', proxied: true, ttl: 1,
    })
    if (res.success) return { ok: true, apex: z.apex }
    const msg = (res.errors && res.errors[0] && res.errors[0].message) || '未知错误'
    // 已存在（重复创建）视为成功
    if (/already exists|existed/i.test(String(msg))) return { ok: true, existed: true, apex: z.apex }
    return { ok: false, error: 'DNS 创建失败: ' + msg }
  }

  // 删除 CNAME 记录
  async function removeDns(cfg, hostname) {
    const z = await getZoneIdForHost(cfg, hostname)
    if (!z.zoneId) return { ok: false, error: z.error || 'Token 无 Zone 权限，无法自动删除 DNS' }
    const res = await cfApiGet(cfg, `/zones/${z.zoneId}/dns_records?name=${encodeURIComponent(hostname)}&type=CNAME`)
    const rec = res.success && res.result && res.result[0]
    if (!rec) return { ok: true, notFound: true, apex: z.apex }
    const del = await cfApiDelete(cfg, `/zones/${z.zoneId}/dns_records/${rec.id}`)
    return del.success ? { ok: true, apex: z.apex } : { ok: false, error: 'DNS 删除失败' }
  }

  // 按 cmdline 前缀 kill 匹配进程（遍历 /proc，不依赖 pkill/pgrep）
  // 找出 cmdline 匹配片段的进程 pid 列表（与 countProcByCmd 同一套匹配规则）
  function findPidsByCmd(frag) {
    const needle = String(frag || '').replace(/\s+/g, ' ').trim()
    if (!needle) return []
    const isAbs = needle.includes('/')
    const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = isAbs ? null : new RegExp('(^|[\\s/"\'])(' + esc + ')([\\s"\']|$)', 'i')
    const out = []
    let entries = []
    try { entries = fs.readdirSync('/proc') } catch (e) { return [] }
    const self = String(process.pid)
    for (const d of entries) {
      if (!/^\d+$/.test(d)) continue
      if (d === self) continue
      let raw
      try { raw = fs.readFileSync('/proc/' + d + '/cmdline') } catch (e) { continue }
      const cmd = raw.toString('utf8').split('\0').filter(Boolean).join(' ')
      if (!cmd) continue
      // ★ 排除「探针自己」（2026-10-28 实测踩中）：
      //   插件用 `node -e "<脚本>"` 或 `bash -c "echo ... >> log"` 这类内联命令
      //   去遍历/写日志时，这些命令的 cmdline 里**本身就含有被查的片段字符串**，
      //   于是「查 pocket 有没有在跑」这一步，会匹配到正在查它自己的那个探针进程，
      //   判定 isAlive=true → autoStart 跳过启动 → 服务永远起不来。
      //   实测复现：手动跑 cf-auto-start-now，pocket 无进程却报 ALIVE=true。
      //   排除办法：cmdline 里出现 node/bash 的 -e/-c 内联标志，且含 /proc 或
      //   探针关键字，就不是真正的服务进程。
      const isProbe = /(^|\s)(-e|-c)\s/.test(cmd) &&
        (cmd.includes('/proc') || cmd.includes('dsh-autostart-probe') || cmd.includes('cmdline'))
      if (isProbe) continue
      if (isAbs ? cmd.includes(needle) : re.test(cmd)) out.push(Number(d))
    }
    return out
  }

  async function killByCmd(frag) {
    // ⚠ 历史 bug（2026-10-28 修复）：原实现把片段裸拼进 shell 的 case 模式
    //   `*${frag}*`，片段带空格时 shell 直接 syntax error，整条命令失败、
    //   什么也没杀掉，而调用方以为杀成功了。
    //   现在改成：pid 列表在 Node 里算（与探活用完全相同的匹配规则，避免
    //   「探得到却杀不掉」或「杀错」），shell 只负责 kill。
    const pids = findPidsByCmd(frag)
    if (pids.length === 0) return 0
    await sh(`kill -9 ${pids.join(' ')} 2>/dev/null || true`, 6000)
    return pids.length
  }

  // 按 PID 文件 kill（插件自己启动的进程都记录 PID 文件；kill 是 shell 内建，沙箱可用）
  async function killByPidFile(pidFile) {
    const r = await sh(`cat ${pidFile} 2>/dev/null || true`, 5000)
    const pid = parseInt((r.output || '').trim(), 10)
    if (!Number.isFinite(pid) || pid <= 0) return null
    const killed = await sh(`kill -${pid} 2>/dev/null; kill ${pid} 2>/dev/null && echo yes || echo no; rm -f ${pidFile}`, 5000)
    return (killed.output || '').includes('yes') ? pid : null
  }

  async function namedConnections() {
    // 复用 probeMetrics（与 isNamedRunning 同一次探测，避免重复 curl 同一端口）
    return (await probeMetrics()).connections
  }

  // ---------------- Named 隧道 ingress CRUD（本地 config.yml） ----------------

  function parseIngress(yaml) {
    const entries = []
    const lines = String(yaml || '').split('\n')
    let cur = null
    for (const raw of lines) {
      const line = raw.trim()
      if (!line) continue
      if (line.startsWith('- hostname:')) {
        if (cur) entries.push(cur)
        cur = { hostname: line.replace('- hostname:', '').trim(), service: '' }
      } else if (line.startsWith('- service:')) {
        if (cur) entries.push(cur)
        cur = { hostname: null, service: line.replace('- service:', '').trim() }
      } else if (line.startsWith('service:') && cur) {
        cur.service = line.replace('service:', '').trim()
      }
    }
    if (cur) entries.push(cur)
    return entries
  }

  // ── ingress service 里 localhost → 127.0.0.1 ──
  //
  // ⚠ 为什么必须改写（2026-10-28 实测）：本机 /etc/hosts 同时有
  //     127.0.0.1 localhost
  //     ::1       localhost ip6-localhost ip6-loopback
  //   于是 cloudflared 解析 localhost 会拿到**两个**地址，且优先用 ::1。
  //   而这里的本地服务几乎全部只监听 IPv4（3082 绑的是 127.0.0.1，
  //   8766/8444 绑的是 0.0.0.0），IPv6 回环上没有任何监听 →
  //   cloudflared 连 [::1]:PORT 被拒，公网表现为 502（或直接超时 000）：
  //     Unable to reach the origin service ... dial tcp [::1]:3082: connect: connection refused
  //   日志里明明写着 "Registered tunnel connection"、连接数也正常，
  //   所以很容易误判成"隧道没问题、是站点自己挂了"。
  //
  //   写死 127.0.0.1 就避开了这个歧义：它明确指向 IPv4 回环，与服务实际
  //   监听地址一致。对确实监听 IPv6 的服务，用户仍可在映射里手填 [::1]。
  function normalizeLocalhost(service) {
    return String(service || '').replace(
      /^(https?:\/\/)localhost(?=[:/]|$)/i,
      '$1127.0.0.1',
    )
  }

  function buildYaml(entries) {
    const withHost = entries.filter((e) => e.hostname)
    const catchAll = entries.find((e) => !e.hostname) || { hostname: null, service: 'http_status:404' }
    let y = `tunnel: ${TUNNEL_ID()}\ncredentials-file: ${CREDENTIALS_JSON}\n`
    // ── 传输协议（可选）──
    //
    // ⚠ 为什么必须支持这个字段：本函数每次启动 Named 隧道都会**整份重写**
    //   config.yml。旧版只写 tunnel/credentials-file/ingress 三项，于是用户
    //   手工加的 `protocol: http2` 会在下一次「启动」时被静默抹掉，隧道悄悄
    //   退回默认的 QUIC。
    //
    //   这在 UDP 接收缓冲区偏小的机器上是真问题：实测某台机器
    //   rmem 上限只有 416 KiB（期望 7168 KiB），QUIC 因此频繁丢包，
    //   4 条连接里常有一条反复重连，公网请求耗时在 2s–15s 之间剧烈抖动、
    //   约 40% 直接超时。HTTP/2 走 TCP，不受该限制。
    //
    //   所以这里从 cf_config.json 读 protocol 并原样写回（不设默认值：
    //   留空表示交给 cloudflared 自己决定，保持原有行为）。
    const proto = (cfMeta.protocol || '').trim()
    if (proto) y += `protocol: ${proto}\n`
    y += 'ingress:\n'
    for (const e of withHost) y += `  - hostname: ${e.hostname}\n    service: ${normalizeLocalhost(e.service)}\n`
    y += `  - service: ${normalizeLocalhost(catchAll.service)}\n`
    return y
  }

  // ───────────────────── ingress 缓存 ─────────────────────
  //
  // 为什么需要：readIngress 会调 Cloudflare 云端 API 取隧道配置，而容器到
  // api.cloudflare.com 的往返实测 0.85–2.16 秒（走国际出口，波动大）。
  // 面板每 10 秒自动刷新一次，每次都同步等这个 API，导致：
  //   • 打开面板要 2-3 秒才出内容（cf-status 实测 2.55–3.65s）
  //   • 每 10 秒卡顿一次
  //
  // 而隧道 ingress 极少变化（只在增删映射时变），故加短期缓存：
  //   • 默认 45 秒 TTL，命中则直接返回（本地文件读取是毫秒级）
  //   • writeIngress 成功后主动失效，保证增删映射立即反映
  //   • 失败不写缓存，避免把一次网络抖动固化 45 秒
  const INGRESS_CACHE_TTL = 45_000
  let ingressCache = { at: 0, value: null }

  function invalidateIngressCache() { ingressCache = { at: 0, value: null } }

  async function readIngress(opts = {}) {
    // 缓存命中（force 可绕过，用于需要绝对新鲜值的场景）
    if (!opts.force && ingressCache.value && Date.now() - ingressCache.at < INGRESS_CACHE_TTL) {
      return ingressCache.value
    }
    // 优先读云端隧道配置（remotely-managed 隧道的权威来源）；无 Token/失败回退本地 config.yml
    const cfg = await readCfConfig()
    if (cfg.apiToken) {
      const cloud = await cloudIngress(cfg)
      if (cloud) {
        ingressCache = { at: Date.now(), value: cloud }
        return cloud
      }
    }
    const r = await sh(`cat ${CONFIG_YML} 2>/dev/null || true`, 5000)
    const local = parseIngress(r.output || '')
    // 本地兜底也缓存，避免在云端持续失败时反复打 API
    ingressCache = { at: Date.now(), value: local }
    return local
  }

  async function writeIngress(entries) {
    // 1) 同步写本地 config.yml（备份/无 Token 时的降级）
    const yaml = buildYaml(entries)
    const b64 = Buffer.from(yaml, 'utf8').toString('base64')
    const wr = await sh(`echo '${b64}' | base64 -d > ${CONFIG_YML}`, 5000)
    if (!wr.ok) return { ok: false, error: '写入本地 config.yml 失败' }
    // 2) 云端 PUT（权威，remotely-managed 隧道即时生效并自动重载）
    const cfg = await readCfConfig()
    if (cfg.apiToken) {
      const res = await setCloudIngress(cfg, entries)
      if (!res.success) {
        const msg = (res.errors && res.errors[0] && res.errors[0].message) || '未知错误'
        return { ok: false, error: '云端配置更新失败: ' + msg }
      }
    }
    // 写入成功 → 主动失效缓存，让下一次 readIngress 拿到新值
    invalidateIngressCache()
    return { ok: true, cloudSynced: !!(cfg.apiToken) }
  }

  // 确保 credentials.json 存在且与当前 tunnelId 匹配；缺失时自动生成。
  //
  // 背景（2026-10-28 实测）：全新安装**不会**有 credentials.json——插件从不创建它，
  // 而 cloudflared 没有它就拒绝启动。旧实现直接报错让用户去「用 token 重新授权」
  // 或「从备份恢复」，这两条对新用户都不成立（没有备份、也不知道 token 在哪）。
  //
  // 实际上这个文件是可再生的：Cloudflare 有 `GET /accounts/{acc}/cfd_tunnel/{id}/token`
  // 端点，返回的隧道 token 是 base64(JSON)，解出来就是
  //   { a: AccountTag, t: TunnelID, s: TunnelSecret }
  // 正好是 credentials.json 需要的三个字段（字段名不同而已）。
  // 所以只要配了 API Token（且含 Cloudflare Tunnel:Read），就能自动补齐，
  // 用户不需要手工折腾。
  //
  // 顺带处理另一种静默故障：credentials.json 里的 TunnelID 与 cf_config.json 的
  // tunnelId 不一致（换过隧道、或从别的部署拷过来的文件）→ cloudflared 认证失败，
  // 日志只有一行难懂的 403。这里一并校验并重写。
  async function ensureCredentials(cfg) {
    const wantTunnel = TUNNEL_ID()
    if (!wantTunnel) return { ok: false, error: '尚未配置隧道 ID（tunnelId）' }

    // 1) 已有文件且 TunnelID 对得上 → 直接用
    const chk = await sh(`test -s ${CREDENTIALS_JSON} && echo yes || echo no`, 5000)
    if ((chk.output || '').includes('yes')) {
      const cur = await sh(`cat ${CREDENTIALS_JSON}`, 5000)
      let parsed = null
      try { parsed = JSON.parse(cur.output || '{}') } catch (e) { parsed = null }
      if (parsed && parsed.TunnelID === wantTunnel && parsed.AccountTag && parsed.TunnelSecret) {
        return { ok: true, existed: true }
      }
      // 内容不完整或隧道对不上 → 落到下面重新生成
    }

    // 2) 用 API Token 拉隧道 token 并解码
    if (!cfg.apiToken) {
      return {
        ok: false,
        error: '缺少 credentials.json，且未配置 API Token，无法自动生成。'
          + '请在设置页填入 Cloudflare API Token（需 Cloudflare Tunnel:Read），'
          + '或用该隧道的 token 运行一次 cloudflared tunnel run --token <TOKEN> 生成凭据。',
      }
    }
    const res = await cfApiGet(cfg, `/accounts/${ACCOUNT_ID()}/cfd_tunnel/${wantTunnel}/token`)
    if (!res.success || typeof res.result !== 'string' || !res.result) {
      const msg = (res.errors && res.errors[0] && res.errors[0].message) || '未知错误'
      return {
        ok: false,
        error: '自动生成 credentials.json 失败：' + msg
          + '（API Token 需含 Cloudflare Tunnel:Read 权限）',
      }
    }
    let dec = null
    try { dec = JSON.parse(Buffer.from(res.result, 'base64').toString('utf8')) } catch (e) { dec = null }
    if (!dec || !dec.a || !dec.t || !dec.s) {
      return { ok: false, error: '自动生成 credentials.json 失败：隧道 token 内容无法解析' }
    }
    const cred = { AccountTag: dec.a, TunnelID: dec.t, TunnelSecret: dec.s }
    const b64 = Buffer.from(JSON.stringify(cred, null, 2), 'utf8').toString('base64')
    // 权限 600：文件含 TunnelSecret，等同于隧道私钥，不能让同机其他用户读到
    const w = await sh(`mkdir -p ${CF_SETUP} && umask 077 && echo '${b64}' | base64 -d > ${CREDENTIALS_JSON} && chmod 600 ${CREDENTIALS_JSON}`, 5000)
    if (!w.ok) return { ok: false, error: '写入 credentials.json 失败：' + (w.output || '').slice(-200) }
    return { ok: true, existed: false, generated: true }
  }

  // 重启 Named 隧道（config 模式）：kill 现有进程 → nohup 启动（写 PID 文件）→ 等 metrics
  async function restartNamedTunnel() {
    // ⚠ 必须先确保二进制就位。
    //   历史 bug（2026-10-28 修复）：ensureCloudflared() 原先只在 cf-status 里调用，
    //   而真正启动隧道的两个函数都不调用它。于是「刚装完插件、面板还没轮询到
    //   cf-status」时点启动，拿到的错误是底层的
    //   `bash: .../cloudflared: No such file or directory`——用户完全看不出是
    //   「还没装好，稍等」。
    const inst = await ensureCloudflared()
    if (!inst.ok) return { error: 'cloudflared 尚未就绪：' + (inst.error || '自动安装未完成，请稍后重试') }

    // ⚠ 启动前必须确认两个文件都在，否则 cloudflared 会立刻退出，
    //   而面板只会显示「未运行」，看不到任何原因。
    //
    //   历史 bug（2026-10-28 实测）：运行目录里 config.yml 与 credentials.json
    //   都可能不存在（新装、或从备份恢复时只拷了 cf_config.json），而本函数
    //   原先直接 exec 二进制。表现是：点「启动」→ 提示「已启动（连接 0）」→
    //   状态始终「未运行」。日志里只有一行
    //     open .../config.yml: no such file or directory
    //   很容易被误判成"隧道启动不起来"。
    //   现在：config.yml 由 buildYaml 按当前 ingress 现生成（内容来自云端或
    //   本地，缺就写一份含 catch-all 的最小配置）；credentials.json 缺失时
    //   由 ensureCredentials 从 API Token 自动生成（见该函数注释），
    //   生成不了才报错并说明怎么补。
    const cfg0 = await readCfConfig()
    if (!TUNNEL_ID()) {
      return { error: '尚未配置隧道 ID（tunnelId）：请先在设置里填写，否则无法生成 config.yml' }
    }
    const cred = await ensureCredentials(cfg0)
    if (!cred.ok) return { error: cred.error }
    if (cred.generated) {
      console.log('dsh-cloudflared-manager: 已根据 API Token 自动生成 credentials.json')
    }

    // 按当前 ingress 重写 config.yml（幂等）。ingress 来源：云端优先，失败回退本地。
    // 这样即使文件不存在，也会被正确创建出来，而不是等 cloudflared 报错。
    const cur = await readIngress({ force: true })
    const entries = (cur && cur.length) ? cur : [{ hostname: null, service: 'http_status:404' }]
    const yamlBody = buildYaml(entries)
    const b64 = Buffer.from(yamlBody, 'utf8').toString('base64')
    const wrote = await sh(`mkdir -p ${CF_SETUP} && echo '${b64}' | base64 -d > ${CONFIG_YML}`, 5000)
    if (!wrote.ok) return { error: '写入 config.yml 失败：' + (wrote.output || '').slice(-200) }

    await killByPidFile(PIDS_DIR + '/dsh-cf-named.pid')
    await killByCmd(CLOUDFLARED_BIN + ' tunnel --config')
    await new Promise((resolve) => setTimeout(resolve, 1200))
    await sh(`mkdir -p ${PIDS_DIR} ${LOGS_DIR} 2>/dev/null || true`, 5000)
    const start = await sh(
      `bash -c 'exec ${CLOUDFLARED_BIN} tunnel --config ${CONFIG_YML} run > ${LOGS_DIR}/dsh-cf-named.log 2>&1' & echo $! > ${PIDS_DIR}/dsh-cf-named.pid`,
      10000,
    )
    if (!start.ok) return { error: '隧道启动失败: ' + (start.output || '') }

    // 等连接建立，同时**确认进程真的活着**。
    //
    // ⚠ 历史 bug（2026-10-28 修复）：原先只等 connections > 0 就返回，
    //   等不到也照样 return { ok:true, connections:0 }。当 cloudflared 因为
    //   config.yml 缺失等原因秒退时，面板显示的是「Named 隧道已启动（连接 0）」
    //   —— 启动了、但状态永远「未运行」，两条信息自相矛盾。
    //   现在：每轮都探 PID 是否存活；进程已退出就立刻返回失败，并把日志尾部
    //   带出来，让「为什么起不来」一眼可见，而不用去翻日志文件。
    const pidFile = PIDS_DIR + '/dsh-cf-named.pid'
    let conns = 0
    let alive = false
    for (let i = 0; i < 12; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const chk = await sh(`if [ -s ${pidFile} ]; then kill -0 "$(cat ${pidFile})" 2>/dev/null && echo yes || echo no; else echo no; fi`, 3000)
      alive = (chk.output || '').includes('yes')
      conns = await namedConnections()
      if (conns > 0) break
      // 进程已死且没连上，继续等没有意义（多半是配置/凭据问题）
      if (!alive && i >= 2) break
    }
    if (!alive && conns === 0) {
      const tail = await sh(`tail -5 ${LOGS_DIR}/dsh-cf-named.log 2>/dev/null || true`, 5000)
      const msg = String(tail.output || '').trim()
      return {
        error: 'cloudflared 启动后立即退出，隧道未运行'
          + (msg ? '。日志尾部：' + msg.slice(-400) : '（无日志输出）'),
        launched: false,
      }
    }
    return { ok: true, connections: conns, alive }
  }

  async function stopNamedTunnel() {
    const killed = await killByPidFile(PIDS_DIR + '/dsh-cf-named.pid')
    await killByCmd(CLOUDFLARED_BIN + ' tunnel --config')
    return { ok: true, killedPid: killed }
  }

  // ---------------- 本地服务管理（自定义命令） ----------------

  async function readServices() {
    const r = await sh(`cat ${SERVICES_FILE} 2>/dev/null || echo '[]'`, 5000)
    try {
      const arr = JSON.parse(r.output || '[]')
      return Array.isArray(arr) ? arr : []
    } catch (e) { return [] }
  }

  async function writeServices(list) {
    const b64 = Buffer.from(JSON.stringify(list, null, 2), 'utf8').toString('base64')
    return sh(`echo '${b64}' | base64 -d > ${SERVICES_FILE}`, 5000)
  }

  async function svcRunning(svc) {
    // PID 文件探活（kill -0，沙箱可用）优先；再补命令片段匹配 / 端口探测
    const logName = 'dsh-svc-' + svcFileKey(svc.name || 'svc')
    // ⚡ 优化：把「读 PID + kill -0 + curl 端口」合并成一次 sh 调用。
    //   原先每个服务要 3 次 sh（读 pid / kill -0 / curl），9 个服务串行 = 27 次 shell
    //   往返，是 cf-svc-list / cf-status 慢的次因。合并后只需 1 次往返，
    //   并让调用方（cf-status）用 Promise.all 并发跑多个服务。
    //
    // ⚠ 历史 bug（2026-10-28 修复）：这里原本读 /tmp/<logName>.pid，
    //   但 startService 写的是 PIDS_DIR/<logName>.pid（cloudflared-setup/pids/）。
    //   读写路径不一致 → PID 探活永远读不到文件 → 恒判「未运行」。
    //   两处都用 PIDS_DIR，并保留 /tmp 旧路径作为兜底（历史残留文件）。
    const portProbe = svc.port
      ? `; if [ -n "${svc.port}" ]; then c=$(curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:${svc.port}/ 2>/dev/null || true); echo "PORT:$c"; fi`
      : ''
    const r = await sh(
      `p=$(cat ${PIDS_DIR}/${logName}.pid 2>/dev/null || cat /tmp/${logName}.pid 2>/dev/null || true); ` +
      `if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then echo "PIDALIVE:1"; else echo "PIDALIVE:0"; fi` +
      portProbe,
      8000,
    )
    const out = r.output || ''
    const pidAlive = out.includes('PIDALIVE:1')
    const portCode = (out.match(/PORT:(\S*)/) || [])[1] || ''
    const portOk = portCode !== '' && portCode !== '000'
    const frag = svcCmdFrag(svc)
    const proc = pidAlive || (frag ? countProcByCmd(frag) > 0 : false)
    return { running: proc || portOk, proc, portOk }
  }

  async function startService(svc) {
    const cmd = (svc.command || '').trim()
    if (!cmd) return { error: '缺少启动命令' }
    const cwd = svc.cwd || '/'
    const logName = 'dsh-svc-' + svcFileKey(svc.name || 'svc')
    const logPath = LOGS_DIR + '/' + logName + '.log'
    const pidFile = PIDS_DIR + '/' + logName + '.pid'
    await sh(`mkdir -p ${PIDS_DIR} ${LOGS_DIR} ${cwd} 2>/dev/null || true; rm -f ${pidFile}`, 5000)
    const q = (x) => String(x).replace(/'/g, "'\\''")
    const start = await sh(`bash -c 'cd ${q(cwd)} && exec ${q(cmd)} > ${q(logPath)} 2>&1' & echo $! > ${pidFile}`, 10000)
    if (!start.ok) return { error: '启动失败: ' + (start.output || '') }
    await new Promise((r) => setTimeout(r, 3000))
    const st = await svcRunning(svc)
    return { ok: true, pid: start.output.trim(), running: st.running, logPath }
  }

  // 从启动命令里提取「足以唯一定位进程」的特征串，用于进程探活。
  //
  // ⚠ 历史 bug（2026-10-28 修复）：原实现取命令前 4 个词做 startsWith 匹配，
  //   对这两类命令完全失效（实测漏判 dsh-pocket、kaggle-worker）：
  //     a) `/usr/bin/env VAR=x VAR2=y /path/prog ...` —— 前 4 词只到变量，
  //        真实 cmdline 里 env 已被 exec 掉，根本不以这些词开头；
  //     b) 命令含内联脚本 `node -e "..."` —— 引号被剥掉后与真实 cmdline 不符。
  //
  //   改为：按「具体程度」挑 token，优先级如下（实测这版才既准又不漏）：
  //     1) 脚本文件路径：以 .js/.mjs/.cjs/.py/.sh 结尾 —— 最具体，必唯一
  //        （dsh-pocket-lite.mjs、worker.py、pocket-tunnel.sh）
  //        注意：命令里常写相对脚本名（`node serve.js 8097`），真实 cmdline 里
  //        也是相对形式，所以**相对脚本名同样可用**，不必要求含 /。
  //     2) 其它带 / 的路径参数，但**排除通用可执行目录**里的裸解释器
  //        （/usr/local/bin/node、/usr/bin/python3 这类会命中所有
  //         node/python 进程，是假阳性之源）
  //     3) 实在没有路径就退化成第一个词（要求 ≥3 字符）
  function svcCmdFrag(svc) {
    const cmd = String(svc.command || '').trim().replace(/\s+/g, ' ')
    if (!cmd) return ''
    const toks = cmd.split(/\s+/).map((t) => t.replace(/^["']|["']$/g, '')).filter(Boolean)
    const isVar = (t) => /^[A-Z_][A-Z0-9_]*=/.test(t)
    const isScript = (t) => /\.(js|mjs|cjs|ts|py|sh|bash)$/i.test(t)
    // 通用解释器/运行器：单独出现时毫无区分度，必须排除
    const isGeneric = (t) => /\/(node|nodejs|python\d?(\.\d+)?|bash|sh|env|npx|deno|bun)$/i.test(t)

    // 1) 脚本名（绝对或相对都行），但排除纯解释器
    const scripts = toks.filter((t) => !isVar(t) && isScript(t) && !isGeneric(t))
    if (scripts.length) {
      // 多个时优先带 / 的（更具体），其次取最长
      scripts.sort((a, b) => (b.includes('/') - a.includes('/')) || (b.length - a.length))
      return scripts[0]
    }
    const paths = toks.filter((t) => !isVar(t) && t.includes('/') && !isGeneric(t))
    if (paths.length) {
      paths.sort((a, b) => b.length - a.length)
      return paths[0]
    }
    // 4) 内联脚本（`node -e "..."`）没有任何可辨识路径，此时返回空串，
    //    让调用方退回「端口探活」这一条路——宁可探不到，也不要拿通用解释器
    //    路径去 includes 匹配（那会把所有 node 进程都算成这个服务）。
    return ''
  }

  async function stopService(svc) {
    const logName = 'dsh-svc-' + svcFileKey(svc.name || 'svc')
    const pidFile = PIDS_DIR + '/' + logName + '.pid'
    // 先记下 pid 再杀（killByPidFile 会删掉文件）
    const rootPid = pidOfFile(pidFile)
    // ⚠ 子进程残留（2026-10-28 实测发现）：
    //   pocket-aliyun-tunnel 这类服务本体是 bash 守护脚本，真正的隧道由它
    //   fork 出来的 `ssh -R ...` 子进程承担。只杀父进程 → ssh 变孤儿继续跑，
    //   反向隧道仍占着服务器端 3083 端口，下次启动 `ssh -R` 会因
    //   ExitOnForwardFailure 直接退出，表现为「服务启动成功但域名一直不通」。
    //
    // ★ 顺序至关重要（第一版写错过，实测 killedChildren:0 且 ssh 仍残留）：
    //   必须在杀父进程**之前**收集并杀掉子孙。一旦父进程先死，子进程的 ppid
    //   会被内核重新挂到 init(1)，进程树当场断链，再想按 ppid 找就找不到了。
    const extra = await killDescendants(rootPid)
    const killed = await killByPidFile(pidFile)
    await killByCmd(svcCmdFrag(svc))
    // 兜底再杀一次：killByCmd 之后可能还有新 fork 出来的（如 ssh 重连守护）
    await killDescendants(rootPid)
    return { ok: true, killedPid: killed, killedChildren: extra }
  }

  // 读取 PID 文件里的 pid（读不到返回 null）
  function pidOfFile(file) {
    try {
      const p = parseInt(fs.readFileSync(file, 'utf8').trim(), 10)
      return Number.isFinite(p) && p > 0 ? p : null
    } catch (e) { return null }
  }

  // 递归杀掉某进程的所有子孙（先收集再统一杀，避免杀了父进程后子树断链找不到）
  async function killDescendants(rootPid) {
    if (!rootPid) return 0
    const parentOf = new Map()   // pid -> ppid
    let entries = []
    try { entries = fs.readdirSync('/proc') } catch (e) { return 0 }
    for (const d of entries) {
      if (!/^\d+$/.test(d)) continue
      try {
        const stat = fs.readFileSync('/proc/' + d + '/stat', 'utf8')
        // 格式：pid (comm) state ppid ...；comm 可能含空格和括号，
        // 所以从最后一个 ')' 之后开始切，字段顺序才是 state/ppid。
        const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
        const ppid = parseInt(rest[1], 10)
        if (Number.isFinite(ppid)) parentOf.set(Number(d), ppid)
      } catch (e) { /* 进程已退出 */ }
    }
    const victims = []
    const queue = [rootPid]
    const seen = new Set([rootPid])
    while (queue.length) {
      const cur = queue.shift()
      for (const [pid, ppid] of parentOf) {
        if (ppid === cur && !seen.has(pid)) { seen.add(pid); victims.push(pid); queue.push(pid) }
      }
    }
    if (victims.length === 0) return 0
    await sh(`kill -9 ${victims.join(' ')} 2>/dev/null || true`, 5000)
    return victims.length
  }

  // ---------------- 快速隧道（trycloudflare） ----------------

  // 扫描快速隧道：读 PID 文件（PIDS_DIR/dsh-cf-<port>.pid）+ kill -0 探活（沙箱读 /proc 受限）
  async function scanQuickTunnels() {
    // ⚡ 优化：原先对每个 pid 文件做 3 次 sh（cat / kill -0 / grep 日志）。
    //   pids/ 目录里常年有若干已失效的残留 pid 文件（实测 4 个），
    //   串行累加后成为 cf-status 剩余约 1s 耗时的主因。
    //
    //   改为：一次 sh 完成「遍历 → 判活 → 取 URL」，输出结构化行，
    //   Node 侧只做解析。残留文件也不再被反复 spawn。
    const r = await sh(
      `for f in ${PIDS_DIR}/dsh-cf-*.pid; do ` +
      `[ -e "$f" ] || continue; ` +
      `port=$(basename "$f" | sed -E 's/^dsh-cf-([0-9]+)\\.pid$/\\1/'); ` +
      `[ -n "$port" ] || continue; ` +
      `pid=$(cat "$f" 2>/dev/null || true); ` +
      `[ -n "$pid" ] || continue; ` +
      `if kill -0 "$pid" 2>/dev/null; then ` +
      `url=$(grep -oE 'https://[a-z0-9-]+\\.trycloudflare\\.com' ${LOGS_DIR}/dsh-cf-$port.log 2>/dev/null | head -1 || true); ` +
      `echo "$port|$pid|$url"; ` +
      `fi; ` +
      `done`,
      12000,
    )
    const maps = []
    for (const line of (r.output || '').split('\n')) {
      const t = line.trim()
      if (!t.includes('|')) continue
      const [port, pid, url] = t.split('|')
      const p = parseInt(port, 10)
      const pd = parseInt(pid, 10)
      if (!Number.isFinite(p) || !Number.isFinite(pd)) continue
      maps.push({ port: p, pid: pd, url: (url || '').trim(), status: 'running' })
    }
    return maps
  }

  async function startQuickTunnel(port) {
    const p = parseInt(port, 10)
    if (!Number.isFinite(p) || p < 1 || p > 65535) return { error: '端口无效' }
    // 与 restartNamedTunnel 同理：启动前先确保二进制就位，
    // 否则会把底层的 "No such file or directory" 直接抛给用户。
    const inst = await ensureCloudflared()
    if (!inst.ok) return { error: 'cloudflared 尚未就绪：' + (inst.error || '自动安装未完成，请稍后重试') }
    const existing = await scanQuickTunnels()
    if (existing.some((m) => m.port === p)) return { error: `端口 ${p} 已有快速隧道在运行` }
    const logPath = `${LOGS_DIR}/dsh-cf-${p}.log`
    await sh(`mkdir -p ${PIDS_DIR} ${LOGS_DIR} 2>/dev/null || true; rm -f ${logPath} ${PIDS_DIR}/dsh-cf-${p}.pid`, 5000)
    const start = await sh(
      `bash -c 'exec ${CLOUDFLARED_BIN} tunnel --url http://localhost:${p} --no-autoupdate > ${logPath} 2>&1' & echo $! > ${PIDS_DIR}/dsh-cf-${p}.pid`,
      10000,
    )
    if (!start.ok) return { error: '启动失败: ' + (start.output || 'exit ' + start.exitCode) }
    let url = ''
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const lr = await sh(`grep -oE 'https://[a-z0-9-]+\\.trycloudflare\\.com' ${logPath} | head -1 || true`, 5000)
      const found = (lr.output || '').trim()
      if (found) { url = found; break }
      const fr = await sh(`grep -iE 'ERR|failed to start|error' ${logPath} | head -2 || true`, 5000)
      if ((fr.output || '').trim()) break
    }
    const maps = await scanQuickTunnels()
    const map = maps.find((m) => m.port === p)
    if (!map) return { error: '隧道进程未检测到，日志尾部: ' + String((await sh(`tail -5 ${logPath}`, 5000)).output).slice(0, 200) }
    return { ok: true, port: p, pid: map.pid, url: url || '（等待中，稍后刷新获取 URL）' }
  }

  async function stopQuickTunnel(port) {
    const p = parseInt(port, 10)
    const maps = await scanQuickTunnels()
    const map = maps.find((m) => m.port === p)
    if (!map) return { ok: true, port: p, stopped: false, message: '该端口没有运行中的快速隧道' }
    await sh(`kill ${map.pid} 2>/dev/null || true; rm -f ${PIDS_DIR}/dsh-cf-${p}.pid`, 5000)
    return { ok: true, port: p, stopped: true, pid: map.pid }
  }

  async function routeApi(method, args) {


        if (method === 'cf-status') {
          const inst = await ensureCloudflared()
          // ⚡ 一次 probeMetrics 同时拿到 running 与 connections，
          //    取代原先 isNamedRunning() + namedConnections() 两次重复探测。
          const [metrics, maps, ingress, services, cfg] = await Promise.all([
            probeMetrics(), scanQuickTunnels(), readIngress(), readServices(), readCfConfig(),
          ])
          const running = metrics.running
          const conns = metrics.connections
          // 只有 Named 隧道真的在跑时才展示「已连接数」；
          // 快速隧道占着 metrics 端口时 conns 会是它的连接数，不能算到 Named 头上。
          const namedConns = running ? conns : 0
          // ⚡ 并发探活：原先 for-await 串行，9 个服务逐个等待；
          //    改为 Promise.all 并发，避免耗时线性累加。
          const svcList = await Promise.all(services.map(async (s) => {
            const st = await svcRunning(s)
            return { ...s, running: st.running, proc: st.proc, portOk: st.portOk }
          }))
          return {
            cloudflared: { installed: inst.ok, installedNow: inst.installedNow || false, error: inst.error || null },
            namedTunnel: {
              running, healthy: running && namedConns > 0, tunnelId: TUNNEL_ID(), connections: namedConns,
              mode: '本地 config.yml（可增删改查）',
              // 排障信息：metrics 端口被非 Named 进程（通常是快速隧道）占用时，
              // 说明「有 cloudflared 在跑，但它不是 Named 隧道」，前端可据此提示。
              metricsPort: metrics.port || null,
              metricsPid: metrics.pid || null,
              metricsOwnerNote: metricsPortOwnerNote,
              // 每条映射带上解析出的首级域名，前端可直接展示"这个映射挂在哪个域名下"，
              // 也能一眼看出历史上的建歪记录（apex 为 null 的通常是 xxx.other.tld 形态）。
              ingress: ingress.map((e) => ({ ...e, apex: e.hostname ? resolveApex(e.hostname) : null })),
            },
            services: svcList,
            quickTunnels: maps,
            binPath: CLOUDFLARED_BIN,
            cfApi: { tokenSet: !!(cfg.apiToken) },
            // Named 隧道「随 DSH 自动启动」开关的真值（落盘在 cf_config.json）。
            // 面板用它回填勾选框。⚠ 不要用 managed[] 里的进程存活状态代替：
            // managed 只跟踪 spawnManaged 起的进程，Named 隧道走的是 nohup +
            // PID 文件，压根不在里面，用它会恒判为 false。
            autoStart: !!cfg.autoStart,
            // 凭据自检：新装环境下 credentials.json 是不存在的。
            // 这里只做「文件在不在 + 隧道 ID 对不对」的读校验，不触发网络请求，
            // 面板可据此提示「首次启动会自动生成」，而不是让用户去猜为什么起不来。
            credentials: await (async () => {
              try {
                const txt = fs.readFileSync(CREDENTIALS_JSON, 'utf8')
                const o = JSON.parse(txt)
                return {
                  exists: true,
                  tunnelMatch: o.TunnelID === TUNNEL_ID(),
                  hasSecret: !!o.TunnelSecret && !!o.AccountTag,
                }
              } catch (e) { return { exists: false } }
            })(),
            // 快速隧道的 URL 改写代理前缀：前端据此决定是显示代理地址还是「未配置」。
            // 放在 cf-status 里一起返回，避免面板每轮刷新再多打一次接口。
            proxyPrefix: typeof cfg.proxyPrefix === 'string' ? cfg.proxyPrefix : '',
            // 可自选的「首级域名」白名单：前端据此渲染下拉，顺序即展示顺序
            zoneWhitelist: ZONE_WHITELIST(),
            managed: Array.from(managedProcs.entries()).map(([name, st]) => ({ name, type: st.type, alive: !st.proc.killed })),
          }
        } else if (method === 'cf-whitelist-add') {
          // 单独增删根域名白名单：**不要求已配 API Token**，
          // 因为白名单本身是本地安全边界，与 token 无关。
          // （cf-cfg-set 会因为没 token 直接拒绝，不能复用它做这件事。）
          const raw = typeof args.apex === 'string' ? args.apex.trim() : ''
          if (!raw) return { error: '根域名不能为空' }
          // 归一化：去协议、去路径、去通配、去尾点、转小写。
          // 用户常从浏览器地址栏直接粘贴 https://example.com/xxx 或 *.example.com，
          // 这里统一清洗，避免存进去一个永远匹配不上的串。
          const apex = raw
            .replace(/^[a-z]+:\/\//i, '')
            .replace(/\/.*$/, '')
            .replace(/^\*\./, '')
            .replace(/\.$/, '')
            .toLowerCase()
          // 只接受「域名」形态：至少两段、只含字母数字连字符与点，且不含端口/空格。
          // 不做严格的 TLD 校验（内网/测试域名也常见），但必须能当 hostname 后缀用。
          if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(apex)) {
            return { error: `不像一个根域名：${raw}（示例：example.com）` }
          }
          const cfg = await readCfConfig()
          const list = Array.isArray(cfg.zoneWhitelist) ? cfg.zoneWhitelist : []
          if (list.includes(apex)) return { ok: true, apex, zoneWhitelist: list, already: true }
          list.push(apex)
          cfg.zoneWhitelist = list
          await writeCfConfig(cfg)
          await refreshCfMeta()
          zoneIdCache.clear()
          return { ok: true, apex, zoneWhitelist: cfMeta.zoneWhitelist }
        } else if (method === 'cf-whitelist-remove') {
          const raw = typeof args.apex === 'string' ? args.apex.trim().toLowerCase() : ''
          if (!raw) return { error: '根域名不能为空' }
          const cfg = await readCfConfig()
          const list = Array.isArray(cfg.zoneWhitelist) ? cfg.zoneWhitelist : []
          const next = list.filter((z) => String(z).toLowerCase() !== raw)
          if (next.length === list.length) return { ok: true, removed: false, zoneWhitelist: list }
          cfg.zoneWhitelist = next
          await writeCfConfig(cfg)
          await refreshCfMeta()
          zoneIdCache.clear()
          return { ok: true, removed: true, zoneWhitelist: cfMeta.zoneWhitelist }
        } else if (method === 'cf-cfg-set') {
          const apiToken = typeof args.apiToken === 'string' ? args.apiToken.trim() : ''
          const cfg = await readCfConfig()
          // apiToken 允许只改账号字段而不动 token（传空串表示不修改）
          if (apiToken) cfg.apiToken = apiToken
          else if (!cfg.apiToken) return { error: '缺少 API Token' }
          // 账号级字段（开源后由用户自己填，代码里不再硬编码）
          if (typeof args.tunnelId === 'string') cfg.tunnelId = args.tunnelId.trim()
          if (typeof args.accountId === 'string') cfg.accountId = args.accountId.trim()
          if (Array.isArray(args.zoneWhitelist)) {
            cfg.zoneWhitelist = args.zoneWhitelist.map((z) => String(z).trim().toLowerCase()).filter(Boolean)
          }
          // 隧道传输协议：'http2' / 'quic' / ''（清空＝交给 cloudflared 决定）。
          // 其他值一律拒绝——config.yml 里的 protocol 写错 cloudflared 会直接起不来。
          if (typeof args.protocol === 'string') {
            const p = args.protocol.trim().toLowerCase()
            if (p && p !== 'http2' && p !== 'quic') {
              return { error: `不支持的协议：${args.protocol}（可选 http2 / quic / 留空）` }
            }
            cfg.protocol = p
          }
          await writeCfConfig(cfg)
          await refreshCfMeta()
          zoneIdCache.clear()   // zone 可能变了，清掉解析缓存
          return {
            ok: true, apiToken: '***',
            tunnelId: cfMeta.tunnelId, accountId: cfMeta.accountId, zoneWhitelist: cfMeta.zoneWhitelist,
            protocol: cfMeta.protocol,
          }
        } else if (method === 'cf-cfg-get') {
          // 把账号级配置一并返回，便于用户对照/迁移（token 只回是否已设置）
          const cfg = await readCfConfig()
          return {
            ok: true,
            // ⚠ 不要回明文 token；只回「是否已配置」。
            tokenSet: !!cfg.apiToken,
            // 兼容字段：早期前端只读这两个，保留以免老版本面板拿不到值。
            apiToken: cfg.apiToken || '',
            autoStart: !!cfg.autoStart,
            tunnelId: cfMeta.tunnelId,
            accountId: cfMeta.accountId,
            zoneWhitelist: cfMeta.zoneWhitelist,
            // 隧道传输协议：'' 表示未指定（cloudflared 默认 QUIC）
            protocol: cfMeta.protocol,
            // 快速隧道的「URL 改写代理前缀」：留空表示不启用改写，只给原始直连地址。
            proxyPrefix: typeof cfg.proxyPrefix === 'string' ? cfg.proxyPrefix : '',
          }
        } else if (method === 'cf-proxy-prefix-get') {
          const cfg = await readCfConfig()
          return { ok: true, proxyPrefix: typeof cfg.proxyPrefix === 'string' ? cfg.proxyPrefix : '' }
        } else if (method === 'cf-proxy-prefix-set') {
          // 只改这一个字段，**不要求已配 API Token**——快速隧道本来就不需要账号，
          // 而 cf-cfg-set 会因为没有 token 直接拒绝，不能复用它。
          const raw = typeof args.proxyPrefix === 'string' ? args.proxyPrefix.trim() : ''
          // 留空 = 关闭改写。非空时必须是个 http(s) URL 前缀，否则拼出来是坏链。
          if (raw && !/^https?:\/\/\S+$/i.test(raw)) {
            return { error: '代理前缀必须以 http:// 或 https:// 开头，或留空表示不启用' }
          }
          // 统一补尾部 /：否则 "https://p.example.com/https" + "xxx.trycloudflare.com"
          // 会粘成 ".../httpsxxx.trycloudflare.com" 这种坏链（最容易踩的一处）。
          const normalized = raw && !raw.endsWith('/') ? raw + '/' : raw
          const cfg = await readCfConfig()
          cfg.proxyPrefix = normalized
          await writeCfConfig(cfg)
          return { ok: true, proxyPrefix: normalized }
        } else if (method === 'cf-cfg-auto-start-get') {
          const cfg = await readCfConfig()
          return { autoStart: !!cfg.autoStart }
        } else if (method === 'cf-cfg-auto-start-set') {
          const cfg = await readCfConfig()
          cfg.autoStart = !!args.autoStart
          await writeCfConfig(cfg)
          return { ok: true, autoStart: cfg.autoStart }
        } else if (method === 'cf-probe') {
          const p1 = await sh(`cat /proc/net/tcp 2>&1 | head -2 || true`, 5000)
          const p2 = await sh(`cat /proc/1/cmdline 2>&1 | tr '\\0' ' ' | head -c 80 || true`, 5000)
          const p3 = await sh(`ls /proc/net 2>&1 || true`, 5000)
          const p4 = await sh(`echo 123 > /tmp/probe-test && cat /tmp/probe-test || true`, 5000)
          const p5 = await sh(`n=0; for f in /proc/[0-9]*/cmdline; do n=$((n+1)); done; echo "proc_files=$n"`, 5000)
          const p6 = await sh(`for f in /proc/[0-9]*/cmdline; do c=$(cat "$f" 2>/dev/null | tr -d '\\x00'); case "$c" in *http.server*8080*) echo "match8080";; esac; done || true`, 5000)
          const p7 = await sh(`for f in /proc/[0-9]*/cmdline; do c=$(tr '\\x00' ' ' < "$f" 2>/dev/null); case "$c" in *tini*) echo "tini_found";; esac; done || true`, 5000)
          return { netTcp: (p1.output || '').slice(0, 200), proc1: (p2.output || '').slice(0, 120), netList: (p3.output || '').slice(0, 200), tmpWrite: (p4.output || '').slice(0, 60), procFiles: (p5.output || '').trim(), match8080: (p6.output || '').trim() || '无', tiniMatch: (p7.output || '').trim() || '无' }
        } else if (method === 'cf-cfg-test') {
          const cfg = await readCfConfig()
          if (!cfg.apiToken) return { ok: false, error: '未配置 API Token' }
          const ver = await cfApiGet(cfg, '/user/tokens/verify')
          // 多 zone 模型的校验口径：逐个探白名单里的首级域名，而不是只看一个 zoneId。
          // 这样面板「测试」按钮能如实告诉用户"哪些域名可用、哪个不行"。
          const zones = []
          for (const apex of ZONE_WHITELIST()) {
            const zr = await cfApiGet(cfg, '/zones?name=' + encodeURIComponent(apex))
            const z = zr.success && zr.result && zr.result[0]
            let dns = false
            if (z) {
              const rec = await cfApiGet(cfg, `/zones/${z.id}/dns_records?per_page=1`)
              dns = rec.success === true
              if (dns) zoneIdCache.set(apex, z.id)
            }
            zones.push({ apex, zoneId: z ? z.id : null, dnsAccess: dns, ok: !!(z && dns) })
          }
          const okZones = zones.filter((z) => z.ok)
          const badZones = zones.filter((z) => !z.ok)
          return {
            ok: ver.success === true && okZones.length > 0,
            tokenValid: ver.success === true,
            zoneId: (okZones[0] && okZones[0].zoneId) || null,
            dnsAccess: okZones.length > 0,
            zones,
            message: !ver.success
              ? 'Token 无效'
              : (okZones.length === 0
                ? 'Token 有效，但没有任何白名单域名可用（检查 Zone:Read / DNS:Edit 权限）'
                : `Token 有效，可自动同步 DNS 的域名：${okZones.map((z) => z.apex).join('、')}` +
                  (badZones.length ? `；不可用：${badZones.map((z) => z.apex).join('、')}` : '')),
          }
        } else if (method === 'cf-zones') {
          // 供前端渲染「根域名」下拉。
          //
          // 返回两份数据：
          //   zones        白名单内的域名，逐条附 zoneId 与可解析性（旧契约，保留）
          //   available    账号下**全部** zone（来自 Cloudflare API），用于下拉候选
          //
          // 为什么要拉全量：白名单是要用户从自己已有的域名里挑，让他手打
          // "example.com" 既费事又容易打错（打错就会存进一个永远匹配不上的串，
          // 之后建映射全被拒，还看不出为什么）。既然 Token 有 Zone:Read，
          // 直接把账号下的域名列出来让人选即可。
          //
          // 无 Token / 无 Zone:Read 时 available 为空，前端自动退回手输。
          const cfg = await readCfConfig()
          const whitelist = ZONE_WHITELIST()
          const zones = []
          for (const apex of whitelist) {
            let zoneId = zoneIdCache.get(apex) || null
            if (!zoneId && cfg.apiToken) {
              const zr = await cfApiGet(cfg, '/zones?name=' + encodeURIComponent(apex))
              const z = zr.success && zr.result && zr.result[0]
              if (z) { zoneId = z.id; zoneIdCache.set(apex, zoneId) }
            }
            zones.push({ apex, zoneId, resolvable: !!zoneId })
          }

          let available = []
          let totalCount = 0
          if (cfg.apiToken) {
            // 一次拉最多 50 个（单账号域名数通常远小于此）。超出部分不翻页，
            // 只把总数回传，避免为一个下拉框连打多次 API 拖慢面板。
            const lr = await cfApiGet(cfg, '/zones?per_page=50&page=1')
            if (lr.success && Array.isArray(lr.result)) {
              available = lr.result
                .filter((z) => z && typeof z.name === 'string')
                .map((z) => ({
                  name: String(z.name).toLowerCase(),
                  status: z.status || '',
                  zoneId: z.id || null,
                  inWhitelist: whitelist.includes(String(z.name).toLowerCase()),
                }))
                .sort((a, b) => a.name.localeCompare(b.name))
              totalCount = (lr.result_info && lr.result_info.total_count) || available.length
            }
          }
          // 一并回传 tokenSet / zoneRead：
          // 前端要区分「没配 Token」「有 Token 但缺 Zone:Read」「列表为空」，
          // 才能给出准确的状态说明，而不是笼统说"获取失败"。
          return {
            zones, whitelist, available, totalCount,
            tokenSet: !!cfg.apiToken,
            // 有 Token 却一个 zone 都没拿到 → 基本可判定缺 Zone:Read 权限
            zoneRead: cfg.apiToken ? available.length > 0 : false,
          }
        } else if (method === 'cf-maps') {
          return { quickTunnels: await scanQuickTunnels() }
        } else if (method === 'cf-map-add') {
          return await startQuickTunnel(args.port)
        } else if (method === 'cf-map-stop') {
          return await stopQuickTunnel(args.port)
        } else if (method === 'cf-named-start') {
          killManaged('named')
          return await restartNamedTunnel()
        } else if (method === 'cf-named-stop') {
          killManaged('named')
          return await stopNamedTunnel()
        } else if (method === 'cf-named-list') {
          return { ingress: await readIngress() }
        } else if (method === 'cf-named-add') {
          const hostname = typeof args.hostname === 'string' ? args.hostname.trim() : ''
          const service = typeof args.service === 'string' ? args.service.trim() : ''
          if (!hostname || !service) return { error: '缺少 hostname 或 service' }
          // ★ 白名单校验前置：不合格的域名**整单拒绝**，不写 ingress。
          //   若只校验 DNS 而放行 ingress，会留下"映射进了隧道、但域名永远打不开"
          //   的半成品状态，比直接拒绝更难排查。
          const apex = resolveApex(hostname)
          if (!apex) {
            return { error: `域名 ${hostname} 不在可自选范围内，仅支持：${ZONE_WHITELIST().map((z) => 'xxx.' + z).join(' / ')}` }
          }
          // 首级域名本身不能当映射（会与 zone 自己的记录冲突）
          if (hostname === apex) return { error: `不能直接把首级域名 ${apex} 用作映射，请用子域名（如 xxx.${apex}）` }
          // ⚠️ 编辑流程必须绕过缓存：这是「读-改-写」，若读到过期数据会把
          //    中间新增的映射覆盖掉（整份 ingress 是 PUT 全量替换）。
          const entries = await readIngress({ force: true })
          if (entries.some((e) => e.hostname === hostname)) return { error: `hostname ${hostname} 已存在` }
          entries.splice(entries.length - 1, 0, { hostname, service })
          const wr = await writeIngress(entries)
          if (!wr.ok) return { error: (wr && wr.error) || '写入隧道配置失败' }
          const cfg = await readCfConfig()
          const dns = cfg.apiToken ? await ensureDns(cfg, hostname) : { ok: false, error: '未配置 API Token' }
          return { ok: true, hostname, service, apex, restarted: { ok: true, autoReload: true, message: '云端配置已更新，隧道自动重载' }, dns: dns.ok ? { ok: true, apex: dns.apex || apex } : { ok: false, error: dns.error || '' } }
        } else if (method === 'cf-named-update') {
          const hostname = typeof args.hostname === 'string' ? args.hostname.trim() : ''
          const service = typeof args.service === 'string' ? args.service.trim() : ''
          if (!hostname || !service) return { error: '缺少 hostname 或 service' }
          const entries = await readIngress({ force: true })   // 读写流程，绕过缓存
          const e = entries.find((x) => x.hostname === hostname)
          if (!e) return { error: `hostname ${hostname} 不存在` }
          e.service = service
          const wr = await writeIngress(entries)
          if (!wr.ok) return { error: (wr && wr.error) || '写入隧道配置失败' }
          return { ok: true, hostname, service, restarted: { ok: true, autoReload: true, message: '云端配置已更新，隧道自动重载' } }
        } else if (method === 'cf-named-delete') {
          const hostname = typeof args.hostname === 'string' ? args.hostname.trim() : ''
          if (!hostname) return { error: '缺少 hostname' }
          const entries = await readIngress({ force: true })   // 读写流程，绕过缓存
          const next = entries.filter((e) => e.hostname !== hostname)
          if (next.length === entries.length) return { error: `hostname ${hostname} 不存在` }
          const wr = await writeIngress(next)
          if (!wr.ok) return { error: (wr && wr.error) || '写入隧道配置失败' }
          const cfg = await readCfConfig()
          const dns = cfg.apiToken ? await removeDns(cfg, hostname) : { ok: false, error: '未配置 API Token' }
          return { ok: true, hostname, deleted: true, restarted: { ok: true, autoReload: true, message: '云端配置已更新，隧道自动重载' }, dns: dns.ok ? { ok: true, apex: dns.apex || null } : { ok: false, error: dns.error || '' } }
        } else if (method === 'cf-svc-list') {
          const services = await readServices()
          // ⚡ 并发探活（原为串行 for-await，服务多了耗时线性累加）
          const out = await Promise.all(services.map(async (s) => {
            const st = await svcRunning(s)
            return { ...s, running: st.running, proc: st.proc, portOk: st.portOk }
          }))
          return { services: out }
        } else if (method === 'cf-svc-add') {
          const name = typeof args.name === 'string' ? args.name.trim() : ''
          const command = typeof args.command === 'string' ? args.command.trim() : ''
          if (!name || !command) return { error: '缺少 name 或 command' }
          const services = await readServices()
          if (services.some((s) => s.name === name)) return { error: `服务 ${name} 已存在` }
          const svc = { name, port: parseInt(args.port, 10) || null, command, cwd: typeof args.cwd === 'string' && args.cwd ? args.cwd : '/' }
          // 备注（可选）：一句话用途说明，列表里点名字时展示
          const note = typeof args.note === 'string' ? args.note.trim() : ''
          if (note) svc.note = note
          services.push(svc)
          const wr = await writeServices(services)
          if (!wr.ok) return { error: '写入 services.json 失败' }
          return { ok: true, service: svc }
        } else if (method === 'cf-svc-update') {
          const name = typeof args.name === 'string' ? args.name.trim() : ''
          if (!name) return { error: '缺少 name' }
          const services = await readServices()
          const s = services.find((x) => x.name === name)
          if (!s) return { error: `服务 ${name} 不存在` }
          if (typeof args.port !== 'undefined') s.port = parseInt(args.port, 10) || null
          if (typeof args.command === 'string' && args.command.trim()) s.command = args.command.trim()
          if (typeof args.cwd === 'string' && args.cwd.trim()) s.cwd = args.cwd.trim()
          // 备注：空串表示清除该字段（不是写空字符串，避免 JSON 里留一堆 "note": ""）
          if (typeof args.note !== 'undefined') {
            const v = String(args.note == null ? '' : args.note).trim()
            if (v) s.note = v
            else delete s.note
          }
          const wr = await writeServices(services)
          if (!wr.ok) return { error: '写入 services.json 失败' }
          return { ok: true, service: s }
        } else if (method === 'cf-svc-note-set') {
          // 只改备注的轻量接口（列表里点名字改备注时用）。
          // 单独开一个方法而不是复用 cf-svc-update：后者要求同时传 port/command，
          // 前端只改备注时不该被迫回传启动命令（回传错了就把服务改坏）。
          const name = typeof args.name === 'string' ? args.name.trim() : ''
          if (!name) return { error: '缺少 name' }
          const services = await readServices()
          const s = services.find((x) => x.name === name)
          if (!s) return { error: `服务 ${name} 不存在` }
          const v = String(args.note == null ? '' : args.note).trim()
          if (v) s.note = v
          else delete s.note
          const wr = await writeServices(services)
          if (!wr.ok) return { error: '写入 services.json 失败' }
          return { ok: true, name, note: s.note || '' }
        } else if (method === 'cf-svc-delete') {
          const name = typeof args.name === 'string' ? args.name.trim() : ''
          const stopFirst = args.stop === true
          if (!name) return { error: '缺少 name' }
          const services = await readServices()
          const s = services.find((x) => x.name === name)
          const next = services.filter((x) => x.name !== name)
          if (next.length === services.length) return { error: `服务 ${name} 不存在` }
          let stopped = false
          if (stopFirst && s) { killManaged('svc:' + name); await stopService(s); stopped = true }
          const wr = await writeServices(next)
          if (!wr.ok) return { error: '写入 services.json 失败' }
          return { ok: true, name, deleted: true, stopped }
        } else if (method === 'cf-svc-start') {
          const name = typeof args.name === 'string' ? args.name.trim() : ''
          killManaged('svc:' + name)
          const services = await readServices()
          const s = services.find((x) => x.name === name)
          if (!s) return { error: `服务 ${name} 不存在` }
          return await startService(s)
        } else if (method === 'cf-svc-stop') {
          const name = typeof args.name === 'string' ? args.name.trim() : ''
          killManaged('svc:' + name)
          const services = await readServices()
          const s = services.find((x) => x.name === name)
          if (!s) return { error: `服务 ${name} 不存在` }
          return await stopService(s)
        } else if (method === 'cf-svc-restart') {
          const name = typeof args.name === 'string' ? args.name.trim() : ''
          const services = await readServices()
          const s = services.find((x) => x.name === name)
          if (!s) return { error: `服务 ${name} 不存在` }
          killManaged('svc:' + name)
          await stopService(s)
          await new Promise((r) => setTimeout(r, 800))
          return await startService(s)
        } else if (method === 'cf-svc-log') {
          const name = typeof args.name === 'string' ? args.name.trim() : ''
          const logName = 'dsh-svc-' + svcFileKey(name)
          const logPath = LOGS_DIR + '/' + logName + '.log'
          const lines = parseInt(args.lines, 10) || 100
          const r = await sh(`tail -n ${lines} ${logPath} 2>/dev/null || echo '（无日志文件）'`, 6000)
          return { ok: true, name, logPath, tail: r.output || '（空）' }
        } else if (method === 'cf-src-read') {
          // 读源文件（服务条目「源码」按钮用）。
          // 早期版本借 dsh-file-manager 的 /dsh-fm/api，导致本插件多一个可选依赖；
          // 现在自己在 host 端实现，插件可独立安装。
          const p = typeof args.path === 'string' ? args.path.trim() : ''
          if (!p) return { error: '缺少 path' }
          if (!p.startsWith('/')) return { error: '必须是绝对路径' }
          try {
            const st = fs.statSync(p)
            if (!st.isFile()) return { error: '不是文件' }
            if (st.size > 2 * 1024 * 1024) return { error: '文件超过 2MB，不支持在线编辑' }
            const buf = fs.readFileSync(p)
            // 二进制探测：前 8KB 出现 NUL 即判为非文本
            const probe = Math.min(buf.length, 8192)
            for (let i = 0; i < probe; i++) if (buf[i] === 0) return { error: '二进制文件，不支持文本编辑' }
            return { ok: true, path: p, size: st.size, text: buf.toString('utf8') }
          } catch (e) {
            return { error: '读取失败: ' + String(e && (e.code || e.message) || e) }
          }
        } else if (method === 'cf-src-save') {
          const p = typeof args.path === 'string' ? args.path.trim() : ''
          const text = typeof args.text === 'string' ? args.text : ''
          if (!p) return { error: '缺少 path' }
          if (!p.startsWith('/')) return { error: '必须是绝对路径' }
          if (text.length > 2 * 1024 * 1024) return { error: '内容超过 2MB，无法保存' }
          try {
            fs.writeFileSync(p, text, 'utf8')
            return { ok: true, path: p, size: Buffer.byteLength(text, 'utf8') }
          } catch (e) {
            return { error: '保存失败: ' + String(e && (e.code || e.message) || e) }
          }
        } else if (method === 'cf-src-list') {
          // 列目录（源码编辑器的候选文件下拉用）
          const p = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : '/'
          try {
            const entries = fs.readdirSync(p, { withFileTypes: true })
            const items = entries.map((e) => ({
              name: e.name,
              dir: e.isDirectory(),
              path: p.replace(/\/+$/, '') + '/' + e.name,
            }))
            items.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : (a.dir ? -1 : 1)))
            return { ok: true, path: p, items: items.slice(0, 500) }
          } catch (e) {
            return { error: '列目录失败: ' + String(e && (e.code || e.message) || e) }
          }
        } else if (method === 'cf-svc-auto-start-get') {
          const services = await readServices()
          const cfg = await readCfConfig()
          const metrics = await probeMetrics()
          return {
            // 修正：原写法 isNamedRunning().then(() => true) 恒为 true，
            // 无论隧道是否真在运行都会报「运行中」，误导 UI 的自动启动复选框。
            named: { autoStart: !!cfg.autoStart, running: metrics.running },
            services: services.map(s => ({ name: s.name, autoStart: !!s.autoStart })),
          }
        } else if (method === 'cf-svc-auto-start-set') {
          const name = typeof args.name === 'string' ? args.name.trim() : ''
          const autoStart = !!args.autoStart
          if (!name) return { error: '缺少 name' }
          const services = await readServices()
          const s = services.find((x) => x.name === name)
          if (!s) return { error: `服务 ${name} 不存在` }
          s.autoStart = autoStart
          await writeServices(services)
          return { ok: true, name, autoStart }
        } else if (method === 'cf-named-auto-start-set') {
          const cfg = await readCfConfig()
          cfg.autoStart = !!args.autoStart
          await writeCfConfig(cfg)
          return { ok: true, autoStart: cfg.autoStart }
        } else if (method === 'cf-version') {
          const cfVer = await sh(`${CLOUDFLARED_BIN} --version 2>/dev/null || echo '未知'`, 5000)
          return { pluginVersion: PLUGIN_VERSION, cloudflaredVersion: (cfVer.output || '未知').trim() }
        } else if (method === 'cf-restart-dsh') {
          // 异步重启 DSH web 进程（不阻塞响应）
          setTimeout(() => {
            try {
              process.kill(process.pid, 'SIGHUP')
            } catch (e) {
              process.exit(0)
            }
          }, 500)
          return { ok: true, message: 'DSH 正在重启…' }
        }
        return { error: 'unknown method: ' + method }
      }

  ctx.effect(() => {
    const disposer = ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-cf/api',
    handler: async (req, res) => {
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
      // Host/Origin trust fence.
      //
      // This route is mounted straight on webServer, which is NOT covered by
      // the core /api fence (that fence lives in dsh-client-connection and only
      // guards RPC channels registered through connection.register()). Without
      // this check the route answers every Host, and because the cloudflared
      // tunnel dials the origin over loopback the source address is always
      // 127.0.0.1 — so a tunnelled stranger is indistinguishable from a local
      // caller by address alone, and the endpoint was anonymously reachable
      // from the public internet. Host is the header Cloudflare preserves
      // across the tunnel and the one a rebinding attacker cannot forge into a
      // trusted spelling.
      //
      // The fence is delegated to the connection service when available so this
      // route shares the deployment's trustedHosts/Origin semantics exactly.
      // FAIL CLOSED: if connection is absent only genuine loopback Hosts pass.
      const rejection = (() => {
        try {
          const connection = ctx.get('connection')
          if (connection !== undefined && typeof connection.requestRejection === 'function') {
            return connection.requestRejection(req)
          }
        } catch (e) {
          console.error(`dsh-cloudflared-manager: trust fence threw: ${e && e.message ? e.message : String(e)}`)
          return 403
        }
        // connection not mounted (yet): deny everything but genuine loopback.
        // Parsed literally (not via WHATWG) so normalization cannot fold a
        // delimited spelling such as `127.0.0.1#@evil.com` into a loopback host.
        const host = req.headers ? req.headers.host : undefined
        if (typeof host === 'string') {
          const raw = host.trim()
          if (raw !== '' && !/[\/\\?#@\s,;]/.test(raw)) {
            const m = /^(\[[^\]]+\]|[^:]+)(?::(\d{1,5}))?$/.exec(raw)
            if (m && !(m[2] !== undefined && Number(m[2]) > 65535)) {
              const hn = m[1].toLowerCase()
              if (hn === 'localhost' || hn === '[::1]') return undefined
              const p = hn.split('.')
              if (p.length === 4 && p[0] === '127'
                && p.every((s) => /^(?:0|[1-9]\d{0,2})$/.test(s) && Number(s) <= 255)) return undefined
            }
          }
        }
        console.error(`dsh-cloudflared-manager: trust fence unavailable and Host=${JSON.stringify(host)} is not loopback — denying`)
        return 403
      })()
      if (rejection !== undefined) {
        const out = JSON.stringify({ error: rejection === 401 ? 'unauthorized' : 'forbidden' })
        res.writeHead(rejection, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(out) })
        res.end(out); return
      }
      const chunks = []
      let total = 0
      for await (const chunk of req) {
        total += chunk.length
        if (total > MAX_API_BODY) {
          const out = JSON.stringify({ error: '请求体过大' })
          res.writeHead(413, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(out) })
          res.end(out); return
        }
        chunks.push(chunk)
      }
      let body = {}
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch (e) { body = {} }
      const method = typeof body.method === 'string' ? body.method : ''
      const args = (body.args && typeof body.args === 'object') ? body.args : {}
      const send = (result) => {
        const out = JSON.stringify(result)
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(out) })
        res.end(out)
      }
      try {
        let result = await routeApi(method, args, send)
        if (result !== undefined) send(result)
      } catch (err) {
        send({ error: '失败: ' + String(err && (err.message || err)) })
      }
    },
  }, 'dsh-cloudflared-manager: api route')

    // 自动启动：Named 隧道 + 标记了 autoStart 的本地服务
    // 先加载账号配置（tunnelId/accountId/zoneWhitelist）再跑 autoStart：
    // 隧道命令与 buildConfigYaml 都要用这些值，顺序不能反。
    //
    // 先把持久目录建出来（pids / logs）。容器里 CF_SETUP 在持久卷上，
    // 但目录可能还没创建（例如全新安装后第一次启动），提前 mkdir 一次，
    // 避免首次写日志/PID 时因目录不存在而静默失败。
    sh(`mkdir -p ${PIDS_DIR} ${LOGS_DIR} 2>/dev/null || true`, 5000)
      .catch(() => {})
      .finally(() => {
        refreshCfMeta().catch(() => {}).finally(() => { autoStart().catch(() => {}) })
      })

    // 优雅关闭：杀掉所有受管进程
    const sigHandler = () => { killAllManaged() }
    process.on('SIGTERM', sigHandler)
    process.on('SIGINT', sigHandler)

    return () => {
      process.off('SIGTERM', sigHandler)
      process.off('SIGINT', sigHandler)
      killAllManaged()
    }
  })
}
