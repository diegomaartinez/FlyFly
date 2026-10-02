/**
 * Buscador de negocios de la ciudad, como en Google Maps: «cafeterías», «hotel», «pizza»…
 * Junta los anunciantes (public/data/anunciantes.json, primero quien más paga) con los locales
 * de OpenStreetMap (Overpass API), que van después ordenados por distancia.
 */
import { Advertiser, advertiserPoi, loadAdvertisers } from './advertisers';
import { distance, Poi } from './pois';

export interface FinderResult {
  id: string;
  name: string;
  lat: number;
  lng: number;
  description?: string;
  image?: string;
  link?: string;
  cta?: string;
  color?: string;
  sponsored: boolean;
  /** Anunciante, lugar de interés de la edición de ciudad o local de OpenStreetMap. */
  kind: 'anuncio' | 'lugar' | 'local';
  /** Importe mensual pagado (solo anunciantes): ordena la lista. */
  paid: number;
  /** Ficha completa (solo anunciantes). */
  poi?: Poi;
}

interface Category { label: string; words: string[]; osm: string[] }

/** Categorías habituales: palabras con las que se buscan y etiquetas de OpenStreetMap equivalentes. */
export const CATEGORIES: Category[] = [
  { label: 'Cafetería', words: ['cafeteria', 'cafe', 'desayuno', 'brunch'], osm: ['amenity=cafe'] },
  { label: 'Restaurante', words: ['restaurante', 'comer', 'comida', 'cena', 'marisqueria', 'pizzeria', 'pizza', 'hamburgueseria', 'sushi', 'tapas'], osm: ['amenity=restaurant', 'amenity=fast_food'] },
  { label: 'Bar', words: ['bar', 'pub', 'copas', 'cerveceria', 'taberna', 'vinoteca'], osm: ['amenity=bar', 'amenity=pub'] },
  { label: 'Heladería', words: ['heladeria', 'helado'], osm: ['amenity=ice_cream'] },
  { label: 'Hotel', words: ['hotel', 'hostal', 'alojamiento', 'dormir', 'pension', 'albergue', 'apartamento'], osm: ['tourism=hotel', 'tourism=hostel', 'tourism=guest_house', 'tourism=apartment'] },
  { label: 'Panadería', words: ['panaderia', 'pasteleria', 'pan', 'dulce', 'reposteria'], osm: ['shop=bakery', 'shop=pastry', 'shop=confectionery'] },
  { label: 'Supermercado', words: ['supermercado', 'super', 'alimentacion', 'compra'], osm: ['shop=supermarket', 'shop=convenience'] },
  { label: 'Ropa', words: ['ropa', 'moda', 'boutique', 'zapateria', 'zapatos'], osm: ['shop=clothes', 'shop=shoes', 'shop=boutique'] },
  { label: 'Peluquería', words: ['peluqueria', 'barberia', 'estetica', 'belleza', 'unas'], osm: ['shop=hairdresser', 'shop=beauty'] },
  { label: 'Farmacia', words: ['farmacia'], osm: ['amenity=pharmacy'] },
  { label: 'Gimnasio', words: ['gimnasio', 'gym', 'deporte', 'fitness', 'yoga'], osm: ['leisure=fitness_centre', 'leisure=sports_centre'] },
  { label: 'Librería', words: ['libreria', 'libro', 'papeleria'], osm: ['shop=books', 'shop=stationery'] },
  { label: 'Juguetería', words: ['jugueteria', 'juguete', 'juego'], osm: ['shop=toys', 'shop=games'] },
  { label: 'Museo', words: ['museo', 'exposicion', 'arte'], osm: ['tourism=museum', 'tourism=gallery'] },
  { label: 'Ocio', words: ['ocio', 'cine', 'teatro', 'discoteca', 'bolera', 'escape', 'surf', 'actividad', 'experiencia', 'planetario'], osm: ['amenity=cinema', 'amenity=theatre', 'amenity=nightclub', 'leisure=bowling_alley'] },
  { label: 'Tienda', words: ['tienda', 'comercio', 'regalo', 'souvenir'], osm: ['shop=gift', 'shop=variety_store'] },
];

/** Sugerencias que se muestran como botones bajo el buscador. */
export const SUGGESTIONS = ['Cafeterías', 'Restaurantes', 'Bares', 'Hoteles', 'Tiendas', 'Ocio'];

const RADIUS = 6000;
const MAX_OSM = 40;

/** Minúsculas, sin acentos ni plurales sencillos: «Cafeterías» → «cafeteria». */
export function normalize(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const stem = (w: string) => (w.length > 4 && w.endsWith('es') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
const words = (s: string) => normalize(s).split(' ').filter(Boolean).map(stem);

function findCategory(query: string): Category | undefined {
  const q = words(query);
  return CATEGORIES.find((c) => c.words.some((w) => q.includes(w)) || q.includes(stem(normalize(c.label))));
}

function matches(fields: (string | undefined)[], query: string, cat?: Category): boolean {
  const text = words(fields.filter(Boolean).join(' '));
  // Palabra exacta o, si es larga, el principio de una palabra («marisq» → «marisqueria»).
  const has = (w: string, min: number) => text.some((x) => x === w || (w.length >= min && x.startsWith(w)));
  if (cat && cat.words.some((w) => has(w, 5))) return true;
  const q = words(query);
  return q.length > 0 && q.every((w) => has(w, 4));
}

async function searchOsm(query: string, cat: Category | undefined, lat: number, lng: number): Promise<FinderResult[]> {
  const around = `(around:${RADIUS},${lat.toFixed(5)},${lng.toFixed(5)})`;
  const filters = cat
    ? cat.osm.map((t) => { const [k, v] = t.split('='); return `nwr["${k}"="${v}"]["name"]${around};`; })
    : [`nwr["name"~"${query.replace(/[\\"^$.*+?()[\]{}|]/g, '')}",i][~"^(amenity|shop|tourism|leisure|craft)$"~"."]${around};`];
  const body = `[out:json][timeout:15];(${filters.join('')});out center tags 200;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: body }) });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const { elements = [] } = await res.json();
  return elements
    .map((e: any): FinderResult | undefined => {
      const t = e.tags ?? {};
      const la = e.lat ?? e.center?.lat, ln = e.lon ?? e.center?.lon;
      if (!t.name || la == null) return undefined;
      const street = t['addr:street'] ? `${t['addr:street']}${t['addr:housenumber'] ? `, ${t['addr:housenumber']}` : ''}` : '';
      const kind = CATEGORIES.find((c) => c.osm.some((o) => { const [k, v] = o.split('='); return t[k] === v; }))?.label;
      const link = t.website || t['contact:website'] || t.url;
      return {
        id: `osm_${e.type}${e.id}`, name: t.name, lat: la, lng: ln, sponsored: false, kind: 'local', paid: 0,
        description: [kind, street].filter(Boolean).join(' · ') || undefined,
        image: /^https:\/\//.test(t.image ?? '') ? t.image : undefined,
        link: /^https?:\/\//.test(link ?? '') ? link : undefined,
      };
    })
    .filter(Boolean) as FinderResult[];
}

export interface FinderOutput { results: FinderResult[]; osmFailed: boolean }

/**
 * Busca en la ciudad. Los anunciantes van primero, del que más paga al que menos
 * (`pagado` en anunciantes.json o, si no está, el precio mensual de su tipo); después, los locales
 * de OpenStreetMap por cercanía a `from`.
 */
export async function searchPlaces(
  query: string, city: { lat: number; lng: number }, from: { lat: number; lng: number },
  opts: { ads: boolean; places?: Poi[] } = { ads: true },
): Promise<FinderOutput> {
  const cat = findCategory(query);
  const [ads, prices, osm] = await Promise.all([
    opts.ads ? loadAdvertisers(city.lat, city.lng) : Promise.resolve([] as Advertiser[]),
    loadPrices(),
    searchOsm(query, cat, city.lat, city.lng).catch(() => undefined),
  ]);
  const sponsored: FinderResult[] = ads.filter((a) => matches([a.name, a.description, a.text, ...(a.tags ?? [])], query, cat)).map((a) => ({
    id: a.id, name: a.name, lat: a.lat, lng: a.lng, description: a.description, image: a.images?.[0], link: a.link, cta: a.cta,
    color: a.color, sponsored: true, kind: 'anuncio' as const, paid: a.pagado ?? prices[a.type] ?? 0, poi: advertiserPoi(a),
  }));
  sponsored.sort((a, b) => b.paid - a.paid || distance(from, a) - distance(from, b));
  const places: FinderResult[] = (opts.places ?? []).filter((p) => matches([p.name, p.description, p.body], query, cat)).map((p) => ({
    id: p.id, name: p.name, lat: p.lat, lng: p.lng, description: p.description, image: p.thumb ?? p.image,
    sponsored: false, kind: 'lugar' as const, paid: 0, poi: p,
  }));
  sponsored.push(...places.sort((a, b) => distance(from, a) - distance(from, b)));
  // Sin duplicar los anunciantes que también están en OpenStreetMap.
  const known = new Set(sponsored.map((s) => normalize(s.name)));
  const others = (osm ?? [])
    .filter((r) => !known.has(normalize(r.name)))
    .sort((a, b) => distance(from, a) - distance(from, b))
    .slice(0, MAX_OSM);
  return { results: [...sponsored, ...others], osmFailed: !osm };
}

let pricesCache: Promise<Record<string, number>> | undefined;
function loadPrices(): Promise<Record<string, number>> {
  pricesCache ??= fetch('data/tarifas.json', { cache: 'no-cache' })
    .then((r) => r.json())
    .then(({ tipos = {} }) => Object.fromEntries(Object.entries(tipos).map(([k, t]: [string, any]) => [k, Number(t.precioMes) || 0])))
    .catch(() => ({}));
  return pricesCache;
}
