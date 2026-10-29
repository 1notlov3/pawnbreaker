// Rules engine: standard chess + player upgrades + boss variants.
// Board: array of 64, index = row*8 + col, row 0 = rank 8 (top). Uppercase = White, lowercase = Black.
(function () {
  'use strict';
  const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const KN = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
  const KG = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  const ORTH = [[-1,0],[1,0],[0,-1],[0,1]];
  const DIAG = [[-1,-1],[-1,1],[1,-1],[1,1]];
  const DAB = [[-2,0],[2,0],[0,-2],[0,2]];   // t32 Camel relic: a knight's extra 2-square straight leap
  const ALF = [[-2,-2],[-2,2],[2,-2],[2,2]]; // t32 Dragon upgrade: a 2-square diagonal leap

  const colorOf = p => (p ? (p === p.toUpperCase() ? 'w' : 'b') : null);
  const typeOf = p => (p ? p.toLowerCase() : null);
  const rc = i => [i >> 3, i & 7];
  const idx = (r, c) => r * 8 + c;
  const on = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const sqName = i => 'abcdefgh'[i & 7] + (8 - (i >> 3));
  const sqIndex = s => idx(8 - parseInt(s[1], 10), s.charCodeAt(0) - 97);

  function initialState() {
    const rows = ['rnbqkbnr', 'pppppppp', '........', '........', '........', '........', 'PPPPPPPP', 'RNBQKBNR'];
    const board = [];
    rows.forEach(r => r.split('').forEach(ch => board.push(ch === '.' ? null : ch)));
    return { board, turn: 'w', castle: { K: true, Q: true, k: true, q: true }, ep: null, half: 0, full: 1 };
  }
  function clone(s) {
    const n = { board: s.board.slice(), turn: s.turn, castle: Object.assign({}, s.castle), ep: s.ep, half: s.half, full: s.full };
    if (s.tags) n.tags = Object.assign({}, s.tags);
    if (s.vx) n.vx = cloneVx(s.vx);
    return n;
  }
  // v0.3 boss state (state.vx): checks given, minefield, last-moved squares, player move count, hydra revivals
  function cloneVx(x) {
    return { checks: Object.assign({ w: 0, b: 0 }, x.checks), mines: (x.mines || []).slice(), last: Object.assign({ w: null, b: null }, x.last), wMoves: x.wMoves || 0, rev: x.rev || 0 };
  }
  function initVx(variant, mines) { return { checks: { w: 0, b: 0 }, mines: variant === 'mines' ? (mines || []).slice() : [], last: { w: null, b: null }, wMoves: 0, rev: 0 }; }
  const HILL = [27, 28, 35, 36];          // d5 e5 d4 e4 (internal)
  const HOURGLASS = 40;                   // player moves allowed against the hourglass boss
  const HYDRA = 3;                        // revivals for the hydra boss
  const HYDRA_HOME = { n: [1, 6], b: [2, 5], r: [0, 7], q: [3] };
  // No retreat: a non-king piece may never move to a row behind it (from its owner's point of view)
  const backward = (ctx, color, from, to) => !!(ctx && ctx.variant === 'forward') && (color === 'w' ? (to >> 3) > (from >> 3) : (to >> 3) < (from >> 3));
  const has = (ctx, id) => !!(ctx && ctx.up && ctx.up[id]);
  // Per-piece enhancements that change the rules live in state.tags = { square: { id, home } } (White pieces only).
  // They travel with the piece in applyMove, so the bot's own search sees them several plies deep.
  const tagOf = (tags, board, i) => (tags && tags[i] && board[i] && colorOf(board[i]) === 'w' ? tags[i].id : null);
  // Catapult: a rook that may jump over exactly one piece (any colour) along a file or rank.
  function jumpTargets(board, r, f) {
    const out = [];
    ORTH.forEach(([dr, df]) => {
      let rr = r + dr, ff = f + df, screen = false;
      while (on(rr, ff)) {
        const q = board[idx(rr, ff)];
        if (!screen) { if (q) screen = true; }
        else { out.push([idx(rr, ff), q]); if (q) break; }
        rr += dr; ff += df;
      }
    });
    return out;
  }

  // Squares attacked by piece on i (for check detection)
  function attacksFrom(board, i, ctx, tags) {
    const p = board[i]; const t = typeOf(p); const c = colorOf(p); const [r, f] = rc(i); const out = [];
    const tg = tagOf(tags, board, i);
    const white = c === 'w';
    const step = list => list.forEach(([dr, df]) => { if (on(r + dr, f + df)) out.push(idx(r + dr, f + df)); });
    const slide = list => list.forEach(([dr, df]) => {
      let rr = r + dr, ff = f + df;
      while (on(rr, ff)) { out.push(idx(rr, ff)); if (board[idx(rr, ff)]) break; rr += dr; ff += df; }
    });
    if (t === 'p') { const d = white ? -1 : 1; [-1, 1].forEach(df => { if (on(r + d, f + df)) out.push(idx(r + d, f + df)); });
      if (white && has(ctx, 'backstab')) [-1, 1].forEach(df => { if (on(r + 1, f + df)) out.push(idx(r + 1, f + df)); });
      if (tg === 'archer' && on(r + d, f)) out.push(idx(r + d, f)); }
    else if (t === 'n') { step(KN); if (white && has(ctx, 'centaur')) step(KG); if (white && has(ctx, 'camel')) step(DAB); if (tg === 'dragon') step(ALF); }
    else if (t === 'b') { slide(DIAG); if (white && has(ctx, 'pilgrim')) step(ORTH); if (tg === 'archbishop') step(KN); }
    else if (t === 'r') { slide(ORTH); if (white && has(ctx, 'templar')) step(DIAG); if (tg === 'chancellor') step(KN); }
    else if (t === 'q') { slide(ORTH); slide(DIAG); }
    else if (t === 'k') { if (!(ctx && ctx.variant === 'atomic')) { step(KG); if (white && has(ctx, 'kingKnight')) step(KN); } }
    if (tg === 'squire' && t === 'n' && !has(ctx, 'centaur')) step(KG);
    else if (tg === 'monk' && t === 'b' && !has(ctx, 'pilgrim')) step(ORTH);
    else if (tg === 'amazon' && t === 'q') step(KN);
    else if (tg === 'catapult' && t === 'r') jumpTargets(board, r, f).forEach(([j]) => out.push(j));
    else if (tg === 'retreat' && t === 'p') [-1, 1].forEach(df => { if (on(r + 1, f + df)) out.push(idx(r + 1, f + df)); });
    if (t !== 'k' && ctx && ctx.variant === 'forward') return out.filter(j => !backward(ctx, c, i, j));
    return out;
  }
  function isAttacked(board, sq, byColor, ctx, tags) {
    for (let i = 0; i < 64; i++) {
      const p = board[i];
      if (p && colorOf(p) === byColor && attacksFrom(board, i, ctx, tags).indexOf(sq) !== -1) return true;
    }
    return false;
  }
  const kingSq = (board, color) => board.indexOf(color === 'w' ? 'K' : 'k');
  function inCheck(s, color, ctx) {
    if (ctx && ctx.variant === 'misere') return false;
    const k = kingSq(s.board, color);
    if (k < 0) return false;
    return isAttacked(s.board, k, color === 'w' ? 'b' : 'w', ctx, s.tags);
  }

  function promoRow(color, ctx) {
    if (color === 'w') return has(ctx, 'earlyPromo') ? 2 : 0; // row 2 = rank 6
    return 7;
  }
  // Can the piece on `to` be captured? (Sanctuary protects White non-king pieces)
  function protectedSq(board, to, ctx) {
    return ctx && ctx.sanctuary != null && to === ctx.sanctuary && board[to] && board[to] !== 'K' && colorOf(board[to]) === 'w';
  }

  function pseudoMoves(s, ctx) {
    const b = s.board, me = s.turn, opp = me === 'w' ? 'b' : 'w', out = [], T = s.tags;
    const white = me === 'w', V = ctx && ctx.variant;
    const locked = V === 'pillar' && s.vx ? s.vx.last[me] : null; // boss: the piece that just moved must rest
    const add = (from, to, extra) => {
      const m = Object.assign({ from, to, capture: b[to] ? to : null }, extra || {});
      if (m.capture != null && protectedSq(b, m.capture, ctx)) return;
      if (m.capture != null && !white && typeOf(b[from]) === 'p' && tagOf(T, b, m.capture) === 'armor') return; // armor: pawns cannot take it
      if (V && typeOf(b[from]) !== 'k' && backward(ctx, me, from, to)) return;             // boss: no retreat
      if (V === 'mines' && typeOf(b[from]) === 'k' && s.vx && s.vx.mines.indexOf(to) !== -1) return; // kings don't step on mines
      out.push(m);
    };
    for (let i = 0; i < 64; i++) {
      const p = b[i]; if (!p || colorOf(p) !== me) continue;
      const t = typeOf(p); const [r, f] = rc(i), tg = white ? tagOf(T, b, i) : null;
      if (i === locked && t !== 'k') continue;
      const stepTo = list => list.forEach(([dr, df]) => {
        const rr = r + dr, ff = f + df; if (!on(rr, ff)) return; const q = b[idx(rr, ff)];
        if (!q || colorOf(q) === opp) add(i, idx(rr, ff));
      });
      const slide = list => list.forEach(([dr, df]) => {
        let rr = r + dr, ff = f + df;
        while (on(rr, ff)) { const q = b[idx(rr, ff)]; if (q) { if (colorOf(q) === opp) add(i, idx(rr, ff)); break; } add(i, idx(rr, ff)); rr += dr; ff += df; }
      });
      if (t === 'p') {
        const d = white ? -1 : 1, start = white ? 6 : 1, pr = tg === 'early' ? Math.max(2, promoRow(me, ctx)) : promoRow(me, ctx);
        const promo = rr => (white ? rr <= pr : rr === pr) ? (white ? 'Q' : 'q') : undefined;
        if (on(r + d, f) && !b[idx(r + d, f)]) {
          add(i, idx(r + d, f), { promo: promo(r + d) });
          const canDouble = r === start || (white && (has(ctx, 'sprint') || tg === 'sprinter'));
          if (canDouble && on(r + 2 * d, f) && !b[idx(r + 2 * d, f)] && !promo(r + d)) add(i, idx(r + 2 * d, f), { promo: promo(r + 2 * d), double: idx(r + d, f) });
        }
        [-1, 1].forEach(df => {
          const rr = r + d, ff = f + df; if (!on(rr, ff)) return; const to = idx(rr, ff); const q = b[to];
          if (q && colorOf(q) === opp) add(i, to, { promo: promo(rr) });
          else if (s.ep === to) { const capSq = idx(r, ff); if (b[capSq] && typeOf(b[capSq]) === 'p' && colorOf(b[capSq]) === opp) add(i, to, { capture: capSq, enpassant: true }); }
        });
        // t32 rule-bending pawn relics / upgrades (player only)
        if (white && has(ctx, 'backstab')) [-1, 1].forEach(df => { if (!on(r + 1, f + df)) return; const q = b[idx(r + 1, f + df)]; if (q && colorOf(q) === opp) add(i, idx(r + 1, f + df)); });
        if (white && has(ctx, 'sidestep')) [-1, 1].forEach(df => { if (on(r, f + df) && !b[idx(r, f + df)]) add(i, idx(r, f + df), { side: true }); });
        if (tg === 'archer' && on(r + d, f) && b[idx(r + d, f)] && colorOf(b[idx(r + d, f)]) === opp) add(i, idx(r + d, f), { promo: promo(r + d) });
        if (tg === 'retreat' && on(r + 1, f)) { // retreat: once per game one step back, or a capture diagonally back
          if (!b[idx(r + 1, f)]) add(i, idx(r + 1, f), { retreat: true });
          if (!has(ctx, 'backstab')) [-1, 1].forEach(df => { if (!on(r + 1, f + df)) return; const q = b[idx(r + 1, f + df)]; if (q && colorOf(q) === opp) add(i, idx(r + 1, f + df), { retreat: true }); });
        }
      } else if (t === 'n') { stepTo(KN); if (white && has(ctx, 'centaur')) stepTo(KG); if (white && has(ctx, 'camel')) stepTo(DAB); if (tg === 'dragon') stepTo(ALF); }
      else if (t === 'b') { slide(DIAG); if (white && has(ctx, 'pilgrim')) stepTo(ORTH); if (tg === 'archbishop') stepTo(KN); }
      else if (t === 'r') { slide(ORTH); if (white && has(ctx, 'templar')) stepTo(DIAG); if (tg === 'chancellor') stepTo(KN); }
      else if (t === 'q') { slide(ORTH); slide(DIAG); }
      if (tg === 'squire' && t === 'n' && !has(ctx, 'centaur')) stepTo(KG);
      else if (tg === 'monk' && t === 'b' && !has(ctx, 'pilgrim')) stepTo(ORTH);
      else if (tg === 'amazon' && t === 'q') stepTo(KN);
      else if (tg === 'catapult' && t === 'r') jumpTargets(b, r, f).forEach(([j, q]) => { if (!q || colorOf(q) === opp) add(i, j, { jump: true }); });
      if (t === 'k') {
        stepTo(KG); if (white && has(ctx, 'kingKnight') && !(ctx && ctx.variant === 'atomic')) stepTo(KN);
        if (!(ctx && ctx.variant === 'misere')) {
          const row = white ? 7 : 0, K = white ? 'K' : 'k', R = white ? 'R' : 'r';
          if (i === idx(row, 4) && !inCheck(s, me, ctx)) {
            if (s.castle[white ? 'K' : 'k'] && b[idx(row, 7)] === R && !b[idx(row, 5)] && !b[idx(row, 6)] &&
                !isAttacked(b, idx(row, 5), opp, ctx, T) && !isAttacked(b, idx(row, 6), opp, ctx, T)) add(i, idx(row, 6), { castle: 'K' });
            if (s.castle[white ? 'Q' : 'q'] && b[idx(row, 0)] === R && !b[idx(row, 1)] && !b[idx(row, 2)] && !b[idx(row, 3)] &&
                !isAttacked(b, idx(row, 3), opp, ctx, T) && !isAttacked(b, idx(row, 2), opp, ctx, T)) add(i, idx(row, 2), { castle: 'Q' });
          }
        }
      }
    }
    return out;
  }

  // Apply a move; returns { state, captured: [pieces], exploded: [squares] }
  function applyMove(s, m, ctx) {
    const n = clone(s), b = n.board, p = b[m.from], me = s.turn, white = me === 'w';
    const captured = [], exploded = [];
    // Steel enhancement: a shielded white piece survives one capture, the attacker just loses its move.
    if (m.capture != null && ctx && ctx.steel && ctx.steel.indexOf(m.capture) !== -1 && colorOf(b[m.capture]) === 'w' && !white) {
      n.ep = null; n.half = s.half + 1; n.full = s.full + 1; n.turn = 'w';
      return { state: n, captured, exploded, blocked: m.capture };
    }
    const T = n.tags; let mirrored = null;
    const mirrorTag = !white && m.capture != null && T && tagOf(T, b, m.capture) === 'mirror' && !(ctx && ctx.variant === 'misere') ? T[m.capture] : null;
    const victim = m.capture != null ? b[m.capture] : null;
    if (m.capture != null && b[m.capture]) { captured.push(b[m.capture]); b[m.capture] = null; }
    b[m.to] = m.promo ? m.promo : p; b[m.from] = null;
    if (T) { // tags travel with their piece; a captured piece loses its tag
      const mv = T[m.from]; if (m.capture != null) delete T[m.capture]; delete T[m.from];
      if (mv && white) { if (m.retreat) delete T[m.to]; else T[m.to] = mv; } // retreat is spent once used
      if (m.castle && white) { const a = m.castle === 'K' ? 63 : 56, c2 = m.castle === 'K' ? 61 : 59; if (T[a]) { T[c2] = T[a]; delete T[a]; } }
    }
    // mirror: once per game a captured piece goes back to its start square instead (if free and it would not check the bot's king)
    if (mirrorTag && mirrorTag.home != null && !b[mirrorTag.home]) {
      b[mirrorTag.home] = victim;
      const k = kingSq(b, 'b');
      if (k >= 0 && attacksFrom(b, mirrorTag.home, ctx, T).indexOf(k) !== -1) b[mirrorTag.home] = null;
      else { captured.pop(); mirrored = { from: m.capture, to: mirrorTag.home }; }
    }
    if (m.castle) {
      const row = white ? 7 : 0;
      if (m.castle === 'K') { b[idx(row, 5)] = b[idx(row, 7)]; b[idx(row, 7)] = null; }
      else { b[idx(row, 3)] = b[idx(row, 0)]; b[idx(row, 0)] = null; }
    }
    if (ctx && ctx.variant === 'atomic' && captured.length) {
      // explosion: capturing piece and all adjacent non-pawns vanish
      exploded.push(m.to); b[m.to] = null;
      const [r, f] = rc(m.to);
      KG.forEach(([dr, df]) => {
        if (!on(r + dr, f + df)) return; const j = idx(r + dr, f + df);
        if (b[j] && typeOf(b[j]) !== 'p' && !(b[j] === 'K' && has(ctx, 'sapper'))) { captured.push(b[j]); exploded.push(j); b[j] = null; if (T) delete T[j]; }
      });
      if (T) delete T[m.to];
    }
    // castling rights
    const touch = sq => {
      if (sq === 60) { n.castle.K = n.castle.Q = false; } if (sq === 4) { n.castle.k = n.castle.q = false; }
      if (sq === 63) n.castle.K = false; if (sq === 56) n.castle.Q = false; if (sq === 7) n.castle.k = false; if (sq === 0) n.castle.q = false;
    };
    touch(m.from); touch(m.to); exploded.forEach(touch);
    n.ep = m.double != null ? m.double : null;
    n.half = (typeOf(p) === 'p' || captured.length) ? 0 : s.half + 1;
    if (!white) n.full = s.full + 1;
    n.turn = white ? 'b' : 'w';
    // ---- v0.3 boss rules ----
    let mined = null, revived = null;
    const V = ctx && ctx.variant, X = n.vx;
    if (X && V) {
      if (V === 'mines' && X.mines.indexOf(m.to) !== -1 && b[m.to]) { // the piece that lands on a mine is destroyed, the mine is spent
        mined = b[m.to]; b[m.to] = null; if (T) delete T[m.to]; exploded.push(m.to); X.mines = X.mines.filter(q => q !== m.to);
      }
      if (V === 'pillar') X.last[me] = m.to;
      if (V === 'hourglass' && white) X.wMoves++;
      if (V === 'threecheck' && inCheck(n, white ? 'b' : 'w', ctx)) X.checks[me]++;
      if (V === 'hydra' && white && X.rev < HYDRA) {
        const vt = captured.length ? typeOf(captured[0]) : null, homes = vt && HYDRA_HOME[vt];
        if (homes && colorOf(captured[0]) === 'b') {
          const K = kingSq(b, 'w');
          for (const h of homes) {
            if (b[h]) continue;
            b[h] = captured[0];
            if (K >= 0 && attacksFrom(b, h, ctx, T).indexOf(K) !== -1) { b[h] = null; continue; } // never revive with check
            X.rev++; revived = { sq: h, piece: captured[0] }; break;
          }
        }
      }
    }
    return { state: n, captured, exploded, mirrored, mined, revived };
  }

  function legalMoves(s, ctx) {
    const v = ctx ? ctx.variant : 'normal';
    let ms = pseudoMoves(s, ctx);
    if (v === 'misere') {
      const caps = ms.filter(m => m.capture != null);
      return caps.length ? caps : ms;
    }
    const me = s.turn, opp = me === 'w' ? 'b' : 'w';
    return ms.filter(m => {
      const n = applyMove(s, m, ctx).state;
      const myK = kingSq(n.board, me);
      if (myK < 0) return false;
      if (v === 'atomic' && kingSq(n.board, opp) < 0) return true;
      return !isAttacked(n.board, myK, opp, ctx, n.tags);
    });
  }

  // Result for the side to move: null (ongoing) or { winner: 'w'|'b'|null, reason }
  function gameResult(s, ctx, legal) {
    const v = ctx ? ctx.variant : 'normal', me = s.turn, opp = me === 'w' ? 'b' : 'w';
    const mine = s.board.filter(p => p && colorOf(p) === me).length;
    if (v === 'misere') {
      if (mine === 0) return { winner: me, reason: 'allGiven' };
      if (!legal.length) return { winner: me, reason: 'noMoves' };
    } else {
      if (kingSq(s.board, me) < 0) return { winner: opp, reason: 'kingExploded' };
      const vw = variantWin(s, ctx); if (vw) return vw;
      if (!legal.length) return inCheck(s, me, ctx) ? { winner: opp, reason: 'mate' } : { winner: null, reason: 'stalemate' };
      if (s.board.every(p => !p || typeOf(p) === 'k')) return { winner: null, reason: 'kingsOnly' };
      if (v === 'hourglass' && me === 'w' && s.vx && s.vx.wMoves >= HOURGLASS) return { winner: 'b', reason: 'hourglass' };
    }
    if (s.half >= 100) return { winner: null, reason: 'fifty' };
    if (s.full > 150) return { winner: null, reason: 'moveLimit' };
    return null;
  }

  // Cheap boss win conditions that don't need the move list (also used by the bot's guards).
  function variantWin(s, ctx) {
    const v = ctx && ctx.variant, me = s.turn, opp = me === 'w' ? 'b' : 'w';
    if (v === 'hill') {
      if (HILL.indexOf(kingSq(s.board, opp)) !== -1) return { winner: opp, reason: 'hill' };
      if (HILL.indexOf(kingSq(s.board, me)) !== -1) return { winner: me, reason: 'hill' };
    } else if (v === 'threecheck' && s.vx) {
      if (s.vx.checks[opp] >= 3) return { winner: opp, reason: 'threeChecks' };
      if (s.vx.checks[me] >= 3) return { winner: me, reason: 'threeChecks' };
    } else if (v === 'royalqueen') {
      const hasQ = c => s.board.indexOf(c === 'w' ? 'Q' : 'q') !== -1;
      if (!hasQ(me)) return { winner: opp, reason: 'queenLost' };
      if (!hasQ(opp)) return { winner: me, reason: 'queenLost' };
    }
    return null;
  }

  function toFEN(s) {
    let rows = [];
    for (let r = 0; r < 8; r++) {
      let row = '', e = 0;
      for (let f = 0; f < 8; f++) { const p = s.board[idx(r, f)]; if (!p) e++; else { if (e) { row += e; e = 0; } row += p; } }
      if (e) row += e; rows.push(row);
    }
    const b = s.board; let c = '';
    if (s.castle.K && b[60] === 'K' && b[63] === 'R') c += 'K';
    if (s.castle.Q && b[60] === 'K' && b[56] === 'R') c += 'Q';
    if (s.castle.k && b[4] === 'k' && b[7] === 'r') c += 'k';
    if (s.castle.q && b[4] === 'k' && b[0] === 'r') c += 'q';
    return rows.join('/') + ' ' + s.turn + ' ' + (c || '-') + ' ' + (s.ep != null ? sqName(s.ep) : '-') + ' ' + s.half + ' ' + s.full;
  }
  const moveToUci = m => sqName(m.from) + sqName(m.to) + (m.promo ? m.promo.toLowerCase() : '');

  window.Rules = { tagOf, VALUES, colorOf, typeOf, sqName, sqIndex, initialState, clone, attacksFrom, isAttacked, inCheck,
    pseudoMoves, legalMoves, applyMove, gameResult, toFEN, moveToUci, kingSq,
    variantWin, initVx, HILL, HOURGLASS, HYDRA };
})();
