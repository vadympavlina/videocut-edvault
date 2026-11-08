// IndexedDB: автозбереження проєкту й медіафайлів, а також «передача» файлу з інших інструментів.

function open(name, stores) {
  return new Promise((res, rej) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => stores.forEach(s => { if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(db, store, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

let dbp = null;
const db = () => (dbp = dbp || open('edvault-videocut', ['kv', 'blobs']));

export const DB = {
  async get(key) { return tx(await db(), 'kv', 'readonly', s => s.get(key)); },
  async set(key, val) { return tx(await db(), 'kv', 'readwrite', s => s.put(val, key)); },
  async getBlob(id) { return tx(await db(), 'blobs', 'readonly', s => s.get(id)); },
  async putBlob(id, blob) { return tx(await db(), 'blobs', 'readwrite', s => s.put(blob, id)); },
  async delBlob(id) { return tx(await db(), 'blobs', 'readwrite', s => s.delete(id)); },
  async blobKeys() { return tx(await db(), 'blobs', 'readonly', s => s.getAllKeys()); },
};

// Передача файлу між інструментами Edvault (наприклад, із «Запису екрану»)
export async function takeHandoff(key) {
  try {
    const h = await open('edvault-handoff', ['files']);
    const item = await tx(h, 'files', 'readonly', s => s.get(key));
    if (item) await tx(h, 'files', 'readwrite', s => s.delete(key));
    return item || null;
  } catch (e) { return null; }
}
