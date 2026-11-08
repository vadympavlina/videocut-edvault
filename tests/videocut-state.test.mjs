// Запуск: node --test tests/
// Перевіряє чисту логіку моделі відеоредактора: розкладку, вирізання, зсув, історію, прилипання.
import test from 'node:test';
import assert from 'node:assert/strict';

// state.js не чіпає DOM під час імпорту; document потрібен лише деяким модулям, яких ми тут не вантажимо
const st = await import('../videocut-app/js/state.js');
const { S, newProject, layout, mainEnd, duration, rippleShift, commit, undo, redo, resetHistory, snap, snapOn, clipAt, srcTime, editPoints } = st;

const clip = (id, inn, out, speed = 1) => ({ id, mediaId: 'm', in: inn, out, speed });
function fresh(clips = [], extra = {}) {
  S.project = { ...newProject(), clips, ...extra };
  S.sel = null; S.t = 0; S.snap = true; S.altNoSnap = false; S.markIn = S.markOut = null;
  resetHistory();
}

test('розкладка кліпів іде підряд, швидкість змінює тривалість', () => {
  fresh([clip('a', 0, 4), clip('b', 2, 6, 2)]);
  const L = layout();
  assert.equal(L[0].end, 4);
  assert.equal(L[1].start, 4);
  assert.equal(L[1].end, 6); // 4 с джерела при 2× = 2 с
  assert.equal(mainEnd(), 6);
});

test('clipAt і srcTime враховують швидкість', () => {
  fresh([clip('a', 10, 20, 2)]);
  const l = clipAt(2);
  assert.equal(l.clip.id, 'a');
  assert.equal(srcTime(l, 2), 14);
  assert.equal(clipAt(5), null);
});

test('тривалість включає накладки, субтитри й музику', () => {
  fresh([clip('a', 0, 3)], { overlays: [{ id: 'o', start: 2, dur: 5 }], captions: [{ id: 's', start: 6, dur: 3 }], music: [{ id: 'u', start: 8, in: 0, out: 4 }] });
  assert.equal(duration(), 12);
});

test('rippleShift: вирізаний шматок зсуває наступні елементи вліво', () => {
  fresh([], { overlays: [{ id: 'o', start: 10, dur: 2 }], captions: [{ id: 's', start: 3, dur: 1 }] });
  rippleShift(5, -3);
  assert.equal(S.project.overlays[0].start, 7);
  assert.equal(S.project.captions[0].start, 3); // до вирізання — не чіпаємо
});

test('rippleShift: елемент, що перетинає вирізане, скорочується', () => {
  fresh([], { overlays: [{ id: 'o', start: 4, dur: 6 }] });
  rippleShift(5, -3); // вирізано [5, 8)
  const o = S.project.overlays[0];
  assert.equal(o.start, 4);
  assert.ok(Math.abs(o.dur - 3) < 1e-9);
});

test('rippleShift: елемент повністю у вирізаному зникає', () => {
  fresh([], { captions: [{ id: 's', start: 5.5, dur: 1 }] });
  rippleShift(5, -3);
  assert.equal(S.project.captions.length, 0);
});

test('rippleShift: вставка зсуває вправо', () => {
  fresh([], { captions: [{ id: 's', start: 5, dur: 1 }, { id: 't', start: 1, dur: 1 }] });
  rippleShift(3, 2);
  assert.equal(S.project.captions.find(c => c.id === 's').start, 7);
  assert.equal(S.project.captions.find(c => c.id === 't').start, 1);
});

test('історія: undo/redo повертають проєкт', () => {
  fresh([clip('a', 0, 4)]);
  S.project.clips.push(clip('b', 0, 2));
  assert.ok(commit());
  assert.equal(S.project.clips.length, 2);
  undo();
  assert.equal(S.project.clips.length, 1);
  redo();
  assert.equal(S.project.clips.length, 2);
});

test('історія: commit без змін нічого не записує', () => {
  fresh([clip('a', 0, 4)]);
  assert.equal(commit(), false);
});

test('прилипання: тягнеться до межі кліпу, Alt вимикає', () => {
  fresh([clip('a', 0, 4)]);
  S.pps = 100;
  assert.equal(snap(3.97), 4);
  S.altNoSnap = true;
  assert.equal(snapOn(), false);
  assert.equal(snap(3.97), 3.97);
});

test('точки монтажу: краї кліпів, накладок і субтитрів без повторів', () => {
  fresh([clip('a', 0, 4), clip('b', 0, 2)], { overlays: [{ id: 'o', start: 1, dur: 2 }], captions: [{ id: 's', start: 4, dur: 1 }] });
  assert.deepEqual(editPoints(), [0, 1, 3, 4, 5, 6]);
});
