/**
 * Modelos 3D sencillos generados en el navegador con el color de cada anunciante
 * (globo aerostático y avioneta con pancarta). Devuelven una URL blob: con el GLB.
 * Convención glTF: +Y arriba, +Z adelante.
 */
type Vec3 = [number, number, number];
export type RGB = [number, number, number];
export interface Mesh { positions: number[]; normals: number[]; indices: number[]; uvs?: number[] }
export interface Part { mesh: Mesh; color: RGB; metallic?: number; roughness?: number; emissive?: RGB; texture?: HTMLCanvasElement }

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xe2602f;
  // glTF trabaja en espacio lineal.
  return [n >> 16, (n >> 8) & 255, n & 255].map((c) => Math.pow(c / 255, 2.2)) as RGB;
}

/** Superficie de revolución alrededor de Y con normales suaves. `from`/`to`: fracción de vuelta (para gajos). */
function lathe(profile: [number, number][], segments: number, from = 0, to = 1): Mesh {
  const seg: [number, number][] = [];
  for (let j = 0; j < profile.length - 1; j++) {
    const [r0, y0] = profile[j], [r1, y1] = profile[j + 1];
    const dr = r1 - r0, dy = y1 - y0, l = Math.hypot(dr, dy) || 1;
    seg.push([-dy / l, dr / l]);
  }
  const pn = profile.map((_, j) => {
    const a = seg[Math.max(0, j - 1)], b = seg[Math.min(seg.length - 1, j)];
    const n = [a[0] + b[0], a[1] + b[1]], l = Math.hypot(n[0], n[1]) || 1;
    return [n[0] / l, n[1] / l];
  });
  const mesh: Mesh = { positions: [], normals: [], indices: [] };
  for (let i = 0; i <= segments; i++) {
    const a = (from + ((to - from) * i) / segments) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    profile.forEach(([r, y], j) => {
      mesh.positions.push(r * c, y, r * s);
      mesh.normals.push(pn[j][0] * c, pn[j][1], pn[j][0] * s);
    });
  }
  const P = profile.length;
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < P - 1; j++) {
      const a = i * P + j, b = (i + 1) * P + j;
      mesh.indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return mesh;
}

/** Caja alineada con los ejes (centro y medidas). */
export function box([cx, cy, cz]: Vec3, [sx, sy, sz]: Vec3): Mesh {
  const mesh: Mesh = { positions: [], normals: [], indices: [] };
  const faces: [Vec3, Vec3, Vec3][] = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [0, 0, -1], [1, 0, 0]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  for (const [n, u, v] of faces) {
    const base = mesh.positions.length / 3;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      mesh.positions.push(
        cx + (n[0] + u[0] * a + v[0] * b) * sx / 2,
        cy + (n[1] + u[1] * a + v[1] * b) * sy / 2,
        cz + (n[2] + u[2] * a + v[2] * b) * sz / 2,
      );
      mesh.normals.push(...n);
    }
    mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return mesh;
}

/** Gira una malla de "eje Y" a "eje Z" (para el fuselaje de la avioneta). */
function yToZ(m: Mesh): Mesh {
  const swap = (arr: number[]) => arr.map((_, i) => (i % 3 === 1 ? arr[i + 1] : i % 3 === 2 ? arr[i - 1] : arr[i]));
  return { positions: swap(m.positions), normals: swap(m.normals), indices: m.indices.slice() };
}

export function merge(meshes: Mesh[]): Mesh {
  const out: Mesh = { positions: [], normals: [], indices: [] };
  for (const m of meshes) {
    const base = out.positions.length / 3;
    out.positions.push(...m.positions);
    out.normals.push(...m.normals);
    out.indices.push(...m.indices.map((k) => k + base));
  }
  return out;
}

function toGlbUrl(parts: Part[]): string {
  const gltf: any = {
    asset: { version: '2.0', generator: 'FlyFly' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [] }], materials: [], buffers: [], bufferViews: [], accessors: [],
    images: [], textures: [], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
  };
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const addView = (data: Float32Array | Uint16Array, target: number) => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const pad = (4 - (bytes.length % 4)) % 4;
    chunks.push(bytes, new Uint8Array(pad));
    gltf.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    offset += bytes.length + pad;
    return gltf.bufferViews.length - 1;
  };
  for (const { mesh, color, metallic = 0, roughness = 0.6, emissive, texture } of parts) {
    const pos = new Float32Array(mesh.positions);
    const min = [0, 1, 2].map((i) => Math.min(...mesh.positions.filter((_, j) => j % 3 === i)));
    const max = [0, 1, 2].map((i) => Math.max(...mesh.positions.filter((_, j) => j % 3 === i)));
    gltf.accessors.push({ bufferView: addView(pos, 34962), componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max });
    gltf.accessors.push({ bufferView: addView(new Float32Array(mesh.normals), 34962), componentType: 5126, count: pos.length / 3, type: 'VEC3' });
    gltf.accessors.push({ bufferView: addView(new Uint16Array(mesh.indices), 34963), componentType: 5123, count: mesh.indices.length, type: 'SCALAR' });
    const n = gltf.accessors.length;
    const attributes: Record<string, number> = { POSITION: n - 3, NORMAL: n - 2 };
    const pbr: any = { baseColorFactor: [...color, 1], metallicFactor: metallic, roughnessFactor: roughness };
    if (texture && mesh.uvs) {
      gltf.accessors.push({ bufferView: addView(new Float32Array(mesh.uvs), 34962), componentType: 5126, count: pos.length / 3, type: 'VEC2' });
      attributes.TEXCOORD_0 = gltf.accessors.length - 1;
      gltf.images.push({ uri: texture.toDataURL('image/png') });
      gltf.textures.push({ source: gltf.images.length - 1, sampler: 0 });
      pbr.baseColorTexture = { index: gltf.textures.length - 1 };
      pbr.baseColorFactor = [1, 1, 1, 1];
    }
    gltf.materials.push({ doubleSided: true, pbrMetallicRoughness: pbr, ...(emissive ? { emissiveFactor: emissive } : {}) });
    gltf.meshes[0].primitives.push({ attributes, indices: n - 1, material: gltf.materials.length - 1 });
  }
  if (!gltf.images.length) { delete gltf.images; delete gltf.textures; delete gltf.samplers; }
  gltf.buffers.push({ byteLength: offset });
  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = (4 - (json.length % 4)) % 4;
  const total = 12 + 8 + json.length + jsonPad + 8 + offset;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, json.length + jsonPad, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(json, 20);
  out.fill(0x20, 20 + json.length, 20 + json.length + jsonPad);
  let p = 20 + json.length + jsonPad;
  dv.setUint32(p, offset, true); dv.setUint32(p + 4, 0x004e4942, true);
  p += 8;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return URL.createObjectURL(new Blob([out], { type: 'model/gltf-binary' }));
}

const WHITE: RGB = [0.92, 0.92, 0.9];
const DARK: RGB = [0.05, 0.05, 0.06];

/** Colores por defecto del segundo gajo del globo, de la cesta y de la pancarta. */
export const DEFAULT_COLOR2 = '#ffffff';
export const DEFAULT_BASKET = '#6b4226';
export const DEFAULT_BANNER = '#ffffff';

/** Globo aerostático (~22 m de alto) con gajos alternos de dos colores y la cesta de un tercero. */
export function balloonUrl(hex: string, hex2 = DEFAULT_COLOR2, basket = DEFAULT_BASKET): string {
  return toGlbUrl(balloonParts(hex, hex2, basket));
}

/** Avioneta (~9 m) del color elegido remolcando una pancarta de otro color con `text`. */
export function planeUrl(hex: string, text = '', bannerHex = DEFAULT_BANNER): string {
  return toGlbUrl(planeParts(hex, text, bannerHex));
}

/** Tipografía de la pancarta: cárgala (document.fonts.load) antes de generar la avioneta. */
export const BANNER_FONT = "800 150px 'Outfit Variable', system-ui, sans-serif";

/** Lona de la pancarta: fondo del color del anunciante y el texto en blanco o negro según el contraste. */
export function bannerCanvas(hex: string, text: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 1100; c.height = 320;
  const g = c.getContext('2d')!;
  const color = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#e2602f';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 12;
  g.strokeRect(14, 14, c.width - 28, c.height - 28);
  const [r, gr, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  g.fillStyle = 0.299 * r + 0.587 * gr + 0.114 * b > 170 ? '#14181f' : '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = BANNER_FONT;
  const label = text.trim().toUpperCase().slice(0, 28);
  const scale = Math.min(1, (c.width - 90) / Math.max(1, g.measureText(label).width));
  g.font = BANNER_FONT.replace('150px', `${Math.floor(150 * scale)}px`);
  g.fillText(label, c.width / 2, c.height / 2 + 6);
  return c;
}

/** Las dos caras de la pancarta, cada una con el texto legible desde su lado. */
function bannerMesh(): Mesh {
  const [z0, z1, y0, y1, x] = [-13.5, -30.5, -3, 2, 0.05];
  const quad = (xs: number, zl: number, zr: number) => ({
    positions: [xs, y0, zl, xs, y0, zr, xs, y1, zr, xs, y1, zl],
    normals: Array(4).fill([Math.sign(xs), 0, 0]).flat(),
    uvs: [0, 1, 1, 1, 1, 0, 0, 0],
    indices: [0, 1, 2, 0, 2, 3],
  });
  const a = quad(x, z0, z1), b = quad(-x, z1, z0);
  return { ...merge([a, b]), uvs: [...a.uvs, ...b.uvs] };
}

export function balloonParts(hex: string, hex2 = DEFAULT_COLOR2, basket = DEFAULT_BASKET): Part[] {
  const color = hexToRgb(hex);
  const profile: [number, number][] = [[0.01, 21], [3, 20.5], [5.8, 19], [7.6, 16.5], [8.2, 13.5], [7.8, 10.5], [6.4, 8], [4.4, 6], [2.6, 4.6], [2, 4]];
  const GORES = 12;
  const colored: Mesh[] = [], white: Mesh[] = [];
  for (let g = 0; g < GORES; g++) (g % 2 ? white : colored).push(lathe(profile, 3, g / GORES, (g + 1) / GORES));
  const ropes = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([x, z]) => box([x * 1.4, 2.2, z * 1.4], [0.08, 3.6, 0.08]));
  return [
    { mesh: merge(colored), color },
    { mesh: merge(white), color: hexToRgb(hex2) },
    { mesh: box([0, 0, 0], [2.4, 1.4, 2.4]), color: hexToRgb(basket), roughness: 0.9 },
    { mesh: merge(ropes), color: DARK },
  ];
}

export function planeParts(hex: string, text = '', bannerHex = DEFAULT_BANNER): Part[] {
  const color = hexToRgb(hex);
  const bannerColor = hexToRgb(bannerHex);
  const fuselage = yToZ(lathe([[0.01, 4.2], [0.55, 3.8], [0.75, 2.6], [0.75, 0.5], [0.55, -2], [0.25, -4.2], [0.01, -4.3]], 12));
  const wings = merge([box([0, 0.2, 1.2], [10, 0.18, 1.6]), box([0, 0.4, -3.8], [3.6, 0.12, 0.9]), box([0, 1.1, -3.9], [0.14, 1.6, 1])]);
  const prop = merge([box([0, 0, 4.35], [0.18, 2.6, 0.08]), box([0, 0, 4.35], [2.6, 0.18, 0.08])]);
  // Pancarta: cuerda y lona vertical (17 × 5 m) detrás de la cola.
  const rope = box([0, 0, -9], [0.05, 0.05, 9]);
  const banner = box([0, -0.5, -22], [0.06, 5, 17]);
  return [
    { mesh: fuselage, color: WHITE, metallic: 0.2, roughness: 0.4 },
    { mesh: wings, color },
    { mesh: prop, color: DARK },
    { mesh: rope, color: DARK },
    { mesh: banner, color: bannerColor, roughness: 0.8 },
    ...(text.trim() ? [{ mesh: bannerMesh(), color: bannerColor, roughness: 0.8, texture: bannerCanvas(bannerHex, text) }] : []),
  ];
}
