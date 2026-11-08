// Хромакей (зелений екран) для накладань: кадр проходить через шейдер WebGL, який робить колір фону прозорим.
// Якщо WebGL недоступний — той самий розрахунок на процесорі по зменшеній копії кадру.
//
// Колір порівнюємо за «хроматичністю» (частка кожного каналу в сумі), а не за яскравістю:
// так тінь і світла пляма на тому самому зеленому зникають однаково, а шкіра, червоне й синє лишаються.

export const KEY_DEFAULT = { on: false, color: '#00b140', tol: 0.18, soft: 0.1, spill: 0.6, clean: 0.1, choke: 0 };
export const keyOf = o => (o && o.key && o.key.on ? { ...KEY_DEFAULT, ...o.key } : null);

export const hexToRgb = h => {
  const n = parseInt(String(h || '#00b140').replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

// Спільна математика: повертає [alpha, k] для кольору (0…1), ключа і параметрів. Використовується і в тестах.
export function keyMath(r, g, b, kc, tol, soft) {
  const sum = r + g + b, ks = kc[0] + kc[1] + kc[2] || 1e-6;
  const d = Math.hypot(r / (sum || 1e-6) - kc[0] / ks, g / (sum || 1e-6) - kc[1] / ks, b / (sum || 1e-6) - kc[2] / ks);
  const conf = Math.min(1, Math.max(0, (sum - 0.09) / 0.27)); // майже чорне — колір ненадійний, лишаємо видимим
  const dd = d + (1 - conf) * 2;
  const x = Math.min(1, Math.max(0, (dd - tol) / Math.max(1e-4, soft)));
  return x * x * (3 - 2 * x);
}
// Очищення маски: дрібні залишки фону (<~clean) стають повністю прозорими, майже щільне — щільним
export const cleanAlpha = (a, clean) => Math.min(1, Math.max(0, (a - clean * 0.4) / Math.max(0.05, 1 - clean * 0.4 - clean * 0.25)));
const dominant = c => { const m = Math.max(c[0], c[1], c[2]); if (m < 0.2) return [0, 0, 0]; const i = c.indexOf(m); const rest = c.filter((_, j) => j !== i); return m - Math.max(...rest) > 0.12 ? [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0] : [0, 0, 0]; };

/* ── WebGL ── */
const VS = 'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
const FS = `precision mediump float;varying vec2 v;uniform sampler2D t;uniform vec3 kc;uniform vec3 kd;uniform vec2 px;uniform float tol,soft,spill,matte,clean,choke;
vec4 smp(vec2 u){return texture2D(t,vec2(u.x,1.-u.y));}
float ka(vec2 u){
  vec4 s=smp(u);vec3 c=s.rgb;float sum=c.r+c.g+c.b,ks=kc.r+kc.g+kc.b;
  float d=distance(c/max(sum,1e-4),kc/max(ks,1e-4));
  float conf=clamp((sum-.09)/.27,0.,1.);
  return smoothstep(tol,tol+max(soft,1e-4),d+(1.-conf)*2.)*s.a;
}
void main(){
  vec4 s=smp(v);vec3 c=s.rgb;
  float a=ka(v);
  if(choke>0.){vec2 o=px*choke;a=min(a,min(min(ka(v+vec2(o.x,0.)),ka(v-vec2(o.x,0.))),min(ka(v+vec2(0.,o.y)),ka(v-vec2(0.,o.y)))));}
  a=clamp((a-clean*.4)/max(.05,1.-clean*.4-clean*.25),0.,1.);
  float dom=dot(c,kd),oth=dot(c,vec3(1.)-kd)*.5;
  c-=kd*max(0.,dom-oth)*spill;
  gl_FragColor=matte>.5?vec4(vec3(a),1.):vec4(c*a,a);
}`;
let gl = null, cv = null, prog = null, loc = null, tex = null, glFail = false;
function initGL() {
  if (gl || glFail) return !!gl;
  try {
    cv = document.createElement('canvas'); cv.width = cv.height = 16;
    gl = cv.getContext('webgl', { premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('webgl');
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
    gl.useProgram(prog);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    loc = Object.fromEntries(['t', 'kc', 'kd', 'px', 'tol', 'soft', 'spill', 'matte', 'clean', 'choke'].map(n => [n, gl.getUniformLocation(prog, n)]));
    tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    cv.addEventListener('webglcontextlost', e => { e.preventDefault(); gl = null; glFail = false; });
    return true;
  } catch (e) { gl = null; glFail = true; return false; }
}
function keyGL(src, w, h, K, matte) {
  if (!initGL()) return null;
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  gl.viewport(0, 0, w, h);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); } catch (e) { return null; }
  const kc = hexToRgb(K.color).map(v => v / 255), kd = dominant(kc);
  gl.uniform1i(loc.t, 0); gl.uniform3f(loc.kc, ...kc); gl.uniform3f(loc.kd, ...kd);
  gl.uniform1f(loc.tol, K.tol); gl.uniform1f(loc.soft, K.soft); gl.uniform1f(loc.spill, K.spill); gl.uniform1f(loc.matte, matte ? 1 : 0); gl.uniform1f(loc.clean, K.clean ?? 0); gl.uniform1f(loc.choke, K.choke ?? 0); gl.uniform2f(loc.px, 1 / w, 1 / h);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return cv;
}

/* ── запасний варіант на процесорі ── */
let cpuCv = null;
function keyCPU(src, w, h, K, matte) {
  const k = Math.min(1, 960 / Math.max(w, h)), cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
  if (!cpuCv) cpuCv = document.createElement('canvas');
  cpuCv.width = cw; cpuCv.height = ch;
  const g = cpuCv.getContext('2d', { willReadFrequently: true });
  g.clearRect(0, 0, cw, ch); g.drawImage(src, 0, 0, cw, ch);
  const im = g.getImageData(0, 0, cw, ch), d = im.data, kc = hexToRgb(K.color).map(v => v / 255), kd = dominant(kc), al = new Float32Array(cw * ch);
  for (let i = 0; i < cw * ch; i++) al[i] = keyMath(d[i * 4] / 255, d[i * 4 + 1] / 255, d[i * 4 + 2] / 255, kc, K.tol, K.soft) * (d[i * 4 + 3] / 255);
  const ch_ = Math.round((K.choke || 0) * k);
  if (ch_ > 0) { const src2 = al.slice(); for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const i = y * cw + x; al[i] = Math.min(src2[i], src2[y * cw + Math.max(0, x - ch_)], src2[y * cw + Math.min(cw - 1, x + ch_)], src2[Math.max(0, y - ch_) * cw + x], src2[Math.min(ch - 1, y + ch_) * cw + x]); } }
  for (let p = 0; p < cw * ch; p++) {
    const i = p * 4; let r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
    const a = cleanAlpha(al[p], K.clean ?? 0);
    const dom = r * kd[0] + gg * kd[1] + b * kd[2], oth = ((r + gg + b) - dom) * 0.5, ex = Math.max(0, dom - oth) * K.spill;
    r -= kd[0] * ex; gg -= kd[1] * ex; b -= kd[2] * ex;
    if (matte) { d[i] = d[i + 1] = d[i + 2] = a * 255; d[i + 3] = 255; }
    else { d[i] = Math.max(0, r * 255); d[i + 1] = Math.max(0, gg * 255); d[i + 2] = Math.max(0, b * 255); d[i + 3] = a * 255; }
  }
  g.putImageData(im, 0, 0);
  return cpuCv;
}

// Вхід: 2D-канвас src з кадром розміром w×h. Вихід: канвас того ж розміру з прозорим фоном (або чорно-білою маскою).
export function keyFrame(src, w, h, K, matte = false, forceCPU = false) {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  return (!forceCPU && keyGL(src, w, h, K, matte)) || keyCPU(src, w, h, K, matte);
}
export const usesGL = () => initGL();

// Середній колір області джерела (sx,sy,sw,sh у пікселях джерела) — для піпетки
let probe = null;
export function sampleHex(src, sx, sy, sw = 9, sh = 9) {
  if (!probe) { probe = document.createElement('canvas'); probe.width = probe.height = 1; }
  const g = probe.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.clearRect(0, 0, 1, 1);
  try { g.drawImage(src, Math.max(0, sx - sw / 2), Math.max(0, sy - sh / 2), sw, sh, 0, 0, 1, 1); } catch (e) { return null; }
  const d = g.getImageData(0, 0, 1, 1).data;
  return d[3] ? rgbToHex(d[0], d[1], d[2]) : null;
}
// Автоматично шукаємо колір фону: зразки біля країв кадру, береться найнасиченіший (фон зазвичай найяскравіший за кольором)
export function autoKeyColor(src, fw, fh) {
  const pts = [[.06, .06], [.5, .05], [.94, .06], [.05, .5], [.95, .5], [.06, .94], [.5, .95], [.94, .94]];
  let best = null, bs = -1;
  for (const [x, y] of pts) {
    const hx = sampleHex(src, x * fw, y * fh, Math.max(6, fw * 0.03), Math.max(6, fh * 0.03)); if (!hx) continue;
    const [r, g, b] = hexToRgb(hx), s = Math.max(r, g, b) - Math.min(r, g, b);
    if (s > bs) { bs = s; best = hx; }
  }
  return bs >= 40 ? best : null;
}
