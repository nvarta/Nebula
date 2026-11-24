// Shared game config — ships, difficulties, upgrades
export type ShipId = 'vanguard' | 'phantom' | 'bastion';
export type DiffId = 'easy' | 'normal' | 'hard' | 'nightmare';

export interface ShipDef {
  id: ShipId; name: string; title: string; desc: string;
  hull: number; speed: number; fireRate: number; damage: number;
  projectiles: number; magnet: number; dashCd: number;
  color: string; accent: string;
  stats: { fire: number; speed: number; hull: number; handling: number };
}

export const SHIPS: Record<ShipId, ShipDef> = {
  vanguard: {
    id: 'vanguard', name: 'VANGUARD', title: 'Strike Interceptor',
    desc: 'Balanced frame. Reliable pulse cannons, forgiving handling. The pilot’s choice.',
    hull: 3, speed: 440, fireRate: 0.15, damage: 1, projectiles: 1, magnet: 140, dashCd: 2.0,
    color: '#4df0ff', accent: '#0ad5ff',
    stats: { fire: 3, speed: 3, hull: 3, handling: 4 },
  },
  phantom: {
    id: 'phantom', name: 'PHANTOM', title: 'Ghost Darter',
    desc: 'Featherweight hull. Blistering fire rate, phantom dash with rapid recharge. Fragile.',
    hull: 2, speed: 525, fireRate: 0.115, damage: 1, projectiles: 1, magnet: 160, dashCd: 1.35,
    color: '#b95eff', accent: '#ff5ef2',
    stats: { fire: 4, speed: 5, hull: 2, handling: 5 },
  },
  bastion: {
    id: 'bastion', name: 'BASTION', title: 'Siege Bulwark',
    desc: 'Heavy gunship. Twin-linked scatter from the start, five hull plates. Slow but unstoppable.',
    hull: 5, speed: 375, fireRate: 0.175, damage: 1, projectiles: 2, magnet: 120, dashCd: 2.4,
    color: '#ff9f45', accent: '#ffef7a',
    stats: { fire: 4, speed: 2, hull: 5, handling: 2 },
  },
};

export interface DiffDef {
  id: DiffId; label: string; desc: string; color: string;
  lives: number; rockSpd: number; rockBase: number; rockPer: number;
  foeMax: number; foeBase: number; foePer: number; foeFire: number; foeSpd: number; foeHP: number;
  bossHP: number; bombs: number; mul: number; xpMul: number;
}

export const DIFFS: Record<DiffId, DiffDef> = {
  easy:      { id:'easy', label:'Easy', color:'#5eff8f', desc:'Room to breathe. Slow debris, timid hostiles, 5 hull. 1.0x score.', lives:5, rockSpd:.72, rockBase:3, rockPer:.45, foeMax:3, foeBase:1, foePer:.45, foeFire:1.7, foeSpd:.82, foeHP:0, bossHP:.7, bombs:2, mul:1, xpMul:1.15 },
  normal:    { id:'normal', label:'Normal', color:'#4df0ff', desc:'A fair fight among the stars. 3 hull, steady pressure. 1.5x score.', lives:3, rockSpd:1, rockBase:4, rockPer:.6, foeMax:4, foeBase:1, foePer:.6, foeFire:1.15, foeSpd:1, foeHP:0, bossHP:1, bombs:1, mul:1.5, xpMul:1 },
  hard:      { id:'hard', label:'Hard', color:'#ff9f45', desc:'Aggressive wings, dense fields, 2 hull. 2x score.', lives:2, rockSpd:1.24, rockBase:5, rockPer:.7, foeMax:5, foeBase:2, foePer:.7, foeFire:.85, foeSpd:1.12, foeHP:1, bossHP:1.3, bombs:1, mul:2, xpMul:.95 },
  nightmare: { id:'nightmare', label:'Nightmare', color:'#ff5e9c', desc:'One hull. Relentless swarms. No mercy. 3x score.', lives:1, rockSpd:1.55, rockBase:6, rockPer:.85, foeMax:7, foeBase:2, foePer:.9, foeFire:.6, foeSpd:1.25, foeHP:1, bossHP:1.7, bombs:0, mul:3, xpMul:.9 },
};

export interface UpgradeDef {
  id: string; name: string; desc: string; icon: string;
  rarity: 'common' | 'rare' | 'epic'; max: number;
}

export const UPGRADES: UpgradeDef[] = [
  { id:'overclock', name:'Overclocked Coils', desc:'+18% fire rate. Melt everything faster.', icon:'zap', rarity:'common', max:5 },
  { id:'heavy', name:'Heavy Rounds', desc:'+1 bullet damage. Shred armor.', icon:'crosshair', rarity:'rare', max:4 },
  { id:'split', name:'Split Barrels', desc:'+1 projectile per volley.', icon:'split', rarity:'epic', max:3 },
  { id:'velocity', name:'Rail Velocity', desc:'+25% bullet speed, +1 pierce.', icon:'wind', rarity:'common', max:3 },
  { id:'thrusters', name:'Ion Thrusters', desc:'+12% flight speed & handling.', icon:'rocket', rarity:'common', max:4 },
  { id:'magnet', name:'Tractor Array', desc:'+55% pickup radius. XP flies to you.', icon:'magnet', rarity:'common', max:3 },
  { id:'plating', name:'Hull Plating', desc:'+1 max hull and repair 1 now.', icon:'shield', rarity:'rare', max:3 },
  { id:'dashcore', name:'Phase Dash Core', desc:'-22% dash cooldown, longer blink.', icon:'ghost', rarity:'common', max:3 },
  { id:'odcell', name:'Overdrive Cell', desc:'+35% overdrive charge gain.', icon:'battery', rarity:'rare', max:3 },
  { id:'crit', name:'Crit Matrix', desc:'+15% chance to crit for 2.5x damage.', icon:'sparkles', rarity:'rare', max:4 },
  { id:'guardian', name:'Guardian Protocol', desc:'Start every wave with a shield.', icon:'shieldplus', rarity:'epic', max:1 },
  { id:'arsenal', name:'Arsenal Cache', desc:'+1 max bomb, bombs hit 2x harder.', icon:'bomb', rarity:'epic', max:2 },
  { id:'regen', name:'Nano Weave', desc:'Regenerate 1 hull every 3 waves.', icon:'heart', rarity:'epic', max:1 },
  { id:'vampire', name:'Siphon Rounds', desc:'Kills grant +8 overdrive & small heal chance.', icon:'droplet', rarity:'rare', max:2 },
];

export function xpForLevel(level: number) {
  return Math.round(10 + (level - 1) * 7 + Math.pow(level - 1, 1.7) * 3);
}

export function gradeFor(score: number, wave: number, acc: number): string {
  const s = score / 1000 + wave * 4 + acc * 20;
  if (s > 220) return 'S';
  if (s > 140) return 'A';
  if (s > 85) return 'B';
  if (s > 40) return 'C';
  return 'D';
}
