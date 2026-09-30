import { Cartesian2, Cartesian3, Color, DistanceDisplayCondition, Entity, HeightReference, LabelStyle, NearFarScalar, VerticalOrigin, Viewer } from 'cesium';

export interface Sponsor {
  tier: 'gold' | 'silver';
  cta?: string;
  link?: string;
}

export interface Poi {
  id: string;
  name: string;
  lat: number;
  lng: number;
  description?: string;
  image?: string;
  url?: string;
  /** Título del artículo de Wikipedia para cargar el resumen completo al acercarse. */
  wikiTitle?: string;
  sponsor?: Sponsor;
}

const LANG: string = import.meta.env.VITE_WIKI_LANG || 'es';
const BALLOON_HEIGHT = 140; // metros sobre el suelo
// Artículos geolocalizados que no son "lugares de interés" (calles, transporte, colegios, divisiones administrativas).
const NOISE = /^(calle|avenida|rúa|rua|carrer|paseo de|ronda|autovía|autopista|línea|estación|parada|colegio|instituto|ies |ceip|cp |escuela|club|parroquia|premios?|asesinato|atentado|incendio|batalla|naufragio|elecciones|anexo)/i;
// Artículos sobre sucesos o ediciones de eventos (llevan un año en el título).
const EVENT = /\b(1[5-9]|20)\d{2}\b/;
const NOISE_DESC = /(municipio|parroquia|distrito|barrio de|localidad|calle|avenida|estación|línea|equipo|club|empresa|colegio|instituto|escuela|edición|evento|suceso|asesinato|ceremonia|premio)/i;

/** Artículos de Wikipedia con foto en un radio de 10 km (CORS abierto, sin clave). */
export async function fetchWikipediaNearby(lat: number, lng: number): Promise<Poi[]> {
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', generator: 'geosearch',
    ggscoord: `${lat}|${lng}`, ggsradius: '5000', ggslimit: '50',
    prop: 'coordinates|pageimages|description', piprop: 'thumbnail', pithumbsize: '800', pilimit: '50', colimit: '50',
  });
  const data = await (await fetch(`https://${LANG}.wikipedia.org/w/api.php?${params}`)).json();
  const pages: any[] = Object.values(data.query?.pages ?? {});
  return pages
    .filter((p) => p.coordinates && p.thumbnail && !NOISE.test(p.title) && !EVENT.test(p.title) && !NOISE_DESC.test(p.description ?? ''))
    .map((p) => ({
      id: `wiki_${p.pageid}`, name: p.title, lat: p.coordinates[0].lat, lng: p.coordinates[0].lon,
      description: p.description, image: p.thumbnail.source, wikiTitle: p.title,
    }));
}

export interface WikiSummary { extract: string; image?: string; url: string }

export async function fetchSummary(title: string): Promise<WikiSummary | undefined> {
  const res = await fetch(`https://${LANG}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
  if (!res.ok) return undefined;
  const s = await res.json();
  return { extract: s.extract, image: s.originalimage?.source ?? s.thumbnail?.source, url: s.content_urls?.desktop?.page };
}

/** Globo aerostático dibujado en canvas con un símbolo: ? (por descubrir), ✓ (descubierto) o ★ (patrocinado). */
function balloonImage(fill: string, stroke: string, symbol: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 120;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(24, 22, 4, 32, 30, 30);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.25, fill);
  grad.addColorStop(1, stroke);
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(32, 62);
  g.bezierCurveTo(8, 48, 2, 36, 4, 28);
  g.arc(32, 28, 28, Math.PI, 0);
  g.bezierCurveTo(62, 36, 56, 48, 32, 62);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,.35)';
  g.lineWidth = 1.5;
  g.stroke();
  g.fillStyle = '#fff';
  g.font = 'bold 30px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(symbol, 32, 32);
  // Cuerdas y barquilla.
  g.beginPath();
  g.moveTo(26, 60); g.lineTo(28, 72); g.moveTo(38, 60); g.lineTo(36, 72);
  g.stroke();
  g.fillStyle = '#7a4a21';
  g.fillRect(27, 72, 10, 8);
  // Hilo hasta el suelo para indicar la posición exacta.
  g.strokeStyle = 'rgba(255,255,255,.7)';
  g.setLineDash([3, 3]);
  g.beginPath(); g.moveTo(32, 80); g.lineTo(32, 120); g.stroke();
  return c;
}

const IMAGES = {
  hidden: balloonImage('#ff8a3d', '#c4461b', '?'),
  discovered: balloonImage('#4ecb71', '#1e7a3c', '✓'),
  sponsor: balloonImage('#ffd54a', '#b8860b', '★'),
};

const REVEAL_DISTANCE = 1000; // el globo aparece al acercarse a esta distancia
const DISCOVER_DISTANCE = 220; // y se descubre al pasar junto a él
const STORAGE_KEY = 'flyfly:discovered';

function loadDiscovered(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

export class PoiLayer {
  readonly pois = new Map<string, Poi>();
  readonly discovered = loadDiscovered();
  private entities = new Map<string, Entity>();

  constructor(private viewer: Viewer) {}

  clear() {
    this.entities.forEach((e) => this.viewer.entities.remove(e));
    this.entities.clear();
    this.pois.clear();
  }

  add(list: Poi[]) {
    for (const p of list) {
      // Evita duplicados entre JSON curado y Wikipedia (mismo nombre o a menos de 40 m).
      if (this.pois.has(p.id) || [...this.pois.values()].some((q) => q.name === p.name || distance(p, q) < 40)) continue;
      this.pois.set(p.id, p);
      const scale = p.sponsor ? 1.25 : 1;
      this.entities.set(p.id, this.viewer.entities.add({
        id: p.id,
        show: false,
        position: Cartesian3.fromDegrees(p.lng, p.lat, BALLOON_HEIGHT),
        billboard: {
          image: this.image(p),
          heightReference: HeightReference.RELATIVE_TO_GROUND,
          verticalOrigin: VerticalOrigin.BOTTOM,
          scale: 0.9 * scale,
          scaleByDistance: new NearFarScalar(200, 1.4, 3000, 0.5),
        },
        label: {
          text: this.label(p),
          heightReference: HeightReference.RELATIVE_TO_GROUND,
          font: '800 16px Nunito, system-ui, sans-serif',
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK.withAlpha(0.7),
          outlineWidth: 4,
          style: LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -115 * scale),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 1500),
        },
      }));
    }
  }

  isDiscovered(p: Poi) {
    return this.discovered.has(p.id);
  }

  private image(p: Poi) {
    if (this.isDiscovered(p)) return IMAGES.discovered;
    return p.sponsor ? IMAGES.sponsor : IMAGES.hidden;
  }

  private label(p: Poi) {
    return this.isDiscovered(p) || p.sponsor ? p.name : '???';
  }

  discover(p: Poi) {
    this.discovered.add(p.id);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.discovered]));
    } catch { /* sin almacenamiento: el progreso dura solo esta sesión */ }
    const e = this.entities.get(p.id);
    if (e?.billboard && e.label) {
      e.billboard.image = this.image(p) as any;
      e.label.text = this.label(p) as any;
    }
  }

  /**
   * Revela los globos cercanos y devuelve el lugar recién descubierto (si lo hay)
   * y el más cercano aún por descubrir, para la brújula.
   */
  update(lat: number, lng: number): { found?: Poi; target?: { poi: Poi; dist: number } } {
    let found: Poi | undefined;
    let target: { poi: Poi; dist: number } | undefined;
    for (const poi of this.pois.values()) {
      const dist = distance(poi, { lat, lng });
      const entity = this.entities.get(poi.id)!;
      if (dist < REVEAL_DISTANCE && !entity.show) entity.show = true;
      if (this.isDiscovered(poi)) continue;
      if (dist < DISCOVER_DISTANCE && !found) found = poi;
      else if (!target || dist < target.dist) target = { poi, dist };
    }
    if (found) this.discover(found);
    return { found, target };
  }

  /** Cuántos lugares de la zona cargada están descubiertos. */
  progress() {
    let n = 0;
    this.pois.forEach((p) => this.isDiscovered(p) && n++);
    return { discovered: n, total: this.pois.size };
  }

  /** Lugares por descubrir más cercanos, para las pistas del menú. */
  hints(lat: number, lng: number, n = 3) {
    return [...this.pois.values()]
      .filter((p) => !this.isDiscovered(p))
      .map((poi) => ({ poi, dist: distance(poi, { lat, lng }) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, n);
  }
}

const MAX_PER_CITY = 80;

/**
 * Lugares de una ciudad: consulta Wikipedia en el centro y en un anillo a 3,5 km
 * (cada consulta devuelve como máximo 50 artículos) y se queda con los más céntricos.
 */
export async function loadCityPois(lat: number, lng: number): Promise<Poi[]> {
  const k = Math.PI / 180;
  const points = [{ lat, lng }];
  for (let i = 0; i < 6; i++) {
    const a = (i * 60) * k;
    points.push({ lat: lat + (3500 * Math.cos(a)) / 111320, lng: lng + (3500 * Math.sin(a)) / (111320 * Math.cos(lat * k)) });
  }
  const results = await Promise.allSettled(points.map((p) => fetchWikipediaNearby(p.lat, p.lng)));
  const all = new Map<string, Poi>();
  for (const r of results) if (r.status === 'fulfilled') r.value.forEach((p) => all.set(p.id, p));
  if (!all.size && results.every((r) => r.status === 'rejected')) throw new Error('Wikipedia no disponible');
  return [...all.values()]
    .sort((a, b) => distance(a, { lat, lng }) - distance(b, { lat, lng }))
    .slice(0, MAX_PER_CITY);
}

type LatLng = { lat: number; lng: number };

/** Distancia horizontal aproximada en metros (equirectangular, suficiente a escala de ciudad). */
export function distance(a: LatLng, b: LatLng): number {
  const k = Math.PI / 180;
  const x = (b.lng - a.lng) * k * Math.cos(((a.lat + b.lat) / 2) * k);
  const y = (b.lat - a.lat) * k;
  return Math.hypot(x, y) * 6371000;
}

/** Rumbo en grados (0 = norte) de a hacia b. */
export function bearing(a: LatLng, b: LatLng): number {
  const k = Math.PI / 180;
  const x = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * k);
  return (Math.atan2(x, b.lat - a.lat) / k + 360) % 360;
}
