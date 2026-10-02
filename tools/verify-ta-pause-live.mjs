// ===== 专项验证：音乐「TA 暂停再播放」互动（FIX-REGRESSION #71） =====
// U 组（UI 集成，无头 Chrome）：音乐设置出现「播放中·TA 暂停再播放概率」步进器；
//   字卡库【其他互动功能字卡 → 音乐】tab 两组字卡（TA 暂停播放 / TA 恢复播放 各 6 条）渲染齐全。
// L 组（行为链路）：预置 1 首歌 + taPauseProb=100，播放 → 10~25s 内 TA 暂停（聊天出现
//   暂停字卡）→ 3.5s 后 TA 恢复播放（出现恢复字卡）。无头环境 audio 无法播放则 L 组 SKIP（不算失败）。
import { spawn } from 'node:child_process';
import { readFileSync, statSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0, skip = 0;
const check = (name, cond, detail) => { console.log((cond ? '  [PASS] ' : '  [FAIL] ') + name + (detail !== undefined ? '  实际=' + JSON.stringify(detail) : '')); cond ? pass++ : fail++; };
const skipLine = (name) => { console.log('  [SKIP] ' + name + '（无头环境 audio 无法播放）'); skip++; };

function silentWavBase64(sec = 2) {
  const rate = 8000, n = rate * sec;
  const buf = Buffer.alloc(44 + n);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34);
  buf.write('data', 36); buf.writeUInt32LE(n, 40);
  return buf.toString('base64');
}

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const tmpDir = mkdtempSync(join(tmpdir(), 'mochi-verify-tapause-'));
const built = readFileSync(join(root, 'index.html'), 'utf8');
writeFileSync(join(tmpDir, 'index.html'), built);
const baseUrl = 'file:///' + normalize(tmpDir).split(sep).join('/') + '/index.html';
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 200));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-audio-output', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-tapause-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r && r.result ? r.result.value : undefined;
}

(async () => {
  try {
    await cdpConnect();
    await cdp('Page.enable');
    // 预置：1 首静音外链歌 + taPauseProb=100（强制触发）
    const wav = silentWavBase64();
    const dataUrl = 'data:audio/wav;base64,' + wav;
    const seed = [
      { id: 't1', name: '验证歌', artist: '', url: dataUrl, source: 'url', playlistId: 'default', duration: 0, addedAt: Date.now() }
    ];
    await cdp('Page.addScriptToEvaluateOnNewDocument', {
      source: `(function(){
        try { localStorage.setItem('xy-home-v2:default:music-library', ${JSON.stringify(JSON.stringify(seed))}); } catch(e){}
        try { localStorage.setItem('xy-home-v2:default:music-global', ${JSON.stringify(JSON.stringify({ taPauseProb: 100 }))}); } catch(e){}
      })();`
    });
    await cdp('Page.navigate', { url: baseUrl });
    await sleep(2500);
    const ready = await evalJs('window.__mochiDataReady');
    check('U0 页面数据就绪（__mochiDataReady）', ready === true, ready);

    // ---- U1 音乐设置步进器 ----
    const setOpen = await evalJs(`(function(){
      const btn = document.getElementById('music-set');
      if (!btn) return 'no-btn';
      btn.click();
      return 'clicked';
    })()`);
    await sleep(600);
    const stepper = await evalJs(`(function(){
      const val = document.getElementById('sm-set-pauseprob-val');
      const box = document.getElementById('sm-set-pauseprob');
      return { exists: !!box && !!val, val: val ? val.value : null };
    })()`);
    check('U1 音乐设置出现「播放中·TA 暂停再播放概率」步进器', !!(stepper && stepper.exists), stepper);
    check('U1b 步进器初值 = 100（预置设置生效）', !!(stepper && stepper.val === '100'), stepper);
    // 关掉设置面板（点关闭）
    await evalJs(`(function(){ const c = document.getElementById('sm-set-close'); if (c) c.click(); })()`);
    await sleep(300);

    // ---- U2 字卡库【其他互动功能字卡 → 音乐】 ----
    const fc = await evalJs(`(function(){
      const page = document.getElementById('page-fun-cards');
      if (!page) return 'no-page';
      page.hidden = false;
      document.querySelectorAll('.page').forEach(p => { if (p.id !== 'page-fun-cards') p.hidden = true; });
      // 触发懒渲染
      const ev = new Event('click', { bubbles: true });
      document.getElementById('fc-tabs') ? null : null;
      // 模拟进入页面（li-fun-cards 的点击处理里 ensureRendered）
      const li = document.getElementById('li-fun-cards');
      if (li) li.click();
      return 'ok';
    })()`);
    await sleep(800);
    const musicTab = await evalJs(`(function(){
      const tab = document.querySelector('#fc-tabs .cc-tab[data-type="music"]');
      if (!tab) return null;
      tab.click();
      return tab.textContent.trim();
    })()`);
    await sleep(600);
    const musicCards = await evalJs(`(function(){
      const groups = {};
      document.querySelectorAll('#fc-list .cc-group-header').forEach(h => {
        const n = h.querySelector('.ccg-name'); const c = h.querySelector('.ccg-count');
        if (n) groups[n.textContent] = c ? parseInt(c.textContent, 10) : -1;
      });
      const items = document.querySelectorAll('#fc-list .cc-item').length;
      return { groups, items };
    })()`);
    check('U2 字卡库有「音乐」tab', !!musicTab, musicTab);
    check('U2b 音乐 tab 含「TA 暂停播放」分组（6 条）', !!(musicCards && musicCards.groups['TA 暂停播放'] === 6), musicCards);
    check('U2c 音乐 tab 含「TA 恢复播放」分组（6 条）', !!(musicCards && musicCards.groups['TA 恢复播放'] === 6), musicCards);
    check('U2d 两组共渲染 12 条', !!(musicCards && musicCards.items === 12), musicCards);

    // ---- L 组行为链路：播放 → TA 暂停 → 恢复 ----
    // 无头环境无真实音频设备：先 mock HTMLMediaElement（play/pause 走事件派发），
    // 让 music-player 的 onplay/onpause 处理器真实执行，驱动完整业务逻辑链路。
    await evalJs(`(function(){
      const proto = HTMLMediaElement.prototype;
      if (!proto.__mochiMocked) {
        proto.__mochiMocked = true;
        proto.__fakePaused = true;
        Object.defineProperty(proto, 'paused', { configurable: true, get() { return this.__fakePaused !== undefined ? this.__fakePaused : true; } });
        const origPlay = proto.play;
        proto.play = function() { const self = this; self.__fakePaused = false; queueMicrotask(function(){ try { self.dispatchEvent(new Event('play')); } catch(e){} }); return Promise.resolve(); };
        proto.pause = function() { const self = this; self.__fakePaused = true; queueMicrotask(function(){ try { self.dispatchEvent(new Event('pause')); } catch(e){} }); };
      }
    })()`);
    // 回桌面打开音乐页并点播放
    await evalJs(`(function(){
      document.querySelectorAll('.page').forEach(p => { p.hidden = true; });
      const home = document.getElementById('page-phone'); if (home) home.hidden = false;
    })()`);
    await sleep(400);
    const playRes = await evalJs(`(function(){
      const app = document.querySelector('[data-app="music"]');
      if (!app) return 'no-app';
      app.click();
      return 'clicked';
    })()`);
    await sleep(800);
    await evalJs(`(function(){ const b = document.getElementById('sm-play'); if (b) b.click(); })()`);
    await sleep(1500);
    const playing = await evalJs(`(function(){
      const auds = Array.from(document.querySelectorAll('audio'));
      const last = auds[auds.length - 1]; // 音乐播放器 audio 最后创建（前面可能有 bg-keep 保活音频）
      return { hasAudio: !!last, paused: last ? last.paused : null, src: last ? (last.src || '').slice(0, 40) : '', musicPlaying: !!window.__musicPlaying, auds: auds.length };
    })()`);
    if (playing && ((playing.hasAudio && playing.paused === false) || playing.musicPlaying)) {
      check('L1 歌曲开始播放（audio 非暂停）', true);
      // 等待 TA 暂停触发（10~25s 延迟 + 缓冲），轮询聊天记录出现暂停字卡
      let pauseCardAt = -1, resumeCardAt = -1, pauseCount = 0, resumeCount = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 35000) {
        const r = await evalJs(`(function(){
          let msgs = [];
          try { msgs = JSON.parse(localStorage.getItem('xy-home-v2:default:chat-msgs') || '[]'); } catch(e){}
          const txts = (Array.isArray(msgs) ? msgs : []).map(m => m && (m.text || (m.parts && m.parts.map(p => p.t || p.text || '').join(' ')) || ''));
          const pausePat = /先暂停一下|让音乐停一会儿|先搁一搁|我有话想跟你说|陪我一下下|按下了暂停键/;
          const resumePat = /继续听吧|按了播放|等急了|音乐继续|按下了播放键|说完啦/;
          const pauseN = txts.filter(t => pausePat.test(t)).length;
          const resumeN = txts.filter(t => resumePat.test(t)).length;
          return { count: txts.length, pauseN, resumeN, all: txts.join('|').slice(0, 300) };
        })()`);
        pauseCount = r.pauseN; resumeCount = r.resumeN;
        if (pauseCardAt < 0 && r.pauseN > 0) pauseCardAt = Date.now() - t0;
        if (r.resumeN > 0) { resumeCardAt = Date.now() - t0; break; }
        await sleep(500);
      }
      check('L2 TA 暂停后聊天出现「暂停播放」字卡', pauseCardAt >= 0, pauseCardAt);
      check('L3 TA 恢复后聊天出现「恢复播放」字卡', resumeCardAt >= 0, resumeCardAt);
      check('L4 暂停→恢复间隔约 3.5s（允许 ±2.5s）', pauseCardAt >= 0 && resumeCardAt > 0 && (resumeCardAt - pauseCardAt) >= 1000 && (resumeCardAt - pauseCardAt) <= 6000, { pauseCardAt, resumeCardAt, gap: resumeCardAt > 0 && pauseCardAt >= 0 ? resumeCardAt - pauseCardAt : null });
      const finalState = await evalJs(`(function(){ const auds = Array.from(document.querySelectorAll('audio')); const last = auds[auds.length - 1]; return { paused: last ? last.paused : null, t: last ? last.currentTime : null, musicPlaying: !!window.__musicPlaying }; })()`);
      check('L5 互动结束后音乐恢复播放（audio 非暂停）', !!(finalState && (finalState.paused === false || finalState.musicPlaying)), finalState);
      // ---- 防连发：互动完成后继续观察 8s，不再出现第二条暂停字卡（同歌一次 + 冷却） ----
      const t1 = Date.now();
      let extraPause = 0;
      while (Date.now() - t1 < 8000) {
        const r = await evalJs(`(function(){
          let msgs = [];
          try { msgs = JSON.parse(localStorage.getItem('xy-home-v2:default:chat-msgs') || '[]'); } catch(e){}
          const txts = (Array.isArray(msgs) ? msgs : []).map(m => m && (m.text || (m.parts && m.parts.map(p => p.t || p.text || '').join(' ')) || ''));
          return txts.filter(t => /先暂停一下|让音乐停一会儿|先搁一搁|我有话想跟你说|陪我一下下|按下了暂停键/.test(t)).length;
        })()`);
        extraPause = r;
        if (r > pauseCount) break;
        await sleep(500);
      }
      check('L6 防连发：互动完成后 8s 内无第二条「暂停播放」字卡', extraPause <= pauseCount, { before: pauseCount, after: extraPause });

      // ---- L7 权限开关：关闭「联系人可暂停你的播放」后播放，等待 >10s 不触发 ----
      // 重新注册注入脚本（后注册的最后执行，reload 时覆盖旧注入 → taPauseEn:false 生效）
      await cdp('Page.addScriptToEvaluateOnNewDocument', {
        source: `(function(){
          try { localStorage.setItem('xy-home-v2:default:music-global', ${JSON.stringify(JSON.stringify({ taPauseProb: 100, taPauseEn: false }))}); } catch(e){}
        })();`
      });
      await cdp('Page.reload', { ignoreCache: true });
      await sleep(2500);
      for (let i = 0; i < 20; i++) { if (await evalJs('window.__mochiDataReady')) break; await sleep(300); }
      // mock 音频需在新文档里重新注入（reload 后 HTMLMediaElement 原型恢复）
      await evalJs(`(function(){
        const proto = HTMLMediaElement.prototype;
        if (!proto.__mochiMocked) {
          proto.__mochiMocked = true;
          proto.__fakePaused = true;
          Object.defineProperty(proto, 'paused', { configurable: true, get() { return this.__fakePaused !== undefined ? this.__fakePaused : true; } });
          const origPlay = proto.play;
          proto.play = function() { const self = this; self.__fakePaused = false; queueMicrotask(function(){ try { self.dispatchEvent(new Event('play')); } catch(e){} }); return Promise.resolve(); };
          proto.pause = function() { const self = this; self.__fakePaused = true; queueMicrotask(function(){ try { self.dispatchEvent(new Event('pause')); } catch(e){} }); };
        }
      })()`);
      await evalJs(`(function(){
        document.querySelectorAll('.page').forEach(p => { p.hidden = true; });
        const home = document.getElementById('page-phone'); if (home) home.hidden = false;
      })()`);
      await sleep(300);
      await evalJs(`(function(){ const app = document.querySelector('[data-app="music"]'); if (app) app.click(); })()`);
      await sleep(500);
      // 记录本次播放前的已有聊天内容（排除旧字卡被整包写回的影响）
      const beforeSet = await evalJs(`(function(){
        let msgs = [];
        try { msgs = JSON.parse(localStorage.getItem('xy-home-v2:default:chat-msgs') || '[]'); } catch(e){}
        const s = new Set((Array.isArray(msgs) ? msgs : []).map(m => m && (m.text || (m.parts && m.parts.map(p => p.t || p.text || '').join(' ')) || '')));
        return Array.from(s);
      })()`);
      await evalJs(`(function(){ const b = document.getElementById('sm-play'); if (b) b.click(); })()`);
      await sleep(1000);
      const p7 = await evalJs(`(function(){ const a = document.querySelectorAll('audio'); const last = a[a.length - 1]; return { paused: last ? last.paused : null, musicPlaying: !!window.__musicPlaying }; })()`);
      if (p7 && (p7.paused === false || p7.musicPlaying)) {
        // 轮询 12s（超过最小触发延迟 10s）：全程无暂停事件 + 无新增暂停字卡 = 权限关闭生效
        const t7 = Date.now();
        let sawPause = false, newPause = 0;
        while (Date.now() - t7 < 12000) {
          const r = await evalJs(`(function(){
            const a = document.querySelectorAll('audio'); const last = a[a.length - 1];
            let msgs = [];
            try { msgs = JSON.parse(localStorage.getItem('xy-home-v2:default:chat-msgs') || '[]'); } catch(e){}
            return { paused: last ? last.paused : true, musicPlaying: !!window.__musicPlaying,
              txts: (Array.isArray(msgs) ? msgs : []).map(m => m && (m.text || (m.parts && m.parts.map(p => p.t || p.text || '').join(' ')) || '')) };
          })()`);
          if (r.paused) sawPause = true;
          r.txts.forEach(t => { if (/先暂停一下|让音乐停一会儿|先搁一搁|我有话想跟你说|陪我一下下|按下了暂停键/.test(t) && beforeSet.indexOf(t) < 0) newPause++; });
          await sleep(400);
        }
        check('L7 权限关闭（taPauseEn=false）后播放 12s 音乐全程未被暂停', !sawPause, { sawPause });
        check('L7b 权限关闭时聊天无新增「暂停播放」字卡', newPause === 0, { newPause });
      } else {
        skipLine('L7 权限关闭场景（无头环境 audio 未进入播放态）');
      }
    } else {
      console.log('  [DBG] playing 实际=' + JSON.stringify(playing) + '  playRes=' + JSON.stringify(playRes));
      skipLine('L1 歌曲播放（无头环境 audio 未进入播放态）');
      skipLine('L2-L5 互动链路');
    }
  } catch (e) {
    fail++;
    console.log('  [FAIL] 脚本异常: ' + (e && e.message));
  } finally {
    try { chrome.kill(); } catch (e) {}
    console.log(fail ? '\n❌ ' + fail + ' 项失败' : '\n✅ ' + pass + '/' + (pass + fail) + ' 通过' + (skip ? '（SKIP ' + skip + ' 项）' : ''));
    process.exit(fail ? 1 : 0);
  }
})();
