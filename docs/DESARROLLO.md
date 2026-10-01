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

`VITE_TILE_DETAIL` controla la nitidez de las teselas 3D (16 por defecto; 8 = máxima calidad pero carga más lenta).

> ⚠️ El plan gratuito de Cesium ion es para uso no comercial o de evaluación. Para la versión de ayuntamientos/negocios hará falta un plan comercial de Cesium o una clave de Google con facturación. Las atribuciones de Google/Cesium en pantalla son obligatorias: no las ocultes.

## Controles

| Teclado | Acción |
|---|---|
| ↑ ↓ / W S | avanzar / retroceder |
| ← → | girar |
| A / D | desplazarse de lado |
| Espacio (o R) / Shift (o F) | subir / bajar |
| C | cámara exterior / dron |
| M | silenciar |
| Tab | menú de lugares |
| Esc | cerrar ficha / menú |

En móvil aparecen un joystick y botones táctiles. Se puede hacer clic en cualquier globo para abrir su ficha.

## Lugares de interés

- **Wikipedia en directo**: artículos geolocalizados con foto, en cualquier ciudad del mundo (buscador con Nominatim en modo libre y Google vía Cesium ion en modo 3D).
Al elegir una ciudad se cargan de golpe hasta 80 lugares (centro + anillo de 3,5 km), así el recuento de "por descubrir" es fijo.

Los lugares patrocinados se representan con el campo `sponsor` de `Poi` (`src/pois.ts`) y se muestran como globo dorado con botón de acción. Falta conectar la fuente de datos de patrocinadores (JSON o backend).

## Mecánica de juego

Los globos están ocultos: aparecen a 1 km y se descubren al pasar a menos de 220 m. El progreso se guarda en el navegador (`localStorage`). La brújula señala el lugar sin descubrir más cercano.

## Ovni

`public/models/ufo.glb` se genera con `node scripts/make-ufo.mjs` (formas y colores editables en el script). La física está en `src/flight.ts`: el ovni se mueve como un dron, con inercia suave, y se queda flotando al soltar los mandos.

## Rendimiento del mapa

Para que la ciudad cargue antes, lo lejano se pide con muy poco detalle: niebla más densa (`scene.fog`) y reducción dinámica de detalle hacia el horizonte (`dynamicScreenSpaceError*` en `src/world.ts`). No se usa un recorte de distancia de cámara porque también corta el cielo.

## Estructura

```
src/world.ts    visor Cesium, modo de teselas y geocodificación
src/flight.ts   control del ovni y cámaras
src/pois.ts     carga de lugares, globos y distancias
src/main.ts     HUD, fichas, controles y bucle principal
src/sound.ts    zumbido del ovni y sonido de descubrimiento sintetizados
```
