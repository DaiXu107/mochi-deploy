// verify-suite 分类口径的反向对照：把「环境缺口 / 端口撞车 / 真断言失败」三类的边界钉死。
// 立项原因：初版 ENV_SIGS 里裸 ECONNREFUSED 会把并发时的本机 CDP 撞车报成「需要外网」，
// 等于用一条环境借口把不可信结果洗成不算回归 —— 这类误分类只能靠断言钉住。
// 用法：node tools/verify-suite-classify.mjs
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { envOf, suspectOf } from './lib/verify-classify.mjs';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

const LOCAL_REFUSED = 'Error: connect ECONNREFUSED 127.0.0.1:9923\n    at TCPConnectWrap.afterConnect';
const LOCAL_REFUSED_HOST = 'connect ECONNREFUSED ::1:9910';
const INUSE = 'Error: listen EADDRINUSE: address already in use 127.0.0.1:9910';
const NO_PW = "browserType.launch: Executable doesn't exist at ...\\webkit\\run\ntip: It looks like you launched a new browser version, please run: npx playwright install";
const NO_CHROME = '找不到 Chrome/Edge，请设置 CHROME_PATH 环境变量';
const REMOTE = 'fetch failed: getaddrinfo ENOTFOUND api.example.com';
const REAL_FAIL = 'FAIL  B2 每日上限应独立  [1]';

check('本机 CDP 连不上 → 判撞车，不算「需要外网」', /撞车/.test(suspectOf(LOCAL_REFUSED)) && envOf(LOCAL_REFUSED) === '', suspectOf(LOCAL_REFUSED) + ' / env=' + envOf(LOCAL_REFUSED));
check('IPv6 回环被拒同样算撞车', /撞车/.test(suspectOf(LOCAL_REFUSED_HOST)), suspectOf(LOCAL_REFUSED_HOST));
check('端口被占（EADDRINUSE）→ 判撞车', /端口被占/.test(suspectOf(INUSE)), suspectOf(INUSE));
check('playwright 未装 → 判环境缺口，不算撞车', envOf(NO_PW) === '浏览器未装（playwright）' && suspectOf(NO_PW) === '', envOf(NO_PW));
check('找不到 Chrome/Edge → 判环境缺口', envOf(NO_CHROME) === '找不到 Chrome/Edge', envOf(NO_CHROME));
check('远端域名解析失败 → 判需要外网（不误伤本机）', envOf(REMOTE) === '需要外网' && suspectOf(REMOTE) === '', envOf(REMOTE));
check('普通断言失败两类都不沾（仍算断言失败，不许被环境借口洗白）', envOf(REAL_FAIL) === '' && suspectOf(REAL_FAIL) === '');

// ---- 结构断言：runner 必须用同一份口径，且优先级/分桶正确 ----
const suite = readFileSync(join(root, 'tools', 'verify-suite.mjs'), 'utf8');
check('runner 从 lib/verify-classify.mjs 引入口径（不再内联一份）', /from '\.\/lib\/verify-classify\.mjs'/.test(suite) && !/const ENV_SIGS/.test(suite));
check('runner 先判撞车再判环境（撞车优先，否则本机问题会被环境借口吃掉）', /r\.suspect = suspectOf\(r\.out\); if \(!r\.suspect\) r\.env = envOf\(r\.out\);/.test(suite));
check('撞车项不计入断言失败', /!r\.killed && !r\.suspect && !r\.env && r\.code !== 0/.test(suite));
check('并发时集中分配空闲端口并下发 MOCHI_CDP_PORT', /MOCHI_CDP_PORT/.test(suite) && /createServer\(\)/.test(suite) && /listen\(0, '127\.0\.0\.1'/.test(suite));
check('如实报告有多少脚本读取了该 env（不读＝并发结论仍存疑）', /honoring/.test(suite) && /--jobs 1/.test(suite));

const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
process.exit(passed === results.length ? 0 : 1);
