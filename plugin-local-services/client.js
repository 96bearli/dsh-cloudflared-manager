window.__ModuleLoader__.load({
  id: 'dsh-local-services',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')

    const CSS = `.dshls-toggle {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 8px; border: none; border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-secondary, #666);
  cursor: pointer; font-size: 13px; line-height: 1.5;
}
.dshls-toggle:hover { background: var(--dsw-alias-bg-layer-2, #eee); color: var(--dsw-alias-label-primary, #111); }
.dshls-toggle-active { color: var(--dsw-alias-brand-primary, #2f6fed); }
.dshls-toggle-icon { font-size: 14px; }
.dshls-toggle-label { font-size: 12px; }
.dshls-panel {
  position: fixed; top: 8vh; right: 20px;
  width: 660px; max-width: calc(100vw - 40px); height: 80vh;
  display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-overlay, #ffffff);
  border: 1px solid var(--dsw-alias-border-l1, #d9d9d9);
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.22);
  z-index: 1001; pointer-events: auto;
  font-size: 13px; line-height: 1.45;
  color: var(--dsw-alias-label-primary, #1a1a1a);
  overflow: hidden;
}
.dshls-head {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 14px; flex: none;
  border-bottom: 1px solid var(--dsw-alias-border-l1, #e3e3e3);
  background: var(--dsw-alias-bg-layer-1, #f6f6f6);
}
.dshls-title { font-weight: 600; font-size: 14px; flex: 1; }
.dshls-close { border: none; background: none; cursor: pointer; font-size: 15px; color: #888; padding: 2px 8px; border-radius: 4px; }
.dshls-close:hover { background: #e8e8e8; }
.dshls-body { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.dshls-sec { border: 1px solid var(--dsw-alias-border-l1, #e3e3e3); border-radius: 10px; padding: 10px 12px; background: #fdfdfd; }
.dshls-sec h4 { margin: 0 0 8px; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
.dshls-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 3px 0; font-size: 12px; }
.dshls-badge { display: inline-flex; align-items: center; padding: 2px 9px; border-radius: 10px; font-size: 11px; font-weight: 600; white-space: nowrap; }
.dshls-badge-on { background: #e6f7ee; color: #0a7a3d; }
.dshls-badge-off { background: #fdecea; color: #c0392b; }
.dshls-badge-live { background: #e8f0fe; color: #1a56db; }
.dshls-url { color: var(--dsw-alias-brand-primary, #2f6fed); text-decoration: none; word-break: break-all; }
.dshls-btn {
  border: 1px solid var(--dsw-alias-border-l1, #d9d9d9); background: var(--dsw-alias-bg-layer-1, #f6f6f6);
  border-radius: 6px; padding: 5px 12px; font-size: 12px; cursor: pointer; color: #333; line-height: 1.3; white-space: nowrap;
}
.dshls-btn:hover { background: #eaeaea; }
.dshls-btn-primary { background: #2f6fed; border-color: #2f6fed; color: #fff; }
.dshls-btn-primary:hover { background: #2558c4; }
.dshls-btn-live { background: #1a56db; border-color: #1a56db; color: #fff; }
.dshls-btn-live:hover { background: #1340a8; }
.dshls-btn-danger { color: #c0392b; }
.dshls-btn-sm { padding: 3px 9px; font-size: 11.5px; }
.dshls-add { display: flex; align-items: center; gap: 7px; margin-top: 8px; flex-wrap: wrap; }
.dshls-add input, .dshls-add select {
  height: 30px; padding: 0 9px; border: 1px solid var(--dsw-alias-border-l1, #d9d9d9);
  border-radius: 6px; font-size: 12.5px; min-width: 0; box-sizing: border-box; background: #fff; color: #333;
}
.dshls-add input:focus, .dshls-add select:focus { outline: none; border-color: #2f6fed; box-shadow: 0 0 0 2px rgba(47,111,237,.12); }
.dshls-add input.dshls-w1 { flex: 1; min-width: 110px; }
.dshls-add input.dshls-w2 { flex: 2; min-width: 200px; }
.dshls-add input.dshls-w3 { flex: 1; min-width: 100px; }
.dshls-add select { flex: 1; min-width: 100px; }
.dshls-sec .dshls-add { background: #f8f9fa; border: 1px dashed #dcdcdc; border-radius: 8px; padding: 8px; }
.dshls-status { color: #888; font-size: 12px; }
.dshls-empty { color: #999; font-size: 12px; padding: 8px 0; }
.dshls-tip { color: #999; font-size: 11px; line-height: 1.5; }
.dshls-mask { position: absolute; inset: 0; z-index: 30; background: rgba(255,255,255,0.78); display: flex; align-items: center; justify-content: center; backdrop-filter: blur(1px); }
.dshls-mask-inner { background: #fff; border: 1px solid #ddd; border-radius: 10px; padding: 18px 28px; box-shadow: 0 8px 24px rgba(0,0,0,.16); font-size: 13px; color: #555; }
.dshls-item { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px dashed #eee; font-size: 12px; flex-wrap: wrap; }
.dshls-item:last-child { border-bottom: none; }
.dshls-item-main { flex: 1; min-width: 0; }
.dshls-item-name { font-weight: 600; }
.dshls-item-sub { color: #888; font-size: 11px; word-break: break-all; }
.dshls-edit-row { display: flex; align-items: center; gap: 6px; flex: 1; flex-wrap: wrap; }
.dshls-edit-row input { height: 28px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l1, #d9d9d9); border-radius: 5px; font-size: 12px; box-sizing: border-box; }
.dshls-tunnel { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px dashed #eee; font-size: 12px; flex-wrap: wrap; }
.dshls-tunnel:last-child { border-bottom: none; }
`

    function insertStyles(css) {
      const id = 'dshls-styles'
      if (document.getElementById(id)) return
      const el = document.createElement('style')
      el.id = id
      el.textContent = css
      document.head.appendChild(el)
    }

    async function api(method, args) {
      const res = await fetch('/dsh-ls/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, args: args || {} }),
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json()
    }

    const inject = ['slots']

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return

      ctx.effect(() => insertStyles(CSS), 'dsh-local-services: styles')

      let open = false
      const listeners = new Set()
      function setOpen(v) { open = !!v; for (const fn of listeners) fn(open) }
      function useOpen() {
        const [v, setV] = React.useState(open)
        React.useEffect(() => { listeners.add(setV); return () => { listeners.delete(setV) } }, [])
        return [v, setOpen]
      }

      const HeaderToggle = () => {
        const [isOpen, toggle] = useOpen()
        return React.createElement('button', {
          className: 'dshls-toggle' + (isOpen ? ' dshls-toggle-active' : ''),
          onClick: () => toggle(!isOpen),
          title: '本地服务管理',
          'aria-label': '本地服务管理',
        },
          React.createElement('span', { className: 'dshls-toggle-icon' }, '📦'),
          React.createElement('span', { className: 'dshls-toggle-label' }, isOpen ? '服务管理' : '服务'),
        )
      }

      const Panel = () => {
        const [isOpen] = useOpen()
        const [status, setStatus] = React.useState(null)
        const [loading, setLoading] = React.useState(false)
        const [error, setError] = React.useState('')
        const [busy, setBusy] = React.useState(false)
        const [notice, setNotice] = React.useState('')
        const [svcForm, setSvcForm] = React.useState({ name: '', port: '', command: '', cwd: '/' })
        const [editSvcName, setEditSvcName] = React.useState(null)
        const [editSvcForm, setEditSvcForm] = React.useState({})
        const [logSvc, setLogSvc] = React.useState(null)
        const [logText, setLogText] = React.useState('')
        const [logLoading, setLogLoading] = React.useState(false)
        const [confirmDel, setConfirmDel] = React.useState(null)
        const [tunnelPort, setTunnelPort] = React.useState('')
        const [exposeBusy, setExposeBusy] = React.useState(null)

        const load = React.useCallback(async () => {
          setLoading(true); setError('')
          try { setStatus(await api('ls-status')) } catch (e) { setError(String(e && e.message || e)) }
          setLoading(false)
        }, [])

        React.useEffect(() => { if (isOpen) load() }, [isOpen, load])
        React.useEffect(() => {
          if (!isOpen) return
          const t = setInterval(load, 10000)
          return () => clearInterval(t)
        }, [isOpen, load])

        const flash = (msg) => { setNotice(msg); setTimeout(() => setNotice(''), 8000) }

        const addSvc = async () => {
          const name = svcForm.name.trim(); const command = svcForm.command.trim()
          if (!name || !command) { setNotice('请输入服务名和启动命令'); return }
          setBusy(true); setNotice('')
          try {
            const r = await api('ls-svc-add', { name, port: parseInt(svcForm.port, 10) || 0, command, cwd: svcForm.cwd.trim() || '/' })
            if (r.error) setNotice('新增失败：' + r.error)
            else { flash('服务 ' + name + ' 已添加'); setSvcForm({ name: '', port: '', command: '', cwd: '/' }); load() }
          } catch (e) { setNotice('新增失败：' + String(e && e.message || e)) }
          setBusy(false)
        }
        const startEditSvc = (s) => { setEditSvcName(s.name); setEditSvcForm({ port: String(s.port || ''), command: s.command || '', cwd: s.cwd || '/' }) }
        const saveEditSvc = async (name) => {
          setBusy(true); setNotice('')
          try {
            const r = await api('ls-svc-update', { name, port: parseInt(editSvcForm.port, 10) || 0, command: editSvcForm.command.trim(), cwd: editSvcForm.cwd.trim() || '/' })
            if (r.error) setNotice('更新失败：' + r.error)
            else { flash('服务 ' + name + ' 已更新'); setEditSvcName(null); setEditSvcForm({}); load() }
          } catch (e) { setNotice('更新失败：' + String(e && e.message || e)) }
          setBusy(false)
        }
        const deleteSvc = async (name, stopToo) => {
          setBusy(true); setNotice('')
          try {
            const r = await api('ls-svc-delete', { name, stop: !!stopToo })
            if (r.error) setNotice('删除失败：' + r.error)
            else flash('服务 ' + name + ' 已删除' + (r.stopped ? '（进程已停止）' : '')); load()
          } catch (e) { setNotice('删除失败：' + String(e && e.message || e)) }
          setBusy(false)
        }
        const startSvc = async (name) => {
          setBusy(true); setNotice('')
          try {
            const r = await api('ls-svc-start', { name })
            if (r.error) setNotice('启动失败：' + r.error)
            else flash('服务 ' + name + (r.running ? ' 已启动' : ' 已执行（端口未检测到）'))
            load()
          } catch (e) { setNotice('启动失败：' + String(e && e.message || e)) }
          setBusy(false)
        }
        const stopSvc = async (name) => {
          setBusy(true); setNotice('')
          try { await api('ls-svc-stop', { name }); flash('服务 ' + name + ' 已停止'); load() }
          catch (e) { setNotice('停止失败：' + String(e && e.message || e)) }
          setBusy(false)
        }
        const restartSvc = async (name) => {
          setBusy(true); setNotice('')
          try {
            const r = await api('ls-svc-restart', { name })
            if (r.error) setNotice('重启失败：' + r.error)
            else flash('服务 ' + name + ' 已重启' + (r.running ? '（运行中）' : '（已执行，端口未检测到）'))
            load()
          } catch (e) { setNotice('重启失败：' + String(e && e.message || e)) }
          setBusy(false)
        }
        const viewLog = async (name) => {
          setLogSvc(name); setLogLoading(true); setLogText('')
          try { const r = await api('ls-svc-log', { name, lines: 100 }); setLogText(r.tail || '（空）') }
          catch (e) { setLogText('读取失败：' + String(e && e.message || e)) }
          setLogLoading(false)
        }
        // 临时公网暴露（trycloudflare，无需登录）
        const expose = async (port) => {
          const p = parseInt(port, 10)
          if (!p) { setNotice('端口无效'); return }
          setExposeBusy(p); setNotice('')
          try {
            const r = await api('ls-tunnel-add', { port: p })
            if (r.error) setNotice('暴露失败：' + r.error)
            else flash('端口 ' + p + ' 已临时暴露' + (r.url && r.url.indexOf('http') === 0 ? '：' + r.url : '，等待 URL…'))
            load()
          } catch (e) { setNotice('暴露失败：' + String(e && e.message || e)) }
          setExposeBusy(null)
        }
        const stopTunnel = async (port) => {
          setBusy(true); setNotice('')
          try { await api('ls-tunnel-stop', { port }); flash('端口 ' + port + ' 临时隧道已停止'); load() }
          catch (e) { setNotice('停止失败：' + String(e && e.message || e)) }
          setBusy(false)
        }

        if (!isOpen) return null

        const services = (status && status.services) || []
        const tunnels = (status && status.tunnels) || []
        const servicePorts = services.filter((x) => x.port).map((x) => x.port)

        return React.createElement('div', { className: 'dshls-panel' },
          React.createElement('div', { className: 'dshls-head' },
            React.createElement('span', { className: 'dshls-title' }, '📦 本地服务管理'),
            React.createElement('button', { className: 'dshls-close', onClick: () => setOpen(false) }, '✕'),
          ),
          React.createElement('div', { className: 'dshls-body' },

            // ---- 本地服务 ----
            React.createElement('div', { className: 'dshls-sec' },
              React.createElement('h4', null, '本地服务（自定义命令）'),
              services.length === 0
                ? React.createElement('div', { className: 'dshls-empty' }, '暂无服务定义。添加一个服务（名称 + 端口 + 启动命令）即可在此启停。')
                : services.map((s) =>
                    editSvcName === s.name
                      ? React.createElement('div', { key: s.name, className: 'dshls-item' },
                          React.createElement('span', { className: 'dshls-item-name' }, s.name),
                          React.createElement('div', { className: 'dshls-edit-row' },
                            React.createElement('input', { style: { width: 70 }, value: editSvcForm.port, onChange: (e) => setEditSvcForm({ ...editSvcForm, port: e.target.value }), placeholder: '端口' }),
                            React.createElement('input', { style: { width: 180 }, value: editSvcForm.command, onChange: (e) => setEditSvcForm({ ...editSvcForm, command: e.target.value }), placeholder: '启动命令' }),
                            React.createElement('input', { style: { width: 120 }, value: editSvcForm.cwd, onChange: (e) => setEditSvcForm({ ...editSvcForm, cwd: e.target.value }), placeholder: '工作目录' }),
                            React.createElement('button', { className: 'dshls-btn dshls-btn-sm dshls-btn-primary', onClick: () => saveEditSvc(s.name), disabled: busy }, '保存'),
                            React.createElement('button', { className: 'dshls-btn dshls-btn-sm', onClick: () => { setEditSvcName(null); setEditSvcForm({}) } }, '取消'),
                          ),
                        )
                      : React.createElement('div', { key: s.name, className: 'dshls-item' },
                          React.createElement('span', { className: 'dshls-badge ' + (s.running ? 'dshls-badge-on' : 'dshls-badge-off') }, s.running ? '● 运行' : '○ 停止'),
                          React.createElement('div', { className: 'dshls-item-main' },
                            React.createElement('div', { className: 'dshls-item-name' }, s.name + (s.port ? '  :' + s.port : '')),
                            React.createElement('div', { className: 'dshls-item-sub' }, s.command),
                          ),
                          React.createElement('button', { className: 'dshls-btn dshls-btn-sm', onClick: () => startSvc(s.name), disabled: busy }, '启动'),
                          React.createElement('button', { className: 'dshls-btn dshls-btn-sm dshls-btn-danger', onClick: () => stopSvc(s.name), disabled: busy || !s.running }, '停止'),
                          React.createElement('button', { className: 'dshls-btn dshls-btn-sm', onClick: () => restartSvc(s.name), disabled: busy }, '重启'),
                          React.createElement('button', { className: 'dshls-btn dshls-btn-sm', onClick: () => viewLog(s.name), disabled: busy }, '日志'),
                          React.createElement('button', { className: 'dshls-btn dshls-btn-sm', onClick: () => startEditSvc(s), disabled: busy }, '编辑'),
                          React.createElement('button', { className: 'dshls-btn dshls-btn-sm dshls-btn-danger', onClick: () => setConfirmDel({ type: 'svc', name: s.name, running: s.running, stopToo: true }), disabled: busy }, '删除'),
                          s.port ? React.createElement('button', { className: 'dshls-btn dshls-btn-sm dshls-btn-live', onClick: () => expose(s.port), disabled: busy || exposeBusy === s.port }, exposeBusy === s.port ? '暴露中…' : '🌐 临时公网') : null,
                        ),
                  ),
              React.createElement('div', { className: 'dshls-add' },
                React.createElement('input', { className: 'dshls-w1', placeholder: '服务名', value: svcForm.name, onChange: (e) => setSvcForm({ ...svcForm, name: e.target.value }) }),
                React.createElement('input', { className: 'dshls-w3', placeholder: '端口', value: svcForm.port, onChange: (e) => setSvcForm({ ...svcForm, port: e.target.value }) }),
                React.createElement('select', { className: 'dshls-w3', style: { height: 30 }, onChange: (e) => { if (e.target.value) setSvcForm({ ...svcForm, port: e.target.value }) } },
                  React.createElement('option', { value: '' }, '选端口…'),
                  Array.from(new Set(servicePorts)).map((port) => React.createElement('option', { key: port, value: port }, ':' + port)),
                ),
                React.createElement('input', { className: 'dshls-w2', placeholder: '启动命令，如 /path/python main.py', value: svcForm.command, onChange: (e) => setSvcForm({ ...svcForm, command: e.target.value }) }),
                React.createElement('input', { className: 'dshls-w2', placeholder: '工作目录，如 /data/app', value: svcForm.cwd, onChange: (e) => setSvcForm({ ...svcForm, cwd: e.target.value }) }),
                React.createElement('button', { className: 'dshls-btn dshls-btn-primary', onClick: addSvc, disabled: busy }, busy ? '处理中…' : '＋ 新增服务'),
              ),
            ),

            // ---- 临时公网暴露 ----
            React.createElement('div', { className: 'dshls-sec' },
              React.createElement('h4', null, '🌐 临时公网暴露（trycloudflare，无需登录）'),
              tunnels.length === 0
                ? React.createElement('div', { className: 'dshls-empty' }, '暂无临时隧道。输入本地端口或点服务的「🌐 临时公网」即可生成一个公开 URL（关闭面板/停止后失效）。')
                : tunnels.map((t) => React.createElement('div', { key: t.port, className: 'dshls-tunnel' },
                    React.createElement('span', { className: 'dshls-badge dshls-badge-live' }, '● 暴露中'),
                    React.createElement('span', { className: 'dshls-item-name' }, ':' + t.port),
                    t.url
                      ? React.createElement('a', { className: 'dshls-url', href: t.url, target: '_blank', rel: 'noopener' }, t.url)
                      : React.createElement('span', { className: 'dshls-status' }, '等待 URL…'),
                    React.createElement('button', { className: 'dshls-btn dshls-btn-sm dshls-btn-danger', onClick: () => stopTunnel(t.port), disabled: busy }, '停止暴露'),
                  )),
              React.createElement('div', { className: 'dshls-add' },
                React.createElement('input', { className: 'dshls-w3', type: 'number', min: 1, max: 65535, placeholder: '本地端口', value: tunnelPort, onChange: (e) => setTunnelPort(e.target.value) }),
                React.createElement('button', { className: 'dshls-btn dshls-btn-live', onClick: () => expose(tunnelPort), disabled: busy || exposeBusy }, exposeBusy ? '暴露中…' : '＋ 临时暴露端口'),
              ),
              React.createElement('div', { className: 'dshls-tip' }, '提示：暴露的是本机该端口（需对应服务已启动）；trycloudflare URL 无需 Cloudflare 账号/登录，进程退出即失效。'),
            ),

            // ---- 日志 ----
            logSvc ? React.createElement('div', { className: 'dshls-sec' },
              React.createElement('h4', null,
                '日志：' + logSvc + ' ',
                React.createElement('button', { className: 'dshls-btn dshls-btn-sm', onClick: () => viewLog(logSvc) }, logLoading ? '加载中…' : '⟳ 刷新'),
                React.createElement('button', { className: 'dshls-btn dshls-btn-sm', onClick: () => setLogSvc(null) }, '关闭'),
              ),
              React.createElement('pre', { style: { background: '#f8f8f8', borderRadius: 6, padding: 8, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 200, overflow: 'auto', margin: 0 } }, logText || '（加载中…）'),
            ) : null,

            // ---- 删除确认（联动停进程） ----
            confirmDel ? React.createElement('div', { className: 'dshls-sec' },
              React.createElement('h4', null, '⚠ 确认删除'),
              React.createElement('div', { className: 'dshls-row' }, '删除服务「' + confirmDel.name + '」？'),
              React.createElement('div', { className: 'dshls-row' },
                React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                  React.createElement('input', { type: 'checkbox', checked: confirmDel.stopToo !== false, onChange: (e) => setConfirmDel({ ...confirmDel, stopToo: e.target.checked }) }),
                  ' 同时停止运行中的进程'),
              ),
              React.createElement('div', { className: 'dshls-row' },
                React.createElement('button', { className: 'dshls-btn dshls-btn-danger', onClick: () => { const c = confirmDel; setConfirmDel(null); deleteSvc(c.name, c.stopToo !== false) }, disabled: busy }, '确认删除'),
                React.createElement('button', { className: 'dshls-btn', onClick: () => setConfirmDel(null) }, '取消'),
              ),
            ) : null,

            error ? React.createElement('div', { className: 'dshls-status' }, '加载失败：' + error) : null,
            notice ? React.createElement('div', { className: 'dshls-status' }, notice) : null,
            busy ? React.createElement('div', { className: 'dshls-mask' }, React.createElement('div', { className: 'dshls-mask-inner' }, '⏳ 处理中…')) : null,
          ),
        )
      }

      slots.inject('conversation.session.header.utilities', () => slots.register(
        { name: 'conversation.session.header.utilities', id: 'local-services-toggle', order: 12 },
        () => React.createElement(HeaderToggle),
      ))

      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'local-services-panel', order: 12 },
        () => React.createElement(Panel),
      ))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
