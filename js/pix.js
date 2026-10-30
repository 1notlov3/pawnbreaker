// Pixel-art icon set (own art). Every icon is drawn on a 16×16 grid from primitives / ASCII maps,
// gets an automatic 1px ink outline, and is cached as a PNG data-URL. Shown with image-rendering: pixelated.
(function () {
  'use strict';
  const C = { K: '#0b1215', W: '#f4efe2', w: '#cfc6b0', G: '#eabc52', g: '#c98a12', y: '#fff1a8', R: '#ec6f67', r: '#a7362f',
    B: '#2899e4', b: '#0a5f99', l: '#8fd3ff', N: '#45b87f', n: '#23704a', m: '#9be8b8', P: '#9c70ed', p: '#5b36a8', v: '#d6c2ff',
    O: '#e19a1c', o: '#a2620a', S: '#9fb2b8', s: '#5d7077', t: '#dfe8ea', U: '#9a6234', u: '#5e3a1c', k: '#f2c79a', L: '#c6e23a',
    Q: '#ff8fb1', q: '#d0507a', A: '#c9935a', D: '#33434a' };
  function canvasFor(draw) {
    const g = new Array(256).fill(null);
    const a = {
      p(x, y, c) { x = Math.floor(x); y = Math.floor(y); if (x >= 0 && x < 16 && y >= 0 && y < 16) g[y * 16 + x] = c === null ? null : (C[c] || c); },
      r(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) a.p(x + i, y + j, c); },
      d(cx, cy, rad, c) { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((x + .5 - cx) ** 2 + (y + .5 - cy) ** 2 <= rad * rad) a.p(x, y, c); },
      // ring / sector: radius r0..r1, angles in degrees (0 = right, 90 = up)
      o(cx, cy, r0, r1, c, a0, a1) {
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          const dx = x + .5 - cx, dy = y + .5 - cy, d = Math.hypot(dx, dy); if (d < r0 || d > r1) continue;
          if (a0 != null) { let an = Math.atan2(-dy, dx) * 180 / Math.PI; while (an < a0) an += 360; while (an >= a0 + 360) an -= 360; if (an > a1) continue; }
          a.p(x, y, c);
        }
      },
      l(x0, y0, x1, y1, c, th) {
        const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 || 1;
        for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n; a.p(x, y, c); if (th) a.p(x + 1, y, c); }
      },
      m(rows, x, y) { rows.forEach((row, j) => row.split('').forEach((ch, i) => { if (ch !== '.' && ch !== ' ') a.p(x + i, y + j, ch); })); }
    };
    draw(a);
    // outline: every empty pixel touching a filled one (4-neighbourhood) becomes ink
    const out = g.slice();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (g[y * 16 + x]) continue;
      if ((x > 0 && g[y * 16 + x - 1]) || (x < 15 && g[y * 16 + x + 1]) || (y > 0 && g[(y - 1) * 16 + x]) || (y < 15 && g[(y + 1) * 16 + x])) out[y * 16 + x] = C.K;
    }
    const cv = document.createElement('canvas'); cv.width = cv.height = 16;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(16, 16);
    out.forEach((c, i) => { if (!c) return; const v = parseInt(c.slice(1), 16); img.data.set([v >> 16, (v >> 8) & 255, v & 255, 255], i * 4); });
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }

  const bulb = (a, plus) => { a.d(8, 6.5, 5.6, 'G'); a.d(6.4, 4.8, 1.6, 'y'); a.r(7, 7, 2, 3, 'o'); a.r(6, 11, 4, 3, 'S'); a.r(6, 12, 4, 1, 's');
    if (plus) { a.r(11, 9, 5, 1, 'N'); a.r(12, 8, 3, 3, 'N'); a.r(13, 7, 1, 5, 'N'); a.r(11, 9, 5, 1, 'N'); } };
  const undo = (a, c, d) => { a.o(8.5, 9, 2.6, 5.4, c, -120, 95); a.r(6, 4, 3, 3, c); for (let k = 0; k < 4; k++) a.r(2 + k, 5 - k, 1, 1 + 2 * k, c); a.o(8.5, 9, 4.4, 5.4, d, -120, -20); };
  const spiral = (a, c, d) => { for (let t = 0; t < 4 * Math.PI; t += 0.04) { const rr = 0.7 + t * 0.47; a.p(8 + rr * Math.cos(t), 8 + rr * Math.sin(t), c); a.p(8 + (rr + .8) * Math.cos(t), 8 + (rr + .8) * Math.sin(t), c); } a.p(8, 8, d); };
  const coin = a => { a.d(8, 8, 6.6, 'g'); a.d(8, 8, 5.4, 'G'); a.r(7, 5, 2, 6, 'g'); a.p(5, 4, 'y'); a.p(4, 5, 'y'); a.p(4, 6, 'y'); a.p(6, 3, 'y'); };
  const shield = (a, c, hi) => { a.m(['SSSSSSSSSSSS', 'S..........S', 'S..........S', 'S..........S', 'S..........S', '.S........S.', '.S........S.', '..S......S..', '...S....S...', '....SSSS....'].map(s => s.replace(/S/g, c).replace(/\./g, c)), 2, 2);
    a.r(3, 3, 1, 5, hi); a.r(3, 3, 9, 1, hi); a.r(8, 12, 2, 1, c); a.r(7, 11, 4, 1, c); a.p(8, 13, c); a.p(7, 12, c); };
  const jester = a => a.m(['G...........G', 'RR....G....PP', '.RR..RPP..PP.', '.RRRRRPPPPPP.', '..RRRRRPPPP..', '..WWWWWWWWW..', '..WKWWWWWKW..', '..WWWWWWWWW..', '..WRWWWWWRW..', '...WRRRRRW...', '....WWWWW....'], 2, 2);
  const cards = a => { a.r(1, 5, 7, 9, 'B'); a.r(2, 6, 5, 7, 'l'); a.r(5, 3, 7, 9, 'R'); a.r(6, 4, 5, 7, 'W'); a.r(8, 6, 1, 3, 'R'); a.r(7, 7, 3, 1, 'R');
    a.r(9, 1, 6, 9, 'G'); a.r(10, 2, 4, 7, 'y'); a.p(12, 5, 'g'); };
  const gem = (c, d, h) => a => { a.m(['...cccccccc...', '..chcchcchcc..', '.cccccccccccc.', '..cdcccccdcc..', '...cdcccccc...', '....cdcccc....', '.....cccc.....', '......cc......'].map(s => s.replace(/c/g, c).replace(/h/g, h).replace(/d/g, d)), 1, 4); };

  const I = {
    coin,
    bulb: a => bulb(a), 'bulb-plus': a => bulb(a, true),
    undo: a => undo(a, 'O', 'o'), 'undo-w': a => undo(a, 'W', 'w'),
    spiral: a => spiral(a, 'P', 'v'), 'spiral-w': a => spiral(a, 'W', 'v'),
    flag: a => { a.r(3, 1, 2, 14, 't'); a.r(5, 2, 9, 6, 'W'); a.r(5, 7, 9, 1, 'w'); a.p(13, 4, null); a.p(13, 5, null); a.p(12, 4, null); a.p(12, 5, null); a.r(3, 14, 4, 1, 's'); },
    'snd-on': a => { a.r(1, 6, 3, 4, 'W'); for (let k = 0; k < 4; k++) a.r(4 + k, 5 - k, 1, 6 + 2 * k, 'W'); a.o(7, 8, 3.6, 4.7, 'G', -50, 50); a.o(7, 8, 6, 7.1, 'G', -50, 50); },
    'snd-off': a => { a.r(1, 6, 3, 4, 'W'); for (let k = 0; k < 4; k++) a.r(4 + k, 5 - k, 1, 6 + 2 * k, 'W'); a.l(10, 5, 14, 10, 'R', 1); a.l(14, 5, 10, 10, 'R', 1); },
    skull: a => a.m(['...WWWWWWWW...', '..WWWWWWWWWW..', '.WWWWWWWWWWWW.', '.WWWWWWWWWWWW.', '.WKKKWWWWKKKW.', '.WKKKWWWWKKKW.', '.WWWWWKKWWWWW.', '..WWWWKKWWWW..', '...WWWWWWWW...', '...WKWKWKWK...', '...WWWWWWWW...'], 1, 2),
    // bot portraits
    'av-rookie': a => { a.r(7, 0, 2, 2, 'R'); a.r(8, 2, 1, 2, 's'); a.r(2, 4, 12, 10, 'S'); a.r(2, 4, 12, 1, 't'); a.r(1, 7, 1, 4, 's'); a.r(14, 7, 1, 4, 's');
      a.r(4, 6, 8, 4, 'b'); a.r(5, 7, 2, 2, 'l'); a.r(9, 7, 2, 2, 'l'); a.r(5, 11, 6, 2, 's'); a.p(6, 11, 'W'); a.p(8, 11, 'W'); a.p(10, 11, 'W'); },
    'av-grinder': a => { a.r(2, 2, 12, 12, 's'); a.r(2, 2, 12, 1, 'S'); a.r(3, 6, 10, 2, 'R'); a.p(10, 6, 'k'); a.p(11, 6, 'k'); a.r(5, 10, 6, 1, 'D'); a.r(5, 12, 6, 1, 'D');
      a.p(3, 3, 't'); a.p(12, 3, 't'); a.r(0, 7, 2, 4, 'D'); a.r(14, 7, 2, 4, 'D'); },
    'av-atomic': a => { a.d(8, 8, 7.2, 'L'); [90, 210, 330].forEach(an => a.o(8, 8, 2.6, 6.3, 'K', an - 30, an + 30)); a.d(8, 8, 1.7, 'K'); },
    'av-fog': a => a.m(['.......PP.....', '......PPP.....', '.....PPPP.....', '.....PPPPP....', '....PPPPPP....', '....PPPPPPP...', '...ppppGppp...', 'PPPPPPPPPPPPPP', '...NNNNNNNN...', '...NKNNNNKN...', '...NNNNNNNN...', '....NNKKNN....', '.....NNNN.....'], 1, 1),
    'av-misere': jester,
    // v0.3 bosses
    'av-hill': a => { a.m(['.......G.......', '......GyG......', '.....GGGGG.....'], 0, 0); a.r(6, 3, 3, 1, 'g');
      for (let k = 0; k < 11; k++) a.r(7 - Math.floor(k * 0.7), 4 + k, 1 + 2 * Math.floor(k * 0.7), 1, k < 3 ? 'W' : 'n');
      for (let k = 0; k < 7; k++) a.r(8 + Math.floor(k * 0.5), 8 + k, 1 + Math.floor(k * 0.5), 1, 'N'); a.r(0, 15, 16, 1, 'n'); },
    'av-threecheck': a => { a.l(2, 13, 11, 4, 'S', 1); a.l(3, 13, 12, 4, 't'); a.r(1, 11, 4, 1, 'G'); a.r(3, 9, 1, 5, 'G'); a.r(1, 13, 2, 2, 'g');
      a.d(11.5, 11, 1.5, 'R'); a.d(13.5, 7.5, 1.5, 'R'); a.d(7, 13.5, 1.5, 'R'); a.r(12, 2, 3, 1, 'B'); },
    'av-royalqueen': a => { a.m(['G..G..G..G', 'GG.GG.GG.G', 'GGGGGGGGGG', 'gQgGgQgGgg'], 3, 1); a.r(3, 5, 10, 8, 'k'); a.r(2, 5, 1, 9, 'q'); a.r(13, 5, 1, 9, 'q');
      a.r(5, 7, 2, 2, 'K'); a.r(9, 7, 2, 2, 'K'); a.r(7, 10, 2, 1, 'R'); a.r(4, 13, 8, 2, 'Q'); a.p(6, 1, 'y'); },
    'av-mines': a => { [[8, 1], [8, 14], [1, 8], [14, 8], [3, 3], [12, 3], [3, 12], [12, 12]].forEach(([x, y]) => a.r(x - 0.5, y - 0.5, 2, 2, 's')); a.d(8, 8, 5.2, 'D'); a.d(8, 8, 4, 's'); a.d(6.6, 6.4, 1.3, 'S'); a.d(8, 8, 1.6, 'R'); a.p(8, 8, 'y'); },
    'av-masked': a => { a.m(['P............P', 'PPP........PPP', 'PPPPPPPPPPPPPP', 'PvvvvPPPPvvvvP', 'PKKKvPPPPvKKKP', 'PKKKvPPPPvKKKP', 'PPvvPPPPPPvvPP', '.PPPPPppPPPPP.', '..PPPp..pPPP..', '...PP....PP...'], 1, 4);
      a.r(1, 3, 1, 1, 'G'); a.r(14, 3, 1, 1, 'G'); a.l(14, 9, 15, 15, 'G'); },
    'av-hourglass': a => { a.r(2, 1, 12, 2, 'U'); a.r(2, 13, 12, 2, 'U'); a.r(3, 3, 1, 10, 'u'); a.r(12, 3, 1, 10, 'u');
      a.m(['lllllll', 'lGGGGGl', '.lGGGl.', '..lGl..', '...l...', '..lGl..', '.l.G.l.', 'l..G..l', 'lGGGGGl'], 4, 4); a.r(5, 3, 6, 1, 'l'); },
    'av-pillar': a => { a.r(3, 2, 10, 2, 'n'); a.r(2, 4, 12, 3, 'N'); a.r(1, 7, 14, 1, 'n'); a.r(7, 3, 2, 2, 'G'); a.r(4, 8, 8, 6, 'k');
      a.r(5, 9, 2, 1, 'K'); a.r(9, 9, 2, 1, 'K'); a.r(6, 12, 4, 1, 'r'); a.r(3, 14, 10, 2, 'n'); a.p(12, 14, 'G'); a.p(3, 14, 'G'); },
    'av-forward': a => { a.r(7, 0, 2, 2, 'R'); a.r(6, 1, 4, 2, 'r'); a.d(8, 7.5, 5.5, 'S'); a.r(2, 7, 12, 7, 'S'); a.r(2, 7, 12, 1, 't');
      a.r(4, 8, 8, 2, 'K'); a.r(7, 10, 2, 4, 'K'); a.r(6, 3, 1, 3, 't'); a.r(2, 14, 12, 1, 's'); },
    'av-hydra': a => { [[3, 3], [8, 1], [13, 3]].forEach(([x, y]) => { a.d(x, y + 1.5, 2.2, 'N'); a.p(x - 1, y + 1, 'R'); a.p(x + 1, y + 1, 'R'); });
      a.l(3, 6, 6, 11, 'N', 1); a.l(8, 4, 8, 11, 'N', 1); a.l(13, 6, 10, 11, 'N', 1); a.d(8, 12.5, 3.6, 'n'); a.r(5, 13, 6, 2, 'm'); a.r(1, 15, 14, 1, 'n'); },
    // packs
    'pack-hint': a => bulb(a), 'pack-tactic': cards, 'pack-relic': gem('P', 'p', 'v'),
    'pack-enh': a => { a.r(2, 2, 12, 5, 'S'); a.r(2, 2, 12, 1, 't'); a.r(2, 6, 12, 1, 's'); a.r(7, 7, 2, 8, 'U'); a.r(7, 13, 2, 2, 'u'); a.p(11, 9, 'G'); a.p(12, 10, 'y'); a.p(13, 9, 'G'); a.p(12, 8, 'G'); },
    // consumables
    bag: a => a.m(['...KK..KK...', '....AAAA....', '.....uu.....', '....AAAA....', '..AAAAAAAA..', '.AAAAGGAAAAA', 'AAAAGAAAAAAA', 'AAAAAGGAAAAA', 'AAAAAAAGAAAA', 'AAAAGGGAAAAA', '.AAAAGAAAAA.', '..AAAAAAAA..'], 2, 2),
    scissors: a => { a.l(2, 1, 10, 9, 't', 1); a.l(13, 1, 5, 9, 't', 1); a.o(4.5, 12, 1.2, 2.8, 'R'); a.o(11.5, 12, 1.2, 2.8, 'R'); a.p(8, 7, 's'); },
    scroll: a => { a.r(3, 3, 10, 10, 'W'); a.r(2, 2, 12, 2, 'w'); a.r(2, 12, 12, 2, 'w'); a.r(5, 6, 6, 1, 's'); a.r(5, 8, 6, 1, 's'); a.r(5, 10, 4, 1, 's'); },
    // vouchers
    'v-slot': a => { a.r(3, 1, 10, 14, 'W'); a.r(4, 2, 8, 12, 'w'); a.r(7, 4, 2, 8, 'N'); a.r(4, 7, 8, 2, 'N'); },
    'v-coupon': a => { a.r(1, 4, 14, 8, 'O'); a.r(1, 4, 14, 1, 'G'); [4, 6, 8, 10].forEach(y => a.p(5, y + 1, 'o')); a.p(1, 7, null); a.p(1, 8, null); a.p(14, 7, null); a.p(14, 8, null); a.r(7, 6, 5, 1, 'W'); a.r(7, 9, 4, 1, 'W'); },
    'v-shelf': a => { for (let x = 1; x < 15; x++) a.r(x, 2, 1, 4, Math.floor((x - 1) / 2) % 2 ? 'W' : 'R'); a.r(2, 6, 12, 8, 'U'); a.r(4, 8, 8, 4, 'l'); a.r(4, 8, 8, 1, 'W'); },
    'v-safe': a => { a.r(2, 2, 12, 12, 's'); a.r(3, 3, 10, 10, 'S'); a.o(8, 8, 2, 3.4, 's'); a.p(8, 8, 'G'); a.r(11, 7, 1, 3, 'G'); a.r(3, 14, 2, 1, 'D'); a.r(11, 14, 2, 1, 'D'); },
    'v-discount': a => { a.r(6, 2, 4, 1, 'N'); a.r(5, 3, 6, 1, 'N'); a.r(4, 4, 8, 10, 'N'); a.p(7, 5, null); a.p(8, 5, null); a.r(5, 8, 2, 2, 'W'); a.r(9, 11, 2, 2, 'W'); a.l(10, 8, 6, 13, 'W'); },
    'v-hint': a => bulb(a, true),
    // enhancements
    'e-gold': coin,
    'e-steel': a => shield(a, 'S', 't'),
    'e-holo': a => a.m(['......PP......', '......PP......', '.....PvvP.....', 'PPPPPPvvPPPPPP', '.PPvvvvvvvvPP.', '...PPvvvvPP...', '...PPPvvPPP...', '..PPPP..PPPP..', '..PPP....PPP..', '.PP........PP.'], 1, 2),
    // t29: rule-changing enhancements
    check: a => { for (let i = 0; i < 4; i++) a.r(2 + i, 8 + i, 2, 2, 'N'); for (let i = 0; i < 8; i++) a.r(6 + i, 10 - i, 2, 2, 'N'); a.p(3, 8, 'm'); },
    'e-squire': a => { a.m(['....mm.....', '...mNNN....', '..mNNNNN...', '.mNNKNNNN..', 'mNNNNNNNN..', 'NNNNNNNNN..', '....NNNNN..', '...NNNNNN..', '..NNNNNNNN.', '..nnnnnnnn.'], 1, 3); a.r(12, 1, 1, 5, 'G'); a.r(10, 3, 5, 1, 'G'); },
    'e-monk': a => { a.d(8, 9, 5.4, 'o'); a.d(8, 9, 4.2, 'O'); a.r(7, 4, 2, 10, 'W'); a.r(4, 7, 8, 2, 'W'); a.r(7, 1, 2, 2, 'O'); },
    'e-catapult': a => { a.o(8, 11, 5, 6.4, 'R', 20, 160); a.r(1, 12, 4, 3, 'S'); a.r(6, 9, 4, 6, 'D'); a.r(11, 12, 4, 3, 'S'); a.r(12, 9, 1, 3, 'R'); a.r(11, 10, 3, 1, 'R'); a.p(10, 9, 'r'); },
    'e-amazon': a => { a.m(['Q..Q..Q', 'QQ.Q.QQ', 'QQQQQQQ', 'qQQQQQq', 'qqqqqqq'], 1, 2); a.m(['..NN..', '.NNNN.', 'NNKNN.', '..NNN.', '.NNNN.', 'nnnnnn'], 9, 8); },
    'e-retreat': a => { a.r(6, 1, 4, 8, 'l'); a.r(6, 1, 1, 8, 'W'); for (let i = 0; i < 6; i++) a.r(2 + i, 8 + i, 12 - 2 * i, 1, 'B'); },
    'e-early': a => { a.r(6, 7, 4, 8, 'G'); a.r(6, 7, 1, 8, 'y'); for (let i = 0; i < 6; i++) a.r(7 - i, 1 + i, 2 + 2 * i, 1, 'G'); a.p(8, 2, 'y'); a.p(7, 2, 'y'); },
    'e-armor': a => { a.m(['..SS....SS..', '.SttS..SttS.', 'SSttSSSSttSS', 'SStttttttsSS', '.SStttttssS.', '.SSttttssSS.', '..SSttssSS..', '..SSStsSSS..', '...SSSSSS...', '....SSSS....', '.....ss.....'], 2, 2); },
    'e-mirror': a => { a.d(8, 7, 6, 'p'); a.d(8, 7, 4.8, 'v'); a.p(6, 4, 'W'); a.p(5, 5, 'W'); a.p(7, 3, 'W'); a.r(7, 13, 2, 2, 'p'); a.o(8, 7.5, 1.6, 2.8, 'P', 0, 270); a.p(10, 9, 'P'); a.p(11, 8, 'P'); },
    'e-foil': a => { a.r(7, 1, 2, 14, 'l'); a.r(1, 7, 14, 2, 'l'); a.d(8, 8, 3.2, 'B'); a.p(7, 7, 'W'); },
    // relics
    sanctuary: a => { shield(a, 'N', 'm'); a.r(7, 4, 2, 7, 'W'); a.r(5, 6, 6, 2, 'W'); },
    treasure: a => { a.r(2, 2, 12, 12, 'G'); a.r(3, 3, 10, 10, 'g'); a.r(4, 4, 8, 8, 'G'); a.r(7, 5, 2, 6, 'y'); a.r(5, 7, 6, 2, 'y'); },
    butcher: a => { a.r(2, 3, 9, 7, 't'); a.r(2, 9, 9, 1, 'S'); a.p(4, 5, null); a.r(11, 5, 4, 3, 'U'); a.p(14, 6, 'u'); },
    phalanx: a => { for (let i = 0; i < 3; i++) { a.r(1 + i * 5, 4, 4, 6, 'B'); a.r(2 + i * 5, 10, 2, 2, 'B'); a.r(1 + i * 5, 4, 4, 1, 'l'); } },
    stable: a => { a.o(8, 7, 3.2, 6.4, 'S', -55, 235); [[3, 7], [12, 7], [5, 3], [10, 3]].forEach(([x, y]) => a.p(x, y, 's')); a.r(2, 12, 3, 2, 'S'); a.r(11, 12, 3, 2, 'S'); },
    miser: a => { [10, 7, 4].forEach(y => { a.r(3, y, 10, 3, 'G'); a.r(3, y + 2, 10, 1, 'g'); }); a.p(4, 4, 'y'); a.p(5, 4, 'y'); },
    castle: a => { a.r(3, 5, 10, 10, 'S'); [3, 7, 11].forEach(x => a.r(x, 2, 2, 3, 'S')); a.r(7, 10, 2, 5, 'u'); a.p(5, 7, 'D'); a.p(10, 7, 'D'); a.r(3, 5, 10, 1, 't'); },
    blitz: a => a.m(['.......GGGG', '......GGGG.', '.....GGGG..', '....GGGG...', '...GGGGGGGG', '..GGGGGGGG.', '......GGG..', '.....GGG...', '....GGy....', '...GG......', '..G........'], 2, 2),
    glass: a => { a.r(2, 5, 10, 5, 'l'); a.r(12, 4, 2, 7, 'l'); a.r(2, 5, 10, 1, 'W'); a.l(5, 6, 8, 9, 'W'); a.d(5, 12, 2.6, 'U'); a.p(5, 12, 'u'); },
    hunter: a => { a.o(8, 8, 4.4, 5.9, 'R'); a.r(7, 0, 2, 5, 'R'); a.r(7, 11, 2, 5, 'R'); a.r(0, 7, 5, 2, 'R'); a.r(11, 7, 5, 2, 'R'); a.r(7, 7, 2, 2, 'W'); },
    collector: a => { a.m(['G.....G.....G', 'GG...GGG...GG', 'GGG.GGGGG.GGG', 'GGGGGGGGGGGGG', 'GGRGGGBGGGNGG', 'GGGGGGGGGGGGG', 'ggggggggggggg'], 1, 5); },
    mirror: a => { a.d(8, 6, 5.6, 'g'); a.d(8, 6, 4.4, 'l'); a.p(6, 4, 'W'); a.p(7, 3, 'W'); a.p(5, 5, 'W'); a.r(7, 11, 2, 4, 'g'); a.r(6, 14, 4, 1, 'g'); },
    debut: a => { a.r(2, 3, 12, 10, 'R'); a.r(2, 3, 2, 10, 'r'); a.r(4, 12, 10, 1, 'W'); a.r(6, 6, 6, 1, 'G'); a.r(6, 8, 4, 1, 'G'); },
    piggy: a => { a.d(8, 9, 5.8, 'Q'); a.r(3, 3, 3, 2, 'Q'); a.r(10, 3, 3, 2, 'Q'); a.r(6, 9, 4, 3, 'q'); a.p(7, 10, 'K'); a.p(8, 10, 'K'); a.p(5, 7, 'K'); a.p(10, 7, 'K'); a.r(7, 4, 2, 1, 'K'); a.r(4, 14, 2, 1, 'q'); a.r(10, 14, 2, 1, 'q'); },
    broker: a => { a.d(4.5, 4.5, 2.6, 'G'); a.d(11.5, 11.5, 2.6, 'G'); a.l(12, 2, 3, 13, 'G', 1); a.p(4, 4, 'g'); a.p(11, 11, 'g'); },
    lantern: a => { a.r(6, 0, 4, 1, 's'); a.r(4, 2, 8, 2, 'U'); a.r(4, 4, 8, 8, 'G'); a.r(4, 4, 1, 8, 'U'); a.r(11, 4, 1, 8, 'U'); a.d(8, 8.5, 2.2, 'O'); a.r(7, 8, 2, 2, 'y'); a.r(4, 12, 8, 2, 'U'); },
    sapper: a => { a.d(7, 9.5, 5.3, 's'); a.o(7, 9.5, 4, 5.3, 'D', -150, -10); a.p(5, 7, 't'); a.p(4, 8, 'S'); a.p(5, 8, 'S'); a.p(4, 7, 'W'); a.r(9, 3, 3, 2, 's'); a.l(11, 3, 13, 1, 'U'); a.p(14, 0, 'O'); a.p(13, 0, 'G'); a.p(14, 1, 'G'); a.p(15, 1, 'R'); },
    jester,
    // t16: loss-penalty relics
    insurance: a => { a.o(8, 8, 0, 6.6, 'B', 0, 180); a.o(8, 8, 0, 6.6, 'l', 60, 120); a.r(1, 8, 14, 1, 'b'); a.r(8, 8, 1, 6, 'U'); a.r(6, 13, 2, 1, 'U'); a.p(6, 12, 'U'); a.p(8, 1, 'W'); },
    martyr: a => { a.o(8, 3.5, 2.4, 3.5, 'G'); a.d(8, 8, 2.4, 'W'); a.r(6, 10, 4, 1, 'W'); a.r(5, 11, 6, 2, 'W'); a.r(4, 13, 8, 2, 'w'); },
    bastion: a => { shield(a, 'B', 'l'); a.r(5, 5, 6, 5, 'S'); [5, 7, 9].forEach(x => a.r(x, 4, 1, 1, 'S')); a.r(7, 7, 2, 3, 'D'); },
    siege: a => { a.r(2, 12, 12, 2, 'U'); a.d(4, 14, 1.4, 's'); a.d(12, 14, 1.4, 's'); a.l(4, 11, 12, 3, 'u', 1); a.d(12.5, 2.5, 2, 'S'); a.p(12, 2, 't'); a.r(6, 9, 2, 3, 'U'); },
    revenge: a => { a.l(2, 2, 12, 12, 't', 1); a.l(13, 2, 3, 12, 't', 1); a.r(1, 12, 3, 3, 'R'); a.r(12, 12, 3, 3, 'R'); a.p(2, 1, 'W'); a.p(13, 1, 'W'); },
    'coin-loss': a => { coin(a); a.r(4, 7, 8, 2, 'R'); },
    // t19: menu / meta icons (same 16px grid, same auto ink outline, same palette roles)
    menu: a => { [3, 7, 11].forEach(y => a.r(2, y, 12, 2, 'W')); },
    gear: a => { a.d(8, 8, 5.2, 'S'); [[7, 1], [7, 13], [1, 7], [13, 7]].forEach(([x, y]) => a.r(x, y, 2, 2, 'S')); [[3, 3], [11, 3], [3, 11], [11, 11]].forEach(([x, y]) => a.r(x, y, 2, 2, 'S')); a.d(8, 8, 2.2, 'D'); a.p(6, 5, 't'); },
    book: a => { a.r(2, 3, 6, 10, 'B'); a.r(8, 3, 6, 10, 'b'); a.r(3, 4, 4, 8, 'W'); a.r(9, 4, 4, 8, 'w'); [5, 7, 9].forEach(y => { a.r(4, y, 2, 1, 'S'); a.r(10, y, 2, 1, 'S'); }); a.r(7, 13, 2, 1, 'G'); },
    play: a => { for (let i = 0; i < 6; i++) a.r(4 + i, 2 + i, 1, 12 - 2 * i, 'N'); a.r(4, 2, 1, 12, 'm'); },
    resume: a => { a.r(2, 2, 3, 12, 'G'); for (let i = 0; i < 5; i++) a.r(7 + i, 3 + i, 1, 10 - 2 * i, 'G'); a.r(2, 2, 1, 12, 'y'); },
    cards: a => { a.r(1, 4, 8, 11, 'P'); a.r(2, 5, 6, 9, 'v'); a.r(6, 1, 8, 11, 'G'); a.r(7, 2, 6, 9, 'W'); a.d(10, 6.5, 2, 'R'); },
    back: a => { for (let i = 0; i < 5; i++) a.r(2 + i, 7 - i, 1, 2 + 2 * i, 'W'); a.r(7, 7, 7, 2, 'W'); },
    globe: a => { a.d(8, 8, 6.2, 'B'); a.m(['..NN', '.NNNN', 'NNNN.', '.NN'], 4, 4); a.m(['NN', 'NNN', '.NN'], 9, 9); a.r(10, 3, 2, 2, 'N'); a.o(8, 8, 5.3, 6.2, 'b', 200, 340); a.p(5, 3, 'l'); a.p(4, 4, 'l'); },
    chat: a => { a.r(1, 2, 14, 9, 'W'); a.r(1, 2, 14, 1, 't'); a.r(1, 10, 14, 1, 'w'); a.r(3, 11, 4, 1, 'W'); a.r(3, 12, 2, 1, 'W'); a.p(3, 13, 'W'); [4, 7, 10].forEach(x => a.r(x, 5, 2, 2, 'B')); },
    crown: a => a.m(['G...G...G', 'GG.GGG.GG', 'GGGGGGGGG', 'GRGGBGGNG', 'GGGGGGGGG', 'ggggggggg'], 3, 5)
  };

  // ---------- t32: composed icons for the item set ----------
  // 'g:<glyph>:<colour>:<badge>' = a 13px glyph in a palette ramp + a small badge in the bottom-right corner.
  // Shared glyphs keep the set coherent; glyph × colour × badge keeps every item distinguishable (tests check uniqueness).
  const RAMP = { G: 'Gyg', B: 'Blb', R: 'RQr', N: 'Nmn', P: 'Pvp', S: 'Sts', O: 'OGo', W: 'WWw', U: 'UAu', Q: 'QWq', L: 'Lyn', D: 'DSK' };
  const GLYPH = {
    pawn: ['.....cc.....', '....chcc....', '....cccc....', '.....cc.....', '....cccc....', '...cccccc...', '....cccc....', '....cccc....', '...cccccc...', '..cccccccc..', '..dddddddd..'],
    knight: ['....cc......', '...ccccc....', '..cchcccc...', '.cccccccccc.', '.ccccc.cccc.', '....c..cccc.', '......ccccc.', '.....cccccc.', '....ccccccc.', '...cccccccc.', '..dddddddddd'],
    bishop: ['.....cc.....', '....cccc....', '...ccc.cc...', '...cc.ccc...', '...chcccc...', '....cccc....', '.....cc.....', '....cccc....', '...cccccc...', '..cccccccc..', '..dddddddd..'],
    rook: ['.cc.cc.cc.cc', '.cccccccccc.', '..chcccccc..', '..cccccccc..', '..cccccccc..', '..cccccccc..', '..cccccccc..', '.cccccccccc.', 'cccccccccccc', 'dddddddddddd'],
    queen: ['c...c..c...c', 'cc.cc..cc.cc', 'cccccccccccc', '.chccccccccc', '..cccccccc..', '...cccccc...', '....cccc....', '...cccccc...', '..cccccccc..', '.dddddddddd.'],
    king: ['.....cc.....', '....cccc....', '.....cc.....', '.ccc.cc.ccc.', 'cchccccccccc', 'cccccccccccc', '.cccccccccc.', '..cccccccc..', '..cccccccc..', '.cccccccccc.', '.dddddddddd.'],
    flame: ['.....c......', '....cc......', '....ccc..c..', '...cccc.cc..', '..ccccccccc.', '..ccchhcccc.', '.ccchhhhccc.', '.cchhhhhhcc.', '.cchhhhhhcc.', '..cchhhhcc..', '...cccccc...'],
    tag: ['......cccccc', '.....ccccccc', '....cccc.ccc', '...cccccccc.', '..cccccccc..', '.cccccccc...', 'chccccccc...', '.chcccccc...', '..chcccc....', '...cccc.....', '....dd......'],
    scale: ['.....cc.....', 'cccccccccccc', 'c....cc....c', 'c....cc....c', 'cc...cc...cc', 'hhh..cc..hhh', 'ccc..cc..ccc', '.....cc.....', '.....cc.....', '...cccccc...', '..dddddddd..'],
    hourglass: ['cccccccccccc', '.dddddddddd.', '..chhhhhhc..', '...chhhhc...', '....chhc....', '.....cc.....', '....c..c....', '...c.hh.c...', '..chhhhhhc..', '.dddddddddd.', 'cccccccccccc'],
    sword: ['...........c', '..........cc', '.........chc', '........chc.', '.......chc..', '......chc...', '.d...chc....', '..d.chc.....', '...dhc......', '..dddd......', '.dd..d......', 'dd..........'],
    target: ['...cccccc...', '..cddddddc..', '.cdcccccdc..', 'cdccddccdc..', 'cdcdhhdcdc..', 'cdcdhhdcdc..', 'cdccddccdc..', '.cdcccccdc..', '..cddddddc..', '...cccccc...'],
    eye: ['...cccccc...', '.cc......cc.', 'c...dddd...c', 'c..ddhhdd..c', 'c..ddhhdd..c', 'c...dddd...c', '.cc......cc.', '...cccccc...'],
    pyramid: ['.....cc.....', '....chcc....', '...chhccc...', '...cccccc...', '..chhccccc..', '..cccccccc..', '.chhcccccdc.', '.cccccccccc.', 'chhcccccccdc', 'dddddddddddd'],
    shield: ['cccccccccccc', 'chhhhhhhhhhc', 'chcccccccccc', 'chcccccccccc', 'chcccccccccc', '.chcccccccc.', '.ccccccccdc.', '..ccccccdc..', '...ccccdc...', '....cccc....', '.....cc.....'],
    bag: ['...dd..dd...', '....dddd....', '.....dd.....', '...cccccc...', '..cccccccc..', '.chcccccccc.', 'chhccccccccc', 'chcccccccccc', 'cccccccccccc', '.cccccccccd.', '..dddddddd..'],
    book: ['cccccc.ccccc', 'chhhhc.chhhc', 'chddhc.cddhc', 'chhhhc.chhhc', 'chddhc.cddhc', 'chhhhc.chhhc', 'chddhc.cddhc', 'chhhhc.chhhc', 'cccccccccccc', '.....dd.....'],
    flag: ['dcccccccc...', 'dchhhhhhcc..', 'dccccccccc..', 'dchhhhhhcc..', 'dcccccccc...', 'd...........', 'd...........', 'd...........', 'd...........', 'dd..........', 'ddd.........'],
    gem: ['..cccccccc..', '.chhcchhcch.', 'cccccccccccc', '.cdcccccdcc.', '..cdcccccc..', '...cdcccc...', '....cdcc....', '.....cc.....'],
    chest: ['..cccccccc..', '.chhhhhhhhc.', 'cccccccccccc', 'dddddhhddddd', 'cccccddccccc', 'chccchhccccc', 'chcccccccccc', 'cccccccccccc', 'dddddddddddd'],
    cup: ['cccccccccccc', 'chhcccccccdc', '.chccccccdc.', '.cccccccccc.', '..cccccccc..', '...cccccc...', '.....cc.....', '.....cc.....', '....cccc....', '...dddddd...'],
    frame: ['cccccccccccc', 'cddddddddddc', 'cd........dc', 'cd..hh....dc', 'cd.hhhh...dc', 'cd..hh.cc.dc', 'cd....cccc.dc', 'cd...cccccdc', 'cddddddddddc', 'cccccccccccc'],
    bomb: ['........d.h.', '.......d.h..', '......dd....', '...cccc.....', '..cccccc....', '.chhcccccc..', '.chccccccc..', '.cccccccccd.', '.ccccccccd..', '..ccccccd...', '...dddd.....'],
    heart: ['.ccc...ccc..', 'chhcc.ccccc.', 'chcccccccccc', 'cccccccccccc', '.cccccccccc.', '..cccccccc..', '...cccccc...', '....cccc....', '.....cc.....'],
    clover: ['...cc..cc...', '..chcc.chcc.', '..cccc.cccc.', '...ccdcccc..', '.cccccdcccc.', 'chcccdcccccc', 'cccc..ccccc.', '.cc...d.cc..', '.......d....', '.......dd...'],
    bow: ['...cc.......', '..chd.......', '.ch..d......', '.ch...d.....', 'chc....d....', 'ccchhhhhhhhd', 'chc....d....', '.ch...d.....', '.ch..d......', '..chd.......', '...cc.......'],
    arrow2: ['.....cc.....', '....chcc....', '...chcccc...', '..cccccccc..', '.....cc.....', '.....cc.....', '....chcc....', '...chcccc...', '..cccccccc..', '.....cc.....', '.....dd.....'],
    dice: ['.cccccccccc.', 'chhhhhhhhhhc', 'chdhhhhhhdhc', 'chhhhhhhhhhc', 'chhhhdhhhhhc', 'chhhhhhhhhhc', 'chdhhhhhhdhc', 'chhhhhhhhhhc', '.cccccccccc.'],
    back: ['....c.......', '...cc.......', '..chccccc...', '.chhhhhhcc..', '..chcccchcc.', '...cc...chc.', '....c....cc.', '.........cc.', '........cc..', '..ccccccc...'],
    bolt: ['.......ccc..', '......chc...', '.....chc....', '....chc.....', '...chcccc...', '..cccccc....', '.....chc....', '....chc.....', '...chc......', '..cc........', '.c..........'],
    padlock: ['...dddddd...', '..dd....dd..', '..d......d..', '..d......d..', 'cccccccccccc', 'chhhhhhhhhhc', 'chcccddccccc', 'chcccddccccc', 'chccccdccccc', 'cccccccccccc', '.dddddddddd.'],
    chain: ['.ccc........', 'c...c.......', 'c...c.......', '.cc.cccc....', '...cc...c...', '...c.cc.c...', '...c...cc...', '....ccc.cc..', '.......c...c', '.......c...c', '........ccc.'],
    // v0.4 glyphs (120 relics)
    crown: ['c....cc....c', 'cc..chhc..cc', 'chccchhccchc', 'chhcchhcchhc', 'cccccccccccc', 'chdchdchdchc', 'cccccccccccc', 'dddddddddddd'],
    key: ['.ccc........', 'chhhc.......', 'ch.hcccccccc', 'chhhcddddddc', '.ccc...cc.cc', '.......dd.dd'],
    drum: ['d..........d', '.d........d.', '..cccccccc..', '.chhhhhhhhc.', '.cccccccccc.', '.cdccdccdcc.', '.ccdccdccdc.', '.cdccdccdcc.', '.cccccccccc.', '..dddddddd..'],
    horseshoe: ['.cc......cc.', 'chc......chc', 'chc......chc', 'cdc......cdc', 'chc......chc', 'cdc......cdc', 'chcc....cchc', '.chcc..cchc.', '..chhhhhhc..', '...cccccc...'],
    scroll: ['.cccccccccc.', 'chhhhhhhhhhc', '.chhhhhhhhc.', '.cdddddhhhc.', '.chhhhhhhhc.', '.cddddddhhc.', '.chhhhhhhhc.', '.cdddhhhhhc.', 'chhhhhhhhhhc', '.cccccccccc.'],
    skull: ['...cccccc...', '..chhhhhhc..', '.chhhhhhhhc.', '.chddhhddhc.', '.chddhhddhc.', '.chhhhhhhhc.', '..chhddhhc..', '...cchhcc...', '...cdcdcdc..', '....cccccc..'],
    cross: ['....cccc....', '....chhc....', '....chhc....', 'ccccchhccccc', 'chhhhhhhhhhc', 'chhhhhhhhhhc', 'ccccchhccccc', '....chhc....', '....chhc....', '....cccc....'],
    umbrella: ['.....cc.....', '...chhhhc...', '.chhhhhhhhc.', 'chhhhhhhhhhc', 'cdccdccdccdc', '.....d......', '.....d......', '.....d......', '...d.d......', '....d.......'],
    potion: ['....cccc....', '.....dd.....', '.....dd.....', '....cddc....', '...chhhhc...', '..chhhhhhc..', '.cchhhhhhcc.', '.cccccccccc.', '.cccccccccc.', '..cccccccc..', '...dddddd...']
  };
  const BADGE = {
    none: null,
    plus: ['..N..', '..N..', 'NNNNN', '..N..', '..N..'],
    minus: ['.....', '.....', 'RRRRR', '.....', '.....'],
    up: ['..N..', '.NNN.', 'NNNNN', '..N..', '..N..'],
    down: ['..R..', '..R..', 'RRRRR', '.RRR.', '..R..'],
    arrowSide: ['..B..', '...B.', 'BBBBB', '...B.', '..B..'],
    diag: ['BBB..', 'BB...', 'B.B..', '...B.', '....B'],
    coin: ['.GGG.', 'GyGGG', 'GGgGG', 'GGgGG', '.GGG.'],
    bolt: ['...y.', '..y..', '.yyy.', '..y..', '.y...'],
    star: ['..y..', '.yyy.', 'yyyyy', '.yyy.', '.y.y.'],
    x: ['R...R', '.R.R.', '..R..', '.R.R.', 'R...R'],
    check: ['....N', '...N.', 'N.N..', '.N...', '.....'],
    lock: ['.SSS.', '.S.S.', 'GGGGG', 'GGKGG', 'GGGGG'],
    heart: ['RR.RR', 'RRRRR', 'RRRRR', '.RRR.', '..R..'],
    sword: ['....t', '...t.', 't.t..', '.t...', 't.t..']
  };
  function composed(spec) {
    const [, gl, col, bd] = spec.split(':'), rows = GLYPH[gl] || GLYPH.pawn, ramp = RAMP[col] || RAMP.S, b = BADGE[bd];
    return a => {
      a.m(rows.map(r => r.replace(/c/g, ramp[0]).replace(/h/g, ramp[1]).replace(/d/g, ramp[2])), b ? 1 : 2, b ? 1 : 2);
      if (b) { a.r(10, 10, 6, 6, null); a.m(b, 11, 11); }
    };
  }
  const cache = {};
  function url(name) { if (!cache[name]) cache[name] = canvasFor(I[name] || (/^g:/.test(name) ? composed(name) : I.skull)); return cache[name]; }
  function img(name, cls, alt) { return '<img class="px ' + (cls || '') + '" src="' + url(name) + '" alt="' + (alt || '') + '" draggable="false">'; }
  window.PIX = { url, img, names: Object.keys(I), GLYPHS: Object.keys(GLYPH), BADGES: Object.keys(BADGE) };
})();
