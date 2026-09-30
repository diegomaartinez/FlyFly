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
const NOISE = /^(calle|avenida|rúa|rua|carrer|paseo de|ronda|autovía|autopista|línea|estación|parada|colegio|instituto|ies |ceip|cp |escuela|club|parroquia)/i;
const NOISE_DESC = /(municipio|parroquia|distrito|barrio de|localidad|calle|avenida|estación|línea|equipo|club|empresa|colegio|instituto|escuela)/i;

/** Formato de los JSON curados heredado de la versión anterior (public/places/*.json). */
interface CuratedPlace {
  id: string; name: string; lat: number; lng: number; description?: string; photos?: string[]; sponsor?: Sponsor;
}

export async function loadCurated(url: string): Promise<Poi[]> {
  const res = await fetch(url);
  if (!res.ok) return [];
  const places: CuratedPlace[] = await res.json();
  return places.map((p) => ({
    id: p.id, name: p.name, lat: p.lat, lng: p.lng, description: p.description, image: p.photos?.[0],
    wikiTitle: p.description ? undefined : p.name, sponsor: p.sponsor,
  }));
}

/** Artículos de Wikipedia con foto en un radio de 10 km (CORS abierto, sin clave). */
export async function fetchWikipediaNearby(lat: number, lng: number): Promise<Poi[]> {
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', generator: 'geosearch',
    ggscoord: `${lat}|${lng}`, ggsradius: '10000', ggslimit: '50',
    prop: 'coordinates|pageimages|description', piprop: 'thumbnail', pithumbsize: '800', pilimit: '50', colimit: '50',
  });
  const data = await (await fetch(`https://${LANG}.wikipedia.org/w/api.php?${params}`)).json();
  const pages: any[] = Object.values(data.query?.pages ?? {});
  return pages
    .filter((p) => p.coordinates && p.thumbnail && !NOISE.test(p.title) && !NOISE_DESC.test(p.description ?? ''))
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

/** Globo aerostático dibujado en canvas: el color indica normal / visitado / patrocinado. */
function balloonImage(fill: string, stroke: string): HTMLCanvasElement {
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
  normal: balloonImage('#ff5a4e', '#b3261e'),
  visited: balloonImage('#4ecb71', '#1e7a3c'),
  gold: balloonImage('#ffd54a', '#b8860b'),
  silver: balloonImage('#dfe6ee', '#7d8a99'),
};

export class PoiLayer {
  readonly pois = new Map<string, Poi>();
  readonly visited = new Set<string>();
  private entities = new Map<string, Entity>();
  private queried: { lat: number; lng: number }[] = [];

  constructor(private viewer: Viewer) {}

  clear() {
    this.entities.forEach((e) => this.viewer.entities.remove(e));
    this.entities.clear();
    this.pois.clear();
    this.queried = [];
  }

  add(list: Poi[]) {
    for (const p of list) {
      // Evita duplicados entre JSON curado y Wikipedia (mismo nombre o a menos de 40 m).
      if (this.pois.has(p.id) || [...this.pois.values()].some((q) => q.name === p.name || distance(p, q) < 40)) continue;
      this.pois.set(p.id, p);
      const scale = p.sponsor ? 1.25 : 1;
      this.entities.set(p.id, this.viewer.entities.add({
        id: p.id,
        position: Cartesian3.fromDegrees(p.lng, p.lat, BALLOON_HEIGHT),
        billboard: {
          image: this.image(p),
          heightReference: HeightReference.RELATIVE_TO_GROUND,
          verticalOrigin: VerticalOrigin.BOTTOM,
          scale: 0.9 * scale,
          scaleByDistance: new NearFarScalar(300, 1.3, 15000, 0.3),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 20000),
        },
        label: {
          text: p.name,
          heightReference: HeightReference.RELATIVE_TO_GROUND,
          font: '600 15px "Exo 2", system-ui, sans-serif',
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK.withAlpha(0.8),
          outlineWidth: 4,
          style: LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -115 * scale),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 1800),
        },
      }));
    }
  }

  private image(p: Poi) {
    if (p.sponsor) return IMAGES[p.sponsor.tier];
    return this.visited.has(p.id) ? IMAGES.visited : IMAGES.normal;
  }

  markVisited(id: string) {
    this.visited.add(id);
    const e = this.entities.get(id);
    const p = this.pois.get(id);
    if (e?.billboard && p) e.billboard.image = this.image(p) as any;
  }

  /** Carga más lugares de Wikipedia cuando el avión se aleja más de 5 km de las zonas ya consultadas. */
  async explore(lat: number, lng: number) {
    if (this.queried.some((q) => distance(q, { lat, lng }) < 5000)) return;
    this.queried.push({ lat, lng });
    try {
      this.add(await fetchWikipediaNearby(lat, lng));
    } catch (err) {
      console.warn('Wikipedia no disponible', err);
    }
  }

  nearest(lat: number, lng: number): { poi: Poi; dist: number } | undefined {
    let best: { poi: Poi; dist: number } | undefined;
    for (const poi of this.pois.values()) {
      const dist = distance(poi, { lat, lng });
      if (!best || dist < best.dist) best = { poi, dist };
    }
    return best;
  }
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
