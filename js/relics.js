// Content: relics (our "jokers"), piece enhancements, packs, vouchers, consumables, bosses, openings.
// Gold is the only currency: captures earn it, losing pieces costs it, relics bend both.
(function () {
  'use strict';
  const PRICE = { common: 5, uncommon: 7, rare: 9, legendary: 12 };
  // Gold-only economy. In-game effects (captures / losses / extra moves) live in game.js and read the relic COUNT,
  // where the Mirror relic adds one extra copy of the relic to its right. win(S) hooks pay after a won game, left → right.
  const R = [
    // --- pieces & rules ---
    { id: 'sprint', rarity: 'common', art: 'wP', cat: 'piece' },
    { id: 'pilgrim', rarity: 'common', art: 'wB', cat: 'piece' },
    { id: 'centaur', rarity: 'uncommon', art: 'wN', cat: 'piece' },
    { id: 'earlyPromo', rarity: 'rare', art: 'wQ', cat: 'rule' },
    { id: 'undo', rarity: 'common', icon: 'undo', cat: 'rule' },
    { id: 'blitz', rarity: 'rare', icon: 'blitz', cat: 'rule' },
    // --- debuffs for the bot's army ---
    { id: 'handicap', rarity: 'rare', art: 'bN', cat: 'debuff', stack: 3 },
    { id: 'siege', rarity: 'rare', icon: 'siege', cat: 'debuff' },
    // --- shields & the loss penalty ---
    { id: 'insurance', rarity: 'common', icon: 'insurance', cat: 'defense' },
    { id: 'martyr', rarity: 'common', icon: 'martyr', cat: 'defense' },
    { id: 'bastion', rarity: 'uncommon', icon: 'bastion', cat: 'defense' },
    { id: 'revenge', rarity: 'uncommon', icon: 'revenge', cat: 'defense' },
    { id: 'phalanx', rarity: 'common', icon: 'phalanx', cat: 'defense',
      win: s => Math.floor(s.pawnsLeft / 2) ? { gold: Math.floor(s.pawnsLeft / 2), note: tx('note.pawns', { n: s.pawnsLeft }) } : null },
    { id: 'castle', rarity: 'uncommon', icon: 'castle', cat: 'defense',
      win: s => s.castled ? { gold: 4 } : null },
    // --- board tiles ---
    { id: 'sanctuary', rarity: 'uncommon', icon: 'sanctuary', cat: 'board' },
    { id: 'treasure', rarity: 'common', icon: 'treasure', cat: 'board' },
    // --- capture gold ---
    { id: 'butcher', rarity: 'common', icon: 'butcher', cat: 'capture' },
    { id: 'debut', rarity: 'common', icon: 'debut', cat: 'debut' },
    { id: 'marauder', rarity: 'uncommon', icon: 'bag', cat: 'capture' },
    { id: 'stable', rarity: 'uncommon', icon: 'stable', cat: 'growth', grows: true },
    { id: 'glass', rarity: 'rare', icon: 'glass', cat: 'risk' },
    // --- economy ---
    { id: 'piggy', rarity: 'common', icon: 'piggy', cat: 'economy', win: () => ({ gold: 3 }) },
    { id: 'miser', rarity: 'uncommon', icon: 'miser', cat: 'economy',
      win: s => Math.min(4, Math.floor(s.gold / 8)) ? { gold: Math.min(4, Math.floor(s.gold / 8)), note: '$' + s.gold } : null },
    { id: 'broker', rarity: 'uncommon', icon: 'broker', cat: 'economy' },
    { id: 'collector', rarity: 'legendary', icon: 'collector', cat: 'economy',
      win: s => s.relicCount > 1 ? { gold: 2 * (s.relicCount - 1), note: tx('note.pcs', { n: s.relicCount - 1 }) } : null },
    { id: 'mirror', rarity: 'legendary', icon: 'mirror', cat: 'copy' },
    // --- boss ---
    { id: 'hunter', rarity: 'uncommon', icon: 'hunter', cat: 'boss',
      win: s => s.boss ? { gold: 5 } : null },
    { id: 'lantern', rarity: 'uncommon', icon: 'lantern', cat: 'boss' },
    { id: 'sapper', rarity: 'uncommon', icon: 'sapper', cat: 'boss' },
    { id: 'jester', rarity: 'uncommon', icon: 'jester', cat: 'boss' },

    // ===== t32: +45 relics. Hooks (called by game.js for every owned copy; Mirror counts as a copy):
    //   cap(e)  per bot piece you take  → gold        e = {by, victim, m, k (n-th capture this game), botLeft, variant, run, st}
    //   move(e) after each of your moves → gold       e = {by, m, check, discovered, to, toRow, ply, botLeft, st}
    //   loss(e) per piece you lose      → {free, bonus, cap}   e = {t, by, nearKing, ply, paid, st}
    //   start(e) when a game starts (debuffs)          e = {state, ctx, boss}
    //   win(S, rec) after a won game    → {gold, note}
    // Internal board: you are always uppercase on rows 6–7; row 2 is your 6th rank.
    // --- economy ---
    { id: 'streak', rarity: 'uncommon', icon: 'g:flame:O:up', cat: 'economy', win: s => ({ gold: Math.min(5, s.wins), note: '×' + s.wins }) },
    { id: 'haggler', rarity: 'common', icon: 'g:tag:G:minus', cat: 'economy' },
    { id: 'pawnshop', rarity: 'uncommon', icon: 'g:scale:G:coin', cat: 'economy' },
    { id: 'speedrun', rarity: 'common', icon: 'g:hourglass:B:bolt', cat: 'economy', win: s => s.myMoves <= 25 ? { gold: 4, note: tx('note.moves', { n: s.myMoves }) } : null },
    { id: 'gallery', rarity: 'common', icon: 'g:frame:P:plus', cat: 'economy', win: s => s.cats ? { gold: s.cats, note: tx('note.pcs', { n: s.cats }) } : null },
    // --- captures & tactics ---
    { id: 'herald', rarity: 'common', icon: 'g:king:R:bolt', cat: 'tactic', move: e => (e.check && (e.st.herald = (e.st.herald || 0) + 1) <= 3 ? 1 : 0) },
    { id: 'executioner', rarity: 'common', icon: 'g:pawn:R:sword', cat: 'capture', cap: e => (e.by === 'p' ? 2 : 0) },
    { id: 'giantSlayer', rarity: 'uncommon', icon: 'g:sword:S:up', cat: 'capture', cap: e => (VAL[e.victim] > VAL[e.by] ? 3 : 0) },
    { id: 'queenHunter', rarity: 'common', icon: 'g:queen:R:target', cat: 'capture', cap: e => (e.victim === 'q' ? 5 : 0) },
    { id: 'enPassant', rarity: 'common', icon: 'g:pawn:B:arrowSide', cat: 'pawn', cap: e => (e.m.enpassant ? 5 : 0) },
    { id: 'discovery', rarity: 'uncommon', icon: 'g:eye:P:bolt', cat: 'tactic', move: e => (e.discovered ? 3 : 0) },
    { id: 'mateGold', rarity: 'common', icon: 'g:king:G:x', cat: 'tactic', win: s => s.reason === 'mate' ? { gold: 3 } : null },
    { id: 'smother', rarity: 'uncommon', icon: 'g:knight:P:x', cat: 'tactic', win: s => s.reason === 'mate' && s.lastBy === 'n' ? { gold: 6 } : null },
    { id: 'pyramid', rarity: 'rare', icon: 'g:pyramid:G:up', cat: 'growth', cap: e => e.k - 1 },
    // --- defence & king safety ---
    { id: 'bodyguard', rarity: 'uncommon', icon: 'g:shield:N:heart', cat: 'king', loss: e => (e.nearKing ? { free: true } : null) },
    { id: 'deepPockets', rarity: 'uncommon', icon: 'g:bag:U:lock', cat: 'defense', loss: () => ({ cap: 3 }) },
    { id: 'ironWill', rarity: 'uncommon', icon: 'g:queen:S:lock', cat: 'defense', loss: e => (e.t === 'q' ? { free: true } : null) },
    { id: 'tribute', rarity: 'common', icon: 'g:king:O:coin', cat: 'king', loss: e => (e.by === 'k' ? { bonus: 3 } : null) },
    { id: 'pawnShield', rarity: 'common', icon: 'g:shield:B:check', cat: 'king', win: s => s.castled && s.kingPawns >= 3 ? { gold: 3 } : null },
    { id: 'earlyCastle', rarity: 'common', icon: 'g:rook:B:bolt', cat: 'king', move: e => (e.m.castle && e.ply <= 8 ? 3 : 0) },
    { id: 'activeKing', rarity: 'common', icon: 'g:king:N:up', cat: 'endgame', move: e => (e.by === 'k' && !e.m.castle && e.botLeft <= 6 && (e.st.aking = (e.st.aking || 0) + 1) <= 4 ? 1 : 0) },
    { id: 'perfect', rarity: 'rare', icon: 'g:gem:B:check', cat: 'defense', win: s => !s.lost ? { gold: 6 } : null },
    // --- openings ---
    { id: 'bookworm', rarity: 'common', icon: 'g:book:N:coin', cat: 'debut' },
    { id: 'theory', rarity: 'uncommon', icon: 'g:book:P:star', cat: 'debut' },
    { id: 'gambiteer', rarity: 'common', icon: 'g:pawn:O:coin', cat: 'debut', loss: e => (e.t === 'p' && e.ply <= 10 ? { free: true, bonus: 1 } : null) },
    { id: 'development', rarity: 'common', icon: 'g:knight:N:up', cat: 'debut',
      move: e => { const st = e.st; st.dev = st.dev || []; if ('nb'.includes(e.by) && [57, 58, 61, 62].includes(e.m.from) && !st.dev.includes(e.m.from) && st.dev.length < 4) { st.dev.push(e.m.from); return 1; } return 0; } },
    { id: 'centerControl', rarity: 'common', icon: 'g:target:N:plus', cat: 'debut', move: e => (e.by === 'p' && [27, 28, 35, 36].includes(e.to) && (e.st.center = (e.st.center || 0) + 1) <= 2 ? 1 : 0) },
    // --- pawns ---
    { id: 'passer', rarity: 'common', icon: 'g:pawn:N:up', cat: 'pawn', move: e => (e.by === 'p' && e.toRow === 2 ? 2 : 0) },
    { id: 'promoGold', rarity: 'common', icon: 'g:queen:G:up', cat: 'pawn', move: e => (e.m.promo ? 5 : 0) },
    { id: 'chain', rarity: 'common', icon: 'g:chain:S:plus', cat: 'pawn', win: s => s.chain ? { gold: Math.min(5, s.chain), note: tx('note.pawns', { n: s.chain }) } : null },
    // --- endgame ---
    { id: 'endgame', rarity: 'uncommon', icon: 'g:hourglass:R:coin', cat: 'endgame', cap: e => (e.botLeft <= 5 ? 2 : 0) },
    { id: 'lastStand', rarity: 'common', icon: 'g:flag:R:star', cat: 'endgame', win: s => s.myPieces <= 4 ? { gold: 5, note: tx('note.pcs', { n: s.myPieces }) } : null },
    // --- scaling ---
    { id: 'hoarder', rarity: 'uncommon', icon: 'g:chest:G:up', cat: 'growth', grows: true, win: (s, r) => { const g = r.n || 1; r.n = g + 1; return { gold: g }; } },
    { id: 'trophy', rarity: 'uncommon', icon: 'g:cup:G:star', cat: 'growth', grows: true,
      cap: (e, r) => { if (e.victim === 'q') r.n = (r.n || 0) + 1; return 0; }, win: (s, r) => r.n ? { gold: r.n } : null },
    { id: 'veteran', rarity: 'common', icon: 'g:sword:O:star', cat: 'growth', cap: e => Math.min(3, Math.floor(e.run.wins / 3)) },
    // --- rule-bending (moves in rules.js) ---
    { id: 'camel', rarity: 'rare', icon: 'g:knight:O:arrowSide', cat: 'piece' },
    { id: 'sidestep', rarity: 'uncommon', icon: 'g:pawn:P:arrowSide', cat: 'piece' },
    { id: 'templar', rarity: 'rare', icon: 'g:rook:W:diag', cat: 'piece' },
    { id: 'backstab', rarity: 'rare', icon: 'g:pawn:S:down', cat: 'piece' },
    { id: 'kingKnight', rarity: 'legendary', icon: 'g:king:P:star', cat: 'piece' },
    // --- debuffs for the bot ---
    { id: 'saboteur', rarity: 'uncommon', icon: 'g:pawn:D:x', cat: 'debuff', start: e => { if (e.state.board[13] === 'p') { e.state.board[13] = null; return 1; } return 0; } },
    { id: 'deserter', rarity: 'legendary', icon: 'g:queen:D:x', cat: 'debuff', start: e => { if (!e.boss && e.state.board[3] === 'q') { e.state.board[3] = null; return 1; } return 0; } },
    { id: 'noCastle', rarity: 'common', icon: 'g:rook:D:x', cat: 'debuff', start: e => { e.state.castle.k = e.state.castle.q = false; return 1; } },
    // --- boss ---
    { id: 'scout', rarity: 'common', icon: 'g:eye:B:plus', cat: 'boss' },
    { id: 'bomb', rarity: 'common', icon: 'g:bomb:L:coin', cat: 'boss', cap: e => (e.variant === 'atomic' ? 1 : 0) }
  ];
  const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
  R.forEach(r => { r.price = PRICE[r.rarity]; });
  window.RELICS = R;
  window.RELIC = id => R.find(r => r.id === id);
  window.RARITY = {}; ['common', 'uncommon', 'rare', 'legendary'].forEach(r => Object.defineProperty(window.RARITY, r, { get: () => tx('rarity.' + r), enumerable: true }));

  // Piece enhancements: bound to a starting square of one of your pieces, drawn as a glow + corner badge.
  // `for`: piece types that can carry it; `move`: changes how the piece moves (handled in rules.js via state.tags).
  window.ENH = {
    gold: { icon: 'e-gold', color: '#eabc52', rarity: 'rare', for: 'pnbrq' },
    steel: { icon: 'e-steel', color: '#c4d3d8', rarity: 'common', for: 'pnbrq' },
    holo: { icon: 'e-holo', color: '#c58be8', rarity: 'legendary', for: 'pnbrq' },
    foil: { icon: 'e-foil', color: '#6cbbe6', rarity: 'uncommon', for: 'pnbrq' },
    squire: { icon: 'e-squire', color: '#7fe0a6', rarity: 'uncommon', for: 'n', move: true },
    monk: { icon: 'e-monk', color: '#f0a35e', rarity: 'uncommon', for: 'b', move: true },
    catapult: { icon: 'e-catapult', color: '#e2725b', rarity: 'rare', for: 'r', move: true },
    amazon: { icon: 'e-amazon', color: '#ff8fb1', rarity: 'legendary', for: 'q', move: true },
    retreat: { icon: 'e-retreat', color: '#8fd3ff', rarity: 'common', for: 'p', move: true, once: true },
    early: { icon: 'e-early', color: '#fff1a8', rarity: 'uncommon', for: 'p', move: true },
    armor: { icon: 'e-armor', color: '#9fb2b8', rarity: 'common', for: 'nbrq', move: true },
    mirror: { icon: 'e-mirror', color: '#d6c2ff', rarity: 'rare', for: 'pnbrq', move: true, once: true },
    // t32
    leech: { icon: 'g:heart:R:plus', color: '#ec6f67', rarity: 'uncommon', for: 'pnbrq' },
    lucky: { icon: 'g:clover:N:none', color: '#45b87f', rarity: 'uncommon', for: 'pnbrq' },
    treasurer: { icon: 'g:bag:G:plus', color: '#f3d27a', rarity: 'common', for: 'pnbrq' },
    archer: { icon: 'g:bow:U:none', color: '#c9935a', rarity: 'uncommon', for: 'p', move: true },
    sprinter: { icon: 'g:arrow2:B:none', color: '#5fb6f0', rarity: 'common', for: 'p', move: true },
    chancellor: { icon: 'g:knight:S:plus', color: '#b8c7cc', rarity: 'rare', for: 'r', move: true },
    archbishop: { icon: 'g:knight:P:plus', color: '#b494f0', rarity: 'rare', for: 'b', move: true },
    dragon: { icon: 'g:flame:R:none', color: '#ff7a4d', rarity: 'rare', for: 'n', move: true }
  };


  // Packs (2 random per shop visit).
  window.PACKS = {
    hint: [{ sz: 'small', amount: 3, price: 3, rarity: 'common' }, { sz: 'medium', amount: 5, price: 5, rarity: 'uncommon' }, { sz: 'large', amount: 10, price: 8, rarity: 'rare' }],
    tactic: { icon: 'pack-tactic', price: 5, rarity: 'legendary' },
    relic: { icon: 'pack-relic', price: 8, rarity: 'rare' },
    // upgrade chest: each card is one of your pieces + a rolled upgrade
    enh: [{ sz: 'small', n: 3, pick: 1, price: 4, rarity: 'common' }, { sz: 'normal', n: 5, pick: 1, price: 6, rarity: 'uncommon' }, { sz: 'large', n: 8, pick: 2, price: 8, rarity: 'rare' }]
  };

  // Vouchers: one per debut (3 rounds), permanent for the run.
  window.VOUCHERS = [
    { id: 'slot', icon: 'v-slot', price: 10 },
    { id: 'shelf', icon: 'v-shelf', price: 10 },
    { id: 'coupon', icon: 'v-coupon', price: 8 },
    { id: 'safe', icon: 'v-safe', price: 10 },
    { id: 'discount', icon: 'v-discount', price: 10 },
    { id: 'hintsub', icon: 'v-hint', price: 8 },
    // t32
    { id: 'bigChest', icon: 'g:chest:P:plus', price: 8 },
    { id: 'seedMoney', icon: 'g:bag:N:coin', price: 8 },
    { id: 'steadyReroll', icon: 'g:dice:B:lock', price: 8 },
    { id: 'slot2', icon: 'g:frame:G:plus', price: 12, needs: 'slot' },
    { id: 'luckyShelf', icon: 'g:gem:P:up', price: 10 },
    { id: 'undoSub', icon: 'g:back:O:plus', price: 8 },
    { id: 'tacticPlus', icon: 'g:dice:P:plus', price: 8 },
    { id: 'warChest', icon: 'g:chest:R:coin', price: 10 },
    { id: 'sellPlus', icon: 'g:scale:N:plus', price: 6 },
    { id: 'mercy', icon: 'g:heart:Q:coin', price: 10 }
  ];

  window.CONSUMABLES = [
    { id: 'undo', icon: 'g:back:B:plus', rarity: 'common' },
    { id: 'confuse', icon: 'spiral', rarity: 'uncommon' },
    { id: 'doubleGold', icon: 'g:bag:O:up', rarity: 'rare' },
    { id: 'confiscate', icon: 'scissors', rarity: 'uncommon' },
    { id: 'hints2', icon: 'scroll', rarity: 'common' },
    // t32
    { id: 'goldRush', icon: 'g:bolt:G:coin', rarity: 'uncommon' },
    { id: 'shield', icon: 'g:shield:G:plus', rarity: 'common' },
    { id: 'sabotage', icon: 'g:bomb:R:x', rarity: 'uncommon' },
    { id: 'cash', icon: 'g:bag:G:coin', rarity: 'common' }
  ];

  // ch = the first chapter (debut 1..3 of a run) where this boss may appear; color = its card / banner accent
  window.BOSSES = [
    { id: 'atomic', ch: 1, color: '#b9cf45' , rar: 'rare' },
    { id: 'fog', ch: 1, color: '#9c70ed' , rar: 'legendary' },
    { id: 'misere', ch: 1, color: '#ec6f67' , rar: 'uncommon' },
    // v0.3
    { id: 'hill', ch: 1, color: '#e19a1c' , rar: 'uncommon' },
    { id: 'threecheck', ch: 1, color: '#2899e4' , rar: 'rare' },
    { id: 'royalqueen', ch: 1, color: '#ff8fb1' , rar: 'legendary' },
    { id: 'mines', ch: 1, color: '#c9935a' , rar: 'rare' },
    { id: 'masked', ch: 1, color: '#d6c2ff' , rar: 'legendary' },
    { id: 'pillar', ch: 1, color: '#45b87f' , rar: 'uncommon' },
    { id: 'forward', ch: 1, color: '#a7362f' , rar: 'uncommon' },
    { id: 'hourglass', ch: 2, color: '#eabc52' , rar: 'rare' },
    { id: 'hydra', ch: 2, color: '#9be8b8' , rar: 'legendary' }
  ];
  window.BOSS = id => window.BOSSES.find(b => b.id === id);

  // Debuts: a run is 3 debuts × 3 rounds = 9 rounds. Each debut is themed on a named opening.
  // line = book moves for both sides in real board coordinates; san = how it is shown.
  // side = the colour the PLAYER has: 'w' openings are played as White, 'b' defences as Black (the bot plays the
  // white moves of the line and moves first). Every own book move pays $1, finishing your part of the line pays `gold`.
  // The 3rd round of a debut is its boss: named after the opening, it plays the opponent's book moves under a boss rule.
  window.DEBUTS = [
    { id: 'italian', rule: 'fog', side: 'w', gold: 3, line: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5'], san: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'] },
    { id: 'spanish', rule: 'fog', side: 'w', gold: 3, line: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6'], san: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'] },
    { id: 'french', rule: 'fog', side: 'b', gold: 3, line: ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'b1c3', 'g8f6'], san: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6'] },
    { id: 'london', rule: 'fog', side: 'w', gold: 3, line: ['d2d4', 'd7d5', 'c1f4', 'g8f6', 'e2e3', 'e7e6'], san: ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'e6'] },
    { id: 'scotch', rule: 'atomic', side: 'w', gold: 3, line: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'd2d4', 'e5d4'], san: ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4'] },
    { id: 'sicilian', rule: 'atomic', side: 'b', gold: 3, line: ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4'], san: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4'] },
    { id: 'kings-gambit', rule: 'misere', side: 'w', gold: 3, line: ['e2e4', 'e7e5', 'f2f4', 'e5f4', 'g1f3', 'd7d6'], san: ['e4', 'e5', 'f4', 'exf4', 'Nf3', 'd6'] },
    { id: 'queens-gambit', rule: 'misere', side: 'w', gold: 3, line: ['d2d4', 'd7d5', 'c2c4', 'd5c4', 'e2e3', 'g8f6'], san: ['d4', 'd5', 'c4', 'dxc4', 'e3', 'Nf6'] },
    // t32: defences for a player who plays Black (the bot plays the white moves of the line)
    { id: 'caro-kann', rule: 'fog', side: 'b', gold: 3, line: ['e2e4', 'c7c6', 'd2d4', 'd7d5', 'b1c3', 'd5e4'], san: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4'] },
    { id: 'dutch', rule: 'fog', side: 'b', gold: 3, line: ['d2d4', 'f7f5', 'g2g3', 'g8f6', 'f1g2', 'e7e6'], san: ['d4', 'f5', 'g3', 'Nf6', 'Bg2', 'e6'] },
    { id: 'scandinavian', rule: 'atomic', side: 'b', gold: 3, line: ['e2e4', 'd7d5', 'e4d5', 'g8f6', 'd2d4', 'f6d5'], san: ['e4', 'd5', 'exd5', 'Nf6', 'd4', 'Nxd5'] },
    { id: 'kings-indian', rule: 'misere', side: 'b', gold: 3, line: ['d2d4', 'g8f6', 'c2c4', 'g7g6', 'b1c3', 'f8g7'], san: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7'] },
    { id: 'slav', rule: 'misere', side: 'b', gold: 3, line: ['d2d4', 'd7d5', 'c2c4', 'c7c6', 'g1f3', 'g8f6'], san: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6'] },
    // v0.3: one White opening and one Black defence for each new boss
    { id: 'center-game', rule: 'hill', side: 'w', gold: 3, line: ['e2e4', 'e7e5', 'd2d4', 'e5d4', 'd1d4', 'b8c6'], san: ['e4', 'e5', 'd4', 'exd4', 'Qxd4', 'Nc6'] },
    { id: 'alekhine', rule: 'hill', side: 'b', gold: 3, line: ['e2e4', 'g8f6', 'e4e5', 'f6d5', 'd2d4', 'd7d6'], san: ['e4', 'Nf6', 'e5', 'Nd5', 'd4', 'd6'] },
    { id: 'danish', rule: 'threecheck', side: 'w', gold: 3, line: ['e2e4', 'e7e5', 'd2d4', 'e5d4', 'c2c3', 'd4c3'], san: ['e4', 'e5', 'd4', 'exd4', 'c3', 'dxc3'] },
    { id: 'englund', rule: 'threecheck', side: 'b', gold: 3, line: ['d2d4', 'e7e5', 'd4e5', 'b8c6', 'g1f3', 'd8e7'], san: ['d4', 'e5', 'dxe5', 'Nc6', 'Nf3', 'Qe7'] },
    { id: 'catalan', rule: 'royalqueen', side: 'w', gold: 3, line: ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'g2g3', 'd7d5'], san: ['d4', 'Nf6', 'c4', 'e6', 'g3', 'd5'] },
    { id: 'nimzo', rule: 'royalqueen', side: 'b', gold: 3, line: ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'b1c3', 'f8b4'], san: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'] },
    { id: 'vienna', rule: 'mines', side: 'w', gold: 3, line: ['e2e4', 'e7e5', 'b1c3', 'g8f6', 'f2f4', 'd7d5'], san: ['e4', 'e5', 'Nc3', 'Nf6', 'f4', 'd5'] },
    { id: 'pirc', rule: 'mines', side: 'b', gold: 3, line: ['e2e4', 'd7d6', 'd2d4', 'g8f6', 'b1c3', 'g7g6'], san: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6'] },
    { id: 'reti', rule: 'masked', side: 'w', gold: 3, line: ['g1f3', 'd7d5', 'c2c4', 'e7e6', 'g2g3', 'g8f6'], san: ['Nf3', 'd5', 'c4', 'e6', 'g3', 'Nf6'] },
    { id: 'modern', rule: 'masked', side: 'b', gold: 3, line: ['e2e4', 'g7g6', 'd2d4', 'f8g7', 'b1c3', 'd7d6'], san: ['e4', 'g6', 'd4', 'Bg7', 'Nc3', 'd6'] },
    { id: 'ponziani', rule: 'hourglass', side: 'w', gold: 3, line: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'c2c3', 'g8f6'], san: ['e4', 'e5', 'Nf3', 'Nc6', 'c3', 'Nf6'] },
    { id: 'petrov', rule: 'hourglass', side: 'b', gold: 3, line: ['e2e4', 'e7e5', 'g1f3', 'g8f6', 'f3e5', 'd7d6'], san: ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5', 'd6'] },
    { id: 'bird', rule: 'pillar', side: 'w', gold: 3, line: ['f2f4', 'd7d5', 'g1f3', 'g8f6', 'e2e3', 'g7g6'], san: ['f4', 'd5', 'Nf3', 'Nf6', 'e3', 'g6'] },
    { id: 'grunfeld', rule: 'pillar', side: 'b', gold: 3, line: ['d2d4', 'g8f6', 'c2c4', 'g7g6', 'b1c3', 'd7d5'], san: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'd5'] },
    { id: 'kia', rule: 'forward', side: 'w', gold: 3, line: ['g1f3', 'd7d5', 'g2g3', 'g8f6', 'f1g2', 'c7c6'], san: ['Nf3', 'd5', 'g3', 'Nf6', 'Bg2', 'c6'] },
    { id: 'benoni', rule: 'forward', side: 'b', gold: 3, line: ['d2d4', 'g8f6', 'c2c4', 'c7c5', 'd4d5', 'e7e6'], san: ['d4', 'Nf6', 'c4', 'c5', 'd5', 'e6'] },
    { id: 'four-knights', rule: 'hydra', side: 'w', gold: 3, line: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'b1c3', 'g8f6'], san: ['e4', 'e5', 'Nf3', 'Nc6', 'Nc3', 'Nf6'] },
    { id: 'philidor', rule: 'hydra', side: 'b', gold: 3, line: ['e2e4', 'e7e5', 'g1f3', 'd7d6', 'd2d4', 'g8f6'], san: ['e4', 'e5', 'Nf3', 'd6', 'd4', 'Nf6'] }
  ];
  window.DEBUT = id => window.DEBUTS.find(d => d.id === id);
  // book line as text: "1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5"
  window.debutLine = d => d.san.map((m, i) => (i % 2 ? '' : (i / 2 + 1) + '.') + m).join(' ');
  // v0.3: 12 boss rules. A run has 3 chapters (debuts), each with a different boss; chapter n only draws bosses whose
  // `ch` <= n (the nastier ones — hourglass, hydra — wait for chapter 2+). Openings are never repeated within a run.
  // side: the player's colour — White gets white openings, Black gets defences.
  // first (optional): the run's signature opening picked before round 1 — it becomes chapter 1 and the other two chapters
  // draw different boss rules.
  const shuffle = (a, rnd) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  window.bossRulesFor = ch => window.BOSSES.filter(b => (b.ch || 1) <= ch).map(b => b.id);
  const pickDebut = (rule, side, rnd, avoid) => {
    const all = window.DEBUTS.filter(d => d.rule === rule && d.side === side), fresh = all.filter(d => (avoid || []).indexOf(d.id) === -1), c = fresh.length ? fresh : all;
    return c.length ? c[Math.floor(rnd() * c.length)].id : null;
  };
  window.rollDebuts = (side, rnd, first) => {
    if (typeof side === 'function') { rnd = side; side = 'w'; }
    side = side === 'b' ? 'b' : 'w'; rnd = rnd || Math.random;
    const f = first && window.DEBUT(first);
    const out = f ? [f.id] : [], used = f ? [f.rule] : [];
    for (let ch = out.length + 1; ch <= 3; ch++) {
      const rules = shuffle(window.bossRulesFor(ch).filter(r => used.indexOf(r) === -1 && window.DEBUTS.some(d => d.rule === r && d.side === side)), rnd);
      const r = rules[0]; used.push(r); out.push(pickDebut(r, side, rnd, out));
    }
    return out;
  };
  // the pre-run choice: 3 openings for the player's side, each with a different chapter-1 boss, no duplicates;
  // `avoid` (e.g. the cards just rerolled away) is skipped whenever the pool allows — their bosses go to the back too,
  // so a reroll shows three new bosses
  window.rollOpeningOffer = (side, avoid, rnd) => {
    side = side === 'b' ? 'b' : 'w'; rnd = rnd || Math.random; avoid = avoid || [];
    const stale = avoid.map(id => window.DEBUT(id)).filter(Boolean).map(d => d.rule);
    const pool = window.bossRulesFor(1).filter(r => window.DEBUTS.some(d => d.rule === r && d.side === side));
    const rules = shuffle(pool.filter(r => stale.indexOf(r) === -1), rnd).concat(shuffle(pool.filter(r => stale.indexOf(r) !== -1), rnd)).slice(0, 3);
    return rules.map(r => pickDebut(r, side, rnd, avoid));
  };
  window.RUN_ROUNDS = 9;

  // Localised fields are getters over the string tables, so every screen re-reads them after a language switch.
  const loc = (o, pre, fields) => fields.forEach(f => Object.defineProperty(o, f, { get: () => tx(pre + '.' + f), enumerable: true, configurable: true }));
  R.forEach(r => { loc(r, 'relic.' + r.id, ['name', 'desc']); Object.defineProperty(r, 'tag', { get: () => tx('cat.' + r.cat), enumerable: true }); });
  Object.keys(window.ENH).forEach(id => loc(window.ENH[id], 'enh.' + id, ['name', 'short', 'desc']));
  window.PACKS.hint.concat(window.PACKS.enh).forEach(d => Object.defineProperty(d, 'size', { get: () => tx('size.' + d.sz), enumerable: true }));
  loc(window.PACKS.tactic, 'pack.tactic', ['name', 'desc']); loc(window.PACKS.relic, 'pack.relic', ['name', 'desc']);
  window.VOUCHERS.forEach(v => loc(v, 'voucher.' + v.id, ['name', 'desc']));
  window.CONSUMABLES.forEach(v => loc(v, 'cons.' + v.id, ['name', 'desc']));
  window.BOSSES.forEach(v => loc(v, 'boss.' + v.id, ['name', 'rule', 'desc']));
  window.DEBUTS.forEach(v => loc(v, 'debut.' + v.id, ['name', 'why']));
})();
