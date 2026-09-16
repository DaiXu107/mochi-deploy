// ===== v3.33.x 压缩图片（字卡库 / 美化上传图片按「新上传」同标准重压，保持清晰、减小占用）=====
// 需求：设置里新增压缩图片功能，可选择压缩「字卡库上传的图片」和「美化里上传的图片」；
// 压缩后图片依旧清晰，存储占用明显变小；结果同步到「查看存储」（可清理空间 + 总占用刷新）。
// 与现有上传压缩同标准（chatcard.js 字卡图 720px JPEG0.85 / 表情 480px PNG；
// personalize.js 壁纸 2880px、卡片背景 1000px、桌面图片 1280px、头像 256px）——
// 只把「明显偏大」的存量图重压到新上传同样的清晰标准，保证视觉效果一致。
// v3.42.x #427：JPEG 目标在支持 WebP 编码的浏览器上改存 WebP（同质量体积更小，
// 编码级探测、不支持自动回退 JPEG；表情 PNG 不变），见 webpSupported()/compressOne。
// 数据安全底线：
//   · 只处理本地 base64 大图：动图(GIF)不动（重压丢动画）、媒体池令牌 @@m: 不动（与聊天共享，
//     池由媒体池 GC 管理）、远程链接/语音不动、已较小的图不动（阈值见 KIND）；
//   · 「压缩产物不小于原图 90%」时不写回——绝不把图压得更大/更糊（newLen < oldLen * 0.9 守卫）；
//   · >8MB base64 / >2600 万像素不解码（沿用全站 iOS 防崩溃拦截，跳过不算失败）；
//   · 读走 idbGet 权威层，读不到（存储繁忙）只跳过并如实标注，绝不据空值写任何数据；
//   · 写回走 xyStore(prefix).set（内存+LS+IDB 三路同拍），字卡库与 chatcard 保存路径同源，
//     其缓存自动失效，无需手工清理。
(function () {
  const G = 'xy-home-v2:';
  // 各来源压缩目标（与对应上传入口同标准）；thr 为「明显偏大」阈值，低于它不碰
  const KIND = {
    'cc-img': { maxSide: 720,  format: 'image/jpeg', quality: 0.85, thr: 100 * 1024 }, // 字卡·图片分类
    'cc-stk': { maxSide: 480,  format: 'image/png',  quality: 0.85, thr: 100 * 1024 }, // 字卡·表情包分类
    wall:     { maxSide: 2880, format: 'image/jpeg', quality: 0.85, thr: 400 * 1024 }, // 手机壁纸/页面背景/聊天壁纸
    card:     { maxSide: 1000, format: 'image/jpeg', quality: 0.85, thr: 150 * 1024 }, // 卡片背景
    desk:     { maxSide: 1280, format: 'image/jpeg', quality: 0.85, thr: 200 * 1024 }, // 桌面图片组件
    avatar:   { maxSide: 256,  format: 'image/jpeg', quality: 0.85, thr: 80 * 1024 }   // 头像
  };
  // 美化图片键识别（键名以这些结尾才算；排除缩略图 thb-* 与 card-bg-mask-* 数值键）
  const BEAUTY_RE = /(?:^|:)(?:phone-bg|phone-bg-item-(?!thb-)[A-Za-z0-9_-]+|page-bg-[0-9]+|card-bg-(?!mask-)[A-Za-z0-9_-]+|desk-image-src-[A-Za-z0-9_-]+|cs-bg|cs-bg-item-(?!thb-)[A-Za-z0-9_-]+|cs-avatar-(?:partner|user)|avatar-(?:partner|user))$/;
  function kindOf(key) {
    const k = String(key);
    if (k.indexOf('avatar') >= 0) return 'avatar';
    if (k.indexOf('desk-image-src') >= 0) return 'desk';
    if (k.indexOf('card-bg') >= 0) return 'card';
    if (k.indexOf('phone-bg') >= 0 || k.indexOf('page-bg') >= 0 || k.indexOf('cs-bg') >= 0) return 'wall';
    return null;
  }
  function ccLibs() {
    const out = [{ prefix: G, key: 'cc-groups-public', label: '公用字卡库' }];
    try {
      (window.getContacts ? window.getContacts() : []).forEach(function (c) {
        if (c && c.id) out.push({ prefix: G + c.id + ':', key: 'cc-groups', label: (c.name || c.id) + ' · 专属' });
      });
    } catch (e) {}
    // 旧版顶层键（多桌面功能之前的历史残留，chatcard 迁移逻辑的源头，有就扫）
    out.push({ prefix: G, key: 'cc-groups', label: '旧版顶层字卡库（残留）' });
    return out;
  }
  function parseCc(raw) {
    try {
      const s = typeof raw === 'string' ? raw : JSON.stringify(raw);
      const g = JSON.parse(s || 'null');
      if (g && typeof g === 'object' && g.text) return g;
    } catch (e) {}
    return null;
  }
  // 是否值得压缩（阈值 + 类型红线，扫描与压缩共用同一判定，保证口径一致）
  function compressible(dataUrl, kind) {
    if (typeof dataUrl !== 'string') return false;
    if (dataUrl.indexOf('@@m:') === 0) return false;        // 媒体池令牌：数据在池里，池由 GC 管理
    if (dataUrl.indexOf('data:image/') !== 0) return false; // 只处理本地 base64 图（远程链接/语音不碰）
    if (/^data:image\/gif/i.test(dataUrl)) return false;    // 动图重压会丢动画
    if (dataUrl.length > 8 * 1024 * 1024) return false;     // 超大全站不解码（iOS 解码崩溃红线）
    const kd = KIND[kind];
    if (!kd) return false;
    return dataUrl.length > kd.thr;
  }
  // v3.42.x #427：照片类优先 WebP——同质量比 JPEG 再省约 25~50% 存储（媒体池/字卡库都是
  // base64 常驻 IDB 的大头）。能力探测必须是「编码级」：不支持的浏览器（旧 Safari 等）
  // toDataURL('image/webp') 会静默回退返回 PNG 前缀 → 判不支持，自动沿用原 JPEG 路径，
  // 行为与旧版完全一致；探测结果缓存（每会话一次）。表情 PNG（cc-stk）与透明保留路径不受影响；
  // 产物是合法 data:image/webp，媒体池（data:image/* 通配）与渲染端 <img> 均直接兼容。
  let __webpOk = null;
  function webpSupported() {
    if (__webpOk !== null) return __webpOk;
    try {
      const c = document.createElement('canvas');
      c.width = 1; c.height = 1;
      __webpOk = c.toDataURL('image/webp', 0.8).indexOf('data:image/webp') === 0;
    } catch (e) { __webpOk = false; }
    return __webpOk;
  }
  // 单图重压：返回 { data, skip }；data 为 null = 跳过（解码失败/超大像素）
  function compressOne(dataUrl, kind) {
    return new Promise(function (resolve) {
      const kd = KIND[kind];
      if (!compressible(dataUrl, kind)) { resolve({ data: null, skip: 'not' }); return; }
      const img = new Image();
      img.onload = function () {
        try {
          if (img.width * img.height > 26000000) { resolve({ data: null, skip: 'pixels' }); return; }
          const scale = Math.min(1, kd.maxSide / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          // 表情包固定 PNG（保留透明）；美化图源是 PNG 时保留 PNG 只缩尺寸（防透明变黑底）；
          // 其余 JPEG 目标在支持 WebP 编码的环境改 WebP（#427，同质量更小；白底填充同 JPEG）；
          // 不支持 WebP 的环境沿用 JPEG，与旧版行为一致
          const keepPng = kind === 'cc-stk' || (/^data:image\/png/i.test(dataUrl) && kd.format === 'image/jpeg');
          let format = keepPng ? 'image/png' : kd.format;
          if (format === 'image/jpeg' && webpSupported()) format = 'image/webp';
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const ctx = c.getContext('2d');
          if (format === 'image/jpeg' || format === 'image/webp') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
          ctx.drawImage(img, 0, 0, w, h);
          const out = c.toDataURL(format, kd.quality);
          resolve(out ? { data: out, skip: 'ok' } : { data: null, skip: 'encode' });
        } catch (e) { resolve({ data: null, skip: 'err' }); }
      };
      img.onerror = function () { resolve({ data: null, skip: 'decode' }); };
      img.src = dataUrl;
    });
  }
  // ===== 扫描：统计可压缩图片（只数不压，不解码） =====
  window.mochiImgScan = function () {
    return (async function () {
      const out = { ok: false, reason: '', cc: { n: 0, bytes: 0 }, beauty: { n: 0, bytes: 0 } };
      if (!window.idbListKeys || !window.idbGet) { out.reason = '接口不可用'; return out; }
      const keys = await window.idbListKeys();
      if (!keys) { out.reason = '键清单读取失败（存储繁忙），稍后再试'; return out; }
      const keySet = {};
      keys.forEach(function (k) { keySet[String(k)] = true; });
      // ① 字卡库（公用 + 各联系人专属 + 旧版顶层残留）
      const libs = ccLibs().filter(function (L) { return keySet[L.prefix + L.key]; });
      for (let i = 0; i < libs.length; i++) {
        const L = libs[i];
        const raw = await window.idbGet(L.prefix + L.key);
        if (raw === undefined || raw === null) { out.reason = out.reason || '字卡库「' + L.label + '」没读到（存储繁忙），结果可能不全'; continue; }
        const g = parseCc(raw);
        if (!g) continue;
        ['sticker', 'image'].forEach(function (cat) {
          const arr = g[cat];
          if (!Array.isArray(arr)) return;
          const kind = cat === 'image' ? 'cc-img' : 'cc-stk';
          arr.forEach(function (tu) {
            if (!Array.isArray(tu) || !Array.isArray(tu[1])) return;
            tu[1].forEach(function (card) {
              if (compressible(card, kind)) { out.cc.n++; out.cc.bytes += card.length * 2; }
            });
          });
        });
      }
      // ② 美化（壁纸/页面背景/卡片背景/桌面图片/聊天壁纸/头像）
      const beautyKeys = keys.filter(function (k) { return BEAUTY_RE.test(String(k)); });
      for (let i = 0; i < beautyKeys.length; i++) {
        const k = String(beautyKeys[i]);
        const kind = kindOf(k);
        if (!kind) continue;
        const v = await window.idbGet(k);
        if (typeof v !== 'string' || !compressible(v, kind)) continue;
        out.beauty.n++;
        out.beauty.bytes += v.length * 2;
      }
      out.ok = true;
      return out;
    })().catch(function (e) { return { ok: false, reason: '扫描异常：' + ((e && e.message) || e), cc: { n: 0, bytes: 0 }, beauty: { n: 0, bytes: 0 } }; });
  };
  // ===== 压缩：重压选中来源的可压缩图（只替换更小的产物） =====
  window.mochiImgCompress = function (source) {
    // source: 'all' | 'cc' | 'beauty'
    return (async function () {
      const out = { ok: false, reason: '', source: source, processed: 0, saved: 0, skipped: 0 };
      if (!window.idbListKeys || !window.idbGet || !window.xyStore) { out.reason = '接口不可用'; return out; }
      const keys = await window.idbListKeys();
      if (!keys) { out.reason = '键清单读取失败（存储繁忙），本次未压缩'; return out; }
      const keySet = {};
      keys.forEach(function (k) { keySet[String(k)] = true; });
      const tick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };
      const reasons = [];
      // ① 字卡库
      if (source === 'all' || source === 'cc') {
        const libs = ccLibs().filter(function (L) { return keySet[L.prefix + L.key]; });
        for (let i = 0; i < libs.length; i++) {
          const L = libs[i];
          const raw = await window.idbGet(L.prefix + L.key);
          if (raw === undefined || raw === null) { reasons.push('字卡库「' + L.label + '」没读到，跳过'); continue; }
          const g = parseCc(raw);
          if (!g) continue;
          let changed = false;
          const cats = ['sticker', 'image'];
          for (let ci = 0; ci < cats.length; ci++) {
            const cat = cats[ci];
            const arr = g[cat];
            if (!Array.isArray(arr)) continue;
            const kind = cat === 'image' ? 'cc-img' : 'cc-stk';
            for (let gi = 0; gi < arr.length; gi++) {
              const tu = arr[gi];
              if (!Array.isArray(tu) || !Array.isArray(tu[1])) continue;
              const cards = tu[1];
              for (let j = 0; j < cards.length; j++) {
                const card = cards[j];
                if (!compressible(card, kind)) continue;
                const r = await compressOne(card, kind);
                if (!r.data) { out.skipped++; continue; }
                const oldLen = card.length;
                const newLen = r.data.length;
                if (newLen < oldLen * 0.9) { // 产物至少小 10% 才替换，绝不变大/变糊
                  cards[j] = r.data;
                  changed = true;
                  out.processed++;
                  out.saved += (oldLen - newLen) * 2;
                } else { out.skipped++; }
                await tick();
              }
            }
          }
          if (changed) {
            let s = '';
            try { s = JSON.stringify(g); } catch (e) { reasons.push('字卡库「' + L.label + '」写回序列化失败，跳过'); continue; }
            try { window.xyStore(L.prefix.slice(0, -1)).set(L.key, s); }
            catch (e) { reasons.push('字卡库「' + L.label + '」写回失败：' + ((e && e.message) || e)); }
          }
          await tick();
        }
      }
      // ② 美化
      if (source === 'all' || source === 'beauty') {
        const beautyKeys = keys.filter(function (k) { return BEAUTY_RE.test(String(k)); });
        for (let i = 0; i < beautyKeys.length; i++) {
          const k = String(beautyKeys[i]);
          const kind = kindOf(k);
          if (!kind) continue;
          const v = await window.idbGet(k);
          if (typeof v !== 'string' || !compressible(v, kind)) continue;
          const r = await compressOne(v, kind);
          if (!r.data) { out.skipped++; continue; }
          const oldLen = v.length;
          const newLen = r.data.length;
          if (newLen < oldLen * 0.9) {
            const k0 = k.slice(0, k.lastIndexOf(':')); // 去尾冒号：xyStore 会自己拼 ':' + bare
            const bare = k.slice(k.lastIndexOf(':') + 1);
            try { window.xyStore(k0).set(bare, r.data); out.processed++; out.saved += (oldLen - newLen) * 2; }
            catch (e) { reasons.push('美化图片「' + bare + '」写回失败：' + ((e && e.message) || e)); }
          } else { out.skipped++; }
          await tick();
        }
      }
      if (reasons.length) out.reason = reasons.join('；');
      out.ok = true;
      return out;
    })().catch(function (e) { return { ok: false, reason: '压缩异常：' + ((e && e.message) || e), source: source, processed: 0, saved: 0, skipped: 0 }; });
  };
  // ===== UI：设置行「压缩图片」 + 查看存储「可清理空间 · 可压缩图片」共用入口 =====
  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
    return n + ' B';
  }
  function toast(msg) {
    try {
      let t = document.getElementById('cc-toast');
      if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
      t.textContent = msg; t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
      clearTimeout(t._icT); t._icT = setTimeout(function () { t.className = 'cc-toast'; }, 3600);
    } catch (e) {}
  }
  function refreshRow(rep) {
    const el = document.getElementById('st-img-compress');
    if (!el || !rep) return;
    const cc = rep.cc || {}, b = rep.beauty || {};
    const n = (cc.n || 0) + (b.n || 0);
    el.textContent = n ? ('字卡库 ' + (cc.n || 0) + ' 张 · 美化 ' + (b.n || 0) + ' 张，共约 ' + fmtBytes((cc.bytes || 0) + (b.bytes || 0))) : '无（未发现偏大图片）';
  }
  function refreshRowAfter(res, source) {
    const el = document.getElementById('st-img-compress');
    if (!el || !res) return;
    const s = source === 'cc' ? '字卡库' : source === 'beauty' ? '美化' : '字卡库+美化';
    el.textContent = '已压缩 ' + res.processed + ' 张（' + s + '），释放约 ' + fmtBytes(res.saved) + '，可重新扫描';
  }
  function runCompress(source) {
    if (!window.mochiImgCompress) return;
    toast('正在压缩图片（图片较多时较慢，请勿离开本页）…');
    window.mochiImgCompress(source).then(function (res) {
      if (!res || !res.ok) { toast('压缩未完成：' + ((res && res.reason) || '未知原因')); return; }
      toast('已压缩 ' + res.processed + ' 张，释放约 ' + fmtBytes(res.saved) + (res.skipped ? '（跳过 ' + res.skipped + ' 张：动图/已较小/压缩后不更小则不替换）' : ''));
      refreshRowAfter(res, source);
      // 字卡库内存缓存失效重载：聊天回复池/字卡管理页立即用压缩后的新图（否则本会话继续发旧图）
      try { if (window.ccReloadGroupsAfterExternalWrite) window.ccReloadGroupsAfterExternalWrite(); } catch (e) {}
      // 同步「查看存储」：personalize 监听该事件重算总占用（页面可见时才刷新）
      try { document.dispatchEvent(new CustomEvent('mochi-img-compressed')); } catch (e) {}
    }).catch(function () { toast('压缩异常，请稍后重试'); });
  }
  function scanThenModal() {
    if (!window.mochiImgScan || !window.mochiImgCompress || !window.openModal) { toast('当前环境不支持，请在支持 IndexedDB 的设备上使用'); return; }
    toast('正在扫描图片（大库较慢，请稍候）…');
    window.mochiImgScan().then(function (rep) {
      if (!rep || !rep.ok) {
        if (window.openModal) window.openModal('扫描未完成', '', null, { noInput: true, staticText: ((rep && rep.reason) || '未知原因') + '\n\n没有改动任何数据，稍后存储空闲时可再试。' });
        return;
      }
      refreshRow(rep);
      const cc = rep.cc || {}, b = rep.beauty || {};
      if (!(cc.n || 0) && !(b.n || 0)) {
        if (window.openModal) window.openModal('压缩图片', '', null, { noInput: true, staticText: '没有可压缩的图片。\n\n只压缩「明显偏大」的存量图（字卡图片/表情约 >100KB、壁纸/背景约 >400KB、桌面图片约 >200KB 等）。动图（GIF）、已较小的图、媒体池共享图（聊天去重仓库）都不会被压缩。' });
        return;
      }
      const lines = [
        '扫描结果：',
        '· 字卡库上传的图片：' + (cc.n || 0) + ' 张，约 ' + fmtBytes(cc.bytes || 0),
        '· 美化里上传的图片：' + (b.n || 0) + ' 张，约 ' + fmtBytes(b.bytes || 0),
        '',
        '压缩规则：把偏大的存量图按「新上传」相同的清晰标准重压（字卡图片最长边 720px、表情包 480px、壁纸/背景 2880px、卡片背景 1000px、桌面图片 1280px、头像 256px，质量 0.85）。支持 WebP 的浏览器照片类自动改存 WebP，同清晰度体积更小；表情包仍为 PNG。压缩产物不小于原图时不替换；动图（GIF）与媒体池共享图不动，超大原图（>8MB）为防崩溃不解码。',
        '',
        '⚠️ 压缩会覆盖原图（替换成更小的版本），原图不留底、不可撤销。建议先导出备份：设置 → 数据备份 → 导出（或云端备份），备份里保留压缩前的原图。',
        '',
        '压缩后图片依旧清晰，存储占用明显变小；「查看存储」的总占用会同步刷新。',
        '',
        '选择压缩范围：'
      ];
      if (window.openModal) window.openModal('压缩图片', '', function (v) {
        runCompress(v || 'all');
      }, { noInput: true, staticText: lines.join('\n'), pills: [
        { label: '全部压缩', value: 'all' },
        { label: '仅字卡库图片', value: 'cc' },
        { label: '仅美化图片', value: 'beauty' }
      ], pill: 'all' });
    }).catch(function () { toast('扫描异常，请稍后重试'); });
  }
  // 接线：设置行 + 查看存储页按钮
  const row = document.getElementById('row-img-compress');
  if (row) row.addEventListener('click', scanThenModal);
  const btn = document.getElementById('st-img-compress-btn');
  if (btn) btn.addEventListener('click', scanThenModal);
})();
