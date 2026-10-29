// i18n: string tables per language (js/lang/*.js call I18N.add), {placeholders}, plurals via Intl.PluralRules.
// A value can be a string, an array (pools of bot lines) or a plural object {one, few, many, other}.
(function () {
  'use strict';
  const LANGS = [
    { code: 'en', name: 'English' }, { code: 'ru', name: 'Русский' }, { code: 'es', name: 'Español' }, { code: 'pt-BR', name: 'Português (BR)' },
    { code: 'de', name: 'Deutsch' }, { code: 'fr', name: 'Français' }, { code: 'zh-Hans', name: '简体中文' }, { code: 'ja', name: '日本語' },
    { code: 'ko', name: '한국어' }, { code: 'tr', name: 'Türkçe' }
  ];
  const SPEECH = { en: 'en-US', ru: 'ru-RU', es: 'es-ES', 'pt-BR': 'pt-BR', de: 'de-DE', fr: 'fr-FR', 'zh-Hans': 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', tr: 'tr-TR' };
  const KEY = 'chessrl-lang', T = {}, missing = [];
  let lang = 'en', pr = null;
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
    const t = T[lang]; let v = t ? t[key] : undefined;
    if (v === undefined) { miss(key); v = T.en && T.en[key]; if (v === undefined) v = T.ru && T.ru[key]; }
    return v;
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
  function setLang(code, opts) {
    if (!has(code)) code = 'en';
    lang = code; pr = new Intl.PluralRules(code);
    document.documentElement.lang = code;
    document.documentElement.dataset.script = /^(zh|ja|ko)/.test(code) ? 'cjk' : 'latin';
    if (!(opts && opts.noSave)) store.set(KEY, code);
    apply(document);
    if (!(opts && opts.silent)) window.dispatchEvent(new CustomEvent('langchange', { detail: code }));
  }
  function init() { setLang(detect(), { noSave: true, silent: true }); }
  window.I18N = {
    LANGS, add, t, apply, setLang, init, detect, missing, tables: T,
    get lang() { return lang; }, get speech() { return SPEECH[lang] || 'en-US'; },
    get langName() { return (LANGS.find(l => l.code === lang) || LANGS[0]).name; },
    // number of keys present in a table (tests)
    keys: code => Object.keys(T[code] || {})
  };
  window.tx = t;
})();
