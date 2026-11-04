import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const PALETTE = ['#e8b86d', '#8fb6d9', '#a8c7a0', '#d9a3b8', '#b9a6d9', '#e0a07a', '#7fc8c1', '#d6cf9a'];
const USER_SCALE = 0.85;
const HEAD_LOCAL_Y = 1.6;
const PILLOW_OFFSET = 2.13;
const WALK_SPEED = 1.05;
const CLIMB_SPEED = 1.0;
const NOTE_COLORS = ['#fbfbfa', '#f0f0ee', '#e6e6e3', '#f7f7f5', '#ebebe8'];
const NOTE_ROTS = ['-1.6deg', '1.2deg', '-0.8deg', '1.8deg', '-1.1deg'];
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const $ = (s) => document.querySelector(s);
const els = {
  stage: $('#stage'),
  labels: $('#labels'),
  roomEyebrow: $('#roomEyebrow'),
  clockText: $('#clockText'),
  playDot: $('#playDot'),
  clockBtn: $('#clockBtn'),
  monitorBadge: $('#monitorBadge'),
  scrubTime: $('#scrubTime'),
  noteBtn: $('#noteHotspot'),
  menuBtn: $('#menuBtn'),
  peopleStrip: $('#peopleStrip'),
  hint: $('#hint'),
  camTime: $('#camTime'),
  loader: $('#loader'),
  loadText: $('#loadText'),
  loadBar: $('#loadBar'),
  sheetRoot: $('#sheetRoot'),
  toast: $('#toast')
};

const q = new URLSearchParams(location.search);
const embed = q.get('embed') === '1';
if (embed) document.body.classList.add('embed');
const srSafeTop = parseFloat(q.get('safetop'));
const srSafeBottom = parseFloat(q.get('safebot'));
if (Number.isFinite(srSafeTop) && srSafeTop > 0) document.documentElement.style.setProperty('--sr-safe-top', srSafeTop + 'px');
if (Number.isFinite(srSafeBottom) && srSafeBottom > 0) document.documentElement.style.setProperty('--sr-safe-bottom', srSafeBottom + 'px');
const embedBack = document.getElementById('embedBack');
if (embed && embedBack) {
  embedBack.hidden = false;
  embedBack.addEventListener('click', () => {
    if (window.parent !== window) {
      try { window.parent.postMessage({ type: 'mochi:sleeproom-close' }, location.origin); } catch (e) {}
    } else {
      history.back();
    }
  });
}
const forcedTime = parseClock(q.get('time'));
const startTime = forcedTime == null ? nowMinutes() : forcedTime;
const triadDemo = q.get('demo') === 'triad';
const state = {
  mode: (q.get('mode') === 'group' || triadDemo) ? 'group' : 'single',
  demoTriad: triadDemo,
  time: startTime,
  live: forcedTime == null,
  monitoring: forcedTime != null,
  liveTimer: null,
  follow: 60,
  recolorProb: 40,
  selected: 'him',
  painting: null,
  notes: [
    { id: 'n1', who: 'him', text: '出门记得带伞。', at: (startTime - 16 + 1440) % 1440 },
    { id: 'n2', who: 'me', text: '晚上早点回来。', at: (startTime - 5 + 1440) % 1440 }
  ],
  noteSeq: 3,
  toastTimer: null,
  userPhase: 'here',
  userPhaseAt: 0,
  contactBucket: -1,
  cuddleBucket: -1,
  sleepBeganAt: 0,
  userSleepSide: 0,
  userSleepManual: null,
  userBedSide: -1
};
state.uiTheme = readStored('mochi3d.uiTheme', 'auto');
state.sleepLog = loadSleepLog();
let calCursor = new Date();
calCursor.setDate(1);
const timerState = {
  sleepRunning: false,
  sleepStart: 0,
  sleepBed: 0,
  sleepDate: '',
  elapsed: 0,
  loop: null
};
const savedSleepTimer = readStored('mochi3d.sleepTimer.v1', null);
if (savedSleepTimer && savedSleepTimer.start) {
  timerState.sleepRunning = true;
  timerState.sleepStart = savedSleepTimer.start;
  timerState.sleepBed = savedSleepTimer.bed;
  timerState.sleepDate = savedSleepTimer.date;
  timerState.elapsed = Math.max(0, Math.floor((Date.now() - savedSleepTimer.start) / 1000));
  state.userPhase = 'sleep';
  state.userPhaseAt = Date.now();
  state.sleepBeganAt = Date.now();
  state.live = true;
  state.monitoring = false;
  state.time = nowMinutes();
  ensureTimerLoop();
}
if (state.demoTriad) {
  state.userPhase = 'sleep';
  state.userPhaseAt = 0;
  state.sleepBeganAt = 0;
  state.userSleepSide = 0;
  state.monitoring = false;
}

const peopleDefs = {
  me: { id: 'me', name: '我', color: '#e8b86d', me: true, follow: 100, sleep: hours(23, 0, 1, 2, 3, 4, 5, 6) },
  him: { id: 'him', name: '他', color: '#8fb6d9', me: false, follow: 60, sleep: hours(23, 0, 1, 2, 3, 4, 5, 6) },
  xiaoman: { id: 'xiaoman', name: '小满', color: '#d9a3b8', me: false, follow: 60, sleep: hours(23, 0, 1, 2, 3, 4, 5, 6, 13) }
};
const embedMeName = (q.get('me') || '').trim().slice(0, 12);
const embedPartnerName = (q.get('name') || '').trim().slice(0, 12);
const embedPartnerColor = (q.get('color') || '').trim();
if (embedMeName) peopleDefs.me.name = embedMeName;
if (embedPartnerName) peopleDefs.him.name = embedPartnerName;
if (/^#[0-9a-f]{6}$/i.test(embedPartnerColor)) peopleDefs.him.color = embedPartnerColor;
Object.values(peopleDefs).forEach((p) => {
  p.state = 'idle';
  p.fade = 1;
  p.mounting = false;
  p.sittingDown = false;
  p.getUp = 0;
  p.riseHipY0 = 0;
  p.riseHipY1 = 0;
  p.sitSide = 0;
});

function hours(...list) { return new Set(list); }
function nowMinutes() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
function parseClock(value) {
  if (!value) return null;
  const m = String(value).match(/^(\d{1,2}):(\d{2})$/);
  if (m) return ((parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) % 1440 + 1440) % 1440;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? ((n % 1440) + 1440) % 1440 : null;
}
function dateStamp() {
  return dateKey(new Date());
}
function dateKey(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function formatDuration(mins) {
  const m = Math.max(0, Math.round(mins));
  return Math.floor(m / 60) + 'h' + pad(m % 60);
}
function durationText(mins) {
  const m = Math.max(0, Math.round(mins));
  return Math.floor(m / 60) + ' 小时 ' + pad(m % 60) + ' 分';
}
function formatSeconds(total) {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return (h ? pad(h) + ':' : '') + pad(m) + ':' + pad(sec);
}
function loadSleepLog() {
  const saved = readStored('mochi3d.sleepLog.v1', null);
  if (saved && typeof saved === 'object') return saved;
  const out = {};
  const today = new Date();
  for (let i = 1; i <= 7; i++) {
    const d = addDays(today, -i);
    const bed = 22 * 60 + 35 + ((i * 17) % 55);
    const duration = 430 + ((i * 23) % 75);
    out[dateKey(d)] = { bed, wake: (bed + duration) % 1440, duration, source: 'seed' };
  }
  writeStored('mochi3d.sleepLog.v1', out);
  return out;
}
function saveSleepLog() {
  writeStored('mochi3d.sleepLog.v1', state.sleepLog);
}
function readStored(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch (_) {
    return fallback;
  }
}
function writeStored(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* ignore */ }
}
function removeStored(key) {
  try { localStorage.removeItem(key); } catch (_) { /* ignore */ }
}
function effectiveUiTheme() {
  if (state.uiTheme === 'day' || state.uiTheme === 'night') return state.uiTheme;
  const h = new Date().getHours();
  return h >= 6 && h < 18 ? 'day' : 'night';
}
function applyUiTheme() {
  document.body.classList.toggle('ui-day', effectiveUiTheme() === 'day');
}
function peopleList() { return state.mode === 'group' ? [peopleDefs.me, peopleDefs.him, peopleDefs.xiaoman] : [peopleDefs.me, peopleDefs.him]; }
function personById(id) { return peopleDefs[id]; }
function pad(n) { return String(n).padStart(2, '0'); }
function fmt(min) { return pad(Math.floor(min / 60) % 24) + ':' + pad(min % 60); }
function hourNow() { return Math.floor(state.time / 60) % 24; }

const CN_DAY = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const LUNAR_FMT = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' });
function lunarDay(n) {
  if (n <= 10) return '初' + (n === 10 ? '十' : CN_DAY[n]);
  if (n < 20) return '十' + CN_DAY[n % 10];
  if (n === 20) return '二十';
  if (n < 30) return '廿' + CN_DAY[n % 10];
  return '三十';
}
function lunarDate(d) {
  try {
    const parts = LUNAR_FMT.formatToParts(d);
    const month = (parts.find((p) => p.type === 'month') || {}).value || '';
    const day = parseInt((parts.find((p) => p.type === 'day') || {}).value || '1', 10);
    return month + lunarDay(day);
  } catch (e) {
    return '';
  }
}
function isLateBed(bed) { return bed < 6 * 60; }

function careFor(key, rec) {
  if (!rec) return null;
  if (key > dateKey(new Date())) return null;
  if (hash(key + ':care') >= 0.45) return null;
  const pool = peopleList().filter((p) => !p.me);
  if (!pool.length) return null;
  const who = pool[Math.min(pool.length - 1, Math.floor(hash(key + ':who') * pool.length))];
  return { who: who.id, text: careText(key, rec) };
}
function careText(key, rec) {
  const v = hash(key + ':line');
  const late = isLateBed(rec.bed);
  const short = rec.duration < 6 * 60;
  if (late && short) return v < 0.5 ? '又熬到 ' + fmt(rec.bed) + '，还没睡够，今天别太拼。' : '昨晚 ' + fmt(rec.bed) + ' 才睡，睡得太少了。';
  if (late) return v < 0.5 ? '昨晚 ' + fmt(rec.bed) + ' 才睡，今天早点休息。' : '又超过十二点才睡，记得把觉补回来。';
  if (short) return v < 0.5 ? '昨晚只睡了 ' + formatDuration(rec.duration) + '，中午补一觉吧。' : '睡这么少，今天对自己好一点。';
  if (rec.duration >= 8 * 60) return v < 0.5 ? '昨晚睡了 ' + formatDuration(rec.duration) + '，今天状态应该不错。' : '睡得挺足，继续保持。';
  return v < 0.5 ? '昨晚睡得还好吗？今天也早点休息。' : '记得按时睡觉，别太累。';
}
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000;
}
function stateLabel(p) {
  const s = p.state || 'idle';
  const map = {
    sleep: '已睡', out: '出门', cuddle: '抱着你', kiss: '亲亲你', invite: '叫你睡觉',
    sitBed: '坐床边', idle: '发呆',
    here: '在房间', toBed: '去睡觉', wakeSit: '刚醒', wakeStand: '醒着'
  };
  return map[s] || '醒着';
}
function cuddlePeriodNow() {
  const sleepMs = state.sleepBeganAt ? Date.now() - state.sleepBeganAt : elapsed * 1000;
  return Math.floor(sleepMs / 12000);
}

function stateOf(p) {
  if (p.me) return state.userPhase;
  if (state.demoTriad) return 'sleep';
  const h = hourNow();
  const inSchedule = p.sleep.has(h);
  const bucket = Math.floor(elapsed / 70);
  const contacts = peopleList().filter((x) => !x.me);
  if (state.userPhase === 'sleep' && contacts.length) {
    const period = cuddlePeriodNow();
    const chosen = contacts[period % contacts.length];
    const seed = state.sleepBeganAt || 0;
    const active = period < contacts.length || hash('cuddle:' + period + ':' + seed) < 0.55;
    if (chosen === p && active) {
      if (period === contacts.indexOf(p)) return 'cuddle';
      return hash('kind:' + period + ':' + seed) < 0.6 ? 'cuddle' : 'kiss';
    }
    if (['sleep', 'cuddle', 'kiss'].includes(p.state)) return 'sleep';
  }
  if (inSchedule && hash(p.id + ':' + h) * 100 < p.follow) return 'sleep';
  if (inSchedule && hash(p.id + ':free:' + h) < 0.2) return 'sleep';
  if (!inSchedule && hash(p.id + ':early:' + h) < 0.04) return 'sleep';
  if ((state.userPhase === 'here' || state.userPhase === 'wakeStand') && contacts.length) {
    const chosen = contacts[Math.floor(hash('invite:' + bucket) * contacts.length)];
    if (chosen === p && hash('inv:' + bucket) < 0.3) return 'invite';
  }
  const r = hash(p.id + ':act:' + bucket);
  if (r < 0.1) return 'out';
  if (r < 0.52) return 'sitBed';
  return 'idle';
}

let renderer, scene, camera, controls, labelRenderer, model;
let bed = { top: -0.17, x: 0, minZ: -2.91, maxZ: -0.39 };
let floorY = -0.69;
let hemi, warmLamp, warmFill, coolWindow, glow, moonGlow;
const roomMats = [];
const windowMats = [];
const DAY_TINT = new THREE.Color(0xfff1dd);
const NIGHT_TINT = new THREE.Color(0x8d6f52);
const figureMap = new Map();
let beddingGroup = null;
const figureRoots = [];
let noteHotspot = null;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const noteScreen = new THREE.Vector3();
let pointerDown = null;
let scrub = null;
let running = true;
let lastTime = performance.now();
let elapsed = 0;
let lowTime = 0;
let lowered = false;

init();

function init() {
  applyUiTheme();
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: !matchMedia('(pointer: coarse)').matches,
      alpha: false,
      powerPreference: 'high-performance'
    });
  } catch (err) {
    return fail('这个浏览器没有可用的 WebGL。可以回到 2D 睡眠小屋。');
  }
  if (!renderer.capabilities.isWebGL2) return fail('这个浏览器不支持 WebGL2。可以回到 2D 睡眠小屋。');

  const forceDpr = parseFloat(q.get('dpr') || '0');
  const coarse = matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(forceDpr || Math.min(devicePixelRatio, coarse ? 1.75 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  els.stage.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090c11);
  scene.fog = new THREE.FogExp2(0x090c11, 0.012);

  camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 80);
  camera.position.set(7.0, 3.0, 10.0);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.18, -1.65);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.panSpeed = 0.7;
  controls.rotateSpeed = 0.45;
  controls.zoomSpeed = 0.55;
  controls.touches.ONE = THREE.TOUCH.ROTATE;
  controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  controls.minDistance = 2.4;
  controls.maxDistance = 9;
  controls.minPolarAngle = 1.02;
  controls.maxPolarAngle = 1.58;
  controls.minAzimuthAngle = 0.16;
  controls.maxAzimuthAngle = 1.24;
  controls.enabled = !state.monitoring;

  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(innerWidth, innerHeight);
  els.labels.appendChild(labelRenderer.domElement);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.16;

  hemi = new THREE.HemisphereLight(0x46546e, 0x1c120b, 0.52);
  scene.add(hemi);

  warmLamp = new THREE.PointLight(0xffb36b, 42, 9, 2);
  warmLamp.position.set(-1.65, 1.18, -0.8);
  scene.add(warmLamp);

  warmFill = new THREE.PointLight(0xffc890, 14, 8, 2);
  warmFill.position.set(-3.6, 1.3, 2.0);
  scene.add(warmFill);

  coolWindow = new THREE.PointLight(0x6d97cc, 14, 10, 2);
  coolWindow.position.set(0, 1.9, -2.55);
  scene.add(coolWindow);

  glow = glowSprite(0xffb36b, 2.9, 0.5);
  glow.position.set(-1.65, 1.0, -0.78);
  scene.add(glow);

  moonGlow = glowSprite(0x8fb6e8, 4.4, 0.16);
  moonGlow.position.set(0, 2.25, -2.8);
  scene.add(moonGlow);

  fitCamera();
  addEventListener('resize', onResize);
  addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointercancel', () => {
    scrub = null;
    document.body.classList.remove('scrubbing');
  });
  document.addEventListener('visibilitychange', onVisibility);

  els.clockBtn.addEventListener('click', () => { if (timerState.sleepRunning) openTimer(); else openTime(); });
  els.monitorBadge.addEventListener('click', openTime);
  els.noteBtn.addEventListener('click', openNotesPage);
  els.menuBtn.addEventListener('click', openMenu);
  els.peopleStrip.addEventListener('pointerdown', () => {});

  setTimeout(() => els.hint.classList.add('hide'), 6000);
  window.__room3d = {
    scene, camera, renderer, controls, state, peopleDefs, figureMap, personTap, userSleepSide,
    get bed() { return bed; },
    get floorY() { return floorY; }
  };
  loadRoom();
  renderChips();
  renderClock();
  startLiveClock();
  setAnimation(true);
}

function fitCamera() {
  const aspect = innerWidth / innerHeight;
  const portrait = aspect < 0.8;
  camera.aspect = aspect;
  camera.fov = portrait ? 50 : 46;
  const tx = bed.x;
  const ty = bed.top + 0.32;
  const tz = (bed.minZ + bed.maxZ) / 2 + 0.62;
  controls.target.set(tx, ty, tz);
  const off = portrait
    ? { x: 4.0, y: 2.35, z: 5.0 }
    : { x: 4.4, y: 2.5, z: 5.5 };
  camera.position.set(tx + off.x, ty + off.y, tz + off.z);
  camera.updateProjectionMatrix();
  controls.update();
}

function constrainView() {
  if (!controls) return;
  const t = controls.target;
  const x = Math.max(-0.95, Math.min(0.95, t.x));
  const y = Math.max(-0.05, Math.min(0.95, t.y));
  const z = Math.max(-2.55, Math.min(-0.45, t.z));
  if (x !== t.x || y !== t.y || z !== t.z) {
    camera.position.x += x - t.x;
    camera.position.y += y - t.y;
    camera.position.z += z - t.z;
    t.set(x, y, z);
  }
}

function glowSprite(color, size, opacity) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.22, 'rgba(255,255,255,.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  s.scale.set(size, size, 1);
  return s;
}

function loadRoom() {
  const draco = new DRACOLoader();
  draco.setDecoderPath('./vendor/draco/');
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  loader.load('bedroom.glb', (gltf) => {
    model = gltf.scene;
    model.position.set(0, 1, 0);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false;
      o.receiveShadow = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        if (!m) return;
        m.envMapIntensity = 0.18;
        if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
        m.userData.baseColor = m.color.clone();
        if (m.name === 'Windows' || /window/i.test(o.name)) {
          m.roughness = 0.28;
          m.metalness = 0.35;
          windowMats.push(m);
        } else {
          roomMats.push(m);
        }
      });
    });
    scene.add(model);
    model.updateMatrixWorld(true);
    measureRoom();
    addSoftBedding();
    addNoteHotspot();
    buildFigures();
    applyTimeMood();
    els.loadBar.style.width = '100%';
    els.loadText.textContent = '房间准备好了';
    setTimeout(() => els.loader.classList.add('done'), 420);
  }, (xhr) => {
    if (xhr.total) {
      const pct = Math.min(96, Math.round((xhr.loaded / xhr.total) * 100));
      els.loadBar.style.width = pct + '%';
      els.loadText.textContent = '把夜灯打开，铺好被子… ' + pct + '%';
    }
  }, (err) => {
    console.error(err);
    fail('房间模型没有加载成功。检查网络后再试，或者先回到 2D 小屋。');
  });
}

function measureRoom() {
  const duvet = model.getObjectByName('Bedroom_Duvet_0');
  if (duvet) {
    const b = new THREE.Box3().setFromObject(duvet);
    bed = { top: b.max.y, x: (b.min.x + b.max.x) / 2, minZ: b.min.z, maxZ: b.max.z };
  }
  const carpet = model.getObjectByName('Bedroom_Carpet_0');
  if (carpet) {
    const b = new THREE.Box3().setFromObject(carpet);
    floorY = b.max.y + 0.005;
  }
}

function cropBeddingTex(tex, x, y, size, repeat) {
  if (!tex || !tex.image) return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d').drawImage(tex.image, x, y, size, size, 0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = tex.colorSpace;
  t.flipY = tex.flipY;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.needsUpdate = true;
  return t;
}

function beddingMat(base, repeat) {
  const mat = base.clone();
  const x = 205;
  const y = 140;
  const size = 64;
  mat.map = cropBeddingTex(base.map, x, y, size, repeat);
  mat.roughnessMap = cropBeddingTex(base.roughnessMap, x, y, size, repeat);
  mat.metalnessMap = cropBeddingTex(base.metalnessMap, x, y, size, repeat);
  mat.emissiveMap = cropBeddingTex(base.emissiveMap, x, y, size, repeat);
  mat.envMapIntensity = 0.18;
  mat.needsUpdate = true;
  return mat;
}

function plushDuvet(w, h, d) {
  const geo = new RoundedBoxGeometry(w, h, d, 7, 0.06);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (y > h * 0.05) {
      const u = x / (w / 2);
      const v = z / (d / 2);
      const ripple = Math.sin(x * 5.1 + z * 2.3) * 0.022
        + Math.sin(z * 8.7 - x * 3.1) * 0.014
        + Math.sin(x * 11.3 + 1.7) * 0.007;
      const fold = 0.055 * Math.exp(-Math.pow((z + d * 0.32) / 0.1, 2)) * (1 - Math.pow(Math.abs(u), 8));
      const crease = -0.02 * Math.exp(-Math.pow((x * 0.5 + z * 0.8 + 0.05) / 0.08, 2))
        - 0.015 * Math.exp(-Math.pow((x * 0.8 - z * 0.4 - 0.2) / 0.07, 2));
      const crown = 0.02 * (1 - v * v) * (1 - u * u * 0.4);
      pos.setY(i, y + ripple * (1 - u * u * 0.5) + fold + crease + crown);
    } else {
      pos.setY(i, y + Math.sin(x * 4.2 + z * 3.1) * 0.005);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

function plushPillow(w, h, d) {
  const geo = new RoundedBoxGeometry(w, h, d, 6, 0.08);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (y > h * 0.08) {
      const u = x / (w / 2);
      const v = z / (d / 2);
      const dimple = -0.032 * Math.exp(-(u * u + v * v) * 2.0);
      const puff = 0.01 * (1 - u * u) * (1 - v * v);
      const wobble = Math.sin(x * 8 + z * 6) * 0.005;
      pos.setY(i, y + dimple + puff + wobble);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

function addSoftBedding() {
  const group = new THREE.Group();
  group.name = 'soft-bedding';
  const base = model.getObjectByName('Bedroom_Duvet_0').material;
  const duvetMat = beddingMat(base, 3.2);
  const foldMat = beddingMat(base, 2.2);
  const pillowMat = beddingMat(base, 1.6);

  const w = 1.72;
  const duvet = new THREE.Mesh(plushDuvet(w, 0.13, 0.66), duvetMat);
  duvet.position.set(bed.x, bed.top + 0.075, bed.maxZ - 0.46);
  group.add(duvet);

  const turned = new THREE.Mesh(plushDuvet(w, 0.065, 0.2), foldMat);
  turned.position.set(bed.x, bed.top + 0.16, bed.maxZ - 0.74);
  turned.rotation.x = -0.06;
  group.add(turned);

  const pillows = [];
  [-0.6, 0, 0.6].forEach((dx, i) => {
    const pillow = new THREE.Mesh(plushPillow(0.54, 0.16, 0.36), i === 1 ? foldMat : pillowMat);
    pillow.position.set(bed.x + dx, bed.top + 0.025, bed.maxZ - PILLOW_OFFSET);
    pillow.rotation.y = (i - 1) * 0.045;
    pillow.userData.baseX = dx;
    group.add(pillow);
    pillows.push(pillow);
  });

  group.userData.pillows = pillows;
  beddingGroup = group;
  updateBeddingMode();
  scene.add(group);
}

function updateBeddingMode() {
  if (!beddingGroup) return;
  const single = state.mode === 'single';
  const pillows = beddingGroup.userData.pillows || [];
  pillows.forEach((p, i) => {
    p.visible = !single || i !== 1;
    const dx = single ? (i === 0 ? -0.28 : 0.28) : (p.userData.baseX || 0);
    p.position.x = bed.x + dx;
  });
}

function buildFigures() {
  Object.values(peopleDefs).forEach((p, i) => {
    const fig = makeFigure(p, i);
    figureMap.set(p.id, fig);
    figureRoots.push(fig.root);
    scene.add(fig.root);
    scene.add(fig.shadow);
    scene.add(fig.labelObj);
    if (p.me) {
      fig.root.scale.setScalar(USER_SCALE);
      fig.shadow.scale.setScalar(USER_SCALE);
    }
    p.fade = 1;
    p.state = stateOf(p);
    placeFigure(p, fig, true);
  });
  renderChips();
  renderClock();
}

function makeFigure(p, index) {
  const root = new THREE.Group();
  root.name = 'figure-' + p.id;
  root.userData.personId = p.id;
  const mat = new THREE.MeshStandardMaterial({
    color: p.color, roughness: 0.48, metalness: 0.04,
    emissive: new THREE.Color(p.color), emissiveIntensity: 0.11,
    transparent: true, opacity: 1
  });

  const add = (mesh) => { root.add(mesh); return mesh; };
  const sphere = (r, seg = 16) => new THREE.SphereGeometry(r, seg, Math.max(8, seg - 4));

  const head = add(new THREE.Mesh(sphere(0.15, 20), mat));
  head.position.y = 1.6;

  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x17110b, transparent: true, opacity: 1 });
  const eyeL = add(new THREE.Mesh(sphere(0.016, 8), eyeMat));
  eyeL.position.set(-0.052, 1.63, 0.137);
  const eyeR = add(new THREE.Mesh(sphere(0.016, 8), eyeMat));
  eyeR.position.set(0.052, 1.63, 0.137);

  const neck = add(new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.042, 0.1, 10), mat));
  neck.position.y = 1.42;

  const torso = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.083, 0.4, 5, 12), mat));
  torso.position.y = 1.13;

  const hips = add(new THREE.Mesh(sphere(0.095, 12), mat));
  hips.position.y = 0.84;

  const armL = limb(mat, 0.042, 0.44);
  armL.position.set(-0.175, 1.34, 0);
  armL.rotation.z = 0.12;
  add(armL);
  const armR = limb(mat, 0.042, 0.44);
  armR.position.set(0.175, 1.34, 0);
  armR.rotation.z = -0.12;
  add(armR);

  const legL = jointedLeg(mat, 0.05, 0.76);
  legL.position.set(-0.085, 0.82, 0);
  add(legL);
  const legR = jointedLeg(mat, 0.05, 0.76);
  legR.position.set(0.085, 0.82, 0);
  add(legR);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.34, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.24, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = floorY + 0.012;

  const labelEl = document.createElement('div');
  labelEl.className = 'fig-label';
  labelEl.innerHTML = '<i style="background:' + p.color + ';color:' + p.color + '"></i><span>' + esc(p.name) + '</span>';
  const labelObj = new CSS2DObject(labelEl);

  root.traverse((o) => { if (o.isMesh) o.userData.personId = p.id; });
  root.userData.parts = { armL, armR, legL, legR, head, torso, hips };
  root.userData.mat = mat;
  root.userData.index = index;
  return { root, shadow, labelObj, labelEl, mat, eyeMat };
}

function limb(mat, radius, length) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 9), mat);
  m.position.y = -length / 2;
  g.add(m);
  return g;
}

function jointedLeg(mat, radius, length) {
  const g = new THREE.Group();
  const half = length / 2;
  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(radius, half, 4, 9), mat);
  upper.position.y = -half / 2;
  g.add(upper);
  const knee = new THREE.Group();
  knee.position.y = -half;
  const lower = new THREE.Mesh(new THREE.CapsuleGeometry(radius, half, 4, 9), mat);
  lower.position.y = -half / 2;
  knee.add(lower);
  g.add(knee);
  g.userData.knee = knee;
  return g;
}

function contactOrder(p) {
  const i = peopleList().filter((x) => !x.me).indexOf(p);
  return i < 0 ? 0 : i;
}

function contactSide(p) {
  return contactOrder(p) % 2 === 0 ? -1 : 1;
}

function userBedSign() {
  return state.userBedSide === 1 ? 1 : -1;
}

function userBedX() {
  return state.mode === 'single' ? bed.x + userBedSign() * 0.27 : bed.x;
}

function contactBedSign() {
  return -userBedSign();
}

function contactSleepSide(p) {
  return state.mode === 'single' ? contactBedSign() : contactSide(p);
}

function cuddleSide(p) {
  let side = state.mode === 'single'
    ? contactBedSign()
    : (hash(p.id + ':side') < 0.5 ? -1 : 1);
  const others = peopleList().filter((x) => !x.me && x.id !== p.id && ['sleep', 'cuddle', 'kiss'].includes(x.state));
  const taken = others.map((o) => (o.state === 'sleep'
    ? sleepSlot(o).x
    : bed.x + contactSide(o) * 0.3) - bed.x);
  if (taken.some((dx) => dx * side >= 0)) side = -side;
  return side;
}

function userSleepSide() {
  // 睡眠钟开启时点我可以手动锁定 -1 左侧 / 0 平躺 / 1 右侧，三种姿态都保留。
  if (state.userSleepManual !== null) {
    state.userSleepSide = state.userSleepManual;
    return state.userSleepSide;
  }
  const c = peopleList().find((x) => !x.me && (x.state === 'cuddle' || x.state === 'kiss'));
  if (c) state.userSleepSide = cuddleSide(c);
  if (!state.userSleepSide) {
    // 单人也保留左右两种默认：每次开始睡随机落在左侧或右侧（平躺仍由点击切换）。
    const seed = dateKey(new Date()) + ':' + (state.sleepBeganAt || 0) + ':user-side';
    state.userSleepSide = hash(seed) < 0.5 ? -1 : 1;
  }
  return state.userSleepSide;
}

function sleepSlot(p) {
  const list = peopleList();
  if (p.me) {
    const side = state.userPhase === 'sleep' ? userSleepSide() : 0;
    return {
      x: userBedX(),
      y: bed.top + (side ? 0.18 : 0.14) * USER_SCALE,
      z: bed.maxZ - PILLOW_OFFSET + HEAD_LOCAL_Y * USER_SCALE,
      rotX: -Math.PI / 2,
      rotY: 0,
      rotZ: side * 1.35,
      sideSleep: !!side
    };
  }
  const side = contactSleepSide(p);
  if (state.mode === 'single') {
    return { x: bed.x + contactBedSign() * 0.27, y: bed.top + 0.18, z: bed.maxZ - PILLOW_OFFSET + HEAD_LOCAL_Y, rotX: -Math.PI / 2, rotY: 0, rotZ: side * 1.35, sideSleep: true };
  }
  const inBed = list.filter((x) => !x.me && ['sleep', 'cuddle', 'kiss'].includes(x.state));
  const sleepers = inBed.filter((x) => x.state === 'sleep');
  const spread = sleepers.length <= 1 ? 0.55 : 0.6;
  const x = bed.x + contactSide(p) * spread;
  return { x, y: bed.top + 0.18, z: bed.maxZ - PILLOW_OFFSET + HEAD_LOCAL_Y, rotX: -Math.PI / 2, rotY: 0, rotZ: side * 1.35, sideSleep: true };
}

function idleSpot(p) {
  const arr = [
    { x: 1.55, z: 2.35, ry: -0.2 },
    { x: -0.55, z: 2.35, ry: 0.2 }
  ];
  const a = arr[contactOrder(p) % arr.length];
  const i = contactOrder(p);
  return { x: a.x + Math.sin(elapsed * 0.18 + i) * 0.05, y: floorY, z: a.z + Math.cos(elapsed * 0.15 + i) * 0.04, rotX: 0, rotY: a.ry, rotZ: 0 };
}

function bedSitSpot(p) {
  const side = state.mode === 'single' ? contactBedSign() : (p.sitSide || (contactOrder(p) % 2 === 0 ? -1 : 1));
  return { x: bed.x + side * 0.62, y: bed.top - 0.82, z: bed.maxZ + 0.06, rotX: 0, rotY: 0, rotZ: 0 };
}



function cuddleSpot(p, kind) {
  const u = sleepSlot(peopleDefs.me);
  const side = cuddleSide(p);
  const gap = kind === 'kiss' ? 0.18 : 0.3;
  return {
    x: u.x + gap * side,
    y: u.y + 0.05,
    z: u.z + HEAD_LOCAL_Y * (1 - USER_SCALE) + (kind === 'kiss' ? 0 : 0.02),
    rotX: -Math.PI / 2,
    rotY: 0,
    rotZ: side * (kind === 'kiss' ? 1.35 : 1.5)
  };
}

function figureTarget(p, s) {
  if (p.me) {
    if (s === 'sleep') return sleepSlot(p);
    const ux = userBedX();
    if (s === 'toBed') return { x: ux, y: floorY, z: bed.maxZ + 0.62, rotX: 0, rotY: Math.PI, rotZ: 0 };
    if (s === 'wakeSit') return { x: ux, y: bed.top + 0.02 - 0.84 * USER_SCALE, z: bed.maxZ + 0.06, rotX: 0, rotY: 0, rotZ: 0 };
    if (s === 'wakeStand') return { x: ux + 0.52, y: floorY, z: bed.maxZ + 0.55, rotX: 0, rotY: 0.4, rotZ: 0 };
    if (s === 'here') return { x: 1.25, y: floorY, z: 0.95, rotX: 0, rotY: -0.12, rotZ: 0 };
    return null;
  }
  if (s === 'sleep') return sleepSlot(p);
  if (s === 'cuddle' || s === 'kiss') return cuddleSpot(p, s);
  if (s === 'sitBed' || s === 'invite') return bedSitSpot(p);
  if (s === 'idle') return idleSpot(p);
  return null;
}

function sitHeight(p) {
  return bed.top + (p.me ? 0.02 - 0.84 * USER_SCALE : -0.82);
}

function hipOffsetY(root, p) {
  const h = 0.84 * (p.me ? USER_SCALE : 1);
  return new THREE.Vector3(0, h, 0).applyQuaternion(root.quaternion).y;
}

function poseFigure(fig, p, s, t, walking, dt, snap) {
  const parts = fig.root.userData.parts;
  const i = fig.root.userData.index;
  const breathe = Math.sin(t * 1.3 + i * 1.4);
  const a = {
    armLx: breathe * 0.03, armLz: 0.12,
    armRx: -breathe * 0.03, armRz: -0.12,
    legLx: 0, kneeL: 0,
    legRx: 0, kneeR: 0,
    headX: 0
  };
  const arm = (side, x, z) => { a[side === 'L' ? 'armLx' : 'armRx'] = x; a[side === 'L' ? 'armLz' : 'armRz'] = z; };
  const leg = (side, x, knee = 0) => {
    a[side === 'L' ? 'legLx' : 'legRx'] = x;
    a[side === 'L' ? 'kneeL' : 'kneeR'] = knee;
  };

  if (walking) {
    const walk = Math.sin(t * 5.2 + i * 1.9);
    leg('L', walk * 0.34, Math.max(0, -walk) * 0.45);
    leg('R', -walk * 0.34, Math.max(0, walk) * 0.45);
    arm('L', -walk * 0.28, 0.12);
    arm('R', walk * 0.28, -0.12);
  } else if (s === 'sleep') {
    const side = p.me ? state.userSleepSide : contactSleepSide(p);
    if (side) {
      const upper = side > 0 ? 'R' : 'L';
      const lower = side > 0 ? 'L' : 'R';
      if (p.me) {
        arm(upper, -0.92, -side * 0.26);
        arm(lower, -0.22, side * 0.12);
        leg(upper, -1.0, 1.05);
        leg(lower, -0.55, 0.78);
        a.headX = -0.06;
      } else {
        arm(upper, -0.62, -side * 0.2);
        arm(lower, -0.12, side * 0.08);
        leg(upper, -0.62, 0.68);
        leg(lower, -0.3, 0.46);
        a.headX = -0.04;
      }
    } else {
      arm('L', 0.04, 0.05);
      arm('R', -0.04, -0.05);
      leg('L', 0.03);
      leg('R', -0.03);
    }
  } else if (s === 'cuddle' || s === 'kiss') {
    const side = cuddleSpot(p, s).x >= bed.x ? 1 : -1;
    const upper = side > 0 ? 'R' : 'L';
    const lower = side > 0 ? 'L' : 'R';
    arm(upper, s === 'kiss' ? -1.05 : -1.25, -side * (s === 'kiss' ? 0.34 : 0.42));
    arm(lower, 0.15, side * 0.05);
    leg(upper, s === 'kiss' ? -0.72 : -0.9, s === 'kiss' ? 0.4 : 0.55);
    leg(lower, 0.02, 0);
    a.headX = s === 'kiss' ? -0.15 : 0;
  } else if (s === 'sitBed' || s === 'invite' || s === 'wakeSit') {
    leg('L', -1.34, 1.32);
    leg('R', -1.27, 1.25);
    arm('L', 0.18, 0.14);
    arm('R', s === 'invite' ? -1.35 : 0.22, s === 'invite' ? -0.3 : -0.14);
  }

  const rate = walking ? 15 : (p.getUp > 0 || s === 'wakeSit') ? 4.2 : 8;
  const k = snap ? 1 : 1 - Math.exp(-rate * (dt || 0.016));
  const apply = (obj, axis, value) => {
    if (snap) obj.rotation[axis] = value;
    else obj.rotation[axis] += (value - obj.rotation[axis]) * k;
  };
  apply(parts.armL, 'x', a.armLx); apply(parts.armL, 'z', a.armLz);
  apply(parts.armR, 'x', a.armRx); apply(parts.armR, 'z', a.armRz);
  apply(parts.legL, 'x', a.legLx); apply(parts.legL.userData.knee, 'x', a.kneeL);
  apply(parts.legR, 'x', a.legRx); apply(parts.legR.userData.knee, 'x', a.kneeR);
  apply(parts.head, 'x', a.headX); apply(parts.head, 'z', 0);
}

function placeFigure(p, fig, snap, dt) {
  const s = p.state;
  const root = fig.root;
  const target = figureTarget(p, s);
  if (!target) {
    fig.shadow.visible = false;
    fig.labelObj.visible = false;
    fig.labelEl.style.display = 'none';
    return;
  }
  const bedState = s === 'sleep' || s === 'cuddle' || s === 'kiss';
  const sitState = s === 'sitBed' || s === 'invite';
  const inBed = root.position.y > bed.top + 0.02;
  const stepDt = dt || 0.016;
  const rising = !snap && p.getUp > 0;
  let dest = target;
  let walking = false;
  if (!snap) {
    if (rising) {
      // Sit up where we were lying first; don't slide across the bed while horizontal.
      dest = { x: root.position.x, y: sitHeight(p), z: root.position.z };
      walking = false;
    } else if (bedState) {
      if (inBed) {
        p.mounting = false;
      } else if (!p.mounting) {
        const foot = { x: target.x, y: floorY, z: bed.maxZ + 0.32 };
        if (Math.hypot(foot.x - root.position.x, foot.z - root.position.z) > 0.12) {
          dest = foot;
          walking = true;
        } else {
          p.mounting = true;
        }
      }
    } else if (sitState) {
      const sitting = root.position.y < floorY - 0.02;
      if (inBed || sitting) {
        p.sittingDown = false;
      } else if (!p.sittingDown) {
        const front = { x: target.x, y: floorY, z: target.z + 0.32 };
        if (Math.hypot(front.x - root.position.x, front.z - root.position.z) > 0.12) {
          dest = front;
          walking = true;
        } else {
          p.sittingDown = true;
        }
      }
    } else if (s !== 'wakeSit') {
      if (s === 'wakeStand' && root.position.y < floorY - 0.02) {
        // Stand up beside the bed before taking the first step.
        dest = { x: root.position.x, y: floorY, z: root.position.z };
        walking = false;
      } else if (root.position.y > floorY + 0.06) {
        dest = {
          x: Math.max(bed.x - 0.9, Math.min(bed.x + 0.9, root.position.x)),
          y: floorY,
          z: bed.maxZ + 0.45
        };
        walking = true;
      } else {
        walking = Math.hypot(target.x - root.position.x, target.z - root.position.z) > 0.06;
      }
    }
    if (p.getUp > 0) p.getUp = Math.max(0, p.getUp - stepDt);
  }
  const dx = dest.x - root.position.x;
  const dz = dest.z - root.position.z;
  const dist = Math.hypot(dx, dz);
  if (snap) {
    root.position.set(target.x, target.y, target.z);
  } else {
    if (dist > 0.0001) {
      const speed = walking ? WALK_SPEED : (s === 'wakeSit' || sitState) ? 0.62 : WALK_SPEED;
      const step = Math.min(speed * stepDt, dist);
      root.position.x += (dx / dist) * step;
      root.position.z += (dz / dist) * step;
    }
    let targetY = walking ? floorY : target.y;
    if (rising && !bedState) targetY = sitHeight(p);
    if (s === 'wakeSit') targetY = sitHeight(p);
    const dy = targetY - root.position.y;
    const vy = CLIMB_SPEED * stepDt;
    root.position.y += Math.abs(dy) <= vy ? dy : Math.sign(dy) * vy;
  }
  const targetQ = new THREE.Quaternion();
  const sideLying = s === 'cuddle' || s === 'kiss' || (s === 'sleep' && target.sideSleep);
  if (walking) {
    targetQ.setFromEuler(new THREE.Euler(0, Math.atan2(dx, dz), 0, 'XYZ'));
  } else if (sideLying) {
    const qLay = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), target.rotZ);
    targetQ.copy(qRoll).multiply(qLay);
  } else {
    targetQ.setFromEuler(new THREE.Euler(target.rotX || 0, target.rotY || 0, target.rotZ || 0, 'XYZ'));
  }
  if (snap) root.quaternion.copy(targetQ);
  else {
    const waking = rising || p.getUp > 0 || s === 'wakeSit';
    const qRate = walking ? 10 : bedState ? 5 : waking ? 3.4 : 9;
    root.quaternion.slerp(targetQ, 1 - Math.exp(-qRate * stepDt));
  }
  if (!snap && rising) {
    // Keep the hip on a smooth path instead of letting the upright body float.
    const riseP = Math.max(0, Math.min(1, 1 - p.getUp / 0.7));
    const eased = riseP * riseP * (3 - 2 * riseP);
    const hipY = p.riseHipY0 + (p.riseHipY1 - p.riseHipY0) * eased;
    root.position.y = hipY - hipOffsetY(root, p);
  }
  poseFigure(fig, p, s, elapsed, walking, stepDt, snap);

  const lying = s === 'sleep' || s === 'cuddle' || s === 'kiss';
  fig.shadow.position.set(root.position.x, floorY + 0.012, root.position.z);
  fig.shadow.visible = s !== 'out' && (!lying || walking);
  fig.shadow.material.opacity = 0.24 * p.fade;

  const labelScale = p.me ? USER_SCALE : 1;
  const labelY = (walking ? 1.95 : lying ? 0.58 : (s === 'sitBed' || s === 'invite' || s === 'wakeSit') ? 1.5 : 1.95) * labelScale;
  fig.labelObj.position.set(root.position.x, root.position.y + labelY, root.position.z);
  fig.labelObj.visible = s !== 'out';
  fig.labelEl.style.opacity = String(0.86 * p.fade);
  fig.labelEl.style.display = s === 'out' ? 'none' : 'flex';
}

function setUserPhase(phase) {
  state.userPhase = phase;
  state.userPhaseAt = Date.now();
  refreshStates();
  renderClock();
}

function updateUserPhase() {
  if (!state.userPhaseAt) return;
  const t = Date.now() - state.userPhaseAt;
  let next = null;
  if (state.userPhase === 'toBed' && t > 500) {
    const fig = figureMap.get('me');
    const tgt = figureTarget(peopleDefs.me, 'toBed');
    if (fig && tgt && Math.hypot(fig.root.position.x - tgt.x, fig.root.position.z - tgt.z) < 0.1) next = 'sleep';
  } else if (state.userPhase === 'wakeSit' && t > 900) {
    const fig = figureMap.get('me');
    const tgt = figureTarget(peopleDefs.me, 'wakeSit');
    const settled = fig && tgt &&
      Math.hypot(fig.root.position.x - tgt.x, fig.root.position.z - tgt.z) < 0.1 &&
      Math.abs(fig.root.position.y - tgt.y) < 0.05;
    if (settled || t > 4000) next = 'wakeStand';
  } else if (state.userPhase === 'wakeStand' && t > 600) {
    const fig = figureMap.get('me');
    const tgt = figureTarget(peopleDefs.me, 'wakeStand');
    const settled = fig && tgt &&
      Math.hypot(fig.root.position.x - tgt.x, fig.root.position.z - tgt.z) < 0.1 &&
      Math.abs(fig.root.position.y - tgt.y) < 0.05;
    if (settled || t > 3000) next = 'here';
  }
  if (next) {
    if (next === 'sleep') {
      state.sleepBeganAt = Date.now();
      if (timerState.sleepRunning) toast('睡着了 · 点我可以换睡姿');
    }
    setUserPhase(next);
  }
}

function refreshStates(snap) {
  const list = peopleList();
  list.forEach((p) => {
    const next = stateOf(p);
    if (p.state !== next) {
      const wasLying = ['sleep', 'cuddle', 'kiss'].includes(p.state);
      const nowLying = ['sleep', 'cuddle', 'kiss'].includes(next);
      if (next === 'out' || p.state === 'out') p.fade = 0;
      p.state = next;
      p.mounting = false;
      p.sittingDown = false;
      if (wasLying && !nowLying && next !== 'out') {
        const fig = figureMap.get(p.id);
        p.getUp = 0.7;
        p.riseHipY0 = fig ? fig.root.position.y + hipOffsetY(fig.root, p) : bed.top + 0.14;
        p.riseHipY1 = p.riseHipY0;
        if (fig && (next === 'sitBed' || next === 'invite')) {
          p.sitSide = fig.root.position.x >= bed.x ? 1 : -1;
        }
      } else if (nowLying || next === 'out') {
        p.getUp = 0;
      }
    }
  });
  list.forEach((p) => {
    const fig = figureMap.get(p.id);
    if (!fig) return;
    fig.root.visible = true;
    if (p.state === 'out') {
      fig.shadow.visible = false;
      fig.labelObj.visible = false;
      fig.labelEl.style.display = 'none';
    }
    if (snap) placeFigure(p, fig, true);
  });
  renderChips();
  applyTimeMood();
}

function updateFigures(dt) {
  const list = peopleList();
  list.forEach((p) => {
    const fig = figureMap.get(p.id);
    if (!fig) return;
    p.fade += (1 - p.fade) * Math.min(1, dt * 6);
    if (p.state === 'out') {
      fig.root.visible = false;
      fig.labelObj.visible = false;
      fig.labelEl.style.display = 'none';
      return;
    }
    fig.root.visible = true;
    fig.labelObj.visible = true;
    placeFigure(p, fig, false, dt);
    const op = ['sleep', 'cuddle', 'kiss'].includes(p.state) ? 0.92 : 1;
    const targetOpacity = p.fade * op;
    fig.mat.opacity += (targetOpacity - fig.mat.opacity) * Math.min(1, dt * 6);
    fig.eyeMat.opacity = fig.mat.opacity;
  });
  // Hide figures that are not in the current room mode.
  Object.values(peopleDefs).forEach((p) => {
    if (list.includes(p)) return;
    const fig = figureMap.get(p.id);
    if (!fig) return;
    fig.root.visible = false;
    fig.shadow.visible = false;
    fig.labelObj.visible = false;
    fig.labelEl.style.display = 'none';
  });
}

function addNoteHotspot() {
  const x = bed.x + 1.55;
  const z = bed.maxZ - 1.55;
  const y = bed.top + 0.03;
  const group = new THREE.Group();
  group.name = 'note-hotspot';
  const book = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.04, 0.24),
    new THREE.MeshStandardMaterial({ color: 0xe9d8b6, roughness: 0.92 })
  );
  book.position.set(x, y, z);
  book.rotation.y = -0.18;
  book.userData.noteHotspot = true;
  group.add(book);
  const cover = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.018, 0.26),
    new THREE.MeshStandardMaterial({ color: 0x8d6c4a, roughness: 0.86 })
  );
  cover.position.set(x, y + 0.026, z);
  cover.rotation.y = -0.18;
  cover.userData.noteHotspot = true;
  group.add(cover);
  scene.add(group);
  noteHotspot = { group, pos: new THREE.Vector3(x, y + 0.1, z) };
}

function updateNoteButton() {
  if (!noteHotspot || !els.noteBtn) return;
  noteScreen.copy(noteHotspot.pos).project(camera);
  const x = (noteScreen.x * 0.5 + 0.5) * innerWidth;
  const y = (-noteScreen.y * 0.5 + 0.5) * innerHeight;
  const visible = noteScreen.z < 1 && x > 22 && x < innerWidth - 22 && y > 120 && y < innerHeight - 120;
  els.noteBtn.style.display = visible ? 'flex' : 'none';
  els.noteBtn.style.left = x + 'px';
  els.noteBtn.style.top = y + 'px';
}

function applyTimeMood() {
  if (!hemi) return;
  const h = hourNow();
  const day = h >= 6 && h < 18;
  roomMats.forEach((m) => {
    m.color.copy(m.userData.baseColor || m.color);
    if (day) {
      m.color.multiplyScalar(0.98);
      m.color.lerp(DAY_TINT, 0.012);
    } else {
      m.color.multiplyScalar(0.52);
      m.color.lerp(NIGHT_TINT, 0.06);
    }
  });
  windowMats.forEach((m) => {
    m.color.set(day ? 0x9db4d2 : 0x304a70);
    m.emissive.set(day ? 0x223044 : 0x08101e);
    m.emissiveIntensity = day ? 0.35 : 1.15;
  });
  renderer.toneMappingExposure = day ? 1.16 : 1.04;
  if (day) {
    hemi.intensity = 1.55;
    coolWindow.intensity = 46;
    warmLamp.intensity = 7;
    warmFill.intensity = 4;
    scene.background.set(0x1a2029);
    scene.fog.color.set(0x1a2029);
    glow.material.opacity = 0.16;
    moonGlow.material.opacity = 0.05;
  } else {
    hemi.intensity = 0.52;
    coolWindow.intensity = 14;
    warmLamp.intensity = 42;
    warmFill.intensity = 14;
    scene.background.set(0x090c11);
    scene.fog.color.set(0x090c11);
    glow.material.opacity = 0.56;
    moonGlow.material.opacity = 0.18;
  }
}

function renderChips() {
  els.peopleStrip.innerHTML = peopleList().filter((p) => !p.me).map((p) => {
    return '<span class="person-chip"><i style="background:' + p.color + ';color:' + p.color + '"></i><b>' + esc(p.name) + '</b><span>' + stateLabel(p) + '</span></span>';
  }).join('');
}

function renderClock() {
  applyUiTheme();
  const sleeping = timerState.sleepRunning;
  const replay = !state.live && !sleeping;
  const monitoring = state.monitoring && !sleeping;
  document.body.classList.toggle('replay', replay);
  document.body.classList.toggle('monitoring', monitoring);
  els.roomEyebrow.textContent = sleeping ? 'MOCHI · 睡眠记录' : monitoring ? 'MOCHI · CAM 01 · 监控中' : replay ? 'MOCHI · CAM 01 · 回放' : 'MOCHI · SLEEP ROOM';
  els.clockText.textContent = sleeping ? formatSeconds(Math.max(0, Math.floor((Date.now() - timerState.sleepStart) / 1000))) : fmt(state.time);
  els.clockBtn.setAttribute('aria-label', sleeping ? '睡眠记录，打开睡觉钟' : '房间时间');
  els.scrubTime.textContent = fmt(state.time);
  els.playDot.classList.toggle('on', state.live && !sleeping);
  els.playDot.classList.toggle('replay', replay);
  const sheetTime = document.getElementById('sheetTime');
  if (sheetTime) sheetTime.textContent = fmt(state.time);
  const sheetDate = document.getElementById('sheetDate');
  if (sheetDate) sheetDate.textContent = dateStamp() + ' · ' + (monitoring ? '监控中' : state.live ? '实时房间' : '监控回放');
  if (els.camTime) els.camTime.textContent = dateStamp() + ' ' + fmt(state.time) + ':00';
  if (controls) controls.enabled = !monitoring;
}

function stopLiveClock() {
  if (state.liveTimer) clearInterval(state.liveTimer);
  state.liveTimer = null;
}

function startLiveClock() {
  stopLiveClock();
  if (!state.live) return;
  state.liveTimer = setInterval(() => {
    if (!state.live) return;
    const next = nowMinutes();
    const changed = next !== state.time;
    state.time = next;
    if (changed) refreshStates();
    renderClock();
  }, 1000);
}

function setTime(min, opts) {
  const options = opts || {};
  state.live = !!options.live;
  if (state.live) state.monitoring = false;
  state.time = state.live ? nowMinutes() : ((Math.round(min) % 1440) + 1440) % 1440;
  if (state.live) startLiveClock();
  else stopLiveClock();
  refreshStates();
  renderClock();
  if (!options.silent) closeToast();
}

function enterMonitoring() {
  if (timerState.sleepRunning) return toast('睡眠记录中不能进入监控');
  closeSheet();
  state.monitoring = true;
  state.live = false;
  stopLiveClock();
  refreshStates();
  renderClock();
  toast('左右拖动房间查看时间');
}

function goLive() {
  state.monitoring = false;
  scrub = null;
  setTime(nowMinutes(), { live: true, silent: true });
  closeSheet();
  document.body.classList.remove('scrubbing');
  toast('回到此刻');
}

function onResize() {
  if (!renderer) return;
  const oldAspect = camera.aspect;
  camera.aspect = innerWidth / innerHeight;
  if ((oldAspect < 0.8) !== (camera.aspect < 0.8)) fitCamera();
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
}

function onPointerDown(e) {
  pointerDown = { x: e.clientX, y: e.clientY };
  if (!state.monitoring) return;
  scrub = { x: e.clientX, start: state.time, moved: false };
  try { renderer.domElement.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
}

function onPointerMove(e) {
  if (!scrub) return;
  const dx = e.clientX - scrub.x;
  if (Math.abs(dx) > 3) {
    scrub.moved = true;
    document.body.classList.add('scrubbing');
  }
  if (scrub.moved) scrubTo(scrub.start + dx * 1.6);
}

function scrubTo(min) {
  const prevHour = hourNow();
  state.live = false;
  state.time = ((Math.round(min) % 1440) + 1440) % 1440;
  if (hourNow() !== prevHour) refreshStates();
  renderClock();
}

function onPointerUp(e) {
  const wasScrub = scrub && scrub.moved;
  if (scrub) {
    scrub = null;
    document.body.classList.remove('scrubbing');
  }
  if (!pointerDown || !renderer) return;
  const dx = e.clientX - pointerDown.x;
  const dy = e.clientY - pointerDown.y;
  pointerDown = null;
  if (wasScrub || dx * dx + dy * dy > 36) return;
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(scene.children, true);
  const people = [];
  for (const hit of hits) {
    let o = hit.object, kind = '', id = '';
    while (o) {
      if (o.userData && o.userData.noteHotspot) { kind = 'note'; break; }
      if (o.userData && o.userData.personId) { kind = 'person'; id = o.userData.personId; break; }
      o = o.parent;
    }
    if (kind === 'note') {
      if (!people.length) return openNotesPage(); // 便签在更前面；人后面被挡住的便签不抢
      continue;
    }
    if (kind === 'person' && id && people.indexOf(id) < 0) people.push(id);
  }
  if (!people.length) return;
  // 睡着并开着睡眠钟时，点到自己（哪怕被抱抱的联系人挡住一部分）优先切换睡姿。
  if (timerState.sleepRunning && state.userPhase === 'sleep' && people.indexOf('me') >= 0) return personTap('me');
  return personTap(people[0]);
}

function personTap(id) {
  const p = personById(id);
  if (!p || !peopleList().includes(p)) return;
  if (p.me && timerState.sleepRunning && state.userPhase === 'sleep') {
    const cur = userSleepSide();
    const next = cur === -1 ? 0 : cur === 0 ? 1 : -1;
    state.userSleepManual = next;
    state.userSleepSide = next;
    const label = next === -1 ? '左侧睡' : next === 1 ? '右侧睡' : '平躺';
    toast('睡姿：' + label + ' · 再点一下切换');
    return;
  }
  toast(p.name + ' · ' + stateLabel(p) + ' · ' + fmt(state.time));
}

function openMenu() {
  const modeSeg = '<div class="seg" id="modeSeg">' +
    '<button data-mode="single" class="' + (state.mode === 'single' ? 'on' : '') + '">单人</button>' +
    '<button data-mode="group" class="' + (state.mode === 'group' ? 'on' : '') + '">群聊</button></div>';
  const themeSeg = '<div class="setting-label" style="margin-top:14px"><span>界面</span></div>' +
    '<div class="seg" id="themeSeg">' +
    '<button data-theme="auto" class="' + (state.uiTheme === 'auto' ? 'on' : '') + '">自动</button>' +
    '<button data-theme="night" class="' + (state.uiTheme === 'night' ? 'on' : '') + '">夜间</button>' +
    '<button data-theme="day" class="' + (state.uiTheme === 'day' ? 'on' : '') + '">白日</button></div>';
  const tiles = [
    menuTile('time', '房间时间', '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.6V12l3 1.8"/>'),
    menuTile('schedule', '作息表', '<circle cx="6" cy="6.6" r="1"/><circle cx="6" cy="12" r="1"/><circle cx="6" cy="17.4" r="1"/><path d="M10 6.6h9M10 12h9M10 17.4h6"/>'),
    menuTile('colors', '火柴人颜色', '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.5 0 1.9-1 1.1-2.1-.9-1.2.2-2.4 1.6-2.4h1.4a3.9 3.9 0 0 0 3.9-3.9A8.7 8.7 0 0 0 12 3.5Z"/><circle cx="8.2" cy="9.4" r=".9"/><circle cx="12" cy="7.4" r=".9"/><circle cx="15.6" cy="9.2" r=".9"/>'),
    menuTile('calendar', '睡眠日历', '<rect x="3.8" y="4.8" width="16.4" height="15" rx="3"/><path d="M3.8 9.4h16.4M8.2 2.8v3.6M15.8 2.8v3.6"/>'),
    menuTile('timer', '睡觉钟', '<circle cx="12" cy="13.2" r="7.2"/><path d="M12 9.4v4l2.7 1.7M9.2 2.8h5.6M18.8 5.4l1.4 1.4"/>'),
    menuTile('notes', '便签', '<path d="M5.2 4.6h13.6v9.8L14.6 19H5.2z"/><path d="M14.6 19v-4.6h4.2M8.4 8.6h7.2M8.4 12h4.6"/>')
  ].join('');
  const list = '<div class="menu-grid">' + tiles + '</div>';
  const credit = '<p class="setting-note" style="text-align:center;margin:16px 0 0">房间模型 © dylanheyes · CC-BY 4.0 · three.js</p>';
  openSheet({
    title: '睡眠小屋',
    sub: '设置都收在这里，需要时再打开。',
    body: modeSeg + themeSeg + list + credit,
    onMount(root) {
      root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
        state.mode = b.dataset.mode;
        updateBeddingMode();
        refreshStates();
        closeSheet();
        toast(state.mode === 'group' ? '切到群聊合住小屋' : '切回单人小房间');
      }));
      root.querySelectorAll('[data-theme]').forEach((b) => b.addEventListener('click', () => {
        state.uiTheme = b.dataset.theme;
        writeStored('mochi3d.uiTheme', state.uiTheme);
        applyUiTheme();
        root.querySelectorAll('[data-theme]').forEach((x) => x.classList.toggle('on', x === b));
        toast(state.uiTheme === 'auto' ? '界面跟随时间' : state.uiTheme === 'day' ? '切到白日界面' : '切到夜间界面');
      }));
      root.querySelectorAll('[data-menu]').forEach((b) => b.addEventListener('click', () => {
        const a = b.dataset.menu;
        if (a === 'time') openTime();
        if (a === 'schedule') openSchedule(state.selected);
        if (a === 'colors') openColors();
        if (a === 'calendar') openCalendar();
        if (a === 'timer') openTimer();
        if (a === 'notes') openNotesPage();
      }));
    }
  });
}

function menuTile(id, label, icon) {
  return '<button class="menu-tile" data-menu="' + id + '">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icon + '</svg>' +
    '<b>' + esc(label) + '</b></button>';
}

function openTime() {
  if (timerState.sleepRunning) return openTimer();
  openSheet({
    title: '房间时间',
    sub: '点「监控」后在房间里左右拖动，查看其他时间。',
    body: '<div class="time-big" id="sheetTime">' + fmt(state.time) + '</div>' +
      '<div class="time-date" id="sheetDate">' + dateStamp() + ' · ' + (state.monitoring ? '监控中' : state.live ? '实时房间' : '监控回放') + '</div>' +
      '<p class="setting-note" style="text-align:center;margin:20px 0 4px">只有此刻是实时房间。</p>' +
      '<div class="btn-row"><button class="btn warm" id="sheetLive">回到此刻</button><button class="btn" id="sheetMonitor">监控</button></div>',
    onMount(root) {
      root.querySelector('#sheetLive').addEventListener('click', goLive);
      root.querySelector('#sheetMonitor').addEventListener('click', enterMonitoring);
    }
  });
}

function openSchedule(id) {
  const p = personById(id);
  if (!p || !peopleList().includes(p)) {
    state.selected = 'me';
  }
  const selected = peopleList().includes(personById(state.selected)) ? state.selected : 'me';
  state.selected = selected;
  const tabs = peopleList().map((x) => '<button data-person="' + x.id + '" class="' + (x.id === selected ? 'on' : '') + '"><i style="background:' + x.color + '"></i>' + esc(x.name) + '</button>').join('');
  const target = personById(selected);
  const cells = Array.from({ length: 24 }, (_, h) => {
    return '<button class="hour-cell ' + (target.sleep.has(h) ? 'on' : '') + (h === hourNow() ? ' now' : '') + '" data-hour="' + h + '">' + pad(h) + '</button>';
  }).join('');
  const followBlock = target.me
    ? '<p class="setting-note">你按自己的作息睡。联系人到点后只有 ' + state.follow + '% 会照做，其余可能熬夜、提前醒或出门。</p>'
    : '<div class="setting-block"><div class="setting-label"><span>' + esc(target.name) + ' 按表睡的概率</span><b id="followVal">' + target.follow + '%</b></div><input type="range" id="followRange" min="0" max="100" step="5" value="' + target.follow + '"><p class="setting-note">剩下的概率是自由发挥：可能还醒着，也可能出门。</p></div>';
  openSheet({
    title: '作息表',
    sub: '拖动或点亮小时格，可以设置不连续睡眠。',
    body: '<div class="people-tabs">' + tabs + '</div><div class="hour-grid" id="hourGrid">' + cells + '</div>' + followBlock,
    onMount(root) {
      root.querySelectorAll('[data-person]').forEach((b) => b.addEventListener('click', () => {
        state.selected = b.dataset.person;
        openSchedule(state.selected);
      }));
      const grid = root.querySelector('#hourGrid');
      const paint = (cell, on) => {
        const h = parseInt(cell.dataset.hour, 10);
        if (!target.sleep) return;
        if (on === undefined) on = !cell.classList.contains('on');
        if (on) target.sleep.add(h); else target.sleep.delete(h);
        cell.classList.toggle('on', on);
        refreshStates();
      };
      grid.addEventListener('pointerdown', (e) => {
        const cell = e.target.closest('.hour-cell');
        if (!cell) return;
        e.preventDefault();
        state.painting = !cell.classList.contains('on');
        paint(cell, state.painting);
      });
      grid.addEventListener('pointermove', (e) => {
        if (state.painting === null) return;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const cell = el && el.closest('.hour-cell');
        if (cell && grid.contains(cell)) paint(cell, state.painting);
      });
      addEventListener('pointerup', () => { state.painting = null; }, { once: true });
      const fr = root.querySelector('#followRange');
      if (fr) fr.addEventListener('input', () => {
        target.follow = parseInt(fr.value, 10);
        state.follow = target.follow;
        root.querySelector('#followVal').textContent = target.follow + '%';
      });
    }
  });
}

function openColors() {
  const me = peopleDefs.me;
  const contacts = peopleList().filter((p) => !p.me).map((p) => {
    return '<div class="contact-row">' +
      '<input class="color-circle color-circle-sm" type="color" data-contact="' + p.id + '" value="' + p.color + '" style="color:' + p.color + '" aria-label="改' + esc(p.name) + '的颜色">' +
      '<span class="cr-copy"><b>' + esc(p.name) + '</b></span>' +
      '<button data-recolor="' + p.id + '">让他换色</button></div>';
  }).join('');
  openSheet({
    title: '火柴人颜色',
    sub: '点圆圈直接选颜色；联系人也会按概率自己换。',
    body: '<div class="setting-block"><div class="setting-label"><span>我的颜色</span></div>' +
      '<div class="contact-row"><input class="color-circle color-circle-sm" type="color" id="meColor" value="' + me.color + '" style="color:' + me.color + '" aria-label="选我的颜色"><span class="cr-copy"><b>我</b></span></div></div>' +
      '<div class="setting-block"><div class="setting-label"><span>联系人</span></div>' + contacts +
      '<div class="setting-label" style="margin-top:14px"><span>自己换色概率</span><b id="recolorLabel">' + state.recolorProb + '%</b></div>' +
      '<input type="range" id="recolorRange" min="0" max="100" step="5" value="' + state.recolorProb + '"><p class="setting-note">只是问一句，他们不一定答应。</p></div>',
    onMount(root) {
      const mePick = root.querySelector('#meColor');
      mePick.addEventListener('input', () => {
        me.color = mePick.value;
        mePick.style.color = mePick.value;
        applyColor(me);
      });
      mePick.addEventListener('change', () => toast('你的火柴人换色了'));
      root.querySelectorAll('[data-contact]').forEach((inp) => {
        inp.addEventListener('input', () => {
          const p = personById(inp.dataset.contact);
          p.color = inp.value;
          inp.style.color = inp.value;
          applyColor(p);
        });
        inp.addEventListener('change', () => toast(personById(inp.dataset.contact).name + '换色了'));
      });
      root.querySelectorAll('[data-recolor]').forEach((b) => b.addEventListener('click', () => {
        const p = personById(b.dataset.recolor);
        if (Math.random() * 100 > state.recolorProb) return toast(p.name + '今天不想换颜色');
        const next = PALETTE.filter((c) => c !== p.color)[Math.floor(Math.random() * (PALETTE.length - 1))];
        p.color = next;
        applyColor(p);
        const pick = b.closest('.contact-row').querySelector('[data-contact]');
        pick.value = next;
        pick.style.color = next;
        toast(p.name + '换成了自己的颜色');
      }));
      const rr = root.querySelector('#recolorRange');
      rr.addEventListener('input', () => {
        state.recolorProb = parseInt(rr.value, 10);
        root.querySelector('#recolorLabel').textContent = state.recolorProb + '%';
      });
    }
  });
}

function applyColor(p) {
  const fig = figureMap.get(p.id);
  if (fig) {
    fig.mat.color.set(p.color);
    fig.mat.emissive.set(p.color);
    fig.labelEl.querySelector('i').style.background = p.color;
    fig.labelEl.querySelector('i').style.color = p.color;
  }
  renderChips();
}

function openCalendar() {
  const y = calCursor.getFullYear();
  const m = calCursor.getMonth();
  const first = new Date(y, m, 1);
  const firstIdx = (first.getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const todayK = dateKey(new Date());
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const day = i - firstIdx + 1;
    if (day < 1 || day > days) {
      cells += '<div class="cal-day out"></div>';
      continue;
    }
    const key = dateKey(new Date(y, m, day));
    const rec = state.sleepLog[key];
    const late = rec && isLateBed(rec.bed);
    const care = careFor(key, rec);
    cells += '<button class="cal-day ' + (key === todayK ? 'today ' : '') + (rec ? 'has ' : '') + (late ? 'late ' : '') + '" data-day="' + key + '">' +
      '<b>' + day + '</b>' +
      (care ? '<i class="cal-care" aria-label="联系人留言"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg></i>' : '') +
      (rec ? '<span class="cal-bed">' + fmt(rec.bed) + '</span><small>' + formatDuration(rec.duration) + '</small>' : '<span class="cal-empty">·</span>') +
      '</button>';
  }
  const prefix = y + '-' + pad(m + 1) + '-';
  const recs = Object.keys(state.sleepLog).filter((k) => k.indexOf(prefix) === 0).map((k) => state.sleepLog[k]);
  const avg = recs.length ? Math.round(recs.reduce((sum, r) => sum + r.duration, 0) / recs.length) : 0;
  const summary = recs.length ? '本月记录 ' + recs.length + ' 天 · 平均 ' + durationText(avg) : '这个月还没有记录。';
  openSheet({
    title: '睡眠日历',
    body: '<div class="cal-head"><button class="cal-nav" data-cal="prev" aria-label="上个月">‹</button><div class="cal-title">' + y + ' 年 ' + (m + 1) + ' 月</div><button class="cal-nav" data-cal="next" aria-label="下个月">›</button></div>' +
      '<div class="cal-week">' + ['一', '二', '三', '四', '五', '六', '日'].map((d) => '<span>' + d + '</span>').join('') + '</div>' +
      '<div class="cal-grid">' + cells + '</div>' +
      '<div class="cal-summary">' + summary + '</div>',
    onMount(root) {
      root.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => openSleepEditor(b.dataset.day)));
      root.querySelector('[data-cal="prev"]').addEventListener('click', () => { calCursor = new Date(y, m - 1, 1); openCalendar(); });
      root.querySelector('[data-cal="next"]').addEventListener('click', () => { calCursor = new Date(y, m + 1, 1); openCalendar(); });
    }
  });
}

function openSleepEditor(key) {
  const parts = key.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  const rec = state.sleepLog[key];
  const bedVal = rec ? fmt(rec.bed) : '23:00';
  const wakeVal = rec ? fmt(rec.wake) : '07:00';
  const care = careFor(key, rec);
  const carePerson = care ? (personById(care.who) || peopleDefs.him) : null;
  const careCard = care ? '<div class="sleep-care"><i style="background:' + carePerson.color + ';color:' + carePerson.color + '"></i><div><b>' + esc(carePerson.name) + ' 留了一句</b><p>' + esc(care.text) + '</p></div></div>' : '';
  openSheet({
    title: (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日',
    sub: WEEKDAYS[d.getDay()] + ' · 农历' + lunarDate(d),
    body: '<div class="time-row"><label><span>入睡</span><input class="time-input" id="bedInput" type="time" value="' + bedVal + '"></label><label><span>醒来</span><input class="time-input" id="wakeInput" type="time" value="' + wakeVal + '"></label></div>' +
      careCard +
      '<div class="btn-row"><button class="btn warm" id="sleepSave">保存记录</button>' + (rec ? '<button class="btn" id="sleepDelete">删除</button>' : '') + '</div>',
    onMount(root) {
      root.querySelector('#sleepSave').addEventListener('click', () => {
        const bed = parseClock(root.querySelector('#bedInput').value);
        const wake = parseClock(root.querySelector('#wakeInput').value);
        if (bed == null || wake == null) return toast('时间还没填好');
        const duration = (wake - bed + 1440) % 1440;
        if (duration === 0) return toast('入睡和醒来不能一样');
        state.sleepLog[key] = { bed, wake, duration, source: 'manual' };
        saveSleepLog();
        closeSheet();
        openCalendar();
        toast('睡眠记录好了');
      });
      const del = root.querySelector('#sleepDelete');
      if (del) del.addEventListener('click', () => {
        delete state.sleepLog[key];
        saveSleepLog();
        closeSheet();
        openCalendar();
        toast('记录删掉了');
      });
    }
  });
}

function openTimer() {
  openSheet({
    title: '睡觉钟',
    hideClose: true,
    body: '<div class="timer-ring" id="timerRing" style="--p:0"><div class="timer-ring-inner"><b id="timerText">00:00</b><small id="timerHint"></small></div></div>' +
      '<div class="timer-stat" id="timerStat"></div>' +
      '<div class="btn-row timer-actions"><button class="btn warm" id="timerPrimary">开始睡觉</button><button class="btn" id="timerSecondary">取消</button></div>',
    onMount(root) {
      root.querySelector('#timerPrimary').addEventListener('click', () => {
        if (timerState.sleepRunning) stopSleepClock(true);
        else startSleepClock();
        updateTimerUI();
      });
      root.querySelector('#timerSecondary').addEventListener('click', () => {
        if (timerState.sleepRunning) stopSleepClock(false);
        updateTimerUI();
      });
      updateTimerUI();
    }
  });
  ensureTimerLoop();
}

function ensureTimerLoop() {
  if (timerState.loop) return;
  timerState.loop = setInterval(tickTimer, 500);
}

function stopTimerLoopIfIdle() {
  if (timerState.sleepRunning) return;
  if (timerState.loop) clearInterval(timerState.loop);
  timerState.loop = null;
}

function tickTimer() {
  if (timerState.sleepRunning) {
    timerState.elapsed = Math.max(0, Math.floor((Date.now() - timerState.sleepStart) / 1000));
    els.clockText.textContent = formatSeconds(timerState.elapsed);
  }
  updateTimerUI();
  stopTimerLoopIfIdle();
}

function updateTimerUI() {
  const text = document.getElementById('timerText');
  if (!text) return;
  const ring = document.getElementById('timerRing');
  const hint = document.getElementById('timerHint');
  const stat = document.getElementById('timerStat');
  const primary = document.getElementById('timerPrimary');
  const secondary = document.getElementById('timerSecondary');
  const elapsed = timerState.sleepRunning ? Math.max(0, Math.floor((Date.now() - timerState.sleepStart) / 1000)) : timerState.elapsed;
  text.textContent = formatSeconds(elapsed);
  hint.textContent = '';
  stat.textContent = timerState.sleepRunning ? '入睡 ' + fmt(timerState.sleepBed) + ' · 已过 ' + formatSeconds(elapsed) : '';
  stat.style.display = timerState.sleepRunning ? '' : 'none';
  ring.style.setProperty('--p', String(Math.min(100, elapsed / (8 * 3600) * 100)));
  primary.textContent = timerState.sleepRunning ? '我醒了' : '开始睡觉';
  secondary.textContent = '取消';
  secondary.style.display = timerState.sleepRunning ? '' : 'none';
}

function startSleepClock() {
  if (!state.live || state.monitoring) setTime(nowMinutes(), { live: true, silent: true });
  timerState.sleepStart = Date.now();
  timerState.sleepBed = nowMinutes();
  timerState.sleepDate = dateKey(new Date());
  timerState.elapsed = 0;
  timerState.sleepRunning = true;
  state.sleepBeganAt = 0;
  state.userSleepSide = 0;
  state.userSleepManual = null;
  if (state.mode === 'single') {
    // 单人：随机睡左/右枕头；如果联系人已经躺上床，自动让到另一侧，不挤联系人。
    let side = hash('single-bed:' + Date.now()) < 0.5 ? -1 : 1;
    const c = peopleList().find((p) => !p.me);
    const fig = c && figureMap.get(c.id);
    if (fig && fig.root.position.y > bed.top + 0.02) {
      side = fig.root.position.x >= bed.x ? -1 : 1;
    }
    state.userBedSide = side;
  }
  state.userPhase = 'toBed';
  state.userPhaseAt = Date.now();
  writeStored('mochi3d.sleepTimer.v1', { start: timerState.sleepStart, bed: timerState.sleepBed, date: timerState.sleepDate });
  ensureTimerLoop();
  closeSheet();
  refreshStates();
  renderClock();
  toast('开始记录睡眠 · 躺下后点我可以换睡姿');
}

function stopSleepClock(record) {
  if (!timerState.sleepRunning) return;
  timerState.elapsed = Math.max(0, Math.floor((Date.now() - timerState.sleepStart) / 1000));
  timerState.sleepRunning = false;
  removeStored('mochi3d.sleepTimer.v1');
  if (record) {
    const duration = Math.max(1, Math.round(timerState.elapsed / 60));
    state.sleepLog[timerState.sleepDate] = {
      bed: timerState.sleepBed,
      wake: nowMinutes(),
      duration,
      source: 'timer'
    };
    saveSleepLog();
  } else {
    timerState.elapsed = 0;
  }
  state.userPhase = state.userPhase === 'sleep' ? 'wakeSit' : 'here';
  state.userPhaseAt = Date.now();
  closeSheet();
  refreshStates();
  renderClock();
  toast(record ? '睡觉钟记进日历了' : '取消睡眠记录');
  updateTimerUI();
  stopTimerLoopIfIdle();
}

const FALLBACK_NOTE_CARDS = [
  { t: '今晚早点睡。', g: '便签示例', scope: '示例' },
  { t: '出门记得带伞。', g: '便签示例', scope: '示例' },
  { t: '晚上早点回来。', g: '便签示例', scope: '示例' }
];

function noteCardPool() {
  try {
    if (window.parent !== window && window.parent && typeof window.parent.mochiSleepRoomCards === 'function') {
      const list = window.parent.mochiSleepRoomCards();
      if (Array.isArray(list)) return list;
    }
  } catch (e) {}
  return FALLBACK_NOTE_CARDS;
}

function noteSentence(raw) {
  const t = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!t) return { text: '', extra: false };
  const m = t.match(/^[\s\S]*?[。！？!?…]+[”’"'）)】\]]*/);
  if (!m) return { text: t, extra: false };
  const first = m[0].trim();
  const rest = t.slice(m[0].length).replace(/^[\s"'”’）)】\]，,；;、]+/, '').trim();
  return { text: first, extra: !!rest };
}

function addContactCardNote() {
  const pool = noteCardPool();
  if (!pool.length) return null;
  const contacts = peopleList().filter((p) => !p.me);
  if (!contacts.length) return null;
  const present = contacts.filter((p) => p.state !== 'out');
  const list = present.length ? present : contacts;
  const seed = String(Date.now()) + ':' + state.notes.length;
  const contact = list[Math.floor(hash('note-who:' + seed) * list.length)] || list[0];
  const card = pool[Math.floor(hash('note-card:' + seed) * pool.length)] || pool[0];
  if (!contact || !card || !card.t) return null;
  state.notes.push({ id: 'n' + (state.noteSeq++), who: contact.id, text: card.t, at: nowMinutes() });
  return { contact, card };
}

function openNotesPage() {
  const cards = state.notes.map((n, i) => {
    const a = personById(n.who) || peopleDefs.me;
    const paper = NOTE_COLORS[i % NOTE_COLORS.length];
    const rot = NOTE_ROTS[i % NOTE_ROTS.length];
    return '<article class="sticky" style="--rot:' + rot + ';--paper:' + paper + ';--ink:#1a1a1a">' +
      '<p>' + esc(n.text) + '</p>' +
      '<div class="sticky-meta"><i style="background:' + a.color + '"></i>' + esc(a.name) + ' · ' + fmt(n.at) + '</div>' +
      '</article>';
  }).join('');
  openSheet({
    variant: 'desk',
    title: '桌角便签',
    sub: '你写一句贴到桌上；TA 会用字卡回你一句。',
    body: '<div class="desk-scroll">' +
      '<div class="sticky desk-composer" style="--rot:-0.7deg;--paper:#fbfbfa;--ink:#1a1a1a">' +
        '<textarea class="sticky-input" id="noteText" maxlength="80" placeholder="写一句，贴到桌上…"></textarea>' +
        '<div class="sticky-foot"><span class="sticky-count" id="noteCount">0/80 · 一次一句</span><button class="sticky-save" id="noteSave">贴到桌上</button></div>' +
      '</div>' +
      (cards ? '<div class="desk-grid">' + cards + '</div>' : '<div class="desk-empty">桌上还没有便签。写一句吧。</div>') +
      '</div>',
    onMount(root) {
      const ta = root.querySelector('#noteText');
      const count = root.querySelector('#noteCount');
      const update = () => { count.textContent = Array.from(ta.value).length + '/80 · 一次一句'; };
      ta.addEventListener('input', update);
      update();
      root.querySelector('#noteSave').addEventListener('click', () => {
        const parsed = noteSentence(ta.value);
        if (!parsed.text) return toast('先写一句吧');
        if (parsed.extra) return toast('一次只能写一句，删掉后面的再贴');
        state.notes.push({ id: 'n' + (state.noteSeq++), who: 'me', text: parsed.text, at: nowMinutes() });
        const reply = addContactCardNote();
        openNotesPage();
        toast(reply ? '便签贴好了，' + reply.contact.name + '也回了一句' : '便签贴到桌上了');
      });
    }
  });
}

function openSheet({ title, sub, body, onMount, variant, hideClose }) {
  els.sheetRoot.hidden = false;
  els.sheetRoot.innerHTML = '<div class="sheet-backdrop" data-close></div>' +
    '<div class="sheet ' + (variant || '') + '" role="dialog" aria-modal="true">' +
      '<div class="sheet-grab"></div>' +
      '<div class="sheet-head"><div><h2>' + esc(title) + '</h2>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div>' + (hideClose ? '' : '<button class="sheet-close" data-close aria-label="关闭">×</button>') + '</div>' +
      '<div class="sheet-body">' + body + '</div>' +
    '</div>';
  const root = els.sheetRoot;
  root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeSheet));
  if (onMount) onMount(root);
}

function closeSheet() {
  els.sheetRoot.hidden = true;
  els.sheetRoot.innerHTML = '';
}

function toast(msg) {
  clearTimeout(state.toastTimer);
  els.toast.textContent = msg;
  els.toast.classList.add('on');
  state.toastTimer = setTimeout(() => els.toast.classList.remove('on'), 2400);
}
function closeToast() {
  clearTimeout(state.toastTimer);
  els.toast.classList.remove('on');
}

function fail(msg) {
  els.loader.classList.add('error');
  els.loadText.innerHTML = esc(msg) + '<br><a class="loader-retry" href="../social-sleep-preview/">回到 2D 睡眠小屋</a>';
  els.loadBar.style.width = '0%';
}

function setAnimation(on) {
  running = on;
  if (!renderer) return;
  if (on) {
    lastTime = performance.now();
    renderer.setAnimationLoop(tick);
  } else {
    renderer.setAnimationLoop(null);
  }
}

function onVisibility() {
  if (document.hidden) {
    setAnimation(false);
    if (!timerState.sleepRunning && state.userPhase !== 'sleep' && state.userPhase !== 'out') setUserPhase('out');
  } else {
    setAnimation(true);
    if (state.userPhase === 'out') setUserPhase('here');
  }
}

function tick() {
  if (!running) return;
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  elapsed += dt;
  updateUserPhase();
  const bucket = Math.floor(elapsed / 70);
  if (bucket !== state.contactBucket) {
    state.contactBucket = bucket;
    refreshStates();
  }
  if (state.userPhase === 'sleep') {
    const cuddlePeriod = cuddlePeriodNow();
    if (cuddlePeriod !== state.cuddleBucket) {
      state.cuddleBucket = cuddlePeriod;
      refreshStates();
    }
  } else {
    state.cuddleBucket = -1;
  }
  controls.update();
  constrainView();
  updateFigures(dt);
  updateNoteButton();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);

  if (!lowered && dt > 0.028) lowTime += dt;
  else lowTime = Math.max(0, lowTime - dt * 0.5);
  if (lowTime > 2.5) {
    const dpr = renderer.getPixelRatio();
    if (dpr > 1.05) {
      renderer.setPixelRatio(Math.max(1, dpr - 0.5));
      renderer.setSize(innerWidth, innerHeight);
    }
    lowered = true;
  }
}
