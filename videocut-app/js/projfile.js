// Проєкт як один файл (.evproj): його можна зберегти, перенести на інший комп'ютер і відкрити знову.
// Формат: "EVPROJ1\n" · 4 байти (довжина JSON) · JSON {project, media:[{id,name,type,size}]} · байти файлів підряд.
import { S, media } from './state.js';

const MAGIC = 'EVPROJ1\n';
export const PROJ_EXT = '.evproj';

export function packProject() {
  const items = [...media.values()].filter(m => m.blob);
  const head = JSON.stringify({ v: 1, project: S.project, media: items.map(m => ({ id: m.id, name: m.name, type: m.blob.type || '', size: m.blob.size })) });
  const hb = new TextEncoder().encode(head);
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, hb.length);
  // Blob посилається на частини, а не копіює їх — великі відео не потрапляють в оперативну пам'ять вдруге
  return new Blob([MAGIC, len, hb, ...items.map(m => m.blob)], { type: 'application/octet-stream' });
}

export async function unpackProject(file) {
  const m = MAGIC.length;
  const first = new Uint8Array(await file.slice(0, m + 4).arrayBuffer());
  if (new TextDecoder().decode(first.slice(0, m)) !== MAGIC) throw new Error('Це не файл проєкту Edvault');
  const hl = new DataView(first.buffer).getUint32(m);
  if (!hl || hl > 64 * 1048576) throw new Error('Файл проєкту пошкоджено');
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(await file.slice(m + 4, m + 4 + hl).arrayBuffer())));
  if (!meta || !meta.project || !Array.isArray(meta.project.clips)) throw new Error('Файл проєкту пошкоджено');
  let off = m + 4 + hl;
  const items = [];
  for (const it of meta.media || []) {
    if (off + it.size > file.size) throw new Error('Файл проєкту обірваний — не вистачає даних');
    items.push({ id: it.id, name: it.name, blob: new File([file.slice(off, off + it.size)], it.name, { type: it.type }) });
    off += it.size;
  }
  return { project: meta.project, items };
}
