window.__ModuleLoader__.load({
  id: 'dsh-cloudflared-manager',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')

    // trycloudflare 直连在部分网络下不可达：可配一个「URL 改写代理」把目标域名
    // 拼到自己的 Cloudflare 域名后面，借正常边缘节点访问。
    //
    // 格式：<代理前缀><目标 host>，例如前缀为 https://proxy.example.com/https/
    // 时，https://xxx.trycloudflare.com 会改写成
    // https://proxy.example.com/https/xxx.trycloudflare.com
    //
    // 前缀由用户在面板「设置」页签里填写，存到 cf_config.json 的 proxyPrefix，
    // 由 host 端 cf-status / cf-proxy-prefix-get 返回。留空 = 不启用改写
    // （面板只给原始直连地址，并明确标注"未配置"）。
    //
    // ⚠ 早期版本这里是个写死的空常量，文案却说"可在面板里配置"，
    //   用户翻遍面板也找不到入口 —— 已改为真正可配置。
    const toProxyUrl = (u, prefix) => (prefix && u && /^https?:\/\//i.test(u))
      ? prefix + String(u).replace(/^https?:\/\//i, '')
      : ''

    // 备注（note）由 host 端读写 services.json，浏览器端只通过 /dsh-cf/api 交互，
    // 不再直接碰文件，也不依赖其他插件。

    const CSS = /* css */`
/* ── 头部入口（conversation.session.header.actions）── */
.dshcf-toggle {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 8px; border: none; border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  cursor: pointer; font-size: 13px; line-height: 1.5;
}
.dshcf-toggle:hover {
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
}
.dshcf-toggle-active { color: var(--dsw-alias-brand-primary); }
.dshcf-toggle-icon { font-size: 14px; }
.dshcf-toggle-label { font-size: 12px; }

/* ── 面板骨架：标题栏 / 状态栏 / 页签 / 内容区 ── */
/* 面板停靠在系统右侧侧边栏（rightbar 的 tab body）：铺满该列，不再浮层。
   position: relative 是必需的——日志抽屉/遮罩/toast 用 absolute 定位到它。 */
.dshcf-panel {
  position: relative;
  width: 100%; height: 100%; min-height: 0;
  flex: auto;
  display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-base);
  border: none; border-radius: 0;
  box-shadow: none;
  pointer-events: auto;
  font-size: 13px; line-height: 1.45;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
}
.dshcf-head {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 14px; flex: none;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.dshcf-title { font-weight: 600; font-size: 14px; flex: 1; }
.dshcf-head-btn {
  border: none; background: none; cursor: pointer; font-size: 14px;
  color: var(--dsw-alias-label-secondary); padding: 3px 9px; border-radius: 5px;
  white-space: nowrap;
}
.dshcf-head-btn:hover { background: var(--dsw-alias-bg-layer-2); }
.dshcf-head-btn:disabled { opacity: 0.45; cursor: default; }

/* 状态栏（固定，始终显示隧道/DNS 健康 + 启停） */
.dshcf-statusbar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 14px; flex: none;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.dshcf-statusbar-main { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.dshcf-statusbar-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; flex-wrap: wrap; }
.dshcf-chip {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; color: var(--dsw-alias-label-secondary);
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px;
  padding: 2px 9px; cursor: pointer; user-select: none;
  background: var(--dsw-alias-bg-overlay); white-space: nowrap;
}
.dshcf-chip:hover { color: var(--dsw-alias-label-primary); }
.dshcf-chip input { margin: 0; cursor: pointer; }
/* 横向告警条（加载失败 / cloudflared 未安装） */
.dshcf-warnbar {
  flex: none; padding: 6px 14px; font-size: 11.5px; line-height: 1.5;
  color: var(--dsw-alias-state-warn-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  word-break: break-all;
}

/* 页签栏 */
.dshcf-tabs {
  display: flex; align-items: stretch; gap: 2px; flex: none;
  padding: 0 10px; border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-overlay);
  overflow-x: auto; scrollbar-width: none;
}
.dshcf-tabs::-webkit-scrollbar { display: none; }
.dshcf-tab {
  border: none; background: none; cursor: pointer;
  padding: 8px 12px 7px; font-size: 12.5px; line-height: 1.4;
  color: var(--dsw-alias-label-secondary); white-space: nowrap;
  border-bottom: 2px solid transparent; border-radius: 0;
  display: inline-flex; align-items: center; gap: 6px; flex: none;
}
.dshcf-tab:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); border-radius: 6px 6px 0 0; }
.dshcf-tab-active, .dshcf-tab-active:hover {
  color: var(--dsw-alias-brand-primary); border-bottom-color: var(--dsw-alias-brand-primary);
  font-weight: 600; background: transparent; border-radius: 0;
}
.dshcf-tab-count {
  font-size: 10.5px; font-weight: 600; padding: 0 6px; border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
  min-width: 16px; text-align: center; line-height: 16px;
}
.dshcf-tab-active .dshcf-tab-count {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 15%, transparent);
  color: var(--dsw-alias-brand-primary);
}

.dshcf-body {
  flex: 1; overflow-y: auto; padding: 12px 14px;
  display: flex; flex-direction: column; gap: 10px;
}

/* 通用徽章 / 按钮 */
.dshcf-badge {
  display: inline-flex; align-items: center; padding: 2px 9px; border-radius: 10px;
  font-size: 11px; font-weight: 600; white-space: nowrap;
}
.dshcf-badge-on {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 18%, transparent);
  color: var(--dsw-alias-state-success-primary);
}
.dshcf-badge-off {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 18%, transparent);
  color: var(--dsw-alias-state-error-primary);
}
.dshcf-badge-warn {
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 18%, transparent);
  color: var(--dsw-alias-state-warn-primary);
}

.dshcf-btn {
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  border-radius: 6px; padding: 5px 12px; font-size: 12px; cursor: pointer;
  color: var(--dsw-alias-label-primary); line-height: 1.3; white-space: nowrap;
}
.dshcf-btn:hover { background: var(--dsw-alias-bg-layer-2); }
.dshcf-btn:disabled { opacity: 0.45; cursor: default; }
.dshcf-btn-primary {
  background: var(--dsw-alias-brand-primary);
  border-color: var(--dsw-alias-brand-primary); color: #fff;
}
.dshcf-btn-primary:hover:not(:disabled) { color: #fff; opacity: 0.9; }
.dshcf-btn-danger { color: var(--dsw-alias-state-error-primary); }
.dshcf-btn-sm { padding: 3px 9px; font-size: 11.5px; }

/* 列表条目 */
.dshcf-url { color: var(--dsw-alias-brand-primary); text-decoration: none; word-break: break-all; }
.dshcf-map { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px dashed var(--dsw-alias-border-l1); font-size: 12px; }
.dshcf-map:last-child { border-bottom: none; }
.dshcf-port { font-weight: 600; min-width: 70px; }
/* 快速隧道双行条目：第一行 代理地址+复制+停止，第二行 原始直连地址 */
.dshcf-map2 { flex-direction: column; align-items: stretch; gap: 5px; }
.dshcf-map-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.dshcf-map-line .dshcf-btn-danger { margin-left: auto; }
.dshcf-map-sub { font-size: 11px; color: var(--dsw-alias-label-secondary); word-break: break-all; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dshcf-map-sub .dshcf-url { color: var(--dsw-alias-label-secondary); }

.dshcf-item {
  display: flex; align-items: center; gap: 8px; padding: 7px 0;
  border-bottom: 1px dashed var(--dsw-alias-border-l1); font-size: 12px; flex-wrap: wrap;
}
.dshcf-item:last-child { border-bottom: none; }
.dshcf-item-main { flex: 1; min-width: 0; }
.dshcf-item-name { font-weight: 600; }
.dshcf-item-sub { color: var(--dsw-alias-label-secondary); font-size: 11px; word-break: break-all; }
.dshcf-item-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; flex-wrap: wrap; }

/* 服务名 → 备注小窗：点名字弹出，点小窗外面消失。
   用 position: fixed 而不是 absolute：面板窄，靠近底部的服务项弹窗会超出
   面板边界，fixed 才能保证它完整可见、且不会被 .dshcf-panel 的 overflow:hidden 裁掉。 */
.dshcf-note-btn {
  font: inherit; font-weight: 600; color: inherit; text-align: left;
  background: none; border: none; padding: 0; cursor: pointer;
  border-bottom: 1px dotted var(--dsw-alias-label-tertiary);
  max-width: 100%; overflow-wrap: anywhere;
}
.dshcf-note-btn:hover { color: var(--dsw-alias-brand-primary); border-bottom-color: currentColor; }
/* 备注只在点名字弹出的小窗里展示，列表条目里不显示 */
.dshcf-note-pop {
  position: fixed; z-index: 80;
  min-width: 180px; max-width: 280px;
  padding: 9px 11px; border-radius: 8px;
  background: var(--dsw-alias-bg-overlay);
  border: 1px solid var(--dsw-alias-border-l1);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-primary);
  animation: dshcf-pop-in 0.12s ease-out;
}
@keyframes dshcf-pop-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
.dshcf-note-pop-title { font-weight: 600; margin-bottom: 4px; overflow-wrap: anywhere; }
.dshcf-note-pop-port {
  display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 999px;
  font-size: 10.5px; font-weight: 600; vertical-align: 1px;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);
  color: var(--dsw-alias-brand-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.dshcf-note-pop-body { color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }

.dshcf-edit-row { display: flex; align-items: center; gap: 6px; flex: 1; flex-wrap: wrap; }
.dshcf-edit-row input, .dshcf-edit-row select {
  height: 28px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 5px; font-size: 12px; box-sizing: border-box;
  background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);
}

/* 新增表单：折叠开关 + 表单卡片 */
.dshcf-add-toggle {
  border: 1px dashed var(--dsw-alias-border-l1); background: transparent;
  border-radius: 8px; padding: 7px 0; width: 100%;
  font-size: 12px; cursor: pointer; color: var(--dsw-alias-label-secondary);
}
.dshcf-add-toggle:hover {
  color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-bg-layer-1);
}
.dshcf-formcard {
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px;
  padding: 10px; display: flex; flex-direction: column; gap: 8px;
}
.dshcf-formcard:has(input:focus), .dshcf-formcard:has(select:focus) {
  border-color: var(--dsw-alias-brand-primary);
}
.dshcf-formcard .dshcf-add { margin-top: 0; }
.dshcf-formcard-title {
  display: flex; align-items: center; gap: 4px;
  font-size: 12px; font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

/* 表单行与输入（面板 + 设置页共用） */
.dshcf-add { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.dshcf-add input, .dshcf-add select {
  height: 30px; padding: 0 9px; border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px; font-size: 12.5px; min-width: 0; box-sizing: border-box;
  background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);
}
.dshcf-add input:focus, .dshcf-add select:focus {
  outline: none; border-color: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
}
.dshcf-add input.dshcf-w1 { flex: 1; min-width: 110px; }
.dshcf-add input.dshcf-w2 { flex: 2; min-width: 200px; }
.dshcf-add input.dshcf-w3 { flex: 1; min-width: 100px; }
.dshcf-add select { flex: 1; min-width: 100px; }

/* 空态 */
.dshcf-emptybox {
  border: 1px dashed var(--dsw-alias-border-l1); border-radius: 10px;
  padding: 20px 12px; text-align: center;
  color: var(--dsw-alias-label-secondary); font-size: 12px;
}
.dshcf-emptybox-icon { font-size: 20px; margin-bottom: 6px; }

/* 日志抽屉（底部滑出） */
.dshcf-drawer {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 35;
  height: 46%; min-height: 220px;
  display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-overlay);
  border-top: 1px solid var(--dsw-alias-border-l1);
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.14);
  animation: dshcf-drawer-up 0.18s ease-out;
}
@keyframes dshcf-drawer-up { from { transform: translateY(14%); opacity: 0.5; } to { transform: translateY(0); opacity: 1; } }
.dshcf-drawer-head {
  display: flex; align-items: center; gap: 8px; flex: none;
  padding: 8px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1); font-size: 12.5px; font-weight: 600;
}
.dshcf-drawer-file { font-weight: 400; color: var(--dsw-alias-label-secondary); font-size: 11px; word-break: break-all; }
.dshcf-drawer-spacer { flex: 1; }
.dshcf-drawer-body { flex: 1; overflow: auto; padding: 8px 12px 12px; }
.dshcf-logpre {
  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px; padding: 8px; font-size: 11px; line-height: 1.55;
  white-space: pre-wrap; word-break: break-all; margin: 0;
  color: var(--dsw-alias-label-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

/* ── 源码查看/编辑器（独立视图，铺满内容区）──
   本地服务条目上的「源码」按钮进入；读写走本插件 host 端的
   cf-src-read / cf-src-save / cf-src-list（node:fs 实现，无外部插件依赖）。
   做成视图而不是贴底抽屉：面板只有 ~350px 宽 / ~520px 高，
   抽屉会把页签条压掉一半，而视图能和页签条共存、编辑区拿到全部剩余高度。 */
.dshcf-srcview {
  flex: 1; min-height: 0; display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-base);
}
.dshcf-src-head {
  display: flex; align-items: center; gap: 8px; flex: none; flex-wrap: wrap;
  padding: 8px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1); font-size: 12.5px; font-weight: 600;
}
.dshcf-src-dirty {
  font-weight: 600; font-size: 10.5px; padding: 1px 7px; border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 18%, transparent);
  color: var(--dsw-alias-state-warn-primary); white-space: nowrap;
}
.dshcf-src-pathrow {
  display: flex; align-items: center; gap: 6px; flex: none; flex-wrap: wrap;
  padding: 5px 14px; background: var(--dsw-alias-bg-layer-1);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dshcf-src-path {
  font-weight: 400; color: var(--dsw-alias-label-secondary); font-size: 11px;
  word-break: break-all; line-height: 1.4;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
/* 文件选择行：下拉 + 手动路径输入（单行，窄栏下也不挤压编辑区） */
.dshcf-src-cands {
  display: flex; align-items: center; gap: 6px; flex: none; flex-wrap: nowrap;
  padding: 6px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.dshcf-src-select, .dshcf-src-pathinput {
  height: 26px; padding: 0 7px; border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px; font-size: 11.5px; min-width: 0; box-sizing: border-box;
  background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);
}
.dshcf-src-select { flex: 0 1 auto; max-width: 46%; }
.dshcf-src-pathinput { flex: 1 1 auto; }
.dshcf-src-select:focus, .dshcf-src-pathinput:focus {
  outline: none; border-color: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
}
/* 编辑区：左侧行号 + 右侧 textarea，滚动同步 */
.dshcf-src-body { flex: 1; min-height: 0; display: flex; background: var(--dsw-alias-bg-base); }
.dshcf-src-gutter {
  flex: none; overflow: hidden; padding: 8px 6px 8px 10px; margin: 0;
  text-align: right; user-select: none; white-space: pre;
  font-size: 11.5px; line-height: 1.55;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-1);
  border-right: 1px solid var(--dsw-alias-border-l1);
  opacity: 0.75;
}
.dshcf-src-area {
  flex: 1; min-width: 0; resize: none; border: none; outline: none;
  padding: 8px 12px; margin: 0;
  font-size: 11.5px; line-height: 1.55;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
  white-space: pre; overflow: auto; tab-size: 2;
}
.dshcf-src-area::placeholder { color: var(--dsw-alias-label-secondary); }
.dshcf-src-empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; padding: 20px; text-align: center;
  color: var(--dsw-alias-label-secondary); font-size: 12px;
}
@media (max-width: 700px) {
  .dshcf-src-head { padding: 8px 10px; gap: 6px; }
  .dshcf-src-cands { padding: 6px 10px; flex-wrap: wrap; }
  .dshcf-src-area, .dshcf-src-gutter { font-size: 12px; }
  .dshcf-src-select { max-width: 100%; flex: 1 1 100%; }
  .dshcf-src-pathinput { flex: 1 1 100%; }
}

/* 弹层：删除确认 / 处理中 / toast */
.dshcf-mask {
  position: absolute; inset: 0; z-index: 45;
  background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 78%, transparent);
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(1px);
}
.dshcf-mask-busy { z-index: 70; }
.dshcf-mask-inner {
  background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px; padding: 18px 24px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  font-size: 13px; color: var(--dsw-alias-label-primary);
}
.dshcf-modal { width: min(420px, calc(100vw - 80px)); }
.dshcf-modal-title { margin: 0 0 8px; font-size: 13.5px; }
.dshcf-modal-msg { font-size: 12.5px; margin-bottom: 8px; word-break: break-all; }
.dshcf-modal-check { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary); margin-bottom: 12px; cursor: pointer; }
.dshcf-modal-actions { display: flex; align-items: center; gap: 8px; justify-content: flex-end; }
.dshcf-toast {
  position: absolute; top: 52px; left: 50%; transform: translateX(-50%);
  z-index: 60; max-width: calc(100% - 32px);
  display: flex; align-items: flex-start; gap: 8px;
  background: var(--dsw-alias-bg-overlay);
  border: 1px solid var(--dsw-alias-border-l1); border-left: 3px solid var(--dsw-alias-brand-primary);
  border-radius: 8px; padding: 8px 14px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
  font-size: 12px; line-height: 1.5; word-break: break-all;
  animation: dshcf-toast-in 0.18s ease-out;
}
.dshcf-toast-ok { border-left-color: var(--dsw-alias-state-success-primary); }
.dshcf-toast-err { border-left-color: var(--dsw-alias-state-error-primary); }
@keyframes dshcf-toast-in { from { opacity: 0; transform: translate(-50%, -6px); } to { opacity: 1; transform: translate(-50%, 0); } }

/* 状态 / 提示文字 */
.dshcf-status { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dshcf-tip { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.5; }

/* ── DSH 设置页签（settings.section）── */
.dshcf-setsec { display: flex; flex-direction: column; gap: 14px; max-width: 720px; }
.dshcf-setsec .dshcf-sec-title { margin: 0 0 2px; font-size: 15px; font-weight: 600; }
.dshcf-set-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.dshcf-about {
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px;
  padding: 14px 16px; background: var(--dsw-alias-bg-layer-1);
}
.dshcf-about-name { font-weight: 600; font-size: 15px; margin-bottom: 4px; }
.dshcf-about-ver { color: var(--dsw-alias-label-secondary); font-size: 12px; margin-bottom: 8px; }
.dshcf-about-desc { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.6; }
.dshcf-about-row {
  display: flex; align-items: center; gap: 8px; margin-top: 10px;
  font-size: 12px; color: var(--dsw-alias-label-secondary);
  border-top: 1px dashed var(--dsw-alias-border-l1); padding-top: 10px;
}
.dshcf-kv { display: flex; align-items: center; gap: 6px; margin: 4px 0; font-size: 12px; }
.dshcf-kv-label { color: var(--dsw-alias-label-secondary); min-width: 70px; }
.dshcf-kv-value { color: var(--dsw-alias-label-primary); font-weight: 500; word-break: break-all; }

/* ── 移动端适配（≤700px：控件整行、触控目标加大）──
   面板现在铺满右侧栏（≤768px 时该栏本身就是全屏浮层），故不再自己全屏化。 */
@media (max-width: 700px) {
  .dshcf-head { padding: 10px 12px; }
  .dshcf-title { font-size: 13.5px; }
  .dshcf-head-btn { padding: 6px 10px; }
  .dshcf-statusbar { padding: 8px 10px; gap: 6px; }
  .dshcf-statusbar-actions { width: 100%; margin-left: 0; }
  .dshcf-statusbar-actions .dshcf-btn { flex: 1 1 auto; text-align: center; padding: 7px 0; }
  .dshcf-tabs { padding: 0 6px; }
  .dshcf-tab { padding: 9px 10px 8px; }
  .dshcf-body { padding: 10px 10px calc(16px + env(safe-area-inset-bottom, 0px)); gap: 8px; }
  .dshcf-btn-sm { padding: 7px 12px; font-size: 12px; }
  .dshcf-item { gap: 6px; }
  .dshcf-item-actions { width: 100%; margin-left: 0; padding-top: 4px; }
  .dshcf-item-actions .dshcf-btn { flex: 1 1 auto; text-align: center; padding: 7px 0; }
  .dshcf-add input, .dshcf-add select { flex: 1 1 100%; min-width: 0; width: 100%; }
  .dshcf-add .dshcf-btn { flex: 1 1 100%; padding: 8px 0; text-align: center; }
  .dshcf-edit-row { width: 100%; }
  .dshcf-edit-row input { flex: 1 1 100%; min-width: 0; width: 100%; }
  .dshcf-edit-row .dshcf-btn { flex: 1 1 auto; text-align: center; padding: 7px 0; }
  .dshcf-map:not(.dshcf-map2) { flex-wrap: wrap; }
  .dshcf-map:not(.dshcf-map2) .dshcf-url { flex: 1 1 100%; order: 3; }
  .dshcf-map .dshcf-port { min-width: 54px; }
  .dshcf-map:not(.dshcf-map2) .dshcf-btn { margin-left: auto; }
  .dshcf-drawer { height: 62%; min-height: 240px; }
  .dshcf-toast { top: 6px; max-width: calc(100% - 20px); }
  .dshcf-mask-inner { padding: 14px 18px; }
  .dshcf-setsec { gap: 10px; }
  .dshcf-setsec .dshcf-about { padding: 11px 12px; }
  .dshcf-set-actions .dshcf-btn { padding: 8px 14px; }
}

`


    function insertStyles(css) {
      const id = 'dshcf-styles'
      if (document.getElementById(id)) return
      const el = document.createElement('style')
      el.id = id
      el.textContent = css
      document.head.appendChild(el)
    }

    async function api(method, args) {
      const res = await fetch('/dsh-cf/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, args: args || {} }),
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json()
    }

    // ── 源码查看/编辑 ──
    //
    // 读写都走本插件自己的 /dsh-cf/api（cf-src-read / cf-src-save / cf-src-list），
    // host 端用 node:fs 实现。
    //
    // 历史：早期为了「改 host 不用重启 DSH」，借了 dsh-file-manager 的 /dsh-fm/api。
    // 代价是本插件对文件管理器产生了可选依赖——没装它时「源码」按钮直接失效，
    // 而从 GitHub 单独安装本插件并不会自动带上文件管理器。
    // 现已自带实现，本插件可完全独立安装。

    // ── 服务备注（note）的读写 ──
    //
    // 走本插件自己的 /dsh-cf/api（cf-svc-note-set），**不依赖 dsh-file-manager**。
    // 早期版本为了「改 host 不用重启 DSH」借了文件管理器的 /dsh-fm/api 直接读写
    // services.json，代价是本插件多了一个可选依赖：没装文件管理器时备注功能直接失效。
    // 现在 host 端原生支持 note（cf-svc-add / cf-svc-update / cf-svc-note-set），
    // 这条依赖可以彻底去掉。
    async function saveServiceNote(name, note) {
      const r = await api('cf-svc-note-set', { name, note: note == null ? '' : note })
      if (!r || r.error) throw new Error((r && r.error) || '保存备注失败')
      return r
    }

    // 服务名 → 日志/PID 文件名。必须与 host 端 svcFileKey() 逐字符一致。
    // 历史 bug：原来只做 replace(/[^a-zA-Z0-9_-]/g,'_')，中文名全部塌缩成同一串
    // 下划线，不同服务共用 PID/日志文件 → 探活读到别人的 pid、日志串台。
    function svcFileKey(name) {
      const raw = String(name == null ? '' : name)
      const readable = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'svc'
      let h = 0x811c9dc5
      for (let i = 0; i < raw.length; i++) {
        h ^= raw.charCodeAt(i)
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
      }
      return readable + '-' + h.toString(16).padStart(8, '0')
    }

    // 可编辑的文本/源码后缀（用于从启动命令里挑出脚本文件，以及列目录时过滤）
    const SRC_EXT = /\.(py|pyw|js|mjs|cjs|jsx|ts|tsx|sh|bash|zsh|bat|ps1|json|ya?ml|toml|ini|cfg|conf|env|properties|txt|md|html?|css|scss|less|vue|svelte|go|rs|java|kt|c|h|cpp|hpp|cs|php|rb|lua|sql|service|desktop|plist)$/i
    const SRC_MAX_LIST = 40   // 目录候选上限，避免大目录刷屏
    const isSrcName = (name) => SRC_EXT.test(String(name || ''))

    // 从服务的「启动命令 + 工作目录」推测可编辑的源码文件。
    // 例：
    //   command='/data/.../python main.py', cwd='.../backend'  → [.../backend/main.py]
    //   command='/usr/local/bin/node serve.js 8097', cwd='...'  → [.../serve.js]
    // 绝对路径原样保留；相对路径按 cwd 拼。
    function guessSourcePaths(svc) {
      const cwd = String(svc.cwd || '/').replace(/\/+$/, '') || '/'
      const out = []
      const push = (p) => { if (p && out.indexOf(p) < 0) out.push(p) }
      const tokens = String(svc.command || '')
        .split(/\s+/)
        .map((t) => t.replace(/^['"]+|['"]+$/g, ''))
        .filter(Boolean)
      for (const t of tokens) {
        if (t.startsWith('-')) continue          // 参数（如 --port 8096）
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) continue  // URL
        if (!isSrcName(t)) continue              // 解释器/模块名（python、-m、http.server）都被滤掉
        push(t.startsWith('/') ? t : (cwd === '/' ? '/' + t : cwd + '/' + t))
      }
      return out
    }

    // 列出 cwd 顶层的源码文件（作为候选补充：命令里只写了 `-m module` 时也能挑到文件）
    async function listSourceCandidates(svc) {
      const cwd = String(svc.cwd || '/').replace(/\/+$/, '') || '/'
      let listed = []
      try {
        const r = await api('cf-src-list', { path: cwd })
        if (r && Array.isArray(r.items)) {
          listed = r.items
            .filter((e) => e && !e.dir && isSrcName(e.name))
            // 常见入口名排前面（main / app / server / index / start）
            .sort((a, b) => {
              const rank = (n) => (/^(main|app|server|serve|index|start|run|bot)\.[a-z]+$/i.test(n) ? 0 : 1)
              return rank(a.name) - rank(b.name) || String(a.name).localeCompare(String(b.name))
            })
            .slice(0, SRC_MAX_LIST)
            .map((e) => e.path || (cwd === '/' ? '/' + e.name : cwd + '/' + e.name))
        }
      } catch (e) { /* 目录列不出来不影响命令里解析出的候选 */ }
      return listed
    }

    const inject = ['slots']

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return

      ctx.effect(() => insertStyles(CSS), 'dsh-cloudflared-manager: styles')

      // 面板停靠在系统右侧侧边栏（rightbar）：图标仍是会话头部的 🌐 按钮，
      // 点击后打开/聚焦右侧栏里的「隧道管理」标签页，不再是独立浮层。
      const CF_KIND = 'cloudflared-tunnel'
      const CF_ID = 'dsh-cloudflared-manager'

      // 右栏「+」（guide）里的入口图标。自带内联 SVG，避免为一个小图标引入
      // @deepseek-ai/dsh-client-ui-primitives 依赖（guide 自身的 CubeGlyph 也是本地定义的）。
      const CFGlyph = ({ size = 22 }) => React.createElement('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.1,
        strokeLinejoin: 'round', strokeLinecap: 'round', 'aria-hidden': 'true',
      },
        React.createElement('circle', { cx: '8', cy: '8', r: '5.6' }),
        React.createElement('path', { d: 'M2.4 8h11.2' }),
        React.createElement('path', { d: 'M8 2.4c1.7 1.6 2.6 3.4 2.6 5.6S9.7 12 8 13.6C6.3 12 5.4 10.2 5.4 8S6.3 4 8 2.4z' }),
      )

      // 头部图标的点亮状态 = 右侧栏里「隧道管理」标签页当前可见（由标签页本体同步）。
      let open = false
      const listeners = new Set()
      function setOpen(v) {
        v = !!v
        if (open === v) return
        open = v
        for (const fn of listeners) fn(open)
      }
      function useOpen() {
        const [v, setV] = React.useState(open)
        React.useEffect(() => {
          listeners.add(setV)
          setV(open)
          return () => { listeners.delete(setV) }
        }, [])
        return [v, setOpen]
      }

      // 图标语义：标签页没显示就打开它；已在显示就收起右侧栏（标签页保留，再点即展开）。
      function togglePanel(sidebarRight) {
        try {
          const active = sidebarRight.active()
          if (active && active.kind === CF_KIND && sidebarRight.isExpanded()) {
            sidebarRight.toggleExpanded()
            return
          }
          sidebarRight.openTab(CF_KIND)
        } catch (err) {
          console.error('[dsh-cloudflared-manager] 打开隧道管理失败：', err)
        }
      }

      // 供设置页「打开隧道管理面板」调用：打开/聚焦右侧栏标签页。
      function openPanel() {
        const sidebarRight = ctx.get('sidebarRight')
        if (sidebarRight === undefined) return
        try { sidebarRight.openTab(CF_KIND) } catch (err) { console.error('[dsh-cloudflared-manager] 打开隧道管理失败：', err) }
      }

      const HeaderToggle = () => {
        const sidebarRight = ctx.get('sidebarRight')
        const [isOpen, toggle] = useOpen()
        return React.createElement('button', {
          className: 'dshcf-toggle' + (isOpen ? ' dshcf-toggle-active' : ''),
          onClick: () => {
            if (sidebarRight === undefined) return
            togglePanel(sidebarRight)
          },
          title: 'Cloudflared 隧道管理',
          'aria-label': 'Cloudflared 隧道管理',
        },
          React.createElement('span', { className: 'dshcf-toggle-icon' }, '🌐'),
          React.createElement('span', { className: 'dshcf-toggle-label' }, isOpen ? '隧道管理' : '隧道'),
        )
      }

      // 标签页本体：作为右侧栏里「隧道管理」标签页的内容渲染。
      const Panel = (props) => {
        const useTabInfo = props && props.useTabInfo
        const tabInfo = useTabInfo ? useTabInfo() : undefined
        const isOpen = tabInfo ? !!tabInfo.tab.visible : false
        const closeTab = tabInfo && tabInfo.tab.actions ? tabInfo.tab.actions.close : null

        React.useEffect(() => { setOpen(isOpen) }, [isOpen])
        // 标签页卸载时图标必须熄灯，否则下一次进入会话会误显示为打开态。
        React.useEffect(() => () => setOpen(false), [])
        const [status, setStatus] = React.useState(null)
        const [loading, setLoading] = React.useState(false)
        const [error, setError] = React.useState('')
        const [busy, setBusy] = React.useState(false)
        const [notice, setNotice] = React.useState('')
        const [noticeType, setNoticeType] = React.useState('ok')
        const noticeTimer = React.useRef(null)
        // 页签
        const [tab, setTab] = React.useState('named')
        const [namedAddOpen, setNamedAddOpen] = React.useState(false)
        const [svcAddOpen, setSvcAddOpen] = React.useState(false)
        // 快速隧道
        const [newPort, setNewPort] = React.useState('')
        // Named 隧道
        const [newHost, setNewHost] = React.useState('')
        // 新增映射时的「首级域名」选择（默认取白名单第一个）
        // 用户只填子域名部分（如 fb），完整 hostname = 子域名 + '.' + newApex。
        const [newApex, setNewApex] = React.useState('')
        const [newSvc, setNewSvc] = React.useState('')
        const [editHost, setEditHost] = React.useState(null)
        const [editSvc, setEditSvc] = React.useState('')
        // 本地服务
        const [svcForm, setSvcForm] = React.useState({ name: '', port: '', command: '', cwd: '/', note: '' })
        const [editSvcName, setEditSvcName] = React.useState(null)
        const [editSvcForm, setEditSvcForm] = React.useState({})
        // 服务备注小窗：notePop = { name, x, y }（屏幕坐标）。纯展示，不可编辑。
        const [notePop, setNotePop] = React.useState(null)
        const notePopRef = React.useRef(null)

        // 备注小窗的关闭逻辑：点小窗外面 / 点别的服务名 / 按 Esc / 列表滚动，都关掉。
        // 用 mousedown 而不是 click：mousedown 比 click 早，能在「点外部按钮」时
        // 先关窗，避免外部按钮的 click 被这层拦住。
        React.useEffect(() => {
          if (!notePop) return
          const onDown = (e) => {
            const pop = notePopRef.current
            if (pop && pop.contains(e.target)) return
            // 点的是某个服务名按钮 → 交给按钮自己的 onClick 处理（切换/重新定位）
            if (e.target && e.target.closest && e.target.closest('[data-dshcf-note-btn]')) return
            setNotePop(null)
          }
          const onKey = (e) => { if (e.key === 'Escape') setNotePop(null) }
          const onScroll = () => setNotePop(null)
          document.addEventListener('mousedown', onDown, true)
          document.addEventListener('keydown', onKey, true)
          window.addEventListener('scroll', onScroll, true)
          return () => {
            document.removeEventListener('mousedown', onDown, true)
            document.removeEventListener('keydown', onKey, true)
            window.removeEventListener('scroll', onScroll, true)
          }
        }, [notePop])

        // 日志查看
        const [logSvc, setLogSvc] = React.useState(null)
        const [logText, setLogText] = React.useState('')
        const [logLoading, setLogLoading] = React.useState(false)
        // 删除确认（可选联动）
        const [confirmDel, setConfirmDel] = React.useState(null)
        // auto-start
        const [autoStartNamed, setAutoStartNamed] = React.useState(false)
        const [autoStartSvcs, setAutoStartSvcs] = React.useState({})

        // 快速隧道的「URL 改写代理前缀」编辑态。
        // proxyEditing: 是否展开输入框；proxyDraft: 正在编辑的值（保存前不生效）
        const [proxyEditing, setProxyEditing] = React.useState(false)
        const [proxyDraft, setProxyDraft] = React.useState('')

        // ── 源码查看/编辑器 ──
        // srcSvc: 当前打开的服务名（null = 抽屉关闭）
        // srcPath: 正在编辑的文件绝对路径
        // srcText: 编辑区内容；srcOriginal: 打开/保存时的内容（用于脏检查）
        // srcCands: 候选文件列表 [{ path, from }]
        const [srcSvc, setSrcSvc] = React.useState(null)
        const [srcPath, setSrcPath] = React.useState('')
        const [srcText, setSrcText] = React.useState('')
        const [srcOriginal, setSrcOriginal] = React.useState('')
        const [srcCands, setSrcCands] = React.useState([])
        const [srcLoading, setSrcLoading] = React.useState(false)
        const [srcError, setSrcError] = React.useState('')
        const srcAreaRef = React.useRef(null)
        const srcGutterRef = React.useRef(null)
        // 行号文本：只跟 srcText 变化重算，避免每次输入都重新 split/join 大文件
        const srcLineNumbers = React.useMemo(() => {
          const n = srcText.length > 0 ? srcText.split('\n').length : 1
          const out = new Array(n)
          for (let i = 0; i < n; i++) out[i] = String(i + 1)
          return out.join('\n')
        }, [srcText])

        const flash = (msg, type) => {
          setNotice(msg); setNoticeType(type || 'ok')
          if (noticeTimer.current) clearTimeout(noticeTimer.current)
          noticeTimer.current = setTimeout(() => setNotice(''), 8000)
        }

        const load = React.useCallback(async () => {
          setLoading(true); setError('')
          try {
            const d = await api('cf-status')
            setStatus(d)
            if (d && d.managed) {
              const namedManaged = d.managed.find(m => m.name === 'named')
              setAutoStartNamed(namedManaged ? namedManaged.alive : false)
            }
          } catch (e) { setError(String(e && e.message || e)) }
          setLoading(false)
        }, [])

        const loadAutoStart = React.useCallback(async () => {
          try {
            const r = await api('cf-svc-auto-start-get')
            if (r.named) setAutoStartNamed(r.named.autoStart)
            if (r.services) setAutoStartSvcs(Object.fromEntries(r.services.map(s => [s.name, s.autoStart])))
          } catch (e) { /* ignore */ }
        }, [])

        React.useEffect(() => { if (isOpen) { load(); loadAutoStart() } }, [isOpen, load, loadAutoStart])
        React.useEffect(() => { if (isOpen) { setNotice(''); setError('') } }, [isOpen])
        // 自动刷新：10s → 30s。
        // 原因：cf-status 原先要 2.5-3.6s（每 10 秒就打一次 Cloudflare 云端 API 取
        // 隧道配置），刷新过密导致面板持续卡顿。已在 host 端加了 ingress 缓存，
        // 这里再把间隔放宽，两处叠加后刷新几乎无感。
        // 另外：标签页隐藏时跳过刷新，避免后台空转。
        React.useEffect(() => {
          if (!isOpen) return
          const t = setInterval(() => {
            if (typeof document !== 'undefined' && document.hidden) return
            load()
          }, 30000)
          return () => clearInterval(t)
        }, [isOpen, load])

        // 自动启动勾选的二次确认：勾上/取消都会弹窗，确认后才真正落盘。
        // 为什么需要：这个复选框就在服务条目下方，和「启动/停止/重启」那排按钮挨得很近，
        // 面板又窄，很容易点偏。误勾的后果不小——下次 DSH 启动会悄悄把服务拉起来
        // （或该自启的不再自启），而且不会有人当场发现。
        const [confirmAuto, setConfirmAuto] = React.useState(null)   // { name, want, named? }
        const requestSvcAutoStart = (name, want) => setConfirmAuto({ name, want })

        // 确认弹窗支持 Esc 取消（与删除确认弹窗一致的操作习惯）。
        // ⚠ 必须放在 confirmAuto 的 useState 之后：依赖数组在渲染期立即求值，
        //   写在使用前会踩 TDZ（Cannot access 'confirmAuto' before initialization）。
        React.useEffect(() => {
          if (!confirmAuto) return
          const onKey = (e) => { if (e.key === 'Escape') setConfirmAuto(null) }
          document.addEventListener('keydown', onKey, true)
          return () => document.removeEventListener('keydown', onKey, true)
        }, [confirmAuto])

        const setNamedAutoStart = async (v) => {
          setBusy(true)
          try {
            const r = await api('cf-named-auto-start-set', { autoStart: v })
            if (r.error) flash('设置失败：' + r.error, 'err')
            else { flash('Named 隧道自动启动已' + (v ? '开启' : '关闭')); setAutoStartNamed(v); load() }
          } catch (e) { flash('设置失败：' + String(e && e.message || e), 'err') }
          setBusy(false)
        }

        const setSvcAutoStart = async (name, v) => {
          setBusy(true)
          try {
            const r = await api('cf-svc-auto-start-set', { name, autoStart: v })
            if (r.error) flash('设置失败：' + r.error, 'err')
            else { flash('服务 ' + name + ' 自动启动已' + (v ? '开启' : '关闭')); setAutoStartSvcs(p => ({ ...p, [name]: v })); load() }
          } catch (e) { flash('设置失败：' + String(e && e.message || e), 'err') }
          setBusy(false)
        }

        const startNamed = async () => {
          setBusy(true)
          try {
            const r = await api('cf-named-start')
            if (r.ok) flash('Named 隧道已启动（连接 ' + r.connections + '）')
            else flash('启动失败：' + r.error, 'err')
            load()
          } catch (e) { flash('启动失败：' + String(e && e.message || e), 'err') }
          setBusy(false)
        }
        const stopNamed = async () => {
          if (!window.confirm('确定停止 Named 隧道？公网将不可访问。')) return
          setBusy(true)
          try {
            const r = await api('cf-named-stop')
            if (r.error) flash('停止失败：' + r.error, 'err')
            else flash('Named 隧道已停止')
            load()
          } catch (e) { flash('停止失败：' + String(e && e.message || e), 'err') }
          setBusy(false)
        }

        const addQuick = async () => {
          const port = parseInt(newPort, 10)
          if (!port) { flash('请输入有效端口', 'err'); return }
          setBusy(true)
          try {
            const r = await api('cf-map-add', { port })
            if (r.error) flash('启动失败：' + r.error, 'err')
            else flash('端口 ' + r.port + ' 隧道已启动' + (r.url && r.url.indexOf('http') === 0 ? '：' + r.url : '，等待 URL…'))
            setNewPort(''); load()
          } catch (e) { flash('启动失败：' + String(e && e.message || e), 'err') }
          setBusy(false)
        }
        const stopQuick = async (port) => {
          setBusy(true)
          try { const r = await api('cf-map-stop', { port }); if (r.error) flash('停止失败：' + r.error, 'err'); else flash('端口 ' + port + ' 快速隧道已停止') }
          catch (e) { flash('停止失败：' + String(e && e.message || e), 'err') }
          setBusy(false); load()
        }
        const copyText = async (t) => {
          if (!t) return
          try {
            if (!(navigator.clipboard && navigator.clipboard.writeText)) throw new Error('clipboard unavailable')
            await navigator.clipboard.writeText(t)
            flash('已复制：' + t)
          } catch (e) { flash('复制失败，请手动复制', 'err') }
        }

        // 保存快速隧道的 URL 改写代理前缀。
        // 前端不做 URL 校验，交给 host 端统一校验（get/set 用的是同一套规则），
        // 这样面板提示与真实行为不会出现两套判断。
        const saveProxyPrefix = async () => {
          setBusy(true)
          try {
            const r = await api('cf-proxy-prefix-set', { proxyPrefix: proxyDraft })
            if (r.error) flash('保存失败：' + r.error, 'err')
            else {
              flash(r.proxyPrefix ? ('代理前缀已保存：' + r.proxyPrefix) : '已关闭 URL 改写')
              setProxyEditing(false); setProxyDraft('')
              await load()
            }
          } catch (e) { flash('保存失败：' + String(e && e.message || e), 'err') }
          setBusy(false)
        }
        const clearProxyPrefix = async () => {
          setBusy(true)
          try {
            const r = await api('cf-proxy-prefix-set', { proxyPrefix: '' })
            if (r.error) flash('清除失败：' + r.error, 'err')
            else { flash('已关闭 URL 改写，列表只显示原始直连地址'); setProxyEditing(false); setProxyDraft(''); await load() }
          } catch (e) { flash('清除失败：' + String(e && e.message || e), 'err') }
          setBusy(false)
        }

        const addNamed = async () => {
          // 子域名 + 首级域名拼成完整 hostname。允许用户直接粘贴完整域名
          // （含 .）时不再重复拼接——避免出现 a.example.net.example.com 这种建歪形态。
          const rawSub = newHost.trim().replace(/^\.+|\.+$/g, '')
          const apex = (newApex || (zoneWhitelist[0] || '')).trim()
          if (!rawSub) { flash('请输入子域名', 'err'); return }
          if (!apex) { flash('请选择首级域名', 'err'); return }
          let hostname
          if (rawSub.indexOf('.') >= 0) {
            // 已含点：视为完整域名，但必须以所选首级域名结尾，否则拒绝（防跨域建歪）
            hostname = rawSub.toLowerCase()
            if (!(hostname === apex || hostname.endsWith('.' + apex))) {
              flash(`域名 ${hostname} 不属于 ${apex}，请检查首级域名选择`, 'err'); return
            }
          } else {
            hostname = rawSub.toLowerCase() + '.' + apex
          }
          const service = newSvc.trim() || ('http://localhost:' + newPort.trim())
          if (!service) { flash('请输入 service', 'err'); return }
          setBusy(true)
          try {
            const r = await api('cf-named-add', { hostname, service })
            if (r.error) flash('新增失败：' + r.error, 'err')
            else {
              flash('已新增 ' + hostname + ' → ' + service + (r.apex ? '（' + r.apex + '）' : '') + (r.restarted && r.restarted.ok ? '，隧道已重载' : ''))
              setNamedAddOpen(false); setNewHost(''); setNewSvc(''); setNewPort('')
            }
            load()
          } catch (e) { flash('新增失败：' + String(e && e.message || e), 'err') }
          setBusy(false)
        }
        const updateNamed = async (hostname) => {
          const service = editSvc.trim()
          if (!service) { flash('请输入新的 service', 'err'); return }
          setBusy(true)
          try {
            const r = await api('cf-named-update', { hostname, service })
            if (r.error) flash('更新失败：' + r.error, 'err')
            else { flash('已更新 ' + hostname + ' → ' + service + (r.restarted && r.restarted.ok ? '（隧道已重启）' : '')); setEditHost(null); setEditSvc('') }
            load()
          } catch (e) { flash('更新失败：' + String(e && e.message || e), 'err') }
          setBusy(false)
        }
        const deleteNamed = async (hostname, rmSvcName) => {
          setBusy(true)
          try {
            const r = await api('cf-named-delete', { hostname })
            if (r.error) { flash('删除失败：' + r.error, 'err'); load() }
            else {
              let extra = ''
              if (rmSvcName) {
                const dr = await api('cf-svc-delete', { name: rmSvcName, stop: true })
                extra = dr && dr.deleted ? '；联动删除服务 ' + rmSvcName + '（进程已停止）' : ''
              }
              flash('已删除 ' + hostname + (r.restarted && r.restarted.ok ? '（隧道已重启）' : '') + extra)
              load()
            }
          } catch (e) { flash('删除失败：' + String(e && e.message || e), 'err') }
          setBusy(false)
        }

        const addSvc = async () => {
          const name = svcForm.name.trim()
          const command = svcForm.command.trim()
          if (!name || !command) { flash('请输入服务名和启动命令', 'err'); return }
          setBusy(true)
          try {
            // 备注随新增一起提交（host 的 cf-svc-add 已原生支持 note 字段）
            const r = await api('cf-svc-add', {
              name, port: parseInt(svcForm.port, 10) || 0, command,
              cwd: svcForm.cwd.trim() || '/', note: svcForm.note.trim(),
            })
            if (r.error) { flash('新增失败：' + r.error, 'err') }
            else {
              flash('服务 ' + name + ' 已添加')
              setSvcAddOpen(false); setSvcForm({ name: '', port: '', command: '', cwd: '/', note: '' })
            }
            load()
          } catch (e) { flash('新增失败：' + String(e && e.message || e), 'err') }
          setBusy(false)
        }
        // 编辑时把备注一起带进表单，否则保存后（cf-svc-update 不认 note）无从判断是否要改
        const startEditSvc = (s) => { setEditSvcName(s.name); setEditSvcForm({ port: String(s.port || ''), command: s.command || '', cwd: s.cwd || '/', note: s.note || '' }) }
        const saveEditSvc = async (name) => {
          setBusy(true)
          try {
            // note 一并提交：cf-svc-update 现在原生支持（空串 = 清除备注）
            const r = await api('cf-svc-update', {
              name, port: parseInt(editSvcForm.port, 10) || 0,
              command: editSvcForm.command.trim(), cwd: editSvcForm.cwd.trim() || '/',
              note: editSvcForm.note == null ? '' : editSvcForm.note.trim(),
            })
            if (r.error) { flash('更新失败：' + r.error, 'err') }
            else { flash('服务 ' + name + ' 已更新'); setEditSvcName(null); setEditSvcForm({}) }
            load()
          } catch (e) { flash('更新失败：' + String(e && e.message || e), 'err') }
          setBusy(false)
        }
        const deleteSvc = async (name, stopToo) => {
          setBusy(true)
          try {
            const r = await api('cf-svc-delete', { name, stop: !!stopToo })
            if (r.error) flash('删除失败：' + r.error, 'err')
            else flash('服务 ' + name + ' 已删除' + (r.stopped ? '（进程已停止）' : ''))
            load()
          } catch (e) { flash('删除失败：' + String(e && e.message || e), 'err') }
          setBusy(false)
        }
        const startSvc = async (name) => {
          setBusy(true)
          try {
            const r = await api('cf-svc-start', { name })
            if (r.error) flash('启动失败：' + r.error, 'err')
            else flash('服务 ' + name + (r.running ? ' 已启动' : ' 已执行（端口未检测到）'))
            load()
          } catch (e) { flash('启动失败：' + String(e && e.message || e), 'err') }
          setBusy(false)
        }
        const stopSvc = async (name) => {
          setBusy(true)
          try { const r = await api('cf-svc-stop', { name }); if (r.error) flash('停止失败：' + r.error, 'err'); else flash('服务 ' + name + ' 已停止'); load() }
          catch (e) { flash('停止失败：' + String(e && e.message || e), 'err') }
          setBusy(false)
        }
        const restartSvc = async (name) => {
          setBusy(true)
          try {
            const r = await api('cf-svc-restart', { name })
            if (r.error) flash('重启失败：' + r.error, 'err')
            else flash('服务 ' + name + ' 已重启' + (r.running ? '（运行中）' : '（已执行，端口未检测到）'))
            load()
          } catch (e) { flash('重启失败：' + String(e && e.message || e), 'err') }
          setBusy(false)
        }
        const viewLog = async (name) => {
          // 与源码抽屉互斥：两个抽屉都贴底定位，同时开必然互相遮挡。
          // 源码抽屉里若有未保存改动，先确认再关（沿用 closeSource 的判据）。
          if (srcSvc && srcText !== srcOriginal && !window.confirm('源码「' + srcPath + '」有未保存的修改，查看日志将丢弃，继续？')) return
          setSrcSvc(null); setSrcPath(''); setSrcText(''); setSrcOriginal(''); setSrcCands([]); setSrcError('')
          setLogSvc(name); setLogLoading(true); setLogText('')
          try {
            const r = await api('cf-svc-log', { name, lines: 100 })
            setLogText(r.tail || '（空）')
          } catch (e) { setLogText('读取失败：' + String(e && e.message || e)) }
          setLogLoading(false)
        }

        // ══════════════ 源码查看/编辑 ══════════════

        const srcDirty = srcText !== srcOriginal

        // 读取一个文件到编辑区（path 为空表示只换服务、暂不选文件）
        const openSourceFile = async (path) => {
          if (!path) {
            setSrcPath(''); setSrcText(''); setSrcOriginal(''); setSrcError('')
            return
          }
          setSrcPath(path); setSrcLoading(true); setSrcError('')
          try {
            const r = await api('cf-src-read', { path })
            if (!r || r.error) {
              setSrcError(r && r.error ? r.error : '读取失败')
              setSrcText(''); setSrcOriginal('')
            } else {
              const text = typeof r.text === 'string' ? r.text : ''
              setSrcText(text); setSrcOriginal(text)
            }
          } catch (e) {
            setSrcError('读取失败：' + String(e && e.message || e) + '（需要 dsh-file-manager 插件在运行）')
            setSrcText(''); setSrcOriginal('')
          }
          setSrcLoading(false)
        }

        // 打开抽屉：先按启动命令推候选，再默认加载第一个
        const openSource = async (svc) => {
          setLogSvc(null)                       // 与日志抽屉互斥，避免上下重叠
          setSrcSvc(svc.name); setSrcError('')
          const guessed = guessSourcePaths(svc).map((p) => ({ path: p, from: 'cmd' }))
          setSrcCands(guessed)
          setSrcPath(''); setSrcText(''); setSrcOriginal('')
          // 目录候选（命令里解析不到文件时尤其有用）
          const listed = await listSourceCandidates(svc)
          const seen = new Set(guessed.map((g) => g.path))
          const merged = guessed.concat(listed.filter((p) => !seen.has(p)).map((p) => ({ path: p, from: 'dir' })))
          setSrcCands(merged)
          await openSourceFile(merged.length ? merged[0].path : '')
        }

        const saveSource = async () => {
          if (!srcPath) return
          setBusy(true)
          try {
            const r = await api('cf-src-save', { path: srcPath, text: srcText })
            if (!r || r.error) flash('保存失败：' + ((r && r.error) || '未知错误'), 'err')
            else {
              setSrcOriginal(srcText)
              flash('已保存 ' + (r.name || srcPath) + '（' + String(srcText.length) + ' 字符）' +
                '　提示：改完源码需在服务条目点「重启」才会生效')
            }
          } catch (e) { flash('保存失败：' + String(e && e.message || e), 'err') }
          setBusy(false)
        }

        // 关闭抽屉：有未保存改动时先确认，避免误关丢改动
        const closeSource = () => {
          if (srcDirty && !window.confirm('「' + (srcPath || '未选文件') + '」有未保存的修改，确定关闭？')) return
          setSrcSvc(null); setSrcPath(''); setSrcText(''); setSrcOriginal(''); setSrcCands([]); setSrcError('')
        }

        // 编辑区按键：Tab 缩进 2 空格、Ctrl/Cmd+S 保存
        const onSrcKeyDown = (e) => {
          if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
            e.preventDefault(); saveSource(); return
          }
          if (e.key === 'Tab') {
            e.preventDefault()
            const el = e.target
            const s = el.selectionStart
            const en = el.selectionEnd
            const next = srcText.slice(0, s) + '  ' + srcText.slice(en)
            setSrcText(next)
            // 光标移到插入的缩进之后
            requestAnimationFrame(() => { try { el.selectionStart = el.selectionEnd = s + 2 } catch (err) {} })
          }
        }

        // 行号与编辑区滚动同步
        const onSrcScroll = (e) => {
          if (srcGutterRef.current) srcGutterRef.current.scrollTop = e.target.scrollTop
        }


        // ── 由 status 派生的渲染期变量 ──
        const nt = status && status.namedTunnel
        const services = (status && status.services) || []
        const maps = (status && status.quickTunnels) || []
        const ingress = ((nt && nt.ingress) || []).filter((e) => e.hostname)
        // 可自选的首级域名（host 端白名单）。host 未返回时是空数组（不回退到任何具体域名）
        const zoneWhitelist = (status && status.zoneWhitelist) || []
        const ca = status && status.cfApi
        const cf = status && status.cloudflared
        const namedRunning = !!(nt && nt.running)
        const namedHealthy = !!(nt && nt.healthy)
        const dnsOn = !!(ca && ca.tokenSet)

        // 备注小窗：点服务名弹出，纯展示「名称 :端口 + 一句话用途」，点外面消失。
        // 备注的修改统一走「编辑」表单（新增/编辑时都能填），小窗里不放按钮。
        // 定位用 fixed + 屏幕坐标，并做边界收敛（窄面板靠右/靠底也不会跑出视口）。
        const renderNotePop = () => {
          if (!notePop) return null
          const svc = services.find((x) => x.name === notePop.name) || { name: notePop.name }
          const W = 260
          const vw = (typeof window !== 'undefined' && window.innerWidth) || 1024
          const vh = (typeof window !== 'undefined' && window.innerHeight) || 768
          const left = Math.max(8, Math.min(notePop.x, vw - W - 12))
          // 小窗高约 96，靠底时向上翻转，避免被视口截断
          const est = 96
          const top = (notePop.y + est > vh - 8) ? Math.max(8, notePop.y - est - 28) : notePop.y
          return React.createElement('div', {
            ref: notePopRef,
            className: 'dshcf-note-pop',
            style: { left: left, top: top, width: W },
          },
            React.createElement('div', { className: 'dshcf-note-pop-title' },
              svc.name,
              svc.port ? React.createElement('span', { className: 'dshcf-note-pop-port' }, ':' + svc.port) : null,
            ),
            React.createElement('div', { className: 'dshcf-note-pop-body' },
              svc.note || '（还没有备注，可在「编辑」里填写）'),
          )
        }

        const renderNamedTab = () => React.createElement(React.Fragment, null,
          ingress.length === 0
            ? React.createElement('div', { className: 'dshcf-emptybox' },
                React.createElement('div', { className: 'dshcf-emptybox-icon' }, '🌐'),
                React.createElement('div', null, '暂无域名映射'),
                React.createElement('div', { className: 'dshcf-tip', style: { marginTop: 4 } }, '新增 hostname → 本地服务 的映射后，即可通过公网域名访问本地服务'),
              )
            : ingress.map((e) =>
                editHost === e.hostname
                  ? React.createElement('div', { key: e.hostname, className: 'dshcf-item' },
                      React.createElement('span', { className: 'dshcf-item-name' }, e.hostname),
                      React.createElement('div', { className: 'dshcf-edit-row' },
                        React.createElement('input', { value: editSvc, onChange: (ev) => setEditSvc(ev.target.value), placeholder: 'http://localhost:端口' }),
                        React.createElement('button', { className: 'dshcf-btn dshcf-btn-sm dshcf-btn-primary', onClick: () => updateNamed(e.hostname), disabled: busy }, '保存'),
                        React.createElement('button', { className: 'dshcf-btn dshcf-btn-sm', onClick: () => { setEditHost(null); setEditSvc('') } }, '取消'),
                      ),
                    )
                  : React.createElement('div', { key: e.hostname, className: 'dshcf-item' },
                      React.createElement('div', { className: 'dshcf-item-main' },
                        React.createElement('a', { className: 'dshcf-item-name dshcf-url', href: 'https://' + e.hostname, target: '_blank', rel: 'noopener' }, e.hostname),
                        React.createElement('div', { className: 'dshcf-item-sub' }, e.service),
                      ),
                      // apex 为 null 说明该 hostname 不在白名单内的任何首级域名下
                      // ——历史上"建歪"的记录（hostname 被错误当成别的 zone 的子域）会落到这里，
                      // 显式标红提示，避免又被当成正常映射留着。
                      e.apex
                        ? React.createElement('span', { className: 'dshcf-badge dshcf-badge-off', title: '该映射所在的 Cloudflare zone' }, e.apex)
                        : React.createElement('span', { className: 'dshcf-badge dshcf-badge-warn', title: '该域名的首级域名不在可自选范围内，DNS 很可能没建对' }, '域名异常'),
                      React.createElement('div', { className: 'dshcf-item-actions' },
                        React.createElement('button', { className: 'dshcf-btn dshcf-btn-sm', onClick: () => { setEditHost(e.hostname); setEditSvc(e.service) }, disabled: busy }, '编辑'),
                        React.createElement('button', { className: 'dshcf-btn dshcf-btn-sm dshcf-btn-danger', onClick: () => {
                          const pm = String(e.service || '').match(/:\d+/)
                          const port = pm ? pm[0].replace(':', '') : null
                          const svc = port ? (services.find((x) => x.port === parseInt(port, 10)) || null) : null
                          setConfirmDel({ type: 'named', hostname: e.hostname, rmSvc: true, svcName: svc ? svc.name : null, port })
                        }, disabled: busy }, '删除'),
                      ),
                    ),
              ),
          !namedAddOpen
            ? React.createElement('button', { className: 'dshcf-add-toggle', onClick: () => setNamedAddOpen(true) }, '＋ 新增映射')
            : React.createElement('div', { className: 'dshcf-formcard' },
                // 子域名 + 首级域名 分开填：首级域名从后端白名单里选，
                // 拼接由前端负责，从根上避免"把 A 域名的记录建到 B 域名的 zone 下"。
                React.createElement('div', { className: 'dshcf-add' },
                  React.createElement('input', {
                    className: 'dshcf-w2', autoFocus: true,
                    placeholder: '子域名，如 fb（也可直接粘贴完整域名）',
                    value: newHost, onChange: (e) => setNewHost(e.target.value),
                  }),
                  React.createElement('select', {
                    className: 'dshcf-w1',
                    value: newApex || zoneWhitelist[0],
                    onChange: (e) => setNewApex(e.target.value),
                    title: '选择该子域名挂在哪张 Cloudflare zone 下',
                  },
                    zoneWhitelist.map((z) => React.createElement('option', { key: z, value: z }, '.' + z)),
                  ),
                ),
                React.createElement('div', { className: 'dshcf-add' },
                  React.createElement('input', { className: 'dshcf-w2', placeholder: 'service，如 http://localhost:8080', value: newSvc, onChange: (e) => setNewSvc(e.target.value) }),
                ),
                React.createElement('div', { className: 'dshcf-add' },
                  React.createElement('select', { className: 'dshcf-w3', onChange: (e) => { if (e.target.value) setNewSvc('http://localhost:' + e.target.value) } },
                    React.createElement('option', { value: '' }, '从本地服务选端口…'),
                    services.filter((x) => x.port).map((x) => React.createElement('option', { key: x.name, value: x.port }, x.name + '（:' + x.port + '）')),
                  ),
                  React.createElement('button', { className: 'dshcf-btn dshcf-btn-primary', onClick: addNamed, disabled: busy }, busy ? '处理中…' : '＋ 新增'),
                  React.createElement('button', { className: 'dshcf-btn', onClick: () => { setNamedAddOpen(false); setNewHost(''); setNewSvc('') } }, '收起'),
                ),
                React.createElement('div', { className: 'dshcf-tip' },
                  '将创建：' + ((newHost.trim() && newHost.indexOf('.') < 0)
                    ? newHost.trim() + '.' + (newApex || zoneWhitelist[0])
                    : (newHost.trim() || '<子域名>')) +
                  '　·　新增/修改会写入 config.yml 并自动重载隧道；已配置 API Token 时自动在对应 zone 创建/删除 DNS 记录（CNAME → ' + ((nt && nt.tunnelId) || '') + '.cfargotunnel.com）。'),
              ),
        )

        // ══════════════ 源码查看/编辑器（独立视图，铺满内容区） ══════════════
        //
        // 由本地服务条目的「源码」按钮进入；页签条保持完整可见，点任一页签即回到列表。
        // 读写走 dsh-file-manager 的 /dsh-fm/api，本插件 host 端零改动。
        const renderSourceView = () => React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'dshcf-src-head' },
            React.createElement('button', {
              className: 'dshcf-btn dshcf-btn-sm',
              onClick: closeSource,
              title: '返回本地服务列表',
            }, '← 返回'),
            React.createElement('span', null, '📝 ' + srcSvc),
            srcDirty ? React.createElement('span', { className: 'dshcf-src-dirty' }, '● 未保存') : null,
            React.createElement('span', { className: 'dshcf-drawer-spacer' }),
            React.createElement('button', {
              className: 'dshcf-btn dshcf-btn-sm dshcf-btn-primary',
              onClick: saveSource, disabled: busy || srcLoading || !srcPath || !srcDirty,
              title: '保存（Ctrl/Cmd+S）；改完需回列表点该服务的「重启」生效',
            }, busy ? '保存中…' : '保存'),
            React.createElement('button', {
              className: 'dshcf-btn dshcf-btn-sm',
              onClick: () => openSourceFile(srcPath), disabled: busy || srcLoading || !srcPath,
              title: '放弃改动并重新读取磁盘内容',
            }, '⟳ 重读'),
          ),
          // 第二行：完整路径（可换行，窄栏下不会被截断成一个文件名）
          React.createElement('div', { className: 'dshcf-src-pathrow' },
            React.createElement('span', { className: 'dshcf-src-path', title: srcPath || '' },
              srcPath || '（未选择文件）'),
          ),
          // 第三行：文件选择（下拉 + 手输路径）
          React.createElement('div', { className: 'dshcf-src-cands' },
            React.createElement('select', {
              className: 'dshcf-src-select',
              value: srcCands.some((c) => c.path === srcPath) ? srcPath : '',
              onChange: (e) => {
                const p = e.target.value
                if (!p || p === srcPath) return
                if (srcDirty && !window.confirm('「' + srcPath + '」有未保存的修改，切换文件将丢弃，继续？')) return
                openSourceFile(p)
              },
              title: '从启动命令与工作目录里识别出的源码文件',
            },
              srcCands.length === 0
                ? React.createElement('option', { value: '' }, '（未识别到候选文件）')
                : null,
              srcCands.some((c) => c.path === srcPath)
                ? null
                : React.createElement('option', { value: '' }, srcPath ? '（手动路径）' : '选择文件…'),
              React.createElement('optgroup', { label: '启动命令中的文件' },
                srcCands.filter((c) => c.from === 'cmd').map((c) =>
                  React.createElement('option', { key: c.path, value: c.path, title: c.path }, c.path.split('/').pop())),
              ),
              React.createElement('optgroup', { label: '工作目录下的源码文件' },
                srcCands.filter((c) => c.from !== 'cmd').map((c) =>
                  React.createElement('option', { key: c.path, value: c.path, title: c.path }, c.path.split('/').pop())),
              ),
            ),
            React.createElement('input', {
              className: 'dshcf-src-pathinput',
              placeholder: '或输入绝对路径，回车打开',
              defaultValue: '',
              title: '打开候选之外的文件（支持任意可读绝对路径）',
              onKeyDown: (e) => {
                if (e.key !== 'Enter') return
                const p = String(e.target.value || '').trim()
                if (!p) return
                if (srcDirty && !window.confirm('「' + srcPath + '」有未保存的修改，切换文件将丢弃，继续？')) return
                e.target.value = ''
                openSourceFile(p)
              },
            }),
          ),
          srcError ? React.createElement('div', { className: 'dshcf-warnbar' }, '⚠ ' + srcError) : null,
          // 编辑区：左侧行号 + 右侧 textarea（滚动同步）
          srcPath
            ? React.createElement('div', { className: 'dshcf-src-body' },
                React.createElement('pre', { className: 'dshcf-src-gutter', ref: srcGutterRef }, srcLineNumbers),
                React.createElement('textarea', {
                  className: 'dshcf-src-area',
                  ref: srcAreaRef,
                  value: srcLoading ? '（加载中…）' : srcText,
                  placeholder: srcLoading ? '' : '（空文件）',
                  spellCheck: false,
                  readOnly: srcLoading,
                  onChange: (e) => setSrcText(e.target.value),
                  onKeyDown: onSrcKeyDown,
                  onScroll: onSrcScroll,
                }),
              )
            : React.createElement('div', { className: 'dshcf-src-empty' },
                React.createElement('div', { style: { fontSize: 20 } }, '🔍'),
                React.createElement('div', null, '没能从启动命令里认出脚本文件'),
                React.createElement('div', { className: 'dshcf-tip', style: { maxWidth: 420 } },
                  '可在下方选工作目录里的文件，或先到该服务的「编辑」里把命令写成带脚本路径的形式（如 /path/python main.py）。'),
              ),
        )


        const renderSvcTab = () => React.createElement(React.Fragment, null,
          services.length === 0
            ? React.createElement('div', { className: 'dshcf-emptybox' },
                React.createElement('div', { className: 'dshcf-emptybox-icon' }, '🧩'),
                React.createElement('div', null, '暂无服务定义'),
                React.createElement('div', { className: 'dshcf-tip', style: { marginTop: 4 } }, '添加服务（名称 + 端口 + 启动命令）后即可在此启停，并在「域名映射」中暴露出去'),
              )
            : services.map((s) =>
                editSvcName === s.name
                  ? React.createElement('div', { key: s.name, className: 'dshcf-item' },
                      React.createElement('span', { className: 'dshcf-item-name' }, s.name),
                      React.createElement('div', { className: 'dshcf-edit-row' },
                        React.createElement('input', { style: { width: 70 }, value: editSvcForm.port, onChange: (e) => setEditSvcForm({ ...editSvcForm, port: e.target.value }), placeholder: '端口' }),
                        React.createElement('input', { style: { width: 180 }, value: editSvcForm.command, onChange: (e) => setEditSvcForm({ ...editSvcForm, command: e.target.value }), placeholder: '启动命令' }),
                        React.createElement('input', { style: { width: 120 }, value: editSvcForm.cwd, onChange: (e) => setEditSvcForm({ ...editSvcForm, cwd: e.target.value }), placeholder: '工作目录' }),
                        React.createElement('input', { style: { width: 200 }, value: editSvcForm.note || '', onChange: (e) => setEditSvcForm({ ...editSvcForm, note: e.target.value }), placeholder: '备注（简短用途，可留空）' }),
                        React.createElement('button', { className: 'dshcf-btn dshcf-btn-sm dshcf-btn-primary', onClick: () => saveEditSvc(s.name), disabled: busy }, '保存'),
                        React.createElement('button', { className: 'dshcf-btn dshcf-btn-sm', onClick: () => { setEditSvcName(null); setEditSvcForm({}) } }, '取消'),
                      ),
                    )
                  : React.createElement('div', { key: s.name, className: 'dshcf-item' },
                      React.createElement('span', { className: 'dshcf-badge ' + (s.running ? 'dshcf-badge-on' : 'dshcf-badge-off') }, s.running ? '● 运行' : '○ 停止'),
                      React.createElement('div', { className: 'dshcf-item-main' },
                        // 服务名做成按钮：点它弹备注小窗（点小窗外面消失）
                        React.createElement('div', { className: 'dshcf-item-name' },
                          React.createElement('button', {
                            className: 'dshcf-note-btn',
                            'data-dshcf-note-btn': s.name,
                            title: '点击查看备注',
                            onClick: (e) => {
                              const r = e.currentTarget.getBoundingClientRect()
                              // 已经开在同一个服务上 → 再点一次收起
                              if (notePop && notePop.name === s.name) { setNotePop(null); return }
                              setNotePop({ name: s.name, x: r.left, y: r.bottom + 4 })
                            },
                          }, s.name + (s.port ? '  :' + s.port : '')),
                        ),
                        // 备注不在列表里显示，只在点名字弹出的小窗里看
                        React.createElement('div', { className: 'dshcf-item-sub' }, s.command),
                      ),
                      React.createElement('div', { className: 'dshcf-item-actions' },
                        React.createElement('button', { className: 'dshcf-btn dshcf-btn-sm', onClick: () => startSvc(s.name), disabled: busy }, '启动'),
                        React.createElement('button', { className: 'dshcf-btn dshcf-btn-sm dshcf-btn-danger', onClick: () => stopSvc(s.name), disabled: busy || !s.running }, '停止'),
                        React.createElement('button', { className: 'dshcf-btn dshcf-btn-sm', onClick: () => restartSvc(s.name), disabled: busy }, '重启'),
                        React.createElement('button', { className: 'dshcf-btn dshcf-btn-sm', onClick: () => viewLog(s.name), disabled: busy }, '日志'),
                        // 源码查看/编辑：按启动命令与 cwd 自动定位脚本文件
                        React.createElement('button', {
                          className: 'dshcf-btn dshcf-btn-sm',
                          onClick: () => openSource(s),
                          disabled: busy,
                          title: '查看/编辑该服务的启动脚本源码',
                        }, '源码'),
                        React.createElement('button', { className: 'dshcf-btn dshcf-btn-sm', onClick: () => startEditSvc(s), disabled: busy }, '编辑'),
                        React.createElement('button', { className: 'dshcf-btn dshcf-btn-sm dshcf-btn-danger', onClick: () => setConfirmDel({ type: 'svc', name: s.name, running: s.running, stopToo: true }), disabled: busy }, '删除'),
                      ),
                      React.createElement('div', { style: { width: '100%', marginTop: 4, paddingTop: 4, borderTop: '1px dashed var(--dsw-alias-border-l1)' } },
                        React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11 } },
                          React.createElement('input', { type: 'checkbox', checked: !!autoStartSvcs[s.name], onChange: (e) => setSvcAutoStart(s.name, e.target.checked), disabled: busy }),
                          '随 DSH 自动启动',
                        ),
                      ),
                    ),
              ),
          !svcAddOpen
            ? React.createElement('button', { className: 'dshcf-add-toggle', onClick: () => setSvcAddOpen(true) }, '＋ 新增服务')
            : React.createElement('div', { className: 'dshcf-formcard' },
                React.createElement('div', { className: 'dshcf-add' },
                  React.createElement('input', { className: 'dshcf-w1', autoFocus: true, placeholder: '服务名', value: svcForm.name, onChange: (e) => setSvcForm({ ...svcForm, name: e.target.value }) }),
                  React.createElement('input', { className: 'dshcf-w3', placeholder: '端口', value: svcForm.port, onChange: (e) => setSvcForm({ ...svcForm, port: e.target.value }) }),
                  React.createElement('select', { className: 'dshcf-w3', onChange: (e) => { if (e.target.value) setSvcForm({ ...svcForm, port: e.target.value }) } },
                    React.createElement('option', { value: '' }, '选映射端口…'),
                    ingress.map((x) => { const m = String(x.service || '').match(/:(\d+)/); return m ? m[1] : null }).filter(Boolean).map((port) => React.createElement('option', { key: port, value: port }, '映射 :' + port)),
                  ),
                ),
                React.createElement('div', { className: 'dshcf-add' },
                  React.createElement('input', { className: 'dshcf-w2', placeholder: '启动命令，如 /path/python main.py', value: svcForm.command, onChange: (e) => setSvcForm({ ...svcForm, command: e.target.value }) }),
                  React.createElement('input', { className: 'dshcf-w2', placeholder: '工作目录，如 /data/app', value: svcForm.cwd, onChange: (e) => setSvcForm({ ...svcForm, cwd: e.target.value }) }),
                ),
                React.createElement('div', { className: 'dshcf-add' },
                  React.createElement('input', {
                    className: 'dshcf-w2',
                    placeholder: '备注：一句话说清用途，如「美国出口代理 :8080」',
                    value: svcForm.note || '',
                    onChange: (e) => setSvcForm({ ...svcForm, note: e.target.value }),
                  }),
                ),
                React.createElement('div', { className: 'dshcf-add' },
                  React.createElement('button', { className: 'dshcf-btn dshcf-btn-primary', onClick: addSvc, disabled: busy }, busy ? '处理中…' : '＋ 新增服务'),
                  React.createElement('button', { className: 'dshcf-btn', onClick: () => { setSvcAddOpen(false); setSvcForm({ name: '', port: '', command: '', cwd: '/' }) } }, '收起'),
                ),
                React.createElement('div', { className: 'dshcf-tip' }, '启动命令需写完整路径（面板环境的 PATH 不保证覆盖，如 /path/python main.py）；端口用于探活，可留空。'),
              ),
        )

        const renderQuickTab = () => React.createElement(React.Fragment, null,
          maps.length === 0
            ? React.createElement('div', { className: 'dshcf-emptybox' },
                React.createElement('div', { className: 'dshcf-emptybox-icon' }, '⚡'),
                React.createElement('div', null, '暂无运行中的快速隧道'),
                React.createElement('div', { className: 'dshcf-tip', style: { marginTop: 4 } }, '无需 Cloudflare 账号；输入本地端口即可获得临时公网地址（面板会同时给出墙内可用的代理地址）'),
              )
            : maps.map((qt) => {
                // 代理前缀来自 cf-status（用户可在「设置」里配）；留空表示不启用改写。
                const prefix = (status && typeof status.proxyPrefix === 'string') ? status.proxyPrefix : ''
                const proxy = toProxyUrl(qt.url, prefix)
                // 三种状态要分清楚，别混成一句话：
                //   1) 拿到 URL 且配了代理   → 主行显示代理地址，副行显示原始直连
                //   2) 拿到 URL 但没配代理   → 主行显示原始直连，并提示可去设置里配
                //   3) 还没拿到 URL          → 显示「等待分配域名…」，禁用复制
                // 修复前：只要没配代理就一律显示「等待 URL…」，哪怕 URL 早就有了，
                // 用户看到的就是「有地址却说等待」。
                const mainNode = proxy
                  ? React.createElement('a', { className: 'dshcf-url', href: proxy, target: '_blank', rel: 'noopener', title: '经代理前缀访问（直连不可达时用这个）' }, proxy)
                  : qt.url
                    ? React.createElement('a', { className: 'dshcf-url', href: qt.url, target: '_blank', rel: 'noopener', title: '直连地址' }, qt.url)
                    : React.createElement('span', { className: 'dshcf-tip' }, '等待分配域名…')
                return React.createElement('div', { key: qt.port, className: 'dshcf-map dshcf-map2' },
                  React.createElement('div', { className: 'dshcf-map-line' },
                    React.createElement('span', { className: 'dshcf-port' }, ':' + qt.port),
                    mainNode,
                    React.createElement('button', {
                      className: 'dshcf-btn dshcf-btn-sm',
                      onClick: () => copyText(proxy || qt.url || ''),
                      disabled: busy || !(proxy || qt.url),
                      title: proxy ? '复制代理地址' : '复制直连地址',
                    }, '复制'),
                    React.createElement('button', { className: 'dshcf-btn dshcf-btn-sm dshcf-btn-danger', onClick: () => stopQuick(qt.port), disabled: busy }, '停止'),
                  ),
                  // 副行：只有「配了代理」时才需要额外展示原始地址；
                  // 没配代理时主行就是原始地址，不用重复一遍。
                  proxy && qt.url ? React.createElement('div', { className: 'dshcf-map-sub' },
                    React.createElement('span', null, '原始直连：'),
                    React.createElement('a', { className: 'dshcf-url', href: qt.url, target: '_blank', rel: 'noopener' }, qt.url),
                  ) : null,
                  // 有 URL 但没配代理：提示可去设置里配（否则用户不知道有这个功能）。
                  (!prefix && qt.url) ? React.createElement('div', { className: 'dshcf-map-sub' },
                    React.createElement('span', { className: 'dshcf-tip' }, '直连 trycloudflare.com 在部分网络下不可达。可在「设置」页签配置「URL 改写代理前缀」，改走自己的域名。'),
                  ) : null,
                )
              }),
          React.createElement('div', { className: 'dshcf-formcard' },
            React.createElement('div', { className: 'dshcf-add' },
              React.createElement('input', { className: 'dshcf-w3', placeholder: '本地端口，如 8899', value: newPort, onChange: (e) => setNewPort(e.target.value) }),
              React.createElement('button', { className: 'dshcf-btn dshcf-btn-primary', onClick: addQuick, disabled: busy }, busy ? '处理中…' : '⚡ 启动临时隧道'),
            ),
            React.createElement('div', { className: 'dshcf-tip' }, '临时公网预览：进程独立于 DSH 运行，DSH 退出后隧道仍会保持可访问，不用时请手动点「停止」；域名每次启动都会变化。长期使用请用上方的 Named 隧道。'),
          ),

          // ── URL 改写代理前缀（可选）──
          // 直连 trycloudflare.com 在部分网络下不可达时，把目标域名拼到自己
          // 的域名后面借正常边缘节点访问。留空 = 不启用，面板只显示原始地址。
          React.createElement('div', { className: 'dshcf-formcard' },
            React.createElement('div', { className: 'dshcf-formcard-title' },
              'URL 改写代理前缀',
              React.createElement('span', { className: 'dshcf-tip', style: { marginLeft: 8, fontWeight: 400 } },
                (status && status.proxyPrefix) ? '已启用' : '未配置'),
            ),
            proxyEditing
              ? React.createElement(React.Fragment, null,
                  React.createElement('div', { className: 'dshcf-add' },
                    React.createElement('input', {
                      className: 'dshcf-w3',
                      style: { flex: '1 1 240px' },
                      placeholder: '如 https://your-proxy.example.com/https/',
                      value: proxyDraft,
                      onChange: (e) => setProxyDraft(e.target.value),
                    }),
                    React.createElement('button', { className: 'dshcf-btn dshcf-btn-primary', onClick: saveProxyPrefix, disabled: busy }, '保存'),
                    React.createElement('button', { className: 'dshcf-btn', onClick: () => { setProxyEditing(false); setProxyDraft('') } }, '取消'),
                  ),
                  React.createElement('div', { className: 'dshcf-tip' },
                    '格式：<你的代理前缀><目标域名>。例如前缀填 https://p.example.com/https/ 时，',
                    'https://xxx.trycloudflare.com 会显示为 https://p.example.com/https/xxx.trycloudflare.com 。',
                    '必须以 http:// 或 https:// 开头；留空表示不启用改写。',
                  ),
                )
              : React.createElement('div', { className: 'dshcf-add' },
                  React.createElement('div', { style: { flex: '1 1 240px', fontSize: 12, color: 'var(--dsw-alias-label-secondary)', wordBreak: 'break-all' } },
                    (status && status.proxyPrefix) || '未配置（只显示原始直连地址）'),
                  React.createElement('button', {
                    className: 'dshcf-btn dshcf-btn-sm',
                    onClick: () => { setProxyEditing(true); setProxyDraft((status && status.proxyPrefix) || '') },
                  }, '配置'),
                  (status && status.proxyPrefix)
                    ? React.createElement('button', { className: 'dshcf-btn dshcf-btn-sm dshcf-btn-danger', onClick: clearProxyPrefix, disabled: busy }, '清除')
                    : null,
                ),
            React.createElement('div', { className: 'dshcf-tip' }, '注意：只改写面板里展示的链接。页面内部写死了 trycloudflare 域名的绝对链接（比如自己页面里的资源地址）不会走代理。'),
          ),
        )

        const tabs = [
          { key: 'named', label: '域名映射', count: ingress.length },
          { key: 'svc', label: '本地服务', count: services.length },
          { key: 'quick', label: '快速隧道', count: maps.length },
        ]

        // 标签页不可见（右侧栏收起 / 本标签页在后台）时不输出任何内容。
        // 必须放在所有 hooks 之后 —— 详见上文「不能提前 return」的说明。
        if (!isOpen) return null

        return React.createElement('div', { className: 'dshcf-panel' },
          // 标题栏
          React.createElement('div', { className: 'dshcf-head' },
            React.createElement('span', { className: 'dshcf-title' }, '🌐 Cloudflared 隧道管理'),
            React.createElement('button', {
              className: 'dshcf-head-btn', onClick: load, title: '立即刷新（面板每 10 秒自动刷新）', disabled: busy,
              style: { opacity: loading ? 0.5 : undefined },
            }, '⟳ 刷新'),
            React.createElement('button', { className: 'dshcf-head-btn', onClick: () => { if (closeTab) closeTab() }, title: '关闭' }, '✕'),
          ),
          // 状态栏（隧道健康 + DNS + 自动启动 + 启停）
          React.createElement('div', { className: 'dshcf-statusbar' },
            React.createElement('div', { className: 'dshcf-statusbar-main' },
              React.createElement('span', {
                className: 'dshcf-badge ' + (namedRunning ? (namedHealthy ? 'dshcf-badge-on' : 'dshcf-badge-warn') : 'dshcf-badge-off'),
                title: '隧道 ID：' + ((nt && nt.tunnelId) || '-') + '（remotely-managed Named 隧道）',
              }, namedRunning ? (namedHealthy ? '● Named 隧道健康 · ' + (nt.connections || 0) + ' 连接' : '⚠ Named 隧道连接异常') : '○ Named 隧道未运行'),
              React.createElement('span', {
                className: 'dshcf-badge ' + (dnsOn ? 'dshcf-badge-on' : 'dshcf-badge-off'),
                title: dnsOn ? 'API Token 已配置，增删映射时自动同步 DNS' : '未配置 API Token；在 设置 → Cloudflared 隧道 中配置后可自动同步 DNS',
              }, dnsOn ? '● DNS 自动同步' : '○ DNS 未配置'),
            ),
            React.createElement('div', { className: 'dshcf-statusbar-actions' },
              React.createElement('label', { className: 'dshcf-chip', title: 'DSH 启动时自动启动 Named 隧道' },
                // 同样走确认弹窗：这个勾选框紧挨「启动/停止」，且误勾后
                // 下次 DSH 启动会悄悄拉起整条隧道，不容易察觉。
                React.createElement('input', {
                  type: 'checkbox',
                  checked: autoStartNamed,
                  onChange: () => setConfirmAuto({ name: 'Named 隧道', want: !autoStartNamed, named: true }),
                  disabled: busy,
                }),
                '自动启动',
              ),
              React.createElement('button', { className: 'dshcf-btn dshcf-btn-sm', onClick: startNamed, disabled: busy, title: '启动 Named 隧道（若已在运行则先停止再拉起）' }, '启动'),
              React.createElement('button', { className: 'dshcf-btn dshcf-btn-sm dshcf-btn-danger', onClick: stopNamed, disabled: busy || !namedRunning }, '停止'),
            ),
          ),
          // 告警条（状态加载失败 / cloudflared 未安装）
          error ? React.createElement('div', { className: 'dshcf-warnbar' }, '⚠ 状态加载失败：' + error + '（点右上「⟳ 刷新」重试）') : null,
          (cf && !cf.installed) ? React.createElement('div', { className: 'dshcf-warnbar' }, '⚠ cloudflared 未安装且自动安装失败：' + (cf.error || '')) : null,
          // 页签栏
          React.createElement('div', { className: 'dshcf-tabs' },
            tabs.map((t) => React.createElement('button', {
              key: t.key,
              className: 'dshcf-tab' + (tab === t.key ? ' dshcf-tab-active' : ''),
              onClick: () => setTab(t.key),
            }, t.label, React.createElement('span', { className: 'dshcf-tab-count' }, String(t.count)))),
          ),
          // 内容区
          // 源码编辑器作为**独立视图**接管整个内容区（而不是贴底浮起的抽屉）：
          // 面板本身只有 ~350px 宽、~520px 高，抽屉会把页签条压掉一半。
          // 打开编辑器时页签条仍完整可见，点其他页签即回到列表。
          srcSvc
            ? React.createElement('div', { className: 'dshcf-srcview' }, renderSourceView())
            : React.createElement('div', { className: 'dshcf-body' },
                tab === 'named' ? renderNamedTab() : null,
                tab === 'svc' ? renderSvcTab() : null,
                tab === 'quick' ? renderQuickTab() : null,
              ),
          // 日志抽屉
          logSvc ? React.createElement('div', { className: 'dshcf-drawer' },
            React.createElement('div', { className: 'dshcf-drawer-head' },
              React.createElement('span', null, '📜 日志：' + logSvc),
              // 日志文件名必须与 host 端 svcFileKey() 完全一致，否则这里显示的是错路径
              React.createElement('span', { className: 'dshcf-drawer-file' }, '/tmp/dsh-svc-' + svcFileKey(logSvc) + '.log'),
              React.createElement('span', { className: 'dshcf-drawer-spacer' }),
              React.createElement('button', { className: 'dshcf-btn dshcf-btn-sm', onClick: () => viewLog(logSvc), disabled: busy }, logLoading ? '加载中…' : '⟳ 刷新'),
              React.createElement('button', { className: 'dshcf-btn dshcf-btn-sm', onClick: () => setLogSvc(null) }, '关闭'),
            ),
            React.createElement('div', { className: 'dshcf-drawer-body' },
              React.createElement('pre', { className: 'dshcf-logpre' }, logText || (logLoading ? '（加载中…）' : '（空）')),
            ),
          ) : null,
          // 源码编辑器已改为独立视图，见内容区的 srcSvc 分支 / renderSourceView()
          // 服务备注小窗（点服务名弹出，点外面 / Esc / 滚动即消失）
          renderNotePop(),
          // 自动启动勾选确认弹窗（防误点）
          confirmAuto ? React.createElement('div', { className: 'dshcf-mask' },
            React.createElement('div', { className: 'dshcf-mask-inner dshcf-modal' },
              React.createElement('h4', { className: 'dshcf-modal-title' },
                confirmAuto.want ? '⚙ 开启自动启动' : '⚙ 关闭自动启动'),
              React.createElement('div', { className: 'dshcf-modal-msg' },
                confirmAuto.want
                  ? (confirmAuto.named ? '让 Named 隧道在每次 DSH 启动时自动拉起？'
                                       : '让服务「' + confirmAuto.name + '」在每次 DSH 启动时自动拉起？')
                  : (confirmAuto.named ? '不再让 Named 隧道随 DSH 自动启动？'
                                       : '不再让服务「' + confirmAuto.name + '」随 DSH 自动启动？')),
              React.createElement('div', { className: 'dshcf-tip', style: { marginBottom: 12 } },
                confirmAuto.named
                  ? (confirmAuto.want
                      ? '开启后：DSH 重启/容器重启时隧道会自动连上 Cloudflare，所有域名映射随之可用。'
                      : '关闭后：DSH 重启时隧道不会自动拉起，所有已映射的域名都会不可访问，需要手动点「启动」。')
                  : (confirmAuto.want
                      ? '开启后：DSH 重启/容器重启时它会自动运行。若命令本身会占端口或登录外部账号，注意不要与其他实例重复。'
                      : '关闭后：DSH 重启时它不会被拉起，需要手动点「启动」。当前已在运行的进程不受影响。')),
              React.createElement('div', { className: 'dshcf-modal-actions' },
                React.createElement('button', { className: 'dshcf-btn', onClick: () => setConfirmAuto(null) }, '取消'),
                React.createElement('button', {
                  className: 'dshcf-btn dshcf-btn-primary',
                  disabled: busy,
                  onClick: async () => {
                    const { name, want, named } = confirmAuto
                    setConfirmAuto(null)
                    if (named) await setNamedAutoStart(want)
                    else await setSvcAutoStart(name, want)
                  },
                }, confirmAuto.want ? '确认开启' : '确认关闭'),
              ),
            ),
          ) : null,
          // 删除确认弹窗
          confirmDel ? React.createElement('div', { className: 'dshcf-mask' },
            React.createElement('div', { className: 'dshcf-mask-inner dshcf-modal' },
              React.createElement('h4', { className: 'dshcf-modal-title' }, '⚠ 确认删除'),
              confirmDel.type === 'svc'
                ? React.createElement('div', null,
                    React.createElement('div', { className: 'dshcf-modal-msg' }, '删除服务「' + confirmDel.name + '」？'),
                    React.createElement('label', { className: 'dshcf-modal-check' },
                      React.createElement('input', { type: 'checkbox', checked: confirmDel.stopToo !== false, onChange: (e) => setConfirmDel({ ...confirmDel, stopToo: e.target.checked }) }),
                      ' 同时停止运行中的进程',
                    ),
                    React.createElement('div', { className: 'dshcf-modal-actions' },
                      React.createElement('button', { className: 'dshcf-btn dshcf-btn-danger', onClick: () => { const c = confirmDel; setConfirmDel(null); deleteSvc(c.name, c.stopToo !== false) }, disabled: busy }, '确认删除'),
                      React.createElement('button', { className: 'dshcf-btn', onClick: () => setConfirmDel(null) }, '取消'),
                    ),
                  )
                : React.createElement('div', null,
                    React.createElement('div', { className: 'dshcf-modal-msg' }, '删除映射「' + confirmDel.hostname + '」？' + (confirmDel.port ? '（指向本地 :' + confirmDel.port + '）' : '')),
                    React.createElement('label', { className: 'dshcf-modal-check' },
                      React.createElement('input', { type: 'checkbox', checked: confirmDel.rmSvc !== false, onChange: (e) => setConfirmDel({ ...confirmDel, rmSvc: e.target.checked }) }),
                      confirmDel.svcName ? ' 同时删除指向该端口的服务「' + confirmDel.svcName + '」（含停止进程）' : ' 同时删除指向该端口的本地服务',
                    ),
                    React.createElement('div', { className: 'dshcf-modal-actions' },
                      React.createElement('button', { className: 'dshcf-btn dshcf-btn-danger', onClick: () => { const c = confirmDel; setConfirmDel(null); deleteNamed(c.hostname, c.rmSvc !== false ? c.svcName : null) }, disabled: busy }, '确认删除'),
                      React.createElement('button', { className: 'dshcf-btn', onClick: () => setConfirmDel(null) }, '取消'),
                    ),
                  ),
            ),
          ) : null,
          // 操作提示 toast
          notice ? React.createElement('div', { className: 'dshcf-toast dshcf-toast-' + noticeType },
            React.createElement('span', null, noticeType === 'err' ? '⚠️' : '✅'),
            React.createElement('span', null, notice),
          ) : null,
          // 繁忙遮罩
          busy ? React.createElement('div', { className: 'dshcf-mask dshcf-mask-busy' },
            React.createElement('div', { className: 'dshcf-mask-inner' }, '⏳ 处理中…'),
          ) : null,
        )
      }

      // ── DSH 设置页签（settings.section）：插件信息 / Cloudflare API 配置 ──（维护已剥离到 dsh-maintenance）
      const SettingsSection = (props) => {
        const [status, setStatus] = React.useState(null)
        const [versionInfo, setVersionInfo] = React.useState(null)
        const [busy, setBusy] = React.useState(false)
        const [notice, setNotice] = React.useState('')
        const [tokenInput, setTokenInput] = React.useState('')
        const [zoneIdInput, setZoneIdInput] = React.useState('')

        const load = React.useCallback(async () => {
          try { setStatus(await api('cf-status')) } catch (e) { setNotice('状态加载失败：' + String(e && e.message || e)) }
          try { setVersionInfo(await api('cf-version')) } catch (e) { /* ignore */ }
        }, [])
        React.useEffect(() => { load() }, [load])

        const flash = (msg) => { setNotice(msg); setTimeout(() => setNotice(''), 8000) }

        const nt = status && status.namedTunnel
        const ca = status && status.cfApi
        // 可自选首级域名（host 端白名单），设置页据此提示"能自动同步哪些域名"
        const zoneWhitelist = (status && status.zoneWhitelist) || []
        const tokenHint = !ca
          ? '读取中…'
          : (!ca.tokenSet
            ? '未配置（DNS 自动同步不可用）'
            : `已配置 Token（增删映射时按域名自动同步 DNS，可自选：${zoneWhitelist.map((z) => 'xxx.' + z).join(' / ')}）`)

        const saveToken = async () => {
          const t = tokenInput.trim()
          if (!t) { setNotice('请输入 API Token'); return }
          setBusy(true); setNotice('')
          try {
            const r = await api('cf-cfg-set', { apiToken: t, zoneId: zoneIdInput.trim() || undefined })
            if (r.error) setNotice('保存失败：' + r.error)
            else { flash('API Token 已保存' + (r.zoneId ? '（Zone ID 已配置）' : '')); setTokenInput(''); setZoneIdInput(''); load() }
          } catch (e) { setNotice('保存失败：' + String(e && e.message || e)) }
          setBusy(false)
        }
        const testToken = async () => {
          setBusy(true); setNotice('Token 测试中…')
          try {
            const r = await api('cf-cfg-test', {})
            flash(r.message || (r.ok ? 'Token 有效' : 'Token 无效'))
          } catch (e) { flash('测试失败：' + String(e && e.message || e)) }
          setBusy(false)
        }

        return React.createElement('div', { className: 'dshcf-setsec' },
          React.createElement('div', { className: 'dshcf-about' },
            React.createElement('h3', { className: 'dshcf-sec-title' }, '🌐 Cloudflared 隧道管理'),
            versionInfo ? React.createElement('div', { className: 'dshcf-about-ver' }, '插件 v' + (versionInfo.pluginVersion || '-') + ' · cloudflared ' + (versionInfo.cloudflaredVersion || '-')) : null,
            React.createElement('div', { className: 'dshcf-about-desc' }, '管理 Named 隧道（remotely-managed）的 ingress 映射、本地服务启停、快速隧道暴露与 Cloudflare DNS 自动同步。日常启停与映射操作在会话头部的「🌐 隧道」面板（停靠在右侧侧边栏）。'),
            React.createElement('div', { className: 'dshcf-set-actions' },
              React.createElement('button', {
                className: 'dshcf-btn dshcf-btn-sm',
                title: '关闭设置并打开隧道管理面板',
                onClick: () => {
                  if (props && typeof props.close === 'function') { try { props.close() } catch (e) { /* ignore */ } }
                  openPanel()
                },
              }, '打开隧道管理面板'),
              React.createElement('span', { className: 'dshcf-badge ' + (nt && nt.running ? (nt.healthy ? 'dshcf-badge-on' : 'dshcf-badge-warn') : 'dshcf-badge-off') },
                nt && nt.running ? (nt.healthy ? '● 隧道健康 · ' + (nt.connections || 0) + ' 连接' : '⚠ 隧道连接异常') : '○ 隧道未运行'),
            ),
            React.createElement('div', { className: 'dshcf-kv', style: { marginTop: 10 } },
              React.createElement('span', { className: 'dshcf-kv-label' }, '隧道 ID'),
              React.createElement('span', { className: 'dshcf-kv-value' }, nt && nt.tunnelId ? nt.tunnelId : '-'),
            ),
          ),
          React.createElement('div', { className: 'dshcf-about' },
            React.createElement('h3', { className: 'dshcf-sec-title' }, '🔑 Cloudflare API 配置'),
            React.createElement('div', { className: 'dshcf-about-desc' }, '配置 API Token（需 Zone → DNS:Edit、Zone → Zone:Read、Cloudflare Tunnel → Edit）后，新增/删除映射会自动创建/删除 DNS CNAME 记录。当前：' + tokenHint),
            React.createElement('div', { className: 'dshcf-add', style: { marginTop: 10 } },
              React.createElement('input', { className: 'dshcf-w2', type: 'password', placeholder: 'Cloudflare API Token', value: tokenInput, onChange: (e) => setTokenInput(e.target.value) }),
              React.createElement('input', { className: 'dshcf-w3', placeholder: 'Zone ID（控制台 DNS 页 URL 中）', value: zoneIdInput, onChange: (e) => setZoneIdInput(e.target.value) }),
              React.createElement('button', { className: 'dshcf-btn dshcf-btn-primary', onClick: saveToken, disabled: busy }, busy ? '处理中…' : '保存'),
              React.createElement('button', { className: 'dshcf-btn', onClick: testToken, disabled: busy }, '测试'),
            ),
            React.createElement('div', { className: 'dshcf-tip', style: { marginTop: 8 } }, '账户级 Token 无法自动查询 Zone 列表时需手动填写 Zone ID（Cloudflare 控制台 → 域名 → DNS 页面 URL 中 dash.cloudflare.com/{account}/{zone_id}/dns）。Token 保存后仅回读是否已配置，不回显明文。'),
          ),
          notice ? React.createElement('div', { className: 'dshcf-status' }, notice) : null,
        )
      }

      // 入口：会话头部「动作行」。核心在 ≤960px 左右会对 header.utilities 整区 display:none
      // （实测 1024 可见 / ≤900 隐藏），移动端图标消失且无法点击；header.actions 全宽度可见可点。
      slots.inject('conversation.session.header.actions', () => slots.register(
        { name: 'conversation.session.header.actions', id: 'cloudflared-manager-header-action', order: 90 },
        () => React.createElement(HeaderToggle),
      ))

      // 面板改为系统右侧侧边栏里的一个标签页（tab type），而非 shell.overlay 浮层。
      // 入口（🌐）不变，仍在会话头部动作行；点击 = openTab('cloudflared-tunnel')。
      // 用 ctx.inject 等 sidebarRightTabs 就绪：右侧栏可能是本插件之后挂载的，
      // 直接用 ctx.get 会拿到 undefined 而静默丢掉标签页注册。
      ctx.inject(['slots', 'sidebarRightTabs'], (scope) => {
        const tabs = scope.sidebarRightTabs
        if (tabs === undefined) return

        scope.effect(() => tabs.register({
          id: CF_ID,
          kind: CF_KIND,
          priority: 'extension',
          title: () => '隧道管理',
          // 右栏「+」列出的入口。只声明 guide 的类型才会出现在那里；
          // 若不注册，这个面板只能靠会话头部的 🌐 打开，用户点「+」看不到它。
          guide: [{
            order: 20,
            title: () => '隧道管理',
            description: () => 'Cloudflared Named 隧道、本地服务与快速隧道',
            icon: CFGlyph,
          }],
        }), 'dsh-cloudflared-manager: tab type')

        scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register(
          { name: 'sidebar.right.pane.tab', key: CF_ID },
          (props) => React.createElement(Panel, props),
        ))
      })

      // DSH 设置页新增一级页签（与 通用/模型/插件/智能体预设 同级，排最后）
      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'cloudflared-tunnel', order: 21, label: 'Cloudflared 隧道' },
        (props) => React.createElement(SettingsSection, props),
      ))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})