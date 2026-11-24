import { SHIPS, DIFFS, UPGRADES, xpForLevel, gradeFor, type ShipId, type DiffId, type UpgradeDef } from './config';
import { audio, buzz } from './audio';

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: T[]): T => a[(Math.random() * a.length) | 0];
const angDiff = (a: number, b: number) => ((b - a + Math.PI * 3) % TAU) - Math.PI;

export interface BossHud { name: string; hp: number; max: number; enraged: boolean }
export interface HudState {
  score: number; wave: number; best: number;
  hull: number; maxHull: number; shieldT: number;
  xp: number; xpNeed: number; level: number;
  combo: number; comboFrac: number; mult: number;
  bombs: number; maxBombs: number;
  dashFrac: number; dashReady: boolean;
  od: number; odActive: boolean;
  boss: BossHud | null;
  buffs: { shield: number; rapid: number; spread: number; od: number };
  time: number; kills: number;
  hitFlash: number; god: boolean; waveState: string; remaining: number;
  projectiles: number; damage: number; fireRate: number;
}
export interface RunStats {
  score: number; wave: number; best: number; isRecord: boolean;
  kills: number; time: number; level: number; maxCombo: number;
  accuracy: number; ship: ShipId; diff: DiffId; grade: string;
}

interface EngineEvents {
  onHud: (h: HudState) => void;
  onBanner: (main: string, sub: string) => void;
  onToast: (text: string, color?: string) => void;
  onLevelUp: (opts: UpgradeDef[]) => void;
  onGameOver: (s: RunStats) => void;
  onClearDraft?: () => void;
}

interface Settings { sound: boolean; music: boolean; haptics: boolean; shake: boolean; autoFire: boolean; volume: number }

const SAVE_KEY = 'nebula_ascent_v2';
export function loadSave() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    return {
      best: Object.assign({ easy: 0, normal: 0, hard: 0, nightmare: 0 }, raw.best || {}),
      runs: raw.runs || 0, kills: raw.kills || 0, time: raw.time || 0,
      sound: raw.sound ?? true, music: raw.music ?? true, haptics: raw.haptics ?? true,
      shake: raw.shake ?? true, autoFire: raw.autoFire ?? true, volume: raw.volume ?? 0.8,
      ship: (raw.ship as ShipId) || 'vanguard', diff: (raw.diff as DiffId) || 'normal',
    };
  } catch { return { best: { easy: 0, normal: 0, hard: 0, nightmare: 0 }, runs: 0, kills: 0, time: 0, sound: true, music: true, haptics: true, shake: true, autoFire: true, volume: 0.8, ship: 'vanguard' as ShipId, diff: 'normal' as DiffId }; }
}
export function storeSave(s: any) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch {} }

interface Rock { x: number; y: number; vx: number; vy: number; r: number; rot: number; spin: number; hp: number; v: number[]; flash: number; elite?: boolean }
interface Foe { kind: string; x: number; y: number; vx: number; vy: number; r: number; angle: number; c: string; hp: number; maxhp: number; turn: number; score: number; xp: number; fire: number; dodge: number; phase: number; wing: number; spawnT: number; flash: number; elite: boolean; lungeT?: number; lunging?: boolean }
interface Bullet { x: number; y: number; px: number; py: number; vx: number; vy: number; r: number; ttl: number; c: string; foe: boolean; dmg: number; pierce: number; crit: boolean }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string; r: number; drag?: number }
interface Ring { x: number; y: number; r: number; r1: number; c: string; life: number; max: number; w?: number }
interface FloatText { x: number; y: number; t: string; c: string; life: number; size: number }
interface Drop { x: number; y: number; vx: number; vy: number; r: number; kind: string; c: string; g: string; life: number; rot: number }
interface Shard { x: number; y: number; vx: number; vy: number; r: number; val: number; life: number }
interface Trail { x: number; y: number; life: number }

export class Engine {
  cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D;
  ev: EngineEvents;
  W = 0; H = 0; U = 1; DPR = 1;
  quality = 1; frameEMA = 16;
  raf = 0; last = 0; running = false;
  mode: 'menu' | 'game' = 'menu';
  paused = false; draftPause = false;
  over = false; overT = 0; overShown = false;
  time = 0; shakeV = 0; flashV = 0; hitFlash = 0; timeScale = 1; slowT = 0;
  god = false;

  shipId: ShipId = 'vanguard'; diffId: DiffId = 'normal';
  settings: Settings = { sound: true, music: true, haptics: true, shake: true, autoFire: true, volume: 0.8 };
  save: any = loadSave();

  // world arrays
  rocks: Rock[] = []; foes: Foe[] = []; bullets: Bullet[] = [];
  parts: Particle[] = []; rings: Ring[] = []; texts: FloatText[] = [];
  drops: Drop[] = []; shards: Shard[] = []; trail: Trail[] = [];
  boss: any = null;
  stars: any[] = []; nebula: HTMLCanvasElement | null = null; nebula2: HTMLCanvasElement | null = null;

  P = { x: 0, y: 0, vx: 0, vy: 0, angle: -Math.PI / 2, aim: -Math.PI / 2, r: 20, cd: 0, inv: 0, dashCd: 0, dashT: 0, thrust: 0 };
  G = {
    score: 0, wave: 0, lives: 3, maxLives: 3, bombs: 1, maxBombs: 3,
    combo: 0, comboT: 0, maxCombo: 0, mult: 1,
    shield: 0, rapid: 0, spread: 0,
    xp: 0, xpNeed: 14, level: 1, pendingLevels: 0,
    od: 0, odT: 0, kills: 0, runTime: 0,
    interT: 0, foeQueue: [] as string[], foeTimer: 0, bossTimer: 0, waveActive: false,
    shotsFired: 0, shotsHit: 0,
  };
  mods = { fireMul: 1, dmgBonus: 0, projBonus: 0, bSpd: 1, pierce: 0, moveMul: 1, magnetMul: 1, crit: 0, dashMul: 1, odGain: 1, bombMul: 1, guardian: false, regen: false, siphon: 0 };
  stacks: Record<string, number> = {};
  draftOptions: UpgradeDef[] = [];

  keys: Record<string, boolean> = {};
  mouse = { x: 0, y: 0, down: false, seen: false };
  joy = { mx: 0, my: 0 };
  touchFire = false;
  aimAuto = { x: 1, y: 0 };

  hudT = 0;
  glowCache: Record<string, HTMLCanvasElement> = {};
  menuRocksInit = false;

  constructor(cv: HTMLCanvasElement, ev: EngineEvents) {
    this.cv = cv;
    this.ctx = cv.getContext('2d', { alpha: false })!;
    this.ev = ev;
    this.save = loadSave();
    this.shipId = this.save.ship; this.diffId = this.save.diff;
    this.settings = { sound: this.save.sound, music: this.save.music, haptics: this.save.haptics, shake: this.save.shake, autoFire: this.save.autoFire, volume: this.save.volume };
    (window as any).__hapticsOn = this.settings.haptics;
    audio.soundOn = this.settings.sound; audio.musicOn = this.settings.music; audio.setVolume(this.settings.volume);
    this.buildNebula(); this.buildStars();
    this.resize();
  }

  // ============ setup ============
  attach() {
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.cv.addEventListener('pointermove', this.onMouseMove);
    window.addEventListener('pointerdown', this.onMouseDown);
    window.addEventListener('pointerup', this.onMouseUp);
    document.addEventListener('visibilitychange', this.onVis);
    this.running = true; this.last = performance.now();
    const loop = (now: number) => { if (!this.running) return; this.frame(now); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }
  detach() {
    this.running = false; cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.cv.removeEventListener('pointermove', this.onMouseMove);
    window.removeEventListener('pointerdown', this.onMouseDown);
    window.removeEventListener('pointerup', this.onMouseUp);
    document.removeEventListener('visibilitychange', this.onVis);
  }

  resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    const ow = this.W || w, oh = this.H || h;
    this.W = w; this.H = h;
    this.U = clamp(Math.min(w, h) / 640, 0.62, 1.6);
    this.DPR = Math.min(window.devicePixelRatio || 1, this.quality ? 2 : 1.25);
    this.cv.width = Math.round(w * this.DPR); this.cv.height = Math.round(h * this.DPR);
    const sx = w / ow, sy = h / oh;
    if (Math.abs(sx - 1) > 0.02 || Math.abs(sy - 1) > 0.02) {
      for (const arr of [this.rocks, this.foes, this.bullets, this.parts, this.drops, this.shards] as any[][]) {
        for (const o of arr) { o.x *= sx; o.y *= sy; }
      }
      this.P.x *= sx; this.P.y *= sy;
      this.P.x = clamp(this.P.x, 20, w - 20); this.P.y = clamp(this.P.y, 20, h - 20);
    }
    this.P.r = 19 * this.U;
  };

  onVis = () => { if (document.hidden && this.mode === 'game' && !this.over && !this.paused) this.setPaused(true); };
  onBlur = () => { this.keys = {}; this.mouse.down = false; this.touchFire = false; this.joy.mx = 0; this.joy.my = 0; };
  onKeyDown = (e: KeyboardEvent) => {
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
    this.keys[e.code] = true; audio.init();
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.queueDash();
    if (e.code === 'KeyE' || e.code === 'KeyB') this.queueBomb();
    if (e.code === 'KeyQ' || e.code === 'KeyF') this.queueOverdrive();
    if (e.code === 'Escape' && this.mode === 'game' && !this.over && !this.draftPause) this.setPaused(!this.paused);
    if (e.code === 'KeyM') { this.settings.sound = !this.settings.sound; audio.setSoundOn(this.settings.sound); this.persist(); this.emitHud(true); }
    if (e.code === 'KeyR' && this.mode === 'game' && (this.over || this.paused)) this.startGame();
    this.konami(e.code);
  };
  onKeyUp = (e: KeyboardEvent) => { this.keys[e.code] = false; };
  onMouseMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.seen = true;
  };
  onMouseDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    audio.init();
    if ((e.target as HTMLElement)?.closest?.('button')) return;
    if (this.mode === 'game' && !this.paused && !this.over) this.mouse.down = true;
  };
  onMouseUp = () => { this.mouse.down = false; };

  kIdx = 0;
  konami(code: string) {
    const seq = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight'];
    if (code === seq[this.kIdx]) { this.kIdx++; if (this.kIdx >= seq.length) { this.toggleGod(); this.kIdx = 0; } }
    else this.kIdx = code === seq[0] ? 1 : 0;
  }
  toggleGod() {
    this.god = !this.god;
    this.ev.onToast(this.god ? 'IMMORTAL MODE ENGAGED' : 'MORTALITY RESTORED', this.god ? '#ffd700' : '#4df0ff');
    audio.level(); buzz([20, 40, 20]);
  }

  persist() {
    this.save.sound = this.settings.sound; this.save.music = this.settings.music;
    this.save.haptics = this.settings.haptics; this.save.shake = this.settings.shake;
    this.save.autoFire = this.settings.autoFire; this.save.volume = this.settings.volume;
    this.save.ship = this.shipId; this.save.diff = this.diffId;
    storeSave(this.save);
    (window as any).__hapticsOn = this.settings.haptics;
  }

  configure(ship: ShipId, diff: DiffId, s?: Partial<Settings>) {
    this.shipId = ship; this.diffId = diff;
    if (s) Object.assign(this.settings, s);
    (window as any).__hapticsOn = this.settings.haptics;
    audio.soundOn = this.settings.sound; audio.setVolume(this.settings.volume);
    if (this.settings.music) { audio.musicOn = true; audio.init(); audio.startMusic(); } else audio.stopMusic();
    this.persist();
  }

  // ============ flow ============
  toMenu() {
    this.mode = 'menu'; this.paused = false; this.draftPause = false; this.over = false; this.boss = null;
    this.rocks.length = 0; this.foes.length = 0; this.bullets.length = 0; this.drops.length = 0; this.texts.length = 0;
    this.menuRocksInit = false;
    audio.startMusic();
  }

  startGame() {
    const D = DIFFS[this.diffId], S = SHIPS[this.shipId];
    audio.init(); audio.startMusic();
    this.mode = 'game'; this.paused = false; this.draftPause = false;
    this.over = false; this.overT = 0; this.overShown = false;
    this.rocks.length = 0; this.foes.length = 0; this.bullets.length = 0;
    this.parts.length = 0; this.drops.length = 0; this.texts.length = 0; this.shards.length = 0; this.rings.length = 0; this.trail.length = 0;
    this.boss = null;
    this.G = {
      score: 0, wave: 0, lives: D.lives, maxLives: D.lives, bombs: D.bombs, maxBombs: 3,
      combo: 0, comboT: 0, maxCombo: 0, mult: 1, shield: 0, rapid: 0, spread: 0,
      xp: 0, xpNeed: xpForLevel(1), level: 1, pendingLevels: 0,
      od: 0, odT: 0, kills: 0, runTime: 0,
      interT: 0, foeQueue: [], foeTimer: 0, bossTimer: 0, waveActive: false,
      shotsFired: 0, shotsHit: 0,
    };
    this.mods = { fireMul: 1, dmgBonus: 0, projBonus: 0, bSpd: 1, pierce: 0, moveMul: 1, magnetMul: 1, crit: 0, dashMul: 1, odGain: 1, bombMul: 1, guardian: false, regen: false, siphon: 0 };
    this.stacks = {};
    this.P = { x: this.W / 2, y: this.H * 0.62, vx: 0, vy: 0, angle: -Math.PI / 2, aim: -Math.PI / 2, r: 19 * this.U, cd: 0, inv: 2.2, dashCd: 0, dashT: 0, thrust: 0 };
    this.timeScale = 1; this.slowT = 0; this.shakeV = 0; this.flashV = 0; this.hitFlash = 0;
    if (S.id === 'bastion') this.G.maxBombs = 4;
    this.startWave(1);
    this.emitHud(true);
  }

  setPaused(b: boolean) {
    if (this.mode !== 'game' || this.over || this.draftPause) return;
    this.paused = b;
    this.joy.mx = 0; this.joy.my = 0; this.touchFire = false; this.mouse.down = false;
    this.emitHud(true);
  }

  setMove(x: number, y: number) { this.joy.mx = x; this.joy.my = y; }
  setFiring(b: boolean) { this.touchFire = b; }

  chooseUpgrade(id: string) {
    const def = UPGRADES.find(u => u.id === id);
    if (!def) return;
    this.stacks[id] = (this.stacks[id] || 0) + 1;
    const m = this.mods;
    switch (id) {
      case 'overclock': m.fireMul *= 0.85; break;
      case 'heavy': m.dmgBonus += 1; break;
      case 'split': m.projBonus += 1; break;
      case 'velocity': m.bSpd *= 1.25; m.pierce += 1; break;
      case 'thrusters': m.moveMul *= 1.12; break;
      case 'magnet': m.magnetMul *= 1.55; break;
      case 'plating': this.G.maxLives += 1; this.G.lives = Math.min(this.G.maxLives, this.G.lives + 1); break;
      case 'dashcore': m.dashMul *= 0.78; break;
      case 'odcell': m.odGain *= 1.35; break;
      case 'crit': m.crit += 0.15; break;
      case 'guardian': m.guardian = true; this.G.shield = Math.max(this.G.shield, 6); break;
      case 'arsenal': this.G.maxBombs += 1; this.G.bombs = Math.min(this.G.maxBombs, this.G.bombs + 1); m.bombMul *= 1.6; break;
      case 'regen': m.regen = true; break;
      case 'vampire': m.siphon += 1; break;
    }
    audio.level(); buzz(20);
    this.burstFX(this.P.x, this.P.y, '#ffef7a', 22, 260);
    this.ringFX(this.P.x, this.P.y, '#ffef7a', 10, 90 * this.U, 0.5);
    this.ev.onToast(def.name.toUpperCase() + ' ACQUIRED', '#ffef7a');
    this.G.pendingLevels = Math.max(0, this.G.pendingLevels - 1);
    if (this.G.pendingLevels > 0) {
      this.draftOptions = this.rollUpgrades();
      this.ev.onLevelUp(this.draftOptions);
    } else {
      this.draftPause = false;
      this.ev.onClearDraft?.();
    }
    this.emitHud(true);
  }

  rollUpgrades(): UpgradeDef[] {
    const avail = UPGRADES.filter(u => (this.stacks[u.id] || 0) < u.max);
    const out: UpgradeDef[] = [];
    const pool = [...avail];
    // weight epic lower
    pool.sort(() => Math.random() - 0.5);
    while (out.length < 3 && pool.length) {
      const i = Math.floor(Math.random() * pool.length);
      const u = pool[i];
      if (u.rarity === 'epic' && Math.random() < 0.45 && out.length < 2 && pool.length > 3) continue;
      out.push(u); pool.splice(i, 1);
    }
    return out;
  }


  // ============ helpers ============
  rgb(hex: string): [number, number, number] {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    return [parseInt(h.substr(0,2),16), parseInt(h.substr(2,2),16), parseInt(h.substr(4,2),16)];
  }
  glow(color: string, r: number) {
    r = Math.max(4, Math.round(r));
    const k = color + '_' + r;
    if (this.glowCache[k]) return this.glowCache[k];
    const s = r * 2, c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d')!;
    const v = this.rgb(color);
    const grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, `rgba(${v[0]},${v[1]},${v[2]},1)`);
    grd.addColorStop(0.25, `rgba(${v[0]},${v[1]},${v[2]},.55)`);
    grd.addColorStop(0.6, `rgba(${v[0]},${v[1]},${v[2]},.14)`);
    grd.addColorStop(1, `rgba(${v[0]},${v[1]},${v[2]},0)`);
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    this.glowCache[k] = c; return c;
  }
  buildNebula() {
    const mk = (seed: number) => {
      const s = 420, c = document.createElement('canvas'); c.width = c.height = s;
      const g = c.getContext('2d')!;
      const cols = seed === 0 ? ['#1d3f96','#6b1f8f','#0e6f86','#2a2f7a'] : ['#8f2a5e','#1d3f96','#0e6f86','#3a1f7a'];
      let rnd = seed * 999 + 7;
      const sr = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
      for (let i = 0; i < 10; i++) {
        const x = sr()*s, y = sr()*s, r = s*(0.16+sr()*0.3);
        const v = this.rgb(cols[i % cols.length]);
        const grd = g.createRadialGradient(x,y,0,x,y,r);
        grd.addColorStop(0, `rgba(${v[0]},${v[1]},${v[2]},.5)`);
        grd.addColorStop(1, `rgba(${v[0]},${v[1]},${v[2]},0)`);
        g.fillStyle = grd; g.beginPath(); g.arc(x,y,r,0,TAU); g.fill();
      }
      return c;
    };
    this.nebula = mk(0); this.nebula2 = mk(1);
  }
  buildStars() {
    this.stars.length = 0;
    const n = this.quality ? 190 : 100;
    for (let i = 0; i < n; i++) {
      const layer = i % 3;
      this.stars.push({ x: Math.random(), y: Math.random(), l: layer, s: (layer+1)*0.5 + Math.random()*0.8, tw: Math.random()*TAU, sp: (layer+1)*3 });
    }
  }
  wrap(o: any, m = 0) {
    if (o.x < -m) o.x = this.W + m; else if (o.x > this.W + m) o.x = -m;
    if (o.y < -m) o.y = this.H + m; else if (o.y > this.H + m) o.y = -m;
  }
  edgeSpawn(pad: number) {
    let x = 0, y = 0;
    for (let k = 0; k < 14; k++) {
      const e = (Math.random()*4)|0;
      if (e === 0) { x = rand(0,this.W); y = -pad; }
      else if (e === 1) { x = this.W + pad; y = rand(0,this.H); }
      else if (e === 2) { x = rand(0,this.W); y = this.H + pad; }
      else { x = -pad; y = rand(0,this.H); }
      if (Math.hypot(x - this.P.x, y - this.P.y) > 230 * this.U) break;
    }
    return { x, y };
  }
  burstFX(x: number, y: number, color: string, n: number, spd = 230) {
    n = Math.round(n * (this.quality ? 1 : 0.5));
    const cap = this.quality ? 480 : 200;
    for (let i = 0; i < n && this.parts.length < cap; i++) {
      const a = rand(0, TAU), s = rand(0.25, 1) * spd * this.U;
      this.parts.push({ x, y, vx: Math.cos(a)*s, vy: Math.sin(a)*s, life: rand(0.3, 0.9), max: 0.9, c: color, r: rand(2, 5)*this.U });
    }
  }
  ringFX(x: number, y: number, color: string, r0: number, r1: number, life: number) {
    this.rings.push({ x, y, r: r0, r1, c: color, life, max: life });
  }
  textFX(x: number, y: number, t: string, c = '#ffef7a', size = 13) {
    this.texts.push({ x: clamp(x, 50, this.W-50), y, t, c, life: 0.95, size: size * this.U });
  }
  shake(v: number) { if (this.settings.shake) this.shakeV = Math.min(26 * this.U, this.shakeV + v); }

  addScore(base: number, x?: number, y?: number) {
    const D = DIFFS[this.diffId];
    const v = Math.round(base * this.G.mult * D.mul);
    this.G.score += v;
    if (x !== undefined) this.textFX(x, y!, '+' + v, '#ffef7a');
  }
  bumpCombo() {
    this.G.combo++; this.G.comboT = 3.4;
    this.G.maxCombo = Math.max(this.G.maxCombo, this.G.combo);
    const m = clamp(1 + Math.floor(this.G.combo / 4), 1, 9);
    if (m !== this.G.mult) { this.G.mult = m; }
  }
  gainXp(v: number, x: number, y: number) {
    const D = DIFFS[this.diffId];
    this.G.xp += v * D.xpMul;
    while (this.G.xp >= this.G.xpNeed) {
      this.G.xp -= this.G.xpNeed;
      this.G.level++;
      this.G.xpNeed = xpForLevel(this.G.level);
      this.G.pendingLevels++;
    }
    if (this.G.pendingLevels > 0 && !this.draftPause && !this.over) {
      this.draftPause = true;
      this.draftOptions = this.rollUpgrades();
      audio.level();
      this.ringFX(x, y, '#ffef7a', 10, 120 * this.U, 0.6);
      this.ev.onLevelUp(this.draftOptions);
    }
  }
  chargeOd(v: number) {
    if (this.G.odT > 0) return;
    this.G.od = clamp(this.G.od + v * this.mods.odGain, 0, 100);
  }

  // ============ spawning ============
  rockVerts(n: number) { const v: number[] = []; for (let i = 0; i < n; i++) v.push(0.72 + Math.random()*0.4); return v; }
  makeRock(x: number, y: number, r: number, spdMul = 1, elite = false) {
    const D = DIFFS[this.diffId];
    const a = rand(0, TAU), s = rand(38, 84) * this.U * D.rockSpd * spdMul;
    this.rocks.push({ x, y, vx: Math.cos(a)*s, vy: Math.sin(a)*s, r, rot: rand(0,TAU), spin: rand(-1.1,1.1),
      hp: Math.max(1, Math.round(r / (20*this.U)) + (elite ? 2 : 0)), v: this.rockVerts(11), flash: 0, elite });
  }
  spawnRock() { const r = rand(46, 62) * this.U; const p = this.edgeSpawn(r + 10); this.makeRock(p.x, p.y, r); }
  spawnFoe(kind?: string, eliteForce?: boolean) {
    const D = DIFFS[this.diffId];
    const r = 16 * this.U, p = this.edgeSpawn(r + 26);
    const k = kind || pick(['seeker','gunner','weaver','darter','splitter']);
    const base: any = {
      seeker: { hp: 2, turn: 4.4, score: 120, xp: 3 },
      darter: { hp: 2, turn: 5.2, score: 140, xp: 3 },
      gunner: { hp: 3, turn: 3.0, score: 180, xp: 4 },
      weaver: { hp: 2, turn: 3.6, score: 150, xp: 4 },
      splitter: { hp: 7, turn: 2.2, score: 260, xp: 7 },
    }[k];
    const elite = eliteForce ?? (this.G.wave >= 4 && Math.random() < 0.1 + this.G.wave * 0.008);
    this.foes.push({ kind: k, x: p.x, y: p.y, vx: 0, vy: 0, r: r * (k === 'splitter' ? 1.6 : 1) * (elite ? 1.3 : 1),
      angle: Math.atan2(this.P.y - p.y, this.P.x - p.x),
      c: k === 'seeker' ? '#ff8f5e' : k === 'gunner' ? '#ff5ef2' : k === 'weaver' ? '#5eff8f' : k === 'darter' ? '#ffd27f' : '#b95eff',
      hp: base.hp + D.foeHP + (elite ? 4 : 0) + Math.floor(this.G.wave / 6), maxhp: base.hp + D.foeHP + (elite ? 4 : 0) + Math.floor(this.G.wave / 6),
      turn: base.turn, score: elite ? base.score * 3 : base.score, xp: elite ? base.xp * 3 : base.xp,
      fire: rand(0.8, 2) * D.foeFire, dodge: rand(0.5, 1.4), phase: rand(0, TAU), wing: (Math.random()*3)|0,
      spawnT: 0.75, flash: 0, elite, lungeT: 0, lunging: false });
  }
  spawnBoss() {
    const D = DIFFS[this.diffId];
    const hp = Math.round((54 + this.G.wave * 10) * D.bossHP);
    this.boss = { x: this.W/2, y: -90*this.U, vx: 0, vy: 36*this.U, r: 62*this.U, angle: Math.PI/2,
      hp, maxhp: hp, fire: 2.2, pattern: 0, patT: 0, spin: 0, spawnT: 1.4, flash: 0, enraged: false, phase2: false };
    this.ev.onBanner('DREADNOUGHT', 'capital ship inbound — break its core');
    audio.warn(); buzz([30, 60, 30]);
  }

  startWave(n: number) {
    const D = DIFFS[this.diffId];
    this.G.wave = n; this.G.waveActive = true;
    if (this.mods.guardian) this.G.shield = Math.max(this.G.shield, 7);
    if (this.mods.regen && n % 3 === 0 && this.G.lives < this.G.maxLives) { this.G.lives++; this.ev.onToast('NANO WEAVE: HULL RESTORED', '#5eff8f'); }
    if (n % 5 === 0) {
      this.G.bossTimer = 1.1;
      for (let i = 0; i < 3; i++) this.spawnRock();
      this.G.foeQueue = [];
      this.ev.onBanner('WARNING', 'massive signature approaching');
      audio.warn();
    } else {
      const rc = Math.min(11, Math.round(D.rockBase + n * D.rockPer));
      for (let i = 0; i < rc; i++) this.spawnRock();
      const fq = Math.min(15, Math.round(D.foeBase + n * D.foePer));
      this.G.foeQueue = [];
      const pool = n < 2 ? ['seeker','seeker','gunner'] : n < 4 ? ['seeker','gunner','weaver','darter'] : ['seeker','gunner','weaver','darter','splitter','seeker'];
      for (let i = 0; i < fq; i++) this.G.foeQueue.push(pick(pool));
      this.G.foeTimer = 0.6;
      this.ev.onBanner('WAVE ' + n, n === 1 ? 'hold the line, pilot' : pick(['hostiles detected','they keep coming','stay sharp','no retreat']));
      audio.wave();
    }
    this.emitHud(true);
  }

  waveLogic(dt: number) {
    const D = DIFFS[this.diffId];
    if (this.G.bossTimer > 0) { this.G.bossTimer -= dt; if (this.G.bossTimer <= 0) this.spawnBoss(); }
    if (this.G.foeQueue.length > 0) {
      this.G.foeTimer -= dt;
      if (this.G.foeTimer <= 0 && this.foes.length < D.foeMax) {
        const k = this.G.foeQueue.shift()!;
        this.spawnFoe(k); this.G.foeTimer = rand(1.6, 3.1);
      }
    }
    if (this.G.interT > 0) {
      this.G.interT -= dt;
      if (this.G.interT <= 0) this.startWave(this.G.wave + 1);
      return;
    }
    if (this.G.waveActive && !this.boss && this.G.bossTimer <= 0 && this.rocks.length === 0 && this.foes.length === 0 && this.G.foeQueue.length === 0) {
      this.G.waveActive = false;
      const D2 = DIFFS[this.diffId];
      const bonus = Math.round(120 * this.G.wave * D2.mul);
      this.G.score += bonus;
      this.ev.onBanner('WAVE CLEAR', '+' + bonus + ' salvage bonus');
      audio.wave(); buzz(18);
      if (this.G.lives < this.G.maxLives && this.G.wave % 3 === 0) { this.G.lives++; this.ev.onToast('HULL RESTORED', '#5eff8f'); }
      this.chargeOd(12);
      this.G.interT = 2.4;
      this.emitHud(true);
    }
  }


  // ============ player actions ============
  firePlayer() {
    const S = SHIPS[this.shipId];
    const total = S.projectiles + this.mods.projBonus;
    const spreadStep = total > 1 ? 0.16 : 0;
    const odMul = this.G.odT > 0 ? 2 : 1;
    for (let i = 0; i < total; i++) {
      const off = (i - (total - 1) / 2) * spreadStep + rand(-0.02, 0.02);
      const a = this.P.aim + off;
      const sx = this.P.x + Math.cos(a) * this.P.r, sy = this.P.y + Math.sin(a) * this.P.r;
      const crit = Math.random() < this.mods.crit;
      const dmg = (S.damage + this.mods.dmgBonus) * odMul * (crit ? 2.5 : 1);
      this.bullets.push({ x: sx, y: sy, px: sx, py: sy,
        vx: this.P.vx * 0.25 + Math.cos(a) * 800 * this.U * this.mods.bSpd,
        vy: this.P.vy * 0.25 + Math.sin(a) * 800 * this.U * this.mods.bSpd,
        r: (crit ? 4.6 : 3.6) * this.U, ttl: 1.15, c: crit ? '#ffef7a' : this.G.odT > 0 ? '#ffd27f' : '#6ef2ff',
        foe: false, dmg, pierce: this.mods.pierce, crit });
      this.G.shotsFired++;
    }
    const base = S.fireRate * this.mods.fireMul * (this.G.rapid > 0 ? 0.5 : 1) * (this.G.odT > 0 ? 0.45 : 1);
    this.P.cd = base;
    if (total > 2) audio.rail(); else audio.shoot();
  }

  queueDash() {
    if (this.mode !== 'game' || this.paused || this.draftPause || this.over) return;
    const S = SHIPS[this.shipId];
    if (this.P.dashCd > 0) return;
    this.P.dashCd = S.dashCd * this.mods.dashMul;
    this.P.dashT = 0.22; this.P.inv = Math.max(this.P.inv, 0.32);
    const moving = Math.hypot(this.joy.mx, this.joy.my) > 0.15;
    const a = moving ? Math.atan2(this.joy.my, this.joy.mx) : this.P.aim;
    this.P.vx += Math.cos(a) * 640 * this.U;
    this.P.vy += Math.sin(a) * 640 * this.U;
    this.ringFX(this.P.x, this.P.y, '#4df0ff', this.P.r, this.P.r * 3.6, 0.35);
    for (let i = 0; i < 10; i++) this.trail.push({ x: this.P.x + rand(-6,6), y: this.P.y + rand(-6,6), life: 0.4 });
    audio.dash(); buzz(12);
  }

  queueBomb() {
    if (this.mode !== 'game' || this.paused || this.draftPause || this.over) return;
    if (this.G.bombs <= 0) { audio.deny(); this.ev.onToast('NO PULSE BOMBS', '#ff5e9c'); return; }
    this.G.bombs--;
    const power = 4 * this.mods.bombMul;
    this.ringFX(this.P.x, this.P.y, '#ff5e9c', 20*this.U, Math.max(this.W,this.H)*0.85, 0.6);
    this.ringFX(this.P.x, this.P.y, '#ffffff', 10*this.U, Math.max(this.W,this.H)*0.5, 0.4);
    this.shake(20*this.U); this.flashV = 0.5;
    audio.bomb(); buzz([25, 35, 60]);
    for (let i = this.bullets.length - 1; i >= 0; i--) if (this.bullets[i].foe) this.bullets.splice(i, 1);
    for (let i = this.rocks.length - 1; i >= 0; i--) {
      const r = this.rocks[i];
      this.burstFX(r.x, r.y, '#a4f6ff', 12);
      this.addScore(30, r.x, r.y); this.bumpCombo(); this.dropShard(r.x, r.y, 1);
      this.rocks.splice(i, 1);
    }
    for (let i = this.foes.length - 1; i >= 0; i--) {
      const f = this.foes[i];
      f.hp -= power; f.flash = 0.2;
      this.burstFX(f.x, f.y, f.c, 14);
      if (f.hp <= 0) this.killFoe(i);
    }
    if (this.boss) { this.boss.hp -= 12 * this.mods.bombMul; this.boss.flash = 0.25; if (this.boss.hp <= 0) this.killBoss(); }
    this.emitHud(true);
  }

  queueOverdrive() {
    if (this.mode !== 'game' || this.paused || this.draftPause || this.over) return;
    if (this.G.odT > 0) return;
    if (this.G.od < 100) { audio.deny(); this.ev.onToast('OVERDRIVE NOT READY', '#8ea4bd'); return; }
    this.G.od = 0; this.G.odT = 6;
    this.ringFX(this.P.x, this.P.y, '#ffef7a', 10, 200*this.U, 0.7);
    this.shake(12*this.U);
    audio.overdrive(); buzz([40, 30, 60]);
    this.ev.onBanner('OVERDRIVE', 'all systems beyond limits');
    this.emitHud(true);
  }

  damage() {
    if (this.god || this.P.inv > 0 || this.over) return;
    if (this.G.odT > 0) return; // invulnerable during overdrive
    if (this.G.shield > 0) {
      this.G.shield = 0; this.P.inv = 1.1;
      this.ringFX(this.P.x, this.P.y, '#4df0ff', this.P.r, this.P.r*4, 0.4);
      this.burstFX(this.P.x, this.P.y, '#4df0ff', 18);
      this.shake(8*this.U); audio.tick(); buzz(20);
      this.ev.onToast('SHIELD DOWN', '#4df0ff');
      this.emitHud(true);
      return;
    }
    this.G.lives--;
    this.G.combo = 0; this.G.mult = 1;
    this.burstFX(this.P.x, this.P.y, '#6ef2ff', 34, 300);
    this.ringFX(this.P.x, this.P.y, '#ff2b5e', this.P.r, this.P.r*5, 0.45);
    this.shake(16*this.U); this.flashV = 0.55; this.hitFlash = 1;
    audio.hurt(); buzz([40, 50, 40]);
    this.chargeOd(10);
    if (this.G.lives <= 0) {
      this.over = true; this.overT = 0;
      this.burstFX(this.P.x, this.P.y, '#ffd27f', 60, 380);
      this.burstFX(this.P.x, this.P.y, '#ff5e9c', 40, 300);
      this.ringFX(this.P.x, this.P.y, '#ffd27f', this.P.r, this.P.r*8, 0.8);
      audio.boom(true); this.shake(24*this.U);
      this.slowT = 0.7; this.timeScale = 0.25;
      return;
    }
    this.P.x = this.W/2; this.P.y = this.H/2; this.P.vx = this.P.vy = 0; this.P.angle = -Math.PI/2;
    this.P.inv = 2.4;
    this.emitHud(true);
  }

  dropShard(x: number, y: number, val: number) {
    if (this.shards.length > 160) return;
    const a = rand(0, TAU);
    this.shards.push({ x, y, vx: Math.cos(a)*rand(40,140)*this.U, vy: Math.sin(a)*rand(40,140)*this.U, r: 5*this.U, val, life: 14 });
  }

  killFoe(i: number) {
    const f = this.foes[i];
    this.burstFX(f.x, f.y, f.c, f.elite ? 40 : 26, 280);
    this.burstFX(f.x, f.y, '#ffd27f', 12, 200);
    this.ringFX(f.x, f.y, f.c, f.r, f.r*4, 0.35);
    this.addScore(f.score, f.x, f.y); this.bumpCombo();
    this.G.kills++;
    this.chargeOd(f.elite ? 8 : 3);
    this.dropShard(f.x, f.y, f.xp);
    if (f.kind === 'splitter') {
      for (let k = 0; k < 3; k++) {
        const a = (TAU * k) / 3 + rand(-0.3, 0.3);
        this.foes.push({ kind: 'seeker', x: f.x + Math.cos(a)*20, y: f.y + Math.sin(a)*20,
          vx: Math.cos(a)*200*this.U, vy: Math.sin(a)*200*this.U, r: 12*this.U, angle: a,
          c: '#ff8f5e', hp: 1, maxhp: 1, turn: 5, score: 40, xp: 1, fire: 99, dodge: 1, phase: rand(0,TAU), wing: 0, spawnT: 0.3, flash: 0, elite: false });
      }
    }
    this.maybeDrop(f.x, f.y, f.elite ? 1 : 0.2);
    if (this.mods.siphon > 0) {
      this.chargeOd(4 * this.mods.siphon);
      if (Math.random() < 0.06 * this.mods.siphon && this.G.lives < this.G.maxLives) { this.G.lives++; this.ev.onToast('SIPHON: HULL +1', '#5eff8f'); }
    }
    audio.boom(false); this.shake(5*this.U); buzz(10);
    this.foes.splice(i, 1);
    this.emitHud(true);
  }

  killBoss() {
    const b = this.boss;
    if (!b) return;
    const bx = b.x, by = b.y;
    for (let i = 0; i < 10; i++) {
      setTimeout(() => {
        if (this.mode !== 'game') return;
        this.burstFX(bx + rand(-b.r, b.r), by + rand(-b.r, b.r), pick(['#ffd27f','#ff5e9c','#ffffff']), 26, 320);
        audio.boom(true); this.shake(12*this.U);
      }, i * 100);
    }
    this.ringFX(bx, by, '#ff5e9c', b.r, Math.max(this.W,this.H)*0.7, 0.9);
    this.addScore(2200, bx, by); this.bumpCombo();
    this.G.kills += 5;
    this.chargeOd(40);
    for (let i = 0; i < 4; i++) this.dropShard(bx + rand(-50,50)*this.U, by + rand(-50,50)*this.U, 4);
    for (let i = 0; i < 2; i++) this.maybeDrop(bx + rand(-40,40)*this.U, by + rand(-40,40)*this.U, 1);
    this.boss = null;
    this.flashV = 0.6; this.shake(26*this.U); buzz([50, 40, 90]);
    this.slowT = 0.5; this.timeScale = 0.3;
    this.ev.onBanner('DREADNOUGHT DESTROYED', 'the void grows quiet');
    this.emitHud(true);
  }

  foeShoot(f: any, angle: number, speed: number, count: number, spread: number) {
    for (let i = 0; i < count; i++) {
      const a = angle + (count > 1 ? (i - (count-1)/2) * spread : 0);
      const sx = f.x + Math.cos(a)*f.r, sy = f.y + Math.sin(a)*f.r;
      this.bullets.push({ x: sx, y: sy, px: sx, py: sy, vx: Math.cos(a)*speed*this.U, vy: Math.sin(a)*speed*this.U,
        r: 3.4*this.U, ttl: 2.6, c: '#ff9f45', foe: true, dmg: 1, pierce: 0, crit: false });
    }
    audio.eshoot();
  }

  maybeDrop(x: number, y: number, chance: number) {
    if (Math.random() > chance) return;
    const kinds = [
      { kind: 'shield', c: '#4df0ff', g: 'S' }, { kind: 'rapid', c: '#ffef7a', g: 'R' },
      { kind: 'spread', c: '#ff8f5e', g: 'W' }, { kind: 'bomb', c: '#ff5e9c', g: 'B' },
      { kind: 'repair', c: '#5eff8f', g: '+' }, { kind: 'odcell', c: '#ffd700', g: 'O' },
    ];
    let t = pick(kinds);
    if (t.kind === 'repair' && this.G.lives >= this.G.maxLives) t = kinds[0];
    if (t.kind === 'bomb' && this.G.bombs >= this.G.maxBombs) t = kinds[5];
    const a = rand(0, TAU);
    this.drops.push({ x, y, vx: Math.cos(a)*30*this.U, vy: Math.sin(a)*30*this.U, r: 13*this.U, kind: t.kind, c: t.c, g: t.g, life: 13, rot: 0 });
  }

  applyDrop(kind: string) {
    const labels: Record<string, string> = {
      shield: 'AEGIS SHIELD ONLINE', rapid: 'RAPID FIRE', spread: 'TRIPLE SHOT',
      bomb: '+1 PULSE BOMB', repair: 'HULL REPAIRED', odcell: 'OVERDRIVE +30',
    };
    if (kind === 'shield') this.G.shield = 9;
    else if (kind === 'rapid') this.G.rapid = 10;
    else if (kind === 'spread') this.G.spread = 12;
    else if (kind === 'bomb') this.G.bombs = Math.min(this.G.maxBombs, this.G.bombs + 1);
    else if (kind === 'repair') this.G.lives = Math.min(this.G.maxLives, this.G.lives + 1);
    else if (kind === 'odcell') this.chargeOd(30);
    this.ev.onToast(labels[kind] || 'PICKUP', kind === 'repair' ? '#5eff8f' : '#ffef7a');
    audio.grab(); buzz(14);
    this.emitHud(true);
  }


  // ============ updates ============
  updatePlayer(dt: number) {
    const S = SHIPS[this.shipId];
    let mx = this.joy.mx, my = this.joy.my;
    const kx = ((this.keys.KeyD || this.keys.ArrowRight) ? 1 : 0) - ((this.keys.KeyA || this.keys.ArrowLeft) ? 1 : 0);
    const ky = ((this.keys.KeyS || this.keys.ArrowDown) ? 1 : 0) - ((this.keys.KeyW || this.keys.ArrowUp) ? 1 : 0);
    if (kx || ky) { const l = Math.hypot(kx, ky); mx = kx / l; my = ky / l; }
    const mag = Math.min(1, Math.hypot(mx, my));
    this.P.thrust = 0;
    if (mag > 0.12) {
      const target = Math.atan2(my, mx);
      const d = angDiff(this.P.angle, target);
      this.P.angle += clamp(d, -8.5 * dt, 8.5 * dt);
      const th = S.speed * this.U * mag * this.mods.moveMul * (this.G.odT > 0 ? 1.2 : 1);
      this.P.vx += Math.cos(this.P.angle) * th * dt * 2.2;
      this.P.vy += Math.sin(this.P.angle) * th * dt * 2.2;
      this.P.thrust = mag;
      if (Math.random() < mag * 0.85) {
        const a = this.P.angle + Math.PI + rand(-0.3, 0.3);
        this.parts.push({ x: this.P.x + Math.cos(a)*this.P.r*0.9, y: this.P.y + Math.sin(a)*this.P.r*0.9,
          vx: Math.cos(a)*rand(60,150)*this.U + this.P.vx*0.3, vy: Math.sin(a)*rand(60,150)*this.U + this.P.vy*0.3,
          life: rand(0.15,0.35), max: 0.35, c: Math.random()<0.5 ? '#ff9f45' : '#ffe47a', r: rand(1.5,3)*this.U });
      }
    }
    // aim
    const desktopAim = this.mouse.seen && !('ontouchstart' in window && window.matchMedia('(pointer: coarse)').matches && !this.mouse.down);
    if (this.mouse.seen && (this.mouse.down || this.keys.Space || Math.abs(this.mouse.x - this.P.x) > 4)) {
      if (!(Math.abs(mx) > 0.1 || Math.abs(my) > 0.1) || this.mouse.down || this.keys.Space) {
        const want = Math.atan2(this.mouse.y - this.P.y, this.mouse.x - this.P.x);
        if (Math.hypot(this.mouse.x - this.P.x, this.mouse.y - this.P.y) > 30) this.P.aim = want;
      } else this.P.aim = this.P.angle;
    } else if (mag > 0.12) {
      // auto-aim: nearest enemy, else movement dir
      let best: any = null, bd = 1e9;
      for (const f of this.foes) { const d = Math.hypot(f.x - this.P.x, f.y - this.P.y); if (d < bd) { bd = d; best = f; } }
      if (!best && this.boss) best = this.boss;
      if (!best) for (const r of this.rocks) { const d = Math.hypot(r.x - this.P.x, r.y - this.P.y); if (d < bd) { bd = d; best = r; } }
      if (best && bd < 700 * this.U) this.P.aim = Math.atan2(best.y - this.P.y, best.x - this.P.x);
      else this.P.aim = this.P.angle;
    }
    void desktopAim;
    // idle auto-aim sweep (mobile + autofire): track nearest hostile even when stationary
    if (mag <= 0.12 && !this.mouse.down && !this.keys.Space) {
      let best: any = null, bd = 1e9;
      const consider = (o: any) => { const d = Math.hypot(o.x - this.P.x, o.y - this.P.y); if (d < bd) { bd = d; best = o; } };
      for (const f2 of this.foes) if (f2.spawnT <= 0) consider(f2);
      if (this.boss && this.boss.spawnT <= 0) consider(this.boss);
      if (!best) for (const r of this.rocks) consider(r);
      if (best && bd < 760 * this.U) {
        const want = Math.atan2(best.y - this.P.y, best.x - this.P.x);
        const dd = angDiff(this.P.aim, want);
        this.P.aim += clamp(dd, -6 * dt, 6 * dt);
      }
    }
    const f = Math.pow(0.982, dt * 60);
    this.P.vx *= f; this.P.vy *= f;
    const sp = Math.hypot(this.P.vx, this.P.vy);
    const cap = (this.P.dashT > 0 ? 940 : S.speed) * this.U * this.mods.moveMul;
    if (sp > cap) { const s = cap / sp; this.P.vx *= s; this.P.vy *= s; }
    this.P.x += this.P.vx * dt; this.P.y += this.P.vy * dt;
    this.wrap(this.P, this.P.r);
    this.P.cd -= dt; this.P.inv -= dt; this.P.dashCd -= dt; this.P.dashT -= dt;
    this.G.shield = Math.max(0, this.G.shield - dt);
    this.G.rapid = Math.max(0, this.G.rapid - dt);
    this.G.spread = Math.max(0, this.G.spread - dt);
    this.G.odT = Math.max(0, this.G.odT - dt);
    const wantFire = this.touchFire || this.mouse.down || !!this.keys.Space || !!this.keys.Enter || this.settings.autoFire;
    if (wantFire && this.P.cd <= 0) this.firePlayer();
    if (this.P.dashT > 0 && Math.random() < 0.7) {
      this.parts.push({ x: this.P.x, y: this.P.y, vx: 0, vy: 0, life: 0.28, max: 0.28, c: '#4df0ff', r: this.P.r * 0.7 });
    }
    if (this.G.odT > 0 && Math.random() < 0.5) {
      const a = rand(0, TAU);
      this.parts.push({ x: this.P.x + Math.cos(a)*this.P.r, y: this.P.y + Math.sin(a)*this.P.r,
        vx: -Math.cos(a)*120*this.U, vy: -Math.sin(a)*120*this.U, life: 0.4, max: 0.4, c: pick(['#ffef7a','#ff9f45','#ffffff']), r: 3*this.U });
    }
    for (let i = this.trail.length - 1; i >= 0; i--) { this.trail[i].life -= dt; if (this.trail[i].life <= 0) this.trail.splice(i, 1); }
  }

  updateFoes(dt: number) {
    const D = DIFFS[this.diffId];
    for (let i = this.foes.length - 1; i >= 0; i--) {
      const f = this.foes[i];
      f.flash = Math.max(0, f.flash - dt);
      if (f.spawnT > 0) { f.spawnT -= dt; continue; }
      const dx = this.P.x - f.x, dy = this.P.y - f.y;
      const dist = Math.hypot(dx, dy) || 0.001;
      const want = Math.atan2(dy, dx);
      let aim = want;
      if (f.kind === 'gunner') {
        const ideal = 250 * this.U;
        aim = dist > ideal * 1.25 ? want : dist < ideal * 0.75 ? want + Math.PI : want + Math.PI / 2;
      } else if (f.kind === 'weaver') { f.phase += dt * 1.7; aim = want + Math.sin(f.phase) * 1.1; }
      else if (f.kind === 'darter') {
        f.lungeT! -= dt;
        if (!f.lunging && dist < 300 * this.U && f.lungeT! <= 0) { f.lunging = true; f.lungeT = 0.45; }
        if (f.lunging) {
          aim = want;
          if (f.lungeT! <= 0) { f.lunging = false; f.lungeT = rand(1.4, 2.4); }
        } else aim = want + Math.sin(this.time * 3 + f.phase) * 0.5;
      }
      const d = angDiff(f.angle, aim);
      f.angle += clamp(d, -f.turn * dt, f.turn * dt);
      let power = (f.kind === 'seeker' ? 300 : f.kind === 'splitter' ? 130 : 220) * this.U * D.foeSpd;
      if (f.kind === 'darter' && f.lunging) power *= 2.6;
      f.vx += Math.cos(f.angle) * power * dt;
      f.vy += Math.sin(f.angle) * power * dt;
      f.dodge -= dt;
      if (f.dodge <= 0 && f.kind !== 'darter') { f.dodge = rand(0.7, 1.6); f.vx += rand(-110,110)*this.U; f.vy += rand(-110,110)*this.U; }
      const fr = Math.pow(0.985, dt * 60);
      f.vx *= fr; f.vy *= fr;
      const sp = Math.hypot(f.vx, f.vy);
      const cap = (f.kind === 'seeker' ? 330 : f.kind === 'darter' ? 460 : 260) * this.U * D.foeSpd * (f.elite ? 1.15 : 1);
      if (sp > cap) { const s = cap / sp; f.vx *= s; f.vy *= s; }
      f.x += f.vx * dt; f.y += f.vy * dt;
      this.wrap(f, f.r + 16 * this.U);
      f.fire -= dt;
      if (f.fire <= 0 && dist < 640 * this.U && Math.abs(angDiff(f.angle, want)) < 0.5) {
        if (f.kind === 'gunner') { this.foeShoot(f, want, 430, f.elite ? 3 : 1, 0.14); f.fire = rand(0.9, 1.8) * D.foeFire; }
        else if (f.kind === 'weaver') { this.foeShoot(f, want, 380, f.elite ? 5 : 3, 0.22); f.fire = rand(1.1, 2) * D.foeFire; }
        else if (f.kind === 'splitter') { this.foeShoot(f, want, 320, 4, 0.5); f.fire = rand(1.6, 2.6) * D.foeFire; }
      }
    }
  }

  updateBoss(dt: number) {
    if (!this.boss) return;
    const b = this.boss;
    b.flash = Math.max(0, b.flash - dt);
    if (b.spawnT > 0) { b.spawnT -= dt; b.y += 40 * this.U * dt; return; }
    if (!b.enraged && b.hp < b.maxhp * 0.4) { b.enraged = true; this.ev.onToast('DREADNOUGHT ENRAGED', '#ff9f45'); audio.warn(); }
    if (!b.phase2 && b.hp < b.maxhp * 0.2) { b.phase2 = true; this.ev.onBanner('CORE EXPOSED', 'finish it now'); audio.warn(); }
    const rate = (b.enraged ? 0.62 : 1) * (b.phase2 ? 0.75 : 1);
    const tx = this.W / 2 + Math.cos(this.time * 0.35) * this.W * 0.26;
    const ty = this.H * 0.3 + Math.sin(this.time * 0.27) * this.H * 0.14;
    b.vx += (tx - b.x) * 0.55 * dt; b.vy += (ty - b.y) * 0.55 * dt;
    b.vx *= 0.97; b.vy *= 0.97;
    b.x += b.vx * dt; b.y += b.vy * dt;
    b.x = clamp(b.x, b.r, this.W - b.r); b.y = clamp(b.y, b.r, this.H - b.r);
    b.angle = Math.atan2(this.P.y - b.y, this.P.x - b.x);
    b.spin += dt * (b.enraged ? 1.7 : 0.9);
    b.fire -= dt;
    if (b.fire <= 0) {
      b.pattern = (b.pattern + 1) % 3;
      if (b.pattern === 0) {
        const n = b.enraged ? 16 : 11;
        this.foeShoot(b, b.spin, b.phase2 ? 260 : 230, n, TAU / n);
        b.fire = 1.9 * rate;
      } else if (b.pattern === 1) {
        this.foeShoot(b, b.angle, 350, b.phase2 ? 5 : 3, 0.16);
        b.fire = 0.55 * rate; b.patT++;
        if (b.patT >= 3) { b.patT = 0; b.fire = 1.5 * rate; }
      } else {
        if (this.foes.length < DIFFS[this.diffId].foeMax) { this.spawnFoe('seeker'); if (b.enraged) this.spawnFoe('darter'); }
        b.fire = 2.6 * rate;
      }
    }
  }

  updateRest(dt: number) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.px = b.x; b.py = b.y;
      b.x += b.vx * dt; b.y += b.vy * dt; b.ttl -= dt;
      if (b.ttl <= 0 || b.x < -70 || b.x > this.W + 70 || b.y < -70 || b.y > this.H + 70) this.bullets.splice(i, 1);
    }
    for (const r of this.rocks) { r.x += r.vx * dt; r.y += r.vy * dt; r.rot += r.spin * dt; r.flash = Math.max(0, r.flash - dt); this.wrap(r, r.r + 12 * this.U); }
    // shards magnet
    const magR = SHIPS[this.shipId].magnet * this.U * this.mods.magnetMul * (this.G.odT > 0 ? 1.8 : 1);
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.life -= dt;
      const dx = this.P.x - s.x, dy = this.P.y - s.y, dist = Math.hypot(dx, dy) || 1;
      if (dist < magR && !this.over) { s.vx += (dx / dist) * 900 * this.U * dt; s.vy += (dy / dist) * 900 * this.U * dt; }
      else { s.vx *= 0.985; s.vy *= 0.985; }
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.life <= 0) { this.shards.splice(i, 1); continue; }
      if (!this.over && dist < this.P.r + 10 * this.U) {
        this.gainXp(s.val, s.x, s.y);
        this.burstFX(s.x, s.y, '#4df0ff', 3, 100);
        this.shards.splice(i, 1);
      }
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.life -= dt; d.rot += dt * 1.6;
      const dx = this.P.x - d.x, dy = this.P.y - d.y, dist = Math.hypot(dx, dy) || 1;
      if (dist < 150 * this.U) { d.vx += (dx / dist) * 260 * this.U * dt; d.vy += (dy / dist) * 260 * this.U * dt; }
      d.vx *= 0.99; d.vy *= 0.99;
      d.x += d.vx * dt; d.y += d.vy * dt;
      this.wrap(d, d.r);
      if (d.life <= 0) { this.drops.splice(i, 1); continue; }
      if (!this.over && dist < this.P.r + d.r + 4 * this.U) {
        this.applyDrop(d.kind);
        this.burstFX(d.x, d.y, d.c, 14, 160);
        this.ringFX(d.x, d.y, d.c, d.r, d.r * 3, 0.3);
        this.drops.splice(i, 1);
      }
    }
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.975; p.vy *= 0.975; p.life -= dt;
      if (p.life <= 0) this.parts.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) { this.rings[i].life -= dt; if (this.rings[i].life <= 0) this.rings.splice(i, 1); }
    for (let i = this.texts.length - 1; i >= 0; i--) { const t = this.texts[i]; t.y -= 34 * this.U * dt; t.life -= dt; if (t.life <= 0) this.texts.splice(i, 1); }
  }

  segHit(x1: number, y1: number, x2: number, y2: number, cx: number, cy: number, r: number) {
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    let t = l2 ? ((cx - x1) * dx + (cy - y1) * dy) / l2 : 0;
    t = clamp(t, 0, 1);
    const px = x1 + dx * t - cx, py = y1 + dy * t - cy;
    return px * px + py * py < r * r;
  }

  splitRock(j: number) {
    const r = this.rocks[j];
    this.addScore(r.r > 44 * this.U ? 30 : r.r > 28 * this.U ? 45 : 60, r.x, r.y);
    this.bumpCombo(); this.G.kills++;
    this.chargeOd(1.5);
    this.dropShard(r.x, r.y, r.r > 40 * this.U ? 2 : 1);
    this.burstFX(r.x, r.y, '#a4f6ff', 16);
    this.ringFX(r.x, r.y, '#8899bb', r.r * 0.5, r.r * 2, 0.3);
    if (r.r > 26 * this.U) {
      for (let k = 0; k < 2; k++) this.makeRock(r.x + rand(-8, 8) * this.U, r.y + rand(-8, 8) * this.U, r.r * rand(0.45, 0.62), 1.35);
      this.maybeDrop(r.x, r.y, 0.06);
    }
    this.rocks.splice(j, 1);
    audio.boom(false); this.shake(3 * this.U);
  }

  collide() {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      let done = false;
      for (let j = this.rocks.length - 1; j >= 0; j--) {
        const r = this.rocks[j];
        if (this.segHit(b.px, b.py, b.x, b.y, r.x, r.y, r.r + b.r)) {
          if (!b.foe) {
            r.hp -= b.dmg; r.flash = 0.14;
            this.burstFX(b.x, b.y, '#d6efff', 5, 120);
            this.G.shotsHit++;
            audio.tick();
            if (r.hp <= 0) this.splitRock(j);
            if (b.pierce > 0) { b.pierce--; b.px = b.x; b.py = b.y; }
            else { this.bullets.splice(i, 1); done = true; break; }
          } else { this.bullets.splice(i, 1); done = true; break; }
          done = true; break;
        }
      }
      if (done) continue;
      if (!b.foe) {
        for (let j = this.foes.length - 1; j >= 0; j--) {
          const f = this.foes[j];
          if (f.spawnT > 0) continue;
          if (this.segHit(b.px, b.py, b.x, b.y, f.x, f.y, f.r + b.r)) {
            f.hp -= b.dmg; f.flash = 0.14;
            this.burstFX(b.x, b.y, f.c, 7, 150);
            this.G.shotsHit++;
            audio.tick();
            if (f.hp <= 0) this.killFoe(j);
            if (b.pierce > 0) { b.pierce--; }
            else { this.bullets.splice(i, 1); done = true; break; }
            done = true; break;
          }
        }
        if (done) continue;
        if (this.boss && this.boss.spawnT <= 0 && this.segHit(b.px, b.py, b.x, b.y, this.boss.x, this.boss.y, this.boss.r + b.r)) {
          this.bullets.splice(i, 1);
          this.boss.hp -= b.dmg; this.boss.flash = 0.1;
          this.burstFX(b.x, b.y, '#ffd27f', 5, 140);
          this.G.shotsHit++;
          audio.tick();
          if (this.boss.hp <= 0) this.killBoss();
          continue;
        }
      } else if (!this.over && this.P.inv <= 0 && !this.god && this.G.odT <= 0) {
        if (this.segHit(b.px, b.py, b.x, b.y, this.P.x, this.P.y, this.P.r * 0.78 + b.r)) {
          this.bullets.splice(i, 1);
          this.damage();
          continue;
        }
      }
    }
    if (this.over || this.P.inv > 0 || this.god || this.G.odT > 0) return;
    for (let j = this.rocks.length - 1; j >= 0; j--) {
      const r = this.rocks[j];
      const dx = this.P.x - r.x, dy = this.P.y - r.y;
      if (dx * dx + dy * dy < (this.P.r * 0.85 + r.r) * (this.P.r * 0.85 + r.r)) {
        const a = Math.atan2(this.P.y - r.y, this.P.x - r.x);
        this.P.vx += Math.cos(a) * 220 * this.U; this.P.vy += Math.sin(a) * 220 * this.U;
        r.vx -= Math.cos(a) * 90 * this.U; r.vy -= Math.sin(a) * 90 * this.U;
        this.damage(); return;
      }
    }
    for (let j = this.foes.length - 1; j >= 0; j--) {
      const f = this.foes[j];
      if (f.spawnT > 0) continue;
      const dx = this.P.x - f.x, dy = this.P.y - f.y;
      if (dx * dx + dy * dy < (this.P.r * 0.85 + f.r) * (this.P.r * 0.85 + f.r)) {
        this.burstFX(f.x, f.y, f.c, 22);
        this.foes.splice(j, 1);
        this.G.kills++;
        this.damage(); return;
      }
    }
    if (this.boss && this.boss.spawnT <= 0) {
      const dx = this.P.x - this.boss.x, dy = this.P.y - this.boss.y;
      if (dx * dx + dy * dy < (this.P.r + this.boss.r * 0.9) * (this.P.r + this.boss.r * 0.9)) {
        const a = Math.atan2(this.P.y - this.boss.y, this.P.x - this.boss.x);
        this.P.vx += Math.cos(a) * 420 * this.U; this.P.vy += Math.sin(a) * 420 * this.U;
        this.damage();
      }
    }
  }


  // ============ HUD emit ============
  emitHud(force = false) {
    const now = performance.now();
    if (!force && now - this.hudT < 90) return;
    this.hudT = now;
    const S = SHIPS[this.shipId];
    this.ev.onHud({
      score: this.G.score, wave: Math.max(1, this.G.wave), best: this.save.best[this.diffId] || 0,
      hull: Math.max(0, this.G.lives), maxHull: this.G.maxLives, shieldT: this.G.shield,
      xp: this.G.xp, xpNeed: this.G.xpNeed, level: this.G.level,
      combo: this.G.combo, comboFrac: clamp(this.G.comboT / 3.4, 0, 1), mult: this.G.mult,
      bombs: this.G.bombs, maxBombs: this.G.maxBombs,
      dashFrac: clamp(1 - this.P.dashCd / (S.dashCd * this.mods.dashMul), 0, 1),
      dashReady: this.P.dashCd <= 0,
      od: this.G.od, odActive: this.G.odT > 0,
      boss: this.mode === 'game' && this.boss && this.boss.spawnT <= 0
        ? { name: 'DREADNOUGHT MK-' + Math.ceil(this.G.wave / 5), hp: Math.max(0, this.boss.hp), max: this.boss.maxhp, enraged: !!this.boss.enraged } : null,
      buffs: { shield: this.G.shield, rapid: this.G.rapid, spread: this.G.spread, od: this.G.odT },
      time: this.G.runTime, kills: this.G.kills,
      hitFlash: this.hitFlash, god: this.god,
      waveState: this.G.interT > 0 ? 'incoming' : this.G.waveActive ? 'active' : 'idle',
      remaining: this.rocks.length + this.foes.length + this.G.foeQueue.length + (this.boss ? 1 : 0),
      projectiles: S.projectiles + this.mods.projBonus,
      damage: S.damage + this.mods.dmgBonus,
      fireRate: S.fireRate * this.mods.fireMul,
    });
  }

  showOver() {
    this.overShown = true;
    const best = this.save.best[this.diffId] || 0;
    const rec = this.G.score > best;
    if (rec) { this.save.best[this.diffId] = this.G.score; }
    this.save.runs = (this.save.runs || 0) + 1;
    this.save.kills = (this.save.kills || 0) + this.G.kills;
    this.save.time = (this.save.time || 0) + Math.floor(this.G.runTime);
    storeSave(this.save);
    const acc = this.G.shotsFired ? clamp(this.G.shotsHit / this.G.shotsFired, 0, 1) : 0;
    this.ev.onGameOver({
      score: this.G.score, wave: this.G.wave, best: this.save.best[this.diffId] || 0, isRecord: rec,
      kills: this.G.kills, time: this.G.runTime, level: this.G.level, maxCombo: this.G.maxCombo,
      accuracy: acc, ship: this.shipId, diff: this.diffId,
      grade: gradeFor(this.G.score, this.G.wave, acc),
    });
  }

  // ============ main loop ============
  frame(now: number) {
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.05) dt = 0.05;
    if (dt <= 0) { this.render(dt); return; }
    this.frameEMA = this.frameEMA * 0.95 + dt * 1000 * 0.05;
    if (this.quality && this.frameEMA > 30 && this.time > 4) { this.quality = 0; this.buildStars(); this.resize(); }
    // slow-mo
    if (this.slowT > 0) { this.slowT -= dt; if (this.slowT <= 0) this.timeScale = 1; }
    const sdt = dt * this.timeScale;
    this.time += sdt;
    this.shakeV *= Math.pow(0.001, dt);
    if (this.flashV > 0) this.flashV = Math.max(0, this.flashV - dt * 2.2);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 1.6);

    if (this.mode === 'menu') {
      if (!this.menuRocksInit) {
        this.menuRocksInit = true;
        for (let i = 0; i < 7; i++) {
          const r = rand(30, 70) * this.U;
          this.makeRock(rand(0, this.W), rand(0, this.H), r, 0.5);
        }
      }
      for (const r of this.rocks) { r.x += r.vx * 0.4 * sdt; r.y += r.vy * 0.4 * sdt; r.rot += r.spin * sdt * 0.5; this.wrap(r, r.r + 20); }
      this.updateParticlesOnly(sdt);
    } else if (!this.paused && !this.draftPause) {
      if (!this.over) {
        this.G.runTime += sdt;
        this.updatePlayer(sdt);
        this.updateFoes(sdt);
        this.updateBoss(sdt);
        this.updateRest(sdt);
        this.collide();
        this.waveLogic(sdt);
        this.G.comboT -= sdt;
        if (this.G.comboT <= 0 && this.G.combo > 0) { this.G.combo = 0; this.G.mult = 1; }
      } else {
        this.updateRest(sdt);
        for (const r of this.rocks) { r.x += r.vx * sdt; r.y += r.vy * sdt; r.rot += r.spin * sdt; this.wrap(r, r.r + 12 * this.U); }
        this.overT += dt;
        if (this.overT > 1.1 && !this.overShown) this.showOver();
      }
      this.emitHud();
    }
    this.render(sdt);
  }

  updateParticlesOnly(dt: number) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0) this.parts.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) { this.rings[i].life -= dt; if (this.rings[i].life <= 0) this.rings.splice(i, 1); }
    for (let i = this.texts.length - 1; i >= 0; i--) { const t = this.texts[i]; t.y -= 20 * dt; t.life -= dt; if (t.life <= 0) this.texts.splice(i, 1); }
  }

  // ============ render ============
  drawBG(dt: number) {
    const { ctx, W, H } = this;
    ctx.fillStyle = '#04060f';
    ctx.fillRect(0, 0, W, H);
    if (this.nebula && this.quality) {
      const ox = Math.sin(this.time * 0.02) * 30, oy = Math.cos(this.time * 0.017) * 24;
      ctx.globalAlpha = 0.55;
      ctx.drawImage(this.nebula, -40 + ox, -40 + oy, W + 80, H + 80);
      if (this.nebula2) {
        ctx.globalAlpha = 0.32;
        ctx.drawImage(this.nebula2, -120 - ox * 1.6, -90 - oy * 1.6, W + 240, H + 200);
      }
      ctx.globalAlpha = 1;
    } else if (this.nebula) {
      ctx.globalAlpha = 0.45;
      ctx.drawImage(this.nebula, -30, -30, W + 60, H + 60);
      ctx.globalAlpha = 1;
    }
    // warp stretch when dashing / overdrive
    const warp = (this.P.dashT > 0 ? 6 : 0) + (this.G.odT > 0 ? 3 : 0);
    const px = -this.P.vx / Math.max(1, W), py = -this.P.vy / Math.max(1, H);
    ctx.fillStyle = '#ffffff';
    for (const s of this.stars) {
      s.x += (px * 0.03 * s.sp + 0.0022 * s.sp) * dt * 60 * 0.016;
      s.y += py * 0.03 * s.sp * dt * 60 * 0.016;
      if (s.x < 0) s.x += 1; else if (s.x > 1) s.x -= 1;
      if (s.y < 0) s.y += 1; else if (s.y > 1) s.y -= 1;
      const tw = 0.45 + 0.55 * Math.sin(this.time * 1.6 + s.tw);
      ctx.globalAlpha = tw * (0.25 + s.l * 0.28);
      const sx = s.x * W, sy = s.y * H;
      if (warp > 0 && s.l === 2) {
        ctx.fillRect(sx - warp * 3, sy, warp * 6 + s.s, s.s);
      } else ctx.fillRect(sx, sy, s.s, s.s);
    }
    ctx.globalAlpha = 1;
  }

  drawRocks() {
    const { ctx } = this;
    for (const r of this.rocks) {
      ctx.save(); ctx.translate(r.x, r.y); ctx.rotate(r.rot);
      ctx.beginPath();
      const n = r.v.length;
      for (let i = 0; i < n; i++) {
        const a = (TAU * i) / n, rr = r.r * r.v[i];
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = r.flash > 0 ? 'rgba(200,235,255,.65)' : r.elite ? 'rgba(80,50,30,.8)' : 'rgba(46,60,86,.72)';
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = r.flash > 0 ? '#fff' : r.elite ? '#ffb45e' : '#8fa4c6';
      ctx.stroke();
      ctx.strokeStyle = 'rgba(140,165,200,.22)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(r.r * 0.22, -r.r * 0.18, r.r * 0.24, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(-r.r * 0.3, r.r * 0.25, r.r * 0.15, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  }

  foePath(g: CanvasRenderingContext2D, kind: string, r: number) {
    g.beginPath();
    if (kind === 'seeker') {
      g.moveTo(r + 5, 0); g.lineTo(-r * 0.2, r * 0.85); g.lineTo(-r * 0.75, r * 0.35);
      g.lineTo(-r * 0.45, 0); g.lineTo(-r * 0.75, -r * 0.35); g.lineTo(-r * 0.2, -r * 0.85);
    } else if (kind === 'gunner' || kind === 'splitter') {
      g.moveTo(r + 3, 0); g.lineTo(0, r * 0.55); g.lineTo(-r * 0.25, r * 0.95); g.lineTo(-r * 0.75, r * 0.3);
      g.lineTo(-r * 0.5, 0); g.lineTo(-r * 0.75, -r * 0.3); g.lineTo(-r * 0.25, -r * 0.95); g.lineTo(0, -r * 0.55);
    } else if (kind === 'darter') {
      g.moveTo(r + 8, 0); g.lineTo(-r * 0.3, r * 0.4); g.lineTo(-r * 0.6, 0); g.lineTo(-r * 0.3, -r * 0.4);
    } else {
      g.moveTo(r + 3, 0); g.lineTo(r * 0.2, r * 0.32); g.lineTo(-r * 0.5, r * 1.1); g.lineTo(-r * 0.3, r * 0.3);
      g.lineTo(-r * 0.62, 0); g.lineTo(-r * 0.3, -r * 0.3); g.lineTo(-r * 0.5, -r * 1.1); g.lineTo(r * 0.2, -r * 0.32);
    }
    g.closePath();
  }

  drawFoes() {
    const { ctx, U } = this;
    for (const f of this.foes) {
      ctx.save(); ctx.translate(f.x, f.y);
      if (f.spawnT > 0) {
        const t = 1 - f.spawnT / 0.75;
        ctx.globalAlpha = t;
        ctx.scale(0.4 + t * 0.6, 0.4 + t * 0.6);
        ctx.strokeStyle = f.c; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, f.r * (2.2 - t * 1.2), 0, TAU); ctx.stroke();
      }
      // darter telegraph
      if (f.kind === 'darter' && (f as Foe).lunging) {
        ctx.save(); ctx.rotate(f.angle);
        ctx.strokeStyle = 'rgba(255,210,127,.5)'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.moveTo(f.r, 0); ctx.lineTo(f.r + 90 * U, 0); ctx.stroke();
        ctx.setLineDash([]); ctx.restore();
      }
      ctx.rotate(f.angle);
      // elite aura
      if (f.elite) {
        ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 14;
      }
      this.foePath(ctx, f.kind, f.r);
      ctx.fillStyle = f.flash > 0 ? '#fff' : f.c;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1.3; ctx.strokeStyle = f.elite ? '#ffd700' : 'rgba(255,255,255,.75)'; ctx.stroke();
      ctx.fillStyle = '#ffe47a';
      ctx.beginPath(); ctx.arc(-f.r * 0.42, 0, 2.6 * U, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.beginPath(); ctx.arc(f.r * 0.35, 0, 2.4 * U, 0, TAU); ctx.fill();
      ctx.restore();
      if (f.maxhp > 1 && f.hp < f.maxhp && f.spawnT <= 0) {
        const w = f.r * 1.8;
        ctx.fillStyle = 'rgba(0,0,0,.5)';
        ctx.fillRect(f.x - w / 2, f.y - f.r - 7 * U, w, 2.5 * U);
        ctx.fillStyle = f.elite ? '#ffd700' : f.c;
        ctx.fillRect(f.x - w / 2, f.y - f.r - 7 * U, w * clamp(f.hp / f.maxhp, 0, 1), 2.5 * U);
      }
      ctx.globalAlpha = 1;
    }
  }

  drawBoss() {
    if (!this.boss) return;
    const { ctx } = this;
    const b = this.boss;
    ctx.save(); ctx.translate(b.x, b.y);
    const t = b.spawnT > 0 ? 1 - b.spawnT / 1.4 : 1;
    ctx.globalAlpha = clamp(t, 0.15, 1);
    ctx.rotate(b.spin * 0.25);
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const a = (TAU * i) / 12, rr = b.r * (i % 2 ? 0.72 : 1);
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const grd = ctx.createLinearGradient(-b.r, -b.r, b.r, b.r);
    grd.addColorStop(0, b.flash > 0 ? '#ffffff' : '#5c1f45');
    grd.addColorStop(1, b.flash > 0 ? '#ffd9e8' : '#2a1030');
    ctx.fillStyle = grd; ctx.fill();
    ctx.lineWidth = 2.4; ctx.strokeStyle = b.enraged ? '#ff9f45' : '#ff5e9c'; ctx.stroke();
    ctx.rotate(-b.spin * 0.55);
    ctx.strokeStyle = 'rgba(255,94,156,.55)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, b.r * 0.55, 0, TAU); ctx.stroke();
    ctx.fillStyle = b.phase2 ? '#ffffff' : b.enraged ? '#ff9f45' : '#ff5e9c';
    ctx.beginPath(); ctx.arc(0, 0, b.r * 0.24 * (1 + 0.12 * Math.sin(this.time * 6)), 0, TAU); ctx.fill();
    // low-hp smoke
    if (b.hp < b.maxhp * 0.35 && Math.random() < 0.3) {
      this.parts.push({ x: b.x + rand(-b.r, b.r) * 0.6, y: b.y + rand(-b.r, b.r) * 0.6,
        vx: rand(-30, 30), vy: rand(-60, -20), life: 0.7, max: 0.7, c: '#ff9f45', r: 4 * this.U });
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  drawPlayer() {
    if (this.over || this.mode !== 'game') return;
    const { ctx, U } = this;
    const S = SHIPS[this.shipId];
    // dash ghosts
    for (const g of this.trail) {
      ctx.globalAlpha = clamp(g.life * 2, 0, 0.5);
      ctx.fillStyle = S.color;
      ctx.beginPath(); ctx.arc(g.x, g.y, this.P.r * 0.8, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(this.P.x, this.P.y);
    if (this.G.shield > 0 || this.P.inv > 0 || this.G.odT > 0) {
      const shielded = this.G.shield > 0 || this.G.odT > 0;
      ctx.strokeStyle = this.G.odT > 0 ? 'rgba(255,239,122,.9)' : shielded ? 'rgba(77,240,255,.85)' : 'rgba(255,255,255,.5)';
      ctx.lineWidth = 2;
      const rr = this.P.r * 1.7 + Math.sin(this.time * 7) * 2 * U;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a0 = this.time * 2 + (i * TAU) / 3;
        ctx.arc(0, 0, rr, a0, a0 + 1.4);
        ctx.moveTo(Math.cos(a0 + TAU / 3) * rr, Math.sin(a0 + TAU / 3) * rr);
      }
      ctx.stroke();
    }
    ctx.rotate(this.P.angle);
    ctx.globalAlpha = this.P.inv > 0 ? 0.45 + 0.55 * Math.abs(Math.sin(this.time * 18)) : 1;
    if (this.god) { ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 16 + 6 * Math.sin(this.time * 4); }
    if (this.G.odT > 0) { ctx.shadowColor = '#ffef7a'; ctx.shadowBlur = 22; }
    const r = this.P.r;
    ctx.beginPath();
    ctx.moveTo(r * 1.25, 0);
    ctx.lineTo(-r * 0.5, r * 0.85); ctx.lineTo(-r * 0.25, r * 0.42);
    ctx.lineTo(-r * 0.85, r * 0.42); ctx.lineTo(-r * 0.7, 0);
    ctx.lineTo(-r * 0.85, -r * 0.42); ctx.lineTo(-r * 0.25, -r * 0.42);
    ctx.lineTo(-r * 0.5, -r * 0.85);
    ctx.closePath();
    const g = ctx.createLinearGradient(-r, 0, r * 1.2, 0);
    if (this.shipId === 'phantom') { g.addColorStop(0, '#5a1fa8'); g.addColorStop(0.6, '#b95eff'); g.addColorStop(1, '#ffd6ff'); }
    else if (this.shipId === 'bastion') { g.addColorStop(0, '#8a4a0a'); g.addColorStop(0.6, '#ff9f45'); g.addColorStop(1, '#fff3c9'); }
    else { g.addColorStop(0, '#0a7fa8'); g.addColorStop(0.6, '#0ad5ff'); g.addColorStop(1, '#b3faff'); }
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 1.6; ctx.strokeStyle = '#9ff9ff'; ctx.stroke();
    ctx.fillStyle = '#eafeff';
    ctx.beginPath(); ctx.arc(r * 0.3, 0, r * 0.2, 0, TAU); ctx.fill();
    if (this.P.thrust > 0.1) {
      const len = r * (0.7 + Math.random() * 0.9) * this.P.thrust * (this.G.odT > 0 ? 1.5 : 1);
      ctx.fillStyle = this.G.odT > 0 ? '#ffef7a' : '#ff9f45';
      ctx.beginPath(); ctx.moveTo(-r * 0.78, r * 0.26); ctx.lineTo(-r * 0.78 - len, 0); ctx.lineTo(-r * 0.78, -r * 0.26); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffe47a';
      ctx.beginPath(); ctx.moveTo(-r * 0.78, r * 0.14); ctx.lineTo(-r * 0.78 - len * 0.55, 0); ctx.lineTo(-r * 0.78, -r * 0.14); ctx.closePath(); ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.restore();
    ctx.globalAlpha = 1;
    // aim indicator (desktop)
    if (this.mouse.seen && this.mode === 'game' && !this.over) {
      ctx.strokeStyle = 'rgba(77,240,255,.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(this.P.x + Math.cos(this.P.aim) * (r + 6), this.P.y + Math.sin(this.P.aim) * (r + 6));
      ctx.lineTo(this.P.x + Math.cos(this.P.aim) * (r + 22), this.P.y + Math.sin(this.P.aim) * (r + 22)); ctx.stroke();
    }
  }

  drawPickups() {
    const { ctx, U } = this;
    for (const s of this.shards) {
      const tw = 0.7 + 0.3 * Math.sin(this.time * 8 + s.x);
      ctx.globalAlpha = tw;
      const gl = this.glow('#4df0ff', s.r * 2.4);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(gl, s.x - s.r * 2.4, s.y - s.r * 2.4, s.r * 4.8, s.r * 4.8);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#aef7ff';
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(this.time * 3 + s.x);
      const r = s.r * 0.7;
      ctx.fillRect(-r / 2, -r / 2, r, r);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    for (const d of this.drops) {
      const blink = d.life < 3 ? (Math.sin(d.life * 18) > 0 ? 1 : 0.25) : 1;
      ctx.globalAlpha = blink;
      const gl = this.glow(d.c, d.r * 1.8);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(gl, d.x - d.r * 1.8, d.y - d.r * 1.8, d.r * 3.6, d.r * 3.6);
      ctx.globalCompositeOperation = 'source-over';
      ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (TAU * i) / 6, x = Math.cos(a) * d.r, y = Math.sin(a) * d.r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(3,5,15,.78)'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = d.c; ctx.stroke();
      ctx.restore();
      ctx.fillStyle = d.c;
      ctx.font = `700 ${(d.r * 0.95).toFixed(0)}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(d.g, d.x, d.y + d.r * 0.05);
      ctx.globalAlpha = 1;
    }
  }

  drawFX() {
    const { ctx } = this;
    ctx.globalCompositeOperation = 'lighter';
    for (const b of this.bullets) {
      const gl = this.glow(b.c, b.r * 3.2);
      ctx.globalAlpha = clamp(b.ttl * 2.2, 0.25, 1);
      ctx.drawImage(gl, b.x - b.r * 3.2, b.y - b.r * 3.2, b.r * 6.4, b.r * 6.4);
      ctx.strokeStyle = b.c; ctx.lineWidth = b.r * 0.8;
      ctx.globalAlpha *= 0.55;
      ctx.beginPath(); ctx.moveTo(b.px, b.py); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (const p of this.parts) {
      const a = clamp(p.life / p.max, 0, 1);
      const rr = p.r * (0.4 + a);
      const gl = this.glow(p.c, Math.max(4, rr * 2));
      ctx.globalAlpha = a;
      ctx.drawImage(gl, p.x - rr * 2, p.y - rr * 2, rr * 4, rr * 4);
    }
    for (const r of this.rings) {
      const t = 1 - r.life / r.max;
      ctx.globalAlpha = (1 - t) * 0.85;
      ctx.strokeStyle = r.c; ctx.lineWidth = (1 - t) * 4 * this.U + 0.6;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r + (r.r1 - r.r) * t, 0, TAU); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      ctx.globalAlpha = clamp(t.life / 0.95, 0, 1);
      ctx.fillStyle = t.c;
      ctx.font = `700 ${t.size.toFixed(0)}px system-ui, sans-serif`;
      ctx.fillText(t.t, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }

  render(dt: number) {
    const { ctx, W, H, DPR } = this;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    this.drawBG(dt);
    if (this.shakeV > 0.2) ctx.translate(rand(-this.shakeV, this.shakeV), rand(-this.shakeV, this.shakeV));
    this.drawPickups();
    this.drawRocks();
    this.drawFoes();
    this.drawBoss();
    this.drawPlayer();
    this.drawFX();
    // red flash
    if (this.flashV > 0) {
      ctx.fillStyle = `rgba(255,43,94,${(this.flashV * 0.35).toFixed(3)})`;
      ctx.fillRect(-30, -30, W + 60, H + 60);
    }
    if (this.hitFlash > 0) {
      const grd = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.3, W/2, H/2, Math.max(W,H)*0.7);
      grd.addColorStop(0, 'rgba(255,30,60,0)');
      grd.addColorStop(1, `rgba(255,30,60,${(this.hitFlash*0.45).toFixed(3)})`);
      ctx.fillStyle = grd;
      ctx.fillRect(-30, -30, W + 60, H + 60);
    }
    if (this.G.odT > 0 && this.mode === 'game') {
      const grd = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.35, W/2, H/2, Math.max(W,H)*0.75);
      grd.addColorStop(0, 'rgba(255,239,122,0)');
      grd.addColorStop(1, 'rgba(255,180,60,0.12)');
      ctx.fillStyle = grd;
      ctx.fillRect(-30, -30, W + 60, H + 60);
    }
  }
}
