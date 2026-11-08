// Розпізнавання мови (Whisper) у фоновому потоці. Модель завантажується один раз і кешується браузером.
// Локальна копія (vendor/transformers/transformers.min.js) має перевагу; без неї — CDN.
const LOCAL_LIB = new URL('../vendor/transformers/transformers.min.js', import.meta.url).href;
const CDN_LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';
async function loadLib() {
  try { const r = await fetch(LOCAL_LIB, { method: 'HEAD' }); if (r.ok && !/html/.test(r.headers.get('content-type') || '')) return await import(LOCAL_LIB); } catch (e) { /* немає локальної копії */ }
  return import(CDN_LIB);
}
let lib = null, asr = null, loadedKey = null;

async function load(model) {
  if (asr && loadedKey === model) return;
  if (!lib) lib = await loadLib();
  lib.env.allowLocalModels = false;
  const progress = d => {
    if (d.status === 'progress' && d.total) postMessage({ type: 'dl', file: d.file, loaded: d.loaded, total: d.total });
  };
  let device = 'wasm';
  if (self.navigator && navigator.gpu) {
    try { if (await navigator.gpu.requestAdapter()) device = 'webgpu'; } catch (e) { /* немає GPU */ }
  }
  const make = dev => lib.pipeline('automatic-speech-recognition', model, {
    device: dev,
    dtype: dev === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
    progress_callback: progress,
  });
  try { asr = await make(device); }
  catch (e) { if (device === 'wasm') throw e; device = 'wasm'; asr = await make('wasm'); }
  loadedKey = model;
  postMessage({ type: 'ready', device });
}

self.onmessage = async e => {
  const d = e.data;
  try {
    if (d.type === 'run') {
      await load(d.model);
      for (let i = 0; i < d.parts.length; i++) {
        const p = d.parts[i];
        const out = await asr(p.audio, { language: d.language || null, task: 'transcribe', return_timestamps: true });
        postMessage({ type: 'part', i, offset: p.offset, len: p.audio.length / 16000, text: out.text || '', chunks: out.chunks || [] });
      }
      postMessage({ type: 'done' });
    }
  } catch (err) {
    postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};
