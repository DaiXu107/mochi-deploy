// #1209 「修了没上线」门禁：逐字节比对 本地 HEAD 的产物 ↔ GitHub Pages 线上的产物
//
// 立项原因（第 6 类根因，见 BUGS.md）：台账里有三条复报的真因都不是代码写错，而是修复没到达用户——
//   #1017 提交 message 写「已入库」，实际只落在侧分支，不是 main 的祖先；
//   #1009 `cc8f2a6` 改 chat.js 时把上一批三处逻辑整块写回旧版，照常构建上线；
//   #402  占位自 #397 起从未生效（`slice.call(Set)` 恒空），哨兵只证「代码还在」证不了这个。
// 共同点：`--check-sentinels` 与 `verify:all` 全绿，因为绿的口径是「本地 src/产物」，没人问「线上是哪一版」。
//
// 口径：不用挑 needle。GitHub Pages 原样吐仓库文件，所以「线上 js/chat.js 的 git blob sha == HEAD 该文件的
// blob sha」就是最强的单文件结论（整文件逐字节相同），比特征串命中覆盖面大得多。
//
// 用法：
//   node tools/verify-shipped.mjs              只比「HEAD ↔ 远端 main」之间有差异的产物（默认，秒级）
//   node tools/verify-shipped.mjs --all        全部产物逐个比（约 86 件，含线上 404 缺件检查）
//   node tools/verify-shipped.mjs --commits    纯离线：只看 git 层（未进远端的提交 + 其批次号），不碰网络
//   node tools/verify-shipped.mjs --base=<ref> 换比对基线（默认取 ls-remote 的 origin/main 真 sha）
//   node tools/verify-shipped.mjs --rev=<rev>  换「期望版本」（默认 HEAD）：反查线上到底是哪一版，
//                                              或造出期望≠线上的红侧来证明这条判据真会响
//
// ⚠️ 基线必须走 `git ls-remote`，不能信本地的 `origin/main` 引用：实测本机 origin/main 停在 #1155，
//    而 ls-remote 回的就是 HEAD——用陈旧引用会误报「领先 12 条没推」。
//
// 退出码：0 = 线上就是这个版本；1 = 有产物不一致 / 有提交未进远端；2 = 环境不满足（网络断、ls-remote 失败），
//    按项目口径环境缺口不算回归，不混进 1。

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { request } from 'node:https';
import { normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (name) => {
  const a = argv.find((x) => x.startsWith(name + '='));
  return a ? a.slice(name.length + 1) : null;
};

const LIVE_BASE = 'https://ling233330-star.github.io/mochi/';
// 期望版本（默认 HEAD）。指到别的 rev 上有两个用途：①拿线上反查「线上到底是哪一版」；
// ②造出「期望 ≠ 线上」的红侧，证明这条判据真会响而不是恒绿。
const EXPECT = opt('--rev') || 'HEAD';
const REQ_TIMEOUT = 60000;
const DEADLINE = 240000; // 绝对死线只挡真挂死（截断时 Node 不派 end/timeout）；卡在半速 trickle 由下面的无活动超时先判
const RETRY = 1;
const JOBS = 2; // 带宽就这么多，并发越高越容易互相挤到超死线（实测 3 并发把 chat.js 挤爆）
const BUDGET = 420000; // 全程预算：超了剩余文件直接落成环境缺口，不让人无限等

const git = (args, allowFail) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }).trim();
  } catch (e) {
    if (allowFail) return null;
    throw e;
  }
};
const hasObj = (sha) => sha !== null && git(['cat-file', '-e', sha + '^{commit}'], true) !== null;
const blobOf = (rev, path) => git(['rev-parse', rev + ':' + path], true);
const short = (s) => (s ? s.slice(0, 8) : '—');

// 线上文件 → git blob sha：sha1("blob <len>\0" + 内容)，与 `git hash-object` 同式
const blobShaOfBytes = (buf) =>
  createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + buf.length + '\0'), buf])).digest('hex');

// 单次抓取。两个硬约束（都是本脚本立项理由那一类，不能省）：
// ① 总次数上限（重试与重定向共用一个计数器）——否则线上一个 301 环就永久挂住；
// ② 每记请求一条到点必响的死线——实测 1.5MB 的 index.html 被截断时，Node 既不派 'end'
//    也不派 'timeout'，Promise 永不结算 ⇒ 门禁的表现就是「不说话了」＝静默失败本体。
//    有了死线，取不到一律落成 `!`（环境缺口，退出码 2），绝不落成「看起来像通过」。
const fetchLive = (path) =>
  new Promise((resolve) => {
    let tries = 1 + RETRY;
    let settled = false;
    let url = LIVE_BASE + path.split('/').map(encodeURIComponent).join('/');
    const finish = (r) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    const go = () => {
      if (settled) return;
      let req = null;
      const dead = setTimeout(() => {
        try { req && req.destroy(); } catch (e) {}
        finish({ err: '死线 ' + DEADLINE + 'ms 内没结论' });
      }, DEADLINE);
      const step = (err) => {
        clearTimeout(dead);
        if (settled) return;
        if (--tries > 0) return go();
        finish({ err });
      };
      req = request(url, { timeout: REQ_TIMEOUT, headers: { 'cache-control': 'no-cache' } }, (res) => {
        const loc = res.headers.location;
        if ((res.statusCode === 301 || res.statusCode === 302) && loc && tries-- > 1) {
          res.resume();
          url = new URL(loc, url).href;
          return go();
        }
        if (res.statusCode !== 200) {
          res.resume();
          return step('HTTP ' + res.statusCode);
        }
        const chunks = [];
        let got = 0;
        const want = Number(res.headers['content-length'] || 0);
        res.on('data', (c) => {
          chunks.push(c);
          got += c.length;
        });
        res.on('aborted', () => step('线上响应被截断（aborted，已收 ' + got + 'B）'));
        res.on('close', () => (want && got < want ? step('连接提前结束 ' + got + '/' + want + 'B') : undefined));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          clearTimeout(dead);
          if (want && buf.length !== want) return step('长度不符 ' + buf.length + '/' + want + 'B');
          finish({ sha: blobShaOfBytes(buf), len: buf.length });
        });
      });
      req.on('error', (e) => step(e.message));
      req.on('timeout', () => {
        req.destroy();
        step('无活动 ' + REQ_TIMEOUT + 'ms');
      });
      req.end();
    };
    go();
  });

const pool = async (items, worker) => {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(JOBS, items.length) }, async () => {
      while (true) {
        const k = i++;
        if (k >= items.length) break;
        out[k] = await worker(items[k], k);
      }
    })
  );
  return out;
};

const isDeployed = (p) =>
  /^js\/[^/]+\.js$/.test(p) ||
  /^css\/[^/]+\.css$/.test(p) ||
  p === 'index.html' ||
  p === 'sw.js' ||
  p === 'version.json' ||
  p === 'manifest.json' ||
  p === 'notice.json';

const batchNums = (revRange) => {
  const log = git(['log', '--format=%s', revRange], true) || '';
  const set = new Set();
  log.split('\n').forEach((line) => (line.match(/#\d{2,4}/g) || []).forEach((m) => set.add(m)));
  return [...set].sort();
};

const main = async () => {
  const head = git(['rev-parse', 'HEAD']);
  if (!head) {
    console.error('取不到 HEAD');
    process.exit(2);
  }
  console.log('本地 HEAD ' + short(head) + '  ' + (git(['log', '-1', '--format=%s'], true) || '').slice(0, 60));

  // ---- 1) git 层：远端 main 到底是哪个 sha（只认 ls-remote） ----
  let remote = opt('--base');
  let remoteSrc = '--base 指定';
  if (!remote) {
    const line = git(['ls-remote', 'origin', 'refs/heads/main'], true);
    if (!line) {
      console.error('⚠️ ls-remote 失败（离线或无权限）＝环境不满足，不做回归判定');
      process.exit(2);
    }
    remote = line.split('\t')[0].trim();
    remoteSrc = 'ls-remote origin/main';
  }
  console.log('远端 main ' + short(remote) + '（' + remoteSrc + '）');

  const notPushed = hasObj(remote) ? (git(['log', '--format=%h\t%s', remote + '..HEAD'], true) || '') : '';
  const notLocal = hasObj(remote) ? (git(['log', '--format=%h\t%s', 'HEAD..' + remote], true) || '') : '';
  if (!hasObj(remote)) console.log('⚠️ 远端那个 sha 本地没有对象（先 `git fetch`），git 层差集按未知处理');
  if (notLocal) {
    console.log('\n❌ 远端有 ' + notLocal.split('\n').length + ' 个提交本地没有（分叉，本地这份可能覆盖它）：');
    notLocal.split('\n').forEach((l) => console.log('   · ' + l.slice(0, 70)));
  }
  if (notPushed) {
    const n = notPushed.split('\n').length;
    console.log('\n❌ 有 ' + n + ' 个提交未进远端 main（＝用户拿不到）：');
    notPushed.split('\n').forEach((l) => console.log('   · ' + l.slice(0, 70)));
    console.log('   批次号：' + batchNums(remote + '..HEAD').join(' '));
  }
  if (!notPushed && !notLocal) console.log('✅ git 层：远端 main == HEAD（提交都在主干上）');

  if (has('--commits')) {
    process.exit(notPushed || notLocal ? 1 : 0);
  }

  // ---- 2) 产物层：HEAD 的产物 ↔ 线上产物，逐文件 blob sha 比对 ----
  let targets;
  if (has('--all')) {
    targets = (git(['ls-tree', '-r', '--name-only', 'HEAD'], true) || '').split('\n').filter(isDeployed);
  } else if (hasObj(remote)) {
    const changed = (git(['diff', '--name-only', remote + '..HEAD'], true) || '').split('\n').filter(Boolean);
    targets = changed.filter(isDeployed);
    const touchedSrc = changed.filter((p) => p.startsWith('src/'));
    if (!targets.length) {
      console.log('\n✅ HEAD 与远端 main 之间产物零差异 → 线上就是这个版本（要全量核对加 --all）');
      if (touchedSrc.length) console.log('   ⚠️ 但区间内有 ' + touchedSrc.length + ' 处 src/ 改动没带上产物（＝改完未构建），线上必然不含它们');
      process.exit(touchedSrc.length ? 1 : 0);
    }
    console.log('\n比对 HEAD↔远端 差异中的产物 ' + targets.length + ' 件（期望版本 = ' + EXPECT + '）：');
  } else {
    console.log('\n⚠️ 无本地可比基线，跳过产物层（用 --base=<已知 sha> 或 --all）');
    process.exit(notPushed || notLocal ? 1 : 0);
  }

  const T0 = Date.now();
  const results = await pool(targets, async (p) => {
    if (Date.now() - T0 > BUDGET) {
      return { p, want: blobOf(EXPECT, p), live: { err: '超出总时限 ' + BUDGET + 'ms（网络过慢）' } };
    }
    const want = blobOf(EXPECT, p);
    const live = await fetchLive(p);
    // 每件取回即打一行：慢链下十几秒不能是「整段静默」，否则跑的人无法分辨在等还是死了
    console.log('   … ' + p + ' ' + (live.err ? '取不到：' + live.err : live.len + 'B'));
    return { p, want, live };
  });

  let mismatch = 0;
  let netFail = 0;
  for (const r of results) {
    if (!r.want) {
      console.log('   ✗ ' + r.p + ' — HEAD 里没有该文件（不该出现）');
      mismatch++;
    } else if (r.live.err) {
      const four04 = r.live.err.startsWith('HTTP 404');
      console.log('   ' + (four04 ? '✗' : '!') + ' ' + r.p + ' — 线上取不到：' + r.live.err + (four04 ? '（线上缺件＝这个产物从未部署）' : ''));
      four04 ? mismatch++ : netFail++;
    } else if (r.live.sha === r.want) {
      console.log('   ✓ ' + r.p);
    } else {
      console.log('   ✗ ' + r.p + ' — 线上不是期望版（' + EXPECT + ' ' + short(r.want) + ' / 线上 ' + short(r.live.sha) + '，' + r.live.len + 'B）');
      mismatch++;
    }
  }

  // ---- 3) 工作树噪音：未提交改动会让「本地已验证」的结论对不上 HEAD ----
  const dirty = (git(['status', '--porcelain'], true) || '').split('\n').filter(Boolean).length;

  console.log('\n——— 结论 ———');
  const gitBad = Boolean(notPushed || notLocal);
  if (!mismatch && !gitBad && !netFail) {
    console.log('✅ 线上产物 == 本地 HEAD 产物（' + targets.length + ' 件逐字节相同），提交也都在远端 main 上');
  } else {
    if (gitBad) console.log('❌ git 层：有提交未进远端 main / 远端有本地没有的提交（见上）');
    if (mismatch) console.log('❌ ' + mismatch + '/' + targets.length + ' 件产物线上与 HEAD 不一致 → 这批修复还没到用户手上');
    if (netFail) console.log('! ' + netFail + ' 件因网络取不到（环境缺口，不算回归，复跑或加 --all）');
    if (mismatch) console.log('   处置：①没 push 就 push；②刚 push 则 GitHub Pages 有部署延时，等 1~2 分钟复跑；'
      + '③仍不一致＝线上是别的版本（分叉/回滚），按上面 ✗ 的文件逐个查');
  }
  if (dirty) console.log('   （注：工作树有 ' + dirty + ' 条未提交改动，它们既不在线上也不在 HEAD 里——别拿它们当「已修」）');
  process.exit(mismatch || gitBad ? 1 : netFail ? 2 : 0);
};

main().catch((e) => {
  console.error('门禁自身异常：' + (e && e.message));
  process.exit(2);
});
