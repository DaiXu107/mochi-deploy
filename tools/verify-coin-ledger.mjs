import { webkit } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');

const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
// 移除开屏遮罩与常见弹层（验证脚本无需走交互流程）
await page.evaluate(() => {
  const sp = document.getElementById('splash');
  if (sp) { sp.classList.add('hide'); setTimeout(() => { if (sp.parentNode) sp.parentNode.removeChild(sp); }, 50); }
  document.querySelectorAll('.qa-mask, .mask, [id$="-mask"]').forEach(el => { try { el.style.display = 'none'; } catch (e) {} });
});
await page.waitForTimeout(600);
await page.click('.app[data-app="home"]');
await page.waitForTimeout(300);

const tabs = await page.$$eval('#page-home .fav-tab', els => els.map(e => e.dataset.htab + ':' + e.textContent.trim()));
console.log('TABS:', JSON.stringify(tabs));

// 空态
await page.click('.fav-tab[data-htab="coinrp"]');
await page.waitForTimeout(200);
console.log('RP visible:', await page.isVisible('#home-coinrp'));
console.log('RP empty text:', (await page.textContent('#home-coinrp')).trim().slice(0, 60));

// 制造双向红包聊天记录：TA 发（in）+ 我发（out）
// addIn 固定 side=in；「我发」走内存数组 push（主页渲染读 getChatMsgs()）
await page.evaluate(() => {
  window.chatAddIn('', { special: 'redpacket', rpAmount: 52.00, rpWish: '心意', rpStatus: 'received', rpTs: Date.now() - 3600e3 });
  const arr = window.getChatMsgs();
  arr.push({ side: 'out', special: 'redpacket', rpAmount: 13.14, rpWish: '小礼物', rpStatus: 'pending', rpTs: Date.now() });
});
// 重新进入主页刷新渲染
await page.click('.fav-tab[data-htab="av"]');
await page.waitForTimeout(150);
await page.click('.fav-tab[data-htab="coinrp"]');
await page.waitForTimeout(200);
console.log('RP after:', (await page.textContent('#home-coinrp')).trim());

// 制造几条小游戏对局消息（各游戏聊天写入格式）
await page.evaluate(() => {
  window.chatAddIn('双人打砖块 · 120 分 · 最高连击 ×8 · 完成第 3 层', { special: 'brick' });
  window.chatAddIn('Pong · 你 5 : 3 TA · 你赢', { special: 'pong' });
  window.chatAddIn('记忆翻牌 · 你 4 对 · TA 3 对 · 默契 76', { special: 'memory' });
  window.chatAddIn('四子棋 · 你赢', { special: 'c4' });
  window.chatAddIn('合作扫雷 · 完成 普通', { special: 'ms' });
  // 联系人主动邀请玩游戏（sendTaInvite 写入的 gInv 字段，cuddle 贴贴不算游戏）
  window.chatAddIn('TA 想和你玩一局 Pong，来吗？', { special: 'poke', gInv: 'pong' });
  window.chatAddIn('TA 想和你猜拳，来一局？', { special: 'poke', gInv: 'rps' });
  window.chatAddIn('TA 想贴贴了，你可以过来一点吗？', { special: 'poke', gInv: 'cuddle' });
});
// 重新打开统计页聊天记录
await page.click('#home-back');
await page.waitForTimeout(300);
await page.click('.app[data-app="stats"]');
await page.waitForTimeout(400);
await page.click('.fav-tab[data-stab="chat"]');
await page.waitForTimeout(300);
const body2 = await page.textContent('#st-chat-content');
const gm = body2.match(/小游戏记录[^]*?(\d+) 条/);
console.log('GAME section count:', gm ? gm[1] : 'NOT FOUND');
console.log('GAME has brick:', body2.includes('双人打砖块'));
console.log('GAME has c4:', body2.includes('四子棋'));
console.log('GAME has ms:', body2.includes('合作扫雷'));
console.log('GAME has memory:', body2.includes('记忆翻牌'));
console.log('GAME has pong:', body2.includes('乒乓'));
console.log('GAME has invite pong:', body2.includes('TA 邀请玩 Pong'));
console.log('GAME has invite rps:', body2.includes('TA 邀请玩 猜拳'));
console.log('GAME excludes cuddle:', !body2.includes('邀请玩 贴贴') && !body2.includes('贴贴了'));

// ===== TA 的关心 tab =====
await page.click('#stats-back'); // 回桌面（统计页返回键）
await page.waitForTimeout(300);
await page.click('.app[data-app="home"]');
await page.waitForTimeout(300);
// 注入关心记录：番茄陪伴 + 经期/喝水/吃饭 tag 消息 + 查岗
await page.evaluate(() => {
  window.addCareRecord('pomo', '');
  window.chatAddIn('记得喝水呀，今天也要水灵灵的', { tag: '喝水提醒' });
  window.chatAddIn('到点吃饭啦，别饿着自己', { tag: '吃饭提醒' });
  window.chatAddIn('这几天要注意保暖，别着凉了', { tag: '经期关心' });
  window.chatAddIn('TA 来查岗了。', { special: 'ask-msg' });
  window.chatAddIn('在干嘛呢，有没有好好休息？', { special: 'ask-card', askQuestion: '在干嘛呢，有没有好好休息？' });
});
await page.click('.fav-tab[data-htab="care"]');
await page.waitForTimeout(200);
const care = await page.textContent('#home-care');
console.log('CARE visible:', await page.isVisible('#home-care'));
console.log('CARE has pomo:', care.includes('番茄钟陪伴'));
console.log('CARE has water:', care.includes('提醒喝水'));
console.log('CARE has eat:', care.includes('提醒吃饭'));
console.log('CARE has period:', care.includes('经期关心'));
console.log('CARE has checkin:', care.includes('查岗'));
console.log('CARE content:', care.trim().slice(0, 200));

console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
