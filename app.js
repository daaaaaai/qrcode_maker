'use strict';

/*
 * URL を入力すると、そのままの内容で QR コードを描く。
 * 入力は一切加工しない（スキームの補完などもしない）。見えている文字列と
 * QR に入る内容を常に一致させるため。
 */

const input       = document.getElementById('input');
const canvas      = document.getElementById('canvas');
const ctx         = canvas.getContext('2d');
const note        = document.getElementById('note');
const downloadBtn = document.getElementById('download-btn');
const shapeGroup  = document.getElementById('shape-group');
const fgInput     = document.getElementById('fg-input');
const bgInput     = document.getElementById('bg-input');
const contrastEl  = document.getElementById('contrast');
const warnEl      = document.getElementById('warn');
const hintEl      = document.getElementById('hint');
const resetBtn    = document.getElementById('reset-btn');
const centerInput = document.getElementById('center-input');
const centerSizes = document.getElementById('center-size-group');

/** QR コードの仕様で定められた四辺の余白（モジュール数） */
const QUIET_MODULES = 4;
/** 保存する PNG の一辺の目安。モジュール数で割り切れる値に丸めて使う */
const TARGET_PX = 1024;

const DEFAULTS = { shape: 'square', fg: '#000000', bg: '#ffffff', center: '', centerSize: 'm' };

/*
 * 文字列→バイト列の変換を UTF-8 にする。
 * ライブラリの既定は charCodeAt の下位1バイトを取るだけ（Latin-1 相当）なので、
 * 日本語を含む URL やテキストがそのままだと壊れる。
 */
qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

/**
 * 粒の形。`radius` はモジュール1辺に対する比率。
 *
 * `square` 以外では誤り訂正レベルを上げる。形を崩したぶんの余裕を、
 * 操作を増やさずに確保するため（レベルを上げるとモジュール数も増えて粒が細かくなる）。
 */
const SHAPES = {
  square: { ec: 'M', radius: 0    },
  round:  { ec: 'Q', radius: 0.3  },
  dot:    { ec: 'Q', radius: 0.5, inset: 0.85 },
};

/**
 * 使う誤り訂正レベル。
 * 中央に文字を重ねるとその面積ぶんモジュールが読めなくなるので、最も強い H にする。
 * 粒の形による底上げ（Q）より優先される。
 */
function errorCorrection() {
  return center ? 'H' : SHAPES[shape].ec;
}

/** これを下回ったら読み取りが不安定になりうる、という目安のコントラスト比 */
const CONTRAST_MIN = 3;

/*
 * 中央に重ねる箱の一辺（コード本体の一辺に対する比率）。
 *
 * 誤り訂正 H での実測では一辺 48%（面積 23%）まで読めて 50% で読めなくなる。
 * そこまで使わず 35% で止めているのは、誤り訂正がもともと汚れやかすれのための
 * 余裕であり、文字で使い切ると印刷の擦れや影で読めなくなるため。
 * 検証に使った ZXing は実機のカメラより寛容でもあるので、その分も見込んでいる。
 */
const CENTER_SIZES = { s: 0.22, m: 0.28, l: 0.35 };

let shape       = DEFAULTS.shape;
let fg          = DEFAULTS.fg;
let bg          = DEFAULTS.bg;
let center      = DEFAULTS.center;
let centerSize  = DEFAULTS.centerSize;
let currentText = '';

// ─── 色 ────────────────────────────────────────────────

/** 相対輝度（WCAG の定義） */
function luminance(hex) {
  const ch = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** コントラスト比。1〜21 の値を返す */
function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function updateColorHints() {
  const ratio = contrastRatio(fg, bg);
  contrastEl.textContent = `明暗差 ${ratio.toFixed(1)}:1`;

  const messages = [];
  if (ratio < CONTRAST_MIN) {
    messages.push('前景と背景の明暗差が小さく、読み取れないことがあります。');
  }
  if (luminance(fg) > luminance(bg)) {
    // 規格は「暗い前景／明るい背景」を前提にしている
    messages.push('明暗が反転しています。読み取り機によっては読めません。');
  }

  warnEl.hidden = messages.length === 0;
  warnEl.textContent = messages.join(' ');
}

// ─── 描画 ──────────────────────────────────────────────

/**
 * 3隅の位置検出パターン（7×7）に含まれるか。
 *
 * ここは読み取り機が 1:1:3:1:1 の比率で探し当てる部分なので、**常に四角で描く**。
 * 丸めると検出そのものが失敗する。形を選べるのはデータ部だけ。
 */
function isFinder(row, col, count) {
  return (
    (row < 7 && col < 7) ||
    (row < 7 && col >= count - 7) ||
    (row >= count - 7 && col < 7)
  );
}

function drawModule(x, y, size, def, square) {
  if (square || def.radius === 0) {
    ctx.fillRect(x, y, size, size);
    return;
  }
  if (def.inset) {
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, (size / 2) * def.inset, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, size * def.radius);
  ctx.fill();
}

/**
 * 中央に箱と文字を重ねる。モジュールを描いたあとに上から乗せる。
 * 文字は箱の内側に収まるまでフォントサイズを詰める（長い文字ではみ出させない）。
 */
function drawCenter(canvasSize, codePx) {
  const box = Math.round(codePx * CENTER_SIZES[centerSize]);
  const x = (canvasSize - box) / 2;
  const y = (canvasSize - box) / 2;

  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x, y, box, box, box * 0.15);
  ctx.fill();

  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxWidth = box * 0.78;
  let fontSize = Math.floor(box * 0.46);
  for (; fontSize > 4; fontSize--) {
    ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Segoe UI", sans-serif`;
    if (ctx.measureText(center).width <= maxWidth) break;
  }
  ctx.fillText(center, canvasSize / 2, canvasSize / 2);
}

function draw(qr, def) {
  const count = qr.getModuleCount();
  const total = count + QUIET_MODULES * 2;
  // モジュールを整数ピクセルに揃える。端数があるとスキャン時に読みにくくなる
  const scale = Math.max(1, Math.round(TARGET_PX / total));
  const size  = total * scale;

  canvas.width  = size;
  canvas.height = size;

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = fg;
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!qr.isDark(row, col)) continue;
      drawModule(
        (col + QUIET_MODULES) * scale,
        (row + QUIET_MODULES) * scale,
        scale,
        def,
        isFinder(row, col, count),
      );
    }
  }

  if (center) drawCenter(size, count * scale);

  // 誤り訂正を H に上げたぶんモジュールが増えている。小さく刷るときに効くので伝える
  hintEl.hidden = !center;
  if (center) {
    hintEl.textContent =
      `中央に文字を入れたぶん粒が細かくなっています（${count}×${count}）。` +
      '小さく印刷するときは、実際に読み取れるか確かめてください。';
  }

  canvas.classList.toggle('smooth', def.radius !== 0);
  canvas.hidden = false;
  note.hidden = true;
  downloadBtn.disabled = false;
}

function showNote(message, isError) {
  canvas.hidden = true;
  note.hidden = false;
  note.textContent = message;
  note.classList.toggle('error', Boolean(isError));
  downloadBtn.disabled = true;
  hintEl.hidden = true;
  currentText = '';
}

function render() {
  updateColorHints();
  centerSizes.classList.toggle('disabled', center === '');

  const text = input.value.trim();
  if (!text) {
    showNote('URLを貼るとQRコードが出ます', false);
    return;
  }

  const def = SHAPES[shape];
  let qr;
  try {
    qr = qrcode(0, errorCorrection()); // 第1引数 0 = 型番を内容量から自動決定
    qr.addData(text);
    qr.make();
  } catch (_) {
    // 型番40でも入りきらない長さのときにここへ来る
    showNote('この内容は長すぎてQRコードにできません', true);
    return;
  }

  currentText = text;
  draw(qr, def);
}

// ─── 保存 ──────────────────────────────────────────────

/** 保存名。URL として読めればホスト名を使い、無理なら qrcode にする */
function fileName() {
  try {
    const host = new URL(currentText).hostname;
    if (host) return `qr-${host}.png`;
  } catch (_) { /* URL でなければ既定名 */ }
  return 'qrcode.png';
}

function download() {
  if (downloadBtn.disabled) return;
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName();
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

// ─── 操作 ──────────────────────────────────────────────

function selectShape(next) {
  shape = next;
  for (const btn of shapeGroup.querySelectorAll('.seg')) {
    btn.setAttribute('aria-checked', String(btn.dataset.shape === next));
  }
  render();
}

shapeGroup.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg');
  if (btn) selectShape(btn.dataset.shape);
});

function selectCenterSize(next) {
  centerSize = next;
  for (const btn of centerSizes.querySelectorAll('.seg')) {
    btn.setAttribute('aria-checked', String(btn.dataset.size === next));
  }
  render();
}

centerSizes.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg');
  if (btn) selectCenterSize(btn.dataset.size);
});

fgInput.addEventListener('input', () => { fg = fgInput.value; render(); });
bgInput.addEventListener('input', () => { bg = bgInput.value; render(); });

centerInput.addEventListener('input', () => {
  center = centerInput.value.trim();
  render();
});

resetBtn.addEventListener('click', () => {
  fg = fgInput.value = DEFAULTS.fg;
  bg = bgInput.value = DEFAULTS.bg;
  center = centerInput.value = DEFAULTS.center;
  selectCenterSize(DEFAULTS.centerSize);
  selectShape(DEFAULTS.shape);
});

input.addEventListener('input', render);
downloadBtn.addEventListener('click', download);

render();
