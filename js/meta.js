// Meta layer: main menu, pause sheet, settings, tutorial, first-run coach marks, collection, save/resume.
// Skills: game-ui-ux (screen stack, initial focus, focus trap, Esc = back, safe areas),
//         save-systems (versioned schema, migration chain, temp → main + .bak writes, validation, safe-boundary autosave).
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const PX = (n, c) => window.PIX.img(n, c);
  const LS = (() => { try { const k = '__t'; localStorage.setItem(k, 1); localStorage.removeItem(k); return localStorage; } catch (e) { return null; } })();
  const get = k => { try { return LS ? LS.getItem(k) : null; } catch (e) { return null; } };
  const set = (k, v) => { if (!LS) return false; try { LS.setItem(k, v); return true; } catch (e) { return false; } };
  const del = k => { try { if (LS) LS.removeItem(k); } catch (e) { /* ignore */ } };
  const params = new URLSearchParams(location.search);

  // ================= settings (own key, own version) =================
  const SET_KEY = 'chessrl-settings', SET_V = 1;
  const DEF = { v: SET_V, voiceMode: 'speech', voiceVol: 0.8, sfx: 0.7, mute: false, music: 0.5, musicMute: false, motion: 'full', shake: 0.7, flash: true, coach: true };
  let S = Object.assign({}, DEF);
  try { const raw = JSON.parse(get(SET_KEY) || 'null'); if (raw && typeof raw === 'object' && (raw.v | 0) <= SET_V) Object.keys(DEF).forEach(k => { if (typeof raw[k] === typeof DEF[k]) S[k] = raw[k]; }); } catch (e) { /* defaults */ }
  // t32: the old boolean `voice` (default off → murmur only) becomes voiceMode; everyone gets real speech by default
  if (!/^(speech|murmur|off)$/.test(S.voiceMode)) S.voiceMode = 'speech';
  function applySettings() {
    window.FX.configure({ motion: S.motion, shake: S.shake, flash: S.flash });
    if (window.SND) window.SND.configure({ sfx: S.sfx, sfxOn: !S.mute, music: S.music, musicOn: !S.musicMute, voice: S.voiceVol, voiceOn: S.voiceMode !== 'off' });
    if (window.Talk && window.Talk.configure) window.Talk.configure({ mode: S.voiceMode, vol: S.voiceVol });
  }
  function saveSettings() { S.v = SET_V; set(SET_KEY, JSON.stringify(S)); applySettings(); }

  // ================= save system =================
  const SAVE_KEY = 'chessrl-save', SAVE_V = 2;
  // Each migration is a pure vN → vN+1 step; keep them forever.
  const MIGRATIONS = {
    // v0 = an unversioned blob (a bare run object, pre-t19 dev builds) → v1 envelope
    0: d => (d && d.run ? d : { run: d, screen: 'game' }),
    // v2 (t26): a run is 9 rounds of 3 debuts; old endless runs keep their place, capped at the final round
    1: d => { if (d.run) { d.run.debuts = d.run.debuts || window.rollDebuts(); if (d.run.round > window.RUN_ROUNDS) { d.run.round = window.RUN_ROUNDS; if (d.screen !== 'game') d.screen = 'game'; } } return d; }
  };
  const SCREENS = ['game', 'shop', 'toShop', 'opening'];
  const known = id => !!window.RELIC(id);
  const START0 = window.Rules.initialState().board;
  function validate(d) {
    if (!d || typeof d !== 'object' || !d.run || typeof d.run !== 'object') throw new Error('noRun');
    const r = d.run, num = (x, lo, hi) => typeof x === 'number' && isFinite(x) && x >= lo && x <= hi;
    if (!num(r.round, 1, 9999) || !num(r.gold, 0, 1e6)) throw new Error('badNums');
    if (SCREENS.indexOf(d.screen) === -1) d.screen = 'game';
    // content removed in a patch is dropped, not crashed on
    r.relics = (Array.isArray(r.relics) ? r.relics : []).filter(x => x && known(x.id)).slice(0, 6);
    r.vouchers = (Array.isArray(r.vouchers) ? r.vouchers : []).filter(id => window.VOUCHERS.some(v => v.id === id));
    const enh = {}; Object.keys(r.enh || {}).forEach(sq => { const e = window.ENH[r.enh[sq]]; if (+sq >= 48 && +sq <= 63 && +sq !== 60 && e && e.for.indexOf(START0[sq].toLowerCase()) !== -1) enh[sq] = r.enh[sq]; }); r.enh = enh;
    r.items = Object.assign({ hints: 0, undo: 0, confuse: 0 }, r.items || {});
    ['hints', 'undo', 'confuse'].forEach(k => { if (!num(r.items[k], 0, 999)) r.items[k] = 0; });
    ['earned', 'fined', 'wins'].forEach(k => { if (!num(r[k], 0, 1e7)) r[k] = 0; });
    r.next = r.next && typeof r.next === 'object' ? r.next : {};
    if (r.side !== 'b') r.side = 'w'; // t32: saves from before the side choice were White
    r.tier = num(r.tier, 1, 8) ? r.tier | 0 : 1;
    if (!Array.isArray(r.debuts) || r.debuts.length !== 3 || !r.debuts.every(id => window.DEBUT(id))) r.debuts = window.rollDebuts(r.side);
    if (r.round > window.RUN_ROUNDS) throw new Error('badRound');
    // v0.2: the run's signature opening, and the pre-run offer while it is still being chosen
    const mine = id => { const x = window.DEBUT(id); return !!x && x.side === r.side; };
    if (r.sig != null && !mine(r.sig)) r.sig = null;
    if (d.screen === 'opening') {
      const o = r.offer;
      if (!o || typeof o !== 'object' || !Array.isArray(o.ids) || o.ids.length !== 3 || !o.ids.every(mine) || new Set(o.ids).size !== 3) r.offer = { ids: window.rollOpeningOffer(r.side), free: 0, paid: 0, n: 0 }; // a broken offer never refunds the free reroll
      else { o.free = num(o.free, 0, 1) ? o.free | 0 : 0; o.paid = num(o.paid, 0, 99) ? o.paid | 0 : 0; o.n = num(o.n, 0, 999) ? o.n | 0 : 0; }
      if (!num(r.startGold, 0, 1e6)) r.startGold = 0;
      if (r.round !== 1) { r.offer = null; d.screen = 'game'; }
    } else r.offer = null;
    r.openings = Array.isArray(r.openings) ? r.openings : []; r.bought = Array.isArray(r.bought) ? r.bought : [];
    if (d.screen === 'shop') {
      const sh = r.shop;
      if (!sh || !Array.isArray(sh.relics) || !Array.isArray(sh.packs)) d.screen = 'toShopNoRoll';
      else { sh.relics = sh.relics.filter(o => o && known(o.id)); sh.rerolls = sh.rerolls | 0; }
    }
    if (r.pack && (!r.pack.items || !Array.isArray(r.pack.items))) r.pack = null;
    if (r.pack && r.pack.kind === 'enh') { r.pack.items = r.pack.items.filter(x => x && window.ENH[x.id] && START0[x.sq] && x.sq >= 48 && x.sq !== 60); if (!r.pack.items.length) r.pack = null; }
    if (r.shop && Array.isArray(r.shop.packs)) r.shop.packs.forEach(o => { if (o && o.kind === 'enh' && !window.PACKS.enh[o.size]) o.size = 0; });
    return d;
  }
  function decode(raw) {
    const d = JSON.parse(raw);
    let v = d && typeof d.v === 'number' ? d.v | 0 : 0;
    if (v > SAVE_V) { const e = new Error('newer'); e.newer = true; throw e; }
    let data = d;
    while (v < SAVE_V) { data = MIGRATIONS[v](data); v++; data.v = v; }
    return validate(data);
  }
  let lastSaveError = null;
  // localStorage has no rename, so: write .tmp, verify it parses, copy the current main to .bak, then write main.
  function save(run, screen) {
    if (!LS) return false;
    const json = JSON.stringify({ v: SAVE_V, at: Date.now(), screen, run });
    if (!set(SAVE_KEY + '.tmp', json)) { lastSaveError = tx('save.noSpace'); return false; }
    try { JSON.parse(get(SAVE_KEY + '.tmp')); } catch (e) { lastSaveError = tx('save.writeBroken'); return false; }
    const prev = get(SAVE_KEY); if (prev) set(SAVE_KEY + '.bak', prev);
    const ok = set(SAVE_KEY, json); del(SAVE_KEY + '.tmp');
    lastSaveError = ok ? null : tx('save.failed');
    return ok;
  }
  function load() {
    const errs = [];
    for (const k of [SAVE_KEY, SAVE_KEY + '.bak']) {
      const raw = get(k); if (!raw) continue;
      try { const d = decode(raw); d.from = k; return { ok: true, data: d }; } catch (e) { errs.push(e); if (e.newer) return { ok: false, newer: true, error: e.message }; }
    }
    return errs.length ? { ok: false, error: errs[0].message } : { ok: false, none: true };
  }
  function clearSave() { del(SAVE_KEY); del(SAVE_KEY + '.bak'); del(SAVE_KEY + '.tmp'); }

  // ================= collection (relics you have seen) =================
  const SEEN_KEY = 'chessrl-seen';
  let seen = {}; try { seen = JSON.parse(get(SEEN_KEY) || '{}') || {}; } catch (e) { seen = {}; }
  const DSEEN_KEY = 'chessrl-debuts';
  let dseen = {}; try { dseen = JSON.parse(get(DSEEN_KEY) || '{}') || {}; } catch (e) { dseen = {}; }
  function markDebut(id) { if (id && !dseen[id]) { dseen[id] = 1; set(DSEEN_KEY, JSON.stringify(dseen)); } }
  function markSeen(ids) { let ch = false; ids.forEach(id => { if (id && !seen[id]) { seen[id] = 1; ch = true; } }); if (ch) set(SEEN_KEY, JSON.stringify(seen)); }

  // ================= screen / overlay stack =================
  const stack = [];
  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
  function push(id, opts) {
    const el = $(id); if (!el) return;
    if (stack.indexOf(id) !== -1) pop(id);
    const prev = document.activeElement;
    stack.push(id); el._prevFocus = prev; el._onPop = opts && opts.onPop;
    el.classList.remove('hidden', 'leaving'); el.setAttribute('aria-hidden', 'false');
    void el.offsetWidth; el.classList.add('open');
    window.FX.sfx('menu');
    if (id === 'sheet-pause' && window.SND) window.SND.muffle(true);
    setTimeout(() => { const ok = x => !x.hidden && !x.disabled && x.offsetParent !== null, f = [...el.querySelectorAll('[data-autofocus]')].find(ok) || [...el.querySelectorAll(FOCUSABLE)].find(ok); if (f && stack[stack.length - 1] === id) f.focus({ preventScroll: true }); }, 30);
  }
  function pop(id) {
    id = id || stack[stack.length - 1]; const i = stack.indexOf(id); if (i === -1) return;
    stack.splice(i, 1);
    window.FX.sfx('back');
    if (id === 'sheet-pause' && window.SND) window.SND.muffle(false);
    const el = $(id); el.classList.remove('open'); el.setAttribute('aria-hidden', 'true');
    const done = () => { if (stack.indexOf(id) === -1) el.classList.add('hidden'); };
    if (window.FX.reduce) done(); else { el.classList.add('leaving'); setTimeout(() => { el.classList.remove('leaving'); done(); }, 260); }
    if (el._prevFocus && el._prevFocus.focus && document.body.contains(el._prevFocus)) el._prevFocus.focus({ preventScroll: true });
    if (el._onPop) { const f = el._onPop; el._onPop = null; f(); }
  }
  const top = () => stack[stack.length - 1];
  addEventListener('keydown', e => {
    const t = top();
    if (e.key === 'Escape') {
      if (coachCur) { e.preventDefault(); closeCoach(false); return; }
      if (t && t !== 'screen-menu') { e.preventDefault(); pop(); return; }
      if (!t && window.Game && window.Game.inPlay() && !window.Game.modalOpen()) { e.preventDefault(); openPause(); }
      return;
    }
    if (!t || (window.Game && window.Game.overlayOpen())) return;
    const el = $(t);
    if (e.key === 'Tab') { // trap focus inside the top layer
      const f = [...el.querySelectorAll(FOCUSABLE)].filter(x => x.offsetParent !== null); if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && el.querySelector('.menu-list')) { // menu: arrows move focus, wrap at the ends
      const f = [...el.querySelectorAll('.menu-list .mbtn:not([disabled])')]; if (!f.length) return;
      e.preventDefault(); const i = f.indexOf(document.activeElement);
      f[(i + (e.key === 'ArrowDown' ? 1 : -1) + f.length) % f.length].focus();
    }
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && t === 'tutorial') { e.preventDefault(); tutGo(tutI + (e.key === 'ArrowRight' ? 1 : -1)); }
  });

  // ================= main menu =================
  function fmtAgo(ts) {
    if (!ts) return ''; const m = Math.round((Date.now() - ts) / 60000);
    return m < 1 ? tx('ago.now') : m < 60 ? tx('ago.min', { n: m }) : m < 1440 ? tx('ago.h', { n: Math.round(m / 60) }) : tx('ago.d', { n: Math.round(m / 1440) });
  }
  function renderMenu() {
    const L = load(), best = +get('chessrl-best-round') || 0;
    const cont = $('m-continue'), nw = $('m-new'), info = $('m-save');
    cont.hidden = !L.ok; cont.disabled = !L.ok;
    nw.classList.toggle('primary', !L.ok); cont.classList.toggle('primary', !!L.ok);
    if (L.ok) {
      const r = L.data.run;
      info.innerHTML = PX('coin', 'i16') + '<span>' + (r.offer ? tx('op.where') : tx('g.roundNofM', { n: r.round, m: window.RUN_ROUNDS }) + ' · ' + window.DEBUT(r.debuts[Math.min(2, Math.ceil(r.round / 3) - 1)]).name) + ' · $' + r.gold + ' · ' + tx('menu.relicsN', { n: r.relics.length }) + '</span><small>' + fmtAgo(L.data.at) + (L.data.from !== SAVE_KEY ? ' · ' + tx('menu.fromBackup') : '') + '</small>';
      info.hidden = false;
    } else if (L.newer || L.error) {
      info.innerHTML = PX('skull', 'i16') + '<span>' + (L.newer ? tx('save.newer') : tx('save.broken', { err: window.I18N.tables.ru['save.err.' + L.error] ? tx('save.err.' + L.error) : L.error })) + '</span>';
      info.hidden = false;
    } else info.hidden = true;
    $('m-best').textContent = (best ? tx('menu.best', { n: best }) : tx('menu.firstRun')) + ' · ' + tx('menu.tierOpen', { n: tiers().max });
    const all = collIds(); $('m-coll-n').textContent = all.filter(id => seen[id]).length + '/' + all.length;
    [...document.querySelectorAll('#screen-menu .mbtn')].filter(b => !b.hidden).forEach((b, i) => b.style.setProperty('--i', i));
  }
  function showMenu() {
    stack.slice().reverse().forEach(id => { if (id !== 'screen-menu') pop(id); });
    if (window.Game) window.Game.leave();
    renderMenu();
    document.documentElement.dataset.screen = 'menu';
    window.FX.theme('menu');
    if (stack.indexOf('screen-menu') === -1) push('screen-menu');
    const tg = $('m-tagline'); tg.classList.remove('go'); void tg.offsetWidth; tg.classList.add('go');
  }
  function hideMenu() { if (stack.indexOf('screen-menu') !== -1) pop('screen-menu'); }
  // ================= t32: new run screen (side + thinking level) =================
  const TIER_KEY = 'chessrl-tiers', NR_KEY = 'chessrl-newrun';
  const tiers = () => { try { const t = JSON.parse(get(TIER_KEY) || '{}') || {}; return { max: Math.max(1, Math.min(8, t.max | 0 || 1)), wins: t.wins && typeof t.wins === 'object' ? t.wins : {} }; } catch (e) { return { max: 1, wins: {} }; } };
  // a won run on tier N unlocks N+1; wins[side] = best tier won with that side. Returns the newly unlocked tier (or 0).
  function recordWin(tier, side) {
    const t = tiers(), was = t.max; tier = Math.max(1, Math.min(8, tier | 0));
    t.wins[side] = Math.max(t.wins[side] | 0, tier);
    t.max = Math.max(t.max, Math.min(8, tier + 1));
    set(TIER_KEY, JSON.stringify(t));
    return t.max > was ? t.max : 0;
  }
  let nr = (() => { try { const o = JSON.parse(get(NR_KEY) || '{}') || {}; return { side: ['w', 'b', 'r'].includes(o.side) ? o.side : 'w', tier: o.tier | 0 || 1 }; } catch (e) { return { side: 'w', tier: 1 }; } })();
  let nrCoach = null;
  const MOD_KEYS = ['startGold', 'interestCap', 'queenLoss', 'reroll', 'bossBonus', 'lossPlus'];
  function tierMods(n) {
    const m = window.tierMods(n), out = MOD_KEYS.filter(k => m[k]).map(k => tx('tier.mod.' + k, { n: Math.abs(m[k]) }));
    if (m.noRandom) out.push(tx('tier.mod.noRandom'));
    return out;
  }
  function renderNewRun() {
    const t = tiers(); if (nr.tier > t.max) nr.tier = t.max;
    const piece = n => '<img class="piece-art" src="vendor/pieces/cburnett/' + n + '.svg" alt="">';
    const sides = [['w', piece('wK')], ['b', piece('bK')], ['r', '<span class="rnd">' + piece('wK') + piece('bK') + '</span>']];
    const T = window.TIERS[nr.tier - 1], mods = tierMods(nr.tier);
    $('nr-body').innerHTML = '<h3 class="nr-h">' + tx('nr.side') + '</h3><div class="nr-sides" role="radiogroup" aria-label="' + tx('nr.side') + '">' +
      sides.map(([id, art]) => '<button class="nr-side' + (nr.side === id ? ' on' : '') + '" role="radio" aria-checked="' + (nr.side === id) + '" data-side="' + id + '">' + art + '<span>' + tx('side.' + id) + '</span></button>').join('') + '</div>' +
      '<h3 class="nr-h">' + tx('nr.tier') + '</h3><div class="nr-tiers" role="radiogroup" aria-label="' + tx('nr.tier') + '">' +
      window.TIERS.map((x, i) => {
        const n = i + 1, locked = n > t.max, rec = ['w', 'b'].filter(sd => (t.wins[sd] | 0) >= n).map(sd => piece(sd + 'K')).join('');
        return '<button class="nr-tier' + (nr.tier === n ? ' on' : '') + (locked ? ' locked' : '') + '" role="radio" aria-checked="' + (nr.tier === n) + '" aria-disabled="' + locked + '" data-tier="' + n + '">' +
          '<span class="n">' + (locked ? PX('g:padlock:G:none', 'i16') : n) + '</span><span><b>' + tx('tier.' + n) + '</b><small>' + (locked ? tx('nr.lockedBy', { n: n - 1, name: tx('tier.' + (n - 1)) }) : tx('tier.' + n + '.d')) + '</small></span>' +
          '<span class="rec">' + rec + '</span></button>';
      }).join('') + '</div>' +
      '<div class="nr-detail"><b>' + tx('tier.short', { n: nr.tier, name: tx('tier.' + nr.tier) }) + '</b> · ' + tx('nr.engine', { rnd: Math.round(window.Bot.params(1, nr.tier).randomP * 100), s1: window.Bot.params(1, nr.tier).skill, s2: window.Bot.params(9, nr.tier).skill, depth: T.depth, ms: (T.ms / 1000).toLocaleString(window.I18N.lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }) +
      (mods.length ? '<ul>' + mods.map(x => '<li>' + x + '</li>').join('') + '</ul>' : '<br>' + tx('nr.noMods')) + '</div>';
  }
  function openNewRun(withCoach) {
    nrCoach = withCoach; renderNewRun(); push('sheet-newrun');
  }
  function startNew(withCoach) {
    if (load().ok && !confirmNew._ok) return confirmNew(withCoach);
    confirmNew._ok = false;
    openNewRun(withCoach);
  }
  function launchRun() {
    const side = nr.side === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : nr.side;
    window.__nrPick = nr.side;
    set(NR_KEY, JSON.stringify(nr));
    pop('sheet-newrun');
    clearSave(); hideMenu(); coachOn = nrCoach == null ? S.coach : nrCoach;
    window.Game.newRun({ side, tier: nr.tier });
  }
  function confirmNew(withCoach) {
    window.Game.modal('<h2>' + tx('menu.restartQ') + '</h2><p>' + tx('menu.restartText') + '</p>', [[tx('menu.new'), () => { confirmNew._ok = true; startNew(withCoach); }, 'danger'], [tx('g.cancel'), () => {}]]);
  }
  function resume() {
    const L = load(); if (!L.ok) { renderMenu(); return; }
    hideMenu(); coachOn = S.coach;
    window.Game.resume(L.data);
  }

  // ================= pause sheet =================
  function openPause() {
    if (!window.Game.inPlay() || window.Game.modalOpen()) return;
    $('p-sub').textContent = window.Game.where();
    push('sheet-pause');
  }

  // ================= settings sheet =================
  function renderSettings() {
    const row = (key, label, sub, ctrl) => '<div class="set-row' + (/class="(switch|vol)/.test(ctrl) ? ' nw' : '') + '"><div class="set-lbl"><b>' + label + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>' + ctrl + '</div>';
    const sw = (key, on) => '<button class="switch' + (on ? ' on' : '') + '" role="switch" aria-checked="' + !!on + '" data-set="' + key + '" data-on="' + tx('set.swOn') + '" data-off="' + tx('set.swOff') + '"><span></span></button>';
    const seg = (key, opts, val) => '<div class="seg" role="radiogroup">' + opts.map(([v, l]) => '<button role="radio" aria-checked="' + (v === val) + '" class="' + (v === val ? 'on' : '') + '" data-set="' + key + '" data-v="' + v + '">' + l + '</button>').join('') + '</div>';
    const rm = window.FX.osReduce;
    const vol = (key, v, off) => '<input type="range" class="vol' + (off ? ' off' : '') + '" min="0" max="1" step="0.05" value="' + v + '" data-vol="' + key + '" aria-label="' + tx(key === 'music' ? 'set.musicVol' : key === 'voiceVol' ? 'set.voiceVol' : 'set.sfxVol') + '" style="--p:' + Math.round(v * 100) + '%">';
    $('set-body').innerHTML =
      '<h3 class="set-h">' + tx('lang.title') + '</h3>' + langGrid('set') +
      '<h3 class="set-h">' + tx('set.sound') + '</h3>' +
      row('musicMute', tx('set.music'), tx('set.musicSub'), sw('musicOn', !S.musicMute)) +
      row('music', tx('set.musicVol'), null, vol('music', S.music, S.musicMute)) +
      row('mute', tx('set.sfx'), tx('set.sfxSub'), sw('sfxOn', !S.mute)) +
      row('sfx', tx('set.sfxVol'), null, vol('sfx', S.sfx, S.mute)) +
      (window.SND && window.SND.isIOS ? '<p class="set-note">' + tx('set.iosNote') + '</p>' : '') +
      row('voiceMode', tx('set.voice'), tx('set.voiceSub'), seg('voiceMode', [['speech', tx('set.vSpeech')], ['murmur', tx('set.vMurmur')], ['off', tx('set.off')]], S.voiceMode)) +
      row('voiceVol', tx('set.voiceVol'), null, vol('voiceVol', S.voiceVol, S.voiceMode === 'off')) +
      '<div class="set-row"><div class="set-lbl"><b>' + tx('set.voiceTest') + '</b>' + (!window.speechSynthesis ? '<small>' + tx('set.noSpeech') + '</small>' : '') + '</div><button class="btn btn-blue btn-sm" data-act-set="voice-test">' + tx('set.voiceTestBtn') + '</button></div>' +
      '<h3 class="set-h">' + tx('set.motionH') + '</h3>' +
      row('motion', tx('set.anim'), rm ? tx('set.animOs') : tx('set.animSub'), seg('motion', [['full', tx('set.full')], ['reduced', tx('set.reduced')]], rm ? 'reduced' : S.motion)) +
      row('shake', tx('set.shake'), null, seg('shake', [[0, tx('set.off')], [0.4, tx('set.weak')], [0.7, tx('set.normal')]], S.shake)) +
      row('flash', tx('set.flash'), tx('set.flashSub'), sw('flash', S.flash)) +
      '<h3 class="set-h">' + tx('menu.tutorial') + '</h3>' +
      row('coach', tx('set.coach'), tx('set.coachSub'), sw('coach', S.coach)) +
      '<div class="set-row"><div class="set-lbl"><b>' + tx('set.resetCoach') + '</b><small>' + tx('set.resetCoachSub') + '</small></div><button class="btn btn-blue btn-sm" data-act-set="reset-coach">' + tx('set.reset') + '</button></div>' +
      '<h3 class="set-h">' + tx('set.privacy') + '</h3>' +
      '<div class="set-row"><div class="set-lbl"><b>' + tx('fb.title') + '</b><small>' + tx('set.fbSub') + '</small></div><button class="btn btn-purple btn-sm" data-fb="settings">' + tx('set.fbBtn') + '</button></div>' +
      row('analytics', tx('set.analytics'), tx('set.analyticsSub'), sw('analytics', !(window.PBA && window.PBA.off))) +
      '<p class="set-note ver-note">Pawnbreaker · ' + ((window.PB_CONFIG && window.PB_CONFIG.versionLabel) || '') + '</p>' +
      '<p class="set-note credit-note" translate="no">Item icons: <a href="https://game-icons.net" target="_blank" rel="noopener">game-icons.net</a> by ' + (window.GI_AUTHORS || []).join(', ') + ' · <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener">CC BY 3.0</a></p>';
  }
  function onSetClick(e) {
    const b = e.target.closest('[data-set], [data-act-set]'); if (!b || b.dataset.lang) return;
    const k = b.dataset.set;
    if (b.dataset.actSet === 'voice-test') { window.Talk.test(); return; }
    if (b.dataset.actSet === 'reset-coach') { coachSeen = {}; set(COACH_KEY, '{}'); S.coach = true; coachOn = true; saveSettings(); renderSettings(); window.Game.toast(tx('set.coachBack')); return; }
    if (k === 'sfxOn') S.mute = !S.mute;
    else if (k === 'musicOn') S.musicMute = !S.musicMute;
    else if (k === 'flash' || k === 'coach') S[k] = !S[k];
    else if (k === 'analytics') { if (window.PBA) window.PBA.setEnabled(window.PBA.off); }
    else if (k === 'voiceMode') S.voiceMode = b.dataset.v;
    else if (k === 'shake') S[k] = +b.dataset.v;
    else if (k === 'motion') { if (window.FX.osReduce) return; S.motion = b.dataset.v; }
    if (k === 'coach') coachOn = S.coach;
    saveSettings(); renderSettings(); window.FX.sfx('click');
    const f = $('set-body').querySelector('[data-set="' + k + '"]' + (b.dataset.v != null ? '[data-v="' + b.dataset.v + '"]' : '')); if (f) f.focus();
  }

  // ================= language =================
  function langGrid(where) {
    const cur = window.I18N.lang;
    return '<div class="lang-grid" role="radiogroup" aria-label="' + tx('lang.title') + '">' + window.I18N.LANGS.map(l => '<button role="radio" lang="' + l.code + '" aria-checked="' + (l.code === cur) + '" class="lang-opt' + (l.code === cur ? ' on' : '') + '" data-lang="' + l.code + '"><b>' + l.name + '</b><small>' + l.code.split('-')[0].toUpperCase() + '</small></button>').join('') + '</div>';
  }
  function pickLang(code) {
    if (!code || code === window.I18N.lang) return;
    window.I18N.setLang(code); window.FX.sfx('click');
  }
  function openLang() { $('lang-body').innerHTML = langGrid('sheet'); push('sheet-lang'); }
  function renderTagline() {
    const w = tx('menu.tagline'), words = Array.isArray(w) ? w : String(w).split(' '), sep = /^(zh|ja)/.test(window.I18N.lang) ? '' : ' ';
    $('m-tagline').innerHTML = words.map((x, i) => '<span style="--i:' + i + '">' + x + '</span>').join(sep);
    $('m-lang-code').textContent = window.I18N.lang.split('-')[0].toUpperCase();
  }
  // live switch: everything visible re-renders in the new language, the run itself is untouched
  function onLangChange() {
    renderTagline();
    if (!$('screen-menu').classList.contains('hidden')) renderMenu();
    if (!$('settings').classList.contains('hidden')) { renderSettings(); const f = $('set-body').querySelector('.lang-opt.on'); if (f) f.focus({ preventScroll: true }); }
    if (!$('sheet-lang').classList.contains('hidden')) { $('lang-body').innerHTML = langGrid('sheet'); const f = $('lang-body').querySelector('.lang-opt.on'); if (f) f.focus({ preventScroll: true }); }
    if (!$('tutorial').classList.contains('hidden')) renderTut();
    if (!$('collection').classList.contains('hidden')) openColl(true);
    if (!$('sheet-newrun').classList.contains('hidden')) renderNewRun();
    if (!$('sheet-pause').classList.contains('hidden') && window.Game.inPlay()) $('p-sub').textContent = window.Game.where();
    if (coachCur && COACH[coachCur]) $('coach').querySelector('.coach-bubble p').textContent = tx(coachText(coachCur, COACH[coachCur][1]));
  }

  // ================= tutorial carousel =================
  const TUT = [
    { ico: 'crown', get t() { return tx('tut.0.t'); }, get d() { return tx('tut.0.d'); }, demo: 'round' },
    { ico: 'coin', get t() { return tx('tut.1.t'); }, get d() { return tx('tut.1.d'); }, demo: 'cap' },
    { ico: 'debut', get t() { return tx('tut.2.t'); }, get d() { return tx('tut.2.d'); }, demo: 'debut' },
    { ico: 'cards', get t() { return tx('tut.op.t'); }, get d() { return tx('tut.op.d'); }, demo: 'pick' },
    { ico: 'coin-loss', get t() { return tx('tut.3.t'); }, get d() { return tx('tut.3.d'); }, demo: 'loss' },
    { ico: 'bag', get t() { return tx('tut.4.t'); }, get d() { return tx('tut.4.d'); }, demo: 'shop' },
    { ico: 'pack-enh', get t() { return tx('tut.5.t'); }, get d() { return tx('tut.5.d'); }, demo: 'chest' },
    { ico: 'skull', get t() { return tx('tut.6.t'); }, get d() { return tx('tut.6.d'); }, demo: 'boss' },
    { ico: 'crown', get t() { return tx('tut.7.t'); }, get d() { return tx('tut.7.d'); }, demo: 'tiers' }
  ];
  let tutI = 0;
  function demoHtml(kind) {
    const piece = n => '<img class="piece-art" src="vendor/pieces/cburnett/' + n + '.svg" alt="">';
    if (kind === 'round') return '<div class="demo demo-round"><span class="dp w">' + piece('wQ') + '</span><span class="vs">vs</span><span class="dp b">' + piece('bK') + '</span></div>';
    if (kind === 'cap') return '<div class="demo demo-cap"><span class="dp">' + piece('wN') + '</span><span class="arrow"></span><span class="dp hit">' + piece('bR') + '</span><span class="gain">' + PX('coin', 'i16') + '+$3</span></div>';
    if (kind === 'debut') { const d = window.DEBUT('italian'); return '<div class="demo demo-debut"><b>' + d.name + '</b><span class="tline">' + d.san.map((m, i) => (i % 2 ? '' : '<i>' + (i / 2 + 1) + '.</i>') + '<span class="' + (i < 4 ? 'done' : i === 4 ? 'next' : '') + '">' + m + '</span>').join(' ') + '</span><span class="gain">' + PX('coin', 'i16') + tx('tut.perMove') + '</span></div>'; }
    if (kind === 'pick') return '<div class="demo demo-pick">' + ['italian', 'scotch', 'queens-gambit'].map((id, i) => '<span class="dpk' + (i === 1 ? ' on' : '') + '" style="--i:' + i + '">' + PX('av-' + window.DEBUT(id).rule, 'i21') + '<b>' + window.DEBUT(id).name + '</b></span>').join('') + '<span class="dpk-free">' + PX('cards', 'i16') + tx('op.rerollFree') + '</span></div>';
    if (kind === 'loss') return '<div class="demo demo-loss"><span class="dp hit">' + piece('wQ') + '</span><span class="gain neg">' + PX('coin-loss', 'i16') + '−$5</span></div>';
    if (kind === 'shop') { const d = window.RELIC('butcher'), m = window.RELIC('mirror'); return '<div class="demo demo-cards">' + window.Game.relicCard(d, { mini: true, i: 0, tilt: -4 }) + window.Game.relicCard(m, { mini: true, i: 1, tilt: 4 }) + '</div>'; }
    if (kind === 'chest') return '<div class="demo demo-chest"><span class="chest r-rare"><span class="pack"><span class="stripes"></span>' + PX('pack-enh', 'i37 cicon') + '<span class="cname">' + tx('tut.chest') + '</span></span></span>' +
      [['N', 'squire', 'g1'], ['R', 'catapult', 'a1'], ['P', 'retreat', 'e2']].map(([p, id, sq], i) => '<span class="dmini" style="--i:' + i + ';--ec:' + window.ENH[id].color + '"><img class="piece-art" src="vendor/pieces/cburnett/w' + p + '.svg" alt="">' + PX(window.ENH[id].icon, 'i16 eb') + '<small>' + sq + '</small></span>').join('') + '</div>';
    if (kind === 'tiers') return '<div class="demo demo-round"><span class="dp w">' + piece('wK') + '</span><span class="vs">' + tx('side.r') + '</span><span class="dp b">' + piece('bK') + '</span></div>' +
      '<div class="demo demo-tiers">' + [1, 2, 3, 4, 5, 6, 7, 8].map(n => '<span class="tchip' + (n > tiers().max ? ' locked' : '') + '">' + (n > tiers().max ? PX('g:padlock:G:none', 'i16') : n) + '</span>').join('') + '</div>';
    return '<div class="demo demo-boss">' + window.BOSSES.map(b => b.id).sort(() => Math.random() - 0.5).slice(0, 3).map((b, i) => '<span class="boss-chip" style="--i:' + i + '">' + PX('av-' + b, 'i37') + '</span>').join('') + '</div>';
  }
  function renderTut() {
    const s = TUT[tutI];
    $('tut-step').innerHTML = '<div class="tut-card" style="--i:0"><div class="tut-ico">' + PX(s.ico, 'i37') + '</div><small class="tut-n">' + tx('g.nOfM', { n: tutI + 1, m: TUT.length }) + '</small><h2>' + s.t + '</h2>' + demoHtml(s.demo) + '<p>' + s.d + '</p></div>';
    $('tut-dots').innerHTML = TUT.map((_, i) => '<button class="dot' + (i === tutI ? ' on' : '') + '" data-i="' + i + '" aria-label="' + tx('tut.step', { n: i + 1 }) + '"></button>').join('');
    $('tut-prev').disabled = tutI === 0;
    const last = tutI === TUT.length - 1;
    $('tut-next').textContent = last ? (window.Game.inPlay() ? tx('tut.backToGame') : tx('tut.startRun')) : tx('tut.next');
    window.FX.tilt($('tut-step'));
  }
  function tutGo(i) {
    if (i < 0) return;
    if (i >= TUT.length) { if (window.PBA) window.PBA.track('tutorial_completed', { steps: TUT.length }); set('chessrl-tut-done', '1'); pop('tutorial'); if (!window.Game.inPlay()) startNew(true); return; }
    tutI = i; renderTut(); window.FX.sfx('flip');
  }
  function openTutorial() { tutI = 0; renderTut(); push('tutorial'); if (window.PBA) window.PBA.track('tutorial_open', { inRun: window.Game.inPlay() ? 1 : 0 }); }

  // ================= collection =================
  // every collectable item: relics, upgrades, vouchers, tricks (v0.4: 120 relics + 20 + 16 + 9 = 165)
  const collIds = () => window.RELICS.map(r => r.id).concat(Object.keys(window.ENH).map(id => 'enh:' + id), window.VOUCHERS.map(v => 'v:' + v.id), window.CONSUMABLES.map(c => 'cons:' + c.id));
  function openCollection() { openColl(false); }
  function openColl(again) {
    const rar = ['common', 'uncommon', 'rare', 'legendary'];
    const list = window.RELICS.slice().sort((a, b) => rar.indexOf(a.rarity) - rar.indexOf(b.rarity));
    $('coll-body').innerHTML = '<p class="coll-sub">' + tx('coll.allSub', { n: collIds().filter(id => seen[id]).length, m: collIds().length }) + ' · ' + tx('coll.relicsSub', { n: list.filter(d => seen[d.id]).length, m: list.length }) + '</p><div class="coll-grid">' +
      list.map((d, i) => seen[d.id] ? window.Game.relicCard(d, { mini: true, i: i % 6, act: 'coll', k: d.id }) : '<div class="card mini locked r-' + d.rarity + '" style="--i:' + (i % 6) + '"><span class="card-in"><span class="cface"><span class="cart">' + PX('skull', 'i48') + '</span><span class="cname">???</span></span></span></div>').join('') + '</div>';
    const EN = window.ENH, eids = Object.keys(EN);
    $('coll-body').insertAdjacentHTML('beforeend', '<h3 class="coll-sec">' + tx('coll.enhH', { n: eids.filter(id => seen['enh:' + id]).length, m: eids.length }) + '</h3><p class="coll-sub">' + tx('coll.enhSub') + '</p><div class="coll-enh">' +
      eids.map(id => { const e = EN[id], ok = seen['enh:' + id]; return '<div class="enh-row' + (ok ? '' : ' locked') + '" style="--ec:' + e.color + '"><span class="ei">' + PX(e.icon, 'i21') + '</span><b>' + (ok ? e.name : '???') + '</b><small>' + (ok ? e.desc + ' (' + (e.for.length === 5 ? tx('coll.anyPiece') : e.for.split('').map(t => tx('piece.' + t)).join(', ')) + ' · ' + window.RARITY[e.rarity].toLowerCase() + ')' : window.RARITY[e.rarity]) + '</small></div>'; }).join('') + '</div>');
    const row = (key, icon, name, desc, extra) => '<div class="enh-row' + (seen[key] ? '' : ' locked') + '"><span class="ei">' + PX(icon, 'i21') + '</span><b>' + (seen[key] ? name : '???') + '</b><small>' + (seen[key] ? desc + (extra || '') : tx('coll.notSeen')) + '</small></div>';
    $('coll-body').insertAdjacentHTML('beforeend', '<h3 class="coll-sec">' + tx('coll.vH', { n: window.VOUCHERS.filter(v => seen['v:' + v.id]).length, m: window.VOUCHERS.length }) + '</h3><div class="coll-enh">' +
      window.VOUCHERS.map(v => row('v:' + v.id, v.icon, v.name, v.desc, ' · $' + v.price)).join('') + '</div>' +
      '<h3 class="coll-sec">' + tx('coll.cH', { n: window.CONSUMABLES.filter(c => seen['cons:' + c.id]).length, m: window.CONSUMABLES.length }) + '</h3><div class="coll-enh">' +
      window.CONSUMABLES.map(c => row('cons:' + c.id, c.icon, c.name, c.desc)).join('') + '</div>');
    // v0.3 boss codex: every boss rule is listed (rules are no secret); a boss you've met is marked
    $('coll-body').insertAdjacentHTML('beforeend', '<h3 class="coll-sec">' + tx('coll.bossH', { n: window.BOSSES.length }) + '</h3><div class="coll-enh coll-boss">' +
      window.BOSSES.map(b => '<div class="enh-row" style="--ec:' + b.color + '"><span class="ei">' + PX('av-' + b.id, 'i21') + '</span><b>' + b.name + ' · ' + b.rule + '</b><small>' + b.desc + ' · ' + tx('coll.fromCh', { n: b.ch || 1 }) + '</small></div>').join('') + '</div>');
    $('coll-body').insertAdjacentHTML('beforeend', '<h3 class="coll-sec">' + tx('coll.debH', { n: window.DEBUTS.filter(d => dseen[d.id]).length, m: window.DEBUTS.length }) + '</h3><p class="coll-sub">' + tx('coll.debSub') + '</p><div class="deb-list">' +
      window.DEBUTS.map(d => '<div class="deb-row' + (dseen[d.id] ? '' : ' locked') + '"><b>' + d.name + '</b><span class="rule">' + tx('coll.boss', { rule: tx('rule.' + d.rule) }) + '</span><small>' + (dseen[d.id] ? window.debutLine(d) + (d.side === 'b' ? ' · ' + tx('coll.botDefends') : '') : '1.?? ?? 2.?? ?? 3.?? ??') + '</small></div>').join('') + '</div>');
    if (!again) push('collection');
  }

  // ================= coach marks (first run) =================
  const COACH_KEY = 'chessrl-coach';
  let coachSeen = {}; try { coachSeen = JSON.parse(get(COACH_KEY) || '{}') || {}; } catch (e) { coachSeen = {}; }
  let coachOn = true, coachQ = [], coachCur = null;
  const COACH = {
    start: ['#board-frame', 'coach.start'],
    debut: ['#open-goal', 'coach.debut'],
    opening: ['#op-reroll', 'coach.opening'],
    tools: ['.game-controls', 'coach.tools'],
    capture: ['.hb-gold', 'coach.capture'],
    loss: ['.hb-gold', 'coach.loss'],
    payout: ['#modal .cash-row.total', 'coach.payout'],
    shop: ['#shelf', 'coach.shop'],
    chest: ['#packs', 'coach.chest'],
    boss: ['#shop-next', 'coach.boss'],
    relics: ['#relics-game', 'coach.relics']
  };
  const coachText = (id, key) => (id === 'start' && window.Game && window.Game.side === 'b' ? 'coach.startB' : key);
  function coach(id) {
    if (!coachOn || !S.coach || coachSeen[id] || params.has('play') || !COACH[id]) return;
    if (coachCur === id || coachQ.indexOf(id) !== -1) return;
    coachQ.push(id); schedCoach(350);
  }
  let coachT = 0;
  function schedCoach(ms) { if (coachCur || coachT) return; coachT = setTimeout(() => { coachT = 0; nextCoach(); }, ms); }
  function nextCoach() {
    if (coachCur) return;
    const id = coachQ.shift(); if (!id) { coachCur = null; return; }
    const [sel, text] = COACH[id], tgt = document.querySelector(sel);
    if (!tgt || !tgt.getBoundingClientRect().width || top()) { coachCur = null; if (coachQ.length) schedCoach(400); return; }
    coachCur = id;
    const r = tgt.getBoundingClientRect(), pad = 6, el = $('coach');
    const hole = el.querySelector('.coach-hole'), bub = el.querySelector('.coach-bubble');
    Object.assign(hole.style, { left: (r.left - pad) + 'px', top: (r.top - pad) + 'px', width: (r.width + pad * 2) + 'px', height: (r.height + pad * 2) + 'px' });
    bub.querySelector('p').textContent = tx(coachText(id, text));
    el.classList.remove('hidden'); void el.offsetWidth; el.classList.add('open');
    const below = r.top + r.height / 2 < innerHeight / 2, bh = bub.offsetHeight;
    let y = below ? r.bottom + 12 : r.top - 12 - bh; y = Math.max(8, Math.min(innerHeight - bh - 8, y));
    bub.style.top = y + 'px';
    bub.querySelector('button').focus({ preventScroll: true });
  }
  function closeCoach(all) {
    if (!coachCur) return;
    coachSeen[coachCur] = 1; set(COACH_KEY, JSON.stringify(coachSeen));
    const el = $('coach'); el.classList.remove('open'); setTimeout(() => el.classList.add('hidden'), 200);
    coachCur = null;
    if (all) { coachQ = []; S.coach = false; saveSettings(); return; }
    if (coachQ.length) schedCoach(450);
  }

  // ================= boot =================
  function init() {
    applySettings();
    const L = PX;
    $('m-logo-ico').innerHTML = L('crown', 'i48');
    const mb = (id, ico) => { const b = $(id); b.insertAdjacentHTML('afterbegin', '<span class="mico">' + L(ico, 'i21') + '</span>'); };
    mb('m-continue', 'resume'); mb('m-new', 'play'); mb('m-tut', 'book'); mb('m-set', 'gear'); mb('m-coll', 'cards');
    mb('p-resume', 'resume'); mb('p-set', 'gear'); mb('p-tut', 'book'); mb('p-fb', 'chat'); mb('p-menu', 'back');
    $('m-fb').insertAdjacentHTML('afterbegin', L('chat', 'i16'));
    if (window.PB_CONFIG && window.PB_CONFIG.versionLabel) $('m-ver').textContent = window.PB_CONFIG.versionLabel;
    $('btn-menu').innerHTML = L('menu', 'i21');
    $('m-continue').onclick = resume;
    $('m-new').onclick = () => startNew();
    $('nr-start').onclick = launchRun;
    $('nr-body').addEventListener('click', e => {
      const sd = e.target.closest('[data-side]'), tr = e.target.closest('[data-tier]');
      if (sd) { nr.side = sd.dataset.side; window.FX.sfx('flip'); renderNewRun(); }
      if (tr) { const n = +tr.dataset.tier; if (n > tiers().max) { window.Game.toast(PX('g:padlock:G:none', 'i16') + ' ' + tx('nr.lockedBy', { n: n - 1, name: tx('tier.' + (n - 1)) })); window.FX.sfx('illegal'); return; } nr.tier = n; window.FX.sfx('flip'); renderNewRun(); }
    });
    $('m-tut').onclick = openTutorial;
    $('m-set').onclick = () => { renderSettings(); push('settings'); };
    $('m-coll').onclick = openCollection;
    $('btn-menu').onclick = openPause;
    $('p-resume').onclick = () => pop('sheet-pause');
    $('p-set').onclick = () => { renderSettings(); push('settings'); };
    $('p-tut').onclick = openTutorial;
    $('p-menu').onclick = () => { window.Game.saveNow(); showMenu(); };
    document.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => pop(b.dataset.close); });
    document.querySelectorAll('.sheet').forEach(s => s.addEventListener('click', e => { if (e.target === s) pop(s.id); }));
    $('set-body').addEventListener('click', onSetClick);
    // volume sliders: live while dragging, saved (and auditioned) on release — no re-render so the thumb keeps focus
    $('set-body').addEventListener('input', e => { const r = e.target.closest('[data-vol]'); if (!r) return; S[r.dataset.vol] = +r.value; r.style.setProperty('--p', Math.round(r.value * 100) + '%'); applySettings(); });
    $('set-body').addEventListener('change', e => { const r = e.target.closest('[data-vol]'); if (!r) return; saveSettings(); if (r.dataset.vol === 'sfx') window.FX.sfx('coin'); if (r.dataset.vol === 'voiceVol' && S.voiceMode !== 'off') window.Talk.test(); });
    const langClick = e => { const b = e.target.closest('[data-lang]'); if (b) pickLang(b.dataset.lang); };
    $('set-body').addEventListener('click', langClick); $('lang-body').addEventListener('click', langClick);
    $('m-lang').insertAdjacentHTML('afterbegin', L('globe', 'i16'));
    $('m-lang').onclick = openLang;
    renderTagline();
    addEventListener('langchange', onLangChange);
    $('tut-next').onclick = () => tutGo(tutI + 1);
    $('tut-prev').onclick = () => tutGo(tutI - 1);
    $('tut-skip').onclick = () => { if (window.PBA) window.PBA.track('tutorial_skipped', { step: tutI + 1, of: TUT.length }); set('chessrl-tut-done', '1'); pop('tutorial'); };
    $('tut-dots').addEventListener('click', e => { const d = e.target.closest('.dot'); if (d) tutGo(+d.dataset.i); });
    let sx = null; // swipe between steps
    $('tut-step').addEventListener('pointerdown', e => { sx = e.clientX; });
    $('tut-step').addEventListener('pointerup', e => { if (sx != null && Math.abs(e.clientX - sx) > 50) tutGo(tutI + (e.clientX < sx ? 1 : -1)); sx = null; });
    $('coach').querySelector('.coach-ok').onclick = () => closeCoach(false);
    $('coach').querySelector('.coach-off').onclick = () => closeCoach(true);
    $('coll-body').addEventListener('click', e => { const c = e.target.closest('.card[data-k]'); if (c && c.dataset.act === 'coll') window.Game.inspectDef(c.dataset.k); });
    window.FX.tilt($('coll-body'));
    // the logo reacts to a tap (squash + burst)
    $('m-logo').addEventListener('click', () => { const l = $('m-logo'); l.classList.remove('boing'); void l.offsetWidth; l.classList.add('boing'); window.FX.burstAt(l, { n: 14, img: window.PIX.url('coin') }); window.FX.sfx('coin'); });
    if (params.has('play')) { coachOn = false; window.Game.newRun({ side: params.get('side') === 'b' ? 'b' : 'w', tier: +params.get('tier') || 1, autoPick: !params.has('pick') }); return; }
    showMenu();
  }

  window.Meta = { init, save, load, clearSave, coach, recordWin, tiers, openNewRun, markSeen, markDebut, showMenu, openPause, push, pop, get top() { return top(); }, get settings() { return S; },
    get lastSaveError() { return lastSaveError; }, get coachActive() { return coachCur; }, closeCoach, SAVE_KEY, SAVE_V, decode, renderMenu };
})();
