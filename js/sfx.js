/* =========================================================================
 * sfx.js — Web Audio 합성 효과음 (외부 에셋 없음)
 * 첫 사용자 제스처에서 init() 호출 필요(브라우저 오디오 정책).
 * ======================================================================= */
(function () {
  let ctx = null, master = null, muted = false;
  let noiseBuf = null;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      // 노이즈 버퍼(타격음용)
      const n = ctx.sampleRate * 0.3;
      noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    } catch (_) { ctx = null; }
  }

  function tone(freq, t0, dur, type, gain, glideTo) {
    if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noise(t0, dur, gain, freq) {
    if (!ctx) return;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = freq || 1800; f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t0); s.stop(t0 + dur);
  }

  const now = () => ctx ? ctx.currentTime : 0;

  const SFX = {
    init,
    toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.5; return muted; },

    // 손패 던지기 — 짧은 "착"
    play() { if (!ctx || muted) return; const t = now(); noise(t, 0.09, 0.32, 1500); tone(420, t, 0.06, 'square', 0.05); },
    // 더미 뒤집기 — 가벼운 블립
    flip() { if (!ctx || muted) return; const t = now() + 0.04; noise(t, 0.06, 0.22, 2600); tone(700, t, 0.05, 'triangle', 0.06); },
    // 카드 먹기 — 기분좋은 2음
    capture() { if (!ctx || muted) return; const t = now(); tone(660, t, 0.1, 'triangle', 0.14); tone(990, t + 0.08, 0.14, 'triangle', 0.13); },
    // 쪽/따닥/싹쓸이 — 반짝 아르페지오
    sparkle() { if (!ctx || muted) return; const t = now(); [784, 988, 1319, 1568].forEach((f, i) => tone(f, t + i * 0.05, 0.16, 'triangle', 0.12)); },
    // 뻑 — 둔탁한 thud
    thud() { if (!ctx || muted) return; const t = now(); tone(150, t, 0.28, 'sine', 0.28, 60); noise(t, 0.16, 0.3, 280); },
    // 고
    go() { if (!ctx || muted) return; const t = now(); tone(523, t, 0.12, 'sawtooth', 0.12); tone(784, t + 0.1, 0.18, 'sawtooth', 0.12, 1046); },
    // 승리 팡파레
    win() { if (!ctx || muted) return; const t = now(); [523, 659, 784, 1046].forEach((f, i) => tone(f, t + i * 0.11, 0.3, 'triangle', 0.16)); },
    // 패배
    lose() { if (!ctx || muted) return; const t = now(); [440, 349, 262].forEach((f, i) => tone(f, t + i * 0.14, 0.32, 'sine', 0.16, undefined)); },
    // 딜링 틱
    deal() { if (!ctx || muted) return; const t = now(); noise(t, 0.05, 0.18, 2000); },
  };

  window.SFX = SFX;
})();
