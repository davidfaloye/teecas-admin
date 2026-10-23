// New-order alarm: a ringing bell, like a hand bell shaken at the pass, loud enough to hear across
// a busy room. It is made in code (no sound file to load), so it works offline. Browsers only allow sound after someone has clicked or typed on the page, so the
// audio is unlocked on the first interaction (signing in counts).

let ctx = null;

function audio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

if (typeof window !== 'undefined') {
  const unlock = () => {
    audio();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

// One strike of a small metal bell: a few inharmonic partials (the ratios of a real bell) that
// fade at different speeds, the high ones fastest, which gives the bright "ting" and the ring.
const PARTIALS = [
  [1, 0.55, 1.6], // [ratio to the pitch, loudness, seconds to fade]
  [2.76, 0.3, 0.9],
  [5.4, 0.16, 0.45],
  [8.93, 0.08, 0.25],
];

function strike(c, out, t, pitch, level) {
  for (const [ratio, gain, fade] of PARTIALS) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(pitch * ratio, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + fade);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + fade + 0.05);
  }
}

// Two rings of a shaken bell (about 2.6 seconds): quick strikes, the clapper hitting one side
// then the other, so the pitch wobbles slightly.
export function playAlarm() {
  try {
    const c = audio();
    if (!c) return;
    const out = c.createDynamicsCompressor(); // loud without distorting
    out.threshold.value = -14;
    out.ratio.value = 8;
    const master = c.createGain();
    master.gain.value = 1;
    out.connect(master).connect(c.destination);

    const start = c.currentTime + 0.05;
    const rings = 2;
    const strikes = 8;
    const every = 0.13;
    const gap = 0.3;
    const pitch = 1040;
    for (let r = 0; r < rings; r++) {
      for (let i = 0; i < strikes; i++) {
        const t = start + r * (strikes * every + gap) + i * every;
        strike(c, out, t, i % 2 ? pitch * 1.012 : pitch, i === 0 ? 1 : 0.8);
      }
    }
    const end = rings * (strikes * every + gap) + 1.8;
    setTimeout(() => {
      out.disconnect();
      master.disconnect();
    }, end * 1000);
  } catch {
    /* audio unavailable */
  }
}
