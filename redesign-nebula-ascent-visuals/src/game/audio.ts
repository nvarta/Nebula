// Nebula Ascent — synth SFX + adaptive music engine (no assets)
export class AudioEngine {
  ac: AudioContext | null = null;
  master: GainNode | null = null;
  sfxBus: GainNode | null = null;
  musicBus: GainNode | null = null;
  noiseBuf: AudioBuffer | null = null;
  musicOn = true;
  soundOn = true;
  volume = 0.8;
  private musicTimer: number | null = null;
  private step = 0;
  private nextT = 0;

  init() {
    if (this.ac) {
      if (this.ac.state === 'suspended') this.ac.resume();
      return;
    }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    this.ac = new AC();
    this.master = this.ac.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ac.destination);
    this.sfxBus = this.ac.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);
    this.musicBus = this.ac.createGain();
    this.musicBus.gain.value = 0.34;
    this.musicBus.connect(this.master);
    const len = Math.floor(this.ac.sampleRate * 0.6);
    const buf = this.ac.createBuffer(1, len, this.ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    this.noiseBuf = buf;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master && this.ac) this.master.gain.setTargetAtTime(v, this.ac.currentTime, 0.03);
  }
  setSoundOn(b: boolean) { this.soundOn = b; }
  setMusicOn(b: boolean) {
    this.musicOn = b;
    if (!b) this.stopMusic();
    else this.startMusic();
  }

  private tone(f1: number, f2: number, dur: number, type: OscillatorType, vol: number, bus?: GainNode | null) {
    if (!this.soundOn || !this.ac || !this.sfxBus) return;
    const t = this.ac.currentTime;
    const o = this.ac.createOscillator();
    const g = this.ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f1), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus || this.sfxBus);
    o.start(t); o.stop(t + dur + 0.03);
  }

  private burst(dur: number, vol: number, freq: number, q = 1) {
    if (!this.soundOn || !this.ac || !this.sfxBus || !this.noiseBuf) return;
    const t = this.ac.currentTime;
    const s = this.ac.createBufferSource();
    const f = this.ac.createBiquadFilter();
    const g = this.ac.createGain();
    s.buffer = this.noiseBuf;
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfxBus);
    s.start(t); s.stop(t + dur + 0.03);
  }

  shoot() { this.tone(920 + Math.random() * 120, 280, 0.07, 'square', 0.035); }
  rail() { this.tone(1600, 200, 0.16, 'sawtooth', 0.06); this.burst(0.1, 0.08, 3400, 2); }
  eshoot() { this.tone(330, 130, 0.11, 'sawtooth', 0.028); }
  tick() { this.burst(0.05, 0.1, 2300, 2); }
  boom(big = false) {
    this.burst(big ? 0.55 : 0.26, big ? 0.5 : 0.26, big ? 240 : 640, 0.8);
    this.tone(big ? 150 : 250, 38, big ? 0.5 : 0.24, 'sine', big ? 0.3 : 0.15);
  }
  hurt() { this.tone(210, 55, 0.35, 'sawtooth', 0.2); this.burst(0.3, 0.24, 380, 0.7); }
  grab() { this.tone(660, 1320, 0.12, 'triangle', 0.12); setTimeout(() => this.tone(990, 1760, 0.1, 'triangle', 0.09), 70); }
  level() {
    this.tone(520, 780, 0.12, 'triangle', 0.13);
    setTimeout(() => this.tone(660, 990, 0.12, 'triangle', 0.12), 90);
    setTimeout(() => this.tone(880, 1320, 0.2, 'triangle', 0.13), 180);
  }
  dash() { this.burst(0.2, 0.15, 1500, 0.6); this.tone(380, 920, 0.16, 'sine', 0.06); }
  wave() { this.tone(520, 780, 0.16, 'triangle', 0.11); setTimeout(() => this.tone(780, 1080, 0.22, 'triangle', 0.1), 130); }
  warn() { this.tone(150, 85, 0.5, 'sawtooth', 0.15); }
  bomb() { this.burst(0.8, 0.5, 170, 0.5); this.tone(120, 28, 0.8, 'sine', 0.3); }
  overdrive() {
    this.tone(200, 1200, 0.5, 'sawtooth', 0.1);
    setTimeout(() => this.tone(400, 1600, 0.4, 'square', 0.06), 120);
  }
  ui() { this.tone(700, 900, 0.06, 'triangle', 0.07); }
  deny() { this.tone(220, 140, 0.14, 'square', 0.08); }

  // ---- adaptive synthwave loop ----
  startMusic() {
    if (!this.ac || !this.musicOn || this.musicTimer !== null) return;
    this.step = 0;
    this.nextT = this.ac.currentTime + 0.1;
    const bass = [55, 55, 65.4, 49, 55, 55, 82.4, 73.4];
    const arp = [220, 261.6, 329.6, 440, 329.6, 261.6];
    const tick = () => {
      if (!this.ac || !this.musicBus || !this.musicOn) return;
      while (this.nextT < this.ac.currentTime + 0.25) {
        const s = this.step;
        const b = bass[s % bass.length];
        this.mnote(b, this.nextT, 0.22, 'sawtooth', 0.11, 300);
        if (s % 2 === 0) {
          const a = arp[(s >> 1) % arp.length] * 2;
          this.mnote(a, this.nextT, 0.12, 'triangle', 0.05, 2400);
        }
        if (s % 8 === 7) this.mnote(b * 4, this.nextT, 0.3, 'sine', 0.05, 4000);
        // hats
        if (s % 2 === 1) this.mhat(this.nextT);
        this.nextT += 0.21;
        this.step++;
      }
    };
    this.musicTimer = window.setInterval(tick, 90);
  }
  private mnote(freq: number, t: number, dur: number, type: OscillatorType, vol: number, cutoff: number) {
    if (!this.ac || !this.musicBus) return;
    const o = this.ac.createOscillator();
    const g = this.ac.createGain();
    const f = this.ac.createBiquadFilter();
    o.type = type; o.frequency.value = freq;
    f.type = 'lowpass'; f.frequency.value = cutoff;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.musicBus);
    o.start(t); o.stop(t + dur + 0.02);
  }
  private mhat(t: number) {
    if (!this.ac || !this.musicBus || !this.noiseBuf) return;
    const s = this.ac.createBufferSource();
    const f = this.ac.createBiquadFilter();
    const g = this.ac.createGain();
    s.buffer = this.noiseBuf;
    f.type = 'highpass'; f.frequency.value = 6800;
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    s.connect(f); f.connect(g); g.connect(this.musicBus);
    s.start(t); s.stop(t + 0.07);
  }
  stopMusic() {
    if (this.musicTimer !== null) { clearInterval(this.musicTimer); this.musicTimer = null; }
  }
}

export const audio = new AudioEngine();

export function buzz(p: number | number[]) {
  try {
    const h = (window as any).__hapticsOn;
    if (h === false) return;
    if (navigator.vibrate) navigator.vibrate(p as any);
  } catch {}
}
