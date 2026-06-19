/* =========================================================================
 * fx.js — PixiJS 효과 레이어 (화면 위에 깔리는 투명 캔버스, 클릭은 통과)
 * 게임 로직/DOM은 그대로. 여기서는 "반짝임·폭발·금가루" 같은 파티클만 그린다.
 * PIXI 미로드 시 모든 함수는 조용히 no-op → 게임은 정상 동작.
 * ======================================================================= */
(function () {
  let app = null, layer = null, ready = false;
  let texGlow = null, texRing = null;
  const parts = []; // 활성 파티클(스프라이트, 커스텀 속성 부착)

  /* 부드러운 흰색 글로우 점(틴트로 색 입힘) */
  function makeGlow() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.85)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(32, 32, 32, 0, 7); g.fill();
    return PIXI.Texture.from(c);
  }
  /* 충격파용 링(테두리 원) */
  function makeRing() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 9;
    g.beginPath(); g.arc(64, 64, 54, 0, 7); g.stroke();
    return PIXI.Texture.from(c);
  }

  async function init() {
    if (app || typeof PIXI === 'undefined') return;
    try {
      app = new PIXI.Application();
      await app.init({
        resizeTo: window, backgroundAlpha: 0, antialias: true,
        autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2),
      });
      const cv = app.canvas;
      cv.id = 'fxCanvas';
      cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9000;';
      document.body.appendChild(cv);
      layer = new PIXI.Container(); app.stage.addChild(layer);
      texGlow = makeGlow(); texRing = makeRing();
      app.ticker.add(tick);
      app.ticker.stop(); // 파티클 있을 때만 돌림(idle 시 렌더 루프 정지)
      ready = true;
    } catch (e) { app = null; ready = false; /* 실패해도 게임엔 영향 없음 */ }
  }

  function add(tex, x, y, o) {
    const p = new PIXI.Sprite(tex);
    p.anchor.set(0.5);
    p.x = x; p.y = y;
    p.blendMode = o.blend || 'add';
    p.tint = o.tint != null ? o.tint : 0xffffff;
    p._vx = o.vx || 0; p._vy = o.vy || 0; p._grav = o.grav || 0;
    p._spin = o.spin || 0; p._drag = o.drag != null ? o.drag : 1;
    p._life = p._maxLife = o.life;
    p._a0 = o.alpha != null ? o.alpha : 1;
    p._s0 = o.s0; p._s1 = o.s1 != null ? o.s1 : 0;
    p.scale.set(o.s0);
    layer.addChild(p); parts.push(p);
    if (app && app.ticker && !app.ticker.started) app.ticker.start(); // 첫 파티클 → 루프 시작
    return p;
  }

  function tick(ticker) {
    if (!parts.length) { app.ticker.stop(); return; }
    const f = Math.min(ticker.deltaTime, 3); // 탭 복귀 시 폭주 방지
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p._life -= f;
      if (p._life <= 0) { layer.removeChild(p); p.destroy(); parts.splice(i, 1); continue; }
      p._vy += p._grav * f;
      if (p._drag !== 1) { const d = Math.pow(p._drag, f); p._vx *= d; p._vy *= d; }
      p.x += p._vx * f; p.y += p._vy * f;
      p.rotation += p._spin * f;
      const t = 1 - p._life / p._maxLife;     // 0→1
      p.alpha = Math.max(0, 1 - t) * p._a0;
      p.scale.set(p._s0 + (p._s1 - p._s0) * t);
    }
  }

  const rnd = (a, b) => a + Math.random() * (b - a);
  const GOLD = [0xffe9a8, 0xffd86a, 0xffc23b, 0xfff7d6];
  const FIRE = [0xfff2b0, 0xffd152, 0xff8a3d, 0xff4d2e, 0xffffff];
  const pick = arr => arr[(Math.random() * arr.length) | 0];

  /* 카드 먹을 때: 금빛 반짝임 작은 폭발 */
  function sparkleAt(x, y, scale) {
    if (!ready) return;
    const k = scale || 1;
    const n = Math.round(14 * k);
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), sp = rnd(1.4, 5.2) * k;
      add(texGlow, x, y, {
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, grav: 0.06, drag: 0.92,
        life: rnd(26, 46), s0: rnd(0.35, 0.75) * k, s1: 0, tint: pick(GOLD),
      });
    }
    // 가운데 빛 번짐 + 작은 링
    add(texGlow, x, y, { vx: 0, vy: 0, life: 18, s0: 1.3 * k, s1: 2.4 * k, tint: 0xfff7d6, alpha: 0.9 });
    add(texRing, x, y, { vx: 0, vy: 0, life: 20, s0: 0.2 * k, s1: 1.5 * k, tint: 0xffe9a8, alpha: 0.8 });
  }

  /* 폭탄: 큰 폭발 + 충격파 링 + 불티 */
  function bombBlast(x, y) {
    if (!ready) return;
    // 중심 섬광
    add(texGlow, x, y, { vx: 0, vy: 0, life: 16, s0: 1.6, s1: 4.2, tint: 0xffffff, alpha: 1 });
    // 충격파 링
    add(texRing, x, y, { vx: 0, vy: 0, life: 26, s0: 0.25, s1: 4.6, tint: 0xffd152, alpha: 0.95 });
    add(texRing, x, y, { vx: 0, vy: 0, life: 34, s0: 0.15, s1: 6.2, tint: 0xff7a3d, alpha: 0.6 });
    // 불티
    for (let i = 0; i < 42; i++) {
      const a = rnd(0, Math.PI * 2), sp = rnd(4, 15);
      add(texGlow, x, y, {
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, grav: 0.14, drag: 0.9,
        life: rnd(30, 62), s0: rnd(0.4, 1.1), s1: 0, tint: pick(FIRE),
      });
    }
  }

  /* 승리: 화면 위에서 금가루가 우수수 (여러 웨이브) */
  function winGold() {
    if (!ready) return;
    const W = window.innerWidth;
    const wave = (count) => {
      for (let i = 0; i < count; i++) {
        const x = rnd(0, W);
        add(texGlow, x, rnd(-40, -8), {
          vx: rnd(-0.8, 0.8), vy: rnd(1.6, 4.2), grav: 0.02, drag: 1,
          life: rnd(120, 210), s0: rnd(0.3, 0.85), s1: rnd(0.15, 0.4), tint: pick(GOLD),
        });
      }
    };
    wave(46);
    let n = 0;
    const iv = setInterval(() => { if (!ready || n++ >= 4) { clearInterval(iv); return; } wave(30); }, 360);
  }

  /* 화면 어디든 작은 반짝임(고 선언 등 범용) */
  function pop(x, y, tint) {
    if (!ready) return;
    for (let i = 0; i < 10; i++) {
      const a = rnd(0, Math.PI * 2), sp = rnd(1.5, 4.5);
      add(texGlow, x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, grav: 0.04, drag: 0.92, life: rnd(22, 38), s0: rnd(0.3, 0.6), s1: 0, tint: tint || 0xffe9a8 });
    }
  }

  window.FX = {
    init, sparkleAt, bombBlast, winGold, pop,
    get ready() { return ready; },
    get count() { return parts.length; }, // 디버그: 활성 파티클 수
  };
})();
