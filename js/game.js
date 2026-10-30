// Run loop, board UI, Balatro-style shop, relics, enhancements. Gold is the only currency: captures earn it, losses cost it.
(function () {
  'use strict';
  const R = window.Rules;
  const $ = id => document.getElementById(id);
  const PX = (n, c) => window.PIX.img(n, c);
  const COIN = () => PX('coin', 'i16 coin');
  const CAP = { p: 1, n: 2, b: 2, r: 3, q: 4, k: 0 };  // gold for each bot piece you take
  const LOSS = { p: 1, n: 2, b: 2, r: 3, q: 5, k: 0 }; // gold you pay when the bot takes yours
  const PN = t => tx('piece.' + t); // piece name, nominative («Knight g1»)
  const why = r => (window.I18N.tables.ru && window.I18N.tables.ru['reason.' + r] !== undefined ? tx('reason.' + r) : r);
  const START = R.initialState().board;
  let run, game, cg = null;
  const rand = a => a[Math.floor(Math.random() * a.length)];
  // Fisher–Yates (card-game skill: sort-with-random-comparator is biased)
  const shuffle = a => { const o = a.slice(); for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = o[i]; o[i] = o[j]; o[j] = t; } return o; };
  const META = () => window.Meta;
  let shownGold = 0, pendingGold = 0, inPlayFlag = false; // HUD gold lags behind run.gold until flying coins land (event-driven HUD)

  // ---------- t32: side choice ----------
  // Internally the player is ALWAYS the uppercase side on rows 6–7 with the normal start array; playing Black just
  // means the internal game starts with the bot (lowercase = real White) to move. Chess is symmetric under
  // colour swap + rank flip, so the rules, relics, Stockfish (internal FEN) and saves need no changes —
  // only what the player sees is mapped: real FEN (rows reversed, case swapped), board orientation, square names.
  const BLK = () => !!(run && run.side === 'b');
  const PC = () => (BLK() ? 'b' : 'w'); // cburnett piece-art prefix for the player's own pieces
  const SQN = i => (BLK() ? 'abcdefgh'[i & 7] + ((i >> 3) + 1) : R.sqName(i));
  const SQI = k => (BLK() ? (parseInt(k[1], 10) - 1) * 8 + (k.charCodeAt(0) - 97) : R.sqIndex(k));
  const scrCol = i => (BLK() ? 7 - (i & 7) : (i & 7)); // screen column of an internal square (row is unchanged)
  const swapCase = p => (p === p.toUpperCase() ? p.toLowerCase() : p.toUpperCase());
  // real-coordinates FEN of an internal state (for chess.js SAN)
  function realFEN(s) {
    if (!BLK()) return R.toFEN(s);
    const f = R.toFEN(s).split(' '), rows = f[0].split('/').reverse().map(r => r.replace(/[a-zA-Z]/g, swapCase));
    const c = f[2] === '-' ? '-' : f[2].split('').map(swapCase).sort((a, b) => 'KQkq'.indexOf(a) - 'KQkq'.indexOf(b)).join('');
    return rows.join('/') + ' ' + (f[1] === 'w' ? 'b' : 'w') + ' ' + c + ' ' + (s.ep != null ? SQN(s.ep) : '-') + ' ' + f[4] + ' ' + Math.max(1, s.full - (s.turn === 'w' ? 1 : 0));
  }
  // ---------- t32: generic relic hooks (relics.js: cap / move / loss / start / win) ----------
  const trig = id => { (window.__trig = window.__trig || []).push(id); };
  // every owned relic with this hook, with its copy count (Mirror adds one) and its run record (for growing relics)
  function hooked(name) {
    const u = game ? game.ctx.up : ups(), out = [];
    Object.keys(u).forEach(id => { const d = window.RELIC(id); if (d && d[name] && u[id] > 0) out.push([d, u[id], run.relics.find(r => r.id === id) || {}]); });
    return out;
  }
  const botLeft = b => b.filter(p => p && R.colorOf(p) === 'b').length;
  const myLeft = b => b.filter(p => p && R.colorOf(p) === 'w').length;
  const yourTurn = () => tx(BLK() ? 'g.yourTurnB' : 'g.yourTurn');
  const tierN = () => (run && run.tier) || 1;
  const TM = () => window.tierMods(tierN());

  // ---------- run state ----------
  const AN = (n, p) => { if (window.PBA) window.PBA.track(n, p); };
  let shopBuys = 0;
  function newRun(opt) {
    opt = opt || {};
    const side = opt.side === 'b' || opt.side === 'w' ? opt.side : 'w', tier = Math.max(1, Math.min(8, opt.tier | 0 || 1));
    run = { side, tier, round: 1, gold: Math.max(0, 4 + window.tierMods(tier).startGold), earned: 0, fined: 0, wins: 0, relics: [], vouchers: [], enh: {}, items: { hints: 1, undo: 0, confuse: 0 }, next: {},
      openings: [], debuts: window.rollDebuts(side), sig: null, offer: null, sanctuarySq: null, treasureSq: null, voucher: null, shop: null, bought: [], lastPick: null, pack: null };
    pendingGold = 0; inPlayFlag = true;
    { let nRuns = 0; try { nRuns = +localStorage.getItem('pb-runs') || 0; localStorage.setItem('pb-runs', nRuns + 1); } catch (e) { /* storage blocked (3rd-party iframe) */ } AN('run_start', { tier, side, pick: window.__nrPick || side, n: nRuns + 1 }); }
    window.__nrPick = null;
    if (opt.autoPick) { run.sig = run.debuts[0]; startGame(); return; }
    run.startGold = run.gold;
    run.offer = { ids: window.rollOpeningOffer(side), free: 1, paid: 0, n: 0 };
    AN('opening_offer', { ids: run.offer.ids.join(','), side, n: 0 });
    showOpening(true);
  }

  // ---------- pre-run opening choice: 3 cards, 1 free reroll, then paid ones from the starting purse ----------
  // The picked card is the run's signature opening: debut 1 (and its boss) is built on it, and its line keeps paying
  // its book bonus in every later round too (the round's own line stays the bot's book; see doMove).
  const OP_RAR = new Proxy({}, { get: (_, id) => ((window.BOSS && window.BOSS(id)) || {}).rar || 'rare' });
  let opSel = -1, opBusy = false;
  // paid rerolls only exist when the run starts with gold; priced like the shop reroll ($3, +$1 each, tier modifier)
  const opRerollCost = () => Math.max(1, 3 + run.offer.paid + TM().reroll);
  const opCanPay = () => (run.startGold || 0) > 0;
  function opBoard(d, black) {
    const B = {}, back = 'RNBQKBNR';
    for (let f = 0; f < 8; f++) { const fl = 'abcdefgh'[f]; B[fl + '1'] = 'w' + back[f]; B[fl + '2'] = 'wP'; B[fl + '7'] = 'bP'; B[fl + '8'] = 'b' + back[f]; }
    d.line.forEach(u => { B[u.slice(2, 4)] = B[u.slice(0, 2)]; delete B[u.slice(0, 2)]; });
    const lm = d.line[d.line.length - 1], cells = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const f = black ? 7 - c : c, rk = black ? r + 1 : 8 - r, k = 'abcdefgh'[f] + rk, pc = B[k];
      cells.push('<i class="' + ((f + rk) % 2 ? 'l' : 'd') + (lm.indexOf(k) !== -1 ? ' lm' : '') + '">' + (pc ? '<img src="vendor/pieces/cburnett/' + pc + '.svg" alt="">' : '') + '</i>');
    }
    return '<span class="op-board" aria-hidden="true">' + cells.join('') + '</span>';
  }
  function opCard(id, i, anim) {
    const d = window.DEBUT(id), b = window.BOSSES.find(x => x.id === d.rule);
    return '<button class="card op-card r-' + OP_RAR[d.rule] + (i === opSel ? ' sel' : '') + '" data-k="' + i + '" style="--i:' + i + ';--tilt:' + ((i - 1) * 3) + 'deg"' + (anim ? '' : ' data-still="1"') +
      ' aria-label="' + d.name + ' — ' + window.debutLine(d) + ' — ' + tx('op.boss') + ': ' + b.rule + '">' +
      '<span class="card-in"><span class="cface"><span class="ctype">' + tx(d.side === 'b' ? 'op.typeB' : 'op.typeW') + '</span>' + opBoard(d, run.side === 'b') +
      '<span class="cname">' + d.name + '</span><span class="op-line">' + window.debutLine(d) + '</span>' +
      '<span class="op-bonus">' + PX('coin', 'i16') + tx('g.perMove', { a: 1, b: d.gold }) + '</span>' +
      '<span class="op-boss">' + PX('av-' + d.rule, 'i16') + '<span>' + b.rule + '</span></span><span class="sheen"></span></span></span></button>';
  }
  function opDetail() {
    const el = $('op-detail'), id = run.offer && run.offer.ids[opSel];
    if (!id) { el.innerHTML = '<p class="pd-hint">' + tx('op.tapCard') + '</p>'; return; }
    const d = window.DEBUT(id), b = window.BOSSES.find(x => x.id === d.rule);
    el.innerHTML = '<div class="pd-head">' + PX('debut', 'i21') + '<b>' + d.name + '</b><small>' + window.debutLine(d) + '</small></div>' +
      '<p class="pd-desc">' + tx('op.bossLine', { name: b.name, rule: b.rule }) + ' ' + b.desc + '</p>' +
      '<button class="btn btn-green pd-go" data-k="' + opSel + '">' + tx('op.play', { name: d.name }) + '</button>';
  }
  function opReroll() {
    const o = run.offer, el = $('op-reroll'); if (!o) return;
    const c = opRerollCost(), free = o.free > 0, can = free || (opCanPay() && run.gold >= c);
    el.disabled = !can || opBusy;
    el.innerHTML = PX('cards', 'i16') + '<span>' + (free ? tx('op.rerollFree') : !opCanPay() ? tx('op.noRerolls') : tx('op.rerollCost', { c })) + '</span>';
    el.classList.toggle('free', free);
    $('op-wallet').innerHTML = PX('coin', 'i16') + '<b>$' + run.gold + '</b>';
  }
  function showOpening(anim) {
    if (!run || !run.offer) return startGame();
    inPlayFlag = true; opBusy = false;
    if (META()) META().save(run, 'opening'); // reload shows the same three cards and the same reroll state
    ['screen-game', 'screen-shop', 'screen-over', 'pack'].forEach(id => $(id).classList.add('hidden'));
    $('hud').classList.add('hidden'); document.documentElement.dataset.screen = 'opening';
    if (window.FX) FX.theme('shop');
    const ov = $('opening'); ov.classList.remove('hidden');
    $('op-sub').textContent = tx('op.sub');
    $('op-cards').innerHTML = run.offer.ids.map((id, i) => opCard(id, i, anim)).join('');
    $('op-cards').classList.toggle('deal', !!anim);
    opDetail(); opReroll();
    if (anim) { window.FX.sfx('deal'); }
    if (ov.contains(document.activeElement) === false && document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); // modal: keep focus out of the hidden game
    if (META()) META().coach('opening');
  }
  function opSelect(i) {
    if (opBusy || !run.offer || !run.offer.ids[i]) return;
    if (opSel === i) return opPick(i);
    opSel = i; window.FX.sfx('select');
    $('op-cards').querySelectorAll('.card').forEach(c => c.classList.toggle('sel', +c.dataset.k === i));
    opDetail();
  }
  function opPick(i) {
    const o = run.offer, id = o && o.ids[i]; if (!id || opBusy) return;
    opBusy = true;
    const d = window.DEBUT(id);
    AN('opening_pick', { id, rule: d.rule, slot: i, offered: o.ids.join(','), rerolls: o.n, side: run.side, tier: run.tier });
    run.sig = id; run.debuts = window.rollDebuts(run.side, null, id); run.offer = null; opSel = -1;
    const cards = $('op-cards').querySelectorAll('.card');
    cards.forEach(c => c.classList.add(+c.dataset.k === i ? 'picked' : 'gone'));
    const el = cards[i]; window.FX.sfx('upgrade');
    if (el) window.FX.juice('medium', { at: (r => [r.left + r.width / 2, r.top + r.height / 2])(el.getBoundingClientRect()), colors: ['#eabc52', '#ffffff', '#9c70ed'], spread: 120 });
    setTimeout(() => {
      $('opening').classList.add('hidden'); opBusy = false;
      startGame();
      toast(PX('debut', 'i16') + ' ★ ' + d.name);
    }, window.FX.reduce ? 0 : 620);
  }
  function opDoReroll() {
    const o = run.offer; if (!o || opBusy) return;
    const free = o.free > 0, c = opRerollCost();
    if (!free && (!opCanPay() || run.gold < c)) return;
    if (free) o.free--; else { run.gold -= c; o.paid++; }
    o.n++;
    AN('opening_reroll', { free: free ? 1 : 0, cost: free ? 0 : c, n: o.n, gold: run.gold });
    o.ids = window.rollOpeningOffer(run.side, o.ids);
    AN('opening_offer', { ids: o.ids.join(','), side: run.side, n: o.n });
    opSel = -1; window.FX.sfx('reroll');
    if (!free) window.FX.num($('op-wallet').querySelector('b') || $('op-wallet'), run.gold);
    showOpening(true);
  }
  // owned(): real copies (shop / stacking). ups(): effective copies — the Mirror counts as one more copy of the relic to its right.
  const owned = () => { const u = {}; run.relics.forEach(r => { u[r.id] = (u[r.id] || 0) + 1; }); return u; };
  // v0.4: the Echo is a left-handed Mirror (copies the relic to its LEFT); neither copies a Mirror or an Echo.
  const COPY = { mirror: 1, echo: -1 };
  const copyOf = i => { const r = run.relics[i], c = r && COPY[r.id], t = c && run.relics[i + c]; return t && !COPY[t.id] ? t : null; };
  const ups = () => { const u = owned(); run.relics.forEach((r, i) => { const t = copyOf(i); if (t) u[t.id] = (u[t.id] || 0) + 1; }); delete u.mirror; delete u.echo; return u; };
  const hasV = id => run.vouchers.indexOf(id) !== -1;
  const slotsMax = () => 5 + (hasV('slot') ? 1 : 0) + (hasV('slot2') ? 1 : 0);
  // Debuts: rounds 1–3 = debut 1, 4–6 = debut 2, 7–9 = debut 3. The 3rd round of each debut is its boss.
  const debutNo = round => Math.min(3, Math.ceil(round / 3));
  const debutFor = round => { if (!run.debuts || run.debuts.length !== 3) run.debuts = window.rollDebuts(run.side || 'w'); return window.DEBUT(run.debuts[debutNo(round) - 1]); };
  const bossFor = round => {
    if (round % 3 !== 0) return null;
    const d = debutFor(round), rule = window.BOSSES.find(b => b.id === d.rule);
    return Object.assign({}, rule, { get name() { return tx('g.bossName', { name: d.name }); }, persona: rule.name, debut: d });
  };
  const lastRound = () => run.round >= window.RUN_ROUNDS;
  const chapter = round => debutNo(round); // vouchers refresh once per debut (save field stays `voucher.ante` for compatibility)
  const price = p => (hasV('discount') ? Math.max(1, Math.round(p * 0.75)) : p);
  const sellValue = def => (owned().pawnshop ? def.price : Math.max(1, Math.floor(def.price / 2))) + (hasV('sellPlus') ? 1 : 0) + 2 * (owned().fence || 0);
  const packPrice = d => Math.max(1, price(d.price) - (owned().chestKey ? 1 : 0));
  const relicPrice = def => Math.max(1, price(def.price) - (owned().haggler ? 1 : 0));

  // Minefield boss: 2 mines on your half (internal rows 4–5) mirrored onto the bot's half, never on a square the
  // round's book line (or the signature line) touches, never two on one file.
  function layMines(d) {
    const book = new Set();
    [d, run.sig && window.DEBUT(run.sig)].forEach(x => { if (x) x.line.forEach(u => { book.add(SQI(u.slice(0, 2))); book.add(SQI(u.slice(2, 4))); }); });
    const ok = shuffle([32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47]).filter(i => !book.has(i) && !book.has((7 - (i >> 3)) * 8 + (i & 7)));
    const out = [], files = new Set();
    for (const i of ok) { if (files.has(i & 7)) continue; files.add(i & 7); out.push(i, (7 - (i >> 3)) * 8 + (i & 7)); if (out.length >= 4) break; }
    return out;
  }
  function startGame() {
    inPlayFlag = true; run.pack = null;
    if (META()) META().save(run, 'game'); // safe boundary: round start, before hints/next-round flags are consumed
    const boss = bossFor(run.round), u = ups();
    const ctx = { variant: boss ? boss.id : 'normal', up: u, steel: [],
      sanctuary: u.sanctuary ? run.sanctuarySq : null, treasure: u.treasure ? run.treasureSq : null };
    const state = R.initialState();
    const minors = shuffle([1, 2, 5, 6]);
    for (let i = 0; i < Math.min(3, u.handicap || 0); i++) state.board[minors[i]] = null;
    shuffle([0, 7]).slice(0, Math.min(2, u.siege || 0)).forEach(i => { state.board[i] = null; state.castle[i === 0 ? 'q' : 'k'] = false; });
    if (run.next.confiscate) shuffle([8, 9, 10, 11, 12, 13, 14, 15]).slice(0, 2).forEach(i => { state.board[i] = null; });
    if (run.next.sabotage) { const mi = [1, 2, 5, 6].filter(i => state.board[i]); if (mi.length) { state.board[rand(mi)] = null; trig('sabotage'); } }
    const avoid = new Set(); [debutFor(run.round), run.sig && window.DEBUT(run.sig)].forEach(x => { if (x) x.line.forEach(v => { avoid.add(SQI(v.slice(0, 2))); avoid.add(SQI(v.slice(2, 4))); }); });
    Object.keys(u).forEach(id => { const d = window.RELIC(id); if (d && d.start && d.start({ state, ctx, boss, avoid })) trig(id); });
    if (hasV('hintsub')) run.items.hints++;
    if (hasV('seedMoney')) { run.gold++; run.earned++; trig('seedMoney'); }
    if (hasV('undoSub') && (run.round - 1) % 3 === 0) { run.items.undo++; trig('undoSub'); }
    if (boss) state.vx = R.initVx(boss.id, boss.id === 'mines' ? layMines(debutFor(run.round)) : null);
    const tags = {}; Object.keys(run.enh).forEach(sq => { tags[sq] = { id: run.enh[sq], used: false, home: +sq }; });
    shuffle([48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 61, 62, 63].filter(sq => !tags[sq])).slice(0, u.bastion || 0).forEach(sq => { tags[sq] = { id: 'steel', used: false, temp: true, home: sq }; });
    const doubleGold = !!run.next.doubleGold, goldRush = !!run.next.goldRush, shieldN = run.next.shield ? 2 : 0;
    run.next = {};
    game = { state, ctx, boss, legal: [], last: null, busy: false, undoUsed: false, history: [], log: [], over: false, exploded: [], botSource: '',
      san: [], debut: debutFor(run.round), alt: null, book: { ply: 0, ok: true, pay: 0 }, doubleGold, goldRush, shieldN, confuseNext: false, hintMove: null, tags,
      stats: { caps: 0, castled: false, myMoves: 0, lostW: 0, insUsed: 0, blitzUsed: 0, revenge: 0, leech: 0, mercy: 0, lastBy: '' },
      ledger: { capGold: 0, capN: 0, loss: 0, lossN: 0, saved: 0, rel: {}, open: 0 } };
    if (run.sig && run.sig !== game.debut.id && window.DEBUT(run.sig) && window.DEBUT(run.sig).side === (run.side || 'w')) game.alt = window.DEBUT(run.sig);
    syncSteel(); state.tags = engineTags();
    game.legal = R.legalMoves(state, ctx);
    show('screen-game');
    window.Talk.setPersona(boss ? boss.id : (run.round === 1 ? 'rookie' : 'grinder'));
    if (BLK()) state.turn = 'b'; // the bot (real White) opens
    if (BLK()) game.legal = R.legalMoves(state, ctx);
    AN('round_start', { round: run.round, opening: game.debut && game.debut.id, boss: boss ? boss.id : '', tier: run.tier, side: run.side, gold: run.gold, relics: run.relics.length });
    if (boss) showBossIntro(boss); else { setStatus(BLK() ? tx('g.botThinking') : yourTurn()); debutIntro(); window.FX.sfx('start'); }
    render();
    if (BLK() && !boss) setTimeout(() => botTurn(game), 600);
    if (!boss) { if (run.lastPick) window.Talk.say('upgrade', { name: run.lastPick }); else window.Talk.say('start'); }
    run.lastPick = null;
    fitBoard();
    if (META()) { META().coach('start'); META().coach('debut'); META().coach('tools'); if (run.relics.length) META().coach('relics'); }
  }
  // rule-changing enhancements the rules engine (and the bot's search) must know about; spent one-shots drop out
  function engineTags() {
    const t = {}; Object.keys(game.tags).forEach(k => { const g = game.tags[k], e = window.ENH[g.id]; if (e && e.move && !g.used) t[k] = { id: g.id, home: g.home }; });
    return t;
  }
  function syncSteel() { game.ctx.steel = Object.keys(game.tags).filter(k => game.tags[k].id === 'steel' && !game.tags[k].used).map(Number); }

  function show(id) {
    ['screen-game', 'screen-shop', 'screen-over'].forEach(s => { const el = $(s), on = s === id, was = !el.classList.contains('hidden'); el.classList.toggle('hidden', !on); if (on && !was) { el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); } });
    $('hud').classList.remove('hidden'); document.documentElement.dataset.screen = id.replace('screen-', '');
    clearTimeout(toast._t); $('toast').classList.add('hidden');
    if (window.FX) FX.theme(id === 'screen-shop' ? 'shop' : id === 'screen-over' ? 'over' : (game && game.boss ? 'boss' : 'game'));
    if (id === 'screen-game' && cg) setTimeout(() => cg.redrawAll(), 0);
  }
  function fitBoard() {
    if ($('screen-game').classList.contains('hidden')) return;
    const fr = $('board-frame'), before = fr.style.width;
    fr.style.width = '';
    const over = document.documentElement.scrollHeight - innerHeight;
    const w = over > 0 ? Math.max(240, fr.getBoundingClientRect().width - over) + 'px' : '';
    fr.style.width = w;
    if (cg && w !== before) cg.redrawAll();
  }
  function setStatus(t) { const el = $('status'); el.textContent = t; delete el.dataset.enh; }
  const BOSS_COLOR = new Proxy({}, { get: (_, id) => ((window.BOSS && window.BOSS(id)) || {}).color || '' });
  function hud(isBoss, label) {
    const r = $('hud-round'), t = tx('g.nOfM', { n: label || run.round, m: window.RUN_ROUNDS });
    if (r.textContent !== t) r.textContent = t;
    r.parentNode.classList.toggle('boss', !!isBoss);
    setGold();
  }
  // opening target strip: the book line, played moves lit, the next one of yours marked
  function renderGoal() {
    const el = $('open-goal'), d = game && game.debut; if (!el) return;
    if (!d) { el.classList.add('hidden'); return; }
    const bk = game.book, mult = game.ctx.up.debut ? 2 : 1;
    const moves = d.san.map((m, i) => {
      const st = i < bk.ply ? 'done' : !bk.ok ? 'off' : i === bk.ply ? (mineIdx(i) ? 'next' : 'bot') : '';
      return (i % 2 ? '' : '<span class="fm"><span class="mn">' + (i / 2 + 1) + '.</span>') + '<span class="gm ' + st + (i % 2 ? ' b' : ' w') + '">' + m + '</span>' + (i % 2 || i === d.san.length - 1 ? '</span>' : '');
    }).join('');
    const done = bk.ok && bk.ply > lastMine(d);
    const sigOn = run.sig && d.id === run.sig, alt = game.alt && bk.ok ? game.alt : null;
    const html = '<span class="og-ico">' + PX('debut', 'i16') + '</span><span class="og-name"><b>' + (sigOn ? '<i class="og-star" title="' + tx('op.sig') + '">★</i>' : '') + d.name + '</b><small>' + (alt ? '<i class="og-star">★</i>' + tx('op.alsoSig', { name: alt.name }) : tx('g.debutNofM', { n: debutNo(run.round), m: 3 }) + (sigOn ? ' · ' + tx('op.sig') : '')) + '</small></span><span class="og-line">' + moves + '</span>' +
      '<span class="og-pay' + (done ? ' got' : !bk.ok ? ' off' : '') + '">' + (done ? tx('g.done') : !bk.ok ? tx('g.offBook') : tx('g.perMove', { a: mult, b: d.gold * mult })) + '</span>';
    if (el.innerHTML !== html) el.innerHTML = html;
    el.classList.remove('hidden'); el.classList.toggle('missed', !bk.ok);
    // on narrow screens the line scrolls so the current full move is always the first one shown
    const line = el.querySelector('.og-line'), fm = line && line.children[Math.min(Math.floor(Math.min(bk.ply, d.san.length - 1) / 2), line.children.length - 1)];
    if (fm) { line.scrollLeft = 0; if (line.scrollWidth > line.clientWidth) line.scrollLeft = fm.offsetLeft - line.firstElementChild.offsetLeft; }
    if (line) line.classList.toggle('more', line.scrollLeft + line.clientWidth < line.scrollWidth - 2);
  }
  // the player's moves in a book line: even plies as White, odd plies as Black
  const mineIdx = i => (i % 2 === 0) === !BLK();
  const lastMine = d => { let k = 0; d.line.forEach((_, i) => { if (mineIdx(i)) k = i; }); return k; };
  function debutIntro() {
    const d = game.debut, n = debutNo(run.round);
    if (run.round % 3 === 1) toast(PX('debut', 'i16') + ' ' + tx('g.debutToast', { n, m: 3, name: d.name }));
    const el = $('open-goal'); if (el) { el.classList.remove('intro'); void el.offsetWidth; el.classList.add('intro'); }
  }
  // the bot (and the boss) answer from the book while you stay in it
  function bookMove() {
    const bk = game.book, d = game.debut; if (!d || !bk.ok || game.state.turn !== 'b') return null;
    const want = d.line[bk.ply]; if (!want) return null;
    return game.legal.find(m => SQN(m.from) + SQN(m.to) === want && !m.promo) || null;
  }
  function setGold() { const v = Math.max(0, run.gold - pendingGold); if (v !== shownGold || $('hud-gold').dataset.v == null) { shownGold = v; window.FX.num($('hud-gold'), v); } }
  // coins fly from a point to the gold counter; the counter ticks when the first coin lands
  function coinsIn(from, g, held) {
    if (!g) return;
    if (!held) pendingGold += g;
    window.FX.flyCoins(from, $('hud-gold'), Math.min(8, Math.max(2, g))).then(() => { pendingGold = Math.max(0, pendingGold - g); setGold(); window.FX.sfx('coin'); });
  }
  function coinsOut(to, n) { setGold(); window.FX.flyCoins($('hud-gold'), to, Math.min(8, Math.max(2, n)), { loss: true }); }
  function tool(btn, ico, lbl, n) {
    const html = '<span class="ico">' + ico + '</span><span class="lbl">' + lbl + '</span>' + (n == null ? '' : '<span class="cnt' + (n ? '' : ' zero') + '">' + n + '</span>');
    if (btn.innerHTML !== html) btn.innerHTML = html;
  }

  // ---------- relic visuals ----------
  function relicArt(def, cls) {
    return def.art ? '<img class="piece-art ' + (cls || '') + '" src="vendor/pieces/cburnett/' + def.art + '.svg" alt="">' : PX(def.icon, cls);
  }
  function relicBadge(r) { return r.id === 'stable' ? '$' + (r.n || 1) : ''; }
  function renderRelics(el, mode) {
    const max = slotsMax();
    let h = '<div class="rr-head"><span>' + tx('g.relics') + '</span><b>' + run.relics.length + '/' + max + '</b></div><div class="rr-tiles">';
    for (let i = 0; i < max; i++) {
      const r = run.relics[i];
      if (!r) { h += '<span class="rtile empty"></span>'; continue; }
      const d = window.RELIC(r.id), bd = relicBadge(r);
      h += '<button class="rtile r-' + d.rarity + '" data-i="' + i + '" data-mode="' + mode + '" aria-label="' + d.name + '">' + relicArt(d, 'i32') + (bd ? '<span class="rbadge">' + bd + '</span>' : '') + '</button>';
    }
    el.innerHTML = h + '</div>';
  }
  function pulseRelic(id) {
    window.FX.sfx('relic');
    document.querySelectorAll('#relics-game .rtile').forEach(t => { const r = run.relics[+t.dataset.i]; if (r && r.id === id) { t.classList.remove('jiggle'); void t.offsetWidth; t.classList.add('jiggle'); } });
  }

  // ---------- board ----------
  function visibleSet() {
    if (game.ctx.variant !== 'fog') return null;
    const vis = new Set(), s = game.state;
    if (game.ctx.up.scout) for (let i = 32; i < 64; i++) vis.add(i); // Scout: your half of the board is always visible
    s.board.forEach((p, i) => {
      if (p && R.colorOf(p) === 'w') {
        vis.add(i);
        if (game.ctx.up.lantern) for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const r = (i >> 3) + dr, c = (i & 7) + dc; if (r >= 0 && r < 8 && c >= 0 && c < 8) vis.add(r * 8 + c); }
      }
    });
    const asWhite = Object.assign(R.clone(s), { turn: 'w' });
    R.pseudoMoves(asWhite, game.ctx).forEach(m => { vis.add(m.to); if (m.capture != null) vis.add(m.capture); });
    return vis;
  }
  // Masked boss: every bot piece but the king is drawn as a pawn (the rules don't change, only what you see)
  const maskedSq = (s, i) => game && game.ctx.variant === 'masked' && !game.over && s.board[i] && R.colorOf(s.board[i]) === 'b' && s.board[i] !== 'k' && s.board[i] !== 'p';
  function boardFen(s, vis) {
    const rows = [], blk = BLK();
    for (let k = 0; k < 8; k++) {
      const r = blk ? 7 - k : k; let row = '', e = 0;
      for (let c = 0; c < 8; c++) { const i = r * 8 + c, p0 = s.board[i], p = maskedSq(s, i) ? 'p' : p0; if (!p || (vis && !vis.has(i))) e++; else { if (e) { row += e; e = 0; } row += blk ? swapCase(p) : p; } }
      rows.push(row + (e || ''));
    }
    return rows.join('/');
  }
  function playerDests() {
    const d = new Map();
    if (game.busy || game.over || game.state.turn !== 'w') return d;
    game.legal.forEach(m => { const f = SQN(m.from); if (!d.has(f)) d.set(f, []); d.get(f).push(SQN(m.to)); });
    return d;
  }
  const meCol = () => (BLK() ? 'black' : 'white'), botCol = () => (BLK() ? 'white' : 'black');
  function ensureBoard() {
    if (cg) { if (cg.state.orientation !== meCol()) cg.set({ orientation: meCol() }); return; }
    cg = window.Chessground($('board'), {
      orientation: meCol(), coordinates: true, autoCastle: true, animation: { enabled: true, duration: 220 },
      highlight: { lastMove: true, check: true },
      movable: { free: false, color: 'white', showDests: true, events: { after: onUserMove } },
      draggable: { enabled: true, showGhost: true }, premovable: { enabled: false }, drawable: { enabled: false },
      events: { select: onSelect }
    });
  }
  // live counter on the boss banner for the rules that count something
  function bossStat() {
    const X = game.state.vx, V = game.ctx.variant; if (!X) return '';
    if (V === 'threecheck') return tx('bs.checks', { a: X.checks.w, b: X.checks.b });
    if (V === 'hourglass') return tx('bs.movesLeft', { n: Math.max(0, R.HOURGLASS - X.wMoves) });
    if (V === 'hydra') return tx('bs.revives', { n: R.HYDRA - X.rev });
    if (V === 'mines') return tx('bs.mines', { n: X.mines.length });
    return '';
  }
  function render() {
    ensureBoard();
    const s = game.state, vis = visibleSet(), custom = new Map();
    if (vis) for (let i = 0; i < 64; i++) if (!vis.has(i)) custom.set(SQN(i), 'fog');
    const addCls = (i, c) => { const k = SQN(i); custom.set(k, custom.has(k) ? custom.get(k) + ' ' + c : c); };
    if (game.ctx.sanctuary != null) addCls(game.ctx.sanctuary, 'sanct');
    if (game.ctx.treasure != null) addCls(game.ctx.treasure, 'treas');
    Object.keys(game.tags).forEach(k => { const t = game.tags[k]; if (s.board[k]) addCls(+k, 'enh enh-' + t.id + (t.used ? ' used' : '')); });
    game.exploded.forEach(i => addCls(i, 'boom'));
    const X = s.vx, V = game.ctx.variant;
    if (X && V === 'mines') X.mines.forEach(i => addCls(i, 'mine'));
    if (V === 'hill') R.HILL.forEach(i => addCls(i, 'hill'));
    if (X && V === 'pillar') ['w', 'b'].forEach(c => { const i = X.last[c]; if (i != null && s.board[i] && R.colorOf(s.board[i]) === c && R.typeOf(s.board[i]) !== 'k' && s.turn === c) addCls(i, 'locked'); });
    if (V === 'masked') for (let i = 0; i < 64; i++) if (maskedSq(s, i)) addCls(i, 'masked');
    if (game.revived != null) addCls(game.revived, 'revived');
    const inChk = game.ctx.variant !== 'misere' && R.inCheck(s, s.turn, game.ctx);
    const kSq = R.kingSq(s.board, s.turn);
    const lm = game.last && (!vis || (vis.has(game.last.from) || vis.has(game.last.to))) ? [SQN(game.last.from), SQN(game.last.to)] : undefined;
    cg.set({ fen: boardFen(s, vis), turnColor: s.turn === 'w' ? meCol() : botCol(), lastMove: lm,
      check: inChk && kSq >= 0 && (!vis || vis.has(kSq)) ? (s.turn === 'w' ? meCol() : botCol()) : false,
      movable: { color: meCol(), dests: playerDests() }, highlight: { custom } });
    if (!lm) cg.set({ lastMove: undefined });
    hud(game.boss);
    const bb = $('boss-banner');
    if (game.boss) {
      bb.classList.remove('hidden'); bb.style.setProperty('--bc', BOSS_COLOR[game.boss.id] || '');
      const stat = bossStat();
      bb.innerHTML = '<span class="chipmini">' + PX('av-' + game.boss.id, 'i21') + '</span><div><b>' + game.boss.name + ' · ' + game.boss.rule + '</b><small>' + game.boss.desc + '</small></div>' + (stat ? '<em class="bb-stat">' + stat + '</em>' : '');
    } else bb.classList.add('hidden');
    renderRelics($('relics-game'), 'game');
    renderGoal();
    $('movelog').innerHTML = game.log.map((t, k) => (k % 2 === 0 ? '<span class="mn">' + (k / 2 + 1) + '.</span>' : '') + '<span class="mv">' + t + '</span>').join('');
    $('movelog').scrollLeft = 1e6;
    const myTurn = !game.busy && !game.over && game.state.turn === 'w';
    const undoN = (game.ctx.up.undo && !game.undoUsed ? 1 : 0) + run.items.undo;
    const ub = $('btn-undo'); tool(ub, PX('undo-w', 'i21'), tx('g.tUndo'), undoN); ub.disabled = !undoN || !game.history.length || !myTurn;
    const hb = $('btn-hint'); tool(hb, PX('bulb', 'i21'), tx('g.tHint'), run.items.hints); hb.disabled = !run.items.hints || !myTurn;
    const cb = $('btn-confuse'); tool(cb, PX('spiral-w', 'i21'), tx('g.tConfuse'), run.items.confuse); cb.disabled = !run.items.confuse || !myTurn || game.confuseNext;
    cb.classList.toggle('armed', game.confuseNext);
    if (game.hintMove && myTurn) cg.setAutoShapes([{ orig: SQN(game.hintMove.from), dest: SQN(game.hintMove.to), brush: 'green' }]);
    else cg.setAutoShapes([]);
  }
  function onSelect(key) {
    const i = SQI(key), p = game.state.board[i];
    if (game.busy || game.over || !p || R.colorOf(p) !== 'w') return;
    const t = game.tags[i];
    if (!game.legal.some(m => m.from === i)) window.FX.sfx('illegal'), setStatus(game.ctx.variant === 'misere' && game.legal.some(m => m.capture != null) ? tx('g.mustCapture') : game.ctx.variant === 'pillar' && game.state.vx && game.state.vx.last.w === i ? tx('bs.locked') : tx('g.cantMove'));
    else if (t) { const e = window.ENH[t.id]; setStatus(e.name + ': ' + e.desc + (t.used ? ' ' + tx('g.usedParen') : '')); $('status').dataset.enh = t.temp ? '' : t.home; }
    else setStatus(yourTurn());
  }
  function onUserMove(orig, dest) {
    const m = game.legal.find(x => x.from === SQI(orig) && x.to === SQI(dest));
    if (!m || game.busy || game.over) { if (!m && orig !== dest) window.FX.sfx('illegal'); render(); return; }
    playerMove(m);
  }
  function san(s, m) {
    try {
      const fen = realFEN(s);
      if (window.ChessJS && game.ctx.variant !== 'misere' && window.ChessJS.validateFen(fen).ok) {
        const c = new window.ChessJS.Chess(fen);
        const mv = c.move({ from: SQN(m.from), to: SQN(m.to), promotion: m.promo ? 'q' : undefined });
        if (mv) return mv.san;
      }
    } catch (e) { /* non-standard move (relic/variant) */ }
    return SQN(m.from) + (m.capture != null ? '×' : '–') + SQN(m.to) + '*';
  }

  function doMove(m) {
    const s = game.state, mover = s.board[m.from], white = s.turn === 'w', u = game.ctx.up, T = game.tags, T0 = Object.assign({}, game.tags);
    const res = R.applyMove(s, m, game.ctx);
    const vis0 = visibleSet();
    const sn = res.blocked != null ? SQN(m.from) + '⨯' + SQN(m.to) : san(s, m);
    game.san.push(sn);
    if (game.debut && game.book.ok) { // book tracking (both sides); a white book move pays
      const bk = game.book, mv = SQN(m.from) + SQN(m.to), fine = res.blocked == null;
      // the signature opening stays a live alternative while both lines agree; leaving the round's line for it switches the book
      if (game.alt && !(fine && game.alt.line[bk.ply] === mv)) game.alt = (game.debut.line[bk.ply] === mv && fine) ? null : game.alt;
      if (game.alt && game.debut.line[bk.ply] !== mv && game.alt.line[bk.ply] === mv && fine) { game.debut = game.alt; game.alt = null; }
      const want = game.debut.line[bk.ply];
      if (want && mv === want && fine) { if (white) bk.pay = bk.ply === lastMine(game.debut) ? 2 : 1; bk.ply++; }
      else if (want) { bk.ok = false; game.alt = null; }
    }
    const snShown = !white && game.ctx.variant === 'masked' && /^[QRBN]/.test(sn) ? '?' + sn.slice(1) : sn;
    game.log.push(!white && vis0 && !vis0.has(m.to) && !vis0.has(m.from) ? '??' : snShown);
    game.revived = res.revived ? res.revived.sq : null;
    if (res.mined) { toast(PX('g:bomb:R:x', 'i16') + ' ' + tx(white ? 'bs.mineYou' : 'bs.mineBot', { piece: tx('piece.' + R.typeOf(res.mined)) })); if (window.SND) window.SND.play('illegal'); AN('boss_rule', { boss: 'mines', who: white ? 'w' : 'b' }); }
    if (res.revived) { toast(PX('av-hydra', 'i16') + ' ' + tx('bs.revived', { piece: tx('piece.' + R.typeOf(res.revived.piece)), n: R.HYDRA - res.state.vx.rev })); AN('boss_rule', { boss: 'hydra', n: res.state.vx.rev }); }
    if (game.ctx.variant === 'threecheck' && res.state.vx && res.state.vx.checks[s.turn] !== (s.vx ? s.vx.checks[s.turn] : 0)) toast(PX('av-threecheck', 'i16') + ' ' + tx('bs.checks', { a: res.state.vx.checks.w, b: res.state.vx.checks.b }));
    if (game.ctx.variant === 'hourglass' && white && res.state.vx && [10, 5, 1].indexOf(R.HOURGLASS - res.state.vx.wMoves) !== -1) toast(PX('av-hourglass', 'i16') + ' ' + tx('bs.movesLeft', { n: R.HOURGLASS - res.state.vx.wMoves }));
    const tagFrom = T[m.from];
    let gain = 0;
    if (res.blocked != null) {
      if (T[res.blocked]) T[res.blocked].used = true;
      toast(PX('e-steel', 'i16') + ' ' + tx('g.steelToast'));
      window.FX.burstAt($('board-wrap'), { n: 16, colors: ['#dfe8ea', '#9fb2b8', '#ffffff'] });
    } else {
      const moving = T[m.from]; delete T[m.from];
      const mirT = res.mirrored ? T[res.mirrored.from] : null;
      if (m.capture != null) delete T[m.capture];
      if (moving) { T[m.to] = moving; if (m.retreat && moving.id === 'retreat') { moving.used = true; toast(PX('e-retreat', 'i16') + ' ' + tx('g.retreatToast')); } }
      if (mirT) {
        mirT.used = true; T[res.mirrored.to] = mirT;
        toast(PX('e-mirror', 'i16') + ' ' + tx('g.mirrorToast', { sq: SQN(res.mirrored.to) }));
        window.FX.burstAt($('board-wrap'), { n: 18, colors: ['#d6c2ff', '#9c70ed', '#ffffff'] });
      }
      if (m.castle && white) { const a = m.castle === 'K' ? 63 : 56, b = m.castle === 'K' ? 61 : 59; if (T[a]) { T[b] = T[a]; delete T[a]; } }
      res.exploded.forEach(i => delete T[i]);
    }
    const L = game.ledger, st = game.stats, pops = [];
    const relGold = (id, g) => { if (!g) return 0; L.rel[id] = (L.rel[id] || 0) + g; setTimeout(() => pulseRelic(id), 30); return g; };
    if (!white && res.mined && u.minesweeper && R.colorOf(res.mined) === 'b') { const g = relGold('minesweeper', 3 * u.minesweeper); run.gold += g; run.earned += g; trig('minesweeper'); pops.push([m.to, '+$' + g, 'plus']); }
    if (white) {
      st.myMoves++;
      if (m.castle) st.castled = true;
      const by = R.typeOf(mover), caps = res.captured.filter(p => R.colorOf(p) === 'b');
      caps.forEach(p => {
        let g = CAP[R.typeOf(p)];
        if (tagFrom && tagFrom.id === 'holo') g *= 2;
        if (u.glass) { g *= 1 + u.glass; pulseRelic('glass'); }
        if (u.midas) { g *= 1 + u.midas; pulseRelic('midas'); trig('midas'); }
        if (st.revenge) { g *= 3; st.revenge = 0; pulseRelic('revenge'); }
        L.capGold += g; L.capN++; st.caps++; gain += g;
        if (tagFrom && tagFrom.id === 'gold') { L.capGold += 2; gain += 2; }
        if (u.butcher) gain += relGold('butcher', u.butcher);
        // t32 hooks
        const ev = { by, victim: R.typeOf(p), m, k: st.caps, botLeft: botLeft(res.state.board), variant: game.ctx.variant, run, st };
        hooked('cap').forEach(([d, c, rec]) => { const g0 = d.cap(ev, rec); if (g0 > 0) { gain += relGold(d.id, g0 * c); trig(d.id); } else if (d.id === 'trophy' && ev.victim === 'q') trig(d.id); });
        if (tagFrom && tagFrom.id === 'leech') { st.leech++; trig('leech'); }
        if (tagFrom && tagFrom.id === 'lucky') { const g1 = 1 + (Math.random() < (window.__lucky != null ? window.__lucky : 0.25) ? 5 : 0); L.capGold += g1; gain += g1; trig('lucky'); }
        if (game.goldRush) { L.capGold += 1; gain += 1; trig('goldRush'); }
      });
      if (caps.length) {
        if (game.ctx.treasure === m.to) gain += relGold('treasure', 3 * u.treasure);
        if (by === 'q' && u.marauder) gain += relGold('marauder', 2 * u.marauder);
        if (by === 'n' && u.stable) {
          const sr = run.relics.find(r => r.id === 'stable'), n = sr.n || 1;
          gain += relGold('stable', n * u.stable);
          run.relics.forEach(r => { if (r.id === 'stable') r.n = (r.n || 1) + 1; });
        }
      }
      if (res.blocked == null) {
        st.lastBy = by;
        const nb = res.state.board, chk = R.inCheck(res.state, 'b', game.ctx);
        let disc = false;
        if (chk && m.to >= 0) { const b2 = nb.slice(); b2[m.to] = null; disc = R.inCheck(Object.assign({}, res.state, { board: b2 }), 'b', game.ctx); }
        const ev = { by, m, check: chk, discovered: disc, to: m.to, toRow: m.to >> 3, ply: st.myMoves, botLeft: botLeft(nb), st, run, variant: game.ctx.variant, board: nb, ctx: game.ctx, tags: res.state.tags };
        hooked('move').forEach(([d, c, rec]) => { const g0 = d.move(ev, rec); if (g0 > 0) { gain += relGold(d.id, g0 * c); trig(d.id); } });
      }
      if (gain) pops.push([m.to, '+$' + gain, 'plus']);
    } else {
      // the bot took (or blew up) some of your pieces → you pay, unless a relic / enhancement covers it
      const lost = [];
      for (let i = 0; i < 64; i++) { const p0 = s.board[i]; if (p0 && R.colorOf(p0) === 'w' && res.state.board[i] !== p0 && !(res.mirrored && i === res.mirrored.from && res.state.board[res.mirrored.to] === p0)) lost.push([i, R.typeOf(p0)]); }
      let pay = 0, bonus = 0;
      lost.forEach(([sq, t]) => {
        st.lostW++;
        const tag = T0[sq], base = LOSS[t] ? LOSS[t] + TM().lossPlus + (t === 'q' ? TM().queenLoss : 0) : 0;
        if (!base) return;
        let cost = base, why = '';
        if (t === 'q' && u.marauder) cost = 2;
        if (game.ctx.variant === 'misere') { cost = 0; why = 'misere'; if (u.jester) bonus += relGold('jester', u.jester); }
        else if (tag && tag.id === 'foil') { cost = 0; bonus += 2; L.foil = (L.foil || 0) + 2; why = 'foil'; }
        else if (game.boss && u.hunter) { cost = 0; why = 'hunter'; pulseRelic('hunter'); }
        else if (t === 'p' && u.martyr) { cost = 0; bonus += relGold('martyr', u.martyr); }
        else if (t === 'p' && u.phalanx) { cost = 0; why = 'phalanx'; pulseRelic('phalanx'); }
        else if (t === 'r' && u.castle && st.castled) { cost = 0; why = 'castle'; pulseRelic('castle'); }
        else if (u.debut && st.myMoves <= 8) { cost = 0; why = 'debut'; pulseRelic('debut'); }
        if (cost > 0) { // t32 hooks, enhancements, consumables, vouchers
          const kq = s.board.indexOf('K'), nearKing = kq >= 0 && sq !== kq && Math.abs((sq >> 3) - (kq >> 3)) <= 1 && Math.abs((sq & 7) - (kq & 7)) <= 1;
          const ev = { t, sq, by: R.typeOf(mover), nearKing, ply: st.myMoves, paid: L.loss + pay, st };
          for (const [d, c] of hooked('loss')) {
            const r0 = d.loss(ev); if (!r0) continue;
            if (r0.bonus) bonus += relGold(d.id, r0.bonus * c);
            if (r0.minus) { cost = Math.max(0, cost - r0.minus * c); pulseRelic(d.id); trig(d.id); if (!cost) { why = d.id; break; } continue; }
            if (r0.free) { cost = 0; why = d.id; pulseRelic(d.id); trig(d.id); break; }
            if (r0.cap != null) { const left = Math.max(0, r0.cap * c - ev.paid); if (left < cost) { cost = left; why = cost ? '' : d.id; pulseRelic(d.id); trig(d.id); } }
            else if (r0.bonus) trig(d.id);
          }
          if (cost > 0 && st.leech > 0) { st.leech--; cost = 0; why = 'leech'; trig('leech'); }
          else if (cost > 0 && game.shieldN > 0) { game.shieldN--; cost = 0; why = 'shield'; trig('shield'); }
          if (cost > 1 && hasV('mercy') && !st.mercy) { st.mercy = 1; cost = Math.ceil(cost / 2); trig('mercy'); }
        }
        if (cost <= 0) { /* covered */ }
        else if (u.insurance && st.insUsed < u.insurance) { cost = 0; st.insUsed++; why = 'insurance'; pulseRelic('insurance'); }
        if (why && why !== 'misere') L.saved += base;
        pay += cost;
        if (u.revenge && game.ctx.variant !== 'misere') st.revenge = 1;
      });
      if (lost.length) {
        st.lastLost = { sq: m.to, ply: st.myMoves };
        const real = Math.min(pay, run.gold + bonus);
        run.gold = Math.max(0, run.gold + bonus - pay); run.fined += real;
        L.loss += real; L.lossN += lost.length;
        game.lossEvent = { piece: lost[0][1], n: real };
        const sq = m.capture != null ? m.capture : lost[0][0];
        if (real) pops.push([sq, '−$' + real, 'minus']);
        if (bonus) pops.push([sq, '+$' + bonus, 'plus']);
        if (!real && !bonus && game.ctx.variant !== 'misere') pops.push([sq, '$0', 'saved']);
        if (bonus) run.earned += bonus;
      }
    }
    game.pendingPops = pops;
    syncSteel();
    game.state = res.state; game.state.tags = engineTags(); game.last = res.blocked != null ? null : m; game.exploded = res.exploded;
    if (gain) { run.gold += gain; run.earned += gain; }
    feedback(pops, white, res, gain);
    moveSound(m, res, white);
    game.legal = R.legalMoves(game.state, game.ctx);
    game.hintMove = null;
    checkOpening();
    return R.gameResult(game.state, game.ctx, game.legal);
  }
  function checkOpening() {
    const bk = game.book, d = game.debut; if (!bk || !bk.pay || !d) return;
    const full = bk.pay === 2, mult = game.ctx.up.debut ? 2 : 1, g = (1 + (full ? d.gold : 0)) * mult;
    bk.pay = 0;
    run.gold += g; run.earned += g; game.ledger.open += g;
    const bw = game.ctx.up.bookworm || 0;
    if (bw) { run.gold += bw; run.earned += bw; game.ledger.rel.bookworm = (game.ledger.rel.bookworm || 0) + bw; pulseRelic('bookworm'); trig('bookworm'); }
    if (full && game.ctx.up.theory) { run.items.hints += game.ctx.up.theory; pulseRelic('theory'); trig('theory'); }
    if (full && game.ctx.up.openingPrep) { run.items.undo += game.ctx.up.openingPrep; pulseRelic('openingPrep'); trig('openingPrep'); }
    if (game.last) coinsIn(sqPoint(game.last.to), g + bw);
    if (mult > 1) pulseRelic('debut');
    if (full) {
      if (run.openings.indexOf(d.id) === -1) run.openings.push(d.id);
      toast(PX('debut', 'i16') + ' ' + tx('g.lineDone', { name: d.name, g })); window.FX.sfx('opening');
      game.pendingTalk = ['opening', { name: d.name }];
      if (META() && META().markDebut) META().markDebut(d.id);
    } else { toast(PX('debut', 'i16') + ' ' + tx('g.bookMove', { g })); window.FX.sfx('book'); }
  }
  // In a game the toast sits exactly on top of the move-log strip, so it never covers the board or the bot.
  function toast(html) {
    const el = $('toast'); el.innerHTML = html;
    const inGame = !$('screen-game').classList.contains('hidden') && $('modal').classList.contains('hidden');
    el.classList.toggle('inline', inGame);
    if (inGame) { const r = $('infoline').getBoundingClientRect(); Object.assign(el.style, { top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px', bottom: 'auto' }); }
    else if (!$('pack').classList.contains('hidden') || !$('inspect').classList.contains('hidden')) Object.assign(el.style, { top: 'calc(env(safe-area-inset-top) + 10px)', left: '', width: '', height: '', bottom: 'auto' });
    else Object.assign(el.style, { top: '', left: '', width: '', height: '', bottom: '' });
    el.classList.remove('hidden', 'show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.add('hidden'), 2600);
  }
  async function useHint() {
    if (!run.items.hints || game.busy || game.over || game.state.turn !== 'w') return;
    game.busy = true; setStatus(tx('g.thinkingHint')); render();
    const g0 = game, m = await window.Bot.hint(game.state, game.ctx);
    if (game !== g0) return;
    game.busy = false;
    if (m) { run.items.hints--; game.hintMove = m; setStatus(tx('g.hintStatus', { mv: SQN(m.from) + '–' + SQN(m.to) })); window.Talk.say('hint'); }
    render();
  }
  function useConfuse() {
    if (!run.items.confuse || game.confuseNext || game.busy || game.over) return;
    run.items.confuse--; game.confuseNext = true; setStatus(tx('g.confusedStatus')); window.Talk.say('confused'); render();
  }
  async function playerMove(m) {
    game.history.push({ state: R.clone(game.state), gold: run.gold, last: game.last, logLen: game.log.length,
      snap: JSON.stringify({ book: game.book, tags: game.tags, stats: game.stats, ledger: game.ledger, earned: run.earned, fined: run.fined, st: run.relics.map(r => r.n) }) });
    const capBefore = game.state.board.filter(Boolean).length;
    const victim = m.capture != null ? game.state.board[m.capture] : null;
    const result = doMove(m);
    render();
    if (result) return endGame(result);
    if (game.state.board.filter(Boolean).length < capBefore) {
      window.Talk.say(game.botSource === 'random' && game.ctx.variant !== 'misere' ? 'blunder' : 'lost', { piece: victim ? R.typeOf(victim) : null });
    } else if (R.inCheck(game.state, 'b', game.ctx) && Math.random() < 0.7) window.Talk.say('inCheck');
    if (game.pendingTalk) { window.Talk.say.apply(null, game.pendingTalk); game.pendingTalk = null; }
    // Blitz: after your capture you move again (only when the bot is not in check, so the king can never be taken)
    const bl = game.ctx.up.blitz || 0;
    if (bl > game.stats.blitzUsed && m.capture != null && game.ctx.variant !== 'misere' && !R.inCheck(game.state, 'b', game.ctx)) {
      const again = Object.assign(R.clone(game.state), { turn: 'w', ep: null }), lg = R.legalMoves(again, game.ctx);
      if (lg.length) {
        game.stats.blitzUsed++; game.state = again; game.legal = lg; game.log.push('…'); game.san.push('…'); game.book.ok = false;
        pulseRelic('blitz'); toast(PX('blitz', 'i16') + ' ' + tx('g.blitzToast')); setStatus(tx('g.blitzStatus')); render(); return;
      }
    }
    return botTurn(game);
  }
  // the bot's reply (also its opening move when you play Black)
  async function botTurn(g0) {
    if (game !== g0 || game.over || game.state.turn !== 'b') return;
    game.busy = true; setStatus(tx('g.botThinking')); render();
    await new Promise(r => setTimeout(r, 250));
    if (game !== g0 || game.over) return;
    const book = game.confuseNext ? null : bookMove();
    const { move, source } = book ? { move: book, source: 'book' } : await window.Bot.chooseMove(game.state, game.ctx, run.round, game.confuseNext, tierN());
    if (game !== g0 || game.over) return;
    game.confuseNext = false; game.botSource = source;
    if (!move) { game.busy = false; return endGame(R.gameResult(game.state, game.ctx, []) || { winner: 'w', reason: 'noBotMoves' }); }
    const botVictim = move.capture != null ? game.state.board[move.capture] : null;
    game.lossEvent = null;
    const r2 = doMove(move);
    game.busy = false;
    if (!r2) {
      const seenMove = !visibleSet() || visibleSet().has(move.to);
      if (game.lossEvent && game.lossEvent.n) window.Talk.say('fine', { piece: game.lossEvent.piece, n: game.lossEvent.n });
      else if (botVictim && game.last) window.Talk.say('capture', { piece: R.typeOf(botVictim) });
      else if (R.inCheck(game.state, 'w', game.ctx)) window.Talk.say('check');
      else if (Math.random() < 0.35 || !seenMove) window.Talk.say('move');
    }
    if (game.pendingTalk) { window.Talk.say.apply(null, game.pendingTalk); game.pendingTalk = null; }
    const seen = !visibleSet() || visibleSet().has(move.to);
    setStatus(seen ? tx('g.botMoved', { mv: SQN(move.from) + '–' + SQN(move.to) }) : tx('g.botMovedFog'));
    render();
    if (r2) endGame(r2);
  }
  function undo() {
    const free = game.ctx.up.undo && !game.undoUsed;
    if ((!free && !run.items.undo) || !game.history.length || game.busy) return;
    if (free) game.undoUsed = true; else run.items.undo--;
    const h = game.history.pop(), sn = JSON.parse(h.snap);
    game.state = h.state; game.log.length = h.logLen; game.san.length = h.logLen; run.gold = h.gold; game.last = h.last; game.exploded = []; game.revived = null;
    game.tags = sn.tags; game.book = sn.book || game.book; game.stats = sn.stats; game.ledger = sn.ledger; run.earned = sn.earned; run.fined = sn.fined; run.relics.forEach((r, i) => { r.n = sn.st[i] == null ? undefined : sn.st[i]; });
    syncSteel(); game.state = R.clone(game.state); game.state.tags = engineTags();
    game.legal = R.legalMoves(game.state, game.ctx); game.hintMove = null;
    setStatus(tx('g.undone')); render();
  }
  // Layered capture feedback (game-feel): hit-stop → square pop + particles → coins fly to the HUD → counter tick.
  const TIER = { p: 'small', n: 'medium', b: 'medium', r: 'medium', q: 'large' };
  function sqPoint(sq) { const bd = $('board').getBoundingClientRect(); return [bd.left + (scrCol(sq) + 0.5) * bd.width / 8, bd.top + ((sq >> 3) + 0.5) * bd.height / 8]; }
  // board sounds: a wooden tock for quiet moves (the bot's a touch lower), castle/promote variants, then a check ting
  function moveSound(m, res, white) {
    const S = window.SND; if (!S) return;
    const caps = (res.captured && res.captured.length) || (res.exploded && res.exploded.length);
    if (res.blocked != null) S.play('illegal');
    else if (m.promo) S.play('promote', { delay: caps ? 0.08 : 0 });
    else if (!caps) S.play(m.castle ? 'castle' : 'move', { rate: white ? 1 : 0.88 });
    if (game.ctx.variant !== 'misere' && R.inCheck(game.state, game.state.turn, game.ctx)) S.play('check', { delay: 0.09 });
  }
  function feedback(pops, white, res, gain) {
    const caps = res.captured || [], big = res.exploded && res.exploded.length > 1;
    let tier = null;
    caps.forEach(p => { const t = TIER[R.typeOf(p)] || 'small'; if (!tier || t === 'large' || (t === 'medium' && tier === 'small')) tier = t; });
    if (big) tier = 'large';
    const at = pops.length ? sqPoint(pops[0][0]) : (game.last ? sqPoint(game.last.to) : null);
    const go = () => {
      pops.forEach(([sq, t, c]) => popAt(sq, t, c));
      if (white && gain) { coinsIn(sqPoint(pops[0] ? pops[0][0] : game.last.to), gain); if (META()) META().coach('capture'); }
      if (!white && pops.some(x => x[2] === 'minus')) {
        const n = +pops.find(x => x[2] === 'minus')[1].replace(/[^0-9]/g, '');
        coinsOut($('bot-avatar'), n); window.FX.sfx('loss');
        const hb = $('hud-gold').closest('.hud-box'); hb.classList.remove('hurt'); void hb.offsetWidth; hb.classList.add('hurt');
        if (META()) META().coach('loss');
      }
      pops.filter(x => x[2] === 'plus' && !white).forEach(x => coinsIn(sqPoint(x[0]), +x[1].replace(/[^0-9]/g, '')));
    };
    if (tier) {
      window.FX.juice(tier, { at, stopEl: $('board-frame'), flashEl: $('board-wrap'), flashColor: white ? null : '#ec6f67', sfx: big ? 'boom' : tier === 'large' ? 'captureBig' : 'hit',
        colors: white ? ['#eabc52', '#fff3c4', '#ffffff'] : ['#ec6f67', '#8f3a35', '#ffffff'], img: white && !big ? null : undefined }).then(go);
    } else go();
  }
  // "+$N" / "−$N" pop right on the board square where the capture happened
  function popAt(sq, text, cls) {
    const wrap = $('board-wrap'), bd = $('board').getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    const x = bd.left - wr.left + (scrCol(sq) + 0.5) * bd.width / 8, y = bd.top - wr.top + ((sq >> 3) + 0.5) * bd.height / 8;
    const f = document.createElement('div'); f.className = 'sqpop ' + cls; f.innerHTML = (cls === 'minus' ? PX('coin-loss', 'i16') : PX('coin', 'i16')) + '<span>' + text + '</span>';
    f.style.left = x + 'px'; f.style.top = y + 'px';
    wrap.appendChild(f); setTimeout(() => f.remove(), 1400);
    if (cls === 'plus') window.FX.burst(wr.left + x, wr.top + y, { n: 4, spread: 40, img: window.PIX.url('coin') });
  }

  // ---------- modal ----------
  function modal(html, buttons, boxCls) {
    const m = $('modal'); m.querySelector('.modal-box').className = 'modal-box panel ' + (boxCls || '');
    m.querySelector('.modal-body').innerHTML = html;
    const bar = m.querySelector('.modal-btns'); bar.innerHTML = '';
    buttons.forEach(([label, fn, cls]) => {
      const b = document.createElement('button'); b.innerHTML = label; b.className = 'btn ' + ({ primary: 'btn-green', danger: 'btn-red', boss: 'btn-red', gold: 'btn-orange' }[cls] || cls || '');
      b.onclick = () => { m.classList.add('hidden'); window.FX.sfx('click'); fn(); }; bar.appendChild(b);
    });
    m.classList.remove('hidden'); m.classList.remove('enter'); void m.offsetWidth; m.classList.add('enter');
    const f = bar.querySelector('button'); if (f) setTimeout(() => f.focus({ preventScroll: true }), 30);
  }
  function showBossIntro(boss) {
    window.Talk.say('bossIntro'); setStatus(tx('g.bossTurn'));
    const tip = { atomic: 'sapper', fog: 'lantern', misere: 'jester' }[boss.id], td = tip && window.RELIC(tip);
    setTimeout(() => { const t = document.querySelector('#modal .boss-token'); window.FX.juice('large', { at: t ? [t.getBoundingClientRect().left + t.offsetWidth / 2, t.getBoundingClientRect().top + t.offsetHeight / 2] : null, flashEl: $('modal'), flashColor: BOSS_COLOR[boss.id], sfx: 'boss', colors: [BOSS_COLOR[boss.id] || '#ec6f67', '#ffffff'] }); }, window.FX.reduce ? 0 : 520);
    modal('<div class="boss-stripes" aria-hidden="true"><i></i><i></i><i></i></div><div class="boss-card" style="--bc:' + (BOSS_COLOR[boss.id] || '') + '"><span class="tag">' + tx('g.bossRoundTag', { n: run.round }) + '</span><div class="boss-token">' + PX('av-' + boss.id, 'i64') + '</div>' +
      '<h2>' + boss.debut.name + '</h2><h3>' + boss.rule + '</h3><p class="boss-why">' + boss.debut.why + '.</p><p>' + boss.desc + '</p>' +
      '<p class="boss-book">' + PX('debut', 'i16') + ' ' + (BLK() ? tx('g.bossBookW') : boss.debut.side === 'b' ? tx('g.bossBookDef') : tx('g.bossBook')) + ' ' + '<b>' + window.debutLine(boss.debut) + '</b></p>' +
      (td ? '<p class="boss-tip">' + PX(td.icon, 'i16') + ' ' + tx(owned()[tip] ? 'g.bossTipOwned' : 'g.bossTip', { name: td.name }) + '</p>' : '') + '</div>', [[tx('g.acceptChallenge'), () => { if (BLK()) { const g0 = game; setTimeout(() => botTurn(g0), 300); } }, 'boss']], 'bossbox');
  }

  // ---------- gold breakdown after a win: relic win-hooks run left → right, the Mirror repeats its right neighbour ----------
  function winRelicRows() {
    const b = game.state.board, st = game.stats, kq = b.indexOf('K');
    let kingPawns = 0, chain = 0;
    if (kq >= 0) for (let df = -1; df <= 1; df++) { const f = (kq & 7) + df, r = (kq >> 3) - 1; if (f >= 0 && f < 8 && r >= 0 && b[r * 8 + f] === 'P') kingPawns++; }
    b.forEach((p, i) => { if (p !== 'P') return; const r = (i >> 3) + 1, f = i & 7; if (r < 8 && ((f > 0 && b[r * 8 + f - 1] === 'P') || (f < 7 && b[r * 8 + f + 1] === 'P'))) chain++; });
    const S = { pawnsLeft: b.filter(p => p === 'P').length, gold: run.gold, boss: !!game.boss, castled: st.castled, relicCount: run.relics.length,
      wins: run.wins + 1, myMoves: st.myMoves, lost: st.lostW, reason: game.resultReason, lastBy: st.lastBy, myPieces: myLeft(b), kingPawns, chain,
      cats: new Set(run.relics.map(r => (window.RELIC(r.id) || {}).cat)).size,
      board: b, botPieces: botLeft(b), hints: run.items.hints, sig: !!(run.sig && game.debut && game.debut.id === run.sig), caps: st.caps }, rows = [];
    run.relics.forEach((r, i) => {
      let def = window.RELIC(r.id), pre = '', rec = r;
      if (COPY[r.id]) { const t = copyOf(i); if (!t) return; def = window.RELIC(t.id); rec = t; pre = tx('relic.' + r.id + '.name') + ': '; }
      if (!def.win) return;
      const e = def.win(S, rec); if (!e || !e.gold) return;
      trig(def.id);
      rows.push({ label: pre + def.name + (e.note ? ' (' + e.note + ')' : ''), g: e.gold, icon: def.icon, art: def.art, id: r.id });
    });
    return rows;
  }
  function endGame(result) {
    game.over = true; game.busy = false; render();
    window.Talk.say(result.winner === 'w' ? 'lose' : result.winner === 'b' ? 'win' : 'draw');
    const anR = { round: run.round, opening: game.debut && game.debut.id, boss: game.boss ? game.boss.id : '', moves: game.stats.myMoves, reason: result.reason };
    if (result.winner === 'b' && secondWind(result)) return;
    if (result.winner === 'b') { game.anReason = result.reason; window.FX.sfx('lose'); window.FX.addTrauma(0.5); return showGameOver(why(result.reason)); }
    if (result.winner !== 'w') return AN('round_draw', anR), window.FX.sfx('draw'), modal('<h2 class="draw">' + tx('g.draw') + '</h2><p>' + tx('g.drawText', { reason: why(result.reason) }) + '</p>', [[tx('g.replay'), startGame, 'btn-blue']]);
    game.resultReason = result.reason;
    AN('round_won', anR);
    const L = game.ledger, u = ups();
    const ic = (n, art) => art ? '<img class="piece-art i16" src="vendor/pieces/cburnett/' + art + '.svg" alt="">' : PX(n, 'i16');
    // already in your pocket (paid during the game)
    const inGame = [];
    if (L.capN) inGame.push([ic('butcher'), tx('g.capturesX', { n: L.capN }), L.capGold]);
    Object.keys(L.rel).forEach(id => { const d = window.RELIC(id); inGame.push([ic(d.icon, d.art), d.name, L.rel[id]]); });
    if (L.foil) inGame.push([ic('e-foil'), tx('enh.foil.name'), L.foil]);
    if (L.open) inGame.push([ic('debut'), tx('g.debutRow', { name: game.debut.name }), L.open]);
    if (L.lossN) inGame.push([ic('coin-loss'), tx('g.lossesX', { n: L.lossN }) + (L.saved ? ' ' + tx('g.saved', { n: L.saved }) : ''), -L.loss]);
    // paid now
    const now = [], winBonus = (game.boss ? 6 + TM().bossBonus : 3) * (game.doubleGold ? 2 : 1);
    now.push([ic(game.boss ? 'av-' + game.boss.id : 'flag'), (game.boss ? tx('g.bossBeaten') : tx('g.roundWin', { n: run.round })) + (game.doubleGold ? ' ×2' : ''), winBonus]);
    winRelicRows().forEach(r => now.push([ic(r.icon, r.art), r.label, r.g, r.id]));
    if (game.boss && hasV('warChest')) { now.push([ic('g:chest:R:coin'), tx('voucher.warChest.name'), 4]); trig('warChest'); }
    const tre = Object.keys(game.tags).filter(k => game.tags[k].id === 'treasurer' && game.state.board[k] && R.colorOf(game.state.board[k]) === 'w').length;
    if (tre) { now.push([ic('g:bag:G:plus'), tx('enh.treasurer.name') + ' ×' + tre, tre]); trig('treasurer'); }
    const per = u.broker ? 4 : 5, cap = u.philosopher ? Infinity : Math.max(0, (hasV('safe') ? 10 : 5) + TM().interestCap), interest = Math.min(cap, Math.floor(run.gold / per));
    if (interest) now.push([ic(u.philosopher ? 'g:gem:R:star' : 'broker'), tx('g.interest', { per, cap: cap === Infinity ? '∞' : cap }), interest, u.philosopher ? 'philosopher' : undefined]);
    if (interest && u.philosopher) trig('philosopher');
    const payTotal = now.reduce((a, r) => a + r[2], 0), gameNet = inGame.reduce((a, r) => a + r[2], 0) + payTotal;
    run.gold += payTotal; run.earned += payTotal; run.wins++; pendingGold += payTotal; hud(game.boss);
    window.FX.juice('large', { at: [innerWidth / 2, $('board').getBoundingClientRect().top + $('board').offsetHeight / 2], flashEl: $('board-wrap'), sfx: 'win', colors: ['#eabc52', '#5fc58a', '#ffffff'] });
    const broken = [];
    for (let i = run.relics.length - 1; i >= 0; i--) if (run.relics[i].id === 'glass' && !window.__noBreak && Math.random() < 0.25) { broken.push(i); run.relics.splice(i, 1); }
    let k = 0;
    const row = r => '<div class="cash-row" style="--i:' + (k++) + '"' + (r[3] ? ' data-rel="' + r[3] + '"' : '') + '><span>' + r[0] + ' ' + r[1] + '</span><b class="tnum ' + (r[2] < 0 ? 'neg' : '') + '">' + (r[2] < 0 ? '−$' + -r[2] : '+$' + r[2]) + '</b></div>';
    modal('<h2 class="win">' + tx('g.win') + '</h2><p class="reason">' + why(result.reason) + '</p>' +
      (inGame.length ? '<div class="cash-sec">' + tx('g.inGame') + ' <small>' + tx('g.inWallet') + '</small></div><div class="cash">' + inGame.map(row).join('') + '</div>' : '') +
      '<div class="cash-sec">' + tx('g.forWin') + '</div><div class="cash">' + now.map(row).join('') +
      (broken.length ? '<div class="cash-row warn" style="--i:' + (k++) + '"><span>' + PX('glass', 'i16') + ' ' + tx('g.glassBroke') + '</span><b>—</b></div>' : '') + '</div>' +
      '<div class="cash-row total" style="--i:' + (k++) + '"><span>' + tx('g.gameTotal') + '</span><b class="tnum ' + (gameNet < 0 ? 'neg' : '') + '">' + (gameNet < 0 ? '−$' : '+$') + '<span id="pay-total">' + Math.abs(gameNet) + '</span></b></div>' +
      '<p class="cash-wallet">' + tx('g.wallet') + ' ' + COIN() + '<b class="tnum">' + run.gold + '</b></p>',
      [[tx(lastRound() ? 'g.takeFinal' : 'g.takeShop', { n: payTotal }), () => {
        const box = document.querySelector('#modal .modal-box').getBoundingClientRect(); // hidden now; use where it was
        coinsIn([innerWidth / 2, box.top ? box.top + box.height * 0.7 : innerHeight * 0.6], payTotal, true);
        if (lastRound()) showGameOver(why('allDebuts'), true); else openShop();
      }, 'gold']], 'paybox');
    paySequence(k, Math.abs(gameNet));
    game.payout = { inGame, now, payTotal, gameNet, broken: broken.length };
    if (META()) { if (lastRound()) META().clearSave(); else META().save(run, 'toShop'); META().coach('payout'); }
  }

  // v0.4 Second Wind: a lost game is replayed once; the relic burns away (saved at once, so a reload can't keep it)
  function secondWind(result) {
    const i = run.relics.findIndex(r => r.id === 'secondWind'); if (i === -1) return false;
    run.relics.splice(i, 1); trig('secondWind');
    AN('second_wind', { round: run.round, reason: result.reason });
    if (META()) META().save(run, 'game');
    window.FX.sfx('upgrade');
    modal('<h2 class="win">' + tx('g.secondWindT') + '</h2><p>' + PX('g:potion:Q:up', 'i16') + ' ' + tx('g.secondWindText', { reason: why(result.reason), name: tx('relic.secondWind.name') }) + '</p>', [[tx('g.replay'), startGame, 'btn-blue']]);
    return true;
  }
  // payout: rows land one by one (tick + relic tile jiggle), then the total counts up and coins burst
  function paySequence(nRows, total) {
    const rows = [...document.querySelectorAll('#modal .cash-row')], step = window.FX.reduce ? 0 : 140, t0 = window.FX.reduce ? 0 : 380;
    rows.forEach((r, i) => setTimeout(() => {
      r.classList.add('in'); window.FX.sfx('tally', { i });
      if (r.dataset.rel) pulseRelic(r.dataset.rel);
      if (r.classList.contains('total')) {
        const t = $('pay-total'); if (t) { t.dataset.v = 0; window.FX.num(t, total); }
        window.FX.burstAt(r, { n: 14, img: window.PIX.url('coin') }); window.FX.sfx('coin');
      }
    }, t0 + i * step));
    void nRows;
  }
  function showGameOver(reason, won) {
    show('screen-over'); hud(false, run.round); inPlayFlag = false;
    { const a = { round: run.round, opening: game && game.debut ? game.debut.id : '', boss: game && game.boss ? game.boss.id : '', tier: tierN(), side: run.side || 'w', reason: won ? 'won' : (game && game.anReason) || 'lost', gold: run.gold, relics: run.relics.length, wins: run.wins };
      if (!won) AN('round_lost', a); AN('run_end', Object.assign({ result: won ? 'win' : 'lose' }, a)); }
    if (META()) { META().clearSave(); if (won && META().recordWin) run.unlocked = META().recordWin(tierN(), run.side || 'w'); }
    let best = 0; try { best = Math.max(+localStorage.getItem('chessrl-best-round') || 0, run.round); localStorage.setItem('chessrl-best-round', best); } catch (e) { best = run.round; }
    const st = [[tx('g.stRound'), run.round, 'var(--orange)'], [tx('g.stWins'), run.wins, 'var(--green)'], [tx('g.stEarned'), '$' + run.earned, 'var(--blue)'], [tx('g.stFines'), '−$' + run.fined, 'var(--red)'], [tx('g.stBest'), best, 'var(--purple)'], [tx('tier.label'), tierN() + ' · ' + tx('tier.' + tierN()), 'var(--orange)'], [tx('side.label'), tx(BLK() ? 'side.b' : 'side.w'), 'var(--blue)']];
    $('over-body').innerHTML = '<div class="over-panel panel"><h2 class="over-title' + (won ? ' won' : '') + '">' + (won ? tx('g.runWon') : tx('g.runOver')) + '</h2><p class="over-reason">' + (won ? tx('g.overWon', { reason, m: window.RUN_ROUNDS }) : tx('g.overLost', { reason, n: run.round, m: window.RUN_ROUNDS }) + (game.boss ? ' (' + game.boss.name + ')' : '')) + '</p>' +
      '<div class="over-quote"><div class="portrait">' + window.Talk.avatar + '</div><div class="q"><b>' + window.Talk.personaName + '</b>«' + window.Talk.last + '»</div></div>' +
      '<div class="stats">' + st.map((x, i) => '<div class="stat" style="--i:' + i + '"><span>' + x[0] + '</span><b style="--c:' + x[2] + '">' + x[1] + '</b></div>').join('') +
      '<div class="stat" style="--i:5"><span>' + tx('g.relics') + '</span><span class="txt over-relics">' + (run.relics.length ? run.relics.map(r => relicArt(window.RELIC(r.id), 'i21')).join('') : tx('g.none')) + '</span></div>' +
      (won && run.unlocked ? '<div class="stat unlock" style="--i:6"><span>' + PX('crown', 'i16') + ' ' + tx('tier.unlocked', { n: run.unlocked, name: tx('tier.' + run.unlocked) }) + '</span></div>' : '') +
      (run.openings.length ? '<div class="stat" style="--i:6"><span>' + tx('g.linesPlayed') + '</span><span class="txt">' + run.openings.map(id => (window.DEBUT(id) ? window.DEBUT(id).name : id)).join(', ') + '</span></div>' : '') + '</div>' +
      '<div class="over-fb"><span>' + tx('fb.overAsk') + '</span><button class="btn btn-purple btn-sm" data-fb="' + (won ? 'run-win' : 'run-over') + '">' + PX('chat', 'i16') + ' ' + tx('fb.menu') + '</button></div></div>';
  }

  // ---------- shop ----------
  const SHOP_W = { common: 58, uncommon: 30, rare: 12, legendary: 0 }, PACK_W = { common: 30, uncommon: 36, rare: 24, legendary: 10 };
  function rollRelic(weights, exclude) {
    const own = owned();
    if (hasV('luckyShelf') && weights === SHOP_W) weights = Object.assign({}, weights, { rare: weights.rare * 2 });
    const runRules = (run.debuts || []).map(id => (window.DEBUT(id) || {}).rule), BREL = { lantern: 'fog', sapper: 'atomic', jester: 'misere', bomb: 'atomic', heckler: 'threecheck', minesweeper: 'mines' };
    const c = window.RELICS.filter(r => (!own[r.id] || (r.stack && own[r.id] < r.stack)) && exclude.indexOf(r.id) === -1 && weights[r.rarity] && (!BREL[r.id] || !runRules.length || runRules.indexOf(BREL[r.id]) !== -1));
    let x = Math.random() * c.reduce((a, r) => a + weights[r.rarity], 0);
    for (const r of c) { x -= weights[r.rarity]; if (x <= 0) return r; }
    return c[0] || null;
  }
  function rollShelf() {
    const out = [], n = 2 + (hasV('shelf') ? 1 : 0);
    for (let i = 0; i < n; i++) { const r = rollRelic(SHOP_W, out.map(o => o.id)); if (r) out.push({ id: r.id, sold: false }); }
    return out;
  }
  // slot 1 is always an upgrade chest (small 50% / normal 35% / large 15%), slot 2 is any chest
  const enhSize = () => { const x = Math.random(); return x < 0.5 ? 0 : x < 0.85 ? 1 : 2; };
  function rollPacks() {
    const kinds = ['enh', rand(['hint', 'tactic', 'relic', 'enh'])];
    return kinds.map(k => ({ kind: k, size: k === 'hint' ? Math.floor(Math.random() * 3) : k === 'enh' ? enhSize() : 0, sold: false }));
  }
  const packDef = o => (o.kind === 'enh' ? (d => Object.assign({ name: tx('pack.enh.name'), icon: 'pack-enh', desc: tx('pack.enh.desc', { k: d.pick > 1 ? d.pick : 1, n: d.n }) }, d))(window.PACKS.enh[o.size] || window.PACKS.enh[0]) : o.kind === 'hint' ? Object.assign({ name: tx('pack.hint.name'), icon: 'pack-hint', desc: tx('pack.hint.desc', { n: window.PACKS.hint[o.size].amount }) }, window.PACKS.hint[o.size]) : window.PACKS[o.kind]);
  const rerollCost = () => (owned().dealer && !run.shop.rerolls ? 0 : Math.max(1, (hasV('coupon') ? 1 : 3) + (hasV('steadyReroll') ? 0 : run.shop.rerolls) + TM().reroll));

  function openShop() {
    run.round++;
    const a = chapter(run.round);
    if (!run.voucher || run.voucher.ante !== a) {
      const pool = window.VOUCHERS.filter(v => !hasV(v.id));
      run.voucher = pool.length ? { ante: a, id: rand(pool).id, bought: false } : null;
    }
    run.shop = { relics: rollShelf(), packs: rollPacks(), rerolls: 0 };
    run.pack = null;
    const al = (owned().allowance || 0) * Math.max(0, slotsMax() - run.relics.length);
    if (al) { run.gold += al; run.earned += al; trig('allowance'); }
    show('screen-shop'); renderShop(true); shopBuys = 0;
    if (al) toast(PX('g:bag:B:plus', 'i16') + ' ' + tx('g.allowanceToast', { name: tx('relic.allowance.name'), n: al }));
    AN('shop_open', { round: run.round, gold: run.gold });
    if (META()) { META().coach('shop'); META().coach('chest'); if (bossFor(run.round)) META().coach('boss'); }
  }
  function relicCard(def, opts) {
    opts = opts || {};
    return '<button class="card ' + (opts.mini ? 'mini ' : '') + 'r-' + def.rarity + '" data-act="' + (opts.act || '') + '" data-k="' + (opts.k == null ? '' : opts.k) + '" style="--i:' + (opts.i || 0) + ';--tilt:' + (opts.tilt || 0) + 'deg" aria-label="' + def.name + ' — ' + window.RARITY[def.rarity] + (opts.price != null ? ', $' + opts.price : '') + '">' +
      '<span class="cback" aria-hidden="true"></span>' +
      (opts.price != null ? '<span class="price' + (opts.poor ? ' poor' : '') + '">$' + opts.price + '</span>' : '') +
      '<span class="card-in"><span class="cface"><span class="ctype">' + (def.tag || '') + '</span><span class="cart">' + relicArt(def, 'i48') + '</span>' +
      '<span class="cname">' + def.name + '</span>' + (opts.mini ? '' : '<span class="cdesc">' + def.desc + '</span>') + '<span class="sheen"></span></span></span>' +
      '<span class="rflag" aria-hidden="true">' + '<i></i>'.repeat({ common: 1, uncommon: 2, rare: 3, legendary: 4 }[def.rarity] || 1) + '</span>' +
      (opts.mini ? '' : '<span class="crar">' + window.RARITY[def.rarity] + '</span>') + '</button>';
  }
  function renderShop(deal) {
    hud(false, run.round);
    $('screen-shop').classList.toggle('deal', !!deal);
    if (deal) window.FX.sfx('deal');
    const next = bossFor(run.round);
    $('shop-next').innerHTML = tx('g.nextRound', { n: run.round, m: window.RUN_ROUNDS }) + (next ? ' · <span class="danger">' + PX('skull', 'i16') + ' ' + next.name + '</span>' : ' · ' + debutFor(run.round).name);
    renderRelics($('relics-shop'), 'shop');
    $('shelf').innerHTML = run.shop.relics.map((o, k) => {
      if (o.sold) return '<div class="card-sold">' + tx('g.sold') + '</div>';
      const d = window.RELIC(o.id), p = price(d.price);
      return relicCard(d, { mini: true, act: 'shop-relic', k, i: k, price: p, poor: run.gold < p, tilt: (k % 2 ? 2 : -2) });
    }).join('') || '<div class="card-sold">' + tx('g.empty') + '</div>';
    const rc = rerollCost(), rb = $('btn-reroll');
    rb.innerHTML = '<span>' + tx('g.reroll') + '</span><span class="price-pill">$' + rc + '</span>'; rb.disabled = run.gold < rc;
    const v = run.voucher && window.VOUCHERS.find(x => x.id === run.voucher.id);
    $('voucher').innerHTML = v && !run.voucher.bought
      ? '<button class="voucher" data-act="voucher"><span class="price' + (run.gold < price(v.price) ? ' poor' : '') + '">$' + price(v.price) + '</span><span class="vface">' + PX(v.icon, 'i37') + '<span class="vname">' + v.name + '</span></span></button>'
      : '<div class="card-sold small">' + (v ? tx('g.vBought') : tx('g.vAll')) + '<br><small>' + tx('g.vNext') + '</small></div>';
    $('packs').innerHTML = run.shop.packs.map((o, k) => {
      const d = packDef(o), p = packPrice(d);
      if (o.sold) return '<div class="card-sold small">' + tx('g.opened') + '</div>';
      return '<button class="chest r-' + d.rarity + '" data-act="pack" data-k="' + k + '" style="--i:' + k + '"><span class="price' + (run.gold < p ? ' poor' : '') + '">$' + p + '</span><span class="pack"><span class="stripes"></span>' +
        PX(d.icon, 'i37 cicon') + '<span class="cname">' + d.name + '</span><span class="csize">' + (o.kind === 'hint' ? d.size + ' · ×' + d.amount : o.kind === 'tactic' ? (hasV('tacticPlus') ? tx('g.kOfN', { k: 1, n: 4 }) : tx('g.trickOf3')) : o.kind === 'relic' ? tx('g.kOfN', { k: 1, n: 3 }) : d.size + ' · ' + tx('g.kOfN', { k: d.pick, n: d.n + (hasV('bigChest') ? 1 : 0) })) + '</span></span></button>';
    }).join('');
    $('inv-line').innerHTML = invHtml();
    if (META()) {
      META().markSeen(run.shop.relics.map(o => o.id).concat(run.relics.map(r => r.id), run.pack && run.pack.kind === 'relic' ? run.pack.items.map(x => x.id) : [], run.pack && run.pack.kind === 'tactic' ? run.pack.items.map(x => 'cons:' + x.id) : [], run.voucher ? ['v:' + run.voucher.id] : []));
      META().save(run, 'shop'); // every shop action is a safe boundary
    }
  }
  function invHtml() {
    const n = run.next, nx = [];
    if (n.doubleGold) nx.push(tx('g.nextDouble')); if (n.confiscate) nx.push(tx('g.nextConfiscate'));
    const box = (i, l, v) => '<div class="inv">' + PX(i, 'i21') + '<b>' + v + '</b><small>' + l + '</small></div>';
    const enh = Object.keys(run.enh).map(sq => '<button class="enh-chip" data-act="enh" data-k="' + sq + '"><img class="piece-art" src="vendor/pieces/cburnett/' + PC() + START[sq].toUpperCase() + '.svg" alt="">' + PX(window.ENH[run.enh[sq]].icon, 'i16 eb') + '</button>').join('');
    const vs = run.vouchers.map(id => '<button class="enh-chip" data-act="owned-voucher" data-k="' + id + '">' + PX(window.VOUCHERS.find(v => v.id === id).icon, 'i21') + '</button>').join('');
    return '<div class="inv-row">' + box('bulb', tx('g.invHints'), run.items.hints) + box('undo', tx('g.invUndo'), run.items.undo) + box('spiral', tx('g.invConfuse'), run.items.confuse) + enh + vs + '</div>' +
      (nx.length ? '<div class="inv-next">' + tx('g.nextGame') + ' ' + nx.join(' · ') + '</div>' : '');
  }

  // ---------- tap-to-inspect sheet ----------
  function inspect(kind, k, mode) {
    let card = '', info = '';
    const btns = [];
    const close = [tx('g.close'), null, ''];
    if (kind === 'owned') {
      const r = run.relics[k], d = window.RELIC(r.id); if (!d) return;
      card = relicCard(d, {});
      const nx = run.relics[k + 1];
      info = (d.grows ? '<p class="ins-state">' + tx('g.stableNow', { n: r.n || 1 }) + '</p>' : '') +
        (COPY[r.id] ? '<p class="ins-state">' + (copyOf(k) ? tx('g.mirrorCopies', { name: window.RELIC(copyOf(k).id).name }) : tx(r.id === 'echo' ? 'g.echoIdle' : 'g.mirrorIdle')) + '</p>' : '') +
        (r.id === 'snowball' ? '<p class="ins-state">' + tx('g.snowNow', { n: r.n || 0, g: Math.floor((r.n || 0) / 5) }) + '</p>' : '') +
        '<p class="ins-note">' + tx('g.relicPos', { n: k + 1, m: run.relics.length }) + '</p>';
      btns.push(['◀', () => moveRelic(k, -1), 'btn-blue', k === 0]);
      btns.push(['▶', () => moveRelic(k, 1), 'btn-blue', k === run.relics.length - 1]);
      if (mode === 'shop') btns.push([tx('g.sellFor', { n: sellValue(d) }), () => sellRelic(k), 'btn-orange']);
      else info += '<p class="ins-note">' + tx('g.sellInShop') + '</p>';
    } else if (kind === 'shop-relic') {
      const o = run.shop.relics[k], d = window.RELIC(o.id), p = relicPrice(d), full = run.relics.length >= slotsMax();
      card = relicCard(d, {});
      info = full ? '<p class="ins-note warn">' + tx('g.noSlotsSell') + '</p>' : '';
      btns.push([tx('g.buyFor', { n: p }), () => buyRelic(k), 'btn-green', run.gold < p || full]);
    } else if (kind === 'voucher' || kind === 'owned-voucher') {
      const v = window.VOUCHERS.find(x => x.id === (kind === 'voucher' ? run.voucher.id : k)), p = price(v.price);
      card = '<div class="voucher big"><span class="vface">' + PX(v.icon, 'i64') + '<span class="vname">' + v.name + '</span></span></div>';
      info = '<p class="ins-desc">' + v.desc + '</p><p class="ins-note">' + tx('g.voucherNote') + '</p>';
      if (kind === 'voucher') btns.push([tx('g.buyFor', { n: p }), () => buyVoucher(), 'btn-green', run.gold < p]);
    } else if (kind === 'pack') {
      const o = run.shop.packs[k], d = packDef(o), p = packPrice(d);
      card = '<div class="chest big r-' + d.rarity + '"><span class="pack"><span class="stripes"></span>' + PX(d.icon, 'i64 cicon') + '<span class="cname">' + d.name + '</span></span></div>';
      info = '<p class="ins-desc">' + d.desc + '</p>';
      btns.push([tx('g.openFor', { n: p }), () => buyPack(k), 'btn-green', run.gold < p]);
    } else if (kind === 'def') {
      const d = window.RELIC(k); if (!d) return;
      card = relicCard(d, {});
      info = '<p class="ins-note">' + tx('g.shopPrice', { n: d.price, rarity: window.RARITY[d.rarity] }) + '</p>';
    } else if (kind === 'enh') {
      const e = window.ENH[run.enh[k]];
      card = enhCard({ id: run.enh[k], sq: +k }, 0, { owned: true });
      const live = game && !game.over && !$('screen-game').classList.contains('hidden') ? Object.values(game.tags).find(t => t.home === +k && !t.temp) : null;
      info = '<p class="ins-desc">' + PN(START[k].toLowerCase()) + ' ' + SQN(+k) + ' · ' + window.RARITY[e.rarity] + '</p>' +
        (live && e.once ? '<p class="ins-state">' + (live.used ? tx('g.usedThisGame') : tx('g.notUsedThisGame')) + '</p>' : '') +
        '<p class="ins-note">' + tx('g.enhPermanent') + (e.move ? ' ' + tx('g.enhMoves') : '') + '</p>';
      void e;
    }
    btns.push(close);
    $('ins-body').innerHTML = '<div class="ins-card">' + card + '</div>' + info;
    const bar = $('ins-btns'); bar.innerHTML = '';
    btns.forEach(([label, fn, cls, dis]) => {
      const b = document.createElement('button'); b.className = 'btn ' + cls; b.innerHTML = label; b.disabled = !!dis;
      b.onclick = () => { closeInspect(); if (fn) fn(); }; bar.appendChild(b);
    });
    const ins = $('inspect'); ins._prev = document.activeElement;
    ins.classList.remove('hidden'); ins.classList.remove('enter'); void ins.offsetWidth; ins.classList.add('enter'); window.FX.sfx('flip');
    setTimeout(() => { const f = bar.querySelector('button:not([disabled])'); if (f) f.focus({ preventScroll: true }); }, 30);
  }
  function closeInspect() { const ins = $('inspect'); ins.classList.add('hidden'); if (ins._prev && document.body.contains(ins._prev)) ins._prev.focus({ preventScroll: true }); }
  function rerender() { if (!$('screen-shop').classList.contains('hidden')) renderShop(); else if (game && !$('screen-game').classList.contains('hidden')) render(); }
  function moveRelic(i, d) {
    const j = i + d; if (j < 0 || j >= run.relics.length) return;
    const t = run.relics[i]; run.relics[i] = run.relics[j]; run.relics[j] = t; rerender();
    inspect('owned', j, $('screen-shop').classList.contains('hidden') ? 'game' : 'shop');
  }
  function sellRelic(i) {
    const r = run.relics[i]; if (!r) return; const d = window.RELIC(r.id);
    const tile = document.querySelector('#relics-shop .rtile[data-i="' + i + '"]'), from = tile ? tile.getBoundingClientRect() : null;
    const v = sellValue(d); // priced before it leaves (selling the Fence itself still gets its bonus, as the button said)
    run.relics.splice(i, 1); run.gold += v;
    coinsIn(from ? [from.left + from.width / 2, from.top + from.height / 2] : $('relics-shop'), v); // HUD keeps the old value until coins land
    toast(relicArt(d, 'i16') + ' ' + tx('g.soldToast', { name: d.name, n: v })); renderShop();
    window.FX.sfx('sell'); if (from) window.FX.burst(from.left + from.width / 2, from.top + from.height / 2, { n: 10, colors: ['#eabc52', '#ffffff'] });
  }
  function addRelic(d) {
    run.relics.push({ id: d.id, n: d.grows ? 1 : undefined }); run.bought.push(d.name); run.lastPick = d.name;
    if (d.id === 'sanctuary' && run.sanctuarySq == null) run.sanctuarySq = rand([34, 35, 36, 37, 42, 43, 44, 45]);
    if (d.id === 'treasure' && run.treasureSq == null) run.treasureSq = rand([18, 19, 20, 21, 26, 27, 28, 29]);
  }
  function buyRelic(k) {
    const o = run.shop.relics[k]; if (!o || o.sold) return;
    const d = window.RELIC(o.id), p = relicPrice(d);
    if (run.gold < p || run.relics.length >= slotsMax()) return;
    const src = document.querySelector('#shelf .card[data-k="' + k + '"]'), first = src ? src.getBoundingClientRect() : null;
    run.gold -= p; o.sold = true; addRelic(d); shopBuys++;
    AN('shop_buy', { kind: 'relic', id: d.id, price: p, round: run.round });
    toast(relicArt(d, 'i16') + ' ' + tx('g.boughtToast', { name: d.name })); renderShop();
    const t = document.querySelector('#relics-shop .rtile[data-i="' + (run.relics.length - 1) + '"]');
    window.FX.sfx('buy'); coinsOut(first ? [first.left + first.width / 2, first.top + first.height / 2] : $('shelf'), p);
    flyInto(first, t, relicCard(d, { mini: true }));
  }
  function buyVoucher() {
    const v = run.voucher && window.VOUCHERS.find(x => x.id === run.voucher.id); if (!v || run.voucher.bought) return;
    const p = price(v.price); if (run.gold < p) return;
    run.gold -= p; run.vouchers.push(v.id); run.voucher.bought = true; shopBuys++;
    AN('shop_buy', { kind: 'voucher', id: v.id, price: p, round: run.round });
    if (v.id === 'shelf') { const r = rollRelic(SHOP_W, run.shop.relics.map(o => o.id)); if (r) run.shop.relics.push({ id: r.id, sold: false }); }
    toast(PX(v.icon, 'i16') + ' ' + tx('g.voucherToast', { name: v.name })); renderShop();
    window.FX.burstAt($('voucher'), { n: 20, colors: ['#e19a1c', '#fff1a8', '#fff'] });
  }
  function reroll() {
    const c = rerollCost(); if (run.gold < c) return;
    AN('shop_reroll', { cost: c, round: run.round });
    run.gold -= c; run.shop.rerolls++; run.shop.relics = rollShelf(); window.FX.sfx('reroll'); renderShop(true);
    coinsOut($('btn-reroll'), c);
  }
  // FLIP: a ghost of the bought card flies from the shelf into its relic slot, then the slot squashes
  function flyInto(first, tile, html) {
    const done = () => { if (tile) { tile.classList.remove('jiggle'); void tile.offsetWidth; tile.classList.add('jiggle'); window.FX.burstAt(tile, { n: 12, colors: ['#eabc52', '#ffffff'] }); } };
    if (!first || !tile || window.FX.reduce || !document.body.animate) return done();
    const last = tile.getBoundingClientRect(), g = document.createElement('div');
    g.className = 'fly-ghost'; g.innerHTML = html; Object.assign(g.style, { left: first.left + 'px', top: first.top + 'px', width: first.width + 'px', height: first.height + 'px' });
    document.body.appendChild(g);
    const dx = last.left + last.width / 2 - (first.left + first.width / 2), dy = last.top + last.height / 2 - (first.top + first.height / 2), sc = last.width / first.width;
    tile.style.opacity = 0;
    const an = g.animate([{ transform: 'none', opacity: 1 }, { transform: 'translate(' + dx * 0.4 + 'px,' + (dy * 0.4 - 30) + 'px) rotate(-6deg) scale(1.08)', opacity: 1, offset: 0.4 },
      { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + sc + ')', opacity: 0.2 }], { duration: 520, easing: window.FX.EASE });
    an.onfinish = () => { g.remove(); tile.style.opacity = ''; done(); };
  }

  // ---------- packs ----------
  const packOfferGet = () => run.pack;
  const PIPS = r => '<span class="rflag" aria-hidden="true">' + '<i></i>'.repeat({ common: 1, uncommon: 2, rare: 3, legendary: 4 }[r] || 1) + '</span>';
  // o = { id, sq }; opts.compact for 5/8-card chests, opts.state 'sel' | 'taken' | 'blocked'
  function enhCard(o, i, opts) {
    opts = opts || {};
    const e = window.ENH[o.id], p = START[o.sq], cur = run.enh[o.sq], repl = cur && cur !== o.id && !opts.owned ? window.ENH[cur] : null;
    const cls = 'card r-' + e.rarity + ' enhcard' + (opts.compact ? ' compact' : '') + (opts.state ? ' ' + opts.state : '');
    return '<button class="' + cls + '" data-k="' + i + '" data-sq="' + o.sq + '" data-enh="' + o.id + '" style="--i:' + i + ';--tilt:' + (opts.compact ? 0 : (i - 1) * 3) + 'deg;--ec:' + e.color + '"' + (opts.state === 'taken' || opts.state === 'blocked' ? ' aria-disabled="true"' : '') +
      ' aria-label="' + PN(p.toLowerCase()) + ' ' + SQN(o.sq) + ': ' + e.name + ', ' + window.RARITY[e.rarity] + '">' +
      '<span class="cback" aria-hidden="true"></span>' +
      '<span class="card-in"><span class="cface"><span class="ctype">' + (opts.compact ? window.RARITY[e.rarity] : tx('g.upgrade')) + '</span><span class="cart enh-art"><img class="piece-art" src="vendor/pieces/cburnett/' + PC() + p.toUpperCase() + '.svg" alt="">' + PX(e.icon, (opts.compact ? 'i16' : 'i21') + ' eb') + '</span>' +
      '<span class="cname">' + e.name + '<br><small>' + PN(p.toLowerCase()) + ' ' + SQN(o.sq) + '</small></span>' +
      '<span class="cdesc">' + (opts.compact ? e.short : e.desc) + (repl && !opts.compact ? '<br><em>' + tx('g.replaces', { name: repl.name }) + '</em>' : '') + '</span>' + (repl && opts.compact ? '<span class="crepl">' + tx('g.insteadOf', { name: repl.name }) + '</span>' : '') +
      (opts.state === 'taken' ? '<span class="ctaken">' + PX('check', 'i21') + '</span>' : '') + '<span class="sheen"></span></span></span>' +
      PIPS(e.rarity) + (opts.compact ? '' : '<span class="crar">' + window.RARITY[e.rarity] + '</span>') + '</button>';
  }
  const PIECE_SQS = [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 61, 62, 63];
  const ENH_W = [{ common: 10, uncommon: 7, rare: 3, legendary: 1 }, { common: 9, uncommon: 7, rare: 4, legendary: 1.5 }, { common: 6, uncommon: 7, rare: 5, legendary: 2.5 }];
  function rollEnh(sq, exclude, size) {
    const t = START[sq].toLowerCase(), w = ENH_W[size] || ENH_W[0];
    const pool = Object.keys(window.ENH).filter(id => window.ENH[id].for.indexOf(t) !== -1 && id !== run.enh[sq] && exclude.indexOf(id) === -1);
    if (!pool.length) return null;
    // piece-specific upgrades (squire, catapult…) are the interesting ones: weight them up
    const wt = id => w[window.ENH[id].rarity] * (window.ENH[id].for.length === 1 ? 1.6 : 1);
    let x = Math.random() * pool.reduce((a, id) => a + wt(id), 0);
    for (const id of pool) { x -= wt(id); if (x <= 0) return id; }
    return pool[0];
  }
  // n cards = n of your pieces (mixed piece types, un-upgraded first) + a rolled upgrade each;
  // with fewer distinct pieces than n, the same pieces come back with a different upgrade.
  function rollEnhOffers(n, size) {
    const byType = {}; PIECE_SQS.forEach(sq => { const t = START[sq].toLowerCase(); (byType[t] = byType[t] || []).push(sq); });
    const interleave = list => { const g = {}; list.forEach(sq => { const t = START[sq].toLowerCase(); (g[t] = g[t] || []).push(sq); }); const groups = shuffle(Object.keys(g)).map(t => shuffle(g[t])), out = [];
      while (groups.some(x => x.length)) groups.forEach(x => { if (x.length) out.push(x.shift()); }); return out; };
    const order = interleave(PIECE_SQS.filter(sq => !run.enh[sq])).concat(interleave(PIECE_SQS.filter(sq => run.enh[sq])));
    const items = [], offered = {};
    for (let pass = 0; pass < 4 && items.length < n; pass++) {
      for (const sq of order) {
        if (items.length >= n) break;
        if (pass === 0 && offered[sq]) continue;
        const id = rollEnh(sq, offered[sq] || [], size); if (!id) continue;
        (offered[sq] = offered[sq] || []).push(id); items.push({ id, sq });
      }
    }
    return items;
  }
  function buyPack(k) {
    const bigN = d => (hasV('bigChest') ? d.n + 1 : d.n);
    const o = run.shop.packs[k]; if (!o || o.sold) return;
    const d = packDef(o), p = packPrice(d); if (run.gold < p) return;
    run.gold -= p; o.sold = true; shopBuys++;
    AN('chest_opened', { kind: o.kind, size: o.size, price: p, round: run.round });
    const el = document.querySelector('.chest[data-k="' + k + '"]');
    window.FX.sfx('open'); coinsOut(el || $('packs'), p);
    if (o.kind === 'hint') { run.items.hints += d.amount; toast(PX('bulb', 'i16') + ' ' + tx('g.plusHints', { n: d.amount })); if (el) window.FX.burstAt(el, { n: 16, colors: ['#fff3c4', '#eabc52', '#2899e4'] }); renderShop(); return; }
    if (o.kind === 'tactic') run.pack = { kind: 'tactic', k, items: shuffle(window.CONSUMABLES).slice(0, hasV('tacticPlus') ? 4 : 3).map(u => ({ id: u.id })) };
    else if (o.kind === 'relic') { const items = []; for (let i = 0; i < 3; i++) { const r = rollRelic(PACK_W, items.map(x => x.id)); if (r) items.push(r); } run.pack = { kind: 'relic', k, items: items.map(r => ({ id: r.id })) }; }
    else run.pack = { kind: 'enh', k, size: o.size, left: d.pick, items: rollEnhOffers(bigN(d), o.size) };
    packSel = -1;
    showPack(true);
    renderShop();
  }
  function showPack(anim) {
    const po = run.pack; if (!po) return;
    const d = packDef(run.shop.packs[po.k] || { kind: po.kind, size: 0 });
    let cards = '', title = d.name, sub = tx('g.pick1');
    if (po.kind === 'tactic') {
      const packOffer = { items: po.items.map(x => window.CONSUMABLES.find(c => c.id === x.id)).filter(Boolean) }; sub = tx('g.pickTrick');
      cards = packOffer.items.map((u, i) => '<button class="card r-' + u.rarity + '" data-k="' + i + '" style="--i:' + i + ';--tilt:' + ((i - 1) * 3) + 'deg"><span class="card-in"><span class="cface"><span class="ctype">' + tx('g.trick') + '</span>' +
        '<span class="cart">' + PX(u.icon, 'i48') + '</span><span class="cname">' + u.name + '</span><span class="cdesc">' + u.desc + '</span><span class="sheen"></span></span></span><span class="crar">' + window.RARITY[u.rarity] + '</span></button>').join('');
    } else if (po.kind === 'relic') {
      const items = po.items.map(x => window.RELIC(x.id)).filter(Boolean), full = run.relics.length >= slotsMax();
      sub = full ? tx('g.slotsFull') : tx('g.pickRelic');
      cards = items.map((r, i) => relicCard(r, { k: i, i, tilt: (i - 1) * 3 })).join('');
    } else {
      const total = d.pick || 1, left = po.left == null ? 1 : po.left, compact = po.items.length > 3;
      title = d.name + ' · ' + (d.size || tx('size.small'));
      sub = total > 1 ? tx('g.pickKofN', { k: total, n: po.items.length }) + ' · ' + tx('g.left', { n: left }) : tx('g.pick1ofN', { n: po.items.length });
      cards = po.items.map((x, i) => enhCard(x, i, { compact, state: x.taken ? 'taken' : po.items.some(y => y.taken && y.sq === x.sq) ? 'blocked' : i === packSel ? 'sel' : '' })).join('');
      if (META()) META().markSeen(po.items.map(x => 'enh:' + x.id));
    }
    const pk = $('pack'); pk.classList.remove('hidden'); pk.classList.toggle('opening', !!anim); pk.dataset.kind = po.kind;
    $('pack-anim').innerHTML = PX(d.icon, 'i64');
    pk.querySelector('.pack-title').textContent = title; pk.querySelector('.pack-sub').textContent = sub;
    $('pack-cards').innerHTML = cards;
    $('pack-cards').classList.toggle('deal', !!anim);
    $('pack-cards').dataset.n = po.items.length; $('pack-cards').classList.toggle('grid', po.kind === 'enh' && po.items.length > 3);
    renderPackDetail();
    const taken = po.kind === 'enh' && po.items.some(x => x.taken); $('pack-skip').textContent = taken ? tx('g.done') : tx('g.skip');
    setTimeout(() => {
      pk.classList.remove('opening');
      if (anim) { window.FX.juice('medium', { at: [innerWidth / 2, innerHeight * 0.42], sfx: 'open', colors: ['#c9b3f5', '#9c70ed', '#eabc52', '#ffffff'], spread: 160 }); window.FX.sfx('flip'); }
      const f = $('pack-cards').querySelector('.card'); if (f) f.focus({ preventScroll: true });
    }, window.FX.reduce || !anim ? 0 : 700);
  }
  // enh chests: first tap selects a card (details + an apply button below), a second tap or the button applies it
  let packSel = -1;
  function renderPackDetail() {
    const po = run.pack, el = $('pack-detail'); if (!el) return;
    const it = po && po.kind === 'enh' ? po.items[packSel] : null;
    if (!it) { el.classList.toggle('hidden', !(po && po.kind === 'enh')); el.innerHTML = po && po.kind === 'enh' ? '<p class="pd-hint">' + tx('g.tapCard') + '</p>' : ''; return; }
    const e = window.ENH[it.id], p = START[it.sq], cur = run.enh[it.sq];
    el.classList.remove('hidden');
    el.innerHTML = '<div class="pd-head">' + PX(e.icon, 'i21') + '<b>' + e.name + '</b><span class="pd-rar r-' + e.rarity + '">' + window.RARITY[e.rarity] + '</span><small>' + PN(p.toLowerCase()) + ' ' + SQN(it.sq) + '</small></div>' +
      '<p class="pd-desc">' + e.desc + (cur ? ' <em>' + tx('g.replaces', { name: window.ENH[cur].name }) + '.</em>' : '') + '</p>' +
      '<button class="btn btn-green pd-go" data-k="' + packSel + '">' + tx('g.apply') + '</button>';
  }
  function selectPack(i) {
    const po = run.pack, it = po && po.items[i]; if (!it || it.taken || po.items.some(y => y.taken && y.sq === it.sq)) return;
    if (packSel === i) return pickPack(i);
    packSel = i; window.FX.sfx('select');
    $('pack-cards').querySelectorAll('.card').forEach(c => c.classList.toggle('sel', +c.dataset.k === i));
    renderPackDetail();
  }
  function pickPack(i) {
    const packOffer = packOfferGet(); if (!packOffer) return;
    const raw = packOffer.items[i]; if (!raw) return;
    if (packOffer.kind === 'enh') {
      if (raw.taken || packOffer.items.some(y => y.taken && y.sq === raw.sq)) return;
      const e = window.ENH[raw.id], el = $('pack-cards').querySelector('.card[data-k="' + i + '"]');
      AN('chest_pick', { kind: 'enh', id: raw.id, sq: raw.sq });
      run.enh[raw.sq] = raw.id; raw.taken = true; packOffer.left = (packOffer.left == null ? 1 : packOffer.left) - 1; packSel = -1;
      run.lastPick = e.name + ' (' + PN(START[raw.sq].toLowerCase()) + ')';
      window.FX.sfx('upgrade');
      if (el) window.FX.juice('medium', { at: (r => [r.left + r.width / 2, r.top + r.height / 2])(el.getBoundingClientRect()), colors: [e.color, '#ffffff', '#eabc52'], spread: 90 });
      toast(PX(e.icon, 'i16') + ' ' + e.name + ': ' + PN(START[raw.sq].toLowerCase()) + ' ' + SQN(raw.sq));
      if (META()) META().markSeen(['enh:' + raw.id]);
      const more = packOffer.left > 0 && packOffer.items.some(y => !y.taken && !packOffer.items.some(z => z.taken && z.sq === y.sq));
      if (more) { showPack(false); renderShop(); return; }
      setTimeout(() => { if (run.pack === packOffer) { run.pack = null; $('pack').classList.add('hidden'); renderShop(); } }, window.FX.reduce ? 0 : 450);
      return;
    }
    const it = packOffer.kind === 'tactic' ? window.CONSUMABLES.find(c => c.id === raw.id) : packOffer.kind === 'relic' ? window.RELIC(raw.id) : raw;
    if (!it) return;
    AN('chest_pick', { kind: packOffer.kind, id: it.id });
    window.FX.sfx('buy');
    if (packOffer.kind === 'tactic') {
      if (it.id === 'undo') run.items.undo++; else if (it.id === 'confuse') run.items.confuse++; else if (it.id === 'hints2') run.items.hints += 2; else if (it.id === 'cash') { run.gold += 4; run.earned += 4; trig('cash'); } else run.next[it.id] = true;
      toast(PX(it.icon, 'i16') + ' ' + it.name);
    } else if (packOffer.kind === 'relic') {
      if (run.relics.length >= slotsMax()) { toast(tx('g.noSlots')); return; }
      addRelic(it); toast(relicArt(it, 'i16') + ' ' + tx('g.newRelic', { name: it.name }));
    } else {
      run.enh[it.sq] = it.id; toast(PX(window.ENH[it.id].icon, 'i16') + ' ' + window.ENH[it.id].name + ': ' + PN(START[it.sq].toLowerCase()) + ' ' + SQN(it.sq));
    }
    run.pack = null; $('pack').classList.add('hidden'); renderShop();
  }

  // ---------- wiring ----------
  function init() {
    addEventListener('resize', () => fitBoard());
    const onTap = e => {
      const t = e.target.closest('[data-act], .rtile[data-i]');
      if (!t || t.disabled) return;
      if (t.classList.contains('rtile')) return inspect('owned', +t.dataset.i, t.dataset.mode);
      inspect(t.dataset.act, t.dataset.act === 'enh' || t.dataset.act === 'owned-voucher' ? t.dataset.k : +t.dataset.k);
    };
    ['screen-shop', 'relics-game'].forEach(id => $(id).addEventListener('click', onTap));
    $('inspect').addEventListener('click', e => { if (e.target.id === 'inspect') closeInspect(); });
    $('btn-reroll').onclick = reroll;
    $('btn-next').onclick = () => { AN(shopBuys ? 'shop_leave' : 'shop_skip', { round: run.round, bought: shopBuys, gold: run.gold }); startGame(); };
    $('pack-cards').addEventListener('click', e => { const c = e.target.closest('.card'); if (!c) return; if (run.pack && run.pack.kind === 'enh') selectPack(+c.dataset.k); else pickPack(+c.dataset.k); });
    $('pack-detail').addEventListener('click', e => { const b = e.target.closest('.pd-go'); if (b) pickPack(+b.dataset.k); });
    $('pack-skip').onclick = () => { if (run.pack) AN('chest_skip', { kind: run.pack.kind, taken: run.pack.items.filter(x => x.taken).length }); run.pack = null; packSel = -1; $('pack').classList.add('hidden'); renderShop(); };
    $('status').addEventListener('click', () => { const h = $('status').dataset.enh; if (h) inspect('enh', h); });
    // board badge per enhancement: its pixel icon in the square's corner + glow colour
    const st = document.createElement('style');
    st.textContent = Object.keys(window.ENH).map(id => { const e = window.ENH[id]; return 'cg-board square.enh-' + id + '{--ec:' + e.color + ';--eb:url(' + window.PIX.url(e.icon) + ')}'; }).join('\n');
    document.head.appendChild(st);
    window.FX.initGL(); window.FX.tilt($('pack-cards')); window.FX.tilt($('shelf')); window.FX.tilt($('packs')); window.FX.tilt($('ins-body'));
    $('btn-hint').onclick = useHint; $('btn-confuse').onclick = useConfuse; $('btn-undo').onclick = undo;
    tool($('btn-resign'), PX('flag', 'i21'), tx('g.tResign'), null);
    document.querySelector('#hud .coin').outerHTML = COIN();
    $('btn-resign').onclick = () => { if (!game.over && !game.busy) modal('<h2>' + tx('g.resignQ') + '</h2><p>' + tx('g.resignText') + '</p>', [[tx('g.resignYes'), () => { game.over = true; game.anReason = 'resign'; showGameOver(why('resign')); }, 'danger'], [tx('g.no'), () => {}]]); };
    $('btn-restart').onclick = () => { if (META()) META().clearSave(); newRun(); };
    $('btn-over-menu').onclick = () => META().showMenu();
    addEventListener('keydown', e => { if (e.key === 'Escape' && !$('inspect').classList.contains('hidden')) { e.stopImmediatePropagation(); closeInspect(); } }, true);
    // language switched live: re-render whatever is on screen; the run state is language-free
    addEventListener('langchange', () => {
      tool($('btn-resign'), PX('flag', 'i21'), tx('g.tResign'), null);
      window.Talk.refresh();
      if (!$('inspect').classList.contains('hidden')) closeInspect();
      if (game && !$('screen-game').classList.contains('hidden')) {
        render(); renderGoal();
        if (!game.over && !game.busy && game.state.turn === 'w') setStatus(yourTurn());
      }
      if (run && !$('screen-shop').classList.contains('hidden')) renderShop();
      if (run && run.pack && !$('pack').classList.contains('hidden')) { showPack(false); renderPackDetail(); }
    });
    $('op-cards').addEventListener('click', e => { const c = e.target.closest('.card'); if (c) opSelect(+c.dataset.k); });
    $('op-detail').addEventListener('click', e => { const b = e.target.closest('.pd-go'); if (b) opPick(+b.dataset.k); });
    $('op-reroll').onclick = () => opDoReroll();
    $('op-menu').innerHTML = PX('menu', 'i21'); $('op-menu').onclick = () => $('btn-menu').click();
    addEventListener('langchange', () => { if (run && run.offer && !$('opening').classList.contains('hidden')) showOpening(false); });
    window.Bot.initStockfish();
    window.Meta.init();
  }
  // ---------- resume from a save (save-systems: restore at the boundary that was saved) ----------
  function resume(d) {
    run = d.run; pendingGold = 0; inPlayFlag = true;
    AN('run_resume', { round: run.round, screen: d.screen, tier: run.tier, side: run.side });
    if (d.screen === 'shop' && run.shop) { show('screen-shop'); renderShop(true); if (run.pack) showPack(false); }
    else if (d.screen === 'toShop') openShop();
    else if (d.screen === 'toShopNoRoll') { run.round--; openShop(); }
    else if (d.screen === 'opening' && run.offer) showOpening(false);
    else startGame();
  }
  function leave() {
    inPlayFlag = false;
    ['screen-game', 'screen-shop', 'screen-over'].forEach(id => $(id).classList.add('hidden'));
    ['pack', 'inspect', 'modal', 'toast', 'opening'].forEach(id => $(id).classList.add('hidden'));
    $('hud').classList.add('hidden');
    if (game) { game.over = true; }
    window.Talk.flush();
  }
  function where() {
    if (!run) return '';
    if (run.offer) return tx('op.where') + ' · $' + run.gold + ' · ' + tx(BLK() ? 'side.b' : 'side.w') + ' · ' + tx('tier.short', { n: tierN(), name: tx('tier.' + tierN()) });
    const sc = !$('screen-shop').classList.contains('hidden') ? tx('g.whereShop') : tx('g.whereGame');
    return tx('g.roundNofM', { n: run.round, m: window.RUN_ROUNDS }) + ' · ' + debutFor(run.round).name + ' · ' + sc + ' · $' + run.gold + ' · ' + tx(BLK() ? 'side.b' : 'side.w') + ' · ' + tx('tier.short', { n: tierN(), name: tx('tier.' + tierN()) });
  }
  window.Game = { newRun: o => newRun(o), get side() { return run ? run.side || 'w' : 'w'; }, get tier() { return tierN(); }, resume, leave, where, modal, toast, relicCard, inspectDef: id => inspect('def', id),
    inPlay: () => inPlayFlag && !!run && $('screen-over').classList.contains('hidden'),
    overlayOpen: () => !$('inspect').classList.contains('hidden'), modalOpen: () => !$('modal').classList.contains('hidden') || !$('pack').classList.contains('hidden'), closeOverlay: () => closeInspect(),
    saveNow: () => { if (!run || !inPlayFlag) return; if (run.offer && !$('opening').classList.contains('hidden')) { META().save(run, 'opening'); return; } if (!$('screen-shop').classList.contains('hidden')) META().save(run, 'shop'); else if (game && game.payout && game.over) META().save(run, 'toShop'); /* mid-round: the round-start save stands */ } };
  // test/debug hooks
  window.__game = { get run() { return run; }, get game() { return game; }, forceWin: reason => endGame({ winner: 'w', reason: reason || 'debug' }),
    startGame: () => startGame(), opening: { reroll: () => opDoReroll(), pick: i => opPick(i), select: i => opSelect(i), cost: () => opRerollCost() }, move: m => playerMove(m), doMove: m => doMove(m), T: { sellValue, relicPrice, rerollCost, slotsMax, visibleSet, engineTags, buyPack, rollRelic, hasV }, openShop: () => openShop(), giveRelic: id => addRelic(window.RELIC(id)), ups, endGame: r => endGame(r), packPrice, sellRelic: i => sellRelic(i), inspect, render: () => render(), shuffle, get pendingGold() { return pendingGold; } };
  window.__startApp = init;
})();
