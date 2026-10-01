/**
 * Vista previa 3D de la página Anúnciate: un pequeño visor WebGL (sin Cesium, para que la página
 * siga siendo ligera) que muestra el globo, el ovni o la avioneta con el color elegido y la misma
 * animación que en el juego. La etiqueta HTML se coloca encima del modelo en cada fotograma.
 */
import { balloonParts, box, hexToRgb, merge, Mesh, Part, planeParts, RGB } from './models';

type AdType = 'lugar' | 'globo' | 'ovni' | 'avioneta';
type Mat = Float32Array;

interface Gpu { pos: WebGLBuffer; nor: WebGLBuffer; idx: WebGLBuffer; count: number; type: number; color: RGB; alpha: number; emissive: RGB }

const SKY: RGB = [0.42, 0.62, 0.82];
const GROUND: RGB = [0.16, 0.24, 0.13];
const GROUND_Y = -70;
const BUILDINGS: RGB = [0.62, 0.55, 0.46];

/** Manzanas de edificios bajos alrededor del punto, para dar escala (siempre las mismas). */
function city(): Mesh {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const blocks: Mesh[] = [];
  for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) {
    const cx = x * 34, cz = z * 34, d = Math.hypot(cx, cz);
    if (d < 30 || d > 420 || rnd() < 0.25) continue;
    const h = 5 + rnd() * (d < 120 ? 9 : 18);
    blocks.push(box([cx, h / 2, cz], [18 + rnd() * 8, h, 18 + rnd() * 8]));
  }
  blocks.push(box([0, 5, -8], [16, 10, 12])); // el local del anunciante
  return merge(blocks);
}

// ---------- Matrices (column-major) ----------
const mat = (): Mat => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; };
function mul(a: Mat, b: Mat): Mat {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
function perspective(fovy: number, aspect: number, near: number, far: number): Mat {
  const f = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f; m[10] = (far + near) / (near - far); m[11] = -1; m[14] = (2 * far * near) / (near - far);
  return m;
}
function lookAt(eye: number[], target: number[], up = [0, 1, 0]): Mat {
  const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
  const norm = (a: number[]) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = norm(sub(eye, target)), x = norm(cross(up, z)), y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}
function translate(x: number, y: number, z: number): Mat { const m = mat(); m[12] = x; m[13] = y; m[14] = z; return m; }
function scale(s: number): Mat { const m = mat(); m[0] = m[5] = m[10] = s; return m; }
function rotY(a: number): Mat { const m = mat(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; }
function rotZ(a: number): Mat { const m = mat(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; }

// ---------- Lectura del ovni (models/ufo.glb, una sola malla sin transformaciones) ----------
interface RawPart { positions: Float32Array; normals: Float32Array; indices: Uint16Array | Uint32Array; color: RGB; alpha: number; emissive: RGB }
async function loadGlb(url: string): Promise<RawPart[]> {
  const buf = await (await fetch(url)).arrayBuffer();
  const dv = new DataView(buf);
  const jsonLen = dv.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const binStart = 20 + jsonLen + 8;
  const read = (i: number) => {
    const acc = gltf.accessors[i], view = gltf.bufferViews[acc.bufferView];
    const off = binStart + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const n = acc.count * (acc.type === 'VEC3' ? 3 : 1);
    if (acc.componentType === 5126) return new Float32Array(buf.slice(off, off + n * 4));
    if (acc.componentType === 5125) return new Uint32Array(buf.slice(off, off + n * 4));
    return new Uint16Array(buf.slice(off, off + n * 2));
  };
  return gltf.meshes[0].primitives.map((p: any) => {
    const m = gltf.materials[p.material] ?? {};
    const base = m.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1];
    return {
      positions: read(p.attributes.POSITION) as Float32Array, normals: read(p.attributes.NORMAL) as Float32Array,
      indices: read(p.indices) as Uint16Array, color: base.slice(0, 3) as RGB, alpha: base[3], emissive: (m.emissiveFactor ?? [0, 0, 0]) as RGB,
    };
  });
}

const VS = `
attribute vec3 aPos; attribute vec3 aNor;
uniform mat4 uModel; uniform mat4 uViewProj; uniform mat4 uView;
varying vec3 vNor; varying float vDist;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vNor = (uModel * vec4(aNor, 0.0)).xyz;
  vDist = -(uView * w).z;
  gl_Position = uViewProj * w;
}`;
const FS = `
precision mediump float;
uniform vec3 uColor; uniform vec3 uEmissive; uniform float uAlpha; uniform vec3 uSky; uniform float uFog;
varying vec3 vNor; varying float vDist;
void main() {
  vec3 n = normalize(vNor);
  if (!gl_FrontFacing) n = -n;
  float sun = max(dot(n, normalize(vec3(0.45, 0.8, 0.35))), 0.0);
  vec3 c = uColor * (0.42 + 0.75 * sun) + uEmissive;
  c = mix(c, uSky, clamp(vDist / uFog, 0.0, 1.0) * 0.85);
  gl_FragColor = vec4(pow(c, vec3(1.0 / 2.2)), uAlpha);
}`;

export class AdPreview3D {
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private aPos: number;
  private aNor: number;
  private parts: Gpu[] = [];
  private ground: Gpu;
  private city: Gpu;
  private ufo?: RawPart[];
  private type: AdType = 'lugar';
  private color = '#e2602f';
  private raf = 0;
  private visible = true;
  private start = performance.now();
  private still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Devuelve null si el navegador no tiene WebGL (se queda la etiqueta sobre el cielo). */
  static create(canvas: HTMLCanvasElement, label: HTMLElement): AdPreview3D | null {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false });
    return gl ? new AdPreview3D(canvas, label, gl) : null;
  }

  private constructor(private canvas: HTMLCanvasElement, private label: HTMLElement, gl: WebGLRenderingContext) {
    this.gl = gl;
    gl.getExtension('OES_element_index_uint');
    const shader = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    this.prog = gl.createProgram()!;
    gl.attachShader(this.prog, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(this.prog, shader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(this.prog);
    gl.useProgram(this.prog);
    for (const u of ['uModel', 'uViewProj', 'uView', 'uColor', 'uEmissive', 'uAlpha', 'uSky', 'uFog']) this.loc[u] = gl.getUniformLocation(this.prog, u);
    this.aPos = gl.getAttribLocation(this.prog, 'aPos');
    this.aNor = gl.getAttribLocation(this.prog, 'aNor');
    gl.enableVertexAttribArray(this.aPos);
    gl.enableVertexAttribArray(this.aNor);
    gl.enable(gl.DEPTH_TEST);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const R = 4000;
    this.ground = this.upload({ positions: new Float32Array([-R, 0, -R, R, 0, -R, R, 0, R, -R, 0, R]), normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), indices: new Uint16Array([0, 2, 1, 0, 3, 2]), color: GROUND, alpha: 1, emissive: [0, 0, 0] });
    const c = city();
    this.city = this.upload({ positions: new Float32Array(c.positions), normals: new Float32Array(c.normals), indices: new Uint16Array(c.indices), color: BUILDINGS, alpha: 1, emissive: [0, 0, 0] });
    new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; if (this.visible) this.loop(); }).observe(canvas);
  }

  set(type: AdType, color: string) {
    const changed = type !== this.type || color !== this.color;
    this.type = type;
    this.color = color;
    if (changed || !this.parts.length) this.build();
  }

  private upload(p: RawPart): Gpu {
    const gl = this.gl;
    const buffer = (target: number, data: ArrayBufferView) => { const b = gl.createBuffer()!; gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW); return b; };
    return {
      pos: buffer(gl.ARRAY_BUFFER, p.positions), nor: buffer(gl.ARRAY_BUFFER, p.normals), idx: buffer(gl.ELEMENT_ARRAY_BUFFER, p.indices),
      count: p.indices.length, type: p.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
      color: p.color, alpha: p.alpha, emissive: p.emissive,
    };
  }

  private async build() {
    const gl = this.gl;
    for (const p of this.parts) [p.pos, p.nor, p.idx].forEach((b) => gl.deleteBuffer(b));
    this.parts = [];
    const fromParts = (list: Part[]) => list.map((p) => this.upload({
      positions: new Float32Array(p.mesh.positions), normals: new Float32Array(p.mesh.normals), indices: new Uint16Array(p.mesh.indices),
      color: p.color, alpha: 1, emissive: p.emissive ?? [0, 0, 0],
    }));
    if (this.type === 'globo') this.parts = fromParts(balloonParts(this.color));
    else if (this.type === 'avioneta') this.parts = fromParts(planeParts(this.color));
    else if (this.type === 'ovni') {
      const type = this.type;
      try { this.ufo ??= await loadGlb('models/ufo.glb'); } catch { return; }
      if (this.type !== type) return;
      // Igual que en el juego: el color del anunciante se mezcla al 55 % con el del casco.
      const tint = hexToRgb(this.color);
      this.parts = this.ufo.map((p, i) => this.upload({ ...p, color: i === 0 ? p.color.map((c, k) => c * 0.45 + tint[k] * 0.55) as RGB : p.color }));
    }
    this.loop();
  }

  private loop = () => {
    cancelAnimationFrame(this.raf);
    this.draw();
    if (!this.still && this.visible) this.raf = requestAnimationFrame(this.loop);
  };

  private draw() {
    const { gl, canvas } = this;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const t = this.still ? 2 : (performance.now() - this.start) / 1000;
    // Cámara y movimiento de cada tipo (escalas del juego: globo ×1,5, ovni ×6, avioneta ×2).
    let model = mat(), eye = [0, 25, 95], target = [0, 10, 0], top = [0, 0, 0];
    if (this.type === 'globo') {
      const bob = Math.sin(t * 0.8) * 1.5;
      model = mul(translate(0, bob - 8, 0), mul(rotY(t * 0.15), scale(1.5)));
      top = [0, bob - 8 + 33, 0];
    } else if (this.type === 'ovni') {
      model = mul(translate(0, Math.sin(t * 1.2) * 1.2, 0), mul(rotY(t * 1.2), scale(6)));
      eye = [0, 22, 80]; target = [0, 0, 0]; top = [0, 10, 0];
    } else if (this.type === 'avioneta') {
      // Vuelta completa cada 14 s alrededor del centro, inclinada hacia dentro del giro.
      const R = 38, a = t * ((Math.PI * 2) / 14), x = R * Math.cos(a), z = R * Math.sin(a);
      model = mul(translate(x, 0, z), mul(rotY(-a), mul(rotZ(0.3), scale(2.5))));
      eye = [0, 38, 105]; target = [0, -8, 0]; top = [x, 7, z];
    } else {
      eye = [0, GROUND_Y + 55, 120]; target = [0, GROUND_Y + 22, 0];
    }
    const view = lookAt(eye, target);
    const viewProj = mul(perspective((40 * Math.PI) / 180, w / h, 1, 5000), view);
    gl.uniformMatrix4fv(this.loc.uView, false, view);
    gl.uniformMatrix4fv(this.loc.uViewProj, false, viewProj);
    gl.uniform3fv(this.loc.uSky, SKY);
    gl.uniform1f(this.loc.uFog, 1600);

    this.drawPart(this.ground, translate(0, GROUND_Y, 0));
    this.drawPart(this.city, translate(0, GROUND_Y, 0));
    const solid = this.parts.filter((p) => p.alpha >= 1), clear = this.parts.filter((p) => p.alpha < 1);
    solid.forEach((p) => this.drawPart(p, model));
    if (clear.length) {
      gl.enable(gl.BLEND); gl.depthMask(false);
      clear.forEach((p) => this.drawPart(p, model));
      gl.disable(gl.BLEND); gl.depthMask(true);
    }

    // Etiqueta: sobre el modelo, o en el suelo para un lugar.
    const anchor = this.type === 'lugar' ? [0, GROUND_Y + 12, 0] : top;
    const v = [0, 1, 2, 3].map((r) => viewProj[r] * anchor[0] + viewProj[4 + r] * anchor[1] + viewProj[8 + r] * anchor[2] + viewProj[12 + r]);
    this.label.style.setProperty('--x', `${((v[0] / v[3] + 1) / 2) * canvas.clientWidth}px`);
    this.label.style.setProperty('--y', `${((1 - v[1] / v[3]) / 2) * canvas.clientHeight}px`);
  }

  private drawPart(p: Gpu, model: Mat) {
    const gl = this.gl;
    gl.uniformMatrix4fv(this.loc.uModel, false, model);
    gl.uniform3fv(this.loc.uColor, p.color);
    gl.uniform3fv(this.loc.uEmissive, p.emissive);
    gl.uniform1f(this.loc.uAlpha, p.alpha);
    gl.bindBuffer(gl.ARRAY_BUFFER, p.pos);
    gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, p.nor);
    gl.vertexAttribPointer(this.aNor, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, p.idx);
    gl.drawElements(gl.TRIANGLES, p.count, p.type, 0);
  }
}
