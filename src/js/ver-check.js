// ===== 功能：开屏新版检测（#570，独立于 pwa.js 轮询更新条与 device.js 诊断） =====
// 需求（用户原话）：「做一个独立的新版检测功能放在开屏显示现在是不是新版」。
// 口径：与 pwa.js 轮询 / 设备兼容诊断同源——比 version.json 构建 ts 与本机
// #splash-ver 的 data-build-ts；每次冷启动只检测一次（不轮询、不加常驻网络负担）；
// 检测行渲染在开屏版本块第三行（template.html #splash-ver-check，base.css .sv-check）。
// 有新版时整行可点，复用 pwa.js 的 refreshNow（PRECACHE 预取最新 index 再 reload；
// 裸 location.reload 在弱网/iOS 上导航请求会回退旧缓存＝「刷了还在旧版」，故经其暴露的
// window.mochiRefreshNow 走同一条链）。开屏进应用后节点随 #splash-ver 一起被 clock.js
// 移除，取回晚于移除时赋值无害（离屏节点，零副作用）。
(function () {
  'use strict';
  // #386 同族：file:// 直开本地文件时 fetch 同目录 json 被浏览器禁（origin 'null'），
  // 只会白报一条错，检测行直接不显示（线上 http/https 才启用）。
  if (location.protocol === 'file:') return;
  var el = document.getElementById('splash-ver-check');
  var sv = document.getElementById('splash-ver');
  if (!el || !sv) return;
  var localTs = Number(sv.getAttribute('data-build-ts')) || 0;
  // 与 device.js devStr 同档位：不足 1 分钟 / 约 N 分钟 / 约 N.N 小时 / 约 N 天
  function gapStr(ms) {
    if (!(ms > 0)) return '';
    var min = Math.round(ms / 60000);
    if (min < 1) return '不足 1 分钟';
    if (min < 60) return '约 ' + min + ' 分钟';
    var hr = ms / 3600000;
    if (hr < 48) return '约 ' + (Math.round(hr * 10) / 10) + ' 小时';
    return '约 ' + Math.round(hr / 24) + ' 天';
  }
  function set(cls, text, clickable) {
    el.hidden = false;
    el.className = 'sv-check' + (cls ? ' ' + cls : '');
    el.textContent = text;
    el.style.cursor = clickable ? 'pointer' : '';
    el.style.textDecoration = clickable ? 'underline' : '';
    el.onclick = clickable ? function () {
      if (typeof window.mochiRefreshNow === 'function') window.mochiRefreshNow();
      else { try { location.reload(); } catch (e) {} }
    } : null;
  }
  set('', '版本检测中…');
  var done = false;
  var abort = null;
  try { if (typeof AbortController === 'function') abort = new AbortController(); } catch (e) {}
  var to = abort ? setTimeout(function () { try { abort.abort(); } catch (e) {} }, 3000) : 0;
  var opts = { cache: 'no-store' };
  if (abort) opts.signal = abort.signal;
  try {
    fetch('version.json?t=' + Date.now(), opts).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (j) {
      if (to) clearTimeout(to);
      if (done) return;
      done = true;
      var ts = j ? Number(j.ts) : 0;
      if (!(ts > 0)) { set('warn', '未能读取版本信息（不影响使用）'); return; }
      if (!localTs) { set('warn', '本机缺构建时间，无法比对'); return; }
      if (ts === localTs) { set('ok', '✓ 已是最新版'); return; }
      if (ts > localTs) { set('stale', '⇩ 有新版本（落后' + gapStr(ts - localTs) + '）· 点此更新', true); return; }
      set('warn', '本机比云端还新（CDN 同步中，可忽略）');
    }).catch(function () {
      if (to) clearTimeout(to);
      if (done) return;
      done = true;
      set('warn', '未能检测版本（离线或网络受限）· 不影响使用');
    });
  } catch (e) {
    if (to) clearTimeout(to);
    try { el.hidden = true; } catch (e2) {}
  }
})();
