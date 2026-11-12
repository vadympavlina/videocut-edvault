// Кольорові схеми (LUT): імпорт .cube і застосування до кадру на відеокарті (WebGL).
// У проєкті LUT зберігається стисненим: 8 біт на канал у base64.
const MAX = 33;
const cache = new Map(); // id -> { size, rgba: Uint8Array }

export function parseCube(text) {
  let size = 0, title = '', dmin = [0, 0, 0], dmax = [1, 1, 1];
  const vals = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const p = line.split(/\s+/);
    if (p[0] === 'TITLE') { title = line.replace(/^TITLE\s+/, '').replace(/^"|"$/g, ''); continue; }
    if (p[0] === 'LUT_3D_SIZE') { size = parseInt(p[1], 10); continue; }
    if (p[0] === 'LUT_1D_SIZE') throw new Error('Підтримуються лише тривимірні LUT (LUT_3D_SIZE)');
    if (p[0] === 'DOMAIN_MIN') { dmin = p.slice(1, 4).map(Number); continue; }
    if (p[0] === 'DOMAIN_MAX') { dmax = p.slice(1, 4).map(Number); continue; }
    if (/^[A-Z_]+$/.test(p[0])) continue;
    if (p.length >= 3) { const r = +p[0], g = +p[1], b = +p[2]; if (![r, g, b].every(Number.isFinite)) throw new Error('Пошкоджений рядок у файлі LUT'); vals.push(r, g, b); }
  }
  if (!Number.isInteger(size) || size < 2 || size > 128) throw new Error('У файлі немає коректного LUT_3D_SIZE');
  if (vals.length !== size * size * size * 3) throw new Error(`Очікувалось ${size ** 3} рядків, знайдено ${vals.length / 3}`);
  // зменшуємо до 33, щоб проєкт лишався легким
  const step = size > MAX ? Math.ceil((size - 1) / (MAX - 1)) : 1;
  const out = Math.floor((size - 1) / step) + 1, bytes = new Uint8Array(out * out * out * 3);
  let o = 0;
  for (let b = 0; b < out; b++) for (let g = 0; g < out; g++) for (let r = 0; r < out; r++) {
    const i = (r * step + g * step * size + b * step * size * size) * 3;
    for (let k = 0; k < 3; k++) bytes[o++] = Math.round(Math.min(1, Math.max(0, (vals[i + k] - dmin[k]) / ((dmax[k] - dmin[k]) || 1))) * 255);
  }
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { name: title, size: out, b64: typeof btoa === 'function' ? btoa(bin) : Buffer.from(bytes).toString('base64') };
}

// розпаковка у смугу RGBA: ширина size*size, висота size (x = синій*size + червоний, y = зелений)
export function lutStrip(lut) {
  const hit = cache.get(lut.id); if (hit && hit.b64 === lut.b64) return hit;
  const s = lut.size, bin = typeof atob === 'function' ? atob(lut.b64) : Buffer.from(lut.b64, 'base64').toString('binary');
  const rgba = new Uint8Array(s * s * s * 4);
  for (let b = 0; b < s; b++) for (let g = 0; g < s; g++) for (let r = 0; r < s; r++) {
    const src = (r + g * s + b * s * s) * 3, dst = (g * s * s + b * s + r) * 4;
    rgba[dst] = bin.charCodeAt(src); rgba[dst + 1] = bin.charCodeAt(src + 1); rgba[dst + 2] = bin.charCodeAt(src + 2); rgba[dst + 3] = 255;
  }
  const e = { size: s, rgba, b64: lut.b64 }; cache.set(lut.id, e); if (cache.size > 8) cache.delete(cache.keys().next().value);
  return e;
}

/* ── WebGL ── */
let G = null, broken = false;
function init() {
  if (G || broken) return G;
  try {
    const cv = document.createElement('canvas');
    const gl = cv.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: false, antialias: false });
    if (!gl) throw new Error('WebGL недоступний');
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}'));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, `precision highp float;varying vec2 v;uniform sampler2D t,l;uniform float s,m;
vec3 lut(vec3 c){float b=clamp(c.b,0.,1.)*(s-1.);float b0=floor(b),b1=min(b0+1.,s-1.),f=b-b0;
 float x=clamp(c.r,0.,1.)*(s-1.)+.5,y=(clamp(c.g,0.,1.)*(s-1.)+.5)/s;
 return mix(texture2D(l,vec2((b0*s+x)/(s*s),y)).rgb,texture2D(l,vec2((b1*s+x)/(s*s),y)).rgb,f);}
void main(){vec4 c=texture2D(t,vec2(v.x,1.-v.y));gl_FragColor=vec4(mix(c.rgb,lut(c.rgb),m),1.);}`));
    gl.linkProgram(pr); if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    gl.useProgram(pr);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const mk = (unit, filter) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); return t; };
    const frame = mk(0, gl.LINEAR), strip = mk(1, gl.LINEAR);
    gl.uniform1i(gl.getUniformLocation(pr, 't'), 0); gl.uniform1i(gl.getUniformLocation(pr, 'l'), 1);
    G = { cv, gl, frame, strip, us: gl.getUniformLocation(pr, 's'), um: gl.getUniformLocation(pr, 'm'), lastLut: null };
  } catch (e) { console.warn('LUT: WebGL недоступний, кольорова схема не застосовується', e); broken = true; G = null; }
  return G;
}

// застосовує LUT до всього вмісту ctx.canvas
export function applyLut(ctx, W, H, lut, mix = 1) {
  if (!lut || mix <= 0.001) return false;
  const g = init(); if (!g) return false;
  const { gl, cv } = g;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  gl.viewport(0, 0, W, H);
  const e = lutStrip(lut);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, g.strip);
  if (g.lastLut !== e) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, e.size * e.size, e.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, e.rgba); g.lastLut = e; }
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, g.frame);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ctx.canvas);
  gl.uniform1f(g.us, e.size); gl.uniform1f(g.um, Math.min(1, mix));
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  ctx.save(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'copy'; ctx.drawImage(cv, 0, 0, W, H); ctx.restore();
  return true;
}
