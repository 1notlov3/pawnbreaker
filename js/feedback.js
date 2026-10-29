// Alpha playtest plumbing: anonymous gameplay analytics (window.PBA) + the in-game feedback form (window.Feedback).
// Analytics: no cookies, no identifiers that survive the tab (session id lives in sessionStorage), no personal data.
// Backend is pluggable (js/config.js): 'local' (default: this device only), 'goatcounter', 'plausible', 'umami'.
// Feedback: POST JSON to SilentForms → email; offline / blocked → queued in localStorage and retried; mailto fallback.
(function () {
  'use strict';
  const CFG = window.PB_CONFIG || { version: '0.1.0-alpha', versionLabel: 'Alpha v0.1', feedback: {}, analytics: { provider: 'local' } };
  const $ = id => document.getElementById(id);
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }, del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } } };
  const jget = (k, d) => { try { const v = JSON.parse(ls.get(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const DEBUG = /[?&]debug\b/.test(location.search) || ls.get('pb-debug') === '1';

  // ================= analytics =================
  const AN_KEY = 'pb-an', AN_OFF = 'pb-analytics-off', MAX_EV = 300, MAX_SESS = 5;
  const sid = (() => { try { let s = sessionStorage.getItem('pb-sid'); if (!s) { s = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('pb-sid', s); } return s; } catch (e) { return Math.random().toString(36).slice(2, 10); } })();
  const t0 = Date.now();
  let store = jget(AN_KEY, null);
  if (!store || store.v !== 1 || !Array.isArray(store.sessions)) store = { v: 1, sessions: [], totals: {} };
  let sess = store.sessions.find(s => s.id === sid);
  if (!sess) { sess = { id: sid, at: t0, ev: [] }; store.sessions.push(sess); store.sessions = store.sessions.slice(-MAX_SESS); }
  let saveT = 0;
  const persist = () => { if (saveT) return; saveT = setTimeout(() => { saveT = 0; ls.set(AN_KEY, JSON.stringify(store)); }, 400); };
  addEventListener('pagehide', () => { if (saveT) { clearTimeout(saveT); saveT = 0; } ls.set(AN_KEY, JSON.stringify(store)); });
  const isOff = () => ls.get(AN_OFF) === '1';
  const dnt = () => navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true;
  // remote providers: each gets (name, props); failures are swallowed — analytics must never break the game
  const PROVIDERS = {
    local: null,
    goatcounter(name, props) {
      const code = CFG.analytics.goatcounter; if (!code) return;
      const path = name + (props && props.round ? '/r' + props.round : '') + (props && props.tier ? '/t' + props.tier : '');
      const q = new URLSearchParams({ p: path, t: name, e: 'true', s: screen.width + ',' + screen.height + ',' + (devicePixelRatio || 1), rnd: Math.random().toString(36).slice(2) });
      const url = 'https://' + code + '.goatcounter.com/count?' + q;
      if (navigator.sendBeacon) navigator.sendBeacon(url); else new Image().src = url;
    },
    plausible(name, props) {
      const d = CFG.analytics.plausibleDomain; if (!d) return;
      fetch((CFG.analytics.plausibleHost || 'https://plausible.io') + '/api/event', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ name, url: location.origin + location.pathname, domain: d, props }) }).catch(() => {});
    },
    umami(name, props) {
      const h = CFG.analytics.umamiHost, w = CFG.analytics.umamiWebsite; if (!h || !w) return;
      fetch(h.replace(/\/$/, '') + '/api/send', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'event', payload: { website: w, hostname: location.hostname, language: (window.I18N && window.I18N.lang) || navigator.language, screen: screen.width + 'x' + screen.height, url: location.pathname, name, data: props } }) }).catch(() => {});
    }
  };
  function track(name, props) {
    if (isOff()) return;
    props = props || {};
    Object.keys(props).forEach(k => { if (props[k] === undefined || props[k] === null || props[k] === '') delete props[k]; });
    sess.ev.push([Math.round((Date.now() - sess.at) / 1000), name, props]);
    if (sess.ev.length > MAX_EV) sess.ev.splice(0, sess.ev.length - MAX_EV);
    store.totals[name] = (store.totals[name] || 0) + 1;
    persist();
    if (DEBUG) console.debug('[pba]', name, props);
    const p = PROVIDERS[CFG.analytics && CFG.analytics.provider];
    if (p && !dnt()) { try { p(name, props); } catch (e) { /* never break the game */ } }
  }
  const fmtProps = p => Object.keys(p || {}).map(k => k + '=' + p[k]).join(' ');
  function sessionSummary(maxLines) {
    const ev = sess.ev, n = maxLines || 60, cut = ev.length > n ? ev.slice(-n) : ev;
    const lines = cut.map(e => '+' + e[0] + 's ' + e[1] + (Object.keys(e[2] || {}).length ? ' ' + fmtProps(e[2]) : ''));
    if (ev.length > n) lines.unshift('… ' + (ev.length - n) + ' earlier events');
    return lines.join('\n') || '(no events this session' + (isOff() ? ', analytics off' : '') + ')';
  }
  function totalsSummary() { return Object.keys(store.totals).sort().map(k => k + ':' + store.totals[k]).join(', '); }
  window.PBA = {
    track, sessionSummary, totalsSummary,
    get off() { return isOff(); },
    setEnabled(on) { if (on) { ls.del(AN_OFF); track('analytics_on'); } else { track('analytics_off'); ls.set(AN_OFF, '1'); } },
    get provider() { return (CFG.analytics && CFG.analytics.provider) || 'local'; },
    get session() { return sess; }, get store() { return store; }
  };

  // ================= feedback =================
  const Q_KEY = 'pb-fb-queue', DRAFT_KEY = 'pb-fb-draft';
  const FB = CFG.feedback || {};
  const st = { rating: 0, from: 'menu', busy: false, result: null, errs: {} };

  function device() {
    const g = window.__game, run = g && g.run, M = window.Meta, inPlay = !!(window.Game && window.Game.inPlay && window.Game.inPlay());
    const debut = run && run.debuts && window.DEBUT ? window.DEBUT(run.debuts[Math.min(2, Math.ceil(run.round / 3) - 1)]) : null;
    return {
      version: CFG.version, build: CFG.versionLabel,
      ua: navigator.userAgent,
      screen: screen.width + 'x' + screen.height + ' @' + (Math.round((devicePixelRatio || 1) * 100) / 100) + 'x',
      viewport: innerWidth + 'x' + innerHeight,
      standalone: !!(navigator.standalone || (matchMedia && matchMedia('(display-mode: standalone)').matches)),
      touch: ('ontouchstart' in window) || navigator.maxTouchPoints > 0,
      lang: (window.I18N && window.I18N.lang) || '', browserLang: navigator.language || '',
      where: document.documentElement.dataset.screen || (inPlay ? 'run' : 'menu'),
      inRun: inPlay,
      tier: run ? run.tier : '', tierUnlocked: M && M.tiers ? M.tiers().max : '',
      round: run ? run.round : '', side: run ? run.side : '',
      opening: debut ? debut.id : '', gold: run ? run.gold : '',
      relics: run && run.relics ? run.relics.map(r => r.id).join(',') : '',
      bestRound: +ls.get('chessrl-best-round') || 0,
      host: location.host
    };
  }
  const deviceText = d => Object.keys(d).map(k => k + ': ' + d[k]).join('\n');

  function sheetHtml() {
    return '<div class="sheet-box panel fb-box">' +
      '<div class="sheet-head"><h2 id="fb-title" class="sheet-title" data-i18n="fb.title"></h2><button class="btn btn-icon btn-close" data-close="sheet-fb" data-i18n-attr="aria-label:g.close">✕</button></div>' +
      '<div id="fb-body"></div></div>';
  }
  function formHtml(v) {
    v = v || {};
    const stars = [1, 2, 3, 4, 5].map(n => '<button type="button" class="fb-star' + (n <= st.rating ? ' on' : '') + '" role="radio" aria-checked="' + (n === st.rating) + '" data-star="' + n + '" aria-label="' + esc(tx('fb.star', { n })) + '"><span aria-hidden="true">★</span></button>').join('');
    const err = k => st.errs[k] ? '<p class="fb-err" role="alert">' + esc(st.errs[k]) + '</p>' : '';
    return '<form id="fb-form" novalidate>' +
      '<p class="fb-sub">' + esc(tx('fb.sub')) + '</p>' +
      '<div class="fb-field"><span class="fb-lbl" id="fb-rate-l">' + esc(tx('fb.rating')) + '</span><div class="fb-stars" role="radiogroup" aria-labelledby="fb-rate-l">' + stars + '</div></div>' +
      '<label class="fb-field"><span class="fb-lbl">' + esc(tx('fb.liked')) + '</span><textarea name="liked" rows="3" maxlength="2000" placeholder="' + esc(tx('fb.likedPh')) + '">' + esc(v.liked) + '</textarea></label>' +
      '<label class="fb-field"><span class="fb-lbl">' + esc(tx('fb.broke')) + '</span><textarea name="broke" rows="3" maxlength="2000" placeholder="' + esc(tx('fb.brokePh')) + '">' + esc(v.broke) + '</textarea></label>' +
      err('empty') +
      '<label class="fb-field"><span class="fb-lbl">' + esc(tx('fb.contact')) + ' <small>' + esc(tx('fb.contactSub')) + '</small></span><input name="contact" type="text" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" maxlength="120" placeholder="' + esc(tx('fb.contactPh')) + '" value="' + esc(v.contact) + '"></label>' +
      err('contact') +
      '<input class="fb-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<details class="fb-dev"><summary>' + esc(tx('fb.device')) + '</summary><p>' + esc(tx('fb.deviceSub')) + '</p><pre>' + esc(deviceText(device())) + '</pre></details>' +
      '<div class="fb-actions"><button type="submit" class="btn btn-green btn-big fb-send"' + (st.busy ? ' disabled' : '') + '>' + esc(st.busy ? tx('fb.sending') : tx('fb.send')) + '</button></div>' +
      (st.result === 'failed' ? '<p class="fb-err" role="alert">' + esc(tx('fb.failed')) + ' <a class="fb-mail" href="' + esc(mailtoHref(v)) + '">' + esc(tx('fb.mail')) + '</a></p>' : '') +
      '<p class="fb-alt">' + esc(tx('fb.orMail')) + ' <a class="fb-mail" href="' + esc(mailtoHref(v)) + '">' + esc(FB.mailto || '') + '</a></p>' +
      '</form>';
  }
  function doneHtml(kind) {
    return '<div class="fb-done" role="status"><div class="fb-done-ico">' + (window.PIX ? window.PIX.img(kind === 'sent' ? 'check' : 'chat', 'i48') : '') + '</div>' +
      '<h3>' + esc(tx(kind === 'sent' ? 'fb.okT' : 'fb.queuedT')) + '</h3><p>' + esc(tx(kind === 'sent' ? 'fb.ok' : 'fb.queued')) + '</p>' +
      (kind === 'queued' ? '<p class="fb-alt"><a class="fb-mail" href="' + esc(mailtoHref(st.lastValues || {})) + '">' + esc(tx('fb.mail')) + '</a></p>' : '') +
      '<button type="button" class="btn btn-blue fb-close" data-autofocus>' + esc(tx('g.close')) + '</button></div>';
  }
  function values() {
    const f = $('fb-form'); if (!f) return jget(DRAFT_KEY, {});
    return { liked: f.liked.value.trim(), broke: f.broke.value.trim(), contact: f.contact.value.trim(), hp: f.website.value };
  }
  function render(v) {
    $('fb-body').innerHTML = st.result === 'sent' || st.result === 'queued' ? doneHtml(st.result) : formHtml(v || values());
  }
  function validate(v) {
    const e = {};
    if (!st.rating && v.liked.length < 2 && v.broke.length < 2) e.empty = tx('fb.errEmpty');
    if (v.contact && !(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.contact) || /^@?[A-Za-z0-9_]{1,15}$/.test(v.contact))) e.contact = tx('fb.errContact');
    return e;
  }
  function payload(v) {
    const d = device(), isMail = /@.+\./.test(v.contact);
    const p = {
      accessKey: FB.accessKey,
      subject: 'Pawnbreaker feedback ' + (st.rating ? '★' + st.rating : '★–') + ' · ' + CFG.versionLabel + ' · ' + d.lang + (d.round ? ' · R' + d.round : ''),
      from_name: 'Pawnbreaker ' + CFG.versionLabel,
      rating: st.rating ? st.rating + '/5' : '—',
      liked: v.liked || '—', broke: v.broke || '—', contact: v.contact || '—',
      opened_from: st.from,
      device: deviceText(d),
      session_events: sessionSummary(60),
      analytics_totals: totalsSummary() || '—',
      analytics: isOff() ? 'off' : PBA.provider,
      submitted_at: new Date().toISOString(),
      fid: Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
    };
    if (isMail) p.email = v.contact;
    return p;
  }
  function mailtoHref(v) {
    const d = device();
    const body = ['Rating: ' + (st.rating ? st.rating + '/5' : '—'), '', 'Liked:', (v && v.liked) || '', '', 'Broke / confusing:', (v && v.broke) || '', '', 'Contact: ' + ((v && v.contact) || ''), '', '---', deviceText(d)].join('\n');
    return 'mailto:' + (FB.mailto || '') + '?subject=' + encodeURIComponent('Pawnbreaker feedback · ' + CFG.versionLabel) + '&body=' + encodeURIComponent(body.slice(0, 1800));
  }
  // 'sent' | 'retry' (network, timeout, 429, 5xx) | 'failed' (rejected)
  async function post(p) {
    if (!FB.endpoint || !FB.accessKey) return 'failed';
    if (navigator.onLine === false) return 'retry';
    const ctl = window.AbortController ? new AbortController() : null, timer = ctl ? setTimeout(() => ctl.abort(), 15000) : 0;
    try {
      const r = await fetch(FB.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(p), signal: ctl ? ctl.signal : undefined });
      let j = null; try { j = await r.json(); } catch (e) { /* non-JSON */ }
      if (r.ok && (!j || j.success !== false)) return 'sent';
      if (r.status === 429 || r.status >= 500) return 'retry';
      if (DEBUG) console.warn('[feedback] rejected', r.status, j);
      return 'failed';
    } catch (e) { return 'retry'; } finally { if (timer) clearTimeout(timer); }
  }
  const queue = () => { const q = jget(Q_KEY, []); return Array.isArray(q) ? q : []; };
  function enqueue(p) { const q = queue(); p.queued = 'yes'; q.push(p); ls.set(Q_KEY, JSON.stringify(q.slice(-10))); }
  let flushing = false, lastFlush = 0;
  async function flush(force) {
    if (flushing || (!force && Date.now() - lastFlush < 30000)) return 0;
    const q = queue(); if (!q.length) return 0;
    flushing = true; lastFlush = Date.now(); let sent = 0;
    const keep = [];
    for (const p of q) {
      const r = await post(p);
      if (r === 'sent') sent++; else if (r === 'retry') keep.push(p); /* 'failed' = rejected for good: drop it */
    }
    if (keep.length) ls.set(Q_KEY, JSON.stringify(keep)); else ls.del(Q_KEY);
    flushing = false;
    if (sent) { track('feedback_sent', { queued: 1, n: sent }); if (window.Game && window.Game.toast) window.Game.toast(tx('fb.flushed')); }
    return sent;
  }
  async function submit(e) {
    e.preventDefault(); if (st.busy) return;
    const v = values(); st.errs = validate(v);
    if (Object.keys(st.errs).length) { render(v); const el = $('fb-body').querySelector('.fb-err'); if (el) el.scrollIntoView({ block: 'nearest' }); if (window.FX) window.FX.sfx('illegal'); return; }
    st.lastValues = v;
    if (v.hp) { st.result = 'sent'; render(v); return; } // honeypot: pretend success, send nothing
    st.busy = true; render(v);
    const p = payload(v), r = await post(p);
    st.busy = false;
    if (r === 'sent') { st.result = 'sent'; ls.del(DRAFT_KEY); track('feedback_sent', { rating: st.rating, from: st.from }); if (window.FX) window.FX.sfx('coin'); }
    else if (r === 'retry') { enqueue(p); st.result = 'queued'; ls.del(DRAFT_KEY); track('feedback_queued', { rating: st.rating }); }
    else { st.result = 'failed'; track('feedback_failed'); }
    render(v);
    const f = $('fb-body').querySelector('[data-autofocus], .fb-send'); if (f) f.focus({ preventScroll: true });
  }
  function open(from) {
    st.from = from || 'menu'; st.result = null; st.errs = {}; st.busy = false;
    const d = jget(DRAFT_KEY, {}); st.rating = d.rating | 0;
    render({ liked: d.liked || '', broke: d.broke || '', contact: d.contact || ls.get('pb-fb-contact') || '' });
    track('feedback_open', { from: st.from });
    window.Meta.push('sheet-fb');
    flush(true);
  }
  function saveDraft() { const v = values(); ls.set(DRAFT_KEY, JSON.stringify({ liked: v.liked, broke: v.broke, contact: v.contact, rating: st.rating })); if (v.contact && !validate(v).contact) ls.set('pb-fb-contact', v.contact); }

  function init() {
    // the sheet lives after every other layer so it stacks above pause / settings
    const el = document.createElement('div');
    el.id = 'sheet-fb'; el.className = 'layer sheet hidden'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'fb-title');
    el.innerHTML = sheetHtml();
    const coach = $('coach'); document.body.insertBefore(el, coach || null);
    window.I18N.apply(el);
    const body = $('fb-body');
    body.addEventListener('submit', submit);
    body.addEventListener('click', e => {
      const s = e.target.closest('[data-star]');
      if (s) { st.rating = +s.dataset.star === st.rating ? 0 : +s.dataset.star; if (st.errs.empty) delete st.errs.empty; const v = values(); render(v); saveDraft(); const b = body.querySelector('[data-star="' + (st.rating || s.dataset.star) + '"]'); if (b) b.focus({ preventScroll: true }); if (window.FX) window.FX.sfx('click'); return; }
      if (e.target.closest('.fb-close')) { window.Meta.pop('sheet-fb'); return; }
      if (e.target.closest('.fb-mail')) track('feedback_mailto');
    });
    body.addEventListener('keydown', e => { // arrows move the star rating like a radio group
      const s = e.target.closest('[data-star]'); if (!s || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
      e.preventDefault(); const n = Math.max(1, Math.min(5, +s.dataset.star + (e.key === 'ArrowRight' ? 1 : -1))); st.rating = n; render(values()); saveDraft(); body.querySelector('[data-star="' + n + '"]').focus();
    });
    body.addEventListener('input', () => { saveDraft(); });
    // every [data-fb] button anywhere opens the form (menu chip, pause, settings, run-over screen)
    document.addEventListener('click', e => { const b = e.target.closest('[data-fb]'); if (b) { e.preventDefault(); open(b.dataset.fb); } });
    addEventListener('langchange', () => { window.I18N.apply(el); if (!el.classList.contains('hidden')) render(); });
    // menu chip: collapse to icon-only when its label would crowd the centred logo (long labels on narrow phones)
    const fitChip = () => { const c = $('m-fb'); if (!c || !c.offsetParent) return; c.classList.remove('icon-only');
      const ico = document.querySelector('.logo-ico'), r = c.getBoundingClientRect(), ir = ico && ico.getBoundingClientRect();
      if (r.right > (ir && ir.width ? ir.left - 8 : innerWidth / 2 - 48)) c.classList.add('icon-only'); };
    addEventListener('langchange', () => requestAnimationFrame(fitChip)); addEventListener('resize', fitChip);
    setTimeout(fitChip, 0); setTimeout(fitChip, 900);
    addEventListener('online', () => flush(true));
    setTimeout(() => flush(true), 4000);
    track('session_start', { lang: window.I18N && window.I18N.lang, standalone: (navigator.standalone || (matchMedia && matchMedia('(display-mode: standalone)').matches)) ? 1 : 0, vw: innerWidth, returning: (+ls.get('chessrl-best-round') || 0) > 0 ? 1 : 0 });
  }
  window.Feedback = { open, flush, device, queue, get state() { return st; }, payload: v => payload(v || { liked: '', broke: '', contact: '' }), post };
  init();
})();
