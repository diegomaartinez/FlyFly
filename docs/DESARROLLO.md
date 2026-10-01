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

## Mecánica de juego

Al elegir una ciudad se cargan de golpe hasta 80 lugares de Wikipedia (centro + anillo de 3,5 km), así el recuento es fijo. Cada lugar pasa por estos estados (`src/pois.ts`):

| Distancia al ovni | Estado | Se ve |
|---|---|---|
| > 1,2 km | oculto | nada (solo la brújula) |
| 1,2 km - 500 m | misterio | marcador "?" + haz de luz naranja |
| 500 - 250 m | cerca | tarjeta con la foto desenfocada y la distancia |
| < 250 m | descubierto | tarjeta con foto, nombre y descripción (píldora compacta a más de 700 m) |

Los marcadores son elementos HTML (`#markers`) que se recolocan en cada fotograma con `SceneTransforms.worldToWindowCoordinates`; su altura se mide con `sampleHeightMostDetailed` (35 m sobre el suelo o el tejado). Los haces de luz son polilíneas de Cesium y se excluyen al medir alturas.

El progreso se guarda en el navegador (`localStorage`) y se puede reiniciar desde Ajustes.

Los lugares patrocinados se representan con el campo `sponsor` de `Poi`: se ven desde 3 km, con borde ámbar, la etiqueta "Patrocinado" y un botón de acción (`rel="sponsored"`). Falta conectar la fuente de datos de patrocinadores (JSON o backend).

## Altitud

Las teselas 3D usan alturas elipsoidales (WGS84). Para mostrar la altitud sobre el nivel del mar se resta la ondulación del geoide EGM96, interpolada de `public/data/geoid-egm96-1deg.bin` (malla de 1°, 130 KB, error medio ~0,2 m). Se regenera con `node scripts/make-geoid.mjs` (usa el paquete `egm96-universal`, solo en desarrollo).

## Calidad y carga del mapa

En Ajustes: Rápida (detalle 28, sin antialiasing), Equilibrada (16) y Alta (8, resolución nativa). Por defecto Rápida en móviles y equipos con 4 núcleos o menos. Además (`src/world.ts`): hasta 36 descargas simultáneas por servidor (HTTP/2), carga progresiva de baja resolución primero, y menos detalle hacia el horizonte (niebla y `dynamicScreenSpaceError`).

## Atribuciones

Obligatorias y ya integradas: créditos de Google/Cesium en pantalla (no ocultarlos), autor y licencia de cada foto en su ficha (API de Wikimedia), licencia CC BY-SA del texto de Wikipedia y un diálogo de "Créditos y fuentes de datos" en Ajustes.

## Ovni

`public/models/ufo.glb` se genera con `node scripts/make-ufo.mjs` (formas y colores editables en el script). La física está en `src/flight.ts`: el ovni se mueve como un dron, con inercia suave, y se queda flotando al soltar los mandos. Su altura se mantiene entre 20 y 500 m sobre lo que tiene debajo (suelo o tejados). Al arrastrar en horizontal cambia el rumbo, así que "adelante" es siempre hacia donde mira la cámara.

## Rendimiento del mapa

Para que la ciudad cargue antes, lo lejano se pide con muy poco detalle: niebla más densa (`scene.fog`) y reducción dinámica de detalle hacia el horizonte (`dynamicScreenSpaceError*` en `src/world.ts`). No se usa un recorte de distancia de cámara porque también corta el cielo.

## Estructura

```
src/world.ts    visor Cesium, modo de teselas, calidad y geocodificación
src/flight.ts   control del ovni y cámaras
src/pois.ts     lugares de Wikipedia, descubrimiento, marcadores HTML y haces de luz
src/main.ts     interfaz (inicio, carga, ficha, menú, ajustes), controles y bucle principal
src/geoid.ts    altitud sobre el nivel del mar (geoide EGM96)
src/icons.ts    iconos Phosphor usados en la interfaz
src/ads.ts      publicidad AdSense (apagada si no hay VITE_ADSENSE_CLIENT)
public/legal/   aviso legal, privacidad, cookies y accesibilidad (datos del titular en titular.js)
public/_headers cabeceras de seguridad para Cloudflare Pages o Netlify
public/data/patrocinadores.json  negocios patrocinados
src/sound.ts    zumbido del ovni y sonido de descubrimiento (desactivado: ver comentarios "Sonido" en main.ts)
```

Para publicar en un dominio propio con publicidad y patrocinios, sigue [LANZAMIENTO.md](LANZAMIENTO.md).
