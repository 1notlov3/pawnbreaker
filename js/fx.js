// Visual + audio feedback layer ("juice"). Nothing here touches game state: shake moves a visual wrapper,
// hit-stop is a real-time pause of the *effects*, particles are pooled DOM nodes, sounds go through buses.
// Skills: game-feel (trauma shake, hit-stop, squash, tiers), performance-optimization (pooling, 30fps bg, caps),
// shader-programming (cheap WebGL swirl + CSS fallback), audio-design (buses, dB-ish slider, variation, limiter).
(function () {
  'use strict';
  const osReduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  // Runtime settings (meta.js loads/saves them). shake 0..1 scales trauma output; flash=false swaps flashes for a static tint.
  const cfg = { motion: 'full', shake: 0.7, flash: true, sfx: 0.7, mute: false };
  const reduced = () => osReduce || cfg.motion === 'reduced';

  // ---------------- background shader ----------------
  const THEMES = {
    menu:  [[0.10, 0.05, 0.20], [0.10, 0.34, 0.30], [0.86, 0.32, 0.30]],
    game:  [[0.05, 0.20, 0.17], [0.10, 0.36, 0.30], [0.20, 0.55, 0.42]],
    shop:  [[0.13, 0.08, 0.28], [0.07, 0.36, 0.58], [0.80, 0.30, 0.33]],
    boss:  [[0.18, 0.02, 0.05], [0.52, 0.08, 0.13], [0.88, 0.47, 0.18]],
    over:  [[0.10, 0.03, 0.06], [0.40, 0.09, 0.16], [0.22, 0.12, 0.40]]
  };
  let cur = THEMES.menu.map(c => c.slice()), target = THEMES.menu, gl = null, uni = {}, canvas, t0 = performance.now(), raf = 0, dirty = true;
  const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 r; uniform float t; uniform vec3 c1; uniform vec3 c2; uniform vec3 c3;
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * r) / min(r.x, r.y);
  float len = length(uv);
  float ang = atan(uv.y, uv.x) + t * 0.12 - len * (2.4 + 0.4 * sin(t * 0.17));
  vec2 p = vec2(cos(ang), sin(ang)) * len * 5.0;
  for (int i = 0; i < 4; i++) { p += vec2(sin(p.y * 0.8 + t * 0.35), cos(p.x * 0.8 - t * 0.27)) * 0.6; }
  float v = sin(p.x + p.y) * 0.5 + 0.5;
  float w = sin(length(p) * 1.2 - t * 0.45) * 0.5 + 0.5;
  vec3 col = mix(c1, c2, smoothstep(0.25, 0.75, v));
  col = mix(col, c3, smoothstep(0.62, 0.98, w) * 0.55);
  col = floor(col * 12.0 + 0.5) / 12.0;
  col *= 1.0 - len * 0.45;
  gl_FragColor = vec4(col, 1.0);
}`;
  function initGL() {
    canvas = document.getElementById('bg');
    try { gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' }); } catch (e) { gl = null; }
    if (!gl) { document.documentElement.classList.add('nogl'); return; }
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }'));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { gl = null; document.documentElement.classList.add('nogl'); return; }
    gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    ['r', 't', 'c1', 'c2', 'c3'].forEach(n => { uni[n] = gl.getUniformLocation(pr, n); });
    resize(); addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loop(); });
    loop();
  }
  function resize() {
    // ~1/5 resolution, upscaled with pixelated sampling: the fill-rate cost is ~4% of a full-res pass.
    canvas.width = Math.max(32, Math.round(innerWidth / 5)); canvas.height = Math.max(32, Math.round(innerHeight / 5));
    dirty = true;
  }
  let last = 0;
  const stats = { bgFrames: 0 };
  function loop(now) {
    cancelAnimationFrame(raf);
    if (!gl || document.hidden) return;
    now = now || performance.now();
    const still = reduced();
    if (!still || dirty) {
      if (now - last > 32 || dirty) { // 30 fps cap for a slow swirl (budget: ~1 ms of GPU)
        last = now; dirty = false; stats.bgFrames++;
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cur[i][j] += (target[i][j] - cur[i][j]) * 0.06;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(uni.r, canvas.width, canvas.height);
        // wrap time so float precision never degrades on long sessions (mediump on old GPUs)
        gl.uniform1f(uni.t, still ? 7 : ((now - t0) / 1000) % 600);
        gl.uniform3fv(uni.c1, cur[0]); gl.uniform3fv(uni.c2, cur[1]); gl.uniform3fv(uni.c3, cur[2]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }
    if (still) {
      const d = Math.abs(cur[1][0] - target[1][0]) + Math.abs(cur[1][2] - target[1][2]) + Math.abs(cur[2][0] - target[2][0]);
      if (d > 0.01) { dirty = true; raf = requestAnimationFrame(loop); }
      return;
    }
    raf = requestAnimationFrame(loop);
  }
  function theme(name) {
    target = THEMES[name] || THEMES.game; dirty = true;
    document.documentElement.dataset.theme = name;
    if (window.SND) window.SND.music(name);
    loop();
  }

  // ---------------- pooled particles ----------------
  const POOL_N = 64, pool = [], live = [];
  let layer = null;
  function ensureLayer() {
    if (layer) return;
    layer = document.createElement('div'); layer.id = 'fx-layer'; layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
    for (let i = 0; i < POOL_N; i++) { const p = document.createElement('i'); p.className = 'pt'; p.hidden = true; layer.appendChild(p); pool.push(p); }
  }
  function acquire() {
    ensureLayer();
    let p = pool.pop();
    if (!p) { p = live.shift(); if (!p) return null; clearTimeout(p._t); } // overflow policy: recycle the oldest
    live.push(p); return p;
  }
  function release(p) { p.hidden = true; p.className = 'pt'; p.style.cssText = ''; const i = live.indexOf(p); if (i !== -1) live.splice(i, 1); pool.push(p); }
  function burst(x, y, opts) {
    if (reduced()) return;
    opts = opts || {};
    const n = Math.min(opts.n || 18, 40), colors = opts.colors || ['#eabc52', '#fff1a8', '#c98a12'];
    for (let i = 0; i < n; i++) {
      const p = acquire(); if (!p) return;
      const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * (opts.spread || 90);
      p.style.cssText = 'left:' + x + 'px;top:' + y + 'px;--dx:' + (Math.cos(a) * d).toFixed(1) + 'px;--dy:' + (Math.sin(a) * d - 30).toFixed(1) + 'px;background:' + colors[i % colors.length] + ';--s:' + (4 + Math.random() * 5).toFixed(1) + 'px';
      if (opts.img && i % 4 === 0) { p.style.backgroundImage = 'url(' + opts.img + ')'; p.className = 'pt em'; } else p.className = 'pt';
      p.hidden = false; void p.offsetWidth; p.classList.add('go');
      p._t = setTimeout(() => release(p), 950);
    }
  }
  function burstAt(el, opts) { if (!el) return; const b = el.getBoundingClientRect(); burst(b.left + b.width / 2, b.top + b.height / 2, opts); }

  // ---------------- coins that fly to / away from the gold counter ----------------
  const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
  function center(x) { if (x && x.getBoundingClientRect) { const b = x.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; } return x; }
  // gain: coins arc from the board square into the HUD counter; loss: red coins leave the counter and drop off.
  function flyCoins(from, to, n, opts) {
    opts = opts || {};
    const [x0, y0] = center(from), [x1, y1] = center(to);
    n = Math.max(1, Math.min(8, n | 0));
    if (reduced() || !document.body.animate) return Promise.resolve();
    ensureLayer();
    const url = opts.img || window.PIX.url(opts.loss ? 'coin-loss' : 'coin');
    let first = null;
    for (let i = 0; i < n; i++) {
      const c = document.createElement('img'); c.className = 'flycoin' + (opts.loss ? ' loss' : ''); c.src = url; c.alt = '';
      c.style.left = x0 + 'px'; c.style.top = y0 + 'px'; layer.appendChild(c);
      const dx = x1 - x0, dy = y1 - y0, spread = (Math.random() - 0.5) * 60, lift = -40 - Math.random() * 40;
      const frames = opts.loss
        ? [{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
           { transform: `translate(calc(-50% + ${spread}px), calc(-50% + ${lift}px)) scale(1.2) rotate(${spread * 3}deg)`, opacity: 1, offset: 0.35 },
           { transform: `translate(calc(-50% + ${dx + spread * 2}px), calc(-50% + ${dy}px)) scale(.6) rotate(${spread * 8}deg)`, opacity: 0 }]
        : [{ transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 },
           { transform: `translate(calc(-50% + ${spread}px), calc(-50% + ${lift}px)) scale(1.25)`, opacity: 1, offset: 0.3 },
           { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.8)`, opacity: 1 }];
      const an = c.animate(frames, { duration: 620 + i * 40, delay: i * 55, easing: EASE, fill: 'forwards' });
      an.onfinish = () => c.remove();
      if (!first) first = an.finished.catch(() => {});
    }
    return first || Promise.resolve();
  }

  // ---------------- number tick-up with squash & stretch ----------------
  function num(el, value) {
    const from = +el.dataset.v || 0; el.dataset.v = value;
    if (from === value) { el.textContent = value; return; }
    el.classList.remove('squash', 'squash-loss'); void el.offsetWidth; el.classList.add(value < from ? 'squash-loss' : 'squash');
    if (reduced()) { el.textContent = value; return; }
    const t = performance.now(), dur = 520;
    const step = now => {
      const k = Math.min(1, (now - t) / dur), e = 1 - Math.pow(1 - k, 3); // ease-out cubic = "settle"
      el.textContent = Math.round(from + (value - from) * e);
      if (k < 1 && +el.dataset.v === value) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function shake(el) { if (!el) return; el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }

  // ---------------- trauma screen shake (visual wrapper only, decays by itself) ----------------
  let trauma = 0, tShake = 0, shakeRaf = 0, lastT = 0, shakeEl = null;
  function addTrauma(a) {
    if (reduced() || !cfg.shake) return;
    shakeEl = shakeEl || document.getElementById('main') || document.getElementById('app'); // screens only: HUD and overlays stay put
    trauma = Math.min(1, trauma + a);
    if (!shakeRaf) { lastT = performance.now(); shakeRaf = requestAnimationFrame(shakeStep); }
  }
  function shakeStep(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    trauma = Math.max(0, trauma - 1.4 * dt);
    const s = trauma * trauma * cfg.shake; tShake += dt * 30;
    const ax = (sd) => 0.6 * Math.sin(tShake * 1.7 + sd) + 0.4 * Math.sin(tShake * 2.9 + sd * 2);
    if (trauma > 0) {
      shakeEl.style.transform = 'translate(' + (10 * s * ax(1)).toFixed(2) + 'px,' + (7 * s * ax(4)).toFixed(2) + 'px) rotate(' + (0.03 * s * ax(7)).toFixed(4) + 'rad)';
      shakeRaf = requestAnimationFrame(shakeStep);
    } else { shakeEl.style.transform = ''; shakeRaf = 0; }
  }

  // ---------------- hit-stop: a real-time freeze before the payoff (never blocks input) ----------------
  let stopId = 0;
  function hitStop(ms, el) {
    if (reduced() || !ms) return Promise.resolve();
    const id = ++stopId;
    if (el) { el.classList.add('hitstop'); }
    return new Promise(res => setTimeout(() => { if (el && id === stopId) el.classList.remove('hitstop'); res(); }, ms));
  }
  // ---------------- flash: ≤ 3 per second (WCAG 2.3.1); disabled → static tint ----------------
  const flashTimes = [];
  function flash(el, color) {
    if (!el) return;
    const now = performance.now(); while (flashTimes.length && now - flashTimes[0] > 1000) flashTimes.shift();
    const f = document.createElement('div'); f.className = 'flash' + (cfg.flash && !reduced() && flashTimes.length < 3 ? '' : ' tint');
    if (color) f.style.background = color;
    flashTimes.push(now);
    (el === document.body ? document.body : el).appendChild(f); setTimeout(() => f.remove(), 260);
  }

  // ---------------- one call per event: tiers keep juice proportional ----------------
  const TIERS = {
    small:  { trauma: 0.12, stop: 0,   parts: 5,  sfx: 'tick' },
    medium: { trauma: 0.32, stop: 55,  parts: 12, sfx: 'hit', flash: true },
    large:  { trauma: 0.7,  stop: 120, parts: 30, sfx: 'boom', flash: true }
  };
  async function juice(tier, o) {
    const T = TIERS[tier] || TIERS.small; o = o || {};
    if (T.stop) await hitStop(T.stop, o.stopEl);
    if (o.sfx !== false) sfx(o.sfx || T.sfx);
    addTrauma(T.trauma);
    if (T.flash && o.flashEl) flash(o.flashEl, o.flashColor);
    if (o.at) burst(o.at[0], o.at[1], { n: T.parts, spread: o.spread || (tier === 'large' ? 140 : 60), colors: o.colors, img: o.img });
  }

  // Card tilt that follows the pointer/finger; idle float lives in CSS.
  function tilt(container) {
    if (container.__tilt) return; container.__tilt = true;
    const move = e => {
      if (reduced()) return;
      const c = e.target.closest && e.target.closest('.card, .chest, .voucher'); if (!c) return;
      const b = c.getBoundingClientRect(), x = (e.clientX - b.left) / b.width - 0.5, y = (e.clientY - b.top) / b.height - 0.5;
      c.style.setProperty('--ry', (x * 22).toFixed(1) + 'deg'); c.style.setProperty('--rx', (-y * 22).toFixed(1) + 'deg');
      c.style.setProperty('--mx', ((x + 0.5) * 100).toFixed(0) + '%'); c.style.setProperty('--my', ((y + 0.5) * 100).toFixed(0) + '%');
      c.classList.add('tilting');
    };
    const out = e => { const c = e.target; if (c.classList && (c.classList.contains('card') || c.classList.contains('chest') || c.classList.contains('voucher'))) { c.style.removeProperty('--rx'); c.style.removeProperty('--ry'); c.classList.remove('tilting'); } };
    container.addEventListener('pointermove', move); container.addEventListener('pointerdown', move);
    container.addEventListener('pointerleave', out, true); container.addEventListener('pointercancel', out, true); container.addEventListener('pointerup', out, true);
  }

  // ---------------- audio lives in js/audio.js (window.SND); these names are the old call sites ----------------
  const ALIAS = { click: 'tap', tick: 'tally', hit: 'capture', boom: 'explode', loss: 'goldLoss', open: 'chest' };
  function sfx(name, o) { if (window.SND) window.SND.play(ALIAS[name] || name, typeof o === 'object' ? o : undefined); }

  function configure(o) {
    Object.assign(cfg, o || {});
    document.documentElement.classList.toggle('rm', reduced());
    if (gl) { dirty = true; loop(); }
  }

  window.FX = { initGL, theme, burst, burstAt, num, shake, tilt, flyCoins, addTrauma, hitStop, flash, juice, sfx, configure, cfg, stats,
    get reduce() { return reduced(); }, get osReduce() { return osReduce; }, get poolFree() { return pool.length; }, EASE };
})();
