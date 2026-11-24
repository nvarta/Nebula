import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Play, Pause, Volume2, VolumeX, Music, Vibrate, Trophy, Timer, Skull,
  RotateCcw, Home, Zap, Crosshair, Wind, Rocket, Magnet, Shield, Ghost,
  BatteryCharging, Sparkles, ShieldPlus, Bomb as BombIcon, HeartPulse, Droplet,
  Split, ChevronRight, Gamepad2, MousePointer2, Flame, Star, Crown, Target,
  Gauge, Layers, Radiation, Swords, Info, X, Plus,
} from 'lucide-react';
import { SHIPS, DIFFS, UPGRADES, xpForLevel, type ShipId, type DiffId, type UpgradeDef } from './game/config';
import { Engine, loadSave, type HudState, type RunStats } from './game/engine';
import { audio } from './game/audio';

const UPGRADE_ICONS: Record<string, any> = {
  zap: Zap, crosshair: Crosshair, split: Split, wind: Wind, rocket: Rocket,
  magnet: Magnet, shield: Shield, ghost: Ghost, battery: BatteryCharging,
  sparkles: Sparkles, shieldplus: ShieldPlus, bomb: BombIcon, heart: HeartPulse,
  droplet: Droplet,
};
const RARITY_COLOR: Record<string, string> = {
  common: '#4df0ff', rare: '#b95eff', epic: '#ffef7a',
};

function fmt(n: number) { return Math.round(n).toLocaleString(); }
function fmtTime(s: number) {
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return m + ':' + String(ss).padStart(2, '0');
}

interface Toast { id: number; text: string; color: string }

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [screen, setScreen] = useState<'menu' | 'game'>('menu');
  const [paused, setPaused] = useState(false);
  const [draft, setDraft] = useState<UpgradeDef[] | null>(null);
  const [gameOver, setGameOver] = useState<RunStats | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [banner, setBanner] = useState<{ main: string; sub: string; key: number } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [ship, setShip] = useState<ShipId>(() => loadSave().ship as ShipId);
  const [diff, setDiff] = useState<DiffId>(() => loadSave().diff as DiffId);
  const [settings, setSettings] = useState(() => {
    const s = loadSave();
    return { sound: s.sound, music: s.music, haptics: s.haptics, shake: s.shake, autoFire: s.autoFire, volume: s.volume };
  });
  const [best, setBest] = useState<Record<string, number>>(() => loadSave().best);
  const [stats, setStats] = useState(() => { const s = loadSave(); return { runs: s.runs, kills: s.kills, time: s.time }; });
  const [showHelp, setShowHelp] = useState(false);
  const [taps, setTaps] = useState(0);
  const [isTouch] = useState(() => window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);
  const toastId = useRef(0);
  const bannerKey = useRef(0);

  const pushToast = useCallback((text: string, color = '#ffef7a') => {
    const id = ++toastId.current;
    setToasts(t => [...t.slice(-2), { id, text, color }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 1600);
  }, []);

  // ---- engine lifecycle ----
  useEffect(() => {
    const cv = canvasRef.current!;
    const eng = new Engine(cv, {
      onHud: (h) => setHud({ ...h }),
      onBanner: (main, sub) => { bannerKey.current++; setBanner({ main, sub, key: bannerKey.current }); },
      onToast: (text, color) => pushToast(text, color),
      onLevelUp: (opts) => setDraft([...opts]),
      onGameOver: (s) => {
        setGameOver(s);
        setBest({ ...loadSave().best });
        const sv = loadSave(); setStats({ runs: sv.runs, kills: sv.kills, time: sv.time });
      },
      onClearDraft: () => setDraft(null),
    });
    eng.configure(ship, diff, settings);
    eng.attach();
    eng.toMenu();
    engineRef.current = eng;
    const sync = setInterval(() => { if (eng) setPaused(eng.paused); }, 300);
    return () => { clearInterval(sync); eng.detach(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (banner) {
      const t = setTimeout(() => setBanner(null), 2150);
      return () => clearTimeout(t);
    }
  }, [banner]);

  // keep engine in sync when menu selections change (before launch)
  useEffect(() => { engineRef.current?.configure(ship, diff, settings); }, [ship, diff, settings]);

  const launch = () => {
    audio.init(); audio.ui();
    const eng = engineRef.current!;
    eng.configure(ship, diff, settings);
    setDraft(null); setGameOver(null); setPaused(false);
    setBanner(null); setToasts([]);
    eng.startGame();
    setScreen('game');
  };
  const toMenu = () => {
    audio.ui();
    engineRef.current?.toMenu();
    setScreen('menu'); setGameOver(null); setDraft(null); setPaused(false);
    setBest({ ...loadSave().best });
    const sv = loadSave(); setStats({ runs: sv.runs, kills: sv.kills, time: sv.time });
  };
  const doPause = (b: boolean) => { audio.ui(); engineRef.current?.setPaused(b); setPaused(b); };

  const updSettings = (patch: Partial<typeof settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    (window as any).__hapticsOn = next.haptics;
    audio.soundOn = next.sound; audio.setVolume(next.volume);
    if (next.music) { audio.musicOn = true; audio.init(); audio.startMusic(); } else { audio.musicOn = false; audio.stopMusic(); }
    engineRef.current?.configure(ship, diff, next);
  };

  const titleTap = () => {
    const n = taps + 1; setTaps(n);
    if (n >= 7) { setTaps(0); engineRef.current?.toggleGod(); }
    setTimeout(() => setTaps(t => (t === n ? 0 : t)), 1400);
  };

  const S = SHIPS[ship];
  const D = DIFFS[diff];

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#04060f] text-[#eaf6ff]">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="vignette scanlines pointer-events-none absolute inset-0" />
      {/* top XP bar in game */}
      {screen === 'game' && hud && (
        <div className="absolute inset-x-0 top-0 z-20 h-[3px] bg-white/10">
          <div className="xp-fill h-full transition-[width] duration-200" style={{ width: `${Math.min(100, (hud.xp / hud.xpNeed) * 100)}%` }} />
        </div>
      )}

      {screen === 'menu' ? (
        <MenuScreen
          ship={ship} setShip={setShip} diff={diff} setDiff={setDiff}
          settings={settings} updSettings={updSettings}
          best={best} stats={stats} launch={launch}
          showHelp={showHelp} setShowHelp={setShowHelp}
          titleTap={titleTap} isTouch={isTouch}
        />
      ) : (
        <>
          {hud && (
            <Hud
              hud={hud} paused={paused}
              onPause={() => doPause(true)}
              onMute={() => updSettings({ sound: !settings.sound })}
              soundOn={settings.sound}
              isTouch={isTouch}
              engine={engineRef}
            />
          )}
          {/* center announcements */}
          {banner && (
            <div key={banner.key} className="pointer-events-none absolute inset-x-0 top-[30%] z-30 text-center">
              <div className="anim-banner font-display text-[clamp(1.6rem,7vw,3.2rem)] font-black tracking-[0.3em] text-white glow-cy uppercase">
                {banner.main}
                {banner.sub && (
                  <div className="mt-2 text-[0.42em] font-semibold tracking-[0.3em] text-[#4df0ff]">{banner.sub}</div>
                )}
              </div>
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-0 top-[54%] z-30 flex flex-col items-center gap-2">
            {toasts.map(t => (
              <div key={t.id} className="anim-toast font-display rounded-full border px-4 py-1 text-[clamp(0.7rem,2.8vw,0.95rem)] font-bold tracking-[0.25em]"
                style={{ color: t.color, borderColor: t.color + '66', background: 'rgba(3,6,16,.6)', textShadow: `0 0 14px ${t.color}` }}>
                {t.text}
              </div>
            ))}
          </div>

          {/* god indicator */}
          {hud?.god && (
            <div className="anim-pulse-glow pointer-events-none absolute left-1/2 top-[22%] z-20 -translate-x-1/2 font-display text-xs font-bold tracking-[0.3em] text-[#ffd700]">
              ✦ IMMORTAL MODE ✦
            </div>
          )}

          {/* touch controls */}
          {isTouch && !gameOver && !draft && (
            <TouchControls engine={engineRef} hud={hud} />
          )}
          {!isTouch && !gameOver && !draft && !paused && (
            <div className="pointer-events-none absolute bottom-2 left-1/2 z-20 w-max max-w-[94vw] -translate-x-1/2 rounded-full px-4 py-1 text-center text-[11px] tracking-wider text-slate-400/80 glass-soft">
              <span className="text-cyan-300 font-semibold">WASD</span> move · <span className="text-cyan-300 font-semibold">MOUSE</span> aim · <span className="text-cyan-300 font-semibold">CLICK / SPACE</span> fire · <span className="text-cyan-300 font-semibold">SHIFT</span> dash · <span className="text-cyan-300 font-semibold">E</span> bomb · <span className="text-cyan-300 font-semibold">Q</span> overdrive
            </div>
          )}

          {/* draft */}
          {draft && (
            <DraftModal draft={draft} onPick={(id) => engineRef.current?.chooseUpgrade(id)} level={hud?.level ?? 1} />
          )}
          {/* pause */}
          {paused && !gameOver && !draft && (
            <PauseModal
              onResume={() => doPause(false)} onRestart={launch} onMenu={toMenu}
              settings={settings} updSettings={updSettings} hud={hud}
            />
          )}
          {/* game over */}
          {gameOver && (
            <GameOverModal stats={gameOver} onRetry={launch} onMenu={toMenu} />
          )}
        </>
      )}
    </div>
  );
}

/* ================= MENU ================= */
function MenuScreen(props: any) {
  const { ship, setShip, diff, setDiff, settings, updSettings, best, stats, launch, showHelp, setShowHelp, titleTap, isTouch } = props;
  const S = SHIPS[ship as ShipId];
  const D = DIFFS[diff as DiffId];
  return (
    <div className="absolute inset-0 z-10 overflow-y-auto thin-scroll bg-gradient-to-b from-[#04060f]/40 via-[#04060f]/72 to-[#04060f]/92">
      <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col items-center justify-center gap-5 px-4 py-6 md:flex-row md:items-stretch md:gap-8 md:px-8">
        {/* left: hero + selection */}
        <div className="flex w-full max-w-xl flex-col items-center md:items-start">
          <div className="mb-1 flex items-center gap-2 text-[10px] font-bold tracking-[0.35em] text-cyan-300/80">
            <Radiation size={12} /> DEEP-SPACE SURVIVAL PROTOCOL
          </div>
          <h1 onClick={titleTap} className="font-display cursor-pointer text-center font-black leading-[0.95] md:text-left title-gradient"
            style={{ fontSize: 'clamp(2.6rem,9vw,4.8rem)', letterSpacing: '0.06em' }}>
            NEBULA<br />ASCENT
          </h1>
          <p className="mt-2 text-center text-[13px] tracking-[0.28em] text-slate-300/80 md:text-left">
            ★ SURVIVE THE SWARM · SLAY THE DREADNOUGHT ★
          </p>

          {/* ships */}
          <div className="mt-5 w-full">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-display text-[11px] font-bold tracking-[0.3em] text-[#ffef7a]">SELECT FRAME</span>
              <span className="text-[11px] tracking-widest text-slate-400">{S.title}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(SHIPS) as ShipId[]).map(id => {
                const s = SHIPS[id];
                const active = id === ship;
                return (
                  <button key={id} onClick={() => { setShip(id); audio.init(); audio.ui(); }}
                    className={`ship-card rounded-2xl border p-3 text-left ${active ? 'active' : 'border-white/10 bg-white/[0.04]'}`}>
                    <div className="mx-auto mb-2 grid h-12 w-12 place-items-center">
                      <ShipGlyph color={s.color} active={active} />
                    </div>
                    <div className="font-display text-[11px] font-black tracking-widest" style={{ color: active ? s.color : '#cfe4f7' }}>{s.name}</div>
                    <div className="mt-1 space-y-[3px]">
                      <MiniBar label="FR" v={s.stats.fire} c={s.color} />
                      <MiniBar label="SP" v={s.stats.speed} c={s.color} />
                      <MiniBar label="HL" v={s.stats.hull} c={s.color} />
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 min-h-[2.4em] text-[13px] leading-snug text-slate-300/90">{S.desc}</p>
          </div>

          {/* difficulty */}
          <div className="mt-2 w-full">
            <div className="mb-2 font-display text-[11px] font-bold tracking-[0.3em] text-[#ffef7a]">THREAT LEVEL</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(Object.keys(DIFFS) as DiffId[]).map(id => {
                const d = DIFFS[id];
                const active = id === diff;
                return (
                  <button key={id} onClick={() => { setDiff(id); audio.init(); audio.ui(); }}
                    className={`diff-card rounded-xl border p-2.5 text-center ${active ? 'active' : 'border-white/10 bg-white/[0.04]'}`}
                    style={{ ['--dc' as any]: d.color, borderColor: active ? d.color : undefined }}>
                    <div className="text-lg leading-none">{id === 'easy' ? '☁' : id === 'normal' ? '⚡' : id === 'hard' ? '🔥' : '💀'}</div>
                    <div className="font-display mt-1 text-[11px] font-black tracking-widest" style={{ color: active ? d.color : '#cfe4f7' }}>{d.label}</div>
                    <div className="mono-num mt-0.5 text-[11px] text-slate-300">BEST {fmt(best[id] || 0)}</div>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[13px] text-slate-300/85">{D.desc}</p>
          </div>

          <button onClick={launch} className="btn-launch font-display mt-4 flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 text-lg font-black tracking-[0.25em] md:w-auto md:px-14">
            <Play size={20} strokeWidth={3} /> LAUNCH
          </button>

          {/* toggles */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2 md:justify-start">
            <Toggle on={settings.sound} icon={settings.sound ? <Volume2 size={13} /> : <VolumeX size={13} />} label="SOUND" onClick={() => updSettings({ sound: !settings.sound })} />
            <Toggle on={settings.music} icon={<Music size={13} />} label="MUSIC" onClick={() => updSettings({ music: !settings.music })} />
            <Toggle on={settings.haptics} icon={<Vibrate size={13} />} label="HAPTICS" onClick={() => updSettings({ haptics: !settings.haptics })} />
            <Toggle on={settings.autoFire} icon={<Crosshair size={13} />} label="AUTO-FIRE" onClick={() => updSettings({ autoFire: !settings.autoFire })} />
            <Toggle on={settings.shake} icon={<Gauge size={13} />} label="SHAKE" onClick={() => updSettings({ shake: !settings.shake })} />
            <button onClick={() => setShowHelp(!showHelp)} className="btn-ghost flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-bold tracking-widest text-slate-300">
              <Info size={13} /> {showHelp ? 'HIDE GUIDE' : 'HOW TO PLAY'}
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
            <span>Volume</span>
            <input type="range" min={0} max={1} step={0.05} value={settings.volume} onChange={e => updSettings({ volume: Number(e.target.value) })} className="w-28" />
          </div>
          {showHelp && (
            <div className="anim-pop glass mt-3 w-full rounded-2xl p-4 text-[13px] leading-relaxed text-slate-200">
              <div className="font-display mb-2 text-[11px] font-bold tracking-[0.3em] text-cyan-300">FIELD MANUAL</div>
              <ul className="space-y-1.5">
                <li>◈ <b>Move</b> — {isTouch ? 'left thumb-stick' : 'WASD / arrows'}. Ship auto-aims nearest hostile{isTouch ? '' : '; mouse aims precisely'}.</li>
                <li>◈ <b>Fire</b> — {isTouch ? 'hold FIRE or enable auto-fire' : 'hold click / SPACE'}. Collect <span className="text-cyan-300">◆ shards</span> to level up and draft upgrades.</li>
                <li>◈ <b>Dash</b> ({isTouch ? '⚡ button' : 'SHIFT'}) — blink with i-frames. <b>Bomb</b> ({isTouch ? '✹' : 'E'}) — nova that clears bullets & rock.</li>
                <li>◈ <b>Overdrive</b> ({isTouch ? '◎' : 'Q'}) — when charged to 100, unleash 6s of double damage + immunity.</li>
                <li>◈ Chain kills for <span className="text-[#ffef7a]">combo multipliers up to x9</span>. Boss every 5 waves. Elites glow gold.</li>
                <li>◈ <i className="text-slate-400">Rumor: tap the title 7 times, or try ↑↑↓↓←→←→ …</i></li>
              </ul>
            </div>
          )}
          <div className="compact-hide mt-3 text-center text-[11px] italic tracking-wide text-slate-500 md:text-left">
            Ancient pilots whisper of a code… ↑↑↓↓←→←→ — or tap the title seven times.
          </div>
        </div>

        {/* right: record + loadout */}
        <div className="flex w-full max-w-md flex-col gap-3">
          <div className="glass neon-border rounded-3xl p-5">
            <div className="flex items-center justify-between">
              <div className="font-display text-[11px] font-bold tracking-[0.3em] text-cyan-300">PILOT RECORD</div>
              <Crown size={16} className="text-[#ffef7a]" />
            </div>
            <div className="mono-num mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-white/[0.04] p-3"><div className="text-[10px] tracking-[0.25em] text-slate-400">SORTIES</div><div className="text-xl font-bold text-white">{stats.runs}</div></div>
              <div className="rounded-xl bg-white/[0.04] p-3"><div className="text-[10px] tracking-[0.25em] text-slate-400">KILLS</div><div className="text-xl font-bold text-white">{fmt(stats.kills)}</div></div>
              <div className="rounded-xl bg-white/[0.04] p-3"><div className="text-[10px] tracking-[0.25em] text-slate-400">FLIGHT</div><div className="text-xl font-bold text-white">{fmtTime(stats.time)}</div></div>
            </div>
            <div className="mt-3 space-y-1.5">
              {(Object.keys(DIFFS) as DiffId[]).map(id => (
                <div key={id} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-1.5 text-[12px]">
                  <span className="font-bold tracking-[0.2em]" style={{ color: DIFFS[id].color }}>{DIFFS[id].label.toUpperCase()}</span>
                  <span className="mono-num font-bold text-[#ffef7a]">{fmt(best[id] || 0)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="glass rounded-3xl p-5">
            <div className="font-display text-[11px] font-bold tracking-[0.3em] text-cyan-300">ACTIVE LOADOUT</div>
            <div className="mt-3 flex items-center gap-3">
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-cyan-300/30 bg-cyan-300/10">
                <ShipGlyph color={S.color} active />
              </div>
              <div>
                <div className="font-display text-sm font-black tracking-widest" style={{ color: S.color }}>{S.name} · {S.title.toUpperCase()}</div>
                <div className="mono-num mt-1 flex gap-3 text-[11px] text-slate-300">
                  <span>HULL {S.hull}</span><span>DMG {S.damage}</span><span>GUNS {S.projectiles}</span>
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
              <div className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-2"><Flame size={14} className="text-orange-300" /> Wave scaling</div>
              <div className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-2"><Sparkles size={14} className="text-yellow-200" /> Level drafts</div>
              <div className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-2"><Skull size={14} className="text-pink-300" /> Boss / 5 waves</div>
              <div className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-2"><Zap size={14} className="text-cyan-300" /> Overdrive ult</div>
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-slate-300">
              {isTouch ? <Gamepad2 size={15} className="text-cyan-300" /> : <MousePointer2 size={15} className="text-cyan-300" />}
              {isTouch ? 'Left stick to fly · auto-aim locks hostiles · hold FIRE' : 'WASD to fly · mouse to aim · click to fire'}
            </div>
          </div>

          <div className="glass rounded-3xl p-5">
            <div className="font-display text-[11px] font-bold tracking-[0.3em] text-[#ffef7a]">ARSENAL PREVIEW</div>
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {UPGRADES.slice(0, 8).map(u => {
                const I = UPGRADE_ICONS[u.icon] || Zap;
                return (
                  <div key={u.id} title={u.name} className="grid place-items-center rounded-lg border border-white/10 bg-white/[0.04] p-2">
                    <I size={15} style={{ color: RARITY_COLOR[u.rarity] }} />
                  </div>
                );
              })}
            </div>
            <div className="mt-2 text-[12px] text-slate-400">14 ship systems to draft · commons → epics · stack to godhood</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniBar({ label, v, c }: any) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-4 text-[8px] font-bold text-slate-400">{label}</span>
      <div className="flex flex-1 gap-[2px]">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-[3px] flex-1 rounded-full" style={{ background: i <= v ? c : 'rgba(255,255,255,.12)' }} />
        ))}
      </div>
    </div>
  );
}
function Toggle({ on, icon, label, onClick }: any) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold tracking-widest transition-all ${on ? 'border-cyan-300/60 bg-cyan-300/15 text-cyan-200' : 'border-white/15 bg-white/[0.04] text-slate-400'}`}>
      {icon} {label} {on ? 'ON' : 'OFF'}
    </button>
  );
}
function ShipGlyph({ color, active }: any) {
  return (
    <svg viewBox="0 0 48 48" className={`h-10 w-10 ${active ? 'anim-floaty' : ''}`} style={{ filter: `drop-shadow(0 0 8px ${color})` }}>
      <path d="M42 24 L14 34 L20 24 L14 14 Z" fill={color} opacity="0.9" />
      <path d="M20 24 L8 28 L10 24 L8 20 Z" fill="#fff" opacity="0.7" />
      <circle cx="28" cy="24" r="3" fill="#fff" />
      <path d="M14 14 L6 10 M14 34 L6 38" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

/* ================= HUD ================= */
function Hud(props: { hud: HudState; paused: boolean; onPause: () => void; onMute: () => void; soundOn: boolean; isTouch: boolean; engine: any }) {
  const { hud, onPause, onMute, soundOn } = props;
  const odReady = hud.od >= 100 || hud.odActive;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-3 pt-2" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}>
      <div className="mx-auto flex max-w-5xl items-start justify-between gap-2">
        <button onClick={onPause} className="glass-soft pointer-events-auto grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-200 active:scale-90">
          <Pause size={16} />
        </button>
        <div className="glass-soft flex items-center gap-4 rounded-2xl px-4 py-1.5 sm:gap-7 sm:px-7">
          <div className="text-center leading-none">
            <div className="text-[9px] tracking-[0.3em] text-slate-400">SCORE</div>
            <div className="mono-num glow-gold font-display text-lg font-black text-[#ffef7a] sm:text-xl">{fmt(hud.score)}</div>
          </div>
          <div className="text-center leading-none">
            <div className="text-[9px] tracking-[0.3em] text-slate-400">WAVE</div>
            <div className="mono-num glow-cy font-display text-lg font-black text-[#4df0ff] sm:text-xl">{hud.wave}</div>
          </div>
          <div className="hidden text-center leading-none sm:block">
            <div className="text-[9px] tracking-[0.3em] text-slate-400">BEST</div>
            <div className="mono-num text-sm font-bold text-slate-300">{fmt(hud.best)}</div>
          </div>
          <div className="hidden text-center leading-none md:block">
            <div className="text-[9px] tracking-[0.3em] text-slate-400">LVL {hud.level}</div>
            <div className="mono-num text-sm font-bold text-cyan-200">{hud.kills} KILLS</div>
          </div>
        </div>
        <button onClick={onMute} className="glass-soft pointer-events-auto grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-200 active:scale-90">
          {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
        </button>
      </div>

      {/* sub row: hull + combo + od */}
      <div className="mx-auto mt-1.5 flex max-w-5xl items-center justify-center gap-3">
        <div className="glass-soft flex items-center gap-1 rounded-full px-3 py-1">
          {Array.from({ length: hud.maxHull }).map((_, i) => (
            <div key={i} className={`h-2.5 w-2.5 rotate-45 rounded-[2px] transition-all ${i < hud.hull ? 'bg-cyan-300 shadow-[0_0_8px_#4df0ff]' : 'bg-white/15'}`} />
          ))}
          {hud.shieldT > 0 && <Shield size={13} className="ml-1 text-cyan-300 anim-pulse-glow" />}
        </div>
        <div key={hud.mult} className="anim-combo glass-soft mono-num rounded-full px-3 py-1 text-[13px] font-black text-[#ffef7a]">
          x{hud.mult} <span className="font-normal text-slate-300">· {hud.combo} CHAIN</span>
        </div>
        <div className="glass-soft mono-num hidden rounded-full px-3 py-1 text-[12px] font-bold text-slate-300 sm:block">
          {hud.waveState === 'incoming' ? 'INCOMING' : hud.remaining + ' HOSTILES'}
        </div>
        <button
          onClick={() => props.engine.current?.queueOverdrive()}
          className={`pointer-events-auto flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-black tracking-widest transition-all active:scale-95 ${odReady ? 'border-yellow-200/70 bg-yellow-300/20 text-yellow-100 shadow-[0_0_18px_rgba(255,239,122,.5)] anim-pulse-glow' : 'border-white/15 bg-white/[0.05] text-slate-300'}`}>
          <Zap size={13} /> {hud.odActive ? 'ACTIVE ' + hud.buffs.od.toFixed(1) + 's' : Math.floor(hud.od) + '%'}
        </button>
      </div>

      {/* buffs */}
      {(hud.buffs.shield > 0 || hud.buffs.rapid > 0 || hud.buffs.spread > 0) && (
        <div className="mt-1.5 flex justify-center gap-1.5">
          {hud.buffs.shield > 0 && <Chip label={`SHIELD ${hud.buffs.shield.toFixed(0)}s`} frac={hud.buffs.shield / 9} color="#4df0ff" />}
          {hud.buffs.rapid > 0 && <Chip label="RAPID" frac={hud.buffs.rapid / 10} color="#ffef7a" />}
          {hud.buffs.spread > 0 && <Chip label="TRIPLE" frac={hud.buffs.spread / 12} color="#ff8f5e" />}
        </div>
      )}

      {/* boss bar */}
      {hud.boss && (
        <div className="anim-pop mx-auto mt-2 w-full max-w-xl">
          <div className={`text-center font-display text-[10px] font-black tracking-[0.4em] ${hud.boss.enraged ? 'text-orange-300' : 'text-pink-300'}`}>
            {hud.boss.enraged ? '☠ ' : ''}{hud.boss.name}{hud.boss.enraged ? ' — ENRAGED' : ''}
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full border border-pink-400/40 bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-[#ff5e9c] to-[#ffb45e] shadow-[0_0_14px_#ff5e9c] transition-[width] duration-200"
              style={{ width: `${Math.max(0, (hud.boss.hp / hud.boss.max) * 100)}%` }} />
          </div>
        </div>
      )}

      {/* low hp warning */}
      {hud.hull === 1 && hud.maxHull > 1 && (
        <div className="anim-pulse-glow mt-2 text-center font-display text-[11px] font-black tracking-[0.35em] text-red-300">
          ⚠ HULL CRITICAL ⚠
        </div>
      )}
    </div>
  );
}
function Chip({ label, frac, color }: any) {
  return (
    <span className="relative overflow-hidden rounded-full border px-2.5 py-[3px] text-[10px] font-bold tracking-[0.15em]"
      style={{ color, borderColor: color + '88', background: 'rgba(0,0,0,.4)' }}>
      {label}
      <i className="absolute bottom-0 left-0 h-[2px]" style={{ width: `${Math.min(100, frac * 100)}%`, background: color }} />
    </span>
  );
}

/* ================= TOUCH ================= */
function TouchControls({ engine, hud }: { engine: any; hud: HudState | null }) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState<{ active: boolean; ox: number; oy: number; dx: number; dy: number; id: number | null }>(
    { active: false, ox: 0, oy: 0, dx: 0, dy: 0, id: null });
  const [firing, setFiring] = useState(false);
  const R = 52;

  const onDown = (e: React.PointerEvent) => {
    if (stick.id !== null) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const ox = e.clientX, oy = e.clientY;
    setStick({ active: true, ox, oy, dx: 0, dy: 0, id: e.pointerId });
    engine.current?.setMove(0, 0);
  };
  const onMove = (e: React.PointerEvent) => {
    if (e.pointerId !== stick.id) return;
    let dx = e.clientX - stick.ox, dy = e.clientY - stick.oy;
    let len = Math.hypot(dx, dy);
    let ox = stick.ox, oy = stick.oy;
    if (len > R) {
      ox += (dx / len) * (len - R); oy += (dy / len) * (len - R);
      dx = e.clientX - ox; dy = e.clientY - oy; len = R;
    }
    const m = Math.min(1, len / R);
    const nx = len ? dx / len : 0, ny = len ? dy / len : 0;
    engine.current?.setMove(nx * m, ny * m);
    setStick({ active: true, ox, oy, dx: nx * Math.min(len, R), dy: ny * Math.min(len, R), id: e.pointerId });
  };
  const onUp = (e: React.PointerEvent) => {
    if (e.pointerId !== stick.id) return;
    setStick(s => ({ ...s, active: false, dx: 0, dy: 0, id: null }));
    engine.current?.setMove(0, 0);
  };

  const holdFire = (b: boolean) => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    setFiring(b); engine.current?.setFiring(b);
  };

  return (
    <>
      {/* joystick zone */}
      <div ref={zoneRef} className="absolute bottom-0 left-0 z-20 h-[62%] w-[52%]"
        style={{ touchAction: 'none' }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
      {stick.active && (
        <div className="pointer-events-none fixed z-30 rounded-full border-2 border-cyan-300/40 bg-cyan-300/10"
          style={{ left: stick.ox - 62, top: stick.oy - 62, width: 124, height: 124 }}>
          <div className="absolute rounded-full bg-gradient-to-br from-cyan-100 to-cyan-400 shadow-[0_0_22px_#4df0ff]"
            style={{ left: 62 - 27 + stick.dx, top: 62 - 27 + stick.dy, width: 54, height: 54 }} />
        </div>
      )}
      {!stick.active && (
        <div className="pointer-events-none absolute z-10 animate-pulse rounded-full border border-dashed border-cyan-200/25"
          style={{ left: 'calc(env(safe-area-inset-left, 0px) + 26px)', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)', width: 110, height: 110 }}>
          <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-200/30" />
        </div>
      )}
      {/* action buttons */}
      <div className="absolute z-20 flex items-end gap-2.5"
        style={{ right: 'calc(env(safe-area-inset-right, 0px) + 14px)', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 22px)' }}>
        <div className="flex flex-col gap-2.5">
          <button
            onPointerDown={e => { e.preventDefault(); engine.current?.queueBomb(); }}
            className="touch-btn relative grid h-16 w-16 place-items-center rounded-full border-2 border-pink-300/50 bg-pink-500/15 text-lg text-pink-100">
            ✹
            <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#ffef7a] px-1 text-[11px] font-black text-black">{hud?.bombs ?? 0}</span>
          </button>
          <button
            onPointerDown={e => { e.preventDefault(); engine.current?.queueDash(); }}
            className="touch-btn relative grid h-16 w-16 place-items-center overflow-hidden rounded-full border-2 border-cyan-300/50 bg-cyan-400/15 text-xl text-cyan-100">
            ⚡
            <span className="cooldown-conic absolute inset-0 rounded-full" style={{ ['--cd' as any]: 1 - (hud?.dashFrac ?? 1) }} />
          </button>
        </div>
        <button
          onPointerDown={holdFire(true)} onPointerUp={holdFire(false)} onPointerCancel={holdFire(false)} onPointerLeave={holdFire(false)}
          onContextMenu={e => e.preventDefault()}
          className={`touch-btn font-display grid h-24 w-24 place-items-center rounded-full border-2 text-sm font-black tracking-widest ${firing ? 'held border-cyan-100 bg-cyan-300/40 text-white' : 'border-cyan-300/60 bg-cyan-400/15 text-cyan-100 shadow-[0_0_26px_rgba(10,213,255,.3)]'}`}>
          FIRE
        </button>
      </div>
      {/* overdrive mini button */}
      <button
        onPointerDown={e => { e.preventDefault(); engine.current?.queueOverdrive(); }}
        className={`absolute z-20 rounded-full border px-3 py-1.5 font-display text-[11px] font-black tracking-widest touch-btn ${((hud?.od ?? 0) >= 100 || hud?.odActive) ? 'border-yellow-200/70 bg-yellow-300/25 text-yellow-100 shadow-[0_0_16px_rgba(255,239,122,.5)]' : 'border-white/20 bg-black/40 text-slate-300'}`}
        style={{ right: 'calc(env(safe-area-inset-right, 0px) + 18px)', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 128px)' }}>
        ◎ {hud?.odActive ? 'OD!' : Math.floor(hud?.od ?? 0) + '%'}
      </button>
    </>
  );
}

/* ================= DRAFT ================= */
function DraftModal({ draft, onPick, level }: { draft: UpgradeDef[]; onPick: (id: string) => void; level: number }) {
  return (
    <div className="absolute inset-0 z-40 grid place-items-center overflow-y-auto bg-[#04060f]/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl py-4">
        <div className="text-center">
          <div className="font-display anim-pop text-[11px] font-bold tracking-[0.4em] text-[#ffef7a]">◈ SYSTEM UPGRADE AVAILABLE ◈</div>
          <div className="font-display mt-1 text-2xl font-black tracking-widest text-white glow-gold">LEVEL {level} — CHOOSE ONE</div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {draft.map((u, i) => {
            const I = UPGRADE_ICONS[u.icon] || Zap;
            const c = RARITY_COLOR[u.rarity];
            return (
              <button key={u.id} onClick={() => onPick(u.id)} className="upgrade-card anim-draft glass rounded-2xl border border-white/15 p-4 text-left"
                style={{ animationDelay: `${i * 0.08}s`, borderTop: `2px solid ${c}` }}>
                <div className="flex items-center justify-between">
                  <div className="grid h-11 w-11 place-items-center rounded-xl" style={{ background: c + '1e', border: `1px solid ${c}55` }}>
                    <I size={20} style={{ color: c }} />
                  </div>
                  <span className="rounded-full px-2 py-[2px] text-[9px] font-black tracking-[0.2em]" style={{ color: c, background: c + '14', border: `1px solid ${c}44` }}>
                    {u.rarity.toUpperCase()}
                  </span>
                </div>
                <div className="font-display mt-3 text-[13px] font-black tracking-wider text-white">{u.name}</div>
                <div className="mt-1 min-h-[2.6em] text-[13px] leading-snug text-slate-300">{u.desc}</div>
                <div className="mt-2 flex items-center gap-1 text-[11px] font-bold tracking-widest text-[#ffef7a]">
                  INSTALL <ChevronRight size={12} />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ================= PAUSE ================= */
function PauseModal({ onResume, onRestart, onMenu, settings, updSettings, hud }: any) {
  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-[#04060f]/70 p-4 backdrop-blur-md">
      <div className="glass anim-pop w-full max-w-sm rounded-3xl p-6 text-center">
        <div className="font-display text-2xl font-black tracking-[0.25em] text-white">PAUSED</div>
        <div className="mt-1 text-[11px] tracking-[0.3em] text-slate-400">SYSTEMS ON STANDBY</div>
        {hud && (
          <div className="mono-num mt-3 flex justify-center gap-5 text-[13px] text-slate-300">
            <span>SCORE <b className="text-[#ffef7a]">{fmt(hud.score)}</b></span>
            <span>WAVE <b className="text-cyan-300">{hud.wave}</b></span>
            <span>LVL <b className="text-white">{hud.level}</b></span>
          </div>
        )}
        <button onClick={onResume} className="btn-launch font-display mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-base font-black tracking-[0.25em]">
          <Play size={18} strokeWidth={3} /> RESUME
        </button>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button onClick={onRestart} className="btn-ghost font-display flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[12px] font-bold tracking-widest text-slate-200">
            <RotateCcw size={14} /> RESTART
          </button>
          <button onClick={onMenu} className="btn-ghost font-display flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[12px] font-bold tracking-widest text-slate-200">
            <Home size={14} /> MENU
          </button>
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-1.5">
          <MiniToggle on={settings.sound} label="SND" onClick={() => updSettings({ sound: !settings.sound })} />
          <MiniToggle on={settings.music} label="MUS" onClick={() => updSettings({ music: !settings.music })} />
          <MiniToggle on={settings.haptics} label="HAP" onClick={() => updSettings({ haptics: !settings.haptics })} />
          <MiniToggle on={settings.autoFire} label="AUTO" onClick={() => updSettings({ autoFire: !settings.autoFire })} />
          <MiniToggle on={settings.shake} label="SHK" onClick={() => updSettings({ shake: !settings.shake })} />
        </div>
      </div>
    </div>
  );
}
function MiniToggle({ on, label, onClick }: any) {
  return (
    <button onClick={onClick} className={`rounded-full border px-2.5 py-1 text-[10px] font-black tracking-widest ${on ? 'border-cyan-300/60 bg-cyan-300/15 text-cyan-200' : 'border-white/15 text-slate-500'}`}>
      {label} {on ? 'ON' : 'OFF'}
    </button>
  );
}

/* ================= GAME OVER ================= */
function GameOverModal({ stats, onRetry, onMenu }: { stats: RunStats; onRetry: () => void; onMenu: () => void }) {
  const gradeColor = stats.grade === 'S' ? '#ffef7a' : stats.grade === 'A' ? '#4df0ff' : stats.grade === 'B' ? '#5eff8f' : '#8ea4bd';
  return (
    <div className="absolute inset-0 z-40 grid place-items-center overflow-y-auto bg-[#04060f]/72 p-4 backdrop-blur-md">
      <div className="glass anim-pop w-full max-w-md rounded-3xl p-6 text-center">
        <div className="font-display text-3xl font-black tracking-[0.2em] text-[#ff5e9c] glow-pink">SHIP LOST</div>
        {stats.isRecord && (
          <div className="anim-record font-display mx-auto mt-2 w-max rounded-full border border-yellow-200/60 bg-yellow-300/15 px-4 py-1 text-[12px] font-black tracking-[0.3em] text-[#ffd700]">
            ★ NEW RECORD ★
          </div>
        )}
        <div className="mt-4 flex items-center justify-center gap-3">
          <div className="grid h-20 w-20 place-items-center rounded-2xl border font-display text-4xl font-black" style={{ color: gradeColor, borderColor: gradeColor + '66', background: gradeColor + '10', textShadow: `0 0 24px ${gradeColor}` }}>
            {stats.grade}
          </div>
          <div className="text-left">
            <div className="text-[10px] tracking-[0.3em] text-slate-400">PILOT GRADE</div>
            <div className="mono-num text-2xl font-black text-white">{fmt(stats.score)}</div>
            <div className="text-[11px] tracking-widest text-slate-400">{SHIPS[stats.ship].name} · {DIFFS[stats.diff].label.toUpperCase()} · WAVE {stats.wave}</div>
          </div>
        </div>
        <div className="mono-num mt-4 grid grid-cols-4 gap-2">
          <Stat icon={<Target size={13} />} label="KILLS" value={String(stats.kills)} />
          <Stat icon={<Timer size={13} />} label="TIME" value={fmtTime(stats.time)} />
          <Stat icon={<Star size={13} />} label="LEVEL" value={String(stats.level)} />
          <Stat icon={<Swords size={13} />} label="ACC" value={Math.round(stats.accuracy * 100) + '%'} />
        </div>
        <div className="mono-num mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-white/[0.04] p-2.5"><div className="text-[10px] tracking-[0.25em] text-slate-400">MAX CHAIN</div><div className="text-lg font-black text-[#ffef7a]">{stats.maxCombo}</div></div>
          <div className="rounded-xl bg-white/[0.04] p-2.5"><div className="text-[10px] tracking-[0.25em] text-slate-400">BEST</div><div className="text-lg font-black text-slate-200">{fmt(stats.best)}</div></div>
        </div>
        <button onClick={onRetry} className="btn-launch font-display mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-base font-black tracking-[0.25em]">
          <RotateCcw size={18} strokeWidth={3} /> RELAUNCH
        </button>
        <button onClick={onMenu} className="btn-ghost font-display mt-2 flex w-full items-center justify-center gap-2 rounded-2xl py-2.5 text-[12px] font-bold tracking-[0.25em] text-slate-200">
          <Home size={14} /> MAIN MENU
        </button>
        <div className="mt-2 flex items-center justify-center gap-1 text-[11px] text-slate-500">
          <Trophy size={11} /> Tip: elites drop guaranteed loot — hunt the gold.
        </div>
      </div>
    </div>
  );
}
function Stat({ icon, label, value }: any) {
  return (
    <div className="rounded-xl bg-white/[0.04] p-2.5">
      <div className="mx-auto mb-1 w-max text-slate-400">{icon}</div>
      <div className="text-[9px] tracking-[0.25em] text-slate-500">{label}</div>
      <div className="text-[15px] font-black text-white">{value}</div>
    </div>
  );
}
