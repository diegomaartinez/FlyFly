export interface City {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Rumbo inicial (grados, 0 = norte) con el que se llega a la ciudad. */
  heading: number;
  /** Lugares curados (JSON en /public/places). Se combinan con los de Wikipedia. */
  places?: string;
}

export const CITIES: City[] = [
  { id: 'coruna', name: 'A Coruña', lat: 43.3700, lng: -8.4000, heading: 20, places: 'places/a_coruna.json' },
  { id: 'madrid', name: 'Madrid', lat: 40.4168, lng: -3.7038, heading: 0 },
  { id: 'bilbao', name: 'Bilbao', lat: 43.2630, lng: -2.9350, heading: 60, places: 'places/bilbao.json' },
  { id: 'barcelona', name: 'Barcelona', lat: 41.3851, lng: 2.1734, heading: 45 },
];
