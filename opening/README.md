# Triangle Bloom · 三角开花开屏

一段网页开屏动画：克莱因蓝的小点跳两下 → 撑开成一个细长的斜三角 → 屏幕沿三角的边切成七块，一块块翻面，藏在底色里的花在翻到对的颜色时露出来 → 外框收线 → 蓝和黑的墨点飞溅 → 沿着拼缝裂开 → 碎块掉落，露出底下的页面。

纯 HTML + CSS mask + [GSAP](https://gsap.com)，没有构建步骤，手机竖屏优先。

## 怎么跑

图片是用 `fetch` 读的，直接双击 `index.html`（`file://`）会被浏览器拦住，需要起一个本地静态服务器：

```bash
npx serve .
# 或
python -m http.server 8000
```

然后打开 `http://localhost:8000/`。

- 播放中点屏幕任意位置：跳过
- 播完再点：重放
- `?at=3.5`：停在第 3.5 秒那一帧（截图用）
- `?v=b`：三角外的花改成黑线
- `?flowers=fake`：不用 `flowers.png`，换成代码里画的临时花

## 换成你自己的花

花是两张遮罩图，画布比例和三角是同一套（931 × 2016）：

| 文件 | 作用 |
| --- | --- |
| `flowers.png` | 线稿：透明底，线条处不透明。线的颜色由代码决定（克莱因蓝 / 黑） |
| `flowers_fill.png` | 剪影：整朵花的填色区域，翻面时用来给花瓣上底色 |

用自己的线稿替换这两张同名文件即可。

## 嵌进你的页面

把这个文件夹当 iframe 盖在页面上，它会通过 `postMessage` 通知外层：

| 消息 `type` | 时机 |
| --- | --- |
| `between:opening-loading` | 开始下载素材（此时显示「等待中」） |
| `between:opening-ready` | 素材齐了，开始播放 |
| `between:opening-reveal` | 裂开、露出底下页面的那一刻，适合让主页开始自己的生长动画 |
| `between:opening-complete` | 播完，可以移除 iframe |
| `between:opening-error` | 素材加载失败 |

嵌入时 iframe 背景请先设成 `#0b0b0d`，否则下载阶段会透出底下的页面。

## 授权

- **代码**（`index.html`、`opening.js`）：MIT，见 `LICENSE`。
- **`flowers.png`、`flowers_fill.png`**：由可画（Canva）素材二次拼贴组合而成，**仅供非商业学习使用，请勿单独提取花朵线稿另作他用**。商用请换成你自己有授权的线稿。
- **`crack1.png`、`crack2.png`**：可商用素材。

## 作者

47 & baink
