/**
 * Altura del geoide EGM96 (nivel medio del mar) sobre el elipsoide WGS84.
 * Las teselas 3D dan alturas elipsoidales; restando este valor se obtiene la altitud sobre el nivel del mar.
 * Malla de 1° generada con `node scripts/make-geoid.mjs` (error medio ~0,2 m).
 */
const ROWS = 181;
const COLS = 361;
let grid: Int16Array | undefined;

export async function loadGeoid(): Promise<void> {
  try {
    const res = await fetch('data/geoid-egm96-1deg.bin');
    if (res.ok) grid = new Int16Array(await res.arrayBuffer());
  } catch {
    // Sin malla se muestra la altura elipsoidal (diferencia típica en España: ~50 m).
  }
}

/** Ondulación del geoide (m) en un punto, por interpolación bilineal. */
export function geoidHeight(lat: number, lng: number): number {
  if (!grid) return 0;
  const y = Math.min(Math.max(90 - lat, 0), ROWS - 1.001);
  const x = Math.min(Math.max(lng + 180, 0), COLS - 1.001);
  const r = Math.floor(y), c = Math.floor(x);
  const fy = y - r, fx = x - c;
  const g = (rr: number, cc: number) => grid![rr * COLS + cc] / 10;
  return (g(r, c) * (1 - fx) + g(r, c + 1) * fx) * (1 - fy) + (g(r + 1, c) * (1 - fx) + g(r + 1, c + 1) * fx) * fy;
}
