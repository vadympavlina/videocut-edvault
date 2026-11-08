// Субтитри: читання/запис SRT і WebVTT.

const ts = s => {
  const m = String(s).trim().match(/(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/);
  if (!m) return NaN;
  return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4].padEnd(3, '0')) / 1000;
};

export function parseSubtitles(text) {
  const out = [];
  const blocks = String(text).replace(/\r/g, '').replace(/^﻿/, '').split(/\n{2,}/);
  for (const b of blocks) {
    const lines = b.split('\n').filter(l => l.trim() !== '');
    const i = lines.findIndex(l => l.includes('-->'));
    if (i < 0) continue;
    const [a, z] = lines[i].split('-->');
    const start = ts(a), end = ts(z);
    const txt = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').trim();
    if (isFinite(start) && isFinite(end) && end > start && txt) out.push({ start, dur: end - start, text: txt });
  }
  return out.sort((a, b) => a.start - b.start);
}

const two = n => String(n).padStart(2, '0');
function stamp(t, sep) {
  t = Math.max(0, t);
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000), s = Math.floor(ms % 60000 / 1000);
  return `${two(h)}:${two(m)}:${two(s)}${sep}${String(ms % 1000).padStart(3, '0')}`;
}
export function toSrt(caps) {
  return caps.slice().sort((a, b) => a.start - b.start)
    .map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.start + c.dur, ',')}\n${c.text}\n`).join('\n');
}
export function toVtt(caps) {
  return 'WEBVTT\n\n' + caps.slice().sort((a, b) => a.start - b.start)
    .map(c => `${stamp(c.start, '.')} --> ${stamp(c.start + c.dur, '.')}\n${c.text}\n`).join('\n');
}
