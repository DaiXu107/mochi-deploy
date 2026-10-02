// #1250 更新后「存储修复引导」一次性弹窗（AI-B 域，数据层/系统）
// 背景：iPhone 15 Pro Max + Safari 实报三症状（聊天记录被吞／背景图要重启才显示／
// 系统一直说储存空间不足）。三者机理已由 #1218（读空/写空双向假象）与 #1227（写超时
// 假失败＋大键写风暴）修掉并上线，但用户端需要一次明确的善后指引：①先导出完整备份
// ②坏图一键自愈 ③旧写风暴撑出的占用「虚高」如何彻底清零。本弹窗只做指路＋把已有
// 的安全功能（window.mochiMediaRebuild，只补缺失、绝不覆盖删除）接一个按钮，
// 零机型／零 UA 分支：弹不弹只取「本引导 ID 是否已确认送达」这一代码事实。
(function () {
  const G = 'xy-home-v2:';
  const FLAG_KEY = G + 'storage-guide-shown';
  const GUIDE_ID = '1250';
  let doneThisSession = false;

  function markShown() {
    try { localStorage.setItem(FLAG_KEY, GUIDE_ID); } catch (e) {}
    try { if (window.idbSet) window.idbSet(FLAG_KEY, GUIDE_ID); } catch (e2) {}
  }

  function runRebuild() {
    let lastToastAt = 0;
    try { if (typeof window.toast === 'function') window.toast('开始重建媒体池：扫描＋哈希校验，大库约需几分钟，请留在本页'); } catch (e) {}
    window.mochiMediaRebuild(function (num, total, label) {
      const now = Date.now();
      if (now - lastToastAt < 2500) return;
      lastToastAt = now;
      try { if (typeof window.toast === 'function') window.toast('重建进行中… ' + (label || '') + (total ? ' ' + num + '/' + total : '') + '，请留在本页'); } catch (e) {}
    }).then(function (rep) {
      const lines = [];
      if (!rep || !rep.ok) {
        lines.push('这次没有完成：' + ((rep && rep.reason) || '未知原因') + '。');
        lines.push('没有改动任何数据。可稍后到「设置 → 工具 → 查看存储」里再点「媒体池重建」。');
      } else {
        lines.push('池内原有 ' + rep.poolN + ' 条（缺失/空 ' + rep.brokenN + ' 条），本机扫到存留原图副本，新补回 ' + rep.written + ' 条' + (rep.writeFail ? '（' + rep.writeFail + ' 条写失败，可稍后再点一次）' : '') + '。');
        if (rep.written > 0) lines.push('已补回的部分：回到聊天／朋友圈即可看到图片恢复。');
        else lines.push('没有可补回的条目——本机已不留这些图的副本；仍显示「图片丢失」的图，只能从有完整图片的设备导出「完整备份」（不要选「只备份文字」）再导入。');
      }
      try { if (window.openModal) window.openModal('图片自愈结果', '', null, { noInput: true, big: true, staticText: lines.join('\n') }); } catch (e) {}
    }).catch(function () {
      try { if (window.openModal) window.openModal('重建异常', '', null, { noInput: true, staticText: '媒体池重建中途出错，没有改动任何数据。\n\n可稍后到「设置 → 工具 → 查看存储」重试；反复出现请到「关于/诊断」导出诊断信息报障。' }); } catch (e) {}
    });
  }

  function showGuide() {
    const canRebuild = typeof window.mochiMediaRebuild === 'function';
    const text = [
      '本次更新已修好三件事：',
      '·「存储空间不足／存储异常」弹窗误报（写入超时被当成失败）；',
      '· 聊天记录／背景图「显示丢失」假象——你的数据一直都在，重进页面即可恢复显示；',
      '· 大记录反复整包重写（卡顿与占用暴涨的源头）。',
      '',
      '还剩两件善后，建议按顺序做：',
      '① **先导出一次完整备份**：设置 → 数据备份 → 导出备份。',
      canRebuild ? '② 聊天的图片/表情有损坏占位：点下方「立即自愈图片」。它用本机留存的原图副本按内容哈希补缺失条目——只补不删、不覆盖任何有效数据，可放心点。' : '② 聊天的图片/表情有损坏占位：请到「设置 → 工具 → 查看存储」点「媒体池重建」自愈。',
      '',
      'iPhone 仍提示磁盘空间不足？旧版写风暴可能把本站占用撑出「虚高」（浏览器报的比真实数据大很多）。Safari 会随日常使用逐步回收；想立刻清零：先确认 ① 的备份**导出成功**，再到 iPhone 设置 → Safari → 高级 → 网站数据，删除本站后重开网页、导入备份。'
    ].join('\n');
    const ctl = window.openModal('更新完成 · 存储修复引导', '', function () {
      if (canRebuild) runRebuild();
    }, { noInput: true, big: true, staticEmph: true, staticText: text });
    try { if (ctl && ctl.okText) ctl.okText(canRebuild ? '立即自愈图片' : '知道了'); } catch (e) {}
    markShown();
  }

  function gate() {
    if (doneThisSession) return;
    if (!window.openModal) return;
    try { if (localStorage.getItem(FLAG_KEY) === GUIDE_ID) { doneThisSession = true; return; } } catch (e) {}
    // LS 键可能被 iOS 清空或写失败——再用 IDB 复核一次；两边都没有才弹。
    // 复核为异步：idbGet 读不到（含挂起 undefined）按「没送达」处理，宁可多弹一次也不错过。
    const proceed = () => {
      if (doneThisSession) return;
      // 弹窗是单例（#modal-ok/#modal-mask 全站共用）：用户此刻正在某个弹窗里操作（例：
      // 「导入数据」的范围弹窗＋确定层文件选择＝#1014/#1197 那一族入口）时开引导＝把那一层
      // 连流程一起抢走，落点还会打在换上的按钮上（无头实测 B2 假象同形）。让路重试，不抢。
      const mask = document.getElementById('modal-mask');
      if (mask && !mask.hidden) { setTimeout(proceed, 2500); return; }
      // #1541a：modal-mask 之外的自绘弹层（联系人管理面板 #contact-manager 等）开着同样让路
      // ——它们不占 mask，却正被用户操作；抢开＝连同其上层输入弹窗一起顶掉（「添加联系人
      // 桌面无反应」主因，探针实测 300ms 内引导顶上）。
      if (window.mochiOverlayBusy && window.mochiOverlayBusy()) { setTimeout(proceed, 2500); return; }
      doneThisSession = true;
      try { showGuide(); } catch (e) {}
    };
    const afterIdb = function (v) {
      if (v === GUIDE_ID) { try { localStorage.setItem(FLAG_KEY, GUIDE_ID); } catch (e) {} doneThisSession = true; return; }
      // 数据回填刚完成，弹层再让 4 秒给开屏动画/备份提醒条落地
      setTimeout(proceed, 4000);
    };
    try {
      if (window.idbGet) { window.idbGet(FLAG_KEY).then(afterIdb).catch(function () { setTimeout(proceed, 4000); }); return; }
    } catch (e) {}
    setTimeout(proceed, 4000);
  }

  try {
    if (window.mochiOnDataReady) window.mochiOnDataReady(gate);
    else document.addEventListener('mochi-restore-done', function () { gate(); });
  } catch (e) {}
})();
