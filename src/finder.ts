/**
 * Buscador de negocios de la ciudad: de momento solo los anunciantes (public/data/anunciantes.json),
 * del que más paga al que menos. Se busca en el navegador, sin consultar ningún servicio externo.
 * En la edición de ciudad (sin anuncios) busca entre los lugares del ayuntamiento.
 */
import { Advertiser, advertiserPoi, loadAdvertisers, loadAllAdvertisers } from './advertisers';
import { mapsUrl } from './maps';
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
  /** Enlace de Google Maps (anunciantes). */
  maps?: string;
  color?: string;
  sponsored: boolean;
  /** Anunciante o lugar de interés de la edición de ciudad. */
  kind: 'anuncio' | 'lugar';
  /** Importe mensual pagado (solo anunciantes): ordena la lista. */
  paid: number;
  poi?: Poi;
}

interface Category { label: string; words: string[] }

/** Sinónimos habituales: «pizza» encuentra a quien tenga la etiqueta «restaurante», etc. */
export const CATEGORIES: Category[] = [
  { label: 'Cafetería', words: ['cafeteria', 'cafe', 'desayuno', 'brunch'] },
  { label: 'Restaurante', words: ['restaurante', 'comer', 'comida', 'cena', 'marisqueria', 'pizzeria', 'pizza', 'hamburgueseria', 'sushi', 'tapas'] },
  { label: 'Bar', words: ['bar', 'pub', 'copas', 'cerveceria', 'taberna', 'vinoteca'] },
  { label: 'Heladería', words: ['heladeria', 'helado'] },
  { label: 'Hotel', words: ['hotel', 'hostal', 'alojamiento', 'dormir', 'pension', 'albergue', 'apartamento'] },
  { label: 'Panadería', words: ['panaderia', 'pasteleria', 'pan', 'dulce', 'reposteria'] },
  { label: 'Supermercado', words: ['supermercado', 'super', 'alimentacion', 'compra'] },
  { label: 'Ropa', words: ['ropa', 'moda', 'boutique', 'zapateria', 'zapatos'] },
  { label: 'Peluquería', words: ['peluqueria', 'barberia', 'estetica', 'belleza', 'unas'] },
  { label: 'Farmacia', words: ['farmacia'] },
  { label: 'Gimnasio', words: ['gimnasio', 'gym', 'deporte', 'fitness', 'yoga'] },
  { label: 'Librería', words: ['libreria', 'libro', 'papeleria'] },
  { label: 'Juguetería', words: ['jugueteria', 'juguete', 'juego'] },
  { label: 'Museo', words: ['museo', 'exposicion', 'arte'] },
  { label: 'Ocio', words: ['ocio', 'cine', 'teatro', 'discoteca', 'bolera', 'escape', 'surf', 'actividad', 'experiencia', 'planetario'] },
  { label: 'Tienda', words: ['tienda', 'comercio', 'regalo', 'souvenir'] },
];

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

const adsCache = new Map<string, Promise<Advertiser[]>>();
function cityAds(city: { lat: number; lng: number }) {
  const key = `${city.lat.toFixed(3)},${city.lng.toFixed(3)}`;
  if (!adsCache.has(key)) adsCache.set(key, loadAdvertisers(city.lat, city.lng));
  return adsCache.get(key)!;
}

/** Descarga por adelantado lo necesario para buscar (al abrir el buscador). */
export function warmFinder(city: { lat: number; lng: number }, ads: boolean) {
  if (ads) void cityAds(city);
  void loadPrices();
}

/** Etiquetas de los anunciantes de la ciudad con cuántos la llevan (para el desplegable). */
export async function cityTags(city: { lat: number; lng: number }): Promise<{ tag: string; count: number }[]> {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const a of await cityAds(city)) {
    for (const t of new Set((a.tags ?? []).map((x) => x.trim()).filter(Boolean))) {
      const key = normalize(t);
      const entry = counts.get(key) ?? { tag: t[0].toUpperCase() + t.slice(1), count: 0 };
      entry.count++;
      counts.set(key, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'es'));
}

/**
 * Busca en la ciudad. Sin texto ni etiqueta devuelve todos. Con `tag`, los que llevan esa etiqueta.
 * Anunciantes primero, del que más paga al que menos (`pagado` o, si falta, el precio de su tipo);
 * después, en la edición de ciudad, sus lugares. A igualdad, el más cercano.
 */
export async function searchPlaces(
  query: string, city: { lat: number; lng: number }, from: { lat: number; lng: number },
  opts: { ads: boolean; places?: Poi[]; tag?: string },
): Promise<FinderResult[]> {
  const cat = query ? findCategory(query) : undefined;
  const tag = opts.tag ? normalize(opts.tag) : '';
  const [ads, prices] = await Promise.all([opts.ads ? cityAds(city) : [], loadPrices()]);
  const ok = (fields: (string | undefined)[], tags: string[] = []) =>
    (!tag || tags.some((t) => normalize(t) === tag)) && (!query || matches([...fields, ...tags], query, cat));
  const results: FinderResult[] = ads.filter((a) => ok([a.name, a.description, a.text], a.tags)).map((a) => ({
    id: a.id, name: a.name, lat: a.lat, lng: a.lng, description: a.description, image: a.images?.[0], link: a.link, cta: a.cta,
    maps: mapsUrl(a), color: a.color, sponsored: true, kind: 'anuncio' as const, paid: a.pagado ?? prices[a.type] ?? 0, poi: advertiserPoi(a),
  }));
  results.sort((a, b) => b.paid - a.paid || distance(from, a) - distance(from, b));
  const places: FinderResult[] = (opts.places ?? []).filter((p) => !tag && ok([p.name, p.description, p.body])).map((p) => ({
    id: p.id, name: p.name, lat: p.lat, lng: p.lng, description: p.description, image: p.thumb ?? p.image,
    sponsored: false, kind: 'lugar' as const, paid: 0, poi: p,
  }));
  return [...results, ...places.sort((a, b) => distance(from, a) - distance(from, b))];
}

export interface RankingCity { name: string; country: string; count: number; lat: number; lng: number }
export interface RankingCountry { name: string; count: number; cities: RankingCity[] }

/**
 * Ranking de países y ciudades con más anunciantes vigentes (campos `pais` y `ciudad` de cada
 * anuncio). La posición de cada ciudad es el centro de sus anunciantes.
 */
export async function loadRanking(): Promise<RankingCountry[]> {
  const countries = new Map<string, RankingCountry>();
  const cities = new Map<string, RankingCity & { sumLat: number; sumLng: number }>();
  for (const a of await loadAllAdvertisers()) {
    if (!a.ciudad) continue;
    const country = a.pais?.trim() || 'Otros';
    const key = `${normalize(country)}|${normalize(a.ciudad)}`;
    let c = cities.get(key);
    if (!c) {
      c = { name: a.ciudad.trim(), country, count: 0, lat: 0, lng: 0, sumLat: 0, sumLng: 0 };
      cities.set(key, c);
      const k = normalize(country);
      if (!countries.has(k)) countries.set(k, { name: country, count: 0, cities: [] });
      countries.get(k)!.cities.push(c);
    }
    c.count++;
    c.sumLat += a.lat;
    c.sumLng += a.lng;
    c.lat = c.sumLat / c.count;
    c.lng = c.sumLng / c.count;
    countries.get(normalize(country))!.count++;
  }
  const byCount = <T extends { count: number; name: string }>(a: T, b: T) => b.count - a.count || a.name.localeCompare(b.name, 'es');
  return [...countries.values()].map((c) => ({ ...c, cities: c.cities.sort(byCount) })).sort(byCount);
}

let pricesCache: Promise<Record<string, number>> | undefined;
function loadPrices(): Promise<Record<string, number>> {
  pricesCache ??= fetch('data/tarifas.json', { cache: 'no-cache' })
    .then((r) => r.json())
    .then(({ tipos = {} }) => Object.fromEntries(Object.entries(tipos).map(([k, t]: [string, any]) => [k, Number(t.precioMes) || 0])))
    .catch(() => ({}));
  return pricesCache;
}
