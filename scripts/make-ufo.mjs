// Genera public/models/ufo.glb: platillo volante low-poly (glTF: +Y arriba, +Z adelante).
import { writeFileSync } from 'node:fs';

const SEGMENTS = 32;
const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Superficie de revolución a partir de un perfil [radio, altura] (de arriba abajo). */
function lathe(profile) {
  const tris = [];
  const at = ([r, y], i) => {
    const a = (i / SEGMENTS) * Math.PI * 2;
    return [r * Math.cos(a), y, r * Math.sin(a)];
  };
  for (let i = 0; i < SEGMENTS; i++) {
    for (let j = 0; j < profile.length - 1; j++) {
      const a = at(profile[j], i), b = at(profile[j], i + 1);
      const c = at(profile[j + 1], i), d = at(profile[j + 1], i + 1);
      tris.push([a, b, c], [b, d, c]);
    }
  }
  return tris;
}

/** Luz del borde: octaedro pequeño. */
function light(cx, cy, cz, s) {
  const v = [[cx + s, cy, cz], [cx - s, cy, cz], [cx, cy + s, cz], [cx, cy - s, cz], [cx, cy, cz + s], [cx, cy, cz - s]];
  const f = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]];
  return f.map((t) => t.map((k) => v[k]));
}

const body = lathe([[0, 0.35], [1.3, 0.28], [2.5, 0.1], [3.0, 0], [2.7, -0.18], [1.6, -0.42], [0.8, -0.55], [0, -0.58]]);
const dome = lathe(Array.from({ length: 9 }, (_, k) => {
  const t = (k / 8) * (Math.PI / 2);
  return [1.25 * Math.sin(t), 0.3 + 1.1 * Math.cos(t)];
}));
const lights = [];
for (let i = 0; i < 10; i++) {
  const a = (i / 10) * Math.PI * 2;
  lights.push(...light(2.95 * Math.cos(a), 0, 2.95 * Math.sin(a), 0.2));
}
const glow = lathe([[0.8, -0.56], [0.8, -0.62], [0, -0.62]]);

const parts = [
  { tris: body, material: { name: 'casco', pbrMetallicRoughness: { baseColorFactor: [0.78, 0.81, 0.87, 1], metallicFactor: 0.7, roughnessFactor: 0.35 } } },
  { tris: dome, material: { name: 'cupula', alphaMode: 'BLEND', pbrMetallicRoughness: { baseColorFactor: [0.45, 0.88, 1, 0.65], metallicFactor: 0, roughnessFactor: 0.1 } } },
  { tris: lights, material: { name: 'luces', emissiveFactor: [1, 0.8, 0.25], pbrMetallicRoughness: { baseColorFactor: [1, 0.85, 0.3, 1], metallicFactor: 0, roughnessFactor: 0.5 } } },
  { tris: glow, material: { name: 'brillo', emissiveFactor: [0.3, 1, 0.75], pbrMetallicRoughness: { baseColorFactor: [0.3, 1, 0.75, 1], metallicFactor: 0, roughnessFactor: 0.5 } } },
];

const buffers = [];
const gltf = {
  asset: { version: '2.0', generator: 'FlyFly' },
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [] }], materials: [], buffers: [], bufferViews: [], accessors: [],
};
let offset = 0;
const addView = (arr) => {
  const buf = Buffer.from(new Float32Array(arr).buffer);
  buffers.push(buf);
  gltf.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length });
  offset += buf.length;
  return gltf.bufferViews.length - 1;
};

for (const { tris, material } of parts) {
  const pos = [], nor = [];
  for (const [a, b, c] of tris) {
    let n = cross(sub(c, a), sub(b, a));
    const l = Math.hypot(...n);
    if (l < 1e-9) continue; // triángulos degenerados en el eje
    n = n.map((x) => x / l);
    for (const v of [a, b, c]) { pos.push(...v); nor.push(...n); }
  }
  const count = pos.length / 3;
  const min = [0, 1, 2].map((i) => Math.min(...pos.filter((_, j) => j % 3 === i)));
  const max = [0, 1, 2].map((i) => Math.max(...pos.filter((_, j) => j % 3 === i)));
  gltf.accessors.push({ bufferView: addView(pos), componentType: 5126, count, type: 'VEC3', min, max });
  gltf.accessors.push({ bufferView: addView(nor), componentType: 5126, count, type: 'VEC3' });
  gltf.materials.push({ ...material, doubleSided: true });
  gltf.meshes[0].primitives.push({
    attributes: { POSITION: gltf.accessors.length - 2, NORMAL: gltf.accessors.length - 1 },
    material: gltf.materials.length - 1,
  });
}

const bin = Buffer.concat(buffers);
gltf.buffers.push({ byteLength: bin.length });
const pad = (buf, fill) => Buffer.concat([buf, Buffer.alloc((4 - (buf.length % 4)) % 4, fill)]);
const json = pad(Buffer.from(JSON.stringify(gltf)), 0x20);
const data = pad(bin, 0);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + json.length + 8 + data.length, 8);
const chunk = (buf, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(buf.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, buf]); };
writeFileSync(new URL('../public/models/ufo.glb', import.meta.url), Buffer.concat([header, chunk(json, 0x4e4f534a), chunk(data, 0x004e4942)]));
console.log(`ufo.glb: ${(data.length / 1024).toFixed(1)} KB`);
