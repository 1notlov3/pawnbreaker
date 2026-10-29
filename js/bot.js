// Bot: Stockfish (WASM, single-threaded Web Worker) for standard-ish positions,
// filtered against our custom legal moves; custom alpha-beta for variants / fallback.
(function () {
  'use strict';
  const R = window.Rules;
  let sf = null, sfReady = false, sfFailed = false, pending = null;
  const readyWaiters = [];

  function initStockfish() {
    try {
      sf = new Worker('vendor/stockfish/stockfish.js');
    } catch (e) { sfFailed = true; console.warn('Stockfish worker failed', e); return; }
    sf.onerror = e => { console.warn('Stockfish error', e.message || e); sfFailed = true; if (pending) { const p = pending; pending = null; p.resolve(null); } };
    sf.onmessage = ev => {
      const line = typeof ev.data === 'string' ? ev.data : String(ev.data);
      if (line === 'uciok') { sf.postMessage('setoption name MultiPV value 6'); sf.postMessage('isready'); }
      else if (line === 'readyok') { if (!sfReady) { sfReady = true; readyWaiters.splice(0).forEach(f => f()); } }
      else if (pending && line.startsWith('info') && line.indexOf(' pv ') !== -1) {
        const mpv = /multipv (\d+)/.exec(line); const pv = / pv (\S+)/.exec(line);
        if (pv) pending.cands[mpv ? +mpv[1] : 1] = pv[1];
      } else if (pending && line.startsWith('bestmove')) {
        const p = pending; pending = null; clearTimeout(p.timer);
        const best = line.split(' ')[1];
        const list = [best].concat(Object.keys(p.cands).sort((a, b) => a - b).map(k => p.cands[k]));
        p.resolve(list);
      }
    };
    sf.postMessage('uci');
  }

  function whenReady(ms) {
    return new Promise(res => {
      if (sfReady) return res(true);
      const t = setTimeout(() => res(false), ms);
      readyWaiters.push(() => { clearTimeout(t); res(true); });
    });
  }

  // ---------- t32: "thinking levels" — 8 difficulty tiers (Balatro-stake style: modifiers stack upwards) ----------
  // rnd: scale on the per-round random-move chance · skill: added to the round's Stockfish Skill Level (0–20)
  // depth: max search depth · ms: movetime · spread: chance to play the 2nd/3rd MultiPV line instead of the best
  // mods (cumulative): startGold, interestCap, queenLoss, reroll, bossBonus, lossPlus, noRandom
  const TIERS = [
    { id: 1, rnd: 1.0, skill: 0, depth: 8, ms: 500, spread: 0.35 },
    { id: 2, rnd: 0.8, skill: 2, depth: 10, ms: 700, spread: 0.28, mod: { startGold: -1 } },
    { id: 3, rnd: 0.62, skill: 4, depth: 11, ms: 900, spread: 0.22, mod: { interestCap: -1 } },
    { id: 4, rnd: 0.45, skill: 6, depth: 12, ms: 1100, spread: 0.16, mod: { queenLoss: 1 } },
    { id: 5, rnd: 0.3, skill: 9, depth: 13, ms: 1300, spread: 0.1, mod: { reroll: 1 } },
    { id: 6, rnd: 0.18, skill: 12, depth: 14, ms: 1500, spread: 0.06, mod: { bossBonus: -2 } },
    { id: 7, rnd: 0.08, skill: 15, depth: 15, ms: 1800, spread: 0.03, mod: { lossPlus: 1 } },
    { id: 8, rnd: 0, skill: 20, depth: 18, ms: 2500, spread: 0, mod: { noRandom: 1 } }
  ];
  // all modifiers in force at tier n (they stack, like Balatro stakes)
  function tierMods(n) { const m = { startGold: 0, interestCap: 0, queenLoss: 0, reroll: 0, bossBonus: 0, lossPlus: 0, noRandom: 0 }; TIERS.slice(0, Math.max(1, Math.min(8, n | 0 || 1))).forEach(t => { if (t.mod) Object.keys(t.mod).forEach(k => { m[k] += t.mod[k]; }); }); return m; }
  const tierOf = n => TIERS[Math.max(1, Math.min(8, n | 0 || 1)) - 1];
  // the engine settings a round of a tier really uses (exported for the tier table + tests)
  function params(level, tierN) {
    const T = tierOf(tierN), base = [0.7, 0.45, 0.3, 0.2, 0.12, 0.06][level - 1] || 0;
    return { randomP: tierMods(T.id).noRandom ? 0 : base * T.rnd,
      skill: Math.min(20, (level <= 2 ? 0 : (level - 2) * 2) + T.skill),
      depth: Math.min(T.depth, level === 1 && T.id < 3 ? 1 : level + T.id), ms: T.ms, spread: T.spread,
      customDepth: level <= 2 && T.id < 4 ? 1 : 2, noise: Math.max(0, 80 - level * 8) * (T.id >= 8 ? 0 : T.rnd || 0.1) };
  }
  window.TIERS = TIERS; window.tierMods = tierMods;

  async function stockfishCandidates(fen, skill, depth, ms) {
    if (sfFailed || !sf) return null;
    if (!(await whenReady(8000))) return null;
    return new Promise(resolve => {
      pending = { cands: {}, resolve, timer: setTimeout(() => { pending = null; sf.postMessage('stop'); resolve(null); }, 6000) };
      sf.postMessage('setoption name Skill Level value ' + skill);
      sf.postMessage('position fen ' + fen);
      sf.postMessage('go depth ' + depth + ' movetime ' + (ms || 1500));
    });
  }

  // ---------- custom search ----------
  function evaluate(s, ctx, color) {
    let score = 0;
    for (let i = 0; i < 64; i++) {
      const p = s.board[i]; if (!p) continue;
      let v = R.VALUES[R.typeOf(p)] * 100;
      if (R.typeOf(p) === 'p') v += (R.colorOf(p) === 'w' ? (6 - (i >> 3)) : ((i >> 3) - 1)) * 8;
      const c = (i & 7), r = (i >> 3); if (R.typeOf(p) !== 'k') v += (3.5 - Math.abs(3.5 - c)) * 3 + (3.5 - Math.abs(3.5 - r)) * 3;
      score += R.colorOf(p) === color ? v : -v;
    }
    if (ctx.variant === 'misere') score = -score; // fewer pieces is better
    const opp = color === 'w' ? 'b' : 'w', X = s.vx;
    if (ctx.variant === 'royalqueen') { const q = c => s.board.indexOf(c === 'w' ? 'Q' : 'q') !== -1 ? 1 : 0; score += (q(color) - q(opp)) * 3000; }
    else if (ctx.variant === 'threecheck' && X) score += (X.checks[color] - X.checks[opp]) * 250;
    else if (ctx.variant === 'hill') { const cd = k => { if (k < 0) return 0; const r = k >> 3, f = k & 7; return Math.max(Math.abs(3.5 - r), Math.abs(3.5 - f)); }; score += (cd(R.kingSq(s.board, opp)) - cd(R.kingSq(s.board, color))) * 30; }
    return score;
  }
  function search(s, ctx, depth, alpha, beta, color) {
    const legal = R.legalMoves(s, ctx);
    const res = R.gameResult(s, ctx, legal);
    if (res) { if (res.winner === null) return 0; return (res.winner === color ? 1 : -1) * (100000 + depth); }
    if (depth === 0) return evaluate(s, ctx, color);
    // captures first
    legal.sort((a, b) => (b.capture != null) - (a.capture != null));
    let best = -Infinity;
    for (const m of legal) {
      const n = R.applyMove(s, m, ctx).state;
      const v = -search(n, ctx, depth - 1, -beta, -alpha, color === 'w' ? 'b' : 'w');
      if (v > best) best = v; if (v > alpha) alpha = v; if (alpha >= beta) break;
    }
    return best;
  }
  function customMove(s, ctx, depth, noise) {
    const legal = R.legalMoves(s, ctx);
    if (!legal.length) return null;
    let best = null, bestV = -Infinity;
    for (const m of legal) {
      const n = R.applyMove(s, m, ctx).state;
      const v = -search(n, ctx, depth - 1, -Infinity, Infinity, s.turn === 'w' ? 'b' : 'w') + Math.random() * noise;
      if (v > bestV) { bestV = v; best = m; }
    }
    return best;
  }

  // Stockfish only knows standard chess. When the player has rule-changing enhancements (state.tags), a candidate is
  // rejected if it walks into a capture only those enhancements make possible (a knight's king-step, a catapult jump…)
  // or if it captures a mirror-upgraded piece that will just return home. Then the custom search, which sees tags, decides.
  // t32: the same guard covers move-changing relics (ctx.up) — Stockfish doesn't know a Centaur or a Camel either.
  const RULE_UPS = ['centaur', 'pilgrim', 'camel', 'templar', 'backstab', 'kingKnight', 'sidestep'];
  const plainCtx = ctx => { const up = Object.assign({}, ctx.up); RULE_UPS.forEach(k => delete up[k]); return Object.assign({}, ctx, { up }); };
  function tagTrap(s, m, ctx) {
    const tagged = s.tags && Object.keys(s.tags).length, ruled = RULE_UPS.some(k => ctx.up && ctx.up[k]);
    if (!tagged && !ruled) return false;
    const res = R.applyMove(s, m, ctx); if (res.mirrored) return true;
    const n = res.state; if (!ruled && (!n.tags || !Object.keys(n.tags).length)) return false;
    const plain = R.clone(n); delete plain.tags;
    const std = new Set(R.pseudoMoves(plain, plainCtx(ctx)).map(x => x.from * 64 + x.to));
    return R.legalMoves(n, ctx).some(x => !std.has(x.from * 64 + x.to) && x.capture != null && R.VALUES[R.typeOf(n.board[x.capture])] >= 3);
  }

  // v0.3 bosses. Stockfish plays standard chess, so for the new boss rules it only proposes candidates:
  // they must be legal under the rule, must not walk onto a mine, and must not hand the opponent an instant rule win.
  // A position Stockfish can't read (the side not to move "in check" by standard rules) goes straight to the custom search.
  const SF_OK = ['normal', 'fog', 'hill', 'threecheck', 'royalqueen', 'mines', 'masked', 'hourglass', 'pillar', 'forward', 'hydra'];
  const SPECIAL = ['hill', 'threecheck', 'royalqueen'];
  function sfReadable(s, ctx) {
    if (ctx.variant === 'normal' || ctx.variant === 'fog') return true;
    const plain = R.clone(s); delete plain.tags; delete plain.vx;
    const other = s.turn === 'w' ? 'b' : 'w';
    return !R.inCheck(plain, other, { variant: 'normal' });
  }
  function winNow(s, ctx, legal) {
    if (SPECIAL.indexOf(ctx.variant) === -1) return null;
    return legal.find(m => { const w = R.variantWin(R.applyMove(s, m, ctx).state, ctx); return w && w.winner === s.turn; }) || null;
  }
  function variantTrap(s, m, ctx) {
    const res = R.applyMove(s, m, ctx);
    if (res.mined) return true;
    if (SPECIAL.indexOf(ctx.variant) === -1) return false;
    const n = res.state;
    return R.legalMoves(n, ctx).some(r => { const w = R.variantWin(R.applyMove(n, r, ctx).state, ctx); return w && w.winner !== s.turn; });
  }

  // Main entry. level = game number (1..)
  async function chooseMove(s, ctx, level, forceRandom, tierN) {
    const legal = R.legalMoves(s, ctx);
    if (!legal.length) return { move: null, source: 'none' };
    // Difficulty curve: round 1 is a clueless bot (70% random moves on tier 1), then it ramps up; the tier scales everything.
    const P = params(level, tierN || 1);
    if (forceRandom || Math.random() < P.randomP) {
      await new Promise(r => setTimeout(r, 200));
      return { move: legal[Math.floor(Math.random() * legal.length)], source: 'random' };
    }
    const win = winNow(s, ctx, legal);
    if (win) return { move: win, source: 'rule' };
    const standardish = SF_OK.indexOf(ctx.variant) !== -1 && sfReadable(s, ctx);
    if (standardish) {
      const fen = R.toFEN(s);
      const fenOk = !window.ChessJS || window.ChessJS.validateFen(fen).ok; // chess.js guards Stockfish against odd positions
      const cands = fenOk ? await stockfishCandidates(fen, P.skill, P.depth, P.ms) : null;
      if (cands) {
        const ok = [];
        for (const u of cands) {
          const m = legal.find(x => R.moveToUci(x) === u || (R.moveToUci(x).slice(0, 4) === u.slice(0, 4) && u.length === 5 && x.promo));
          if (m && ok.indexOf(m) === -1 && !tagTrap(s, m, ctx) && !variantTrap(s, m, ctx)) ok.push(m);
          if (ok.length >= 3) break;
        }
        // MultiPV randomness: lower tiers sometimes play the 2nd or 3rd line
        if (ok.length) { const k = ok.length > 1 && Math.random() < P.spread ? 1 + Math.floor(Math.random() * (ok.length - 1)) : 0; return { move: ok[k], source: 'stockfish' }; }
      }
    }
    const depth = P.customDepth, noise = P.noise;
    await new Promise(r => setTimeout(r, 30));
    return { move: customMove(s, ctx, depth, noise), source: 'custom' };
  }

  // Best move for the side to move (used for player hints): full-strength Stockfish, filtered by custom rules.
  async function hint(s, ctx) {
    const legal = R.legalMoves(s, ctx);
    if (!legal.length) return null;
    const win = winNow(s, ctx, legal);
    if (win) return win;
    if (SF_OK.indexOf(ctx.variant) !== -1 && sfReadable(s, ctx)) {
      const fen = R.toFEN(s);
      if (!window.ChessJS || window.ChessJS.validateFen(fen).ok) {
        const cands = await stockfishCandidates(fen, 20, 12);
        if (cands) for (const u of cands) {
          const m = legal.find(x => R.moveToUci(x) === u || (R.moveToUci(x).slice(0, 4) === u.slice(0, 4) && u.length === 5 && x.promo));
          if (m && !variantTrap(s, m, ctx)) return m;
        }
      }
    }
    return customMove(s, ctx, 2, 0);
  }
  window.Bot = { params, tierMods, TIERS, tagTrap, variantTrap, SF_OK, initStockfish, chooseMove, hint, isStockfishReady: () => sfReady, isStockfishFailed: () => sfFailed };
})();
