// Bot personalities and trash talk (pure local text, optional speech synthesis in the UI language).
(function () {
  'use strict';
  // Personas: lines live in the string tables as arrays under talk.<id>.<event>; name/title are getters.
  const EVENTS = ['opening', 'hint', 'confused', 'bossIntro', 'start', 'move', 'fine', 'capture', 'lost', 'blunder', 'check', 'inCheck', 'upgrade', 'win', 'lose', 'draw'];
  const AV = { rookie: 'av-rookie', grinder: 'av-grinder', atomic: 'av-atomic', fog: 'av-fog', misere: 'av-misere' };
  const AV0 = Object.assign({}, AV);
  // v0.3 bosses: name, title and a few signature lines each; any other event falls back to the grinder's lines
  ['hill', 'threecheck', 'royalqueen', 'mines', 'masked', 'hourglass', 'pillar', 'forward', 'hydra'].forEach(id => { AV[id] = 'av-' + id; });
  const P = {};
  Object.keys(AV).forEach(id => {
    const lines = {};
    EVENTS.forEach(ev => Object.defineProperty(lines, ev, { get: () => {
      const k = 'talk.' + id + '.' + ev, cur = window.I18N.tables[window.I18N.lang] || {};
      if (cur[k] !== undefined) return cur[k];
      return (window.I18N.tables.ru || {})[k] !== undefined ? tx(k) : undefined; // logs the missing key, falls back to en
    } }));
    P[id] = { id, avatar: AV[id], lines, get name() { return tx('talk.' + id + '.name'); }, get title() { return tx('talk.' + id + '.title'); } };
  });
  const PIECE = k => tx('talk.piece.' + k);
  let persona = P.rookie, lastLine = '', lastText = '', timer = null, queue = [], busyUntil = 0, qTimer = null;

  // ---------- t32: the bot's voice ----------
  // mode: 'speech' (browser speech synthesis in the UI language, default) | 'murmur' (WebAudio blips) | 'off'.
  // iOS Safari rules this has to respect: the first speak() must happen inside a user gesture (we prime it with a
  // silent utterance on the first tap), getVoices() is often [] until 'voiceschanged' fires, cancel() immediately
  // followed by speak() drops the new utterance, and an utterance that gets garbage-collected never fires onend.
  const SP = window.speechSynthesis && typeof window.SpeechSynthesisUtterance !== 'undefined' ? window.speechSynthesis : null;
  const dbg = (...a) => { if (window.SND && window.SND.DEBUG) console.log('[audio]', ...a); };
  const PITCH = { rookie: 1.35, grinder: 0.75, atomic: 1.1, fog: 0.8, misere: 1.55, hill: 0.7, threecheck: 1.2, royalqueen: 1.3, mines: 0.85, masked: 1.0, hourglass: 0.65, pillar: 0.9, forward: 0.6, hydra: 0.7 };
  const RATE = { rookie: 1.1, grinder: 0.9, atomic: 1.15, fog: 0.88, misere: 1.12, hill: 0.95, threecheck: 1.2, royalqueen: 0.95, mines: 1.0, masked: 0.9, hourglass: 0.8, pillar: 1.15, forward: 0.95, hydra: 0.82 };
  let mode = 'speech', vol = 0.8, voices = [], primed = false, broken = false, lastCancel = 0, live = [];
  const st = { spoken: 0, murmured: 0, errors: 0, primed: 0, lastVoice: null, lastLang: null };
  function loadVoices() { try { voices = (SP && SP.getVoices()) || []; } catch (e) { voices = []; } dbg('voices', voices.length); }
  if (SP) {
    loadVoices();
    try { if (SP.addEventListener) SP.addEventListener('voiceschanged', loadVoices); else SP.onvoiceschanged = loadVoices; } catch (e) { SP.onvoiceschanged = loadVoices; }
  }
  const norm = l => String(l || '').toLowerCase().replace('_', '-');
  function pickVoice(lang) {
    if (!voices.length) loadVoices();
    const L = norm(lang), pre = L.split('-')[0], same = v => norm(v.lang) === L, pfx = v => norm(v.lang).split('-')[0] === pre;
    return voices.find(v => same(v) && v.localService) || voices.find(same) || voices.find(v => pfx(v) && v.default) || voices.find(v => pfx(v) && v.localService) || voices.find(pfx) || null;
  }
  function prime() {
    if (primed || !SP || mode !== 'speech') return;
    primed = true; st.primed++;
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; u.lang = window.I18N.speech; keep(u); SP.speak(u); dbg('speech primed in a gesture'); } catch (e) { dbg('prime failed', e && e.message); }
  }
  // touchend / click / keydown carry WebKit's user-gesture token; pointerdown / touchstart do not reliably unlock speech on iOS
  ['touchend', 'click', 'keydown'].forEach(ev => addEventListener(ev, prime, { capture: true, passive: true }));
  function keep(u) { live.push(u); if (live.length > 6) live.shift(); const done = () => { const i = live.indexOf(u); if (i !== -1) live.splice(i, 1); }; u.addEventListener('end', done); }
  function cancel() { if (SP && (SP.speaking || SP.pending)) { try { SP.cancel(); } catch (e) { /* ignore */ } lastCancel = Date.now(); } }
  // returns false when speech can't be used for this line (no engine, no voice for the language, engine failed)
  function speak(line, pri) {
    if (!SP || broken) return false;
    const lang = window.I18N.speech, v = pickVoice(lang);
    if (!v && voices.length) { dbg('no voice for', lang, '→ murmur'); return false; } // voices are known and none speaks this language
    const u = new SpeechSynthesisUtterance(line);
    u.lang = v ? v.lang : lang; if (v) u.voice = v;
    u.pitch = PITCH[persona.id] || 1; u.rate = RATE[persona.id] || 1; u.volume = Math.max(0, Math.min(1, vol));
    u.onstart = () => dbg('speech start', u.lang, v ? v.name : '(default voice)');
    u.onerror = e => { st.errors++; dbg('speech error', e && e.error); if (e && (e.error === 'not-allowed' || e.error === 'synthesis-unavailable' || e.error === 'language-unavailable' || e.error === 'voice-unavailable')) { broken = e.error !== 'not-allowed'; if (window.SND) window.SND.murmur(line, persona.id); } };
    keep(u); st.spoken++; st.lastVoice = v ? v.name : null; st.lastLang = u.lang;
    try { if (SP.paused) SP.resume(); } catch (e) { /* Safari after backgrounding */ }
    const go = () => { try { SP.speak(u); } catch (e) { dbg('speak threw', e && e.message); } };
    // never cancel() and speak() back to back — iOS silently drops the new utterance; queue behind a short line instead
    if (SP.pending || (SP.speaking && pri >= 2)) { cancel(); setTimeout(go, 160); }
    else if (Date.now() - lastCancel < 160) setTimeout(go, 160 - (Date.now() - lastCancel));
    else go();
    return true;
  }
  function voiceOut(line) {
    if (mode === 'off') return;
    if (mode === 'speech' && speak(line, arguments[1] || 0)) return;
    if (window.SND && window.SND.murmur(line, persona.id)) st.murmured++; // Animal-Crossing-style blips
  }
  const MIN_MS = 2200, PRIORITY = { opening: 3, bossIntro: 3, win: 3, lose: 3, draw: 3, start: 2, upgrade: 2, hint: 1, confused: 1, blunder: 1, capture: 1, fine: 2, lost: 1, check: 1, inCheck: 1, move: 0 };
  const $ = id => document.getElementById(id);

  function setPersona(id) {
    flush();
    persona = P[id] || P.rookie;
    $('bot-avatar').innerHTML = window.PIX.img(persona.avatar);
    $('bot-name').textContent = persona.name;
    $('bot-title').textContent = persona.title;
  }
  function say(event, vars) {
    let pool = persona.lines[event]; if (!Array.isArray(pool) && !AV0[persona.id]) pool = P.grinder.lines[event]; if (!Array.isArray(pool)) pool = P.rookie.lines[event]; if (!Array.isArray(pool)) pool = null;
    if (!pool || !pool.length) return;
    let choices = pool.filter(l => l !== lastLine); if (!choices.length) choices = pool;
    let line = choices[Math.floor(Math.random() * choices.length)];
    lastLine = line;
    vars = vars || {};
    line = line.replace(/\{piece\}/g, vars.piece ? (/^[pnbrqk]$/.test(vars.piece) ? PIECE(vars.piece) : vars.piece) : PIECE('any')).replace(/\{name\}/g, vars.name || '').replace(/\{n\}/g, vars.n == null ? '' : vars.n);
    line = line.charAt(0).toUpperCase() + line.slice(1);
    // Queue lines so an important one (opening bonus, boss intro) is never instantly overwritten.
    const pri = PRIORITY[event] || 0;
    if (queue.length >= 2) { // keep the queue short: drop the least important pending line
      let lo = 0; queue.forEach((q, i) => { if (q.pri < queue[lo].pri) lo = i; });
      if (queue[lo].pri <= pri) queue.splice(lo, 1); else return;
    }
    queue.push({ line, pri }); lastText = line;
    if (Date.now() >= busyUntil) next();
  }
  function next() {
    clearTimeout(qTimer);
    const item = queue.shift(); if (!item) return;
    const line = item.line;
    const b = $('bubble');
    b.textContent = line; b.classList.remove('hidden', 'pop'); void b.offsetWidth; b.classList.add('pop');
    const av = $('bot-avatar'); av.classList.remove('talking'); void av.offsetWidth; av.classList.add('talking');
    const hold = Math.max(MIN_MS, Math.min(4000, line.length * 55)) + (item.pri >= 2 ? 600 : 0);
    busyUntil = Date.now() + hold;
    qTimer = setTimeout(next, hold);
    clearTimeout(timer); timer = setTimeout(() => { if (!queue.length) b.classList.add('hidden'); }, Math.max(6000, hold));
    voiceOut(line, item.pri);
  }
  function refresh() { $('bot-name').textContent = persona.name; $('bot-title').textContent = persona.title; }
  function flush() { queue = []; busyUntil = 0; clearTimeout(qTimer); cancel(); }
  function configure(o) {
    o = o || {};
    if (o.mode && /^(speech|murmur|off)$/.test(o.mode)) { if (o.mode !== mode && mode === 'speech') cancel(); mode = o.mode; if (mode === 'speech') broken = false; }
    if (typeof o.vol === 'number') vol = o.vol;
  }
  // back-compat (t31 boolean)
  function setVoice(on) { configure({ mode: on ? 'speech' : 'murmur' }); }
  function toggleVoice() { configure({ mode: mode === 'off' ? 'speech' : 'off' }); if (mode !== 'off') say('start'); }
  // settings «Test» button: speaks straight away (inside the tap), bypassing the queue
  function test() { prime(); const l = persona.lines.start; const line = Array.isArray(l) && l.length ? l[0] : persona.name; voiceOut(line.replace(/\{[a-z]+\}/g, ''), 2); return mode; }
  window.Talk = { setPersona, refresh, say, toggleVoice, setVoice, configure, test, flush, pickVoice, get voice() { return mode; }, get mode() { return mode; }, get vol() { return vol; }, stats: st, get voices() { return voices.length; }, get personaName() { return persona.name; }, get avatar() { return window.PIX.img(persona.avatar); }, get last() { return lastText || $('bubble').textContent; } };
})();
