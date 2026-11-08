// Озвучення: запис голосу з мікрофона поверх відео.
import { S, on, duration } from './state.js';
import { addMedia } from './media.js';
import { addVoice } from './ops.js';
import { play, pause, seek } from './player.js';
import { $, fmt, toast, openModal, closeModal } from './ui.js';

// ══════════ Озвучення (запис голосу) ══════════
let rec = null;
export const isRecording = () => !!rec; // { recorder, stream, chunks, start, mime, t0, timer }
export function openVoice() {
  if (rec) { stopVoice(); return; }
  if (!duration()) { toast('Спочатку додайте відео, яке будете озвучувати'); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('Цей браузер не вміє записувати звук. Спробуйте Chrome або Edge.', 'err', 5000); return; }
  pause();
  if (S.t >= duration() - 0.5) seek(0);
  $('voFrom').textContent = fmt(S.t, true);
  $('voInfo').textContent = 'Браузер попросить дозвіл на мікрофон.';
  openModal('voModal');
}
on('open-voice', openVoice);
$('btnVoice').addEventListener('click', openVoice);
$('btnRecStop').addEventListener('click', () => stopVoice());
$('voStart').addEventListener('click', async () => {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    $('voInfo').innerHTML = '<span class="warn">Немає доступу до мікрофона. Дозвольте його в адресному рядку браузера й спробуйте ще раз.</span>';
    return;
  }
  closeModal('voModal');
  const mute = $('voMute').checked;
  // відлік 3-2-1
  const cnt = $('recCount');
  cnt.hidden = false;
  for (const n of [3, 2, 1]) { cnt.textContent = n; cnt.classList.remove('pop'); void cnt.offsetWidth; cnt.classList.add('pop'); await new Promise(r => setTimeout(r, 800)); }
  cnt.hidden = true;
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 128000 } : {});
  rec = { recorder, stream, chunks: [], start: S.t, mime: recorder.mimeType || mime, t0: performance.now() };
  recorder.ondataavailable = e => { if (e.data && e.data.size) rec.chunks.push(e.data); };
  const started = new Promise(res => { recorder.onstart = res; });
  recorder.start(250);
  await started;
  rec.latency = Math.max(0, Math.min(0.5, stream.getAudioTracks()[0]?.getSettings?.().latency || 0));
  S.recMute = mute;
  document.body.classList.add('recording');
  $('recBadge').hidden = false;
  rec.timer = setInterval(() => { $('recTime').textContent = fmt((performance.now() - rec.t0) / 1000); }, 200);
  play();
});
// відео дограло до кінця — завершуємо запис
on('play', () => { if (rec && !S.playing && !rec.stopping) stopVoice(); });

export async function stopVoice() {
  if (!rec || rec.stopping) return;
  const r = rec;
  r.stopping = true;
  clearInterval(r.timer);
  const done = new Promise(res => { r.recorder.onstop = res; });
  try { r.recorder.stop(); } catch (e) { /* ignore */ }
  pause();
  await done;
  r.stream.getTracks().forEach(t => t.stop());
  S.recMute = false;
  document.body.classList.remove('recording');
  $('recBadge').hidden = true;
  rec = null;
  const blob = new Blob(r.chunks, { type: r.mime || 'audio/webm' });
  if (blob.size < 1000) { toast('Запис занадто короткий'); return; }
  const ext = /mp4/.test(r.mime) ? 'm4a' : /ogg/.test(r.mime) ? 'ogg' : 'webm';
  try {
    toast('Обробляємо запис…', '', 20000);
    const m = await addMedia(blob, `Голос ${fmt(r.start).replace(':', '-')}.${ext}`);
    addVoice(m, r.start, r.latency || 0);
    seek(r.start);
    toast('Голос додано на звукову доріжку. Відтворіть, щоб послухати', 'ok', 4500);
  } catch (e) {
    console.error(e);
    toast('Не вдалося зберегти запис: ' + (e.message || e), 'err', 6000);
  }
}
