import {
  Cartesian3, createGooglePhotorealistic3DTileset, GeocoderService, GoogleGeocoderService, ImageryLayer, Ion,
  IonGeocoderService, IonGeocodeProviderType, JulianDate, Rectangle, UrlTemplateImageryProvider, Viewer, WebMercatorTilingScheme,
} from 'cesium';

export type WorldMode = 'google' | 'ion' | 'free';

const env = import.meta.env;
const googleKey: string | undefined = env.VITE_GOOGLE_MAPS_API_KEY || undefined;
const ionToken: string | undefined = env.VITE_CESIUM_ION_TOKEN || undefined;
const tileDetail = Number(env.VITE_TILE_DETAIL) || 8;

export const worldMode: WorldMode = googleKey ? 'google' : ionToken ? 'ion' : 'free';

// Sentinel-2 cloudless 2016 (EOX, CC BY 4.0): cobertura mundial a 10 m/píxel.
const sentinel = () =>
  new UrlTemplateImageryProvider({
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg',
    tilingScheme: new WebMercatorTilingScheme(),
    maximumLevel: 15,
    credit: 'Sentinel-2 cloudless – s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)',
  });

// PNOA máxima actualidad (IGN, CC BY 4.0): ortofoto de España hasta 15-25 cm/píxel.
const pnoa = () =>
  new UrlTemplateImageryProvider({
    url:
      'https://www.ign.es/wmts/pnoa-ma?layer=OI.OrthoimageCoverage&style=default&tilematrixset=GoogleMapsCompatible' +
      '&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image/jpeg&TileMatrix={z}&TileCol={x}&TileRow={y}',
    tilingScheme: new WebMercatorTilingScheme(),
    rectangle: Rectangle.fromDegrees(-9.9, 35.8, 4.6, 44.0),
    maximumLevel: 20,
    credit: 'PNOA cedido por © Instituto Geográfico Nacional de España',
  });

export async function createWorld(container: HTMLElement): Promise<Viewer> {
  if (ionToken) Ion.defaultAccessToken = ionToken;

  const viewer = new Viewer(container, {
    animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false,
    sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false,
    selectionIndicator: false,
    baseLayer: worldMode === 'free' ? new ImageryLayer(sentinel()) : false,
    // Resolución nativa de la pantalla (retina incluida) para máxima nitidez.
    useBrowserRecommendedResolution: false,
    msaaSamples: 4,
  });

  const { scene } = viewer;
  scene.screenSpaceCameraController.enableInputs = false;
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
  scene.fog.enabled = true;
  scene.postProcessStages.fxaa.enabled = true;
  // Mediodía de verano: sol alto y cielo luminoso.
  viewer.clock.currentTime = JulianDate.fromIso8601('2026-06-21T11:00:00Z');
  viewer.clock.shouldAnimate = false;

  if (worldMode === 'free') {
    viewer.imageryLayers.addImageryProvider(pnoa());
  } else {
    const tileset = await createGooglePhotorealistic3DTileset(
      { key: googleKey, onlyUsingWithGoogleGeocoder: true },
      { maximumScreenSpaceError: tileDetail },
    );
    scene.primitives.add(tileset);
    scene.globe.show = false;
  }
  return viewer;
}

export interface GeoResult { name: string; lat: number; lng: number }

/** Las teselas de Google solo pueden usarse con el geocodificador de Google; en modo libre usamos Nominatim (OSM). */
export async function geocode(viewer: Viewer, query: string): Promise<GeoResult | undefined> {
  if (worldMode === 'free') {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
    const [hit] = await (await fetch(url)).json();
    return hit && { name: hit.display_name.split(',')[0], lat: +hit.lat, lng: +hit.lon };
  }
  const service: GeocoderService =
    worldMode === 'google'
      ? new GoogleGeocoderService({ key: googleKey! })
      : new IonGeocoderService({ scene: viewer.scene, geocodeProviderType: IonGeocodeProviderType.GOOGLE });
  const [hit] = await service.geocode(query);
  if (!hit) return undefined;
  const c = hit.destination instanceof Rectangle
    ? Rectangle.center(hit.destination)
    : viewer.scene.globe.ellipsoid.cartesianToCartographic(hit.destination as Cartesian3);
  return { name: hit.displayName.split(',')[0], lat: (c.latitude * 180) / Math.PI, lng: (c.longitude * 180) / Math.PI };
}
