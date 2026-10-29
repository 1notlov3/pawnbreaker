// ES module bootstrap: load vendored chessground + chess.js, then start the app.
import { Chessground } from '../vendor/chessground/chessground.min.js';
import { Chess, validateFen } from '../vendor/chessjs/chess.js';
window.Chessground = Chessground;
window.ChessJS = { Chess, validateFen };
window.__startApp();
