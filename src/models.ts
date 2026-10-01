/**
 * Modelos 3D sencillos generados en el navegador con el color de cada anunciante
 * (globo aerostático y avioneta con pancarta). Devuelven una URL blob: con el GLB.
 * Convención glTF: +Y arriba, +Z adelante.
 */
type Vec3 = [number, number, number];
export type RGB = [number, number, number];
export interface Mesh { positions: number[]; normals: number[]; indices: number[] }
export interface Part { mesh: Mesh; color: RGB; metallic?: number; roughness?: number; emissive?: RGB }

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
  for (const { mesh, color, metallic = 0, roughness = 0.6, emissive } of parts) {
    const pos = new Float32Array(mesh.positions);
    const min = [0, 1, 2].map((i) => Math.min(...mesh.positions.filter((_, j) => j % 3 === i)));
    const max = [0, 1, 2].map((i) => Math.max(...mesh.positions.filter((_, j) => j % 3 === i)));
    gltf.accessors.push({ bufferView: addView(pos, 34962), componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max });
    gltf.accessors.push({ bufferView: addView(new Float32Array(mesh.normals), 34962), componentType: 5126, count: pos.length / 3, type: 'VEC3' });
    gltf.accessors.push({ bufferView: addView(new Uint16Array(mesh.indices), 34963), componentType: 5123, count: mesh.indices.length, type: 'SCALAR' });
    gltf.materials.push({
      doubleSided: true,
      pbrMetallicRoughness: { baseColorFactor: [...color, 1], metallicFactor: metallic, roughnessFactor: roughness },
      ...(emissive ? { emissiveFactor: emissive } : {}),
    });
    const n = gltf.accessors.length;
    gltf.meshes[0].primitives.push({ attributes: { POSITION: n - 3, NORMAL: n - 2 }, indices: n - 1, material: gltf.materials.length - 1 });
  }
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
const WOOD: RGB = [0.28, 0.15, 0.06];
const DARK: RGB = [0.05, 0.05, 0.06];

/** Globo aerostático (~22 m de alto) con gajos del color elegido y blancos alternos. */
export function balloonUrl(hex: string): string {
  return toGlbUrl(balloonParts(hex));
}

/** Avioneta (~9 m) con alas y cola del color elegido y una pancarta remolcada del mismo color. */
export function planeUrl(hex: string): string {
  return toGlbUrl(planeParts(hex));
}

export function balloonParts(hex: string): Part[] {
  const color = hexToRgb(hex);
  const profile: [number, number][] = [[0.01, 21], [3, 20.5], [5.8, 19], [7.6, 16.5], [8.2, 13.5], [7.8, 10.5], [6.4, 8], [4.4, 6], [2.6, 4.6], [2, 4]];
  const GORES = 12;
  const colored: Mesh[] = [], white: Mesh[] = [];
  for (let g = 0; g < GORES; g++) (g % 2 ? white : colored).push(lathe(profile, 3, g / GORES, (g + 1) / GORES));
  const ropes = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([x, z]) => box([x * 1.4, 2.2, z * 1.4], [0.08, 3.6, 0.08]));
  return [
    { mesh: merge(colored), color },
    { mesh: merge(white), color: WHITE },
    { mesh: box([0, 0, 0], [2.4, 1.4, 2.4]), color: WOOD, roughness: 0.9 },
    { mesh: merge(ropes), color: DARK },
  ];
}

export function planeParts(hex: string): Part[] {
  const color = hexToRgb(hex);
  const fuselage = yToZ(lathe([[0.01, 4.2], [0.55, 3.8], [0.75, 2.6], [0.75, 0.5], [0.55, -2], [0.25, -4.2], [0.01, -4.3]], 12));
  const wings = merge([box([0, 0.2, 1.2], [10, 0.18, 1.6]), box([0, 0.4, -3.8], [3.6, 0.12, 0.9]), box([0, 1.1, -3.9], [0.14, 1.6, 1])]);
  const prop = merge([box([0, 0, 4.35], [0.18, 2.6, 0.08]), box([0, 0, 4.35], [2.6, 0.18, 0.08])]);
  // Pancarta: cuerda y lona vertical detrás de la cola.
  const rope = box([0, 0, -9], [0.05, 0.05, 9]);
  const banner = box([0, -0.4, -19], [0.06, 3.2, 11]);
  return [
    { mesh: fuselage, color: WHITE, metallic: 0.2, roughness: 0.4 },
    { mesh: wings, color },
    { mesh: prop, color: DARK },
    { mesh: rope, color: DARK },
    { mesh: banner, color, roughness: 0.8 },
  ];
}
