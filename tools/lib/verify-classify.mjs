// verify 批量结果的「跑不动 vs 跑红了」判定口径，单独成模块是为了能被反向对照测试 import
// （写在 verify-suite.mjs 里就没法测，实测过裸 ECONNREFUSED 把本机 CDP 撞车误分成「需要外网」）。

// 并发跑时子进程可能抢同一个 CDP 端口：连不上本机 DevTools，或连到别人的浏览器。
export const SUSPECT_SIGS = [
  [/ECONNREFUSED[^\n]*127\.0\.0\.1|ECONNREFUSED[^\n]*localhost|ECONNREFUSED[^\n]*::1/i, '本机 CDP 连不上（可能端口撞车）'],
  [/EADDRINUSE|Failed to (bind|open)[^\n]{0,40}remote debugging|DevToolsActivePort/i, 'CDP 端口被占']
];

// 环境缺口：不算回归，装好浏览器/接上外网后复跑。
export const ENV_SIGS = [
  [/browserType\.launch|Executable doesn't exist|playwright install| Please run the following command/i, '浏览器未装（playwright）'],
  [/CHROME_PATH|找不到 (Chrome|Edge)|chrome\.exe.*not found|no running browser/i, '找不到 Chrome/Edge'],
  [/ENOTFOUND|EAI_AGAIN|getaddrinfo|Failed to fetch|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|network.*unreachable/i, '需要外网']
];

export const suspectOf = (out) => { for (const [re, why] of SUSPECT_SIGS) if (re.test(out)) return why; return ''; };
export const envOf = (out) => { for (const [re, why] of ENV_SIGS) if (re.test(out)) return why; return ''; };
