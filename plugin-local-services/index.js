// dsh-local-services — host half (static plugin)
// 本地服务管理（自定义命令启停/重启/日志）+ 可选 trycloudflare 临时公网暴露（无需登录/token）
// Provides:
//   POST /dsh-ls/api   JSON API:
//     ls-status / ls-svc-list / ls-svc-add / ls-svc-update / ls-svc-delete
//     ls-svc-start / ls-svc-stop / ls-svc-restart / ls-svc-log
//     ls-tunnel-list / ls-tunnel-add / ls-tunnel-stop     （trycloudflare 快速隧道）
export const inject = ['shell', 'webServer']

const CF_SETUP = process.env.DSH_CF_SETUP || ((process.env.DSH_HOME || '/data/dsh') + '/cloudflared-setup')
const CLOUDFLARED_BIN = CF_SETUP + '/node_modules/@farthershore/cloudflared-linux-x64/bin/cloudflared'
const SERVICES_FILE = CF_SETUP + '/services.json'
const PIDS_DIR = CF_SETUP + '/pids'

export function apply(ctx) {
  const MAX_API_BODY = 1024 * 1024

  async function sh(cmd, timeoutMs = 15000) {
    const policy = { mode: 'danger-full-access', workspaceRoot: '/' }
    const spec = ctx.shell.resolve({ command: cmd, timeoutMs, stdoutMaxBytes: 512 * 1024, sandboxPolicy: policy })
    const res = await ctx.shell.run(spec)
    const out = ((res.stdout && res.stdout.text) || '') + ((res.stderr && res.stderr.text) || '')
    return { ok: res.exitCode === 0, exitCode: res.exitCode, output: out }
  }

  // ---------------- cloudflared 自动安装（临时暴露依赖） ----------------

  async function ensureCloudflared() {
    const chk = await sh(`test -x ${CLOUDFLARED_BIN} && echo yes || echo no`, 5000)
    if ((chk.output || '').includes('yes')) return { ok: true, installed: true }
    const inst = await sh(
      `mkdir -p ${CF_SETUP} && cd ${CF_SETUP} && npm install --cache ${CF_SETUP}/.npm-cache @farthershore/cloudflared-linux-x64 2>&1 | tail -3`,
      180000,
    )
    const chk2 = await sh(`test -x ${CLOUDFLARED_BIN} && echo yes || echo no`, 5000)
    if ((chk2.output || '').includes('yes')) return { ok: true, installed: true, installedNow: true }
    return { ok: false, error: 'cloudflared 自动安装失败: ' + String(inst.output || '').slice(-200) }
  }

  // ---------------- 进程工具（沙箱可靠） ----------------

  async function countProcByCmd(frag) {
    if (!frag) return 0
    const safe = String(frag).replace(/'/g, "'\\''")
    const cmd = `n=0; for f in /proc/[0-9]*/cmdline; do c=$(tr '\\0' ' ' < "$f" 2>/dev/null); case "$c" in ${safe}*) n=$((n+1));; esac; done; echo $n`
    const r = await sh(cmd, 8000)
    const n = parseInt((r.output || '').trim(), 10)
    return Number.isFinite(n) ? n : 0
  }

  async function killByCmd(frag) {
    if (!frag) return
    const safe = String(frag).replace(/'/g, "'\\''")
    const cmd = 'for f in /proc/[0-9]*/cmdline; do c=$(tr "\\0" " " < "$f" 2>/dev/null); case "$c" in *' + safe +
      '*) pid=${f#/proc/}; pid=${pid%/cmdline*}; kill -9 $pid 2>/dev/null;; esac; done || true'
    await sh(cmd, 6000)
  }

  async function killByPidFile(pidFile) {
    const r = await sh(`cat ${pidFile} 2>/dev/null || true`, 5000)
    const pid = parseInt((r.output || '').trim(), 10)
    if (!Number.isFinite(pid) || pid <= 0) return null
    const killed = await sh(`kill -${pid} 2>/dev/null; kill ${pid} 2>/dev/null && echo yes || echo no; rm -f ${pidFile}`, 5000)
    return (killed.output || '').includes('yes') ? pid : null
  }

  function svcCmdFrag(svc) {
    const cmd = (svc.command || '').trim().replace(/\s+/g, ' ')
    const frag = cmd.split(/\s+/).slice(0, 4).join(' ')
    return frag ? frag.replace(/"/g, '') : ''
  }

  function svcLogName(svc) {
    return 'dsh-svc-' + String(svc.name || 'svc').replace(/[^a-zA-Z0-9_-]/g, '_')
  }

  // ---------------- 本地服务管理 ----------------

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
    const logName = svcLogName(svc)
    const pr = await sh(`cat ${PIDS_DIR}/${logName}.pid 2>/dev/null || true`, 5000)
    const pid = parseInt((pr.output || '').trim(), 10)
    let pidAlive = false
    if (Number.isFinite(pid) && pid > 0) {
      const a = await sh(`kill -0 ${pid} 2>/dev/null && echo yes || echo no`, 5000)
      pidAlive = (a.output || '').includes('yes')
    }
    const frag = svcCmdFrag(svc)
    const proc = pidAlive || (frag ? (await countProcByCmd(frag)) > 0 : false)
    let portOk = false
    if (svc.port) {
      const r = await sh(`curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:${svc.port}/ || true`, 6000)
      const code = (r.output || '').trim()
      portOk = code !== '' && code !== '000'
    }
    return { running: proc || portOk, proc, portOk, pid: pidAlive ? pid : null }
  }

  async function startService(svc) {
    const cmd = (svc.command || '').trim()
    if (!cmd) return { error: '缺少启动命令' }
    const cwd = svc.cwd || '/'
    const logName = svcLogName(svc)
    const logPath = '/tmp/' + logName + '.log'
    const pidFile = PIDS_DIR + '/' + logName + '.pid'
    const q = (x) => String(x).replace(/'/g, "'\\''")
    await sh(`mkdir -p ${PIDS_DIR} ${cwd} 2>/dev/null || true; rm -f ${pidFile}`, 5000)
    const start = await sh(`bash -c 'cd ${q(cwd)} && exec ${q(cmd)} > ${q(logPath)} 2>&1' & echo $! > ${pidFile}`, 10000)
    if (!start.ok) return { error: '启动失败: ' + (start.output || '') }
    await new Promise((r) => setTimeout(r, 3000))
    const st = await svcRunning(svc)
    return { ok: true, pid: st.pid || null, running: st.running, logPath }
  }

  async function stopService(svc) {
    const killed = await killByPidFile(PIDS_DIR + '/' + svcLogName(svc) + '.pid')
    await killByCmd(svcCmdFrag(svc))
    return { ok: true, killedPid: killed }
  }

  // ---------------- trycloudflare 临时公网暴露（无需登录） ----------------

  async function scanTunnels() {
    const r = await sh(`ls ${PIDS_DIR}/dsh-cf-*.pid 2>/dev/null || true`, 6000)
    const tunnels = []
    for (const f of (r.output || '').split('\n')) {
      const m = String(f).trim().match(/dsh-cf-(\d+)\.pid$/)
      if (!m) continue
      const port = m[1]
      const pr = await sh(`cat ${PIDS_DIR}/dsh-cf-${port}.pid 2>/dev/null || true`, 5000)
      const pid = parseInt((pr.output || '').trim(), 10)
      if (!Number.isFinite(pid)) continue
      const alive = await sh(`kill -0 ${pid} 2>/dev/null && echo yes || echo no`, 5000)
      if (!(alive.output || '').includes('yes')) continue
      const lr = await sh(`grep -oE 'https://[a-z0-9-]+\\.trycloudflare\\.com' /tmp/dsh-cf-${port}.log | head -1 || true`, 8000)
      tunnels.push({ port: parseInt(port, 10), pid, url: (lr.output || '').trim(), status: 'running' })
    }
    return tunnels
  }

  async function startTunnel(port) {
    const p = parseInt(port, 10)
    if (!Number.isFinite(p) || p < 1 || p > 65535) return { error: '端口无效' }
    const existing = await scanTunnels()
    if (existing.some((t) => t.port === p)) return { error: `端口 ${p} 已有临时隧道在运行` }
    const logPath = `/tmp/dsh-cf-${p}.log`
    await sh(`mkdir -p ${PIDS_DIR} 2>/dev/null || true; rm -f ${logPath} ${PIDS_DIR}/dsh-cf-${p}.pid`, 5000)
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
    const tunnels = await scanTunnels()
    const t = tunnels.find((x) => x.port === p)
    if (!t) return { error: '隧道进程未检测到，日志尾部: ' + String((await sh(`tail -5 ${logPath}`, 5000)).output).slice(0, 200) }
    return { ok: true, port: p, pid: t.pid, url: url || '（等待中，稍后刷新获取 URL）' }
  }

  async function stopTunnel(port) {
    const p = parseInt(port, 10)
    const tunnels = await scanTunnels()
    const t = tunnels.find((x) => x.port === p)
    if (!t) return { ok: true, port: p, stopped: false, message: '该端口没有运行中的临时隧道' }
    await sh(`kill ${t.pid} 2>/dev/null || true; rm -f ${PIDS_DIR}/dsh-cf-${p}.pid`, 5000)
    return { ok: true, port: p, stopped: true, pid: t.pid }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-ls/api',
    handler: async (req, res) => {
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
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
        let result
        if (method === 'ls-status') {
          const inst = await ensureCloudflared()
          const services = await readServices()
          const svcList = []
          for (const s of services) {
            const st = await svcRunning(s)
            svcList.push({ ...s, running: st.running, pid: st.pid })
          }
          result = {
            cloudflared: { installed: inst.ok, installedNow: inst.installedNow || false, error: inst.error || null },
            services: svcList,
            tunnels: await scanTunnels(),
          }
        } else if (method === 'ls-svc-list') {
          const services = await readServices()
          const out = []
          for (const s of services) { const st = await svcRunning(s); out.push({ ...s, running: st.running, pid: st.pid }) }
          result = { services: out }
        } else if (method === 'ls-svc-add') {
          const name = typeof args.name === 'string' ? args.name.trim() : ''
          const command = typeof args.command === 'string' ? args.command.trim() : ''
          if (!name || !command) { result = { error: '缺少 name 或 command' } }
          else {
            const services = await readServices()
            if (services.some((s) => s.name === name)) { result = { error: `服务 ${name} 已存在` } }
            else {
              const svc = { name, port: parseInt(args.port, 10) || null, command, cwd: typeof args.cwd === 'string' && args.cwd ? args.cwd : '/' }
              services.push(svc)
              const wr = await writeServices(services)
              if (!wr.ok) { result = { error: '写入 services.json 失败' } }
              else result = { ok: true, service: svc }
            }
          }
        } else if (method === 'ls-svc-update') {
          const name = typeof args.name === 'string' ? args.name.trim() : ''
          if (!name) { result = { error: '缺少 name' } }
          else {
            const services = await readServices()
            const s = services.find((x) => x.name === name)
            if (!s) { result = { error: `服务 ${name} 不存在` } }
            else {
              if (typeof args.port !== 'undefined') s.port = parseInt(args.port, 10) || null
              if (typeof args.command === 'string' && args.command.trim()) s.command = args.command.trim()
              if (typeof args.cwd === 'string' && args.cwd.trim()) s.cwd = args.cwd.trim()
              const wr = await writeServices(services)
              if (!wr.ok) { result = { error: '写入 services.json 失败' } }
              else result = { ok: true, service: s }
            }
          }
        } else if (method === 'ls-svc-delete') {
          const name = typeof args.name === 'string' ? args.name.trim() : ''
          const stopFirst = args.stop === true
          if (!name) { result = { error: '缺少 name' } }
          else {
            const services = await readServices()
            const s = services.find((x) => x.name === name)
            const next = services.filter((x) => x.name !== name)
            if (next.length === services.length) { result = { error: `服务 ${name} 不存在` } }
            else {
              let stopped = false
              if (stopFirst && s) { await stopService(s); stopped = true }
              const wr = await writeServices(next)
              if (!wr.ok) { result = { error: '写入 services.json 失败' } }
              else result = { ok: true, name, deleted: true, stopped }
            }
          }
        } else if (method === 'ls-svc-start') {
          const name = typeof args.name === 'string' ? args.name.trim() : ''
          const services = await readServices()
          const s = services.find((x) => x.name === name)
          if (!s) { result = { error: `服务 ${name} 不存在` } }
          else result = await startService(s)
        } else if (method === 'ls-svc-stop') {
          const name = typeof args.name === 'string' ? args.name.trim() : ''
          const services = await readServices()
          const s = services.find((x) => x.name === name)
          if (!s) { result = { error: `服务 ${name} 不存在` } }
          else result = await stopService(s)
        } else if (method === 'ls-svc-restart') {
          const name = typeof args.name === 'string' ? args.name.trim() : ''
          const services = await readServices()
          const s = services.find((x) => x.name === name)
          if (!s) { result = { error: `服务 ${name} 不存在` } }
          else {
            await stopService(s)
            await new Promise((r) => setTimeout(r, 800))
            result = await startService(s)
            result.restarted = true
          }
        } else if (method === 'ls-svc-log') {
          const name = typeof args.name === 'string' ? args.name.trim() : ''
          const logName = 'dsh-svc-' + name.replace(/[^a-zA-Z0-9_-]/g, '_')
          const logPath = '/tmp/' + logName + '.log'
          const lines = parseInt(args.lines, 10) || 100
          const r = await sh(`tail -n ${lines} ${logPath} 2>/dev/null || echo '（无日志文件）'`, 6000)
          result = { ok: true, name, logPath, tail: r.output || '（空）' }
        } else if (method === 'ls-tunnel-list') {
          result = { tunnels: await scanTunnels() }
        } else if (method === 'ls-tunnel-add') {
          result = await startTunnel(args.port)
        } else if (method === 'ls-tunnel-stop') {
          result = await stopTunnel(args.port)
        } else {
          result = { error: 'unknown method: ' + method }
        }
        send(result)
      } catch (err) {
        send({ error: '失败: ' + String(err && (err.message || err)) })
      }
    },
  }), 'dsh-local-services: api route')
}
