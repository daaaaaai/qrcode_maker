'use strict';

/*
 * URL を入力すると、そのままの内容でプレーンな QR コードを描く。
 * 入力は一切加工しない（スキームの補完などもしない）。見えている文字列と
 * QR に入る内容を常に一致させるため。
 */

const input       = document.getElementById('input');
const canvas      = document.getElementById('canvas');
const ctx         = canvas.getContext('2d');
const note        = document.getElementById('note');
const downloadBtn = document.getElementById('download-btn');

/** QR コードの仕様で定められた四辺の余白（モジュール数） */
const QUIET_MODULES = 4;
/** 保存する PNG の一辺の目安。モジュール数で割り切れる値に丸めて使う */
const TARGET_PX = 1024;
/** 誤り訂正レベル。L/M/Q/H のうち、汎用的な M を固定で使う */
const ERROR_CORRECTION = 'M';

/*
 * 文字列→バイト列の変換を UTF-8 にする。
 * ライブラリの既定は charCodeAt の下位1バイトを取るだけ（Latin-1 相当）なので、
 * 日本語を含む URL やテキストがそのままだと壊れる。
 */
qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

let currentText = '';

function showNote(message, isError) {
  canvas.hidden = true;
  note.hidden = false;
  note.textContent = message;
  note.classList.toggle('error', Boolean(isError));
  downloadBtn.disabled = true;
  currentText = '';
}

function draw(qr) {
  const count = qr.getModuleCount();
  const total = count + QUIET_MODULES * 2;
  // モジュールを整数ピクセルに揃える。端数があるとスキャン時に読みにくくなる
  const scale = Math.max(1, Math.round(TARGET_PX / total));
  const size  = total * scale;

  canvas.width  = size;
  canvas.height = size;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = '#000000';
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!qr.isDark(row, col)) continue;
      ctx.fillRect((col + QUIET_MODULES) * scale, (row + QUIET_MODULES) * scale, scale, scale);
    }
  }

  canvas.hidden = false;
  note.hidden = true;
  downloadBtn.disabled = false;
}

function render() {
  const text = input.value.trim();

  if (!text) {
    showNote('URLを貼るとQRコードが出ます', false);
    return;
  }

  let qr;
  try {
    qr = qrcode(0, ERROR_CORRECTION); // 第1引数 0 = 型番を内容量から自動決定
    qr.addData(text);
    qr.make();
  } catch (_) {
    // 型番40でも入りきらない長さのときにここへ来る
    showNote('この内容は長すぎてQRコードにできません', true);
    return;
  }

  currentText = text;
  draw(qr);
}

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

input.addEventListener('input', render);
downloadBtn.addEventListener('click', download);

render();
