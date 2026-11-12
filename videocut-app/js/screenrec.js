// Запис екрана прямо в редакторі: getDisplayMedia + MediaRecorder, готовий файл іде як звичайний імпорт.
import { toast, fmt } from './ui.js';

let rec = null, onFile = null, tick = 0;
export const canScreenRec = () => !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && window.MediaRecorder);
export const isScreenRecording = () => !!rec;
export function initScreenRec(cb) { onFile = cb; }

function bar() {
  let b = document.getElementById('scrBar');
  if (b) return b;
  b = document.createElement('div'); b.id = 'scrBar'; b.className = 'scr-bar'; b.setAttribute('role', 'status'); b.hidden = true;
  b.innerHTML = '<i class="scr-dot" aria-hidden="true"></i><span>Запис екрана</span><b id="scrTime">00:00</b><button type="button" class="btn btn-sm btn-danger-solid" id="scrStop">Зупинити</button>';
  document.body.append(b);
  b.querySelector('#scrStop').addEventListener('click', stopScreenRec);
  return b;
}

export async function startScreenRec() {
  if (rec) return;
  if (!canScreenRec()) { toast('Цей браузер не вміє записувати екран. Спробуйте Chrome або Edge.', 'err', 6000); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true }); }
  catch (e) { if (e && e.name !== 'NotAllowedError') toast('Не вдалося почати запис екрана', 'err'); return; }
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6e6 } : {});
  rec = { stream, recorder, chunks: [], t0: Date.now(), mime: recorder.mimeType || mime };
  recorder.ondataavailable = e => { if (e.data && e.data.size) rec.chunks.push(e.data); };
  recorder.onstop = finish;
  stream.getVideoTracks()[0].addEventListener('ended', stopScreenRec); // користувач натиснув «Припинити показ» у браузері
  recorder.start(1000);
  const b = bar(); b.hidden = false; document.body.classList.add('screen-recording');
  tick = setInterval(() => { const s = (Date.now() - rec.t0) / 1000; document.getElementById('scrTime').textContent = fmt(s); }, 250);
  toast('Йде запис екрана. Натисніть «Зупинити», щоб додати його в проєкт.', '', 4000);
}

export function stopScreenRec() {
  if (!rec || rec.stopping) return;
  rec.stopping = true;
  try { if (rec.recorder.state !== 'inactive') rec.recorder.stop(); } catch { /* вже зупинено */ }
  rec.stream.getTracks().forEach(t => t.stop());
}

async function finish() {
  const r = rec; rec = null; clearInterval(tick);
  const b = document.getElementById('scrBar'); if (b) b.hidden = true;
  document.body.classList.remove('screen-recording');
  const blob = new Blob(r.chunks, { type: r.mime || 'video/webm' });
  if (blob.size < 2000) { toast('Запис занадто короткий'); return; }
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  const file = new File([blob], `Запис екрана ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.webm`, { type: 'video/webm' });
  if (onFile) await onFile(file);
}
