// New-order alarm: a loud two-tone ring, like a kitchen order printer, so staff hear it across
// a busy room. Browsers only allow sound after someone has clicked or typed on the page, so the
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

// Three bursts of fast high-low tones (about 2.5 seconds), square wave for a sharp, cutting sound.
export function playAlarm() {
  try {
    const c = audio();
    if (!c) return;
    const out = c.createDynamicsCompressor(); // loud without distorting
    out.threshold.value = -10;
    out.ratio.value = 6;
    const master = c.createGain();
    master.gain.value = 0.9;
    out.connect(master).connect(c.destination);

    const start = c.currentTime + 0.05;
    const tone = 0.13;
    const bursts = 3;
    const perBurst = 6;
    const gap = 0.28;
    for (let b = 0; b < bursts; b++) {
      for (let i = 0; i < perBurst; i++) {
        const t = start + b * (perBurst * tone + gap) + i * tone;
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = 'square';
        o.frequency.setValueAtTime(i % 2 ? 740 : 1180, t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
        g.gain.setValueAtTime(0.5, t + tone - 0.025);
        g.gain.exponentialRampToValueAtTime(0.0001, t + tone - 0.005);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + tone);
      }
    }
    const end = bursts * (perBurst * tone + gap);
    setTimeout(() => {
      out.disconnect();
      master.disconnect();
    }, (end + 0.5) * 1000);
  } catch {
    /* audio unavailable */
  }
}
