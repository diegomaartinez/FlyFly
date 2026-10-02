// Enlaces de Google Maps de los anunciantes (módulo sin dependencias: lo usan el juego y la página Anúnciate).

/** Enlaces de Google Maps admitidos (fichas de google.com/maps y enlaces cortos de compartir). */
export const MAPS_LINK = /^https:\/\/((www\.)?google\.(com|[a-z]{2}|com?\.[a-z]{2})\/maps|maps\.google\.(com|[a-z]{2}|com?\.[a-z]{2})[/?]|maps\.app\.goo\.gl\/|goo\.gl\/maps\/)/i;

/** Su enlace de Google Maps o, si no envió ninguno (o no es válido), uno a sus coordenadas. */
export function mapsUrl(a: { lat: number; lng: number; maps?: string }): string {
  return a.maps && MAPS_LINK.test(a.maps) ? a.maps : `https://www.google.com/maps/search/?api=1&query=${a.lat.toFixed(6)},${a.lng.toFixed(6)}`;
}
