// ============================================================
//  calculator.js — Inline calculator for Bhakta Mithai
//  Auto-attaches a 🧮 button to every number input.
//  Loads as a plain <script> — no modules, no dependencies.
// ============================================================

(function () {
  'use strict';

  // ---------- 1. INJECT STYLES ----------
  var CSS = `
  .calc-wrap { position: relative; display: block; width: 100%; }
  .calc-wrap > input[type=number] { padding-right: 40px !important; }
  .calc-btn {
    position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
    width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--border, #e8d5a8);
    background: linear-gradient(135deg, var(--gold, #e8a420), var(--gold-dim, #c98a1a));
    color: var(--brand, #1a0800); font-size: 14px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; padding: 0; line-height: 1; opacity: .85; transition: opacity .15s, transform .1s;
  }
  .calc-btn:hover { opacity: 1; }
  .calc-btn:active { transform: translateY(-50%) scale(.9); }
  input[type=number]:focus + .calc-btn { opacity: 1; }

  /* ---------- modal ---------- */
  #calcOverlay {
    position: fixed; inset: 0; background: rgba(0,0,0,.6); backdrop-filter: blur(3px);
    z-index: 99999; display: none; align-items: flex-end; justify-content: center;
  }
  #calcOverlay.open { display: flex; }
  @media (min-width: 520px) { #calcOverlay { align-items: center; } }
  #calcCard {
    background: #1a0800; color: #f0d8a8; border-radius: 20px 20px 0 0;
    width: 100%; max-width: 420px; padding: 18px 16px 22px;
    box-shadow: 0 -10px 40px rgba(0,0,0,.5); font-family: system-ui,-apple-system,sans-serif;
    animation: calcIn .22s cubic-bezier(.32,1,.36,1);
  }
  @media (min-width: 520px) { #calcCard { border-radius: 20px; } }
  @keyframes calcIn { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
  #calcHandle { width: 40px; height: 4px; background: #4a1e04; border-radius: 2px; margin: 0 auto 14px; }

  #calcDisplay {
    background: #0d0500; border-radius: 12px; padding: 14px 16px; margin-bottom: 12px;
    min-height: 78px; display: flex; flex-direction: column; justify-content: flex-end;
    overflow: hidden;
  }
  #calcExpr {
    font-size: 13px; color: #9a7040; min-height: 18px;
    word-break: break-all; text-align: right; line-height: 1.3;
  }
  #calcResult {
    font-size: 30px; font-weight: 700; color: #e8a420;
    text-align: right; line-height: 1.1; margin-top: 4px;
    font-family: 'Libre Baskerville', Georgia, serif;
    word-break: break-all;
  }

  #calcQuick {
    display: flex; gap: 6px; overflow-x: auto; margin-bottom: 10px; padding-bottom: 4px;
    scrollbar-width: none;
  }
  #calcQuick::-webkit-scrollbar { display: none; }
  .calc-chip {
    flex: 0 0 auto; padding: 6px 11px; border-radius: 20px;
    background: #2e1200; color: #e8a420; border: 1px solid #4a1e04;
    font-size: 11px; font-weight: 600; cursor: pointer; white-space: nowrap;
    font-family: inherit;
  }
  .calc-chip:active { background: #4a1e04; }

  #calcPad {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;
  }
  .calc-key {
    padding: 14px 0; border-radius: 10px; border: 1px solid #2e1200;
    background: #2e1200; color: #f0d8a8; font-size: 18px; font-weight: 600;
    cursor: pointer; font-family: inherit; transition: background .1s;
    display: flex; align-items: center; justify-content: center;
  }
  .calc-key:active { background: #4a1e04; transform: scale(.96); }
  .calc-key.op { background: #3d1800; color: #e8a420; font-weight: 700; }
  .calc-key.clear { color: #ff8c8c; }
  .calc-key.eq {
    background: linear-gradient(135deg, #e8a420, #c98a1a); color: #1a0800; font-weight: 800;
    grid-column: span 2;
  }
  .calc-key.wide { grid-column: span 2; }

  #calcActions {
    display: flex; gap: 8px; margin-top: 12px;
  }
  #calcActions button {
    flex: 1; padding: 12px 0; border-radius: 10px; border: none; cursor: pointer;
    font-size: 13px; font-weight: 700; font-family: inherit;
  }
  #calcCancel { background: #2e1200; color: #c9a460; border: 1px solid #4a1e04; }
  #calcApply {
    background: linear-gradient(135deg, #0f7a3c, #0a5c2c); color: #fff;
  }
  #calcApply:disabled { opacity: .4; cursor: not-allowed; }

  #calcHistory {
    margin-top: 10px; max-height: 90px; overflow-y: auto;
    border-top: 1px solid #2e1200; padding-top: 8px;
  }
  .calc-hist-item {
    padding: 6px 10px; border-radius: 6px; font-size: 12px;
    color: #9a7040; cursor: pointer; text-align: right;
    display: flex; justify-content: space-between;
  }
  .calc-hist-item:hover { background: #2e1200; color: #e8a420; }
  .calc-hist-item .hExpr { opacity: .6; }
  .calc-hist-item .hVal { color: #e8a420; font-weight: 700; }
  `;
  var styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);

  // ---------- 2. STATE ----------
  var currentInput = null;   // the input we're editing
  var expr = '';             // current expression string
  var history = [];          // [{expr, value}]

  // ---------- 3. CALCULATOR MODAL (created once) ----------
  var overlay = document.createElement('div');
  overlay.id = 'calcOverlay';
  overlay.innerHTML = `
    <div id="calcCard" onclick="event.stopPropagation()">
      <div id="calcHandle"></div>
      <div id="calcDisplay">
        <div id="calcExpr"></div>
        <div id="calcResult">0</div>
      </div>
      <div id="calcQuick">
        <button class="calc-chip" data-quick="add5">+5%</button>
        <button class="calc-chip" data-quick="add13">+13% VAT</button>
        <button class="calc-chip" data-quick="sub10">−10%</button>
        <button class="calc-chip" data-quick="mul2">×2</button>
        <button class="calc-chip" data-quick="div2">÷2</button>
        <button class="calc-chip" data-quick="round5">Round 5</button>
        <button class="calc-chip" data-quick="round10">Round 10</button>
        <button class="calc-chip" data-quick="round100">Round 100</button>
        <button class="calc-chip" data-quick="clear">Clear</button>
      </div>
      <div id="calcPad">
        <button class="calc-key" data-k="7">7</button>
        <button class="calc-key" data-k="8">8</button>
        <button class="calc-key" data-k="9">9</button>
        <button class="calc-key op" data-k="/">÷</button>
        <button class="calc-key" data-k="4">4</button>
        <button class="calc-key" data-k="5">5</button>
        <button class="calc-key" data-k="6">6</button>
        <button class="calc-key op" data-k="*">×</button>
        <button class="calc-key" data-k="1">1</button>
        <button class="calc-key" data-k="2">2</button>
        <button class="calc-key" data-k="3">3</button>
        <button class="calc-key op" data-k="-">−</button>
        <button class="calc-key" data-k="0">0</button>
        <button class="calc-key" data-k=".">.</button>
        <button class="calc-key op" data-k="%">%</button>
        <button class="calc-key op" data-k="+">+</button>
        <button class="calc-key clear wide" data-k="C">Clear</button>
        <button class="calc-key clear" data-k="back">⌫</button>
        <button class="calc-key eq" data-k="=">=</button>
      </div>
      <div id="calcActions">
        <button id="calcCancel">Cancel</button>
        <button id="calcApply" disabled>Apply</button>
      </div>
      <div id="calcHistory"></div>
    </div>`;
  document.body.appendChild(overlay);

  var $expr = overlay.querySelector('#calcExpr');
  var $result = overlay.querySelector('#calcResult');
  var $apply = overlay.querySelector('#calcApply');
  var $history = overlay.querySelector('#calcHistory');

  // ---------- 4. EXPRESSION EVALUATOR (safe, no eval) ----------
  // Supports: + - * / % ( ) and decimal numbers
  function evaluate(expression) {
    if (!expression || !expression.trim()) return null;
    // Tokenize
    var tokens = [];
    var i = 0;
    while (i < expression.length) {
      var ch = expression[i];
      if (ch === ' ') { i++; continue; }
      if ('+-*/%()'.indexOf(ch) !== -1) {
        tokens.push(ch); i++; continue;
      }
      if (ch === '.' || (ch >= '0' && ch <= '9')) {
        var num = '';
        while (i < expression.length && ((expression[i] >= '0' && expression[i] <= '9') || expression[i] === '.')) {
          num += expression[i]; i++;
        }
        tokens.push(parseFloat(num));
        continue;
      }
      return null; // unknown char
    }
    // Recursive descent parser
    var pos = 0;
    function peek() { return tokens[pos]; }
    function next() { return tokens[pos++]; }
    function parseExpr() {
      var left = parseTerm();
      while (peek() === '+' || peek() === '-') {
        var op = next();
        var right = parseTerm();
        if (left === null || right === null) return null;
        left = op === '+' ? left + right : left - right;
      }
      return left;
    }
    function parseTerm() {
      var left = parseFactor();
      while (peek() === '*' || peek() === '/' || peek() === '%') {
        var op = next();
        var right = parseFactor();
        if (left === null || right === null) return null;
        if (op === '*') left = left * right;
        else if (op === '/') left = right === 0 ? null : left / right;
        else left = left % right;
      }
      return left;
    }
    function parseFactor() {
      var t = peek();
      if (t === '-') { next(); var f = parseFactor(); return f === null ? null : -f; }
      if (t === '(') {
        next();
        var inner = parseExpr();
        if (next() !== ')') return null;
        return inner;
      }
      if (typeof t === 'number') { next(); return t; }
      return null;
    }
    try {
      var result = parseExpr();
      if (pos !== tokens.length) return null;
      if (result === null || !isFinite(result)) return null;
      return result;
    } catch (e) { return null; }
  }

  // ---------- 5. RENDER ----------
  function render() {
    $expr.textContent = expr || '';
    var val = evaluate(expr);
    if (val === null) {
      $result.textContent = expr ? '…' : '0';
      $apply.disabled = true;
    } else {
      // Pretty-print: trim trailing zeros
      var clean = Math.round(val * 1e6) / 1e6;
      $result.textContent = clean;
      $apply.disabled = false;
    }
    // History
    $history.innerHTML = history.slice(-5).reverse().map(function (h, i) {
      return '<div class="calc-hist-item" data-hist="' + (history.length - 1 - i) + '">' +
             '<span class="hExpr">' + h.expr + '</span>' +
             '<span class="hVal">' + h.value + '</span>' +
             '</div>';
    }).join('');
  }

  // ---------- 6. OPEN / CLOSE ----------
  function open(input) {
    currentInput = input;
    expr = '';
    // If the field already has a number, seed it
    var cur = parseFloat(input.value);
    if (!isNaN(cur) && cur !== 0) expr = String(cur);
    render();
    overlay.classList.add('open');
  }
  function close() {
    overlay.classList.remove('open');
    currentInput = null;
  }
  function apply() {
    var val = evaluate(expr);
    if (val === null || !currentInput) return;
    var clean = Math.round(val * 100) / 100; // 2 decimal places
    currentInput.value = clean;
    // Fire events so the app notices
    currentInput.dispatchEvent(new Event('input', { bubbles: true }));
    currentInput.dispatchEvent(new Event('change', { bubbles: true }));
    // Push to history
    history.push({ expr: expr, value: clean });
    if (history.length > 20) history.shift();
    close();
  }

  // ---------- 7. EVENT WIRING ----------
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) close();
  });
  overlay.querySelector('#calcCancel').addEventListener('click', close);
  $apply.addEventListener('click', apply);

  // Keypad
  overlay.querySelectorAll('.calc-key').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var k = btn.dataset.k;
      if (k === 'C') { expr = ''; }
      else if (k === 'back') { expr = expr.slice(0, -1); }
      else if (k === '=') { apply(); return; }
      else { expr += k; }
      render();
    });
  });

  // Quick chips
  overlay.querySelectorAll('.calc-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var q = chip.dataset.quick;
      var val = evaluate(expr);
      if (q === 'clear') { expr = ''; render(); return; }
      if (val === null) { render(); return; }
      if (q === 'add5')    expr = String(Math.round(val * 1.05 * 100) / 100);
      if (q === 'add13')   expr = String(Math.round(val * 1.13 * 100) / 100);
      if (q === 'sub10')   expr = String(Math.round(val * 0.9  * 100) / 100);
      if (q === 'mul2')    expr = String(val * 2);
      if (q === 'div2')    expr = String(Math.round(val / 2 * 100) / 100);
      if (q === 'round5')  expr = String(Math.round(val / 5) * 5);
      if (q === 'round10') expr = String(Math.round(val / 10) * 10);
      if (q === 'round100')expr = String(Math.round(val / 100) * 100);
      render();
    });
  });

  // History taps
  $history.addEventListener('click', function (e) {
    var row = e.target.closest('[data-hist]');
    if (!row) return;
    var h = history[parseInt(row.dataset.hist, 10)];
    if (h) { expr = String(h.value); render(); }
  });

  // Keyboard support while modal is open
  document.addEventListener('keydown', function (e) {
    if (!overlay.classList.contains('open')) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Enter' || e.key === '=') { e.preventDefault(); apply(); return; }
    if (e.key === 'Backspace') { e.preventDefault(); expr = expr.slice(0, -1); render(); return; }
    if ('0123456789+-*/%().'.indexOf(e.key) !== -1) {
      e.preventDefault(); expr += e.key; render();
    }
  });

  // ---------- 8. AUTO-ATTACH TO NUMBER INPUTS ----------
  function attach(input) {
    if (input._calcAttached) return;
    if (input.dataset.noCalc === 'true') return;
    input._calcAttached = true;

    // Wrap in a container
    var wrap = document.createElement('div');
    wrap.className = 'calc-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'calc-btn';
    btn.title = 'Calculator';
    btn.innerHTML = '🧮';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      open(input);
    });
    wrap.appendChild(btn);

    // Enter key opens the calculator
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === '=') {
        e.preventDefault();
        open(input);
      }
    });
  }

  function scanAll() {
    document.querySelectorAll('input[type=number]').forEach(attach);
  }

  // Initial scan
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanAll);
  } else {
    scanAll();
  }

  // Watch for new inputs (modals)
  var mo = new MutationObserver(function (muts) {
    var hit = false;
    for (var i = 0; i < muts.length; i++) {
      if (muts[i].addedNodes && muts[i].addedNodes.length) { hit = true; break; }
    }
    if (hit) scanAll();
  });
  mo.observe(document.body, { childList: true, subtree: true });
})();
