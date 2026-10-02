/**
 * Ediciones de FlyFly:
 *  - General (por defecto): cualquier ciudad, lugares de Wikipedia por descubrir y anunciantes a la vez.
 *  - Ciudad (para un ayuntamiento): se compila con VITE_CIUDAD=<id> y lee public/ciudades/<id>.json.
 *    Siempre la misma ciudad, sin buscador de ciudades ni anuncios, con su portada y los lugares que
 *    elija el ayuntamiento (y, si quiere, los de Wikipedia que no haya ocultado).
 */
import { distance, fetchSummary, loadCityPois, Poi, resizeThumb } from './pois';

export const CITY_ID: string = import.meta.env.VITE_CIUDAD || '';

/** Lugar elegido por el ayuntamiento. Con `wiki` se completan solos la foto y el texto que falten. */
export interface CityPlace {
  id?: string;
  name: string;
  lat: number;
  lng: number;
  description?: string;
  text?: string;
  images?: string[];
  link?: string;
  /** Título del artículo de Wikipedia del que tomar foto y resumen si no se indican. */
  wiki?: string;
}

export interface CityEdition {
  name: string;
  /** Provincia, comunidad o país (se muestra bajo el nombre). */
  detail?: string;
  lat: number;
  lng: number;
  /** Portada. */
  title?: string;
  subtitle?: string;
  /** Logotipo del ayuntamiento (ruta dentro de public/). */
  logo?: string;
  /** Texto del botón de empezar. */
  start?: string;
  lugares?: CityPlace[];
  /** Añadir también los lugares de Wikipedia de la zona. */
  wikipedia?: boolean;
  /** Nombres de lugares de Wikipedia que no deben aparecer. */
  ocultar?: string[];
}

export async function loadEdition(): Promise<CityEdition | undefined> {
  if (!CITY_ID) return undefined;
  const res = await fetch(`ciudades/${encodeURIComponent(CITY_ID)}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`No se encuentra public/ciudades/${CITY_ID}.json`);
  return res.json();
}

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Lugares de la edición de ciudad: los del ayuntamiento primero y, si se pide, los de Wikipedia. */
export async function loadEditionPois(city: CityEdition): Promise<Poi[]> {
  const own = await Promise.all((city.lugares ?? []).map(async (p, i): Promise<Poi> => {
    let image = p.images?.[0], body = p.text, url = p.link;
    if (p.wiki && (!image || !body)) {
      const s = await fetchSummary(p.wiki).catch(() => undefined);
      image ??= s?.image;
      body ??= s?.extract;
      url ??= s?.url;
    }
    return {
      id: `c_${p.id ?? i}`, name: p.name, lat: p.lat, lng: p.lng, description: p.description,
      image, thumb: image && /wikimedia/.test(image) ? resizeThumb(image, 330) : image, body, url, gallery: p.images,
    };
  }));
  if (!city.wikipedia) return own;
  const hidden = new Set((city.ocultar ?? []).map(norm));
  const wiki = await loadCityPois(city.lat, city.lng).catch(() => [] as Poi[]);
  // Sin repetir los del ayuntamiento (mismo nombre o a menos de 60 m).
  const extra = wiki.filter((w) => !hidden.has(norm(w.name)) && !own.some((o) => norm(o.name) === norm(w.name) || distance(o, w) < 60));
  return [...own, ...extra];
}
