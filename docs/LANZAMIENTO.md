# FlyFly · Guía de lanzamiento

Pasos para publicar FlyFly en un dominio propio, con publicidad y patrocinios, cumpliendo la normativa española y europea.

> Esta guía es orientativa y no sustituye el asesoramiento de un abogado o una gestoría. Revisa con un profesional los textos legales y las obligaciones fiscales antes de lanzar.

## 1. Qué está ya preparado en el código

| Pieza | Dónde | Estado |
|---|---|---|
| Aviso legal, privacidad, cookies y accesibilidad | `public/legal/` | Plantillas: falta rellenar `public/legal/titular.js` y revisarlas |
| Enlaces legales visibles (LSSI) | Pantalla de inicio y Ajustes | Hecho |
| Contenido patrocinado identificado (LSSI art. 20) | Marcadores y fichas: «Patrocinado», enlaces `rel="sponsored"` | Hecho |
| Atribuciones (Google, Wikipedia CC BY-SA, autor y licencia de cada foto, OSM, IGN) | Créditos en pantalla, fichas y Ajustes | Hecho |
| Sin cookies propias; solo `localStorage` necesario | `public/legal/cookies.html` | Hecho |
| Tipografía alojada en la propia web (no se envían IP a Google Fonts) | `@fontsource-variable/outfit` | Hecho |
| Cabeceras de seguridad (CSP, HSTS, antiframe…) | `public/_headers` | Hecho (Cloudflare Pages o Netlify) |
| Sin `eval` en el código (CSP estricta) | Se usa `CesiumWidget` en vez de `Viewer` | Hecho |
| Publicidad AdSense (apagada hasta configurarla) | `src/ads.ts` + hueco en la ficha | Preparado |
| Patrocinadores editables sin backend | `public/data/patrocinadores.json` | Preparado |
| `robots.txt`, `sitemap.xml`, `ads.txt`, Open Graph | Plugin en `vite.config.ts` | Se generan según las variables |
| Imagen para compartir en redes | `public/og-image.jpg` | Hecho |
| Actualizaciones de seguridad de dependencias | `.github/dependabot.yml` | Hecho |

## 2. Alojamiento y dominio propio

GitHub Pages no está pensado para webs comerciales y no aplica las cabeceras de `_headers`. Recomendado: **Cloudflare Pages** (gratuito, permite uso comercial, HTTPS y dominio propio).

1. Compra el dominio (p. ej. en el propio Cloudflare, Namecheap o un registrador español si quieres `.es`).
2. Cloudflare → Workers & Pages → Create → Pages → conecta el repositorio de GitHub.
3. Configuración de compilación:
   - Framework: ninguno
   - Comando: `npm run build`
   - Carpeta de salida: `dist`
   - Variables de entorno: `NODE_VERSION=22`, `VITE_CESIUM_ION_TOKEN` (como secreto) y `VITE_SITE_URL=https://tudominio.es`
4. Custom domains → añade tu dominio. Cloudflare configura el HTTPS solo.
5. En Cesium ion (o Google Cloud) restringe el token o la clave a `https://tudominio.es`.
6. Cuando funcione, desactiva GitHub Pages (Settings → Pages) para no tener dos copias. Puedes borrar `.github/workflows/deploy.yml` o dejarlo para las pruebas.

Netlify sirve igual: también lee `public/_headers`.

## 3. Licencia de los mapas (imprescindible antes de monetizar)

El plan gratuito *Community* de Cesium ion es para uso **no comercial**. Con publicidad o patrocinios el uso es comercial. Dos opciones:

- **Cesium ion comercial**: contrata el plan que corresponda en cesium.com/pricing.
- **Clave propia de Google Maps Platform** (Map Tiles API): pago por uso con una cuota gratuita mensual. Pon la clave en `VITE_GOOGLE_MAPS_API_KEY` y:
  - Restríngela por **sitio web** (tu dominio) y por **API** (solo Map Tiles API y Geocoding API).
  - Crea **alertas de presupuesto** y **cuotas diarias** en Google Cloud para evitar sustos.
  - Mantén visibles el logotipo y las atribuciones de Google (ya lo hace la web) y no descargues ni guardes teselas.

Calcula el coste con el tráfico esperado antes de lanzar campañas.

## 4. Textos legales

1. Rellena `public/legal/titular.js` (nombre o razón social, NIF, domicilio, email y dominio).
2. En `privacidad.html` sustituye `[PROVEEDOR DE ALOJAMIENTO]` por el que uses (p. ej. Cloudflare).
3. Haz que un profesional revise las cuatro páginas y borra el recuadro «Plantilla orientativa».
4. Cambia la fecha de «Última actualización» en `titular.js` cada vez que modifiques los textos.

## 5. Publicidad con Google AdSense

1. Solicita AdSense con tu dominio propio (no funciona en `github.io`). Google revisa que la web tenga contenido y cumpla sus políticas.
2. En AdSense → **Privacidad y mensajes** → crea el mensaje de consentimiento **RGPD** (EEE, Reino Unido y Suiza). Es la plataforma de consentimiento certificada que Google exige; con ella no hace falta otro banner.
3. Crea un bloque de anuncios «Display» adaptable y copia su identificador.
4. Configura las variables (en Cloudflare o en GitHub → Variables):
   - `VITE_ADSENSE_CLIENT=ca-pub-XXXXXXXXXXXXXXXX`
   - `VITE_ADSENSE_SLOT_FICHA=NNNNNNNNNN`
5. Al compilar se genera `ads.txt` automáticamente y aparece un anuncio etiquetado «Publicidad» al final de cada ficha (nunca en las de patrocinadores), como mucho uno nuevo por minuto. En Ajustes aparece «Gestionar cookies».
6. Amplía la política de seguridad: en `public/_headers` sustituye la línea `Content-Security-Policy` por esta y revisa la consola del navegador tras publicar (Google cambia dominios a veces):

```
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://cloud.umami.is https://plausible.io https://static.cloudflareinsights.com https://*.googlesyndication.com https://*.google.com https://*.gstatic.com https://*.doubleclick.net https://*.googletagservices.com https://*.adtrafficquality.google https://fundingchoicesmessages.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' data: blob: https://*.googleapis.com https://*.cesium.com https://*.wikipedia.org https://*.wikimedia.org https://nominatim.openstreetmap.org https://www.ign.es https://tiles.maps.eox.at https://formspree.io https://api.web3forms.com https://formsubmit.co https://overpass-api.de https://overpass.kumi.systems https://cloud.umami.is https://api-gateway.umami.dev https://plausible.io https://static.cloudflareinsights.com https://cloudflareinsights.com https://*.google.com https://*.googlesyndication.com https://*.doubleclick.net https://*.adtrafficquality.google; frame-src https://*.googlesyndication.com https://*.doubleclick.net https://*.google.com https://fundingchoicesmessages.google.com; worker-src 'self' blob:; child-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests
```

## 6. Patrocinios de negocios locales

Sin backend: edita `public/data/patrocinadores.json` y vuelve a publicar.

```json
[
  {
    "id": "o-porto",
    "name": "Restaurante O Porto",
    "lat": 43.3712,
    "lng": -8.3958,
    "description": "Marisco y cocina gallega",
    "image": "patrocinadores/o-porto.jpg",
    "link": "https://www.ejemplo.com/reservas",
    "cta": "Reservar mesa",
    "until": "2026-12-31"
  }
]
```

- Guarda las fotos en `public/patrocinadores/` (se sirven desde tu dominio). Usa solo imágenes cedidas por el negocio, con autorización por escrito.
- `until` es la fecha de fin del patrocinio; después deja de mostrarse solo.
- Se ven desde 3 km, con la etiqueta «Patrocinado» y su botón de acción.

Antes de cobrar:

- **Alta fiscal**: como autónomo (modelos 036/037 y alta en la Seguridad Social) o mediante una sociedad.
- **Facturas con IVA** (21 %) a cada negocio.
- **Contrato o condiciones de patrocinio**: duración, precio, qué incluye (posición, visibilidad, enlace), forma de pago, renovación y baja, y que el negocio garantiza los derechos de las fotos y textos que entrega.
- **Cobro**: transferencia o una pasarela como Stripe (nunca manejes tú datos de tarjetas).

## 7. Vender anuncios

Flujo sin servidor propio: el anunciante envía su solicitud, tú la revisas y la publicas.

1. **Tarifas**: edita `public/data/tarifas.json`. Cada forma de aparecer tiene `precioMes` (en euros, **IVA incluido**, que es lo que exige la ley al vender a particulares; `iva` indica el porcentaje). A empresas y autónomos la página les desglosa la base imponible y el IVA del total. Para la factura: base = total ÷ 1,21. No hay límite de anuncios por tipo: tú decides cuántos aceptas en cada ciudad al revisar las solicitudes. `descuentos` fija el porcentaje por contratar 6 o 12 meses y `oferta` el texto de la oferta vigente (bórralo para quitarla). Precios de lanzamiento: lugar 5 €, globo 12 €, ovni 19 € y avioneta 29 € al mes, 10 % de descuento a 6 meses y 20 % a 12. Quien contrata a precio de lanzamiento lo mantiene mientras renueve sin interrupción, así que puedes subir los precios para los nuevos cuando haya demanda (por ejemplo, cuando haya muchas avionetas u ovnis en una ciudad o cuando tengas cifras de visitas que enseñar) sin enfadar a los primeros. Anota en cada anuncio el precio al que contrató para respetarlo en las renovaciones.
2. **Cobro**: lo más sencillo al principio es cobrar a mano tras aprobar la solicitud, con una factura de Stripe (*Invoices*) o una transferencia, porque así aplicas el descuento por duración y la oferta. Si prefieres enlaces de pago, crea en Stripe un *Payment Link* para cada tarifa y pon su URL en el campo `pago`: la página lo ofrece tras enviar la solicitud, con el email y la referencia del anuncio ya rellenos. Avisa de que el anuncio no se publica hasta revisarlo y que si se rechaza se devuelve el dinero (ya está en las condiciones).
   - **Particulares**: el formulario pregunta si se contrata como empresa o autónomo o como particular. Los particulares tienen 14 días de desistimiento y deben marcar una casilla para pedir que el anuncio se publique antes; la solicitud llega con esa constancia y la fecha (campo `desistimiento`). Guárdala junto a la factura.
3. **Recepción de solicitudes**: llegan directamente al email de `public/legal/titular.js` a través de [FormSubmit](https://formsubmit.co), gratis y sin crear cuenta, con los datos en una tabla y las fotos adjuntas. La primera solicitud que se envíe hará que FormSubmit te mande un correo de activación: ábrelo y confírmalo (hasta entonces no llegan). Después FormSubmit te ofrece un alias aleatorio para no publicar tu email: ponlo en `VITE_FORM_ENDPOINT` como `https://formsubmit.co/ajax/ALIAS`. Si prefieres otro servicio (Formspree, Web3Forms…), pon su URL en `VITE_FORM_ENDPOINT` y añade su dominio a `connect-src` en `public/_headers`. Si el envío falla, la página ofrece mandar la solicitud por email y descargar un archivo con las fotos.
   - Cada solicitud trae sus **palabras clave** (`tags`, para el buscador) y, si es una avioneta, el **texto de la pancarta** (`banner`).
4. **Revisión**: comprueba que el contenido cumple las condiciones para anunciantes, que la ubicación es correcta y que el pago está hecho.
5. **Orden en el buscador**: el buscador del juego muestra primero a los anunciantes que más pagan. Usa el campo `pagado` (euros al mes) de cada anuncio; el script de importación lo rellena con el precio de su tipo y puedes cambiarlo si cobraste otra cifra.
6. **Publicación**: si te llegó el archivo descargado, ejecuta `node scripts/importar-anuncio.mjs solicitud-flyfly-xxx.json`. Si llegó por el servicio de formularios, guarda las fotos en `public/anunciantes/` con los nombres indicados y pega el bloque `anuncio` en `public/data/anunciantes.json`. Haz commit y push.
6. **Caducidad**: el campo `until` retira el anuncio automáticamente al terminar el periodo. Para renovar, cambia la fecha.
7. **Factura** a cada anunciante con IVA.

Textos legales relacionados: `public/legal/condiciones-anunciantes.html` (rellena plazos y devoluciones) y la sección «Si te anuncias en FlyFly» de la política de privacidad (indica el servicio de formularios y la pasarela de pago que uses).

## 7 bis. Estadísticas anónimas (cifras para los anunciantes)

FlyFly puede contar visitas y eventos sin cookies, así que no hace falta pedir consentimiento ni cambiar el aviso de cookies. Activa **uno** de estos servicios con su variable (en GitHub: *Settings → Secrets and variables → Actions → Variables*):

| Servicio | Variable | Coste | Qué mide |
|---|---|---|---|
| **Umami Cloud** (recomendado) | `VITE_UMAMI_ID` = id del sitio | Gratis hasta 100.000 eventos al mes | Visitas y eventos con datos |
| Plausible | `VITE_PLAUSIBLE_DOMAIN` = tu dominio | Desde unos 9 € al mes | Visitas y eventos con datos |
| Cloudflare Web Analytics | `VITE_CF_BEACON` = token | Gratis | Solo visitas (sin eventos) |

Si alojas tu propio Umami o Plausible, indica la URL del script en `VITE_UMAMI_SRC` o `VITE_PLAUSIBLE_SRC` y añade su dominio a `script-src` y `connect-src` en `public/_headers`.

Eventos que se registran (sin datos personales):

- `ciudad`: ciudad visitada y modo de juego.
- `ciudad-completada`: ciudad en la que se han encontrado todos los lugares.
- `anuncio-visto`: un anuncio ha estado a la vista del jugador a menos de 1,5 km (una vez por anuncio y visita a la ciudad).
- `anuncio-ficha`: se ha abierto la ficha de un anuncio.
- `anuncio-clic`: se ha pulsado el botón del anuncio (reservar, comprar…).
- `solicitud-anuncio`: alguien ha enviado una solicitud desde Anúnciate.

Con esto puedes enseñar a un negocio cuántas personas visitan su ciudad en FlyFly y, una vez anunciado, cuántas han visto su anuncio y cuántas han pulsado su botón. Completa en la política de privacidad la línea del servicio de estadísticas que uses.

## 8. Versión para ayuntamientos

FlyFly tiene dos ediciones que salen del mismo código:

- **General** (la que se publica por defecto): cualquier ciudad del mundo, con los lugares de Wikipedia por descubrir, los negocios anunciados y el buscador de locales.
- **De ciudad**, para ofrecer a un ayuntamiento: siempre la misma ciudad, sin buscador de ciudades ni anuncios, con su propia portada y solo los lugares que elija el ayuntamiento. El buscador de locales sigue disponible (lugares del ayuntamiento y locales de OpenStreetMap, sin patrocinados).

Para preparar la edición de una ciudad:

1. Copia `public/ciudades/coruna.json` (ejemplo) con el nombre de la ciudad, por ejemplo `public/ciudades/lugo.json`, y rellena:
   - `name`, `detail`, `lat` y `lng` de la ciudad.
   - `title`, `subtitle` y `start`: textos de la portada y del botón de empezar. `logo`: ruta del escudo o logotipo dentro de `public/` (opcional).
   - `lugares`: los lugares que quiere el ayuntamiento, cada uno con `name`, `lat`, `lng` y `description`, y opcionalmente `text`, `images` (rutas dentro de `public/`), `link` y `wiki` (título de Wikipedia del que tomar la foto y el texto que falten).
   - `wikipedia`: `true` para añadir también los lugares de Wikipedia de la zona, y `ocultar` con los nombres de los que no deban salir.
2. Publica esa edición aparte (otro proyecto de Cloudflare Pages o un *fork* del repositorio con su propio dominio, por ejemplo `flyfly.lugo.es`) con la variable `VITE_CIUDAD=lugo`. El resto de variables (token de Cesium, estadísticas…) funcionan igual.
3. Para probarla en tu ordenador: `VITE_CIUDAD=coruna npm run dev`.

Requisitos habituales de la administración:

- **Accesibilidad obligatoria** (Real Decreto 1112/2018): WCAG 2.1 nivel AA y la declaración de `public/legal/accesibilidad.html`, que debe completar el ayuntamiento.
- **Esquema Nacional de Seguridad** (Real Decreto 311/2022): las administraciones suelen exigirlo a sus proveedores; pregunta qué categoría piden.
- **Factura electrónica** a través de FACe.
- **Contrato** con el ayuntamiento (contrato menor o licitación) y, si tratas datos por su cuenta, un contrato de encargado del tratamiento.

## 9. Marca

- Busca «FlyFly» en la OEPM (España) y la EUIPO (UE) y valora registrarla en las clases 9, 41 y 42.
- No uses nombres, logotipos ni recursos de Nintendo o Wii en la web ni en la promoción.

## 10. Seguridad

- Activa la verificación en dos pasos en GitHub, Cloudflare, Google Cloud, Cesium y AdSense.
- Nunca subas el archivo `.env` (ya está en `.gitignore`). Los tokens van como secretos en GitHub o Cloudflare.
- Restringe cada token o clave a tu dominio (ver apartados 2 y 3).
- Acepta las PR de Dependabot tras comprobar que la web compila.
- Revisa la consola del navegador tras cada cambio de la política de seguridad.

## 11. Lista final antes de lanzar

- [ ] Dominio propio con HTTPS en Cloudflare Pages (o Netlify)
- [ ] Licencia comercial de mapas (Cesium o Google) con alertas de presupuesto
- [ ] Token o clave restringidos al dominio
- [ ] `titular.js` relleno y textos legales revisados por un profesional
- [ ] `VITE_SITE_URL` configurada (Open Graph, sitemap)
- [ ] Alta fiscal hecha si vas a cobrar publicidad o patrocinios
- [ ] AdSense aprobado, mensaje RGPD activo y CSP ampliada (si hay anuncios)
- [ ] Contrato de patrocinio preparado (si hay patrocinadores)
- [ ] Tarifas, enlaces de pago y servicio de formularios configurados (si vendes anuncios)
- [ ] Estadísticas anónimas activadas (Umami, Plausible o Cloudflare) y anotadas en la política de privacidad
- [ ] Condiciones para anunciantes completadas y revisadas
- [ ] Marca comprobada en OEPM y EUIPO
- [ ] Probado en móvil y ordenador con el dominio definitivo
