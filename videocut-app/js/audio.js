// Мікшування звуку для експорту: блоками, щоб довгі відео не займали всю пам'ять.
// Швидкість кліпу змінюється без зміни тону (granular overlap-add).
import { AudioBufferSink } from '../vendor/mediabunny.min.mjs';
import { SR, GRAIN, HOP, CHAIN, SEARCH, WIN, alignGrains } from './stretch.js';
import { S, media, layout, musicDur } from './state.js';
import { fadeAlpha } from './render.js';
import { duckEnvelope } from './duck.js';

export { SR };
const sinks = new Map();
const sinkFor = m => { if (!sinks.has(m.id)) sinks.set(m.id, new AudioBufferSink(m.at)); return sinks.get(m.id); };
export function resetAudioSinks() { sinks.clear(); chains.clear(); }

// Читає PCM джерела [from, to) і перераховує в SR. Повертає [L, R].
async function readPCM(m, from, to) {
  from = Math.max(0, from); to = Math.min(m.duration, to);
  const len = Math.max(0, Math.ceil((to - from) * SR));
  const L = new Float32Array(len), R = new Float32Array(len);
  if (!len) return [L, R];
  const filled = new Uint8Array(len);
  for await (const w of sinkFor(m).buffers(from, to)) {
    const b = w.buffer, sr = b.sampleRate;
    const c0 = b.getChannelData(0), c1 = b.getChannelData(Math.min(1, b.numberOfChannels - 1));
    const j0 = Math.max(0, Math.floor((w.timestamp - from) * SR));
    const j1 = Math.min(len, Math.ceil((w.timestamp + w.duration - from) * SR));
    for (let j = j0; j < j1; j++) {
      const pos = ((from + j / SR) - w.timestamp) * sr;
      const i = Math.floor(pos);
      if (i < 0 || i >= c0.length) continue;
      const f = pos - i, i2 = Math.min(c0.length - 1, i + 1);
      L[j] = c0[i] + (c0[i2] - c0[i]) * f;
      R[j] = c1[i] + (c1[i2] - c1[i]) * f;
      filled[j] = 1;
    }
  }
  // між шматками, які віддав декодер, через округлення часу іноді випадає один семпл — це чути як клацання; заповнюємо сусіднім
  for (let j = 1; j < len; j++) if (!filled[j] && filled[j - 1]) { L[j] = L[j - 1]; R[j] = R[j - 1]; filled[j] = 1; }
  for (let j = len - 2; j >= 0; j--) if (!filled[j] && filled[j + 1]) { L[j] = L[j + 1]; R[j] = R[j + 1]; filled[j] = 1; }
  return [L, R];
}

// Сегменти звуку, що потрапляють у [t0, t1).
// src — які доріжки брати (для розпізнавання мовлення): { main, voice, music, layers, ids }; null — усе (експорт).
// ids — якщо задано, беруться лише елементи з цими id (наприклад, виділений кліп).
function segments(t0, t1, src = null) {
  const out = [];
  const want = (kind, id) => !src || ((src[kind] ?? false) && (!src.ids || src.ids.has(id)));
  for (const l of layout()) {
    if (l.end <= t0 || l.start >= t1) continue;
    const c = l.clip, m = media.get(c.mediaId);
    if (!m || !m.at || !m.canDecodeA || c.muted || (c.volume ?? 1) <= 0 || !want('main', c.id)) continue;
    out.push({ m, start: l.start, end: l.end, srcIn: c.in, speed: c.speed || 1, vol: c.volume ?? 1, fin: c.fadeIn || 0, fout: c.fadeOut || 0 });
  }
  for (const mu of S.project.music) {
    if (!want(mu.voice ? 'voice' : 'music', mu.id)) continue;
    const m = media.get(mu.mediaId);
    const d = musicDur(mu);
    if (!m || !m.at || !m.canDecodeA || mu.start + d <= t0 || mu.start >= t1) continue;
    out.push({ m, start: mu.start, end: mu.start + d, srcIn: mu.in, speed: 1, vol: mu.volume ?? 1, fin: mu.fadeIn || 0, fout: mu.fadeOut || 0, duck: !src && !!mu.duck });
  }
  for (const o of S.project.overlays) {
    if (o.type !== 'video' || o.muted || (o.volume ?? 1) <= 0 || !want('layers', o.id)) continue;
    const m = media.get(o.mediaId);
    if (!m || !m.at || !m.canDecodeA || o.start + o.dur <= t0 || o.start >= t1) continue;
    out.push({ m, start: o.start, end: o.start + Math.min(o.dur, m.duration - (o.in || 0)), srcIn: o.in || 0, speed: 1, vol: o.volume ?? 1, fin: 0, fout: 0 });
  }
  return out;
}

// кеш ланцюжків WSOLA: сусідні блоки експорту читають одні й ті самі ланцюжки
const chains = new Map();
async function chainFor(s, c) {
  const key = `${s.m.id}|${s.srcIn}|${s.speed}|${c}`;
  const hit = chains.get(key);
  if (hit) return hit;
  const k0 = c * CHAIN, k1 = k0 + CHAIN;
  const nom = k => Math.round(s.srcIn * SR + k * HOP * s.speed);
  const lo = nom(k0) - SEARCH - HOP, hi = nom(k1 - 1) + SEARCH + GRAIN + HOP * 2;
  const [L, R] = await readPCM(s.m, lo / SR, hi / SR);
  const base = Math.round(Math.max(0, lo) / 1); // readPCM починає з max(0, from)
  const mono = new Float32Array(L.length);
  for (let i = 0; i < mono.length; i++) mono[i] = (L[i] + R[i]) * 0.5;
  const noms = []; for (let k = k0; k < k1; k++) noms.push(nom(k));
  const ch = { L, R, base, starts: alignGrains(mono, base, noms) };
  if (chains.size > 6) chains.delete(chains.keys().next().value);
  chains.set(key, ch);
  return ch;
}
export function resetAudioCache() { chains.clear(); }

// Рендерить блок [t0, t1) таймлайну в AudioBuffer (48 кГц, стерео)
export async function renderBlock(t0, t1, { speechOnly = false, sources = null } = {}) {
  const src = sources || (speechOnly ? { main: true, voice: true, layers: true } : null);
  const n = Math.max(1, Math.round((t1 - t0) * SR));
  const outL = new Float32Array(n), outR = new Float32Array(n);
  let env = null;
  for (const s of segments(t0, t1, src)) {
    const a = Math.max(t0, s.start), b = Math.min(t1, s.end);
    const o0 = Math.round((a - t0) * SR), o1 = Math.round((b - t0) * SR);
    if (o1 <= o0) continue;
    if (s.duck && !env) env = duckEnvelope(t0, t1);
    // без плавних появ/зникнень у цьому блоці й без приглушення — сталий множник (швидше)
    const fades = (s.fin > 0 && a < s.start + s.fin) || (s.fout > 0 && b > s.end - s.fout);
    const gain = !fades && !s.duck ? (() => s.vol) : s.duck ? (j => s.vol * fadeAlpha(t0 + j / SR, s.start, s.end - s.start, s.fin, s.fout) * env.at(t0 + j / SR)) : (j => s.vol * fadeAlpha(t0 + j / SR, s.start, s.end - s.start, s.fin, s.fout));
    if (Math.abs(s.speed - 1) < 1e-3) {
      const from = s.srcIn + (a - s.start);
      const [L, R] = await readPCM(s.m, from, from + (o1 - o0) / SR + 1 / SR);
      for (let j = o0, i = 0; j < o1; j++, i++) { const g = gain(j); outL[j] += (L[i] || 0) * g; outR[j] += (R[i] || 0) * g; }
      continue;
    }
    // зміна швидкості без зміни тону (WSOLA): зерна по 50 мс, крок виходу HOP, початок у джерелі підбирається за формою хвилі
    const segStartIdx = Math.round((s.start - t0) * SR); // індекс початку сегмента відносно блока (може бути від'ємним)
    const rel0 = o0 - segStartIdx, rel1 = o1 - segStartIdx; // позиції всередині сегмента (у вихідних семплах)
    const kMin = Math.max(0, Math.floor((rel0 - GRAIN) / HOP) + 1), kMax = Math.floor((rel1 - 1) / HOP);
    for (let c = Math.floor(kMin / CHAIN); c <= Math.floor(kMax / CHAIN); c++) {
      const ch = await chainFor(s, c);
      for (let k = Math.max(kMin, c * CHAIN); k <= Math.min(kMax, (c + 1) * CHAIN - 1); k++) {
        const oStart = k * HOP;                    // початок зерна у виході (відносно сегмента)
        const sStart = ch.starts[k - c * CHAIN] - ch.base; // початок зерна в прочитаному PCM
        const iFrom = Math.max(0, rel0 - oStart), iTo = Math.min(GRAIN, rel1 - oStart);
        for (let i = iFrom; i < iTo; i++) {
          const si = sStart + i;
          if (si < 0 || si >= ch.L.length) continue;
          const j = oStart + i + segStartIdx;
          const g = gain(j) * WIN[i];
          outL[j] += ch.L[si] * g; outR[j] += ch.R[si] * g;
        }
      }
    }
  }
  // м'яке обмеження, щоб суміш не «хрипіла»
  for (let j = 0; j < n; j++) {
    if (outL[j] > 1 || outL[j] < -1) outL[j] = Math.tanh(outL[j]);
    if (outR[j] > 1 || outR[j] < -1) outR[j] = Math.tanh(outR[j]);
  }
  const buf = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: SR });
  buf.copyToChannel(outL, 0); buf.copyToChannel(outR, 1);
  return buf;
}

export function hasAnyAudio() {
  return layout().some(l => { const m = media.get(l.clip.mediaId); return m && m.at && m.canDecodeA && !l.clip.muted; })
    || S.project.music.some(mu => { const m = media.get(mu.mediaId); return m && m.at && m.canDecodeA; })
    || S.project.overlays.some(o => { if (o.type !== 'video' || o.muted) return false; const m = media.get(o.mediaId); return m && m.at && m.canDecodeA; });
}
