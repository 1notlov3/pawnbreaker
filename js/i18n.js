// i18n: string tables per language (js/lang/*.js call I18N.add), {placeholders}, plurals via Intl.PluralRules.
// A value can be a string, an array (pools of bot lines) or a plural object {one, few, many, other}.
// Only the active language (+ English as the fallback) is downloaded: init() loads them and resolves I18N.ready;
// setLang() fetches a new table on demand and switches once it has arrived. English is the reference key set.
(function () {
  'use strict';
  // js/lang/<code>.js lives next to this file; reuse this script's ?v= cache-buster for the tables
  const SELF = document.currentScript && document.currentScript.src ? new URL(document.currentScript.src, location.href) : null;
  const BASE = SELF ? new URL('lang/', SELF).href : 'js/lang/', QS = SELF ? SELF.search : '';
  const LANGS = [
    { code: 'en', name: 'English' }, { code: 'ru', name: 'Русский' }, { code: 'es', name: 'Español' }, { code: 'pt-BR', name: 'Português (BR)' },
    { code: 'de', name: 'Deutsch' }, { code: 'fr', name: 'Français' }, { code: 'zh-Hans', name: '简体中文' }, { code: 'ja', name: '日本語' },
    { code: 'ko', name: '한국어' }, { code: 'tr', name: 'Türkçe' }
  ];
  const SPEECH = { en: 'en-US', ru: 'ru-RU', es: 'es-ES', 'pt-BR': 'pt-BR', de: 'de-DE', fr: 'fr-FR', 'zh-Hans': 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', tr: 'tr-TR' };
  const KEY = 'chessrl-lang', T = {}, missing = [];
  let lang = 'en', pr = null, ready = false, want = null;
  const loading = {};
  const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } } };

  function add(code, table) { T[code] = Object.assign(T[code] || {}, table); }
  function has(code) { return LANGS.some(l => l.code === code); }
  function detect() {
    const saved = store.get(KEY); if (saved && has(saved)) return saved;
    const list = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en']).map(s => String(s).toLowerCase());
    for (const l of list) {
      if (l.startsWith('zh')) return 'zh-Hans'; // traditional readers still get Simplified; better than English
      if (l.startsWith('pt')) return 'pt-BR';
      const hit = LANGS.find(x => x.code.toLowerCase() === l || x.code.toLowerCase() === l.split('-')[0]);
      if (hit) return hit.code;
    }
    return 'en';
  }
  function miss(key) {
    if (missing.indexOf(lang + ':' + key) === -1) { missing.push(lang + ':' + key); console.warn('[i18n] missing ' + lang + ': ' + key); }
  }
  function raw(key) {
    if (!ready) console.warn('[i18n] t() before tables loaded: ' + key);
    const t = T[lang]; let v = t ? t[key] : undefined;
    if (v === undefined) { miss(key); v = T.en && T.en[key]; }
    return v;
  }
  // is this a real string key? (English holds the full key set; used to tell keys from raw values)
  function known(key) { return !!((T.en && T.en[key] !== undefined) || (T[lang] && T[lang][key] !== undefined)); }
  // download js/lang/<code>.js once; resolves true when its table is in, false on a network error
  function load(code) {
    if (T[code]) return Promise.resolve(true);
    if (loading[code]) return loading[code];
    return (loading[code] = new Promise(res => {
      const s = document.createElement('script');
      s.src = BASE + code + '.js' + QS; s.async = true;
      s.onload = () => res(!!T[code]);
      s.onerror = () => { delete loading[code]; s.remove(); console.warn('[i18n] could not load ' + code); res(false); };
      document.head.appendChild(s);
    }));
  }
  function fmt(s, p) {
    return p ? s.replace(/\{(\w+)\}/g, (m, k) => (p[k] === undefined || p[k] === null ? m : p[k])) : s;
  }
  function t(key, p) {
    let v = raw(key);
    if (v === undefined) return key;
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') { const n = p && typeof p.n === 'number' ? p.n : 0; v = v[pr.select(n)] || v.other; }
    return fmt(String(v), p);
  }
  // DOM: data-i18n="key" → textContent, data-i18n-html="key" → innerHTML, data-i18n-attr="title:key;aria-label:key"
  function apply(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
    root.querySelectorAll('[data-i18n-attr]').forEach(el => el.dataset.i18nAttr.split(';').forEach(pair => { const [a, k] = pair.split(':'); if (a && k) el.setAttribute(a.trim(), t(k.trim())); }));
    if (root === document) {
      document.title = t('meta.title');
      const d = document.querySelector('meta[name="description"]'); if (d) d.setAttribute('content', t('meta.desc'));
    }
  }
  // switch language; if its table is not downloaded yet, fetch it first (returns a promise either way)
  function setLang(code, opts) {
    if (!has(code)) code = 'en';
    want = code;
    if (!T[code]) return load(code).then(ok => { if (want !== code) return; if (ok) apply1(code, opts); else if (!T[lang]) apply1('en', opts); });
    apply1(code, opts); return Promise.resolve();
  }
  function apply1(code, opts) {
    lang = code; pr = new Intl.PluralRules(code);
    document.documentElement.lang = code;
    document.documentElement.dataset.script = /^(zh|ja|ko)/.test(code) ? 'cjk' : 'latin';
    if (!(opts && opts.noSave)) store.set(KEY, code);
    apply(document);
    if (!(opts && opts.silent)) window.dispatchEvent(new CustomEvent('langchange', { detail: code }));
  }
  let readyP = null;
  function init() {
    if (readyP) return readyP;
    const code = detect();
    readyP = Promise.all([load('en'), code === 'en' ? true : load(code)])
      .then(() => { ready = true; return setLang(T[code] ? code : 'en', { noSave: true, silent: true }); });
    return readyP;
  }
  window.I18N = {
    LANGS, add, t, apply, setLang, init, detect, missing, tables: T, known, load,
    get ready() { return init(); },
    get lang() { return lang; }, get speech() { return SPEECH[lang] || 'en-US'; },
    get langName() { return (LANGS.find(l => l.code === lang) || LANGS[0]).name; },
    // number of keys present in a table (tests)
    keys: code => Object.keys(T[code] || {})
  };
  window.tx = t;
})();
