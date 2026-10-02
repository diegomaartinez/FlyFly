import {
  Cartesian2, Cartesian3, Cartographic, SceneTransforms, CesiumWidget,
} from '@cesium/engine';
import { icon } from './icons';
import { validHeight } from './world';

export interface Sponsor {
  tier: 'gold' | 'silver';
  cta?: string;
  link?: string;
  /** Color del recuadro elegido por el anunciante. */
  color?: string;
}

export interface Poi {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Descripción corta (p. ej. "faro romano en A Coruña"). */
  description?: string;
  /** Foto grande (ficha) y miniatura (marcador). */
  image?: string;
  thumb?: string;
  url?: string;
  /** Título del artículo de Wikipedia para cargar el resumen completo. */
  wikiTitle?: string;
  sponsor?: Sponsor;
  /** Texto propio de la ficha (anunciantes). */
  body?: string;
  /** Fotos adicionales de la ficha. */
  gallery?: string[];
}

const LANG: string = import.meta.env.VITE_WIKI_LANG || 'es';
// Artículos geolocalizados que no son "lugares de interés" (calles, transporte, colegios, divisiones administrativas).
const NOISE = /^(calle|avenida|rúa|rua|carrer|paseo de|ronda|autovía|autopista|línea|estación|parada|colegio|instituto|ies |ceip|cp |escuela|club|parroquia|premios?|asesinato|atentado|incendio|batalla|naufragio|elecciones|anexo)/i;
// Artículos sobre sucesos o ediciones de eventos (llevan un año en el título).
const EVENT = /\b(1[5-9]|20)\d{2}\b/;
const NOISE_DESC = /(municipio|parroquia|distrito|barrio de|localidad|calle|avenida|estación|línea|equipo|club|empresa|colegio|instituto|escuela|edición|evento|suceso|asesinato|ceremonia|premio)/i;

export function wikiUrl(title: string) {
  return `https://${LANG}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

/** Cambia el ancho de una miniatura de Wikimedia (…/800px-Archivo.jpg → …/330px-Archivo.jpg). */
export function resizeThumb(url: string, width: number) {
  return url.replace(/\/\d+px-([^/]+)$/, `/${width}px-$1`);
}

/** Artículos de Wikipedia con foto en un radio de 5 km (CORS abierto, sin clave). */
export async function fetchWikipediaNearby(lat: number, lng: number): Promise<Poi[]> {
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', generator: 'geosearch',
    ggscoord: `${lat}|${lng}`, ggsradius: '5000', ggslimit: '50',
    prop: 'coordinates|pageimages|description', piprop: 'thumbnail', pithumbsize: '960', pilimit: '50', colimit: '50',
  });
  const data = await (await fetch(`https://${LANG}.wikipedia.org/w/api.php?${params}`)).json();
  const pages: any[] = Object.values(data.query?.pages ?? {});
  return pages
    .filter((p) => p.coordinates && p.thumbnail && !NOISE.test(p.title) && !EVENT.test(p.title) && !NOISE_DESC.test(p.description ?? ''))
    .map((p) => ({
      id: `wiki_${p.pageid}`, name: p.title, lat: p.coordinates[0].lat, lng: p.coordinates[0].lon,
      description: p.description, image: p.thumbnail.source, thumb: resizeThumb(p.thumbnail.source, 330), wikiTitle: p.title,
    }));
}

export interface WikiSummary { extract: string; image?: string; url: string }

export async function fetchSummary(title: string): Promise<WikiSummary | undefined> {
  const res = await fetch(`https://${LANG}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
  if (!res.ok) return undefined;
  const s = await res.json();
  return { extract: s.extract, image: s.thumbnail?.source, url: s.content_urls?.desktop?.page };
}

export interface ImageCredit { artist: string; license: string; url: string }

/** Autor y licencia de una foto de Wikimedia (obligatorio mostrarlos en imágenes CC BY / CC BY-SA). */
export async function fetchImageCredit(imageUrl: string): Promise<ImageCredit | undefined> {
  const m = imageUrl.match(/\/wikipedia\/([^/]+)\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/);
  if (!m) return undefined;
  const [, project, file] = m;
  const host = project === 'commons' ? 'commons.wikimedia.org' : `${project}.wikipedia.org`;
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', prop: 'imageinfo', iiprop: 'extmetadata|url',
    titles: `File:${decodeURIComponent(file)}`,
  });
  const data = await (await fetch(`https://${host}/w/api.php?${params}`)).json();
  const info = (Object.values(data.query?.pages ?? {})[0] as any)?.imageinfo?.[0];
  if (!info) return undefined;
  const text = (html?: string) => {
    const div = document.createElement('div');
    div.innerHTML = html ?? '';
    return (div.textContent ?? '').trim();
  };
  const meta = info.extmetadata ?? {};
  return { artist: text(meta.Artist?.value) || 'Autor desconocido', license: text(meta.LicenseShortName?.value), url: info.descriptionurl };
}

// ---------- Descubrimiento y marcadores ----------

// Los lugares por descubrir solo se ven como un "?" naranja (sin haz de luz ni tarjeta) hasta llegar a ellos.
const REVEAL_DISTANCE = 2000; // aparece el marcador "?"
const DISCOVER_DISTANCE = 50; // se descubre (hay que llegar al sitio)
const SPONSOR_VISIBLE = 3000; // los patrocinados se ven desde más lejos
const COMPACT_DISTANCE = 700; // más allá, la tarjeta se reduce a una píldora
const MARKER_HEIGHT = 35; // metros sobre el suelo o el tejado
const STORAGE_KEY = 'flyfly:discovered';

/** Qué lugares ya descubiertos se muestran en el mapa (Ajustes). */
export type FoundVisibility = 'todos' | 'cercanos' | 'ninguno';
const FOUND_VISIBLE: Record<FoundVisibility, number> = { todos: Infinity, cercanos: 400, ninguno: -1 };

type State = 'hidden' | 'mystery' | 'found';

interface Marker {
  poi: Poi;
  state: State;
  dist: number;
  ground?: number;
  sampling?: boolean;
  anchor?: Cartesian3;
  el?: HTMLButtonElement;
}

function loadDiscovered(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

export function formatDistance(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m / 10) * 10} m`;
}

export class PoiLayer {
  readonly pois = new Map<string, Poi>();
  readonly discovered = loadDiscovered();
  /** Objetos que no deben contar como "suelo" al medir alturas (ahora ninguno: ya no hay haces de luz). */
  readonly excluded: object[] = [];
  /** Clic en un marcador. */
  onSelect?: (poi: Poi) => void;
  /** Visibilidad de los lugares descubiertos. */
  foundVisibility: FoundVisibility = 'cercanos';
  private markers = new Map<string, Marker>();
  private fallbackGround = 0;
  private sampling = 0;
  private win = new Cartesian2();
  private toMarker = new Cartesian3();

  constructor(private viewer: CesiumWidget, private container: HTMLElement) {}

  clear() {
    for (const m of this.markers.values()) {
      m.el?.remove();
    }
    this.markers.clear();
    this.pois.clear();
    this.excluded.length = 0;
  }

  add(list: Poi[]) {
    for (const p of list) {
      // Evita duplicados (mismo nombre o a menos de 40 m).
      if (this.pois.has(p.id) || [...this.pois.values()].some((q) => q.name === p.name || distance(p, q) < 40)) continue;
      this.pois.set(p.id, p);
      this.markers.set(p.id, { poi: p, state: 'hidden', dist: Infinity });
    }
  }

  isDiscovered(p: Poi) {
    return this.discovered.has(p.id);
  }

  private discover(p: Poi) {
    this.discovered.add(p.id);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.discovered]));
    } catch { /* sin almacenamiento: el progreso dura solo esta sesión */ }
  }

  /** Olvida los lugares descubiertos de la ciudad actual. */
  resetProgress() {
    for (const id of this.pois.keys()) this.discovered.delete(id);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.discovered]));
    } catch { /* sin almacenamiento */ }
    for (const m of this.markers.values()) this.setState(m, 'hidden');
  }

  /**
   * Actualiza estados según la posición del ovni (llamar unas pocas veces por segundo).
   * Devuelve el lugar recién descubierto (si lo hay) y el más cercano por descubrir.
   * `exclude`: objetos que no deben contar como suelo al medir (el propio ovni).
   */
  update(lat: number, lng: number, fallbackGround: number, exclude: object[]): { found?: Poi; target?: { poi: Poi; dist: number } } {
    this.fallbackGround = fallbackGround;
    let found: Poi | undefined;
    let target: { poi: Poi; dist: number } | undefined;
    for (const m of this.markers.values()) {
      const { poi } = m;
      m.dist = distance(poi, { lat, lng });
      if (!found && !this.isDiscovered(poi) && m.dist < DISCOVER_DISTANCE) {
        this.discover(poi);
        found = poi;
        m.el?.classList.add('just-found');
        setTimeout(() => m.el?.classList.remove('just-found'), 900);
      }
      const discovered = this.isDiscovered(poi);
      if (!discovered && !poi.sponsor && (!target || m.dist < target.dist)) target = { poi, dist: m.dist };

      let state: State = 'hidden';
      if (discovered) state = m.dist < FOUND_VISIBLE[this.foundVisibility] ? 'found' : 'hidden';
      else if (poi.sponsor) state = m.dist < SPONSOR_VISIBLE ? 'found' : 'hidden';
      else if (m.dist < REVEAL_DISTANCE) state = 'mystery';
      this.setState(m, state);

      if (state !== 'hidden' && m.ground === undefined && !m.sampling) this.sampleGround(m, exclude);
    }
    return { found, target };
  }

  private setState(m: Marker, state: State) {
    m.state = state;
    if (state === 'hidden') {
      m.el?.remove();
      m.el = undefined;
      return;
    }
    const discovered = this.isDiscovered(m.poi);
    if (!m.el) m.el = this.createElement(m);
    const el = m.el;
    const cls = ['marker', `is-${state}`];
    if (discovered) cls.push('is-discovered');
    if (m.poi.sponsor) cls.push('is-sponsor');
    if (state === 'found' && m.dist > COMPACT_DISTANCE) cls.push('is-compact');
    if (el.classList.contains('just-found')) cls.push('just-found');
    const className = cls.join(' ');
    if (el.className !== className) el.className = className;

    const title = el.querySelector('b')!;
    const sub = el.querySelector('small')!;
    if (state === 'found') {
      title.textContent = m.poi.name;
      sub.textContent = m.poi.sponsor ? 'Patrocinado' : m.poi.description ?? '';
    }
    // La foto solo se descarga al descubrirlo (no para los "?").
    const img = el.querySelector('img')!;
    if (state === 'found' && m.poi.thumb && img.getAttribute('src') !== m.poi.thumb) img.src = m.poi.thumb;
    el.setAttribute('aria-label', state === 'found' ? m.poi.name : 'Lugar por descubrir');
  }

  private createElement(m: Marker): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'marker';
    el.innerHTML = `
      <span class="marker-pin">${icon('question')}</span>
      <span class="marker-card">
        <span class="marker-photo"><img alt="" decoding="async" /><span class="marker-q">${icon('question')}</span></span>
        <span class="marker-text"><b></b><small></small></span>
        <span class="marker-badge">${icon('check')}</span>
      </span>
      <span class="marker-tail"></span>`;
    el.addEventListener('click', () => this.onSelect?.(m.poi));
    this.container.append(el);
    return el;
  }

  /** Altura del suelo/tejado bajo el lugar (asíncrona, como mucho dos a la vez). */
  private async sampleGround(m: Marker, exclude: object[]) {
    if (this.sampling >= 2) return;
    m.sampling = true;
    this.sampling++;
    try {
      const [c] = await this.viewer.scene.sampleHeightMostDetailed(
        [Cartographic.fromDegrees(m.poi.lng, m.poi.lat)],
        [...exclude, ...this.excluded],
      );
      m.ground = validHeight(c?.height, this.fallbackGround);
    } catch {
      m.ground = this.fallbackGround;
    } finally {
      m.sampling = false;
      this.sampling--;
    }
    m.anchor = undefined;
    if (this.markers.get(m.poi.id) === m) this.setState(m, m.state);
  }

  /** Coloca los marcadores visibles sobre la escena (llamar en cada fotograma). */
  render() {
    const { scene, camera } = this.viewer;
    for (const m of this.markers.values()) {
      const el = m.el;
      if (!el) continue;
      m.anchor ??= Cartesian3.fromDegrees(m.poi.lng, m.poi.lat, (m.ground ?? this.fallbackGround) + MARKER_HEIGHT);
      const to = Cartesian3.subtract(m.anchor, camera.positionWC, this.toMarker);
      const behind = Cartesian3.dot(to, camera.directionWC) <= 0;
      const win = behind ? undefined : SceneTransforms.worldToWindowCoordinates(scene, m.anchor, this.win);
      if (!win) {
        el.style.visibility = 'hidden';
        continue;
      }
      const d = Cartesian3.magnitude(to);
      // Más pequeños cuanto más lejos, pero las píldoras compactas siempre legibles.
      const minScale = el.classList.contains('is-compact') ? 0.9 : el.classList.contains('is-mystery') ? 0.75 : 0.6;
      const scale = Math.min(1, Math.max(minScale, 500 / d));
      el.style.visibility = '';
      el.style.transform = `translate3d(${win.x.toFixed(1)}px, ${win.y.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
      el.style.zIndex = String(100000 - Math.round(d));
    }
  }

  /** Lugares por descubrir más cercanos, para las pistas del menú. */
  hints(lat: number, lng: number, n = 3) {
    return [...this.pois.values()]
      .filter((p) => !this.isDiscovered(p) && !p.sponsor)
      .map((poi) => ({ poi, dist: distance(poi, { lat, lng }) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, n);
  }

  progress() {
    let discovered = 0, total = 0;
    this.pois.forEach((p) => {
      if (p.sponsor) return;
      total++;
      if (this.isDiscovered(p)) discovered++;
    });
    return { discovered, total };
  }
}

/** Patrocinador tal y como se escribe en public/data/patrocinadores.json. */
interface SponsorEntry {
  id: string; name: string; lat: number; lng: number;
  description?: string; image?: string; link?: string; cta?: string;
  /** Fecha de fin del patrocinio (AAAA-MM-DD); después deja de mostrarse. */
  until?: string;
}

/** Patrocinadores vigentes a menos de 8 km del centro de la ciudad. */
export async function loadSponsors(lat: number, lng: number): Promise<Poi[]> {
  try {
    const res = await fetch('data/patrocinadores.json', { cache: 'no-cache' });
    if (!res.ok) return [];
    const list: SponsorEntry[] = await res.json();
    const today = new Date().toISOString().slice(0, 10);
    return list
      .filter((s) => (!s.until || s.until >= today) && distance(s, { lat, lng }) < 8000)
      .map((s) => ({
        id: `sp_${s.id}`, name: s.name, lat: s.lat, lng: s.lng, description: s.description,
        image: s.image, thumb: s.image, sponsor: { tier: 'gold', cta: s.cta, link: s.link },
      }));
  } catch {
    return [];
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
    const a = i * 60 * k;
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
