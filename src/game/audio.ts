// WebAudio 신스 효과음 — 외부 에셋 없이 전부 합성.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

function ac(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function setMuted(m: boolean): void {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.5;
}

export function isMuted(): boolean {
  return muted;
}

/** 사용자 제스처 안에서 호출해 오디오 컨텍스트 활성화 */
export function unlockAudio(): void {
  ac();
}

function tone(
  freq: number,
  dur: number,
  type: OscillatorType = "square",
  vol = 0.3,
  delay = 0,
  slideTo?: number
): void {
  const c = ac();
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(master!);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(dur: number, vol = 0.3, delay = 0, lowpass = 4000): void {
  const c = ac();
  const t0 = c.currentTime + delay;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = lowpass;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filter).connect(g).connect(master!);
  src.start(t0);
}

export const sfx = {
  place(): void {
    tone(220, 0.08, "sine", 0.25, 0, 320);
    tone(440, 0.06, "triangle", 0.15, 0.02);
  },
  explode(): void {
    noise(0.35, 0.4, 0, 2200);
    tone(120, 0.3, "sine", 0.35, 0, 40);
    noise(0.2, 0.2, 0.05, 6000); // 물 튀는 고역
  },
  blockBreak(): void {
    noise(0.15, 0.22, 0, 3000);
    tone(330, 0.1, "triangle", 0.12, 0, 180);
  },
  pickup(): void {
    tone(660, 0.07, "square", 0.18);
    tone(990, 0.1, "square", 0.18, 0.06);
  },
  trapped(): void {
    tone(520, 0.12, "sine", 0.25, 0, 380);
    tone(380, 0.18, "sine", 0.2, 0.1, 300);
  },
  rescue(): void {
    tone(523, 0.08, "triangle", 0.22);
    tone(659, 0.08, "triangle", 0.22, 0.07);
    tone(784, 0.14, "triangle", 0.22, 0.14);
  },
  pop(): void {
    noise(0.12, 0.35, 0, 5000);
    tone(880, 0.05, "square", 0.2, 0, 220);
    tone(200, 0.25, "sine", 0.25, 0.04, 60);
  },
  needle(): void {
    tone(1200, 0.05, "square", 0.2);
    tone(1600, 0.08, "square", 0.15, 0.04);
  },
  roundStart(): void {
    [392, 523, 659, 784].forEach((f, i) => tone(f, 0.12, "square", 0.2, i * 0.09));
  },
  win(): void {
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.14, "triangle", 0.22, i * 0.11));
  },
  lose(): void {
    [392, 349, 311, 262].forEach((f, i) => tone(f, 0.2, "triangle", 0.2, i * 0.16));
  },
  draw(): void {
    [440, 440, 349].forEach((f, i) => tone(f, 0.16, "triangle", 0.18, i * 0.14));
  },
  itemDestroyed(): void {
    noise(0.08, 0.12, 0, 4000);
  },
};
