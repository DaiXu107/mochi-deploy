// ===== 功能：后台保活 + 后台通知（仿星言简约版） =====
// 后台保活：播放近静音音频（1 秒循环正弦波；安卓 18000Hz / iOS 220Hz，幅度 0.006/0.002
//           × volume 0.05 ≈ 数字 -70/-80dBFS）保持页面定时器活跃，
//           并请求屏幕常亮（wakeLock），防止浏览器后台休眠导致消息/回复停止；
//           首次交互时恢复 AudioContext（浏览器自动播放策略要求）。
// 后台通知：开启后，页面不在前台时收到 TA 的新消息会弹出浏览器通知。
(function () {
  const uid = window.activePrefix();
  const store = window.activeStore();
  // v3.9.x：后台保活 / 后台通知是【系统级】设置（位于全局设置页 #page-setting），
  // 但原先按当前联系人桌面存储（activeStore）——切换桌面或系统恢复页面时 active-contact
  // 指向别的桌面，开关就会显示成「关」（用户自述：挂机几小时后回来看「后台保活自己关了」，
  // 导致夜里系统通知不弹）。改为存全局命名空间，读时回退旧版每桌面值完成迁移。
  const GNS = 'xy-home-v2';
  function gGet(k) {
    try { const v = window.xyStore ? window.xyStore(GNS).get(k) : null; if (v !== null && v !== undefined) return v; } catch (e) {}
    try { return store.get(k); } catch (e) { return null; }
  }
  function gSet(k, v) {
    try { if (window.xyStore) window.xyStore(GNS).set(k, v); } catch (e) {}
  }
  function toast(msg) {
    let t = document.getElementById('cc-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'cc-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
  }

  // ================= 后台保活 =================
  let keepAudio = null;
  let keepInterval = null;
  let keepEnabled = false;
  let keepUserTouched = false; // v3.26.x #88：本会话用户手动动过保活开关 → 回填后不重读覆盖
  let wakeSentinel = null; // v3.5.131：模块级，供 stopKeepAlive 释放

  // v3.13.x：保活补播改指数退避——原来每 5 秒无条件 play() 抢回播放权，但安卓上网页
  // 音频与其他 App 共用系统音频焦点：被抢暂停后每 5 秒抢一次＝与对方无限拉锯（用户实测：
  // 开保活后别的 App 声音一直被打断；音乐播放器因补播带退避反而显得"能共存"）。
  // 新节奏：外部打断（pause 事件）按连击退避排期 5s→10s→20s→…→60s 封顶，被音频自己
  // 打断且连续 N 次时同样退避；补播失败自动翻倍续期。稳定播放够久才复位连击。回前台
  // 自愈立即清零。测试可覆盖 window.__kaRetryBaseMs / __kaRetryMaxMs / __kaStableMs。
  let kaTimer = null;     // 排中的退避补播定时器
  let kaDelay = 0;        // 下一次补播间隔 ms；0=不在退避轨道
  let kaPauseStreak = 0;  // 连续被打断次数（稳定播放一段时间后清零）
  let kaLastPlayAt = 0;   // 最近一次 play() 被接受的时间（音频跑起来后刷新）
  let kaPlayFailStreak = 0; // 连续 play() 被拒次数（补播一直失败时翻倍退避，不无限撞墙）
  function kaCfg() {
    let base = 5000, max = 60000;
    try { if (typeof window.__kaRetryBaseMs === 'number') base = Math.max(1, window.__kaRetryBaseMs); } catch (e) {}
    try { if (typeof window.__kaRetryMaxMs === 'number') max = Math.max(1, window.__kaRetryMaxMs); } catch (e) {}
    return { base: base, max: Math.max(base, max) };
  }
  function kaStableMs() {
    try { if (typeof window.__kaStableMs === 'number') return Math.max(1, window.__kaStableMs); } catch (e) {}
    return 90000;
  }
  // 排一次退避补播。delayMs 缺省按连击次数指数化（1st=base, 2nd=2*base…封顶 max）。
  // 已有排程不重复排。测试探针：window.__kaNextDelayMs 返回当前将用的间隔。
  function kaSchedule(delayMs) {
    if (!keepEnabled || kaTimer) return;
    const cfg = kaCfg();
    if (!delayMs) {
      kaPauseStreak++;
      delayMs = Math.min(cfg.base * Math.pow(2, Math.min(kaPauseStreak - 1, 10)), cfg.max);
    }
    // FIX 2026-09-04 #153 Chromium 139 起安卓后台页面冻结从 5 分钟缩到 1 分钟（stop-in-background，
    // Chrome for Android 139 / Edge 等内核跟进）——保活音频暂停超过冻结线页面即被整个冻结
    // （定时器全停=后台消息/通知全停）。页面隐藏期间补播退避封顶 20s（前台仍 60s 不变，
    // 不回归 v3.13.x 音频拉锯修复）：保证冻结线内至少 2~3 次重试，音频焦点一让位就能恢复
    // 「正在播放」豁免躲过冻结。
    if (document.visibilityState === 'hidden' && delayMs > 20000) delayMs = 20000;
    kaDelay = delayMs;
    window.__kaNextDelayMs = delayMs; // 回归探针
    kaTimer = setTimeout(function () {
      kaTimer = null;
      if (!keepEnabled || !keepAudio || !keepAudio.el || musicNowPlaying()) { kaDelay = 0; return; }
      if (!keepAudio.el.paused) { kaDelay = 0; return; }
      const p = keepAudio.el.play();
      const after = function () {
        // 补播后仍在暂停（play 被拒/又被按住）→ 翻倍排下一次，封顶 max
        if (keepEnabled && keepAudio && keepAudio.el && keepAudio.el.paused && !musicNowPlaying()) {
          const c2 = kaCfg();
          kaSchedule(Math.min((kaDelay || c2.base) * 2, c2.max));
        }
      };
      if (p && p.then) p.then(after, after); else after();
    }, kaDelay);
  }
  function kaStopTimer() { if (kaTimer) { clearTimeout(kaTimer); kaTimer = null; } kaDelay = 0; }
  function kaResetBackoff() { kaStopTimer(); kaPauseStreak = 0; kaPlayFailStreak = 0; }
  function kaMarkPlayed() { kaLastPlayAt = Date.now(); }

  // v3.10.x：与音乐播放器共存（修复「音乐+保活音频同时出声导致音乐卡顿」）——
  // 手机端两个 <audio> 同时持续输出时，混音/音频焦点互相争抢；保活音频每 5 秒的
  // 补播重试还会与 music-player 自身的防暂停补播形成拉锯，表现为音乐周期性卡顿。
  // 策略：音乐播放期间（window.__musicPlaying=true）保活音频主动让位暂停——
  // 音乐自带活跃媒体会话（playbackState=playing），后台同样不被冻结，保活目的不丢；
  // 音乐停止/暂停后自动把保活音频拉回来。
  function musicNowPlaying() { try { return !!window.__musicPlaying; } catch (e) { return false; } }
  function syncKeepForMusic() {
    if (!keepAudio || !keepAudio.el) return;
    try {
      if (musicNowPlaying()) {
        if (!keepAudio.el.paused) keepAudio.el.pause(); // 让位：音乐在播，保活音频暂停
      } else if (keepEnabled && keepAudio.el.paused) {
        // 音乐停止，收回保活音频：已在退避轨道就让排程接管；否则立即试播
        if (kaTimer || kaDelay) return;
        const p = keepAudio.el.play();
        if (p && p.catch) p.catch(function () {});
        // v3.17.x：音乐停止/暂停后把媒体条接管回「Mochi 后台保活」——
        // 音乐暂停瞬间保活音频拉回，但媒体条 metadata 仍是歌曲（title=歌名），
        // 通知栏媒体条显示"已暂停的歌曲"甚至消失；这里立即重设保活条
        setKeepMediaSession();
      }
    } catch (e) {}
  }
  // 监听 music-player 对 __musicPlaying 的写入（onplay/onpause/updateMediaSession 维护，
  // 该文件先于本模块加载、只在播放事件时写）——音乐起播瞬间立即让位、停止瞬间立即收回，
  // 不等下一个 5 秒轮询。getter/setter 透传，对其他读取方完全透明。
  (function installMusicPlayingWatcher() {
    try {
      let v = !!window.__musicPlaying;
      Object.defineProperty(window, '__musicPlaying', {
        configurable: true,
        get: function () { return v; },
        set: function (nv) {
          nv = !!nv;
          if (nv === v) return;
          v = nv;
          setTimeout(syncKeepForMusic, 0);
        }
      });
    } catch (e) {}
  })();

  // v3.5.160：保活音频 dataURL——用 <audio> 元素循环播放（不是 Web Audio 振荡器）。
  // 关键机制：Chrome 安卓的媒体通知条（通知栏"正在播放"）绑定到 HTMLMediaElement
  // （<audio>/<video>），Web Audio 的 AudioContext 振荡器【不触发媒体条】——这正是
  // 之前"音乐能显示媒体条、保活看不到"的原因。改用 <audio> 后媒体条正常显示、
  // 后台不冻结。合成 1 秒极轻正弦波 WAV（220Hz）。
  // v3.15.x：幅度按平台自适应——原固定幅度 0.02 × volume 0.05 ≈ -60dBFS，是按安卓
  // Chrome「近零音量会被无声检测节流」调的下限；但 iPhone 扬声器灵敏、夜间环境安静，
  // 实听是明显的周期性「嘟嘟嘟嘟」（1 秒 loop 接缝 + 持续低频纯音），用户报修
  // 「不是静音音频」。iOS 无安卓那套无声节流，保活只要求「有非零样本在播」：
  // iOS 把幅度降到 ±3 LSB 级（0.002 × 0.05 ≈ -80dBFS，任何扬声器物理不可闻，
  // 但样本非零不构成数字静音）；安卓同型问题多机型复发（#190：OPPO Find X9 自带浏览器 HeyTapBrowser 等「一进网页就有底噪/电流声」）——220Hz 低频纯音在人耳最敏感频段、循环常播，-60dBFS 在灵敏扬声器上实听即持续嗡声，说明 0.02 下限过高；降为 0.006（×0.05 音量 ≈ -88dBFS，物理不可闻）：防无声节流要的是「样本非零 + volume>0」（浏览器静音检测按零样本/静音状态判定，不按响度），非零即保活有效；若保活因此失效（后台被冻结）再回调上限并换其他豁免信号，不回 220Hz 大音量（原安卓幅度 0.02）。
  let KEEP_AUDIO_DATAURL = '';
  // v3.26.x 收口第二批：iOS 判定改读唯一判定源 device.js（mochiDevice.isIOS，
  // 含 iPadOS Macintosh 伪装分支 #144）——此前这里自拼一份 UA 正则 + 伪装检测，
  // 与 device.js 各算一遍（v3.16.x 收口漏网的角落，device.js 判定规则升级时
  // 这里会被漏掉）。保留函数名薄壳：#207 哨兵/verify-keep-audio 按函数抽取。
  function kaIsIOS() {
    try { return !!(window.mochiDevice || {}).isIOS; } catch (e) {}
    return false;
  }
  function ensureKeepAudioDataUrl() {
    if (KEEP_AUDIO_DATAURL) return KEEP_AUDIO_DATAURL;
    try {
      const sr = 44100, sec = 1, n = sr * sec;
      // #190：安卓 0.02 → 0.006（原值实听底噪，见上方注释；iOS 维持 0.002）
      // #260：0.006 恢复回 0.02——#190/#207 的底噪根因在 220Hz 频率（#207 已换 18kHz：
      // 人耳对 18kHz 基本无感 + 手机外放高频天然滚降 20~40dB，幅度回调不触发底噪回潮），
      // 而 0.006×0.05=0.0003 距 Chromium audible 判定线仅 20% 余量，Edge/Chromium 152
      // 起判定一收紧（按响度/频带）豁免即丢=后台 1 分钟冻结（vivo X200s Edge 152 实报，
      // 「以前可以」时代正是 0.02×0.05=0.001）。18kHz@0.02 恢复 4 倍电平余量，听感语义
      // 不变（18kHz 上线后无底噪投诉）；iOS 220Hz@0.002 维持 bit 级不动。
      const amp = kaIsIOS() ? 0.002 : 0.02;
      // #207：安卓频率 220Hz → 18000Hz——#190 降幅度后 OPPO R15 自带浏览器（HeyTapBrowser）
      // 等多机型仍报「后台保活有电流声，不是静音音频」：220Hz 落在人耳最敏感低频段，
      // -70dBFS 数字电平在老机型功放底噪/夜间安静环境实听仍是持续嗡声，降幅度已到头
      // （再降会跌破 Chromium audible 判定、保活失效）。保活只看「样本非零 + volume>0」：
      // Chromium 的 audible/无声节流按数字样本电平判定、与频率无关——18kHz 与 220Hz 同
      // 幅度 RMS 完全一致，保活有效性零变化；而人耳对 18kHz 基本无感 + 手机外放高频频响
      // 天然滚降 20~40dB（老机型更差），物理不可闻。18000×1s=整周期，循环接缝无相位跳变
      // （无咔哒声）；18000 < 22050 奈奎斯特且距 48k 重采样抗混叠滤波带有余量。
      // FIX 2026-09-12 #340 iOS 保活嗡鸣（iPhone 16 Pro Safari「打开一直震动响声，重启无用」）：
      // iOS 分支 220Hz@0.002 就是 #190/#207 在安卓上被投诉的同一根因（220Hz 落在人耳最敏感
      // 低频段），当时以「v3.15.x 已收敛」保留；且 iOS Safari 忽略 <audio>.volume（WebKit
      // 已知限制），volume=0.05 的压低在 iPhone 上完全不生效——iOS 实际电平 0.002 比安卓
      // 当年被投诉的 0.02×0.05=0.001 还大 4 倍，好扬声器机型实听持续嗡鸣（感知似震动）。
      // 保活开关持久化 → 每次打开自动恢复响，重启无用。修法与 #207 同根因：iOS 分支同改
      // 18000Hz（iOS 无 Chromium audible 节流判定，样本非零即可；循环接缝整周期性质不变），
      // 幅度分支 amp 不动=保活电平语义零变化。
      const freq = 18000;
      const buf = new ArrayBuffer(44 + n * 2);
      const dv = new DataView(buf);
      const ws = function (o, s) { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
      ws(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE');
      ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
      ws(36, 'data'); dv.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) {
        const v = Math.sin(2 * Math.PI * freq * (i / sr)) * amp;
        dv.setInt16(44 + i * 2, Math.round(v * 32767), true);
      }
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      KEEP_AUDIO_DATAURL = 'data:audio/wav;base64,' + btoa(bin);
    } catch (e) { KEEP_AUDIO_DATAURL = ''; }
    return KEEP_AUDIO_DATAURL;
  }

  // v3.9.x：设置"后台保活"媒体会话条。音乐播放时（__musicPlaying）让位给 music-player
  // 的歌曲 metadata + 控制 handler，避免通知栏按钮空响应无法控制音乐。
  // v3.28.x：音乐「还有播放意图」（__musicWantPlay=true，仅被外部打断短暂暂停）时同样
  // 让位——否则一次后台瞬断就会把歌曲媒体条覆盖成「Mochi 后台保活」，音乐恢复后元数据
  // 不再回来，通知栏媒体条时有时无（Chrome 把页面当闲置标签冻结 → 音乐停播）。让位窗口内
  // 保活音频照常出声（页面持续输出音频，防冻结），歌曲条由 music-player 的 onplay 恢复。
  function musicIntentPlaying() { try { return !!window.__musicWantPlay; } catch (e) { return false; } }
  function setKeepMediaSession() {
    try {
      if (!('mediaSession' in navigator) || !navigator.mediaSession || !window.MediaMetadata) return;
      if (window.__musicPlaying) return; // 音乐在播，保留音乐的媒体条
      if (musicIntentPlaying()) return; // 音乐还想播（瞬断暂停中），不覆盖歌曲媒体条
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: 'Mochi 后台保活',
        artist: 'mochi',
        album: '后台消息提醒运行中'
      });
      // v3.5.159：声明 playbackState='playing'——Chrome 安卓判定"页面正在播放媒体"
      // 必须 playbackState=playing + 音频实际输出，否则媒体会话不激活、后台照常冻结
      try { navigator.mediaSession.playbackState = 'playing'; } catch (e) {}
      try {
        navigator.mediaSession.setActionHandler('play', function () {});
        navigator.mediaSession.setActionHandler('pause', function () {});
      } catch (e) {}
    } catch (e) {}
  }

  // ================= #260：WebRTC 保活锚点（第二冻结豁免信号） =================
  // 保活音频只押「正在播放音频」这一个冻结豁免信号：0.006×0.05=0.0003 距 audible
  // 判定线仅 20% 余量，内核一收紧（vivo X200s Edge/Chromium 152 实报，「以前可以」）
  // 豁免即丢 → 页面 1 分钟冻结、后台消息/通知全停（#153 的补播钳制只能保证「音频被
  // 认定在播时」有效，豁免本身丢了它救不回）。页面生命周期规范的冻结豁免条件里
  // WebRTC 是与音频并列的另一条——这里建一对页内回环 RTCPeerConnection + 数据通道：
  // 全程本机回环（host candidate，无需 STUN/TURN、无外发流量）、无音频焦点、无声
  // 可听，与保活音频互为双锚（任一失效另一个仍在）。环境不支持则静默跳过，保活
  // 音频照旧；不做机型白名单。
  let kaPc1 = null, kaPc2 = null, kaWebrtcTimer = null;
  let kaCand1 = [], kaCand2 = [];
  // FIX 2026-09-13 #433 WebRTC 锚点「启动延迟 + 断连自愈窗 + 重建退避」（vivo Y78 自带浏览器
  //   等低端机「一进网站就非常卡」，实测帧率 2fps、每 ~2.2s 一个 2.1~2.4s 长任务，多机型同现）：
  //   实锤（无头 CPU 采样探针）：new RTCPeerConnection() 本身是重主线程操作——6x 节流的
  //   桌面核单次构造阻塞 ~1.5s（对应 1711/1887ms 长任务），低端安卓核放大到 ~2-2.5s，与
  //   真机诊断长任务尺寸完全吻合；#260 原来在 startKeepAlive 里**同步**建一对＝开屏关键
  //   路径上叠加两个秒级长任务。且 p1 瞬态 'disconnected'（ICE 例行重连，规范明示可恢复）
  //   也被当死亡立即拆+30s 重建＝网络抖动机型反复支付构造成本。改法（锚点能力不删，只改
  //   时机与节奏，防跨机型回归）：
  //   ① startKeepAlive 改 10s 后延迟建锚（保活音频/mediaSession/wakeLock 主锚点原样即时
  //     生效，WebRTC 只是第二豁免信号，晚到不回退 #260 的冻结防线；页面刚进前台也不冻结）；
  //   ② 'disconnected' 先给 8s 自愈观察窗，恢复即零成本，仍断才拆+排重建；
  //   ③ 重建间隔指数退避 30s→60s→…→15min 封顶，连接稳定满 5min 才复位——抖动机型
  //     不再每 30s 付一次构造成本；
  //   ④ 回前台补建（healKeepAlive）也走 3s 延迟——resume 瞬间主线程正忙（重渲/回填）。
  let kaWebrtcBootTimer = null;   // 启动延迟建锚定时器
  let kaWebrtcDiscTimer = null;   // disconnected 自愈观察窗定时器
  let kaWebrtcRebuildDelay = 0;   // 下次重建间隔 ms（指数退避轨道）；0=不在轨道
  let kaWebrtcOkAt = 0;           // 最近一次进入 connected 的时刻（稳定判定用）
  function kaWebrtcDeferredStart(delayMs) {
    if (kaWebrtcBootTimer) { clearTimeout(kaWebrtcBootTimer); kaWebrtcBootTimer = null; }
    kaWebrtcBootTimer = setTimeout(function () {
      kaWebrtcBootTimer = null;
      if (!keepEnabled || kaPc1 || kaPc2) return;
      // 已后台则不建：后台建锚同样阻塞主线程且无感知收益，回前台 healKeepAlive 兜底补建
      if (document.hidden) return;
      kaWebrtcStart();
    }, delayMs);
  }
  function kaWebrtcScheduleRebuild() {
    // 距上次 connected 稳定满 5min 才断＝环境性偶发，退避从头计；短命连接持续加码
    if (kaWebrtcOkAt && Date.now() - kaWebrtcOkAt > 300000) kaWebrtcRebuildDelay = 0;
    kaWebrtcRebuildDelay = kaWebrtcRebuildDelay ? Math.min(kaWebrtcRebuildDelay * 2, 900000) : 30000;
    if (keepEnabled && !kaWebrtcTimer) kaWebrtcTimer = setTimeout(function () {
      kaWebrtcTimer = null;
      // FIX 2026-09-14 #436 后台发热减负：重建对齐启动路径「已后台则不建」原则——后台构造
      // RTCPeerConnection 是秒级长任务（#433 实锤），回环锚点常驻 ICE consent 包也让射频
      // 无法深睡；音频主锚点在位时豁免不丢，页面真被冻结时定时器本就停摆跑不到这里＝
      // 后台重建纯付费。排程已清，回前台 healKeepAlive 兜底补建。
      if (!keepEnabled || document.hidden) return;
      kaWebrtcStart();
    }, kaWebrtcRebuildDelay);
  }
  function kaWebrtcStart() {
    if (kaPc1 || kaPc2) return;
    if (kaWebrtcTimer) { clearTimeout(kaWebrtcTimer); kaWebrtcTimer = null; }
    if (kaWebrtcBootTimer) { clearTimeout(kaWebrtcBootTimer); kaWebrtcBootTimer = null; }
    if (kaWebrtcDiscTimer) { clearTimeout(kaWebrtcDiscTimer); kaWebrtcDiscTimer = null; }
    if (typeof RTCPeerConnection === 'undefined') return;
    try {
      const p1 = new RTCPeerConnection(), p2 = new RTCPeerConnection();
      p1.onicecandidate = function (e) { if (e.candidate) kaCand1.push(e.candidate); };
      p2.onicecandidate = function (e) { if (e.candidate) kaCand2.push(e.candidate); };
      p1.createDataChannel('mochi-ka');
      const wire = function (a, b) {
        return a.createOffer()
          .then(function (o) { return a.setLocalDescription(o); })
          .then(function () { return b.setRemoteDescription(a.localDescription); })
          .then(function () { return b.createAnswer(); })
          .then(function (ans) { return b.setLocalDescription(ans); })
          .then(function () { return a.setRemoteDescription(b.localDescription); });
      };
      wire(p1, p2).then(function () {
        // SDP 交换完成后统一 flush 缓存的 ICE 候选
        try { for (let i = 0; i < kaCand2.length; i++) p1.addIceCandidate(kaCand2[i]); } catch (e) {}
        try { for (let i = 0; i < kaCand1.length; i++) p2.addIceCandidate(kaCand1[i]); } catch (e) {}
      }).catch(function () { kaWebrtcStop(); kaWebrtcScheduleRebuild(); });
      p1.onconnectionstatechange = function () {
        const st = p1.connectionState;
        if (st === 'connected') {
          kaWebrtcOkAt = Date.now();
          if (kaWebrtcDiscTimer) { clearTimeout(kaWebrtcDiscTimer); kaWebrtcDiscTimer = null; }
          return;
        }
        if (st === 'disconnected') {
          // FIX 2026-09-13 #433：瞬态断连先观察 8s（ICE 例行自愈，规范可恢复），
          // 恢复则零成本；仍断才拆+退避重建。原逻辑立即拆+30s 固定重建＝抖动机型反复卡
          if (kaWebrtcDiscTimer) return;
          kaWebrtcDiscTimer = setTimeout(function () {
            kaWebrtcDiscTimer = null;
            if (!kaPc1) return;
            const s2 = kaPc1.connectionState;
            if (s2 === 'connected') { kaWebrtcOkAt = Date.now(); return; }
            kaWebrtcStop();
            kaWebrtcScheduleRebuild();
          }, 8000);
          return;
        }
        if (st === 'failed' || st === 'closed') {
          kaWebrtcStop();
          kaWebrtcScheduleRebuild();
        }
      };
      kaPc1 = p1; kaPc2 = p2;
    } catch (e) {}
  }
  function kaWebrtcStop() {
    if (kaWebrtcTimer) { clearTimeout(kaWebrtcTimer); kaWebrtcTimer = null; }
    if (kaWebrtcBootTimer) { clearTimeout(kaWebrtcBootTimer); kaWebrtcBootTimer = null; }
    if (kaWebrtcDiscTimer) { clearTimeout(kaWebrtcDiscTimer); kaWebrtcDiscTimer = null; }
    try { if (kaPc1) kaPc1.close(); } catch (e) {}
    try { if (kaPc2) kaPc2.close(); } catch (e) {}
    kaPc1 = kaPc2 = null;
    kaCand1 = []; kaCand2 = [];
  }

  // ================= #260：后台心跳（冻结取证） =================
  // 「保活到底有没有生效」不再靠用户口述猜：页面隐藏期间每 30s 往 IDB 写一笔心跳
  // （次数 + 最近 8 拍时间戳），回前台补记 resumed。device.js 诊断的【保活现场】直接
  // 读 window.__kaProbe()：相邻拍间隔 >90s=心跳断流=页面真被冻结的实锤，修复有没有
  // 效下次诊断见分晓。心跳只在开保活的本会话切过后台时才有记录（回前台即停表）。
  const KA_HB_KEY = 'xy-home-v2:__ka-hb';
  let kaHbTimer = null;
  let kaHb = null;
  function kaHbTick() {
    if (!kaHb) return;
    kaHb.n++;
    kaHb.ts = Date.now();
    try { kaHb.trail.push(kaHb.ts); if (kaHb.trail.length > 8) kaHb.trail.shift(); } catch (e) {}
    try { if (window.idbSet) window.idbSet(KA_HB_KEY, kaHb); } catch (e) {}
  }
  function kaHbStart() {
    if (kaHbTimer) return;
    kaHb = { n: 0, hid: Date.now(), ts: Date.now(), resumed: 0, trail: [] };
    kaHbTick();
    kaHbTimer = setInterval(kaHbTick, 30000);
  }
  function kaHbStop() {
    if (kaHbTimer) { clearInterval(kaHbTimer); kaHbTimer = null; }
  }
  // 独立监听器（#153 的 hidden 监听器在音频播放中会提前 return，语义不同不共用）
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      if (!keepEnabled) return;
      kaHbStart();
    } else {
      if (kaHb) {
        kaHb.resumed = Date.now();
        try { if (window.idbSet) window.idbSet(KA_HB_KEY, kaHb); } catch (e) {}
      }
      kaHbStop();
    }
  });

  // #260：诊断出口——device.js「保活现场」行消费（诊断在用户操作时生成，与加载顺序无关）
  window.__kaProbe = function () {
    let audio = null, ms = null;
    try { audio = keepAudio && keepAudio.el ? { paused: !!keepAudio.el.paused, volume: keepAudio.el.volume, loop: !!keepAudio.el.loop } : null; } catch (e) {}
    try { ms = ('mediaSession' in navigator && navigator.mediaSession) ? { metadata: !!navigator.mediaSession.metadata, state: navigator.mediaSession.playbackState } : null; } catch (e) {}
    return {
      keep: keepEnabled,
      notify: notifyEnabled,
      perm: ('Notification' in window) ? Notification.permission : 'unsupported',
      audio: audio,
      ms: ms,
      pc: kaPc1 ? (kaPc1.connectionState || 'new') : 'off',
      pcNext: kaWebrtcTimer ? kaWebrtcRebuildDelay : 0,
      hb: kaHb ? { n: kaHb.n, hid: kaHb.hid, ts: kaHb.ts, resumed: kaHb.resumed, trail: (kaHb.trail || []).slice() } : null
    };
  };

  function startKeepAlive(showToast) {
    if (keepAudio) return;
    try {
      // v3.5.160：保活音频改用 <audio> 元素循环播放极轻正弦波——媒体通知条才会显示
      const src = ensureKeepAudioDataUrl();
      if (!src) { if (showToast) toast('后台保活启动失败（无法生成保活音频）'); return; }
      const keepEl = document.createElement('audio');
      keepEl.loop = true;
      keepEl.volume = 0.05;          // 低但非静音（近零音量会被 Chrome 无声节流）
      keepEl.src = src;
      keepEl.setAttribute('playsinline', '');
      // v3.13.x：play/pause 事件跟踪——play 成功刷新"最近播过"，外部打断（pause）
      // 进入退避排程；主动让位（音乐在播）不算打断
      keepEl.addEventListener('play', function () { kaMarkPlayed(); });
      keepEl.addEventListener('pause', function () {
        if (!keepEnabled || !keepAudio || !keepAudio.el || musicNowPlaying()) return;
        if (kaTimer) return; // 已在退避轨道
        kaSchedule(); // 连击计数由 kaSchedule 内部递增
      });
      const playIt = function () {
        if (musicNowPlaying()) return; // v3.10.x：音乐在播，让位不抢音频（由 syncKeepForMusic 收回）
        const p = keepEl.play();
        if (p && p.catch) p.catch(function () {});
      };
      playIt();
      keepAudio = { el: keepEl };

      // v3.5.155：媒体会话标记——Chrome 安卓把「有活跃媒体会话 + 音频输出」的页面
      // 视为"正在播放媒体"，后台几乎不冻结（Youtube 网页版后台持续播放即此原理）。
      // 保活开启后在通知栏显示一个媒体条「mochi 后台保活」，既让用户看到保活在跑，
      // 又大幅提升后台定时器存活率 → 后台消息/通知到达率。比纯静音音频 + wakeLock
      // 强很多；停用保活时清除（stopKeepAlive）
      // v3.9.x：音乐播放时让位——music-player 已设置歌曲 metadata + 控制 handler，
      // 这里不覆盖（否则通知栏变成"后台保活"且按钮空响应，无法控制音乐）
      setKeepMediaSession();
      // #260：WebRTC 第二冻结豁免锚点——FIX 2026-09-13 #433 改启动 10s 后延迟建锚
      //（new RTCPeerConnection 构造是重主线程操作，同步建＝开屏路径叠加秒级长任务，
      //低端机「一进网站就非常卡」实锤元凶；音频主锚点不受影响）
      kaWebrtcDeferredStart(10000);

      // 用户首次交互时恢复播放（浏览器自动播放策略要求）
      const resumeOnInteraction = function () {
        if (musicNowPlaying()) return; // v3.10.x：音乐在播，让位
        if (keepAudio && keepAudio.el && keepAudio.el.paused) {
          const p = keepAudio.el.play();
          if (p && p.catch) p.catch(function () {});
        }
      };
      document.addEventListener('click', resumeOnInteraction, { once: true });
      document.addEventListener('touchstart', resumeOnInteraction, { once: true });
      document.addEventListener('keydown', resumeOnInteraction, { once: true });
      // v3.13.x：轻心跳（原每 5 秒无条件补播）——不再主动抢播，只做三件事：
      //   ① 音乐在播→保持让位；② 音频在跑→维持 mediaSession='playing'，稳定够久复位退避；
      //   ③ 音频被外部打断暂停→排一次退避补播（间隔由 kaSchedule 按连击指数化）。
      // 补播节奏明显放缓后，与其他 App 抢音频焦点的拉锯大幅减轻。
      keepInterval = setInterval(function () {
        if (keepAudio && keepAudio.el) {
          try {
            if (musicNowPlaying()) {
              // v3.10.x：音乐在播——保活音频保持让位暂停，不重试补播；媒体条由
              // music-player 管理，不再强设 playbackState（音乐暂停时会被误标）
              if (!keepAudio.el.paused) keepAudio.el.pause();
              return;
            }
            if (!keepAudio.el.paused) {
              // 音频在跑就持续声明"正在播放"，维持媒体会话活跃
              try { if (navigator.mediaSession) navigator.mediaSession.playbackState = 'playing'; } catch (e) {}
              // 稳定播放够久 → 复位退避连击（下次打断从头 5s 起退避）
              if (kaPauseStreak && Date.now() - kaLastPlayAt > kaStableMs()) kaPauseStreak = 0;
              return;
            }
            // 音频暂停且不在退避轨道（启动被拒/媒体条丢失等漏网场景）→ 排退避补播
            if (!kaTimer) kaSchedule();
          } catch (e) {}
        }
      }, 5000);

      // 屏幕常亮（wakeLock），释放后自动重试
      // v3.5.131：wakeSentinel 提升为模块级——stopKeepAlive 需要释放它（原闭包变量
      // 关闭保活后屏幕仍常亮，用户以为关了实际没关）
      const requestWakeLock = function () {
        if (navigator.wakeLock && document.visibilityState === 'visible') {
          navigator.wakeLock.request('screen').then(function (sentinel) {
            wakeSentinel = sentinel;
            if (wakeSentinel) {
              wakeSentinel.addEventListener('release', function () {
                setTimeout(function () { if (keepEnabled) requestWakeLock(); }, 1000);
              });
            }
          }).catch(function () {});
        }
      };
      requestWakeLock();
      // v3.5.132：visibilitychange 监听移到模块顶层注册一次（在 startKeepAlive 内
      // 每次开关都会累积一个监听器 + 一个旧 wakeLock 永不释放）

      if (showToast) {
        // v3.5.133：保活开启时通知发送结果做成可感知诊断——
        // 系统通知能不能显示由浏览器+系统决定，API 不报错但可能被系统拦截；
        // 分情况提示用户卡在哪一环，避免"开了保活但通知栏永远没消息"的静默失效
        if (!('Notification' in window)) {
          toast('后台保活已启动（注意：本环境不支持系统通知，需 HTTPS 访问）');
        } else if (Notification.permission !== 'granted') {
          toast('后台保活已启动（通知未授权：去设置→后台通知→开启并允许权限）');
        } else {
          showSysNotification('后台保活已启动', { body: '正在播放静音音频以保持后台活跃，请勿关闭此页面' }).then(function (ok) {
            toast(ok
              ? '后台保活已启动 · 通知栏应弹出提示条，若没有请到系统设置→通知→Chrome→允许通知'
              : '后台保活已启动（通知发送未受理，请检查系统通知权限）');
          });
        }
      }
    } catch (e) {}
  }
  function stopKeepAlive(showToast) {
    // v3.5.160：停掉 <audio> 保活音频（原来 stop osc/close ctx）
    try { if (keepAudio && keepAudio.el) { keepAudio.el.pause(); keepAudio.el.src = ''; } } catch (e) {}
    // v3.5.155：清除媒体会话标记（通知栏媒体条消失）
    // v3.9.x：音乐播放时不清除——music-player 正在用 MediaSession 控制音乐
    if (!window.__musicPlaying) {
      try {
        if ('mediaSession' in navigator && navigator.mediaSession) {
          navigator.mediaSession.metadata = null;
          try { navigator.mediaSession.setActionHandler('play', null); } catch (e) {}
          try { navigator.mediaSession.setActionHandler('pause', null); } catch (e) {}
        }
      } catch (e) {}
    }
    // v3.5.131：释放屏幕常亮（原实现从不 release——关闭保活后屏幕持续不熄）
    try { if (wakeSentinel) { wakeSentinel.release(); } } catch (e) {}
    wakeSentinel = null;
    // v3.13.x：清掉排中的退避补播与连击计数
    kaStopTimer();
    kaPauseStreak = 0;
    kaPlayFailStreak = 0;
    // #260：WebRTC 锚点一并拆除
    kaWebrtcStop();
    clearInterval(keepInterval);
    keepAudio = null;
    keepInterval = null;
    if (showToast) toast('后台保活已关闭');
  }
  // v3.5.132：模块顶层注册一次（防反复开关保活累积监听器）
  // v3.9.x：回前台完整自愈——原逻辑回前台只补 wakeLock；Chrome/系统在后台/锁屏
  // 几小时后会挂起保活音频、丢弃媒体条，不恢复的话通知栏「Mochi 后台保活」条消失、
  // 静音音频停播 → 页面再次被后台冻结，TA 消息/弹窗停摆。现在回前台把音频/媒体条/
  // wakeLock 一并恢复，保证下一次后台会话依旧保活。
  function healKeepAlive() {
    if (!keepEnabled) return;
    // v3.13.x：回前台立即清零退避轨道——用户切回来了，补播不再退避，马上恢复
    kaResetBackoff();
    // #260：后台冻结/挂起后 WebRTC 通道可能已断——回前台补建（幂等）
    // FIX 2026-09-13 #433：改 3s 延迟 + 排程不抢占——resume 瞬间主线程正忙（重渲/回填），
    // 立即构造 RTCPeerConnection 会叠加秒级长任务；且部分内核加载期会冒一次
    // visibilitychange→visible（无头实测 3s 即建＝绕过启动 10s 延迟），重建退避排期也会
    // 被这里提前插队。故仅在「无现役锚且启动/重建排程都没挂期」时才补建：
    // 加载期由启动延迟负责、断连由退避排期负责，这里只兜「排程全空但锚不在」的真缺口。
    if (!kaPc1 && !kaWebrtcTimer && !kaWebrtcBootTimer) kaWebrtcDeferredStart(3000);
    // 1) 恢复被挂起的保活音频（回前台瞬间可能仍被浏览器阻塞，延迟再试几次）
    //    v3.10.x：音乐在播时跳过——保活音频让位中，不抢音频
    if (!musicNowPlaying() && keepAudio && keepAudio.el && keepAudio.el.paused) {
      const p = keepAudio.el.play();
      if (p && p.catch) p.catch(function () {});
    }
    [0, 600, 1800].forEach(function (d) {
      setTimeout(function () {
        if (!keepEnabled || musicNowPlaying()) return; // v3.10.x：音乐在播，让位
        if (keepAudio && keepAudio.el && keepAudio.el.paused) {
          const p = keepAudio.el.play();
          if (p && p.catch) p.catch(function () {});
        }
      }, d);
    });
    // 2) 媒体条可能已被丢弃——重设「Mochi 后台保活」媒体会话（音乐在播时自动让位）
    setKeepMediaSession();
    // 3) 重新请求屏幕常亮
    try {
      if (navigator.wakeLock && document.visibilityState === 'visible') {
        navigator.wakeLock.request('screen').then(function (sentinel) {
          wakeSentinel = sentinel;
          if (wakeSentinel) {
            wakeSentinel.addEventListener('release', function () {
              setTimeout(function () { if (keepEnabled) requestWakeLockTop(); }, 1000);
            });
          }
        }).catch(function () {});
      }
    } catch (e) {}
  }
  // v3.14.x：回前台统一信号——healKeepAlive + dispatch mochi-fg-resume 事件，
  // ta-ask 等模块监听后补触发主动消息 + 补弹后台新卡片（安卓后台 setInterval 被节流，
  // 回前台不等下一个 tick 立即检查；小米MIX4 Edge 收不到后台消息修复）
  let _fgResumeAt = 0;
  function _onFgVisible() {
    // v3.18.x：一次切后台再切回会连续触发 visibilitychange(visible)+focus+pageshow，
    // 每次都派发 mochi-fg-resume 会让 ta-ask 补触发/补弹连跑多遍 → 弹出一大堆已看过的旧卡片重叠。
    // 用 1s 窗口合并为一次，只在真正再次回前台时重新派发。
    const now = Date.now();
    if (now - _fgResumeAt < 1000) return;
    _fgResumeAt = now;
    healKeepAlive();
    try { document.dispatchEvent(new Event('mochi-fg-resume')); } catch (e) {}
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') _onFgVisible();
  });
  // v3.9.x：窗口重新聚焦 / bfcache 恢复（pageshow persisted）同样自愈——
  // 有些浏览器从后台切回只触发 focus 不触发 visibilitychange；bfcache 恢复时
  // 定时器已暂停，恢复后保活音频也一并拉回
  document.addEventListener('focus', function () {
    if (document.visibilityState === 'visible') _onFgVisible();
  });
  window.addEventListener('pageshow', function (e) {
    if (e.persisted || document.visibilityState === 'visible') _onFgVisible();
  });
  // FIX 2026-09-04 #153 切后台方向保活自愈——原只有回前台的 healKeepAlive，切后台没有：
  // 若切后台瞬间音频正处暂停（前台被其他 App 抢过音频焦点、退避已在最长 60s 轨道），
  // 这段静默窗口会直接跨过 Chromium 139 的 1 分钟冻结线 → 页面整个被冻结（定时器全停，
  // 后台消息/系统通知全停，回前台解冻后积压定时器一口气补跑——用户报障形态）。
  // 这里切后台时：清退避轨道 + 立即补播一次 + 按最快档（5s）排下一次，把隐藏期静默窗口
  // 压到 20s 封顶（见 kaSchedule 内隐藏期钳制）；音乐在播时跳过（媒体会话由音乐维持）。
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'hidden') return;
    if (!keepEnabled || !keepAudio || !keepAudio.el || musicNowPlaying()) return;
    if (!keepAudio.el.paused) return;
    kaResetBackoff();
    const p = keepAudio.el.play();
    if (p && p.catch) p.catch(function () {});
    kaSchedule();
  });
  function requestWakeLockTop() {
    try {
      if (navigator.wakeLock && document.visibilityState === 'visible' && keepEnabled) {
        navigator.wakeLock.request('screen').then(function (sentinel) {
          wakeSentinel = sentinel;
        }).catch(function () {});
      }
    } catch (e) {}
  }
  // v3.9.x：音乐停止后（music-media-release）恢复"后台保活"媒体条——
  // music-player 播放时覆盖了保活 metadata，停止后这里重新设回，保活后台存活率不降
  // v3.10.x：音乐完全停止后同时收回让位中的保活音频（正常路径由 __musicPlaying=false
  // 的 watcher 收回，这里对 teardown 直接跳过 onpause 等边缘路径双保险）
  document.addEventListener('music-media-release', function () {
    if (keepEnabled) { setKeepMediaSession(); syncKeepForMusic(); }
  });
  const kaBtn = document.getElementById('bg-keepalive');
  function syncKeepUI() { if (kaBtn) kaBtn.checked = keepEnabled; }
  if (kaBtn) {
    kaBtn.addEventListener('change', function () {
      keepUserTouched = true; // #88：手动动过 → 回填后不再重读覆盖
      keepEnabled = kaBtn.checked;
      gSet('bg-keepalive', keepEnabled ? '1' : '0');
      if (keepEnabled) startKeepAlive(true);
      else stopKeepAlive(true);
    });
  }
  (function () {
    // v3.9.x：全局化迁移——旧版按桌面存（activeStore），读时回退旧值并写全局，
    // 之后开关不再随桌面/active-contact 变化而"自己关掉"
    let saved = gGet('bg-keepalive');
    if (saved === null) {
      const old = store.get('bg-keepalive');
      if (old !== null) { gSet('bg-keepalive', old); saved = old; }
    }
    keepEnabled = saved === null ? false : saved === '1';
    syncKeepUI();
    if (keepEnabled) startKeepAlive(false);
  })();

  // ================= 后台通知 =================
  let notifyEnabled = false;
  let notifyUserTouched = false; // v3.26.x #88：本会话用户手动动过通知开关 → 回填后不重读覆盖
  // v3.5.151：系统通知左侧图标用「带 mochi 字母的完整图标」（icon-512.png，
  // 与手机桌面快捷方式图标一致）。之前用 icon-192.png（纯心形小图标），
  // 用户看到的左侧是"爱心"而非带字母的 mochi 图标
  const NOTIFY_ICON = (function () {
    try { return new URL('./icon-512.png', location.href).href; } catch (e) { return ''; }
  })();
  // v3.13.x：badge（通知左侧小图标）专用单色透明图——icon-512.png 是全不透明白底黑字
  // 大图，直接放 badge 位不符合 Android small icon 规范（要求 alpha 蒙版单色图），
  // 部分系统/浏览器（OPPO ColorOS + Edge 等）会渲染成白块或不显示。这里用 canvas
  // 把白底变透明、内容变白色剪影，生成 96px 透明底单色 PNG dataURL，供 badge 使用。
  let BADGE_DATAURL = '';
  let badgeReady = false;
  let badgeQueue = null;
  function getBadgeUrl(cb) {
    cb = cb || function () {};
    if (badgeReady) { cb(BADGE_DATAURL); return; }
    if (badgeQueue) { badgeQueue.push(cb); return; }
    badgeQueue = [cb];
    if (!NOTIFY_ICON) { badgeReady = true; BADGE_DATAURL = ''; const q = badgeQueue; badgeQueue = null; for (let i = 0; i < q.length; i++) q[i](''); return; }
    const img = new Image();
    img.onload = function () {
      try {
        const s = 96;
        const c = document.createElement('canvas');
        c.width = s; c.height = s;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, s, s);
        const d = ctx.getImageData(0, 0, s, s);
        const px = d.data;
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i], g = px[i + 1], b = px[i + 2];
          if (r > 248 && g > 248 && b > 248) px[i + 3] = 0;   // 白底 → 透明
          else { px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = 255; } // 内容 → 白色不透明
        }
        ctx.putImageData(d, 0, 0);
        BADGE_DATAURL = c.toDataURL('image/png');
      } catch (e) { BADGE_DATAURL = ''; }
      badgeReady = true;
      const q = badgeQueue; badgeQueue = null;
      for (let i = 0; i < q.length; i++) { try { q[i](BADGE_DATAURL); } catch (e2) {} }
    };
    img.onerror = function () { badgeReady = true; BADGE_DATAURL = ''; const q = badgeQueue; badgeQueue = null; for (let i = 0; i < q.length; i++) { try { q[i](''); } catch (e) {} } };
    img.src = NOTIFY_ICON;
  }
  // v3.5.135：统一走 Service Worker 显示通知——Chrome Android 规范：页面在后台（隐藏）
  //   时，页面脚本直接 new Notification() 会被静默抑制（通知不弹也不报错），
  //   标准做法是 navigator.serviceWorker.ready → reg.showNotification()（SW 独立于页面，
  //   隐藏时允许显示）。此辅助函数统一封装：优先 SW，失败回退页面 Notification。
  //   返回 Promise<boolean>：true=已提交显示（能否真正显示仍由系统通知权限决定）
  // v3.14.x：media 全部 Blob 直传——此前头像/图片先转成 blob: URL 再交给 SW，但 blob URL
  //   由页面进程持有：页面切后台被冻结/回收后，系统通知进程按 URL 取不到图 → 图标空置，
  //   系统回退浏览器默认图标（用户反馈：后台弹窗左边一直不是 mochi 字母图标）。
  //   改为把 dataURL 就地转成 Blob 对象放进 NotificationOptions（规范允许
  //   icon/badge/image 为 (DOMString or Blob)），位图随通知序列化、不依赖页面存活；
  //   顺带删掉 createObjectURL + 延迟 revoke 的泄漏面。
  function dataUrlToBlob(dataUrl, cb) {
    try {
      fetch(dataUrl).then(function (r) { return r.blob(); }).then(function (b) {
        cb(b && b.size ? b : null);
      }, function () { cb(null); });
    } catch (e) { cb(null); }
  }
  // 把 target 里 data: 形式的 icon/badge/image 原地换成 blob: URL 字符串；
  // http(s)/blob URL 原样保留，单个转换失败仅删该字段（宁缺图，不缺整条通知）
  // v3.18.x：修复「右侧无头像 + 有时通知发不出」——此前把 Blob 对象直接赋给
  // icon/badge/image 传给 showNotification，而 NotificationOptions 这些字段规范要求
  // URL 字符串（USVString），Chrome 收到 Blob 对象会失败/忽略 → 触发降级链剥掉图标
  // （右侧无头像），降级重发仍带 Blob 对象字段反复失败（有时整条通知发不出）。
  // 改用 URL.createObjectURL(blob) 生成 blob: URL 字符串，是合法 URL，Chrome 可靠渲染
  function prepMediaBlobs(target, done) {
    const keys = ['icon', 'badge', 'image'];
    let pending = 0;
    const finish = function () { if (!pending && done) { const d = done; done = null; d(); } };
    keys.forEach(function (k) {
      const v = target[k];
      if (typeof v === 'string' && v.indexOf('data:') === 0) {
        pending++;
        dataUrlToBlob(v, function (b) {
          if (b) {
            try { target[k] = URL.createObjectURL(b); } catch (e) { delete target[k]; }
          } else {
            delete target[k];
          }
          if (--pending === 0) finish();
        });
      }
    });
    finish();
  }
  function showSysNotification(title, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      try {
        if (!('Notification' in window) || Notification.permission !== 'granted') { resolve(false); return; }
        if ('serviceWorker' in navigator && navigator.serviceWorker) {
          // v3.5.137：urgency:'high' 让通知以「高紧迫度」发送——Chrome 安卓上
          // 高紧迫度通知更可能以悬浮（head-up）形式显示在屏幕上方，而不是只进
          // 下拉通知栏；配合系统「横幅通知」权限即为微信式顶部弹窗
          const swOpts = Object.assign({}, opts);
          if (!swOpts.urgency) swOpts.urgency = 'high';
          // v3.5.156：mochi 图标设到 badge（左侧小图标）——安卓通知里 badge 才是
          // 左侧小图标位；icon 是右侧大图标位（由调用方传联系人头像/消息图）。
          // 此前把 mochi 设进 icon → 显示在右侧，左侧 badge 未设 → 浏览器默认图标
          // v3.13.x：badge 优先用 canvas 生成的单色透明图（Android small icon 规范）；
          // 未生成完成时回退原始 icon-512 URL（已启动即预热，首条通知前通常已就绪）。
          // v3.14.x：badge 同样走 Blob 直传（prepMediaBlobs 统一转换）
          if (!swOpts.badge) swOpts.badge = BADGE_DATAURL || NOTIFY_ICON || undefined;
          navigator.serviceWorker.ready.then(function (reg) {
            // v3.14.x：逐级降级重发——带 image 失败 → 去 image；仍失败 → 去 badge；
            // 最后连 icon 也去掉只发纯文字。保证文字通知不因任一媒体字段异常整条丢失
            const STRIP_LADDER = [[], ['image'], ['image', 'badge'], ['image', 'badge', 'icon']];
            let ladderIdx = 0;
            const tryNext = function () {
              if (ladderIdx >= STRIP_LADDER.length) { resolve(false); return; }
              const attempt = Object.assign({}, swOpts);
              STRIP_LADDER[ladderIdx++].forEach(function (k) { delete attempt[k]; });
              prepMediaBlobs(attempt, function () {
                reg.showNotification(title, attempt).then(function () { resolve(true); }, tryNext);
              });
            };
            tryNext();
          }).catch(function () {
            // SW 不可用回退页面路径：去掉 image/icon/badge（页面 Notification 对
            // dataURL 图片/图标不稳定，带上会导致整条通知失败，v3.5.118 教训）
            const noMedia = Object.assign({}, opts);
            delete noMedia.image;
            delete noMedia.icon;
            delete noMedia.badge;
            try { new Notification(title, noMedia); resolve(true); } catch (e) { resolve(false); }
          });
        } else {
          const noMedia = Object.assign({}, opts);
          delete noMedia.image;
          delete noMedia.icon;
          delete noMedia.badge;
          try { new Notification(title, noMedia); resolve(true); } catch (e) { resolve(false); }
        }
      } catch (e) { resolve(false); }
    });
  }
  // v3.5.114：请求权限（支持成功/失败回调）——失败时开关要弹回关闭，
  //   否则 iOS 不支持 / 权限被拒时开关显示"开"但实际无效，误导用户
  function requestNotifyPermission(cb, failCb) {
    if (!('Notification' in window)) {
      // v3.7.x：按平台区分文案——安卓阉割 WebView（OPPO 自带/Via 等）也无 Notification API，
      //   原文案硬编码"iPhone"对安卓用户很困惑。iOS 仍引导装主屏（iOS PWA 也不支持本地通知）
      // v3.16.x：设备判定统一读 device.js（mochiDevice）
      const _isIOS = !!(window.mochiDevice || {}).isIOS;
      toast(_isIOS
        ? 'iPhone 网页版不支持系统通知\n请安装到主屏幕后由系统接管'
        : '当前浏览器不支持系统通知\n请改用 Chrome/Edge，或添加到主屏幕后由系统接管');
      if (failCb) failCb();
      return;
    }
    if (Notification.permission === 'granted') { if (cb) cb(); return; }
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(function (p) {
        if (p === 'granted') { if (cb) cb(); }
        else {
          toast('未获得通知权限，后台消息无法弹窗');
          if (failCb) failCb();
        }
      }).catch(function () { if (failCb) failCb(); });
    } else {
      toast('通知权限被拒绝，请在浏览器设置中允许通知');
      if (failCb) failCb();
    }
  }
  const nbBtn = document.getElementById('bg-notify');
  function syncNotifyUI() { if (nbBtn) nbBtn.checked = notifyEnabled; }
  if (nbBtn) {
    nbBtn.addEventListener('change', function () {
      notifyUserTouched = true; // #88：手动动过 → 回填后不再重读覆盖
      if (nbBtn.checked) {
        requestNotifyPermission(function () {
          notifyEnabled = true;
          gSet('bg-notify', '1');
          syncNotifyUI();
          showSysNotification('通知已开启', { body: '后台消息提醒将正常弹窗' });
          // v3.5.132：开启通知时自动联动开启后台保活——后台消息要"到达"必须
          //   页面定时器在后台仍运行（静音音频保活）；否则开关开了但页面休眠，
          //   消息根本不产生，通知永远不会弹（旧版只 toast 提醒，用户容易漏开）
          setTimeout(function () {
            const keep = document.getElementById('bg-keepalive');
            const keepOn = keepEnabled;
            if (!keepOn) {
              if (keep) keep.checked = true;
              keepEnabled = true;
              gSet('bg-keepalive', '1');
              startKeepAlive(false);
              syncKeepUI();
              toast('已自动开启后台保活（后台消息必需）');
            }
            if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
              toast('提醒：需 HTTPS 访问，浏览器才允许通知');
            }
          }, 400);
        }, function () {
          // 失败：弹回开关
          notifyEnabled = false;
          gSet('bg-notify', '0');
          syncNotifyUI();
        });
      } else {
        notifyEnabled = false;
        gSet('bg-notify', '0');
        syncNotifyUI();
      }
    });
  }
  (function () {
    // v3.9.x：全局化迁移（同 bg-keepalive）
    let saved = gGet('bg-notify');
    if (saved === null) {
      const old = store.get('bg-notify');
      if (old !== null) { gSet('bg-notify', old); saved = old; }
    }
    // v3.5.131：恢复时校验权限——浏览器/系统回收权限后开关仍显示"开"但通知静默失效
    notifyEnabled = saved === '1' && 'Notification' in window && Notification.permission === 'granted';
    // v3.13.x：预热 badge 单色图——页面启动即后台生成，首条通知前通常已就绪
    if ('Notification' in window && Notification.permission === 'granted') { getBadgeUrl(function () {}); }
    if (saved === '1' && !notifyEnabled) {
      try { gSet('bg-notify', '0'); } catch (e) {}
      toast('通知权限已被回收，已自动关闭通知');
    }
    syncNotifyUI();
  })();

  // ===== v3.26.x 修复 #88：IDB 回填完成后重读一次两个开关 =====
  // 症状：小米 14U Edge 反馈「后台通知有时候会自己关闭」。上面两个初始化 IIFE 在模块
  // 加载时同步读值，而本机 localStorage 已彻底不可用（诊断：xy-home-v2 键数 0 + 写探针
  // QuotaExceededError）——值只能等 idbRestore 异步回填进内存缓存，回填必然晚于这次同步
  // 读 → saved===null → 判成「关」（bg-keepalive / bg-notify 在 IndexedDB 里一直是新值，
  // xyStore.set 双写过）。「有时候」= 那次回填恰好赶在读值之前（或 LS 还有残值）。
  // 方案：回填完成 / #40 写日志合并后再读一次，按差量重新应用。差量式实现可重复调用，
  // 所以三个触发点（含回填挂起设备的定时兜底）都直接调它，不做「只跑一次」的状态机。
  // 边界：用户本会话手动动过某个开关 → 该开关不再重读覆盖（他的操作就是最新值）。
  function reheatBgSwitches() {
    if (!keepUserTouched) {
      const wantKeep = gGet('bg-keepalive') === '1';
      if (wantKeep !== keepEnabled) {
        keepEnabled = wantKeep;
        syncKeepUI();
        if (wantKeep) startKeepAlive(false);
        else stopKeepAlive(false);
        try { console.info('[mochi] #88 回填后重读后台保活：' + (wantKeep ? '开' : '关')); } catch (e) {}
      }
    }
    if (!notifyUserTouched) {
      // 与初始化同款权限校验：系统/浏览器回收权限后不得把开关显示成「开」
      const savedNotify = gGet('bg-notify');
      const wantNotify = savedNotify === '1' &&
        'Notification' in window && Notification.permission === 'granted';
      if (wantNotify !== notifyEnabled) {
        notifyEnabled = wantNotify;
        syncNotifyUI();
        if (wantNotify) getBadgeUrl(function () {}); // 预热 badge 单色图（同初始化）
        try { console.info('[mochi] #88 回填后重读后台通知：' + (wantNotify ? '开' : '关')); } catch (e) {}
      }
      // 权限已被回收：静默把 IDB/LS 的「开」改回「关」保持存储与 UI 一致，
      // 但不再重复 toast（初始化那次已经提示过）
      if (savedNotify === '1' && !wantNotify) {
        try { gSet('bg-notify', '0'); } catch (e) {}
      }
    }
  }
  try {
    if (window.__mochiDataReady) setTimeout(reheatBgSwitches, 0);
    else document.addEventListener('mochi-restore-done', function () { reheatBgSwitches(); });
    document.addEventListener('mochi-wrj-heal', function () { reheatBgSwitches(); });
    setTimeout(reheatBgSwitches, 16000); // 回填整体挂起设备的兜底
  } catch (e) {}
  // v3.5.115：后台通知「测试」按钮——点一下发条测试通知 + 环境诊断，
  //   安卓 Chrome 上通知不生效时一键定位卡在哪一环（HTTPS/权限/后台保活）
  // v3.5.116：增强诊断——权限未授权时主动请求；发送后追加系统级通知检查提示
  //   （红米/小米 HyperOS：站点权限通过后，系统设置里 Chrome 的通知仍可能被关，
  //   此时 API 不报错但通知不显示，需提示用户去系统设置检查）
  const testBtn = document.getElementById('bg-notify-test');
  if (testBtn) {
    testBtn.addEventListener('click', function () {
      const env = [];
      if (!('Notification' in window)) {
        env.push('✗ 当前浏览器不支持 Notification API');
        env.push('原因：安卓 Chrome 必须 HTTPS 访问才有通知');
        env.push('当前：' + location.protocol + '//' + location.host);
        env.push('解决：用 https:// 部署访问（GitHub Pages 即是 HTTPS）');
        toast('环境检查：\n' + env.join('\n'));
        return;
      }
      if (Notification.permission === 'default') {
        // 未授权：主动请求一次再继续
        Notification.requestPermission().then(function (p) {
          if (p === 'granted') runTest(env);
          else {
            env.push('✗ 通知权限：拒绝了授权请求');
            env.push('解决：地址栏左侧图标 → 网站设置 → 通知 → 允许');
            toast('环境检查：\n' + env.join('\n'));
          }
        }).catch(function () {
          toast('环境检查：\n✗ 请求通知权限失败');
        });
        return;
      }
      runTest(env);
    });
    function runTest(env) {
      // v3.5.118：诊断首行显示当前版本——先核对手机上是否最新部署，
      //   旧版（如后台保活前）诊断结果会误导
      try {
        const verEl = document.querySelector('.ver');
        if (verEl) env.push('当前版本：' + (verEl.textContent || '').trim());
      } catch (e) {}
      if (Notification.permission === 'granted') env.push('✓ 通知权限：已允许');
      else env.push('✗ 通知权限：被拒绝（去浏览器站点设置开启）');
      const keep = document.getElementById('bg-keepalive');
      const keepOn = keepEnabled;
      env.push(keepOn ? '✓ 后台保活：已开启' : '✗ 后台保活：未开启（TA 消息后台到不了，通知不会弹）');
      // v3.13.x：拦截统计——本次会话后台期间有多少消息被去重闸门吞掉（定位"只有声不弹窗"）
      try {
        if (window.bgNotifyGateStats) {
          const st = window.bgNotifyGateStats();
          env.push('拦截统计（本次会话后台）：收到 ' + st.total + ' 条 · 过渡期拦 ' + st.tooFresh + ' · 重复拦 ' + st.dup + ' · 已发 ' + st.sent + '');
        }
      } catch (e) {}
      // v3.15.x：头像链路探针——定位「通知里没有联系人头像」卡在哪一环：
      // 头像值是否存在、长度、来源键、dataURL→Blob 转换是否成功
      try {
        const avCs = store.get('cs-avatar-partner') || '';
        const avOld = store.get('avatar-partner') || '';
        const avUsed = avCs || avOld;
        if (!avUsed) {
          env.push('✗ 联系人头像：无数据（cs-avatar-partner 与 avatar-partner 均为空）');
          env.push('  解决：去【手机桌面美化】点 TA 头像上传一张图片');
        } else {
          env.push('✓ 联系人头像：' + (avUsed.length > 200 * 1024 ? '存在(' + Math.round(avUsed.length / 1024) + 'KB)' : '存在(' + Math.round(avUsed.length / 1024) + 'KB)') + ' · 来源:' + (avCs ? '聊天头像(cs)' : '桌面头像'));
          env.push('  提示：若通知仍不显示头像 → 系统通知样式由 Chrome/ROM 决定，部分机型需展开通知才显示大图');
        }
      } catch (e) {}
      const isHttps = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      env.push(isHttps ? '✓ 访问协议：HTTPS 或本地' : '✗ 访问协议：' + location.protocol + '//（安卓 Chrome 需 HTTPS 才弹通知，GitHub Pages 部署后即是 HTTPS）');
      // v3.5.144：聊天消息后台弹窗诊断——后台收不到聊天消息 ≠ 通知问题，
      // 多数是「后台根本没产生聊天消息」：主动发送按间隔+概率随机触发，且需页面存活
      try {
        const rc = (window.replyCfg && window.replyCfg()) || {};
        const asEn = rc['as-en'] === undefined ? 1 : rc['as-en'];
        if (asEn === 1) {
          const p = Number(rc['as-prob']) > 0 ? rc['as-prob'] : 30;
          const mn = Math.min(30, Number(rc['as-min']) || 5);
          const mx = Math.min(180, Number(rc['as-max']) || 10);
          env.push('✓ 主动发送：开启（每 ' + mn + '~' + mx + ' 分钟掷一次 · 概率 ' + p + '%）');
          if (rc['dnd-en'] === 1) env.push('  免打扰开启中（发送大幅减弱，最长 3 小时一次）');
        } else {
          env.push('✗ 主动发送：关闭（TA 不会主动发聊天消息 → 后台无聊天通知）');
        }
        env.push('  提示：TA 聊天消息按间隔随机产生，后台需保活让定时器存活才到点触发');
      } catch (e) {}
      if (!('Notification' in window) || Notification.permission !== 'granted') {
        toast('环境检查：\n' + env.join('\n'));
        return;
      }
      // 环境 OK：真发一条测试通知（走 SW showNotification，页面隐藏也能显示）
      try {
        const name = store.get('lbl-partner') || (window.taWord ? window.taWord() : 'TA');
        showSysNotification('后台通知测试', { body: '来自 ' + name + ' · 如果能看到这条，后台通知就通了' }).then(function (ok) {
          if (ok) {
            env.push('✓ 测试通知已发送（Service Worker）');
            // 红米/小米：系统级通知可能拦截（API 不报错但通知不显示）
            // v3.26.x 收口第二批：UA 特判改读 device.js env.notifyQuirk（唯一嗅探处）
            const _mdN = (window.mochiDevice || {}).env || {};
            if (_mdN.notifyQuirk) {
              env.push('悬浮开关：系统设置→通知管理→Chrome→通知类别/横幅通知→打开「在屏幕上方显示」');
            }
          } else {
            env.push('✗ 通知发送未受理（权限或系统通知被禁）');
          }
          toast('测试结果：\n' + env.join('\n'));
        });
      } catch (e) {
        toast('发送失败：\n' + env.join('\n'));
      }
    }
  }

  // v3.5.132：从后台回到前台时做一次状态检查——通知开但保活被关 / 权限被回收
  //   都是静默失效（页面照常运行、通知就是不弹），回到前台时主动提示一次
  // v3.5.137：回到前台时补弹应用内横幅——后台期间收到的消息系统通知已进通知栏，
  //   但页面切回前台时应用内顶部横幅（desk-msg）不会自动出现；这里根据未读数
  //   在屏幕上方补一条横幅（点击默认进聊天），实现「切回即见新消息」的体验
  // v3.5.161：修复「回前台重弹看过消息」——之前用 chat-unread 总量判断，但它是
  //   你【看过消息前】的旧未读累计（进聊天页才清零），回前台会把前几分钟看过的
  //   消息当新消息重弹。改为：切后台时记录未读基数（resumeUnreadBase），回前台
  //   只提示【后台期间新增】的未读增量；无增量则完全不弹。
  // v3.19.x：回前台汇总改用「本次后台实际发送的通知数」——不再用 chat-unread 差值：
  //   chat-unread 是当前桌面未读数，跨桌面/psync 补投递会污染它，导致回前台
  //   弹「错误联系人名 + 错误条数」（用户实测：切换桌面后弹窗显示旧桌面昵称、没收到
  //   消息却说收到1条）。hiddenSentCount 只在 bgNotifyCheck 真正发送系统通知时累加，
  //   回前台时据此弹一条汇总，准确反映"后台真收到了几条、来自谁"。
  let hiddenSentCount = 0;
  let hiddenSentName = '';
  document.addEventListener('visibilitychange', function () {
    const vis = document.visibilityState;
    if (vis === 'hidden') {
      // 切后台：重置本次后台会话的发送计数（bgNotifyCheck 发送时累加）
      hiddenSentCount = 0;
      hiddenSentName = '';
      return;
    }
    if (vis !== 'visible') return;
    const saved = gGet('bg-notify');
    if (saved === '1') {
      const keepOn = keepEnabled;
      if (!keepOn) {
        toast('提醒：后台保活已关闭，后台消息到不了，通知不会弹（设置里开启）');
      }
    }
    // 补弹汇总：仅当本次后台【真的发送过系统通知】时，用实际发送数与发送者名
    try {
      const chatPage = document.getElementById('page-chat');
      const inChat = chatPage && !chatPage.hidden;
      const n = hiddenSentCount;
      const who = hiddenSentName || store.get('lbl-partner') || (window.taWord ? window.taWord() : 'TA');
      hiddenSentCount = 0;
      hiddenSentName = '';
      if (!inChat && n > 0 && window.showDeskPopup) {
        // visibilitychange 为 visible 时触发，isHidden=false 显示应用内横幅
        window.showDeskPopup({ name: who, text: '你不在的时候收到 ' + n + ' 条新消息', isHidden: false });
        const now = Date.now();
        if (saved === '1' && 'Notification' in window && Notification.permission === 'granted' &&
            (!lastResumeNotifyAt || now - lastResumeNotifyAt > 30000)) {
          lastResumeNotifyAt = now;
          // v3.21.x：汇总通知也带联系人头像（右位大图标）——此前只发文字，通知右侧无头像。
          // 取当前桌面聊天头像（与 bgNotifyCheck 同口径），等比缩略后作 icon，失败回退原文。
          const notiIcon = (store.get('cs-avatar-partner') || store.get('avatar-partner') || '');
          const sendNoti = function (iconVal) {
            const o = { body: '你不在的时候收到 ' + n + ' 条新消息' };
            if (iconVal) o.icon = iconVal;
            showSysNotification(who, o);
          };
          if (notiIcon && (notiIcon.indexOf('data:') === 0 || /^https?:\/\//i.test(notiIcon))) {
            makeAvatarThumb(notiIcon, function (u) { sendNoti(u || notiIcon); });
          } else {
            sendNoti('');
          }
        }
      }
    } catch (e) {}
  });
  let lastResumeNotifyAt = 0; // v3.5.154：回前台汇总通知去重

  // v3.12.x：修复「刚聊完切后台，通知栏弹出几分钟前已看过的消息」——
  // bgNotifyCheck 原来只判断「页面是否隐藏」，对内容毫无记忆：切后台后保活定时器
  // 继续跑，回复链剩余部分/下一轮主动发送/查岗卡等一旦产出与刚才对话相同或延续的
  // 内容，就原样再发一条系统通知（用户视角：明明看过的消息又弹一遍）。两道闸门：
  //   ① 隐藏时长门槛：切后台头 15 秒内的"消息"多为切换过渡期定时器到点
  //     （用户刚看完/马上回来看），不发系统通知；
  //   ② 内容去重：与【最近聊天记录里 TA 已说过的内容】或【最近已发过的通知】
  //     相同（指纹一致）→ 不再重复弹通知。消息本体照常进聊天记录和角标。
  // v3.13.x 修正误杀（用户反馈：只听见消息声音、后台却不弹窗）——原实现把图片/表情包
  // 统一归一成 [附件] 指纹，30 分钟内第二条图片消息或撞车的常见短语必被误拦：
  //   - 附件指纹加入图片本体采样（MIME + 长度 + 3 个错位段哈希）——不同图片互不误判，
  //     同一张图重复发仍可去重；
  //   - 历史聊天查重窗口 30→15 分钟、已发通知查重窗口 10→6 分钟，误杀面减半；
  //   - 文本指纹取前 60→100 字符，常见短语互撞更少。
  let lastVisibleAt = Date.now();
  let lastHiddenAt = 0; // v3.16.x：最近一次切后台时刻（修复过渡期闸门失效）
  (function () {
    const markVisible = function () {
      if (document.visibilityState === 'visible') {
        lastVisibleAt = Date.now();
        lastHiddenAt = 0;
      } else if (document.visibilityState === 'hidden') {
        lastHiddenAt = Date.now();
      }
    };
    document.addEventListener('visibilitychange', markVisible);
    window.addEventListener('pageshow', markVisible);
    window.addEventListener('focus', markVisible);
  })();
  const NOTIFY_HIDDEN_MIN_MS = 15000;
  // v3.20.x：去重窗口大幅缩短（15→5 分 / 6→2 分 / 新增前台看过 3 分）——
  // 「经常收不到」的根因：TA 字卡池有限（常用短语/表情包重复率高），长窗口内容去重
  // 会把【内容恰好与最近聊过/发过相同的新消息】误判为重放而吞掉。重放源头已分别
  // 堵住（psync 补投递 silent、切后台过渡期 15s 闸门、回前台按实际发送数汇总），
  // 去重只需覆盖「几分钟内的同条消息多机制重弹」短窗口即可
  const NOTIFY_CHAT_DUP_MS = 5 * 60000;  // v3.20.x：历史聊天查重 15→5 分钟
  const NOTIFY_SENT_DUP_MS = 2 * 60000;  // v3.20.x：已发通知查重 6→2 分钟
  const NOTIFY_SEEN_DUP_MS = 3 * 60000;  // v3.20.x：前台看过记忆 15→3 分钟
  // v3.23.x：lastNotifySentAt 已随 batchBurst 一并移除（重放放大器，见 bgNotifyCheck 内注释）
  // 通知文本归一化：剥 dataURL/语音 ||| 段/SVG 标签，去空白后取前 100 字符做指纹
  function normNotifyKey(raw) {
    let s = String(raw || '');
    if (s.length > 1024) s = s.slice(0, 1024); // 先截断再正则，避免超长 base64 全文替换开销
    s = s.replace(/data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[附件]')
      .replace(/@@m:[0-9a-f]{32}/g, '[附件]') // FIX 2026-09-13 #401 令牌串入指纹同口径
      .replace(/\|\|\|.*$/, '')
      .replace(/<[^>]*>/g, '');
    return s.replace(/\s+/g, '').slice(0, 100);
  }
  // dataURL 采样哈希（v3.13.x）：不读 base64 全文，取 MIME + 长度 + 3 个错位散列——
  // 不同图片指纹互异（不再因都显示成 [图片] 而互判重复），相同图片重复发采样一致仍可去重
  function sampleDataUrl(dataUrl) {
    try {
      if (!dataUrl || typeof dataUrl !== 'string') return '';
      const m = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,/.exec(dataUrl);
      const b64 = m ? dataUrl.slice(m[0].length) : dataUrl;
      const h = function (shift) {
        let x = 0;
        for (let i = shift; i < b64.length; i += 7) x = (x * 31 + b64.charCodeAt(i)) & 0x7fffffff;
        return x.toString(36);
      };
      return '|' + (m ? m[1] : '?') + ':' + b64.length + ':' + h(0) + ':' + h(1) + ':' + h(2);
    } catch (e) { return ''; }
  }
  // 组装消息去重指纹：文本指纹 + 附件采样。纯附件消息（正文是 [图片]/[表情包] 占位、
  // 空串、或本身是 dataURL）且带图时，文本基统一为 [附件] —— 与聊天记录里纯图消息
  // （text 即 dataURL，扫描时抽出为 img）的指纹口径一致，保证查重能对上
  function msgFingerprint(text, img) {
    let t = String(text || '');
    const isPh = /^\[(图片|表情包|语音|附件)\]$/.test(t.trim());
    const imgOnly = isPh || !t.trim() || t.indexOf('data:') === 0;
    let k = normNotifyKey(imgOnly && img ? '[附件]' : t);
    const a = sampleDataUrl(img);
    if (a) k += a;
    return k;
  }
  // 最近窗口内聊天记录里 TA 是否已说过同样内容（扫尾部最多 150 条，命中即回）
  // v3.14.x：refTs=本次通知对应的到达时刻——用于把「这条新消息自己刚入库的条目」
  // 排除出扫描（卡片类是提示语+卡面两条几乎同时入库，见循环内说明）
  function recentChatDup(key, refTs) {
    if (!key) return false;
    try {
      const arr = window.getChatMsgs ? window.getChatMsgs() : null;
      if (!arr || !arr.length) return false;
      const cutoff = Date.now() - NOTIFY_CHAT_DUP_MS;
      // v3.13.x 修复：聊天消息到达是「先入库（addRec msgs.push）再走 bgNotifyCheck」，
      // 查重扫历史会把【刚到达的这条】自己判成"最近说过"而吞掉通知（用户表现：联系人
      // 发消息有提示音但从不弹窗）。v3.14.x 演进：不再按下标跳过末尾条目——卡片类是
      // 「提示语+卡面」两条几乎同时入库，只跳末尾一条会让刚看过的卡面永远扫不到
      // （隐藏态再触发同文案时照样重弹，用户实测）；改为从末尾整条扫 + 按时间戳自排除：
      // 与本次通知时刻相近(refTs±)或刚入库(墙钟 2.5s 内)的条目都视为"这条新消息自己"。
      // 兜底处理迟到入库（refTs 远新于条目 ts 的延迟处理场景）不误吞。
      for (let i = arr.length - 1, n = 0; i >= 0 && n < 150; i--, n++) {
        const m = arr[i];
        if (!m) continue;
        const mts = m.ts || 0;
        if (mts && mts < cutoff) break; // 追加有序，更早的不可能落在窗口内
        // v3.14.x：自排除——本次通知对应的新入库条目（到达时刻±2.5s 或墙钟刚落库）
        if (refTs && (mts >= refTs - 2500 || (!mts && i === arr.length - 1) || Date.now() - mts < 2500)) continue;
        if (m.side !== 'in') continue;
        let t = m.text || '';
        let img = '';
        // v3.13.x：parts 化消息——图片/表情包/语音的 dataURL 一并采样，参与指纹比对
        if ((!t || t.indexOf('data:') === 0) && m.parts && m.parts.length) {
          const texts = [], images = [];
          for (let p = 0; p < m.parts.length; p++) {
            const part = m.parts[p];
            if (!part || !part.k) continue;
            if (part.k === 'text') texts.push(part.v);
            else if (part.k === 'image' || part.k === 'sticker' || part.k === 'voice') images.push(part.v);
          }
          t = texts.join(' ');
          img = images[0] || '';
        } else if (t.indexOf('data:') === 0) {
          img = t; // 无 parts 的旧式纯图消息：dataURL 即正文
          t = '';
        } else if (t.indexOf('|||') >= 0) {
          // v3.13.x：旧式语音消息 text 为「名称|||音频dataURL」——与探针/通知侧一致地
          // 剥离 ||| 段再比指纹，否则带语音文本查不到历史（语音段剥离后同指纹）
          t = t.split('|||')[0];
        }
        const mf = msgFingerprint(t, img);
        // v3.23.x：恢复精确相等无条件拦截（回退 v3.21.x 的 60 秒豁免）——
        // 60 秒豁免实测 reopen 了重放：用户在前台看过的字卡内容，切后台后
        // 自动发送/冻结定时器补跑撞车同内容（间隔 >60 秒）→ 照弹「几分钟前
        // 看过的消息」（红米 K80 等多设备复现）。字卡池有限，内容撞车无法与
        // 「TA 真的又说了一遍」区分，用户口径：近期（5 分钟窗口）同内容一律不弹，
        // 消息本体照常进聊天。防「收不到」用 v3.21.x 的 1.6 倍包含收紧即可（保留），
        // 精确相等不再放开
        if (mf === key) return true;
        // v3.14.x：双向包含兜底——互动卡的通知文本是「前缀+卡面」（如「TA想问你一个问题：」+
        // 卡面、「TA 来查岗了：」+卡面），聊天记录里存的却是裸卡面/裸提示语条目，精确相等
        // 永远对不上 → 已看过的卡片再被任何机制触发时照样重弹系统通知。
        // v3.21.x：包含比对收紧——原「较短边 ≥6 字即参与」在字卡池有限时会误吞全新短消息：
        // 新消息「在吗」是 5 分钟内旧消息「在吗？我想你了」的子串 → 被当成重放吞掉
        // （用户实测：经常收不到）。收紧为【较长边 ≥ 短边 ×1.6 且短边 ≥6 字】才参与——
        // 互动卡「前缀+卡面」场景仍命中（前缀明显更长），普通短语互为子串不再误杀
        if (mf.length >= 6 && key.length > mf.length && key.length >= mf.length * 1.6 && key.indexOf(mf) >= 0) return true;
        if (key.length >= 6 && mf.length > key.length && mf.length >= key.length * 1.6 && mf.indexOf(key) >= 0) return true;
      }
    } catch (e) {}
    return false;
  }
  // 最近已发过同内容的系统通知（跨"生成源不同但文本相同"兜底）
  const notifiedRecently = new Map();
  function notifiedDup(key) {
    if (!key) return false;
    const last = notifiedRecently.get(key);
    return !!(last && Date.now() - last < NOTIFY_SENT_DUP_MS);
  }
  function markNotified(key) {
    if (!key) return;
    notifiedRecently.set(key, Date.now());
    if (notifiedRecently.size > 60) { // 上限防膨胀：删最早的（Map 保持插入序）
      notifiedRecently.delete(notifiedRecently.keys().next().value);
    }
  }
  // v3.14.x：「前台已看过」指纹记忆——此前前台收到内容时 bgNotifyCheck 直接裸返回、
  // 什么都不记：同一条内容稍后再被任何机制触发（冻结定时器补跑/回复链延续/同类卡
  // 再抽中），只要错过已发窗口与历史扫描窗口，就会再以系统通知形式弹出用户刚在
  // 聊天里看过的内容。现在前台展示的同时记入 seenRecently（TTL 与历史扫描窗口一致，
  // 15 分钟），后台侧把它当作第三道去重闸门。
  const seenRecently = new Map();
  function markSeen(key) {
    if (!key) return;
    seenRecently.set(key, Date.now());
    if (seenRecently.size > 80) { // 上限防膨胀：删最早的（Map 保持插入序）
      seenRecently.delete(seenRecently.keys().next().value);
    }
  }
  function seenDup(key) {
    if (!key) return false;
    // v3.20.x：前台看过记忆用独立短窗口（3 分钟）——字卡池有限，长窗口会把
    // 「内容恰好相同的新消息」误吞（用户实测：经常收不到后台弹窗）
    const last = seenRecently.get(key);
    return !!(last && Date.now() - last < NOTIFY_SEEN_DUP_MS);
  }
  // v3.13.x：拦截统计——诊断"只听见声音不弹窗"时一屏看出每条消息卡在哪道闸门
  let gateStats = { total: 0, tooFresh: 0, dup: 0, sent: 0 };
  window.bgNotifyGateStats = function () { return Object.assign({}, gateStats); };
  // 只读探针：诊断/回归用——给定文本（+可选图片 dataURL、可选本次到达时刻 refTs）
  // 当前会被哪道闸门拦下
  window.bgNotifyGateInfo = function (text, img, refTs) {
    const nkey = msgFingerprint(text, img);
    return {
      hiddenForMs: Date.now() - lastVisibleAt,
      // v3.16.x：过渡期用「切后台时刻 lastHiddenAt」——切后台头 15 秒内的积压消息不弹
      tooFreshHidden: lastHiddenAt > 0 && Date.now() - lastHiddenAt < NOTIFY_HIDDEN_MIN_MS,
      dupNotified: notifiedDup(nkey),
      dupSeen: seenDup(nkey),
      dupInChat: recentChatDup(nkey, refTs),
      nkey: nkey
    };
  };

  // 供 chat.js（showDeskPopup 联动）/ 信箱 / 朋友圈调用：TA 相关新事件且页面不在
  // 前台时弹系统通知。第三参 extra：name 通知标题（信箱/朋友圈/机制名，默认 TA 昵称）、
  // img 图片 dataURL（通知 image 字段显示缩略图）；头像 + 昵称 + 时间（精确到秒）+ 内容
  window.bgNotifyCheck = function (text, ts, extra) {
    if (!notifyEnabled) return;
    extra = extra || {};
    // v3.12.x：两道闸门（详见上方注释）——过渡期不弹 + 已看过/已弹过的内容不重弹
    // v3.13.x：指纹由文本+附件采样构成——图片/表情包用本体采样去重，不同图片不再互拦
    // v3.14.x：前台收到改为「记 seen 指纹后返回」而非裸返回——用户已在应用内看到的
    // 内容，之后任何机制再次触发同文案都不再重复弹系统通知
    const nkey = msgFingerprint(text, extra.img);
    if (document.visibilityState === 'visible') { markSeen(nkey); return; }
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    gateStats.total++;
    // v3.31.x：extra.force —— 一次性事件（如来电通知）不适用过渡期/去重闸门：
    // 来电是「错过就没了」的单发事件，切后台头 15 秒内命中、或与近期通知文案
    // 相同（「XX 来电了」高频重复）都不该被拦。消息类通知仍走原三道闸门。
    const force = !!extra.force;
    // v3.16.x：过渡期闸门改用「切后台时刻」——lastVisibleAt 是最近一次回前台时间，
    // 前台久驻后（如看了 10 分钟）它很旧，切后台瞬间积压的定时器批量到点产生的
    // 一堆消息会全部通过闸门 → 弹出大量看过的内容。改为切后台头 15 秒内一律不弹
    if (!force && lastHiddenAt > 0 && Date.now() - lastHiddenAt < NOTIFY_HIDDEN_MIN_MS) { gateStats.tooFresh++; return; }
    // v3.23.x：回退 v3.22.x 的 batchBurst（30 秒内同文案放行）——实测是重放放大器：
    // 切后台后 15 秒过渡期一过，撞车内容在上一条通知 30 秒内可绕过全部去重再次弹出，
    // 正是「切后台马上弹几分钟前看过的消息」的组成来源。v3.22.x 想解决的「批量连发
    // 撞车只弹一条」从未有用户反馈，属于臆造场景；真正的批量连发各条内容不同，
    // 本就不会被内容去重拦截
    if (!force && (notifiedDup(nkey) || seenDup(nkey))) { gateStats.dup++; return; }
    if (!force && recentChatDup(nkey, ts)) { gateStats.dup++; return; }
    gateStats.sent++;
    // v3.19.x：累加「本次后台实际发送的通知数」——回前台汇总用它（见 visibilitychange
    // 处理器），发送者名取本次通知标题
    hiddenSentCount++;
    hiddenSentName = extra.name || store.get('lbl-partner') || (window.taWord ? window.taWord() : 'TA');
    const name = extra.name || store.get('lbl-partner') || (window.taWord ? window.taWord() : 'TA');
    let t = '';
    if (ts) {
      const d = new Date(ts);
      // v3.5.138：时间精确到秒（原只有 时:分）
      t = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
    }
    // v3.5.142：正文防乱码——任何混入的 dataURL（图片/表情包/语音）都替换为占位文案，
    // 图片本体由 image 字段单独显示缩略图
    // v3.6.x：正则从 data:image/ 扩展到任意 data:MIME/（覆盖 data:audio/ 等），
    // 并清除语音「名|||dataURL」里 ||| 之后的音频 dataURL，避免 base64 乱码
    const body = String(text || '收到一条新消息')
      .replace(/data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[附件]')
      // FIX 2026-09-13 #401 媒体池令牌串→[图片]（含令牌的消息预览不再直出 @@m:hash 乱码）
      .replace(/@@m:[0-9a-f]{32}/g, '[图片]')
      .replace(/\|\|\|.*$/, '');
    // v3.x.x：称呼跟随——通知正文里的 TA/他 按当前联系人性别替换（纯文本，安全）
    const bodyFitted = window.taFit ? window.taFit(body) : body;
    const opts = { body: (t ? t + '  ' : '') + (bodyFitted && bodyFitted.length > 40 ? bodyFitted.slice(0, 40) + '…' : bodyFitted) };
    // v3.5.156：修正安卓通知字段语义（此前 icon/badge/image 用反，导致
    // 「左侧浏览器图标、右侧 mochi、无头像」）：
    //   - badge（左侧小图标，单色）= mochi 字母图标（showSysNotification 兜底设）
    //   - icon（右侧大图标）= 联系人头像（v3.5.158：始终用头像，不被消息图顶替）
    //   - image（展开大图）= 消息图片（可选，有才设）
    // 头像/图片 dataURL → blob URL，安卓 Chrome 可靠渲染
    let bigIcon = '';   // 右侧大图标：联系人头像；无头像时兜底 mochi 字母图标（见下）
    let previewImg = ''; // 展开大图：消息图片
    // v3.5.158：右侧固定显示联系人头像——即使消息带表情包/图片，右侧仍是 TA 的头像，
    // 消息图只放 image（展开大图），不顶替头像位置
    // v3.7.x：跨桌面——extra.av（朋友圈通知的发布者头像）优先，其次当前桌面 TA 头像
    // v3.13.x：头像互动/换头像 v3.12.x 起只写聊天专用键 cs-avatar-partner（桌面
    // avatar-partner 独立不再跟随），后台通知此前仍读桌面键 → 通知弹窗头像不跟随换头像；
    // 与通话/聊天域同口径：先 cs-avatar-partner，未设回退 avatar-partner
    // v3.14.x：无头像时 icon 兜底 NOTIFY_ICON——此前 icon 缺省时大图标位空置，
    // 部分系统/浏览器会把通知左侧也渲染成浏览器默认图标；现在至少保证 mochi 字母图标
    //（https URL，SW 随时可取）。media 不再各自转 blob URL，dataURL 原样上交
    // showSysNotification 统一 Blob 化直传（页面冻结后 blob: URL 取不到图是左侧
    // 回退浏览器默认图标的根因）
    // avFixed：调用方已给出权威头像（如跨桌面联系人头像），即使为空也不再回退当前桌面头像，
    // 避免把「当前桌面的联系人头像」错当成跨桌面联系人头像显示；空值由下方兜底 mochi 图标。
    const avatar = extra.avFixed
      ? (extra.av || '')
      : (extra.av || store.get('cs-avatar-partner') || store.get('avatar-partner') || '');
    if (avatar && (avatar.indexOf('data:') === 0 || /^https?:\/\//i.test(avatar))) bigIcon = avatar;
    if (!bigIcon) bigIcon = NOTIFY_ICON;
    if (extra.img && (extra.img.indexOf('data:') === 0 || /^https?:\/\//i.test(extra.img))) previewImg = extra.img;
    // v3.21.x：头像为「等比缩略图」，统一走模块级 makeAvatarThumb
    const cropAvatarToSquare = makeAvatarThumb;
    // v3.14.x：发送链路收敛——icon 裁剪完成后连同消息图一次性交
    // showSysNotification（内部统一 dataURL→Blob 直传 + 逐级降级重发）
    const sendFinal = function (iconVal) {
      if (iconVal) opts.icon = iconVal;
      if (previewImg) opts.image = previewImg;
      // v3.12.x：受理成功才记入"已通知"指纹（窗口内同内容不再重弹）
      showSysNotification(name, opts).then(function (ok) {
        if (ok) markNotified(nkey);
      });
    };
    if (bigIcon) {
      // v3.15.x：裁剪失败不再丢弃头像——回退原图交给 showSysNotification 的
      // prepMediaBlobs 转 Blob；此前裁剪失败 cb('') 会直接丢头像导致通知无头像
      // v3.20.x：data: 与 http(s) 头像都走 1:1 裁剪，杜绝通知 icon 位拉伸变形
      cropAvatarToSquare(bigIcon, function (u) { sendFinal(u || bigIcon); });
    } else {
      sendFinal(bigIcon);
    }
  };
  // v3.21.x：头像「等比缩略图」——canvas 尺寸跟随图片本身宽高比，只整体缩放到
  // 最长边 96px，不裁切、不填充、不改变比例，避免原图在通知上被拉长/裁掉边缘；
  // 跨域图污染 canvas 时 toDataURL 抛错走 cb('') 回退原图，不影响通知发送。
  function makeAvatarThumb(dataUrl, cb) {
    try {
      const img = new Image();
      if (/^https?:\/\//i.test(dataUrl)) { img.crossOrigin = 'anonymous'; }
      img.onload = function () {
        try {
          // #292：零尺寸图（无固有宽高的 SVG 等）直接回退原图，避免缩成 1×1 白点
          if (!img.width || !img.height) { cb(''); return; }
          const maxSide = 96;
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const ctx = c.getContext('2d');
          // #292：先铺白底再绘制——JPEG 无透明通道，带透明区域的头像（PNG/默认图）
          // 直接导出会让透明像素落成黑色＝通知右侧大图标显示全黑方块
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          cb(c.toDataURL('image/jpeg', 0.85));
        } catch (e) { cb(''); }
      };
      img.onerror = function () { cb(''); };
      img.src = dataUrl;
    } catch (e) { cb(''); }
  }
  // v3.5.147：通知缩略图压缩——canvas 把图片 dataURL 压到最长边 96px JPEG。
  // 压缩失败返回空串（调用方不带图发送，保证文字通知不丢）
  function compressNotifyImg(dataUrl, cb) {
    try {
      const img = new Image();
      img.onload = function () {
        try {
          const maxSide = 96;
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, sx || 0, sy || 0, w, h);
          cb(c.toDataURL('image/jpeg', 0.72));
        } catch (e) { cb(''); }
      };
      img.onerror = function () { cb(''); };
      img.src = dataUrl;
    } catch (e) { cb(''); }
  }

  // ================= v3.15.x：离线消息提醒（Periodic Background Sync，零后端） =================
  // 页面全关后浏览器定期唤醒 SW（见 src/pwa/sw.js 同名段）：SW 读本段写入的快照弹通知。
  // 本段职责：①设置开关+状态行；②注册/注销 periodicsync；③把「当前联系人可发文案」
  // 快照写进 IDB 根键 xy-home-v2:psync-snap；④开屏就绪后把 SW 留下的 xy-home-v2:psync-queue
  // 队列按联系人安全补投递进聊天（只走 chatAddIn 内存链路——绝不直写 chat-msgs，
  // 遵守 v3.14.x 切桌面覆盖事故的教训）。
  // 边界如实展示在状态行：仅 Chromium 系支持、需添加到桌面、频率由浏览器策略决定；
  // 进程被杀无法唤醒（那需要真推送服务端，纯本地架构不引入）。iOS Safari 无此 API。
  const PSYNC_TAG = 'mochi-ta-msg';
  const PSYNC_SNAP_KEY = 'xy-home-v2:psync-snap';
  const PSYNC_QUEUE_KEY = 'xy-home-v2:psync-queue';
  const PSYNC_SNAP_TTL = 7 * 24 * 60 * 60 * 1000;
  // 兜底想念语：自建字卡不足时也保证有内容可发（k:'bl' 标记内置）
  const PSYNC_BUILTIN = [
    '刚看到一句话，想起你了。',
    '你在忙吗？我这边刚刚想到你。',
    '没什么事，就是想跟你说句话。',
    '今天也要好好吃饭呀。',
    '突然很想你，就说一声。',
    '记得喝水，别总忘了。',
    '晚安前跟你说一声，我在。',
    '有空的时候理理我呀。'
  ];
  function psyncSupported() {
    try { return 'serviceWorker' in navigator && 'PeriodicSyncManager' in window; } catch (e) { return false; }
  }
  function psyncStandalone() {
    try { return !!(window.matchMedia && window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches); } catch (e) { return false; }
  }
  function psyncEnabled() { return gGet('psync-en') === '1'; }
  function psyncPlainCard(s) {
    if (typeof s !== 'string') return false;
    const t = s.trim();
    if (!t || t.length > 60) return false;
    if (t.indexOf('|||') >= 0) return false;               // 语音卡
    if (t.indexOf('data:') === 0) return false;            // 图片/表情包
    // FIX 2026-09-12 #383 媒体池令牌卡（37 字符、无 |||、非 data:）不进保活通知文字
    if (window.mochiMediaIsToken && window.mochiMediaIsToken(t)) return false;
    if (t.indexOf('http:') === 0 || t.indexOf('https:') === 0) return false;
    return true;
  }
  function psyncShuffle(a) {
    const r = a.slice();
    for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = r[i]; r[i] = r[j]; r[j] = t; }
    return r;
  }
  function psyncBuildSnapshot() {
    let cc = [];
    try { cc = ((window.getCustomCards ? window.getCustomCards() : []) || []).filter(psyncPlainCard).slice(0, 40); } catch (e) { cc = []; }
    const picks = [];
    psyncShuffle(cc).forEach(function (t) { picks.push({ t: t.trim(), k: 'cc' }); });
    psyncShuffle(PSYNC_BUILTIN).slice(0, 4).forEach(function (t) { picks.push({ t: t, k: 'bl' }); });
    const snap = {
      v: 1,
      ts: Date.now(),
      cid: window.__activeCid || 'default',
      name: (function () { try { return store.get('lbl-partner') || 'TA'; } catch (e) { return 'TA'; } })(),
      texts: psyncShuffle(picks).slice(0, 12)
    };
    window.__psyncSnapCount = snap.texts.length;
    try { if (window.idbSet) window.idbSet(PSYNC_SNAP_KEY, snap); } catch (e) {}
    return Promise.resolve(snap);
  }
  window.__psyncBuildSnapshot = function () { return psyncBuildSnapshot(); };
  async function psyncApply() {
    if (!psyncSupported() || !psyncEnabled()) { psyncSyncStatus(); return; }
    try {
      await navigator.serviceWorker.ready;
      const st = await navigator.permissions.query({ name: 'periodic-background-sync' });
      if (st && st.state === 'denied') { psyncSyncStatus('denied'); return; }
      await navigator.periodicSync.register(PSYNC_TAG, { minInterval: 6 * 60 * 60 * 1000 });
      await psyncBuildSnapshot();
    } catch (e) {}
    psyncSyncStatus();
  }
  async function psyncTeardown() {
    try { if (psyncSupported() && navigator.periodicSync.getTags) {
      const tags = await navigator.periodicSync.getTags();
      if (tags.indexOf(PSYNC_TAG) >= 0) await navigator.periodicSync.unregister(PSYNC_TAG);
    } } catch (e) {}
    psyncSyncStatus();
  }
  async function drainPsyncQueue(force) {
    if (!window.idbGet || !window.idbSet || !window.chatAddIn) return 0;
    try { if (!force && performance.now() < 10000) return 0; } catch (e) {} // 开屏 10s 内不动，等聊天权威数据就绪
    let arr = null;
    try { arr = await window.idbGet(PSYNC_QUEUE_KEY); } catch (e) { return 0; }
    if (!Array.isArray(arr) || !arr.length) return 0;
    const cur = window.__activeCid || 'default';
    const remain = [];
    let delivered = 0;
    for (let i = 0; i < arr.length; i++) {
      const it = arr[i];
      if (!it || typeof it.t !== 'string' || !it.t.trim()) continue;
      if (!it.ts || Date.now() - it.ts > PSYNC_SNAP_TTL) continue;   // 过期丢弃
      if ((it.cid || 'default') !== cur) { remain.push(it); continue; } // 别的桌面的留着
      let dup = false;                                               // 防重复：最近 10 条同文本 30 分钟内视为已投递
      try {
        const msgs = window.getChatMsgs ? window.getChatMsgs() : null;
        if (Array.isArray(msgs)) {
          for (let j = Math.max(0, msgs.length - 10); j < msgs.length; j++) {
            const m = msgs[j];
            if (m && m.side === 'in' && m.text === it.t && Math.abs((m.ts || 0) - it.ts) < 30 * 60000) { dup = true; break; }
          }
        }
      } catch (e) {}
      if (!dup) { try { window.chatAddIn(it.t, { initiative: 1, silent: true }); delivered++; } catch (e) {} }
    }
    try { await window.idbSet(PSYNC_QUEUE_KEY, remain); } catch (e) {}
    return delivered;
  }
  window.__psyncDrain = function (force) { return drainPsyncQueue(force === true); };
  function psyncSyncStatus(state) {
    const el = document.getElementById('psync-status');
    if (!el) return;
    const isIOS = !!(window.mochiDevice || {}).isIOS;
    if (!psyncSupported()) {
      el.textContent = isIOS
        ? '此浏览器不支持离线提醒（iPhone 只能靠系统通知/保活；安卓请用 Chrome/Edge，并把应用添加到主屏幕）'
        : '此浏览器不支持离线提醒（请用安卓 Chrome/Edge，并把应用添加到主屏幕后重开此开关）';
      return;
    }
    if (!psyncEnabled()) { el.textContent = '已关闭 · 页面全关后不再收到 TA 的消息提醒'; return; }
    if (!psyncStandalone()) { el.textContent = '需先添加到主屏生效：浏览器菜单「添加到主屏幕」，再从桌面图标打开本应用，然后重新打开此开关'; return; }
    if (state === 'denied') { el.textContent = '已开启 · 但后台调度被系统/浏览器拒绝：多半是通知权限被关了。请 ①在本应用网址栏左侧打开「网站设置」→通知→允许；②手机 系统设置→应用→Edge/Chrome→通知→允许；③该应用开启「不受限制/省电」；再回来关闭并重新打开此开关'; return; }
    if ('Notification' in window && Notification.permission !== 'granted') {
      el.textContent = '已开启 · 还需允许系统通知（会弹授权，点「允许」才能收到提醒弹窗）';
      return;
    }
    let n = (typeof window.__psyncSnapCount === 'number') ? window.__psyncSnapCount : 0;
    el.textContent = '已开启 · 待发文案 ' + n + ' 条 · 后台频率由系统定（约数小时一次）；收不到请检查：系统设置允许本浏览器通知，且不限制其后台运行/省电';
  }
  // 使用说明弹窗（见 psync-help 功能说明标签）：怎么开 / 为什么开不了 / 有什么用
  const psHelp = document.getElementById('psync-help');
  if (psHelp) {
    const openPsyncHelp = function (e) {
      if (e) { try { e.stopPropagation(); e.preventDefault(); } catch (er) {} }
      const txt = [
        '离线消息提醒（零后端）\n',
        '🌟 有什么用',
        '页面全部关闭后，TA 也会在后台「留话」提醒你，营造陪伴感。系统每隔几小时唤醒一次，随机抽一条你准备（或内置）的想念字卡，以 TA 的名义弹出系统通知；回来后这条消息也会补进聊天记录。\n',
        '🔗 它和「后台弹窗」无关',
        '两者是完全独立的功能，互不影响。后台弹窗要的是「页面还在后台时」TA 发消息、靠后台保活+通知权限弹横幅。不开离线消息提醒，后台弹窗照常工作；反之亦然。想收到后台弹窗时，只需：后台保活+桌面消息弹窗开关开着+系统通知允许。\n',
        '🔓 怎么开（安卓）',
        '1. 用 Chrome 或 Edge（安卓）打开本应用；',
        '2. 浏览器菜单 →「添加到主屏幕」，再从桌面图标打开；',
        '3. 打开本开关，系统弹通知授权时点「允许」；',
        '4. 到手机 系统设置→应用→浏览器，确认「通知」允许、且未限制后台/省电。\n',
        '⚠️ 为什么有人开不了',
        '· iPhone：iOS 不支持此技术，只能靠系统通知/保活；',
        '· 非 Chrome/Edge 的安卓浏览器：不支持，请换用；',
        '· 没添加到主屏：需先从桌面图标打开才能调度；',
        '· 开了却收不到：多半是系统关了通知，或浏览器被省电/后台清理。\n',
        '📌 注意',
        '它不是真推送，频率由系统决定（约数小时一次）、只随机抽一条；也不代表对方真实在线。'
      ].join('\n');
      const ctl = window.openModal('离线消息提醒 · 功能说明', '', function () {}, {
        noInput: true,
        staticText: txt
      });
      // openModal 的确认按钮文案走 ctl.okText()（opts.okText 不被 openModal 读取，原写法静默无效、按钮显示「确定」）
      if (ctl && ctl.okText) ctl.okText('知道了');
    };
    psHelp.addEventListener('click', openPsyncHelp);
    psHelp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPsyncHelp(); }
    });
  }
  // 设置开关（全局键 psync-en，与保活/通知同款 gGet/gSet）
  const psBtn = document.getElementById('psync-en');
  function syncPsyncUI() { if (psBtn) psBtn.checked = psyncEnabled(); }
  if (psBtn) {
    psBtn.addEventListener('change', function () {
      const on = psBtn.checked;
      gSet('psync-en', on ? '1' : '0');
      psyncSyncStatus();
      if (on) {
        const go = function () { psyncApply(); };
        if ('Notification' in window && Notification.permission === 'default' && typeof requestNotifyPermission === 'function') requestNotifyPermission(go);
        else go();
        toast(on ? '离线消息提醒已开启' : '离线消息提醒已关闭');
      } else psyncTeardown();
    });
  }
  // 调度钩子：开屏就绪刷快照+分批补投递；回前台/切桌面刷新
  setTimeout(function () { psyncApply(); }, 8000);
  [12000, 27000, 47000].forEach(function (ms) { setTimeout(function () { try { drainPsyncQueue(false); } catch (e) {} }, ms); });
  try {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      try { drainPsyncQueue(false); } catch (e) {}
      try {
        if (psyncEnabled() && psyncSupported()) {
          const last = window.__psyncLastSnapAt || 0;
          if (Date.now() - last > 300000) { window.__psyncLastSnapAt = Date.now(); psyncApply(); }
        }
      } catch (e) {}
    });
  } catch (e) {}
  try {
    document.addEventListener('contact-switched', function () {
      setTimeout(function () {
        try { drainPsyncQueue(false); } catch (e) {}
        if (psyncEnabled() && psyncSupported()) psyncBuildSnapshot();
      }, 3000);
    });
  } catch (e) {}

  // v3.26.x：监听 SW notificationclick 回传——后台弹窗/离线提醒被点击时 SW 聚焦窗口后
  // 发 MOCHI_NOTIFY_CLICK，页面端调 enterChat 跳到聊天页（与桌面悬浮消息点击同款入口）。
  // enterChat 由 chat.js 定义为 window.enterChat，此处仅消费全局 API，不跨域改 chat.js。
  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', function (e) {
        if (!e || !e.data || e.data.type !== 'MOCHI_NOTIFY_CLICK') return;
        try { if (typeof window.enterChat === 'function') window.enterChat(); } catch (x) {}
      });
    }
  } catch (e) {}
})();
