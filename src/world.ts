import {
  Cartesian3, Cartographic, Cesium3DTileset, createGooglePhotorealistic3DTileset, GeocoderService, GoogleGeocoderService, ImageryLayer, Ion,
  IonGeocoderService, IonGeocodeProviderType, JulianDate, Rectangle, UrlTemplateImageryProvider, Viewer, WebMercatorTilingScheme,
} from 'cesium';

export type WorldMode = 'google' | 'ion' | 'free';

export interface World {
  viewer: Viewer;
  mode: WorldMode;
  tileset?: Cesium3DTileset;
  /** Motivo por el que no se pudo cargar el 3D, si se cayó al modo libre. */
  error?: string;
}

const env = import.meta.env;
const googleKey: string | undefined = env.VITE_GOOGLE_MAPS_API_KEY || undefined;
const ionToken: string | undefined = env.VITE_CESIUM_ION_TOKEN || undefined;
const tileDetail = Number(env.VITE_TILE_DETAIL) || 16;

const wanted: WorldMode = googleKey ? 'google' : ionToken ? 'ion' : 'free';

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

export async function createWorld(container: HTMLElement): Promise<World> {
  if (ionToken) Ion.defaultAccessToken = ionToken;

  const viewer = new Viewer(container, {
    animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false,
    sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false,
    selectionIndicator: false,
    baseLayer: new ImageryLayer(sentinel()),
  });

  const { scene } = viewer;
  scene.screenSpaceCameraController.enableInputs = false;
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
  scene.fog.enabled = true;
  // Lo lejano (más allá de ~5-10 km) se carga con muy poco detalle y queda tras la niebla:
  // así las teselas cercanas de la ciudad cargan antes.
  scene.fog.density = 0.0012;
  scene.fog.screenSpaceErrorFactor = 8;
  scene.postProcessStages.fxaa.enabled = true;
  // Mediodía de verano: sol alto y cielo luminoso.
  viewer.clock.currentTime = JulianDate.fromIso8601('2026-06-21T11:00:00Z');
  viewer.clock.shouldAnimate = false;
  viewer.imageryLayers.addImageryProvider(pnoa());

  if (wanted === 'free') return { viewer, mode: 'free' };
  try {
    const tileset = await createGooglePhotorealistic3DTileset(
      { key: googleKey, onlyUsingWithGoogleGeocoder: true },
      {
        maximumScreenSpaceError: tileDetail,
        // Reduce mucho el detalle de lo que queda cerca del horizonte.
        dynamicScreenSpaceErrorDensity: 2.0e-3,
        dynamicScreenSpaceErrorFactor: 48,
        dynamicScreenSpaceErrorHeightFalloff: 0.5,
      },
    );
    scene.primitives.add(tileset);
    scene.globe.show = false;
    return { viewer, mode: wanted, tileset };
  } catch (err) {
    // Token inválido, sin el asset de Google añadido o URL no permitida: seguimos en modo libre.
    console.error('No se pudo cargar el 3D fotorrealista', err);
    return { viewer, mode: 'free', error: err instanceof Error ? err.message : String(err) };
  }
}

/** Altura del suelo (terreno + edificios) en un punto, esperando a que carguen las teselas. */
export async function groundHeight(world: World, lat: number, lng: number): Promise<number> {
  if (!world.tileset) return 0;
  try {
    const [c] = await world.viewer.scene.sampleHeightMostDetailed([Cartographic.fromDegrees(lng, lat)]);
    return c?.height ?? 0;
  } catch {
    return 0;
  }
}

export interface GeoResult { name: string; detail: string; lat: number; lng: number }

/** Las teselas de Google solo pueden usarse con el geocodificador de Google; en modo libre usamos Nominatim (OSM). */
export async function geocode(world: World, query: string): Promise<GeoResult[]> {
  if (world.mode === 'free') {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&accept-language=es&q=${encodeURIComponent(query)}`;
    const hits: any[] = await (await fetch(url)).json();
    return hits.map((h) => split(h.display_name, +h.lat, +h.lon));
  }
  const service: GeocoderService =
    world.mode === 'google'
      ? new GoogleGeocoderService({ key: googleKey! })
      : new IonGeocoderService({ scene: world.viewer.scene, geocodeProviderType: IonGeocodeProviderType.GOOGLE });
  const hits = await service.geocode(query);
  return hits.slice(0, 6).map((hit) => {
    const c = hit.destination instanceof Rectangle
      ? Rectangle.center(hit.destination)
      : world.viewer.scene.globe.ellipsoid.cartesianToCartographic(hit.destination as Cartesian3);
    return split(hit.displayName, (c.latitude * 180) / Math.PI, (c.longitude * 180) / Math.PI);
  });
}

function split(displayName: string, lat: number, lng: number): GeoResult {
  const [name, ...rest] = displayName.split(',').map((t) => t.trim());
  return { name, detail: rest.slice(-3).join(', '), lat, lng };
}
