// 开屏动画：蓝点 → 三角 → 碎块翻面露花 → 线框收缩 → 溅墨 → 裂开 → 碎块掉落
// 克莱因蓝小点 → 扩成不规则三角 → 画面切成碎块，一块块翻面，花原本跟底色同色藏着，翻到对的颜色才露出来（拼魔方的感觉）
// → 丝线/子弹贯穿 → 溅蓝/黑的血 → 沿着拼缝裂开 → 碎块一块块掉下去，露出主页
// ?v=b：三角外的花用黑线（默认 A 版：里外都是克莱因蓝线）
// 花默认用 flowers.png（可画素材二次拼贴，见 README 授权说明）；?flowers=fake 换成 flowersSVG() 里临时画的那版
(async () => {
  const announce=type=>parent.postMessage({type},location.origin);
  // 制作者彩蛋：打开开发者工具的人会在控制台看到一只雪豹和一只鼠兔
  console.log(
    "%c   /\\_/\\          .--.\n  ( -.- )  ~~    ( •• )\n   > ^ <  ~~~     (  )o\n  snow leopard     pika\n\n%cmade by 47 & baink · BETWEEN US",
    "font:12px/1.35 monospace;color:#1834d4", "font:italic 12px Georgia,serif;color:#242522;letter-spacing:.08em"
  );
  // 先显示「等待中」，开屏素材和外层页面的图都下载完再开播，
  // 等待中盖住整屏（不然这层透明，下载时露出底下主页，看着像没开屏）
  const own = ['flowers.png?v=1023','flowers_fill.png?v=1023','crack1.png','crack2.png'];
  let home = [];
  try { home = [...new Set([...parent.document.querySelectorAll('image')].map(i => i.getAttribute('href')).filter(Boolean))].map(h => new URL(h, parent.location.href).href); } catch {}
  const ldN = document.getElementById('ld-n'); let done = 0; const total = own.length + home.length;
  const tick = () => { done++; if (ldN) ldN.textContent = String(done).padStart(2, '0') + ' / ' + String(total).padStart(2, '0'); };
  if (ldN) ldN.textContent = '00 / ' + String(total).padStart(2, '0');
  announce('between:opening-loading');
  const load = (src, must) => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => { tick(); resolve(); }; image.onerror = () => { tick(); must ? reject(new Error('Opening asset failed: ' + src)) : resolve(); }; image.src = src; });
  // 服务器给图片的是 no-store，Image() 预载完 CSS 遮罩还会再下一遍（手机上花就没赶上）——开屏自己的图拉成 blob，后面全用 blob 地址
  const blob = {};
  const grab = src => fetch(src).then(r => { if (!r.ok) throw new Error('Opening asset failed: ' + src); return r.blob(); }).then(b => { blob[src] = URL.createObjectURL(b); tick(); });
  await Promise.all([...own.map(grab), ...home.map(s => load(s, false))]);
  const U = src => blob[src] || src;
  document.documentElement.style.setProperty('--fill-url', `url("${U('flowers_fill.png?v=1023')}")`);
  const ld = document.getElementById('loading');
  if (ld) { ld.style.transition = 'opacity .35s'; ld.style.opacity = '0'; setTimeout(() => ld.remove(), 400); }
  const KLEIN = "#002fa7", BLACK = "#0b0b0d", WHITE = "#f3f1ec";
  const params = new URLSearchParams(location.search);
  // A 版：花线里外都是克莱因蓝；B 版：里蓝外黑
  const INV = !!params.get("inv");
  const INNER_LINE = KLEIN, OUTER_LINE = params.get("v") === "b" ? "#141416" : KLEIN;
  const stage = document.getElementById("stage");
  // 高度取「地址栏收起时」的最大视口（100lvh），免得收起后底下露一条
  const probe = document.body.appendChild(Object.assign(document.createElement("div"), { style: "position:fixed;top:0;height:100lvh;width:1px;visibility:hidden" }));
  const W = innerWidth, H = Math.max(innerHeight, probe.offsetHeight);
  probe.remove();
  // 舞台钉死成开场那一刻的尺寸：手机地址栏收放会改 innerHeight，碎块的裁切和描边/裂纹不跟着变就会错位
  Object.assign(stage.style, { width: W + "px", height: H + "px", right: "auto", bottom: "auto" });
  const P = (x, y) => [x * W, y * H];
  let seed = 47;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const R = (a, b) => a + (b - a) * rnd();

  // ── 构图：以屏幕中心为重心的细长斜三角，三条边延长到屏幕边，把屏幕切成七块 ──
  // 三个角离重心的方向：-84° / 66° / 171°（夹角 150° 105° 105°），重心落在正中心时三条臂长正好是 1 : 1 : 2sin15°(≈0.518)
  // 三条边延长到屏幕边，把屏幕切成七块
  const R0 = .46 * W, V = (deg, l) => [W / 2 + Math.cos(deg * Math.PI / 180) * R0 * l, H / 2 + Math.sin(deg * Math.PI / 180) * R0 * l];
  const A = V(-84, 1), B = V(66, 1), C = V(171, 2 * Math.sin(Math.PI / 12)), O = [W / 2, H / 2];
  const centroid = pts => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  function cut(poly, p, q, keep) {     // 用直线 pq 切多边形，留 keep 那一侧
    const out = [];
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length], sa = side(p, q, a) * keep, sb = side(p, q, b) * keep;
      if (sa >= 0) out.push(a);
      if ((sa >= 0) !== (sb >= 0)) { const t = sa / (sa - sb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    });
    return out;
  }
  let pieces = [[[0, 0], [W, 0], [W, H], [0, H]]];
  [[A, B], [B, C], [C, A]].forEach(([p, q]) => {
    pieces = pieces.flatMap(pl => [cut(pl, p, q, 1), cut(pl, p, q, -1)]).filter(pl => pl.length > 2);
  });
  const inTri = pt => [[A, B], [B, C], [C, A]].every(([p, q]) => side(p, q, pt) * side(p, q, [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3]) > 0);
  const facets = pieces.map(pts => ({ pts, inside: inTri(centroid(pts)) }));
  const poly = pts => `polygon(${pts.map(p => `${p[0]}px ${p[1]}px`).join(",")})`;

  // ── 临时的花：几朵线描的重瓣花＋叶子，堆在三角的边上，一半在里一半在外 ──
  function flower(cx, cy, r, rot) {
    let s = "";
    for (const [layer, k] of [[0, 1], [1, .68]]) {
      const n = layer ? 7 : 9;
      for (let i = 0; i < n; i++) {
        const a = rot + (i + layer * .5) / n * Math.PI * 2;
        const tip = [cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k];
        const w = .42 * r * k;
        const c1 = [cx + Math.cos(a - .38) * r * k * .7, cy + Math.sin(a - .38) * r * k * .7];
        const c2 = [cx + Math.cos(a + .38) * r * k * .7, cy + Math.sin(a + .38) * r * k * .7];
        const notch = [cx + Math.cos(a) * (r * k - w * .25), cy + Math.sin(a) * (r * k - w * .25)];
        s += `<path d="M${cx},${cy} Q${c1} ${tip[0] - Math.sin(a) * w * .3},${tip[1] + Math.cos(a) * w * .3} L${notch} L${tip[0] + Math.sin(a) * w * .3},${tip[1] - Math.cos(a) * w * .3} Q${c2} ${cx},${cy}"/>`;
        s += `<path d="M${cx + Math.cos(a) * r * .25},${cy + Math.sin(a) * r * .25} L${cx + Math.cos(a) * r * k * .7},${cy + Math.sin(a) * r * k * .7}" stroke-width="1"/>`;
      }
    }
    s += `<circle cx="${cx}" cy="${cy}" r="${r * .2}"/>`;
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; s += `<circle cx="${cx + Math.cos(a) * r * .13}" cy="${cy + Math.sin(a) * r * .13}" r="1.6" fill="#000"/>`; }
    return s;
  }
  function leaf(x, y, len, a) {
    const t = [x + Math.cos(a) * len, y + Math.sin(a) * len], n = [-Math.sin(a) * len * .28, Math.cos(a) * len * .28];
    const m = [(x + t[0]) / 2, (y + t[1]) / 2];
    return `<path d="M${x},${y} Q${m[0] + n[0]},${m[1] + n[1]} ${t} Q${m[0] - n[0]},${m[1] - n[1]} ${x},${y} M${x},${y} L${t}" />`;
  }
  function flowersSVG() {
    const u = Math.min(W, H);
    const blooms = [
      [B[0] - u * .16, B[1] + u * .06, u * .17, .2],
      [(A[0] + B[0]) / 2 - u * .05, (A[1] + B[1]) / 2 - u * .02, u * .13, 1.1],
      [O[0] + u * .02, O[1] + u * .1, u * .19, .6],
      [(A[0] + C[0]) / 2 - u * .08, (A[1] + C[1]) / 2 + u * .02, u * .15, 2.0],
      [C[0] - u * .1, C[1] - u * .1, u * .14, .9],
    ];
    let s = "";
    blooms.forEach(([x, y, r, rot]) => {
      s += leaf(x, y, r * 1.6, rot + 2.4) + leaf(x, y, r * 1.3, rot - .9);
    });
    blooms.forEach(([x, y, r, rot]) => (s += flower(x, y, r, rot)));
    s += leaf(C[0] + u * .02, C[1] - u * .02, u * .2, 1.2) + leaf(A[0] + u * .05, A[1] + u * .05, u * .18, 3.6);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><g fill="none" stroke="#000" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${s}</g></svg>`;
  }
  // 花：线稿遮罩 flowers.png（画布 931×2016，与三角同一套比例）；?flowers=fake 用上面临时画的
  document.documentElement.style.setProperty("--flowers", params.get("flowers") === "fake"
    ? `url("data:image/svg+xml,${encodeURIComponent(flowersSVG())}")` : `url("${U('flowers.png?v=1023')}")`);

  // ── 子弹的落点、溅血、裂纹（每一块里都放一份同样的，掉的时候跟着这块一起掉） ──
  const hits = [P(.5, .44), P(.57, .6), P(.38, .53)];
  function splats() {
    let s = "";
    hits.forEach(([x, y], i) => {
      const dir = [-.5, .35, -.2][i];
      const col = () => (rnd() < .72 ? KLEIN : "#050507");
      let g = "";
      for (let k = 0; k < 9; k++) g += `<circle cx="${x + R(-14, 14)}" cy="${y + R(-14, 14)}" r="${R(5, 17)}" fill="${col()}"/>`;
      for (let ray = 0; ray < 14; ray++) {
        const a = dir + R(-1.4, 1.4) + (ray % 3 === 0 ? Math.PI : 0), far = R(30, 120);
        for (let t = 0; t < 4; t++) {
          const d = far * (.35 + t * .22);
          g += `<circle cx="${x + Math.cos(a) * d}" cy="${y + Math.sin(a) * d}" r="${R(1, 5.5) * (1 - t * .18)}" fill="${col()}"/>`;
        }
      }
      for (let k = 0; k < 3; k++) {     // 往下淌的
        const dx = x + R(-12, 12), len = R(20, 70);
        g += `<path d="M${dx},${y} L${dx + R(-2, 2)},${y + len}" stroke="${KLEIN}" stroke-width="${R(2, 4)}" stroke-linecap="round"/>`;
      }
      s += `<g class="splat" data-i="${i}">${g}</g>`;
    });
    // 制作者彩蛋：第二滴墨的墨心里闪过一行极小的署名，只停零点几秒
    const [sx, sy] = hits[1];
    s += `<text class="sig" x="${sx}" y="${sy + 2}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="6" letter-spacing=".4" fill="#f3f1ec" opacity="0">47 &amp; baink</text>`;
    return s;
  }
  const SPLAT = splats();
  // 裂纹：不发光；一段一段画，越往外越细越淡；
  // 只沿三角的边裂＋从落点往外炸（放射线＋一圈圈蛛网），延长线那几条不裂
  function cracks() {
    let s = "";
    const seg = (x1, y1, x2, y2, w, o) =>
      `<path class="seam" d="M${x1},${y1} L${x2},${y2}" stroke="rgba(18,30,70,${o * .45})" stroke-width="${w + .9}"/>` +
      `<path class="seam" d="M${x1},${y1} L${x2},${y2}" stroke="rgba(228,234,255,${o})" stroke-width="${w}"/>`;
    [[A, B], [B, C], [C, A]].forEach(([p, q]) => {
      let [x, y] = p;
      for (let t = 1; t <= 14; t++) {
        const nx = p[0] + (q[0] - p[0]) * t / 14 + (t < 14 ? R(-2.5, 2.5) : 0), ny = p[1] + (q[1] - p[1]) * t / 14 + (t < 14 ? R(-2.5, 2.5) : 0);
        s += seg(x, y, nx, ny, R(.5, 1.1), R(.55, .85));
        x = nx; y = ny;
      }
    });
    hits.forEach(([hx, hy]) => {
      const n = 9, spokes = [];
      for (let k = 0; k < n; k++) {
        let a = (k / n) * Math.PI * 2 + R(-.25, .25), x = hx, y = hy, w = 1.3, o = .9;
        const len = R(70, 240), pts = [[x, y]];
        for (let d = 0; d < len; d += R(10, 22)) {
          a += R(-.18, .18);
          const nx = x + Math.cos(a) * R(10, 22), ny = y + Math.sin(a) * R(10, 22);
          s += seg(x, y, nx, ny, w, o);
          if (rnd() < .18) {            // 小岔
            const b = a + R(.5, 1) * (rnd() < .5 ? 1 : -1), bl = R(8, 26);
            s += seg(nx, ny, nx + Math.cos(b) * bl, ny + Math.sin(b) * bl, w * .55, o * .7);
          }
          x = nx; y = ny; w = Math.max(.3, w * .86); o = Math.max(.25, o * .93);
          pts.push([x, y]);
        }
        spokes.push(pts);
      }
      // 蛛网：相邻两根放射线之间，隔一段连一下
      [2, 4, 7].forEach(r => spokes.forEach((sp, k) => {
        const nx = spokes[(k + 1) % n], a = sp[Math.min(r, sp.length - 1)], b = nx[Math.min(r, nx.length - 1)];
        if (rnd() < .7) s += seg(a[0], a[1], (a[0] + b[0]) / 2 + R(-4, 4), (a[1] + b[1]) / 2 + R(-4, 4), .5, .6) + seg((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, b[0], b[1], .5, .5);
      }));
    });
    return s;
  }
  const CRACK = params.get("mycrack") ? cracks() : "";
  // 两张裂纹图（透明底）：各对准一个落点，从落点一圈圈露出来；hub＝图里裂纹汇聚处的位置比例
  // 原图 1260 宽，只放到 1.1 倍屏宽，手机上接近一比一，避免放大发糊
  const CRACKS = [{ src: U("crack1.png"), hit: 0, hub: [.52, .5], w: 1.1, ar: 1684 / 1260 }, { src: U("crack2.png"), hit: 1, hub: [.62, .42], w: 1.1, ar: 1712 / 1260 }];
  const CRACK_IMGS = CRACKS.map((c, k) => {
    const [hx, hy] = hits[c.hit], w = W * c.w, h = w * c.ar;
    return `<div class="crk" style="--cx:${hx}px;--cy:${hy}px;--r:var(--r${k})"><img src="${c.src}" style="left:${hx - c.hub[0] * w}px;top:${hy - c.hub[1] * h}px;width:${w}px"></div>`;
  }).join("");
  const RIM = (() => {
    const tri = [A, B, C].map(String).join(" ");
    // 碎块之间不描边，靠色块本身区分
    return params.get("rim") ? `<polygon class="rim" points="${tri}" fill="none" stroke="${KLEIN}" stroke-width="2"/>` : "";
  })();

  // ── 搭碎块 ──
  facets.forEach((f, i) => {
    const el = document.createElement("div");
    el.className = "facet" + ((INV ? !f.inside : f.inside) ? " dark" : "");   // 最后是黑底的块：裂纹要提亮
    const [cx, cy] = centroid(f.pts);
    // 每块往外撑 1.2px 跟邻居叠一点，拼缝就不会漏出细线
    el.style.clipPath = poly(f.pts.map(([x, y]) => { const d = Math.hypot(x - cx, y - cy) || 1; return [x + (x - cx) / d * 1.2, y + (y - cy) / d * 1.2]; }));
    el.style.transformOrigin = `${cx}px ${cy}px`;
    el.innerHTML = `<div class="card" style="transform-origin:${cx}px ${cy}px"><div class="face"></div><div class="fill"></div><div class="art"></div>
      <svg class="decal" viewBox="0 0 ${W} ${H}"><defs><filter id="glow${i}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      <g class="rims">${RIM}</g><g class="splats">${SPLAT}</g>
      <g class="cracks" fill="none" stroke-linecap="round">${CRACK}</g></svg></div>`;
    f.el = el; f.card = el.firstElementChild; f.c = [cx, cy];
    paint(f, BLACK, BLACK);
    stage.appendChild(el);
  });
  function paint(f, bg, line, fill = bg) { f.card.style.setProperty("--bg", bg); f.card.style.setProperty("--line", line); f.card.style.setProperty("--fill", fill); }

  // 裂纹只放一层（不再每块碎片里各叠一份）：底下一层整屏，上面一层只裁三角那块，黑底那边的提亮成浅蓝
  const crackWrap = document.createElement("div");
  crackWrap.id = "cracks";
  // 黑底上用原图的亮蓝；只有反色版三角里的蓝块上才提成白
  crackWrap.innerHTML = `<div class="cl">${CRACK_IMGS}</div><div class="cl${INV ? "" : " bright"}" style="clip-path:${poly([A, B, C])}">${CRACK_IMGS}</div>`;
  stage.appendChild(crackWrap);

  const grow = document.createElement("div");
  grow.id = "grow";
  const dot = document.createElement("div");
  dot.id = "dot";
  const [gx, gy] = centroid([A, B, C]);
  dot.style.left = gx + "px"; dot.style.top = gy + "px";
  stage.append(grow, dot);
  const tiny = poly([A, B, C].map(() => [gx, gy]));
  grow.style.clipPath = tiny;

  // 外置线框：翻面完成后收缩成一个点，点落下处溅墨
  // 三角外面一圈，三条边分开画：开局一条接一条描出来；翻完以后整个框等比缩成一个点，溅血
  const FR = Math.min(W, H) * .045;
  const outer = [A, B, C].map(([x, y]) => { const d = Math.hypot(x - gx, y - gy); return [x + (x - gx) / d * FR, y + (y - gy) / d * FR]; });
  const edges = [[outer[0], outer[1]], [outer[1], outer[2]], [outer[2], outer[0]]];
  const svgLayer = (inner, clip) => {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", `0 0 ${W} ${H}`);
    Object.assign(s.style, { position: "absolute", inset: 0, width: W + "px", height: H + "px", pointerEvents: "none", overflow: "visible", clipPath: clip || "none" });
    s.innerHTML = inner;
    stage.appendChild(s);
    return s;
  };
  // 线框跟着碎块走：每块放一份（裁成那块的形状），哪块翻到露花，那块里的线才藏到花底下
  // → 线框每块碎片各放一份（裁成那块的形状），哪块翻到露花那一下，那块里的线才钻到花底下
  const FRAME = `<g class="frg">${edges.map(([p, q]) => `<path class="fr" d="M${p} L${q}" fill="none" stroke="${KLEIN}" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`).join("")}</g>`;
  facets.forEach(f => (f.frame = svgLayer(FRAME, f.el.style.clipPath)));
  const frDot = svgLayer(`<circle r="4" fill="${KLEIN}" opacity="0"/>`).firstElementChild;
  const frPaths = [...stage.querySelectorAll(".fr")], frG = [...stage.querySelectorAll(".frg")];
  // 线框收缩时的残影（时间隧道）：缩的路上每隔一段留一圈框，慢慢淡掉、往里缩一点
  const GHOSTS = 8;
  const ghostLayer = svgLayer(Array.from({ length: GHOSTS }, () => FRAME.replace('class="frg"', 'class="ghost"').replaceAll(`stroke="${KLEIN}" stroke-width="2"`, 'stroke="#a9bdff" stroke-width="3.2"')).join(""));   // 残影缩进蓝三角里，克莱因蓝看不见，用浅蓝
  const ghosts = [...ghostLayer.querySelectorAll(".ghost")];
  gsap.set(ghosts, { opacity: 0 });
  // 花露出来以后，线在花的剪影里挖掉，看着像压在花下面
  const underFlowers = el => Object.assign(el.style, {
    webkitMask: `linear-gradient(#000,#000), url("${U('flowers_fill.png?v=1023')}") 0 0 / 100% 100% no-repeat`, webkitMaskComposite: "xor",
    mask: `linear-gradient(#000,#000), url("${U('flowers_fill.png?v=1023')}") 0 0 / 100% 100% no-repeat`, maskComposite: "exclude" });
  frPaths.forEach(p => { const L = p.getTotalLength(); p.style.strokeDasharray = L; p.style.strokeDashoffset = L; });

  // 描边线和裂纹先藏好：用 dash 一点点画出来
  document.querySelectorAll(".rim, .seam").forEach(p => {
    const L = p.getTotalLength ? p.getTotalLength() : 2000;
    p.style.strokeDasharray = L; p.style.strokeDashoffset = L;
  });
  gsap.set(".splat", { scale: 0, transformOrigin: "50% 50%" });
  document.querySelectorAll(".splat").forEach(g => { const [x, y] = hits[g.dataset.i]; gsap.set(g, { svgOrigin: `${x} ${y}` }); });

  // ── 翻一下：转到侧面那一刻换颜色，再转回来 ──
  function flip(tl, f, at, [bg, line, fill], s) {
    // 不用 3D 翻转，改成平面压扁再弹开（移动端 3D＋整屏遮罩容易闪）
    // 各块几乎同时起步、顺序打乱，每次翻的快慢各不相同；s＝慢几倍
    const axis = rnd() < .5 ? "scaleX" : "scaleY", d1 = .38 * s;
    tl.to(f.card, { [axis]: 0, duration: d1, ease: "power2.in" }, at)
      .add(() => { paint(f, bg, line, fill); if (fill) underFlowers(f.frame); }, at + d1)   // 露花这一翻，线才钻到花下面
      .fromTo(f.card, { [axis]: 0 }, { [axis]: 1, duration: .5 * s, ease: "power2.out", immediateRender: false }, at + d1);
  }

  const tl = gsap.timeline({ delay: .3 });
  // 节奏：片段之间快慢对比
  // 有的片段匀速、有的片段快，对比在片段之间，不在同一个效果里面
  // → 一段之内速度一致，段和段之间慢、快交替：点（慢）→ 三角（快）→ 描框（慢）→ 翻（快）→ 定住 → 收框（慢）→ 溅、裂、掉（快）
  // 开局：小球跳两下，第二下落地扩散成三角
  const HOP = Math.min(W, H) * .09;
  tl.to(dot, { scale: 1, duration: .3, ease: "back.out(2)" });
  [1, .6].forEach(k => tl.to(dot, { y: -HOP * k, scaleY: 1.12, scaleX: .9, duration: .2 * Math.sqrt(k), ease: "power2.out" })
    .to(dot, { y: 0, scaleY: 1, scaleX: 1, duration: .2 * Math.sqrt(k), ease: "power2.in" })
    .to(dot, { scaleY: .7, scaleX: 1.25, duration: .06, yoyo: true, repeat: 1, ease: "power1.out" }));   // 落地压扁一下
  tl.addLabel("tri", "-=.06")
    .to(dot, { scale: 0, duration: .12, ease: "none" }, "tri")
    .to(grow, { clipPath: poly([A, B, C]), duration: .22, ease: "power2.out" }, "tri")
    .to(document.querySelectorAll(".rim"), { strokeDashoffset: 0, duration: .6, ease: "power2.out", stagger: .05 }, "tri+=.25");
  // 描框：三条边一样的速度，匀匀地一条接一条描一圈（每块碎片里那份同一条边同时画）
  const elen = edges.map(([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1])), SPEED = elen.reduce((a, b) => a + b) / .8;   // 画线速度：三条边总长 0.8 秒画完
  let et = .25;
  elen.forEach((L, e) => {
    tl.to(frPaths.filter((_, i) => i % 3 === e), { strokeDashoffset: 0, duration: L / SPEED, ease: "none" }, "tri+=" + et);
    et += L / SPEED;
  });
  tl.add(() => { facets.filter(f => f.inside).forEach(f => paint(f, KLEIN, KLEIN)); grow.remove(); dot.remove(); });

  // 里面：蓝 → 白（花还藏着）→ 黑底，花是克莱因蓝整块、黑线勾在里面；外面：黑 → 蓝 → 白底蓝线。节奏错开，像拧魔方
  let t0 = tl.duration() + .15;
  // 不按一圈的顺序排队：七块几乎一起起步，先后打乱，第二翻的间隔也各不相同，所以两轮的先后顺序不一样
  const order = facets.map((_, i) => i).sort(() => rnd() - .5);
  facets.forEach((f, i) => {
    // ?inv=1：里外黑白反过来，两色（墨＋纸）
    // 不反的那版：克莱因蓝块里纸色的花，线就是那块蓝（线和色块永远同色）
    const ink = INV ? BLACK : KLEIN;
    const first = f.inside ? [WHITE, WHITE] : [ink, ink];
    const last = f.inside ? [ink, ink, WHITE] : [WHITE, ink, WHITE];
    // 约一半的块中途多翻一两下，经过别的纯色再落到带花那面
    const pool = INV ? [KLEIN, WHITE, BLACK] : [KLEIN, WHITE];
    const steps = [first];
    for (let k = rnd() < .55 ? (rnd() < .5 ? 1 : 2) : 0; k > 0; k--) {
      const prev = steps[steps.length - 1][0], c = pool.filter(x => x !== prev);
      const bg = c[Math.floor(rnd() * c.length)];
      steps.push([bg, bg]);
    }
    steps.push(last);
    // 这一段整段都快：七块一起翻完
    let at = t0 + order[i] * .04 + R(0, .06);
    steps.forEach(st => { flip(tl, f, at, st, R(.5, .6)); at += R(.26, .34); });
  });

  // 收线：整个三角框朝第一个落点等比缩成一个点，点一落就溅墨，另外两处跟着炸开
  // 翻完先定住一拍；这一段慢：匀速地缩
  let t1 = tl.duration();   // 翻完不停顿，线框立即开始收缩（收缩时花是可见的）
  const [fx, fy] = hits[0], SH = .7;
  stage.append(ghostLayer); underFlowers(ghostLayer);   // 在碎块上面，但在花的剪影里挖掉，看着压在花底下
  ghosts.forEach((g, k) => {
    const p = k / GHOSTS, at = t1 + SH * p, sc = 1 - p;
    tl.set(g, { scale: sc, svgOrigin: `${fx} ${fy}`, opacity: 1 - p * .3 }, at)
      .to(g, { opacity: 0, scale: sc * .6, svgOrigin: `${fx} ${fy}`, duration: .35, ease: "power2.out" }, at);
  });
  tl.to(frG, { scale: 0, svgOrigin: `${fx} ${fy}`, duration: SH, ease: "none" }, t1)
    .set(frDot, { attr: { cx: fx, cy: fy }, opacity: 1 }, t1 + SH)
    .to(frDot, { attr: { r: 10 }, opacity: 0, duration: .25, ease: "expo.out" }, t1 + SH);
  hits.forEach((_, i) => {
    const at = t1 + SH + i * .07;
    if (i === 1) tl.to(".sig", { opacity: 1, duration: .03 }, at + .08).to(".sig", { opacity: 0, duration: .1 }, at + .34);
    tl.to(`.splat[data-i="${i}"]`, { scale: 1, duration: .12, ease: "expo.out" }, at)
      .to(stage, { x: R(-8, 8), y: R(-8, 8), duration: .04, yoyo: true, repeat: 1 }, at);
  });

  // 裂：溅完血定格一瞬，再一下裂开
  let t2 = tl.duration() + .1;
  CRACKS.forEach((c, k) => tl.fromTo(stage, { ["--r" + k]: "0px" }, { ["--r" + k]: Math.hypot(W, H) + "px", duration: .6, ease: "power2.out", immediateRender: true }, t2 + k * .08));   // 裂纹从落点往外爬，跟溅墨同属快的一段
  tl.to(document.querySelectorAll(".seam"), { strokeDashoffset: 0, duration: .35, ease: "power2.out", stagger: { amount: .2, from: "random" } }, t2);

  // 掉：离第一个落点近的先掉
  let t3 = t2 + .6;   // 裂快爬满就开始掉
  // 外层页面在玻璃掉落过半时开始长（七块各掉 .75s、间隔 .05s，全掉完约 t3+1.05）
  tl.call(()=>announce("between:opening-reveal"),[],t3 + .6).set("#home", { opacity: 1 }, t3).to(crackWrap, { opacity: 0, duration: .3 }, t3);
  const [hx, hy] = hits[0];
  facets.map(f => ({ f, d: Math.hypot(f.c[0] - hx, f.c[1] - hy) })).sort((a, b) => a.d - b.d).forEach(({ f }, k) => {
    tl.to(f.el, { y: H * 1.25, x: R(-50, 50), rotation: R(-35, 35), duration: .75, ease: "power3.in" }, t3 + k * .05);
  });

  // 嵌在别的页面里（iframe）：点＝跳过，播完通知外层；单独打开：播的时候点＝跳过，播完再点＝重放
  const embedded = parent !== window;
  document.body.addEventListener("click", () => (tl.progress() < 1 || embedded ? tl.progress(1) : location.reload()));
  tl.eventCallback("onComplete", () => {
    announce("between:opening-complete");
    if (!embedded) document.getElementById("skip").textContent = "点一下再看一遍 / REPLAY";
  });
  announce("between:opening-ready");
  // 截图用：?at=秒 停在那一刻
  if (params.get("at")) { tl.pause(); tl.seek(+params.get("at"), false); document.title = "dur " + tl.duration().toFixed(2); }
})().catch(error=>{console.error(error);parent.postMessage({type:"between:opening-error"},location.origin);});
