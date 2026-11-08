// Автоматичні субтитри: збираємо голос із таймлайну (16 кГц моно), ділимо на шматки по тиші й віддаємо Whisper у Worker.
import { S, media, emit, duration, outputSize, layout, musicDur, findSel } from './state.js';
import { capStyle, capMaxChars, splitCaption, tidyCaptions } from './cc.js';
import { renderBlock, resetAudioSinks } from './audio.js';
import { setCaptionsIn } from './ops.js';
import { $, esc, fmt, toast, openModal, closeModal } from './ui.js';

const SR = 16000;
export const ASR_MODELS = {
  base: { id: 'onnx-community/whisper-base', size: '≈ 80 МБ' },
  small: { id: 'onnx-community/whisper-small', size: '≈ 250 МБ' },
};

// звук з таймлайну на відрізку [a, b], моно 16 кГц; sources — які доріжки брати (див. audio.js)
export async function speechAudio(a, b, sources, onProgress) {
  const out = new Float32Array(Math.max(0, Math.ceil((b - a) * SR)));
  resetAudioSinks();
  for (let t = a; t < b - 1e-6; t += 4) {
    const e = Math.min(b, t + 4);
    const buf = await renderBlock(t, e, { sources });
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const o0 = Math.round((t - a) * SR);
    for (let i = 0, j = 0; j < L.length - 2 && o0 + i < out.length; i++, j += 3) out[o0 + i] = (L[j] + R[j] + L[j + 1] + R[j + 1] + L[j + 2] + R[j + 2]) / 6;
    onProgress?.((e - a) / (b - a));
  }
  return out;
}

// ── звідки брати мовлення ──
// Кожен варіант — набір доріжок (див. segments у audio.js). `ids` додається для «виділеного елемента».
const hasAudio = m => !!(m && m.at && m.canDecodeA);
function stats() {
  const p = S.project;
  const sum = list => ({ n: list.length, dur: list.reduce((s, x) => s + x.d, 0) });
  const main = layout().filter(l => hasAudio(media.get(l.clip.mediaId)) && !l.clip.muted).map(l => ({ d: l.end - l.start }));
  const voice = p.music.filter(x => x.voice && hasAudio(media.get(x.mediaId))).map(x => ({ d: musicDur(x) }));
  const music = p.music.filter(x => !x.voice && hasAudio(media.get(x.mediaId))).map(x => ({ d: musicDur(x) }));
  const layers = p.overlays.filter(o => o.type === 'video' && !o.muted && hasAudio(media.get(o.mediaId))).map(o => ({ d: o.dur }));
  return { main: sum(main), voice: sum(voice), music: sum(music), layers: sum(layers) };
}
function selectedItem() {
  const o = findSel(), s = S.sel;
  if (!o || !s) return null;
  if (s.kind === 'clip') return hasAudio(media.get(o.mediaId)) && !o.muted ? { kind: 'main', id: o.id, name: media.get(o.mediaId).name } : null;
  if (s.kind === 'music') return hasAudio(media.get(o.mediaId)) ? { kind: o.voice ? 'voice' : 'music', id: o.id, name: o.voice ? 'Озвучення' : media.get(o.mediaId).name } : null;
  if (s.kind === 'overlay' && o.type === 'video') return hasAudio(media.get(o.mediaId)) && !o.muted ? { kind: 'layers', id: o.id, name: media.get(o.mediaId).name } : null;
  return null;
}
const SRC_DEFS = [
  { id: 'sel', title: 'Виділений елемент', hint: s => (s.sel ? `«${s.sel.name}»` : 'Спершу виділіть кліп чи звук на таймлайні'), ok: s => !!s.sel, src: s => ({ [s.sel.kind]: true, ids: new Set([s.sel.id]) }) },
  { id: 'speech', title: 'Увесь голос', hint: () => 'Звук основного відео, озвучення й відео поверх — без музики', ok: s => s.main.n + s.voice.n + s.layers.n > 0, src: () => ({ main: true, voice: true, layers: true }) },
  { id: 'all', title: 'Усе, що звучить', hint: () => 'Усі звукові доріжки разом, разом із музикою', ok: s => s.main.n + s.voice.n + s.layers.n + s.music.n > 0, src: () => ({ main: true, voice: true, layers: true, music: true }) },
  { id: 'main', title: 'Лише основне відео', hint: s => `${s.main.n} ${s.main.n === 1 ? 'кліп' : 'кліпів'} · ${fmt(s.main.dur)}`, ok: s => s.main.n > 0, src: () => ({ main: true }) },
  { id: 'voice', title: 'Лише озвучення', hint: s => (s.voice.n ? `Записаний голос · ${fmt(s.voice.dur)}` : 'Озвучення ще не записано'), ok: s => s.voice.n > 0, src: () => ({ voice: true }) },
  { id: 'layers', title: 'Лише відео поверх', hint: s => (s.layers.n ? `${s.layers.n} шт. · ${fmt(s.layers.dur)}` : 'Немає відео поверх основного'), ok: s => s.layers.n > 0, src: () => ({ layers: true }) },
  { id: 'music', title: 'Лише музика та звуки', hint: s => (s.music.n ? `${s.music.n} шт. · наприклад, пісня з текстом` : 'Немає доданої музики'), ok: s => s.music.n > 0, src: () => ({ music: true }) },
];
const RANGES = [
  { id: 'all', title: 'Весь проєкт' },
  { id: 'marks', title: 'Позначений шматок' },
  { id: 'cursor', title: 'Від курсора до кінця' },
];
function rangeOf(id) {
  const end = duration();
  if (id === 'marks' && S.markIn != null && S.markOut != null && S.markOut - S.markIn > 0.2) return [Math.max(0, S.markIn), Math.min(end, S.markOut)];
  if (id === 'cursor' && S.t < end - 0.3) return [S.t, end];
  return [0, end];
}

// ділимо на шматки ≤ 28 с у найтихіших місцях
export function splitParts(a, maxLen = 28) {
  const parts = [];
  const win = SR / 20; // 50 мс
  const energy = i => { let s = 0; for (let k = i; k < Math.min(a.length, i + win); k++) s += a[k] * a[k]; return s; };
  let start = 0;
  while (start < a.length) {
    let end = Math.min(a.length, start + maxLen * SR);
    if (end < a.length) {
      // шукаємо найтихіше вікно в останніх 8 с шматка
      let best = end, be = Infinity;
      for (let i = end - 8 * SR; i < end - win; i += win) { const e = energy(i); if (e < be) { be = e; best = i + win / 2; } }
      end = Math.round(best);
    }
    const seg = a.subarray(start, end);
    let loud = 0; for (let i = 0; i < seg.length; i += 160) loud = Math.max(loud, Math.abs(seg[i]));
    if (loud > 0.01) parts.push({ offset: start / SR, audio: seg.slice() });
    start = end;
  }
  return parts;
}

// фрази Whisper → субтитри, що вміщаються в задану кількість символів
export function toCaptions(chunks, offset, partLen, max = 74) {
  const out = [];
  for (const c of chunks) {
    const text = (c.text || '').replace(/\s+/g, ' ').trim();
    if (!text || /^\[.*\]$|^\(.*\)$/.test(text)) continue;
    let [a, b] = c.timestamp || [0, null];
    a = (a ?? 0); b = b == null ? partLen : b;
    if (b <= a) b = a + Math.max(1, text.length * 0.06);
    for (const x of splitCaption({ start: offset + a, dur: b - a, text }, max)) out.push({ ...x, dur: Math.max(0.6, x.dur) });
  }
  return out;
}

let worker = null, running = null;
const opt = { lang: 'uk', model: 'base', source: 'speech', range: 'all', mode: 'replace' };
let curStats = null;

export function initAsr() {
  const segPick = (id, key) => $(id).addEventListener('click', e => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    $(id).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    opt[key] = b.dataset.v;
  });
  segPick('asrLang', 'lang'); segPick('asrModel', 'model');
  segPick('asrRange', 'range'); segPick('asrMode', 'mode');
  $('asrRange').addEventListener('click', refreshInfo);
  $('asrMode').addEventListener('click', refreshInfo);
  $('asrSources').addEventListener('change', e => { if (e.target.name === 'asrSrc') { opt.source = e.target.value; refreshInfo(); } });
  $('asrStart').addEventListener('click', start);
  $('asrCancel').addEventListener('click', cancel);
}

export function openAsr() {
  if (!S.project.clips.length && !S.project.music.length) { toast('Спочатку додайте відео чи звук'); return; }
  if (running) { openModal('asrModal'); return; }
  $('asrSetup').hidden = false; $('asrRun').hidden = true;
  curStats = { ...stats(), sel: selectedItem() };
  // за замовчуванням: виділений елемент → він; інакше попередній вибір, якщо доступний; інакше «увесь голос»
  let pick = curStats.sel ? SRC_DEFS[0] : SRC_DEFS.find(d => d.id === opt.source && d.id !== 'sel' && d.ok(curStats));
  if (!pick) pick = SRC_DEFS.find(d => d.id !== 'sel' && d.ok(curStats));
  opt.source = pick ? pick.id : 'speech';
  $('asrSources').innerHTML = SRC_DEFS.map(d => {
    const ok = d.ok(curStats);
    return `<label class="src-opt${ok ? '' : ' off'}"><input type="radio" name="asrSrc" value="${d.id}" ${d.id === opt.source ? 'checked' : ''} ${ok ? '' : 'disabled'}><span><b>${esc(d.title)}</b><small>${esc(d.hint(curStats))}</small></span></label>`;
  }).join('');
  // «позначений шматок» доступний, лише коли позначено початок і кінець
  const hasMarks = S.markIn != null && S.markOut != null && S.markOut - S.markIn > 0.2;
  $('asrRange').querySelectorAll('button').forEach(b => {
    const v = b.dataset.v;
    b.disabled = (v === 'marks' && !hasMarks) || (v === 'cursor' && S.t >= duration() - 0.3);
    if (b.disabled && opt.range === v) opt.range = 'all';
    b.classList.toggle('on', b.dataset.v === opt.range);
  });
  $('asrModeWrap').hidden = !S.project.captions.length;
  refreshInfo();
  openModal('asrModal');
}

function refreshInfo() {
  const [a, b] = rangeOf(opt.range);
  const len = b - a;
  const n = S.project.captions.filter(c => c.start < b && c.start + c.dur > a).length;
  let html = `Відрізок <b>${fmt(a)} – ${fmt(b)}</b> (${fmt(len)}). Розпізнавання займе приблизно стільки ж часу (швидше з відеокартою).`;
  if (n) html += opt.mode === 'replace' ? `<br><span class="warn">Наявні субтитри на цьому відрізку (${n}) буде замінено — це можна скасувати через Ctrl+Z.</span>` : `<br>Нові субтитри додадуться до наявних (${n}). Можливі накладання — потім скористайтеся «Виправити час».`;
  $('asrInfo').innerHTML = html;
}

function setProg(p, text) {
  $('asrBar').style.width = (Math.max(0, Math.min(1, p)) * 100).toFixed(1) + '%';
  $('asrPct').textContent = Math.floor(p * 100) + '%';
  if (text) $('asrStage').textContent = text;
}

async function start() {
  const model = ASR_MODELS[opt.model];
  const def = SRC_DEFS.find(d => d.id === opt.source);
  if (!def || !curStats || !def.ok(curStats)) { toast('Оберіть, з чого розпізнавати мову', 'err'); return; }
  const sources = def.src(curStats);
  const [ra, rb] = rangeOf(opt.range);
  const mode = S.project.captions.length ? opt.mode : 'replace';
  $('asrSetup').hidden = true; $('asrRun').hidden = false;
  setProg(0, 'Збираємо звук…');
  running = { cancelled: false };
  const run = running;
  try {
    const audio = await speechAudio(ra, rb, sources, p => setProg(p * 0.1));
    if (run.cancelled) return;
    const parts = splitParts(audio);
    if (!parts.length) throw new Error('У вибраному звуці не знайдено мовлення. Спробуйте інше джерело, наприклад «Усе, що звучить».');
    const total = parts.reduce((s, p) => s + p.audio.length, 0);
    setProg(0.1, `Завантажуємо модель розпізнавання (${model.size}, лише перший раз)…`);
    if (!worker) worker = new Worker(new URL('./asr-worker.js', import.meta.url), { type: 'module' });
    const caps = [];
    const { W, H } = outputSize();
    const maxChars = capMaxChars(capStyle(S.project), W, H);
    let doneLen = 0;
    const files = new Map();
    await new Promise((resolve, reject) => {
      run.reject = reject;
      worker.onmessage = e => {
        const d = e.data;
        if (run.cancelled) return;
        if (d.type === 'dl') {
          files.set(d.file, [d.loaded, d.total]);
          let l = 0, t = 0; files.forEach(([a, b]) => { l += a; t += b; });
          setProg(0.1 + 0.2 * (l / t), `Завантажуємо модель: ${(l / 1048576).toFixed(0)} з ${(t / 1048576).toFixed(0)} МБ (лише перший раз)…`);
        } else if (d.type === 'ready') {
          setProg(0.3, d.device === 'webgpu' ? 'Розпізнаємо мову (з відеокартою)…' : 'Розпізнаємо мову…');
        } else if (d.type === 'part') {
          caps.push(...toCaptions(d.chunks.length ? d.chunks : [{ text: d.text, timestamp: [0, d.len] }], ra + d.offset, d.len, maxChars));
          doneLen += parts[d.i].audio.length;
          setProg(0.3 + 0.7 * doneLen / total, `Розпізнано ${fmt(ra + d.offset + d.len)} з ${fmt(rb)}…`);
        } else if (d.type === 'done') resolve();
        else if (d.type === 'error') reject(new Error(d.message));
      };
      worker.onerror = e => reject(new Error(e.message || 'Помилка розпізнавання'));
      worker.postMessage({ type: 'run', model: model.id, language: opt.lang === 'auto' ? null : opt.lang, parts }, parts.map(p => p.audio.buffer));
    });
    if (run.cancelled) return;
    // не даємо субтитрам перекриватися
    tidyCaptions(caps);
    setCaptionsIn(caps, mode, [ra, rb]);
    closeModal('asrModal');
    toast(caps.length ? `Готово: ${caps.length} субтитрів. Перевірте текст — його можна виправити у вкладці «Субтитри»` : 'Мовлення не розпізнано', caps.length ? 'ok' : 'err', 6000);
    emit('asr-done');
  } catch (e) {
    console.error(e);
    if (!run.cancelled) {
      $('asrSetup').hidden = false; $('asrRun').hidden = true;
      $('asrInfo').innerHTML = `<span class="warn">${/fetch|network|Failed to load|import/i.test(e.message) ? 'Не вдалося завантажити модель розпізнавання. Перевірте інтернет і спробуйте ще раз.' : 'Не вдалося розпізнати: ' + esc(e.message)}</span>`;
    }
  } finally { if (running === run) running = null; }
}

function cancel() {
  if (!running) { closeModal('asrModal'); return; }
  running.cancelled = true;
  if (worker) { worker.terminate(); worker = null; }
  running = null;
  $('asrSetup').hidden = false; $('asrRun').hidden = true;
  closeModal('asrModal');
  toast('Розпізнавання скасовано');
}
export const asrBusy = () => !!running;
