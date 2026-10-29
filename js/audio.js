// Sound + music, all synthesized with WebAudio — no audio files, no licences to track.
// audio-design: Master(limiter) ← { SFX, UI, Voice, Music → Duck → Muffle }; sliders are squared (perceptual), ducking
// lives on its own bus so it never fights the player's Music slider, SFX get ±pitch/±dB variation, and a voice limit.
// Music is a small step sequencer (vertical layers faded per state + chord progressions re-sequenced at bar lines).
(function () {
  'use strict';
  const cfg = { sfx: 0.7, sfxOn: true, music: 0.5, musicOn: true, voice: 0.8, voiceOn: true };
  const DEBUG = /[?&]debug=audio\b/.test(location.search);
  const dbg = (...a) => { if (DEBUG) console.log('[audio]', ...a); };
  const AC = window.AudioContext || window.webkitAudioContext;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  let ac = null, bus = {}, unlocked = false, wantState = 'menu', renderP = null;
  const buf = {}, active = [], last = {}, MAX_VOICES = 14;
  const st = { played: 0, dropped: 0, steps: 0, notes: 0 }; // test/debug counters

  // ---------------- SFX recipes (rendered once into AudioBuffers) ----------------
  // helpers work on any BaseAudioContext; t is seconds from the start of the buffer
  function kit(c, out) {
    let nb = null;
    const noiseBuf = () => { if (nb) return nb; nb = c.createBuffer(1, Math.ceil(c.sampleRate * 1.5), c.sampleRate); const d = nb.getChannelData(0); let s = 12345; for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = s / 1073741823.5 - 1; } return nb; };
    const env = (g, t, a, d, peak, hold) => {
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a);
      if (hold) g.gain.setValueAtTime(peak, t + a + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + (hold || 0) + d);
    };
    function tone(f, t, d, o) {
      o = o || {};
      const osc = c.createOscillator(), g = c.createGain();
      osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(f, t);
      if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide || d));
      if (o.detune) osc.detune.value = o.detune;
      let node = osc;
      if (o.bp) { const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = o.bp; bp.Q.value = o.q || 1; osc.connect(bp); node = bp; }
      else if (o.lp) { const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = o.lp; lp.Q.value = o.q || 0.7; osc.connect(lp); node = lp; }
      if (o.vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = o.vib; lg.gain.value = o.vibDepth || 18; l.connect(lg); lg.connect(osc.detune); l.start(t); l.stop(t + d + 0.1); }
      node.connect(g); g.connect(o.dest || out);
      env(g, t, o.a || 0.004, d, o.g || 0.3, o.hold);
      osc.start(t); osc.stop(t + (o.a || 0.004) + (o.hold || 0) + d + 0.05);
    }
    function noise(t, d, o) {
      o = o || {};
      const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      s.buffer = noiseBuf(); f.type = o.type || 'bandpass'; f.frequency.setValueAtTime(o.f || 1200, t); f.Q.value = o.q || 1;
      if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + d);
      s.connect(f); f.connect(g); g.connect(o.dest || out);
      env(g, t, o.a || 0.002, d, o.g || 0.3, o.hold);
      s.start(t, o.off || 0); s.stop(t + (o.a || 0.002) + (o.hold || 0) + d + 0.05);
    }
    const bell = (f, t, d, g) => { tone(f, t, d, { type: 'sine', g }); tone(f * 2.01, t, d * 0.6, { type: 'sine', g: g * 0.35 }); tone(f * 3.98, t, d * 0.3, { type: 'sine', g: g * 0.12 }); };
    const tock = (t, f, g) => { noise(t, 0.045, { f: 2200 * f, q: 3, g: 0.55 * g }); tone(520 * f, t, 0.07, { f2: 300 * f, g: 0.5 * g, type: 'triangle' }); tone(180 * f, t, 0.05, { g: 0.25 * g }); };
    return { tone, noise, bell, tock };
  }
  const note = m => 440 * Math.pow(2, (m - 69) / 12);
  // [duration s, recipe(k)]; peaks stay under ~0.8 so the limiter is a safety net, not the mixer
  const SFX = {
    move:      [0.16, k => k.tock(0, 1, 1)],
    capture:   [0.32, k => { k.tock(0, 0.8, 1); k.noise(0.005, 0.16, { f: 900, f2: 300, q: 1.2, g: 0.5 }); k.tone(200, 0, 0.2, { f2: 70, g: 0.55, type: 'triangle' }); }],
    captureBig:[0.6, k => { k.tock(0, 0.7, 1.1); k.noise(0.0, 0.35, { type: 'lowpass', f: 1600, f2: 200, g: 0.6 }); k.tone(120, 0, 0.45, { f2: 45, g: 0.7 }); k.tone(240, 0.01, 0.25, { f2: 90, g: 0.25, type: 'square', lp: 900 }); }],
    explode:   [1.0, k => { k.noise(0, 0.8, { type: 'lowpass', f: 2400, f2: 120, g: 0.75, q: 0.5 }); k.tone(80, 0, 0.8, { f2: 32, g: 0.8 }); k.noise(0.02, 0.2, { f: 3000, q: 0.6, g: 0.3 }); }],
    check:     [0.42, k => { k.bell(1319, 0, 0.18, 0.28); k.bell(1760, 0.11, 0.28, 0.3); k.tone(880, 0, 0.1, { type: 'square', lp: 2400, g: 0.08 }); }],
    castle:    [0.3, k => { k.tock(0, 0.95, 0.9); k.tock(0.11, 0.8, 1); }],
    promote:   [0.75, k => { [72, 76, 79, 84].forEach((m, i) => k.tone(note(m), i * 0.07, 0.3, { type: 'triangle', g: 0.28 })); k.bell(note(88), 0.28, 0.4, 0.2); k.noise(0.25, 0.4, { type: 'highpass', f: 6000, g: 0.08 }); }],
    illegal:   [0.2, k => { k.tone(150, 0, 0.14, { type: 'square', lp: 700, g: 0.22 }); k.tone(141, 0, 0.14, { type: 'square', lp: 700, g: 0.18 }); }],
    start:     [0.9, k => { k.bell(note(67), 0, 0.5, 0.25); k.bell(note(74), 0.12, 0.7, 0.28); k.noise(0, 0.2, { type: 'highpass', f: 5000, g: 0.05, a: 0.05 }); }],
    win:       [1.5, k => { [60, 64, 67, 72].forEach((m, i) => k.tone(note(m), i * 0.1, 0.25, { type: 'square', lp: 3000, g: 0.16 })); [72, 76, 79].forEach(m => k.tone(note(m), 0.42, 0.9, { type: 'triangle', g: 0.2, vib: 5, vibDepth: 12, hold: 0.15 })); k.bell(note(84), 0.42, 1.0, 0.18); }],
    lose:      [1.4, k => { [67, 63, 60].forEach((m, i) => k.tone(note(m), i * 0.22, 0.35, { type: 'sawtooth', lp: 1200, g: 0.2, f2: note(m - 1), glide: 0.3 })); k.tone(note(55), 0.66, 0.7, { type: 'sawtooth', lp: 900, g: 0.22, f2: note(48), glide: 0.7 }); k.tone(note(43), 0.66, 0.7, { g: 0.3 }); }],
    draw:      [0.8, k => { k.tone(note(67), 0, 0.3, { type: 'triangle', g: 0.22 }); k.tone(note(67), 0.25, 0.45, { type: 'triangle', g: 0.2, f2: note(66), glide: 0.45 }); }],
    coin:      [0.24, k => { k.tone(988, 0, 0.05, { type: 'square', lp: 5000, g: 0.14 }); k.tone(1319, 0.055, 0.16, { type: 'square', lp: 5000, g: 0.14 }); }],
    goldLoss:  [0.6, k => { k.tone(note(67), 0, 0.12, { type: 'square', lp: 1600, g: 0.16 }); k.tone(note(62), 0.1, 0.14, { type: 'square', lp: 1400, g: 0.16 }); k.tone(note(55), 0.21, 0.3, { type: 'square', lp: 900, g: 0.18, f2: note(50), glide: 0.3 }); k.tone(90, 0.2, 0.25, { f2: 50, g: 0.4 }); }],
    tally:     [0.06, k => { k.tone(1500, 0, 0.03, { type: 'triangle', g: 0.25 }); k.noise(0, 0.015, { type: 'highpass', f: 5000, g: 0.08 }); }],
    deal:      [0.12, k => { k.noise(0, 0.09, { f: 3200, f2: 1100, q: 1.4, g: 0.3, a: 0.01 }); }],
    flip:      [0.1, k => { k.noise(0, 0.05, { f: 2600, q: 1.5, g: 0.25 }); k.tone(660, 0, 0.04, { type: 'triangle', g: 0.14 }); }],
    hover:     [0.04, k => { k.tone(2400, 0, 0.02, { g: 0.07 }); }],
    select:    [0.12, k => { k.tone(600, 0, 0.07, { f2: 980, glide: 0.05, g: 0.25 }); }],
    buy:       [0.55, k => { [72, 76, 79, 84].forEach((m, i) => k.tone(note(m), i * 0.055, 0.1, { type: 'square', lp: 4000, g: 0.12 })); k.bell(note(91), 0.22, 0.3, 0.12); k.noise(0.2, 0.2, { type: 'highpass', f: 7000, g: 0.06 }); }],
    sell:      [0.35, k => { [79, 83, 88].forEach((m, i) => k.tone(note(m), i * 0.06, 0.09, { type: 'square', lp: 4000, g: 0.12 })); k.tone(1319, 0.18, 0.14, { type: 'triangle', g: 0.12 }); }],
    reroll:    [0.45, k => { k.noise(0, 0.3, { f: 500, f2: 3500, q: 2, g: 0.25, a: 0.02 }); for (let i = 0; i < 5; i++) k.noise(0.04 + i * 0.055, 0.025, { f: 2500 + i * 300, q: 5, g: 0.3 }); }],
    chest:     [0.95, k => { k.noise(0, 0.25, { type: 'lowpass', f: 300, f2: 1400, g: 0.3, a: 0.05 }); k.tone(110, 0, 0.2, { f2: 70, g: 0.35 }); [76, 79, 83, 88].forEach((m, i) => k.bell(note(m), 0.22 + i * 0.07, 0.45, 0.14)); k.noise(0.2, 0.6, { type: 'highpass', f: 7000, g: 0.07, a: 0.05 }); }],
    upgrade:   [0.85, k => { k.tone(400, 0, 0.45, { f2: 1600, glide: 0.4, type: 'triangle', g: 0.16, vib: 9, vibDepth: 25 }); k.tone(404, 0, 0.45, { f2: 1616, glide: 0.4, type: 'sine', g: 0.12 }); k.bell(note(84), 0.38, 0.45, 0.2); k.bell(note(91), 0.45, 0.4, 0.12); }],
    relic:     [0.25, k => { k.bell(1568, 0, 0.16, 0.16); k.tone(2093, 0.03, 0.12, { g: 0.08 }); }],
    book:      [0.3, k => { k.tone(note(79), 0, 0.18, { type: 'triangle', g: 0.2 }); k.tone(note(86), 0.06, 0.2, { type: 'triangle', g: 0.16 }); }],
    opening:   [1.2, k => { [60, 64, 67, 71, 74].forEach((m, i) => k.bell(note(m + 12), i * 0.08, 0.8, 0.13)); k.tone(note(48), 0, 0.9, { type: 'triangle', g: 0.15 }); }],
    boss:      [1.8, k => { k.tone(55, 0, 1.4, { type: 'sawtooth', lp: 500, g: 0.4 }); k.tone(58.3, 0, 1.4, { type: 'sawtooth', lp: 500, g: 0.3 }); k.noise(0, 1.2, { type: 'lowpass', f: 700, f2: 90, g: 0.45 }); k.tone(note(62), 0.05, 0.6, { type: 'square', lp: 1500, g: 0.12 }); k.tone(note(63), 0.05, 0.6, { type: 'square', lp: 1500, g: 0.1 }); k.bell(note(86), 0.05, 1.2, 0.08); }],
    tap:       [0.05, k => { k.tone(880, 0, 0.03, { type: 'square', lp: 3000, g: 0.1 }); }],
    back:      [0.07, k => { k.tone(620, 0, 0.05, { f2: 430, type: 'square', lp: 2500, g: 0.09 }); }],
    menu:      [0.18, k => { k.tone(300, 0, 0.12, { f2: 520, g: 0.2, type: 'triangle' }); k.noise(0, 0.08, { f: 1800, q: 0.8, g: 0.08 }); }]
  };
  // the bot's murmur: five vowel "syllables" through formant filters, pitched per character at play time
  const VOWELS = [[800, 1200], [400, 2000], [300, 2300], [450, 800], [325, 700]];
  VOWELS.forEach((fm, i) => {
    SFX['v' + i] = [0.13, k => {
      // t32: a 330 Hz glottal pulse (phone speakers roll off below ~300 Hz, the old 170 Hz blip was inaudible on an iPhone)
      // through two band-pass formants, plus a little triangle body so it never vanishes on a tiny speaker
      k.tone(330, 0, 0.085, { type: 'sawtooth', bp: fm[0], q: 3.5, g: 0.55, f2: 300, a: 0.008 });
      k.tone(330, 0, 0.075, { type: 'sawtooth', bp: fm[1], q: 5, g: 0.32, f2: 300, a: 0.008 });
      k.tone(330, 0, 0.075, { type: 'triangle', g: 0.16, f2: 300, a: 0.008 });
    }];
  });
  const UI = { tap: 1, back: 1, menu: 1, hover: 1, select: 1, flip: 1, deal: 1, tally: 1 };
  const DUCK = { win: [9, 1.1], lose: [10, 1.2], boss: [12, 1.4], explode: [9, 0.8], captureBig: [6, 0.4], chest: [6, 0.6], opening: [6, 0.8], promote: [5, 0.5], upgrade: [5, 0.5], start: [4, 0.6] };
  const GAP = { hover: 0.06, tally: 0.03, relic: 0.12, coin: 0.035, tap: 0.05, back: 0.08, menu: 0.08, deal: 0.03, flip: 0.05, move: 0.03, check: 0.2, illegal: 0.15 }; // per-sound throttle (s)
  const VAR = { move: 1, capture: 1, captureBig: 0.7, tap: 0.6, deal: 1.5, flip: 1, tock: 1, hover: 1, select: 0.6, reroll: 0.8, sell: 0.4, buy: 0.3, illegal: 0.3, relic: 0.5 }; // ± semitones

  const TRIM = { capture: 0.8, captureBig: 0.75, explode: 0.72, reroll: 2.4, deal: 1.5, flip: 1.2 }; // loudness balance after measuring RMS/peak
  function renderOne(name, sr) {
    const [dur, fn] = SFX[name];
    const c = new OAC(1, Math.ceil(dur * sr), sr);
    const out = c.createGain(); out.gain.value = TRIM[name] || 1; out.connect(c.destination);
    fn(kit(c, out));
    return new Promise((res, rej) => {
      c.oncomplete = e => res(e.renderedBuffer);
      const p = c.startRendering(); if (p && p.then) p.then(res, rej);
    });
  }
  // pre-render everything once (a couple of hundred ms on a phone); `sr` lets tests render at a fixed rate
  function renderAll(sr) {
    if (!OAC) return Promise.resolve({});
    sr = sr || (ac ? ac.sampleRate : 44100);
    return Promise.all(Object.keys(SFX).map(n => renderOne(n, sr).then(b => { buf[n] = b; }, () => {}))).then(() => buf);
  }

  // ---------------- context, buses, unlock ----------------
  function ensure() {
    if (ac || !AC) return ac;
    try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch (e) { /* Safari 16.4+: respect the ringer switch, mix with other apps */ }
    try {
      ac = new AC({ latencyHint: 'interactive' });
    } catch (e) { try { ac = new AC(); } catch (e2) { ac = null; return null; } }
    const lim = ac.createDynamicsCompressor(); lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.12;
    bus.master = ac.createGain(); bus.master.gain.value = 0.7; bus.master.connect(lim); lim.connect(ac.destination);
    ['sfx', 'ui', 'voice'].forEach(n => { bus[n] = ac.createGain(); bus[n].connect(bus.master); });
    bus.muffle = ac.createBiquadFilter(); bus.muffle.type = 'lowpass'; bus.muffle.frequency.value = 18000; bus.muffle.connect(bus.master);
    bus.duck = ac.createGain(); bus.duck.connect(bus.muffle);
    bus.music = ac.createGain(); bus.music.connect(bus.duck);
    applyVolume(true);
    ac.onstatechange = () => { if (ac.state === 'running' && unlocked) Music.kick(); };
    return ac;
  }
  const sq = v => Math.max(0, Math.min(1, v)) ** 2;
  function applyVolume(now) {
    if (!ac) return;
    const t = ac.currentTime, set = (g, v) => { if (now) g.gain.value = v; else g.gain.setTargetAtTime(v, t, 0.05); };
    const s = cfg.sfxOn ? sq(cfg.sfx) : 0;
    set(bus.sfx, s); set(bus.ui, s * 0.7); set(bus.voice, cfg.voiceOn ? sq(cfg.voice) * 1.1 : 0); // t32: own Voice volume
    set(bus.music, cfg.musicOn ? sq(cfg.music) * 0.55 : 0);
  }
  function unlock() {
    const a = ensure(); if (!a) return;
    if (!unlocked) dbg('unlock', a.state, 'iOS=' + /iP(hone|ad|od)/.test(navigator.userAgent));
    if (a.state !== 'running') { const p = a.resume(); if (p && p.catch) p.catch(() => {}); }
    if (!unlocked) {
      unlocked = true;
      try { const s = a.createBufferSource(); s.buffer = a.createBuffer(1, 1, a.sampleRate); s.connect(a.destination); s.start(0); } catch (e) { /* iOS unlock trick */ }
      if (!renderP) renderP = renderAll(a.sampleRate);
    }
    Music.kick();
  }
  ['pointerdown', 'touchend', 'keydown', 'click'].forEach(ev => addEventListener(ev, unlock, { capture: true, passive: true }));
  // phones: stop the clock when hidden, pick up again on return (iOS may need the next tap: 'interrupted' state)
  document.addEventListener('visibilitychange', () => {
    if (!ac) return;
    if (document.hidden) { Music.halt(); if (ac.state === 'running') ac.suspend().catch(() => {}); }
    else if (unlocked) { ac.resume().then(() => Music.kick(), () => {}); }
  });
  addEventListener('pagehide', () => { if (ac && ac.state === 'running') ac.suspend().catch(() => {}); });

  // ---------------- one-shots ----------------
  let coinRun = 0, coinT = 0;
  const SCALE = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19];
  function duck(db, hold) {
    if (!ac) return;
    const t = ac.currentTime, g = bus.duck.gain, to = Math.pow(10, -db / 20);
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.setTargetAtTime(to, t, 0.02); g.setTargetAtTime(1, t + hold, 0.35);
  }
  function play(name, o) {
    o = o || {};
    if (!cfg.sfxOn || !cfg.sfx || !ac || ac.state !== 'running') return false;
    const b = buf[name]; if (!b) return false;
    const now = ac.currentTime, gap = GAP[name] || 0.02;
    if (last[name] != null && now - last[name] < gap && !o.force) { st.dropped++; return false; }
    last[name] = now;
    while (active.length >= MAX_VOICES) { const v = active.shift(); try { v.stop(); } catch (e) { /* gone */ } }
    let semis = (Math.random() * 2 - 1) * (VAR[name] != null ? VAR[name] : 0.25);
    if (name === 'coin') { coinRun = now - coinT < 0.7 ? Math.min(coinRun + 1, SCALE.length - 1) : 0; coinT = now; semis = SCALE[coinRun]; }
    if (name === 'tally' && o.i != null) semis = SCALE[Math.min(o.i, SCALE.length - 1)];
    const s = ac.createBufferSource(), g = ac.createGain();
    s.buffer = b; s.playbackRate.value = (o.rate || 1) * Math.pow(2, semis / 12);
    g.gain.value = (o.gain || 1) * Math.pow(10, (Math.random() * 2 - 1) * 1.5 / 20);
    s.connect(g); g.connect(bus[o.bus || (UI[name] ? 'ui' : 'sfx')]);
    s.start(now + (o.delay || 0));
    active.push(s); s.onended = () => { const i = active.indexOf(s); if (i !== -1) active.splice(i, 1); };
    if (DUCK[name] && cfg.musicOn) duck(DUCK[name][0], DUCK[name][1]);
    st.played++;
    return true;
  }
  // Animal-Crossing-style murmur: one vowel blip per few letters, pitched per character, throttled
  const PERSONA = { rookie: 1.25, grinder: 0.86, atomic: 1.1, fog: 0.8, misere: 1.4, hill: 0.75, threecheck: 1.2, royalqueen: 1.3, mines: 0.9, masked: 1.0, hourglass: 0.7, pillar: 0.95, forward: 0.68, hydra: 0.74 };
  let murmurUntil = 0;
  function murmur(text, who) {
    if (!cfg.voiceOn || !cfg.voice || !ac || ac.state !== 'running' || !buf.v0) { dbg('murmur skipped', { voiceOn: cfg.voiceOn, vol: cfg.voice, ctx: ac && ac.state, ready: !!buf.v0 }); return 0; }
    const now = ac.currentTime; if (now < murmurUntil) return 0;
    const clean = String(text || '').replace(/\s+/g, ' ').trim(); if (!clean) return 0;
    const cjk = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(clean);
    const n = Math.max(2, Math.min(10, Math.ceil(clean.length / (cjk ? 2 : 5))));
    const base = PERSONA[who] || 1, step = 0.078, q = /[?？]\s*$/.test(clean);
    let h = 0;
    for (let i = 0; i < n; i++) {
      h = (h * 31 + clean.charCodeAt(Math.floor(i * clean.length / n))) >>> 0;
      const s = ac.createBufferSource(), g = ac.createGain();
      s.buffer = buf['v' + (h % 5)];
      const contour = q && i >= n - 2 ? 3 : (i === n - 1 ? -2 : 0);
      s.playbackRate.value = base * Math.pow(2, (((h >> 3) % 5) - 2 + contour) / 12);
      g.gain.value = 0.75 + ((h >> 5) % 4) * 0.08;
      s.connect(g); g.connect(bus.voice);
      s.start(now + 0.02 + i * step + ((h >> 7) % 3) * 0.008);
    }
    murmurUntil = now + n * step + 0.6;
    st.played += n; st.murmurs = (st.murmurs || 0) + 1; dbg('murmur', who, n + ' blips');
    return n;
  }

  // ---------------- music: a tiny sequencer ----------------
  // chords: [bass root (MIDI), pad/arp notes]; one chord per bar, two 4-bar phrases per progression
  const PROG = {
    calm: [[[38, [62, 65, 69, 72, 76]], [34, [58, 62, 65, 69, 72]], [41, [60, 65, 69, 76]], [33, [61, 64, 67, 69]]],
           [[43, [58, 62, 65, 69]], [36, [58, 64, 67, 70]], [41, [60, 64, 69, 72]], [33, [61, 64, 67, 69]]]],
    tense: [[[38, [62, 65, 69]], [34, [62, 65, 70]], [43, [62, 67, 70]], [33, [61, 64, 69]]],
            [[38, [62, 65, 69]], [36, [60, 64, 67]], [34, [62, 65, 70]], [33, [61, 64, 67, 69]]]],
    boss:  [[[38, [62, 65, 69]], [39, [63, 67, 70]], [38, [62, 65, 69]], [33, [61, 64, 67, 70]]],
            [[38, [62, 65, 69]], [34, [62, 65, 70]], [39, [63, 67, 70]], [33, [61, 64, 69]]]]
  };
  // layer mix per state (0..1) — the vertical layering; tempo + progression switch at the next bar (horizontal)
  const STATES = {
    menu: { bpm: 80, prog: 'calm', swing: 0.14, mix: { pad: 0.9, keys: 0.75, lead: 0.5, bass: 0.55, kick: 0.45, snare: 0.3, hat: 0.3, pulse: 0, boss: 0 } },
    shop: { bpm: 80, prog: 'calm', swing: 0.14, mix: { pad: 0.8, keys: 0.9, lead: 0.6, bass: 0.75, kick: 0.65, snare: 0.55, hat: 0.45, pulse: 0, boss: 0 } },
    over: { bpm: 70, prog: 'calm', swing: 0.1, mix: { pad: 1, keys: 0.5, lead: 0.35, bass: 0.4, kick: 0, snare: 0, hat: 0.15, pulse: 0, boss: 0 } },
    game: { bpm: 90, prog: 'tense', swing: 0.06, mix: { pad: 0.6, keys: 0.55, lead: 0.25, bass: 0.85, kick: 0.75, snare: 0.55, hat: 0.6, pulse: 0.5, boss: 0 } },
    boss: { bpm: 100, prog: 'boss', swing: 0, mix: { pad: 0.5, keys: 0.45, lead: 0.2, bass: 1, kick: 0.95, snare: 0.75, hat: 0.75, pulse: 0.7, boss: 0.8 } }
  };
  const LAYERS = ['pad', 'keys', 'lead', 'bass', 'kick', 'snare', 'hat', 'pulse', 'boss'];
  const ARPS = [[0, -1, 1, -1, 2, -1, 1, -1], [0, 1, 2, 3, 2, 1, -1, -1], [2, -1, 0, -1, 3, -1, 1, 0], [0, -1, -1, 2, -1, -1, 1, -1], [3, 2, 1, 0, -1, 1, -1, 2]];
  const Music = (function () {
    let L = null, fx = null, timer = null, state = null, cur = null, pending = null, step = 0, bar = 0, nextT = 0, arp = ARPS[0], phrase = 0, noiseB = null, lfo = null;
    function build() {
      if (L) return;
      L = {};
      LAYERS.forEach(n => { const g = ac.createGain(); g.gain.value = 0; g.connect(bus.music); L[n] = g; });
      // shared dotted-eighth echo for keys/lead, a slowly breathing low-pass on the pad
      fx = { delay: ac.createDelay(1.5), fb: ac.createGain(), dlp: ac.createBiquadFilter(), send: ac.createGain(), padLp: ac.createBiquadFilter() };
      fx.dlp.type = 'lowpass'; fx.dlp.frequency.value = 2200; fx.fb.gain.value = 0.32; fx.send.gain.value = 0.35;
      fx.send.connect(fx.delay); fx.delay.connect(fx.dlp); fx.dlp.connect(fx.fb); fx.fb.connect(fx.delay); fx.dlp.connect(bus.music);
      fx.padLp.type = 'lowpass'; fx.padLp.frequency.value = 1100; fx.padLp.Q.value = 0.8; fx.padLp.connect(L.pad);
      lfo = ac.createOscillator(); const lg = ac.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 450; lfo.connect(lg); lg.connect(fx.padLp.frequency); lfo.start();
      noiseB = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noiseB.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const spb = () => 60 / cur.bpm / 4; // seconds per 16th
    function v(type, f, t, d, g, dest, o) {
      o = o || {};
      const osc = ac.createOscillator(), e = ac.createGain();
      osc.type = type; osc.frequency.setValueAtTime(f, t); if (o.det) osc.detune.value = o.det;
      if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide || d));
      if (o.vib) { o.vib.connect(osc.detune); }
      const a = o.a || 0.005;
      e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(g, t + a); e.gain.setTargetAtTime(0.0001, t + a + (o.hold || 0), d / 4);
      let n = osc; if (o.lp) { const f2 = ac.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = o.lp; f2.Q.value = o.q || 0.7; osc.connect(f2); n = f2; }
      n.connect(e); e.connect(dest); if (o.send) e.connect(fx.send);
      osc.start(t); osc.stop(t + a + (o.hold || 0) + d + 0.1); st.notes++;
    }
    function hit(t, d, g, dest, type, f, q) {
      const s = ac.createBufferSource(), fl = ac.createBiquadFilter(), e = ac.createGain();
      s.buffer = noiseB; fl.type = type; fl.frequency.value = f; fl.Q.value = q || 0.8;
      e.gain.setValueAtTime(g, t); e.gain.exponentialRampToValueAtTime(0.0001, t + d);
      s.connect(fl); fl.connect(e); e.connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + d + 0.02); st.notes++;
    }
    const on = n => L[n] && (state.mix[n] || 0) > 0.01;
    function schedule(t) {
      const s = step % 16, m = cur.mix, P = PROG[cur.prog][phrase], [root, ch] = P[bar % 4], sw = (s % 2) ? cur.swing * spb() : 0, tt = t + sw;
      const drumsOut = cur.prog === 'calm' && bar % 16 >= 12 && bar % 16 < 14; // breakdown so the loop breathes
      const fill = bar % 8 === 7 && s >= 12;
      if (s === 0) {
        if (on('pad')) ch.forEach((n, i) => { v('sawtooth', note(n), t, spb() * 16, 0.05, fx.padLp, { a: 0.35, hold: spb() * 12, det: i % 2 ? 7 : -7 }); v('triangle', note(n), t, spb() * 16, 0.05, fx.padLp, { a: 0.3, hold: spb() * 12 }); });
        if (on('boss')) { v('sawtooth', note(root - 12), t, spb() * 16, 0.12, L.boss, { a: 0.2, hold: spb() * 12, lp: 380 }); v('sawtooth', note(root - 12) * 1.006, t, spb() * 16, 0.1, L.boss, { a: 0.2, hold: spb() * 12, lp: 380 }); }
      }
      // keys: wobbly electric-piano arpeggio, pattern re-rolled every 2 bars
      if (on('keys') && s % 2 === 0) {
        const idx = arp[(s / 2) % 8];
        if (idx >= 0 && !(cur.prog === 'calm' && Math.random() < 0.12)) { const n = ch[idx % ch.length] + (idx >= ch.length ? 12 : 0); v('sine', note(n + 12), tt, 0.5, 0.12, L.keys, { send: true, lp: 3000 }); v('triangle', note(n + 24), tt, 0.18, 0.025, L.keys, {}); }
      }
      // lead: sparse, random chord-tone melody with a little glide — never the same twice
      if (on('lead') && (s === 0 || s === 6 || s === 10) && Math.random() < (cur.prog === 'calm' ? 0.45 : 0.3)) {
        const n = ch[Math.floor(Math.random() * ch.length)] + 12, prev = n + (Math.random() < 0.5 ? -2 : 1);
        v('triangle', note(prev), tt, spb() * 6, 0.07, L.lead, { a: 0.03, hold: spb() * 2, send: true, f2: note(n), glide: 0.07 });
      }
      // bass
      if (on('bass')) {
        const pat = cur.prog === 'calm' ? { 0: 0, 10: 7, 14: 0 } : cur.prog === 'tense' ? { 0: 0, 4: 12, 6: 0, 8: 0, 12: 12, 14: 7 } : { 0: 0, 2: 0, 4: 12, 6: 0, 8: 0, 10: 0, 12: 12, 14: 0 };
        if (pat[s] != null) v(cur.prog === 'boss' ? 'sawtooth' : 'triangle', note(root + pat[s]), tt, spb() * (cur.prog === 'calm' ? 5 : 2.5), cur.prog === 'boss' ? 0.16 : 0.3, L.bass, { lp: cur.prog === 'boss' ? 600 : 900, a: 0.01 });
        if (cur.prog === 'boss' && s % 2 === 1) v('sawtooth', note(root), tt, spb() * 0.9, 0.06, L.bass, { lp: 450 });
      }
      if (!drumsOut) {
        const kp = cur.prog === 'calm' ? [0, 10] : cur.prog === 'tense' ? [0, 8, 10] : [0, 4, 8, 12];
        if (on('kick') && kp.indexOf(s) !== -1) v('sine', 150, t, 0.28, 0.7, L.kick, { f2: 42, glide: 0.12, a: 0.002 });
        if (on('snare') && (s === 4 || s === 12 || (fill && Math.random() < 0.7))) { hit(tt, fill && s !== 12 ? 0.07 : 0.16, fill && s !== 12 ? 0.18 : 0.32, L.snare, 'bandpass', 1900, 0.9); if (!fill || s === 12) v('triangle', 190, tt, 0.08, 0.12, L.snare, { f2: 150 }); }
        const hatOn = cur.prog === 'calm' ? s % 4 === 2 : cur.prog === 'tense' ? s % 2 === 0 || Math.random() < 0.15 : true;
        if (on('hat') && hatOn) hit(tt, s % 4 === 2 ? 0.06 : 0.03, s % 4 === 2 ? 0.16 : 0.09, L.hat, 'highpass', 7500, 0.7);
      }
      if (on('pulse') && s % 2 === 0) v('square', note(root + 24), tt, spb() * 1.2, 0.035, L.pulse, { lp: 1400 + (s % 8) * 120 });
      // boss: chess-clock tick on every beat + a low tom roll into each 4th bar
      if (on('boss')) {
        if (s % 4 === 0) { v('sine', 2400, t, 0.03, 0.08, L.boss, { a: 0.001 }); hit(t, 0.02, 0.12, L.boss, 'bandpass', 3800, 6); }
        if (bar % 4 === 3 && s >= 12) v('sine', [196, 165, 147, 131][s - 12], t, 0.2, 0.3, L.boss, { f2: [150, 125, 110, 98][s - 12], glide: 0.18 });
      }
    }
    function advance() {
      step++; st.steps++;
      if (step % 16 === 0) {
        bar++;
        if (bar % 2 === 0) arp = ARPS[Math.floor(Math.random() * ARPS.length)];
        if (bar % 4 === 0) phrase = Math.random() < 0.6 ? (phrase + 1) % 2 : phrase;
        if (pending) { cur = pending; pending = null; }
      }
    }
    function tick() {
      if (!ac || ac.state !== 'running' || !state) return;
      if (nextT < ac.currentTime - 0.2) nextT = ac.currentTime + 0.05; // after a stall: don't machine-gun the backlog
      while (nextT < ac.currentTime + 0.15) { schedule(nextT); nextT += spb(); advance(); }
    }
    function fade() { const t = ac.currentTime; LAYERS.forEach(n => L[n].gain.setTargetAtTime(state.mix[n] || 0, t, 0.7)); } // ~2 s crossfade
    function kick() {
      if (!ac || !unlocked || ac.state !== 'running' || !cfg.musicOn || !cfg.music) return;
      build();
      const S = STATES[wantState] || STATES.menu;
      if (state !== S) {
        state = S;
        if (!cur) { cur = S; step = 0; bar = 0; nextT = ac.currentTime + 0.1; }
        else if (cur !== S) pending = S; // tempo/progression change waits for the bar line
        fade();
      }
      if (!timer) timer = setInterval(tick, 30);
      tick();
    }
    function halt() { if (timer) { clearInterval(timer); timer = null; } }
    function stop() { halt(); if (L) { const t = ac.currentTime; LAYERS.forEach(n => L[n].gain.setTargetAtTime(0, t, 0.3)); } state = null; cur = null; pending = null; }
    return { kick, halt, stop, get state() { return state && Object.keys(STATES).find(k => STATES[k] === state); }, get playing() { return !!timer; } };
  })();

  function music(name) {
    if (!STATES[name]) name = 'menu';
    wantState = name;
    Music.kick();
  }
  function muffle(on) { if (!ac) return; bus.muffle.frequency.setTargetAtTime(on ? 650 : 18000, ac.currentTime, 0.15); }
  function configure(o) {
    const wasMusic = cfg.musicOn && cfg.music > 0;
    Object.assign(cfg, o || {});
    applyVolume();
    const isMusic = cfg.musicOn && cfg.music > 0;
    if (wasMusic && !isMusic) Music.stop(); else if (isMusic) Music.kick();
  }

  // UI: a soft tap for any button that didn't make its own sound; hover ticks only with a mouse
  let clickT = 0, lastNonUi = 0;
  const _play = play;
  play = function (name, o) { const r = _play(name, o); if (r && name !== 'tap' && name !== 'hover') lastNonUi = performance.now(); return r; };
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('button, .btn, [role="button"]'); if (!b || b.disabled || b.dataset.sfx === 'none') return;
    clickT = performance.now();
    setTimeout(() => { if (lastNonUi < clickT) play('tap'); }, 0);
  }, true);
  let hoverEl = null;
  document.addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse') return;
    const c = e.target.closest && e.target.closest('.card, .chest, .voucher, .mbtn');
    if (c && c !== hoverEl) play('hover');
    hoverEl = c;
  }, true);

  window.SND = {
    play: (n, o) => play(n, o), murmur, dbg, DEBUG, music, muffle, configure, duck, unlock, renderAll, cfg,
    get ctx() { return ac; }, get _bus() { return bus; }, get ready() { return !!buf.move; }, get unlocked() { return unlocked; }, get names() { return Object.keys(SFX); },
    get musicState() { return Music.state; }, get musicPlaying() { return Music.playing; }, stats: st, buffers: buf, STATES, isIOS: /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  };
})();
