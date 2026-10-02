# FlyFly · Guía de desarrollo

Instrucciones técnicas para ejecutar, configurar y publicar FlyFly.

## Arrancar

```bash
npm install
cp .env.example .env   # y rellena VITE_CESIUM_ION_TOKEN (ver abajo)
npm run dev
```

## Publicar en GitHub Pages

1. **Settings → Pages → Source:** *GitHub Actions*.
2. **Settings → Secrets and variables → Actions → New repository secret:** `VITE_CESIUM_ION_TOKEN` con tu token.
3. Cada push a `main` compila y publica en `https://<usuario>.github.io/FlyFly/`.

> El token acaba dentro del JavaScript público (es inevitable en una web sin servidor). En Cesium ion, restringe el token a la URL de tu GitHub Pages para que nadie pueda usarlo desde otro sitio.

## Calidad visual (gratis)

| Modo | Qué se ve | Cómo activarlo |
|---|---|---|
| **Fotorrealista vía Cesium ion** (recomendado) | Ciudades en 3D real (Google Photorealistic 3D Tiles), como Google Earth | Crea una cuenta gratuita en [ion.cesium.com](https://ion.cesium.com/tokens), añade el asset *Google Photorealistic 3D Tiles* desde *Asset Depot* y pon el token en `VITE_CESIUM_ION_TOKEN` |
| Fotorrealista con clave de Google | Lo mismo, facturado directamente por Google (con cuota gratuita mensual) | Activa *Map Tiles API* en Google Cloud y usa `VITE_GOOGLE_MAPS_API_KEY` |
| Libre (sin claves) | Ortofoto PNOA del IGN (España, ~25 cm/píxel) y Sentinel-2 en el resto, en plano | Nada |

La calidad del mapa (Alta, Equilibrada o Rápida) se elige en la web, en Ajustes; por defecto se adapta al dispositivo.

> ⚠️ El plan gratuito de Cesium ion es para uso no comercial o de evaluación. Para la versión de ayuntamientos/negocios hará falta un plan comercial de Cesium o una clave de Google con facturación. Las atribuciones de Google/Cesium en pantalla son obligatorias: no las ocultes.

## Controles

| Teclado | Acción |
|---|---|
| ↑ ↓ / W S | avanzar / retroceder |
| ← → | girar |
| A / D | desplazarse de lado |
| Espacio (o R) / Shift (o F) | subir / bajar |
| Arrastrar / rueda (pellizco en móvil) | girar la cámara 360° / acercar-alejar |
| C | cámara exterior / dron |
| Tab | menú de lugares |
| Esc | cerrar ficha / menú |

En móvil aparecen un joystick y botones táctiles. Se puede tocar cualquier marcador descubierto para abrir su ficha.

## Lugares de interés

Artículos geolocalizados de Wikipedia con foto, en cualquier ciudad del mundo. El buscador usa Nominatim (OpenStreetMap) en modo libre y Google (vía Cesium ion o clave propia) en modo 3D, porque las teselas de Google solo pueden usarse con su geocodificador.

## Ediciones (`src/edition.ts`)

- **General** (sin `VITE_CIUDAD`): cualquier ciudad. Se juntan los lugares de Wikipedia por descubrir (todo lo descrito en «Mecánica de juego»), los patrocinadores de `public/data/patrocinadores.json` y los anunciantes de `public/data/anunciantes.json` a menos de 8 km (`src/advertisers.ts`).
- **De ciudad** (`VITE_CIUDAD=<id>`): lee `public/ciudades/<id>.json` (ejemplo: `coruna.json`). Portada propia con un botón de empezar, sin buscador de ciudades, sin anuncios ni botón Anúnciate. Los lugares son los del archivo (ids `c_…`, con foto y texto de Wikipedia si tienen `wiki` y les faltan) y, con `"wikipedia": true`, también los de Wikipedia salvo los de `ocultar`. Ver docs/LANZAMIENTO.md, sección 8.

## Buscador de la ciudad (`src/finder.ts`)

Botón de la lupa en el vuelo: busca «cafeterías», «hotel», «pizza»… Reconoce categorías habituales (`CATEGORIES`, con sus palabras y etiquetas de OpenStreetMap) y, si no, busca por nombre. Resultados:

1. Anunciantes cuyo nombre, frase, texto o `tags` coinciden, del que más paga al que menos (`pagado` o, si falta, `precioMes` de su tipo en `tarifas.json`).
2. En la edición de ciudad, sus lugares que coinciden.
3. Locales de OpenStreetMap a menos de 6 km (Overpass API), por cercanía, sin repetir anunciantes.

Cada resultado muestra foto (si la hay), nombre, descripción, distancia, enlace y un botón «Ir» que teletransporta el ovni.

## Anunciantes

Formas de aparecer (`type`):

| Tipo | Se ve como |
|---|---|
| `lugar` | Tarjeta con foto a 35 m sobre el suelo, como los lugares de turismo |
| `globo` | Globo aerostático (×2,2) con gajos de dos colores y cesta de un tercero, a 160 m, balanceándose |
| `ovni` | Ovni 3 veces mayor que el del jugador, teñido del color elegido, girando a 120 m |
| `avioneta` | Avioneta (×3) del color elegido con una pancarta de 17 × 5 m de otro color, dando vueltas de 350 m de radio a 220 m |

Los modelos del globo y la avioneta se generan en el navegador con el color de cada anunciante (`src/models.ts`). La pancarta lleva el texto de `banner` (o el nombre) dibujado en un canvas y añadido al GLB como textura. Todas las etiquetas muestran «Patrocinado» y un borde del color elegido.

Formato de `public/data/anunciantes.json`:

```json
[
  {
    "id": "hotel-atlantico", "name": "Hotel Atlántico", "type": "globo",
    "lat": 43.3712, "lng": -8.3958, "color": "#d6336c",
    "description": "Vistas al mar en pleno centro", "text": "Texto de la ficha",
    "images": ["anunciantes/hotel-atlantico-1.jpg"],
    "link": "https://ejemplo.com", "cta": "Reservar", "until": "2026-12-31",
    "tags": ["hotel", "alojamiento"], "pagado": 12,
    "color2": "#ffffff", "basket": "#6b4226",
    "banner": "Solo avioneta: texto", "bannerColor": "#ffffff"
  }
]
```

## Página Anúnciate

`anunciate.html` + `src/anunciate.ts` (segunda página del build). El anunciante elige tipo (con las tarifas de `public/data/tarifas.json`), marca la ubicación en un mapa Leaflet con teselas de OpenStreetMap, escribe textos, elige color, sube hasta 3 fotos y ve una vista previa en 3D (`src/preview3d.ts`: visor WebGL mínimo, sin Cesium, que dibuja el globo y la avioneta de `src/models.ts` y el ovni de `models/ufo.glb` con el color elegido y la misma animación que en el juego). Muestra el total según la duración y los descuentos de `tarifas.json`, y a los particulares les pide la casilla de desistimiento. Al enviar:

- La solicitud (JSON + fotos) se envía por `POST multipart` a `VITE_FORM_ENDPOINT` o, si no está, a FormSubmit con el email de `public/legal/titular.js`, y llega a ese correo. Si la tarifa tiene enlace de pago (`pago`), se ofrece pagar.
- Si el envío falla (o no hay email), se ofrece enviarla por email y descargar el archivo de la solicitud con las fotos.

Para publicar una solicitud descargada: `node scripts/importar-anuncio.mjs solicitud-flyfly-xxx.json` (guarda las fotos en `public/anunciantes/` y añade el anuncio a `anunciantes.json`).

## Menú principal y despegue (`src/intro.ts`)

En el menú la Tierra gira despacio y el ovni llega desde lejos y se queda a la derecha (se coloca cada fotograma respecto a la cámara). Al despegar:

1. **Arranque de motores** (mínimo 1,8 s, máximo 9 s): el ovni vibra, gira rápido y destella mientras se piden los lugares, los anunciantes y la altura del suelo.
2. **Carga de la ciudad** (hasta 25 s, aviso «Cargando A Coruña X %»): `IntroScene.prepare` lanza un `camera.flyTo` al destino cuyo avance queda congelado en 0; mientras dura, Cesium descarga las teselas de la vista de destino (`preloadFlightDestinations`). `waitForPreload` (`src/world.ts`) espera a que no quede nada pendiente.
3. **Vuelo** (5 s, 6,5 s desde el espacio): `IntroScene.launch` libera el vuelo hasta la posición de juego a 500 m, con el ovni pasando de la derecha al centro; la ciudad ya está cargada al llegar.
4. **Llegada**: el juego toma el control; los anunciantes se colocan y se terminan los detalles que falten.

Con «reducir movimiento» del sistema no hay vibración ni giro de la Tierra y el vuelo dura 1,5 s.

## Mecánica de juego

Al elegir una ciudad se cargan de golpe hasta 80 lugares de Wikipedia (centro + anillo de 3,5 km), así el recuento es fijo. Cada lugar pasa por estos estados (`src/pois.ts`):

| Distancia al ovni | Estado | Se ve |
|---|---|---|
| > 400 m | oculto | nada (solo la brújula) |
| 400 m - 50 m | misterio | solo el marcador "?" naranja |
| < 50 m | descubierto | tarjeta con foto, nombre y descripción (píldora compacta a más de 700 m) |

Los marcadores son elementos HTML (`#markers`) que se recolocan en cada fotograma con `SceneTransforms.worldToWindowCoordinates`; su altura se mide con `sampleHeightMostDetailed` (35 m sobre el suelo o el tejado).

Ajustes → «Lugares en el mapa» (`PoiLayer.foundVisibility`) se aplica a descubiertos y por descubrir: **cercanos** (por defecto: descubiertos e interrogaciones a menos de 400 m, como en la tabla), **todos** (sin límite de distancia) o **ninguno** (solo la brújula; se siguen descubriendo al llegar). Los patrocinados y los anunciantes se ven siempre.

El progreso se guarda en el navegador (`localStorage`) y se puede reiniciar desde Ajustes. Por ciudad se guardan también la fecha del primer descubrimiento, la de finalización y los km recorridos (`flyfly:cities`), que se muestran en la pantalla de ciudad completada.

## Viajes, ciudad completada y piloto automático (`src/main.ts`)

- **Viajar** (botón «Viajar aquí» de la ficha, que se abre al pulsar un lugar del menú): animación de teletransporte de 2 a 4 s mientras se mide el terreno y cargan las teselas; el ovni aparece 150 m al sur del lugar.
- **Ciudad completada**: pantalla con confeti, lugares, tiempo desde el primer descubrimiento y km recorridos, botón de compartir (Web Share API o copiar enlace) y acceso a la exploración automática.
- **Exploración automática**: disponible siempre que la ciudad esté completa (botón en la barra superior). Empieza en un lugar al azar y vuela en línea recta al más cercano no visitado, a 110 m sobre el suelo, con una pausa de 2,5 s en cada uno. Cualquier mando manual la detiene.

Los lugares patrocinados se representan con el campo `sponsor` de `Poi`: se ven desde 3 km, con borde ámbar, la etiqueta "Patrocinado" y un botón de acción (`rel="sponsored"`). Falta conectar la fuente de datos de patrocinadores (JSON o backend).

## Altitud

Las teselas 3D usan alturas elipsoidales (WGS84). Para mostrar la altitud sobre el nivel del mar se resta la ondulación del geoide EGM96, interpolada de `public/data/geoid-egm96-1deg.bin` (malla de 1°, 130 KB, error medio ~0,2 m). Se regenera con `node scripts/make-geoid.mjs` (usa el paquete `egm96-universal`, solo en desarrollo).

## Calidad y carga del mapa

En Ajustes: Rápida (detalle 28, sin antialiasing), Equilibrada (16) y Alta (8, resolución nativa). Por defecto Rápida en móviles y equipos con 4 núcleos o menos. Además (`src/world.ts`): hasta 36 descargas simultáneas por servidor (HTTP/2), carga progresiva de baja resolución primero, y menos detalle hacia el horizonte (niebla y `dynamicScreenSpaceError`).

## Atribuciones

Obligatorias y ya integradas: créditos de Google/Cesium en pantalla (no ocultarlos), autor y licencia de cada foto en su ficha (API de Wikimedia), licencia CC BY-SA del texto de Wikipedia y un diálogo de "Créditos y fuentes de datos" en Ajustes.

## Ovni

`public/models/ufo.glb` se genera con `node scripts/make-ufo.mjs` (formas y colores editables en el script). La física está en `src/flight.ts`: el ovni se mueve como un dron, con inercia suave, y se queda flotando al soltar los mandos. Su altura se mantiene entre 20 y 500 m sobre lo que tiene debajo (suelo o tejados). Al llegar a una ciudad aparece a 500 m (vista general); al viajar a un lugar, a 120 m. Al arrastrar en horizontal cambia el rumbo, así que "adelante" es siempre hacia donde mira la cámara.

## Rendimiento del mapa

Para que la ciudad cargue antes, lo lejano se pide con muy poco detalle: niebla más densa (`scene.fog`) y reducción dinámica de detalle hacia el horizonte (`dynamicScreenSpaceError*` en `src/world.ts`). No se usa un recorte de distancia de cámara porque también corta el cielo.

## Estructura

```
src/world.ts    visor Cesium, modo de teselas, calidad y geocodificación
src/flight.ts   control del ovni y cámaras
src/pois.ts     lugares de Wikipedia, descubrimiento y marcadores HTML
src/intro.ts    menú principal animado (la Tierra girando, el ovni) y vuelo desde el espacio hasta la ciudad
src/main.ts     interfaz (inicio, carga, ficha, menú, ajustes), controles y bucle principal
src/geoid.ts    altitud sobre el nivel del mar (geoide EGM96)
src/icons.ts    iconos Phosphor usados en la interfaz
src/ads.ts      publicidad AdSense (apagada si no hay VITE_ADSENSE_CLIENT)
src/advertisers.ts  anunciantes (lugar, globo, ovni, avioneta)
src/models.ts   modelos 3D de globo y avioneta generados con el color de cada anunciante
src/anunciate.ts página Anúnciate (formulario, mapa, vista previa y envío)
src/preview3d.ts vista previa 3D de los anuncios en la página Anúnciate
src/finder.ts   buscador de negocios y locales de la ciudad
src/edition.ts  edición general o de ciudad (VITE_CIUDAD)
public/ciudades/ configuración de cada edición de ciudad
src/analytics.ts estadísticas anónimas sin cookies (Umami, Plausible o Cloudflare; apagadas si no hay variable)
scripts/importar-anuncio.mjs  publica una solicitud descargada
public/legal/   aviso legal, privacidad, cookies y accesibilidad (datos del titular en titular.js)
public/_headers cabeceras de seguridad para Cloudflare Pages o Netlify
public/data/patrocinadores.json  negocios patrocinados
src/sound.ts    zumbido del ovni y sonido de descubrimiento (desactivado: ver comentarios "Sonido" en main.ts)
```

Para publicar en un dominio propio con publicidad y patrocinios, sigue [LANZAMIENTO.md](LANZAMIENTO.md).
