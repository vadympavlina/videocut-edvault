// Ключові кадри: рух, положення й масштаб у часі.
// item.kf = [{ t, ...значення }] — t у секундах від початку елемента на таймлайні, значення — усі властивості руху одразу.
import { S, layout } from './state.js';

const clamp01 = v => Math.max(0, Math.min(1, v));
const ease = v => v * v * (3 - 2 * v); // плавний вхід і вихід між кадрами

export const KF_PROPS = { clip: ['zoom', 'zx', 'zy'], overlay: ['x', 'y', 'w', 'h'] };
export const kfProps = (kind, o) => KF_PROPS[kind === 'clip' ? 'clip' : 'overlay'].filter(p => p !== 'h' || o.type !== 'text');
export const hasKf = o => !!(o && o.kf && o.kf.length);

// значення властивостей руху в момент local (секунди від початку елемента)
export function kfAt(kf, local, props) {
  const out = {};
  if (!kf || !kf.length) return out;
  let a = kf[0], b = kf[kf.length - 1];
  if (local <= a.t) b = a;
  else if (local >= b.t) a = b;
  else for (let i = 0; i < kf.length - 1; i++) if (local >= kf[i].t && local <= kf[i + 1].t) { a = kf[i]; b = kf[i + 1]; break; }
  const k = a === b ? 0 : ease(clamp01((local - a.t) / (b.t - a.t)));
  for (const p of props) if (typeof a[p] === 'number' && typeof b[p] === 'number') out[p] = a[p] + (b[p] - a[p]) * k;
  return out;
}

// копія елемента зі значеннями руху на цей момент; без ключових кадрів повертає сам елемент
export function resolveKf(kind, o, local) {
  if (!hasKf(o)) return o;
  return Object.assign(Object.create(Object.getPrototypeOf(o)), o, kfAt(o.kf, local, kfProps(kind, o)));
}

// скільки секунд пройшло від початку елемента до курсора (для кліпа — від початку на таймлайні)
export function localTime(kind, o) {
  if (kind === 'clip') { const l = layout().find(x => x.clip.id === o.id); return l ? S.t - l.start : 0; }
  return S.t - o.start;
}
export function itemLength(kind, o) {
  if (kind === 'clip') { const l = layout().find(x => x.clip.id === o.id); return l ? l.end - l.start : 0; }
  return o.dur;
}

// записує ключовий кадр у цей момент зі значеннями, які зараз у елемента
export function setKeyHere(kind, o) {
  const len = itemLength(kind, o), t = Math.max(0, Math.min(len, localTime(kind, o)));
  const key = { t: Math.round(t * 100) / 100 };
  for (const p of kfProps(kind, o)) key[p] = o[p] ?? (p === 'zoom' ? 1 : p === 'zx' || p === 'zy' ? 0.5 : 0);
  o.kf = (o.kf || []).filter(k => Math.abs(k.t - key.t) > 0.04);
  o.kf.push(key); o.kf.sort((a, b) => a.t - b.t);
  return key;
}
export function removeKeyHere(kind, o) {
  if (!hasKf(o)) return false;
  const t = localTime(kind, o), n = o.kf.length;
  o.kf = o.kf.filter(k => Math.abs(k.t - t) > 0.06);
  if (!o.kf.length) delete o.kf;
  return !o.kf || o.kf.length !== n;
}
export const keyHere = (kind, o) => hasKf(o) && o.kf.find(k => Math.abs(k.t - localTime(kind, o)) <= 0.06);

// після будь-якої правки значень: якщо елемент має рух, правка стає ключовим кадром
export function autoKey(kind, o) { if (hasKf(o)) setKeyHere(kind, o); }
// щоб рамка, повзунки й перетягування показували значення на курсорі, а не старі
export function syncBase(kind, o) { if (hasKf(o)) Object.assign(o, kfAt(o.kf, localTime(kind, o), kfProps(kind, o))); }

export function repairKf(o) {
  if (!Array.isArray(o.kf)) { delete o.kf; return; }
  o.kf = o.kf.filter(k => k && Number.isFinite(k.t)).map(k => ({ ...k, t: Math.max(0, k.t) })).sort((a, b) => a.t - b.t);
  if (!o.kf.length) delete o.kf;
}

// розріз: ключові кадри ділимо між половинами, на межі додаємо кадр зі значенням у точці розрізу
export function splitKf(kind, a, b, cut) {
  if (!hasKf(a)) return;
  const props = kfProps(kind, a), mid = { ...kfAt(a.kf, cut, props) };
  const all = a.kf;
  a.kf = [...all.filter(k => k.t < cut - 0.02), { t: cut, ...mid }];
  b.kf = [{ ...mid, t: 0 }, ...all.filter(k => k.t > cut + 0.02).map(k => ({ ...k, t: k.t - cut }))];
}
