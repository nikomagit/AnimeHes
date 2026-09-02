# AMOKIN para Nuvio/Stremio

AMOKIN es un addon de reproducción directa. Para anime conserva [AnimeAV1](https://animeav1.com/), [Hentaila](https://hentaila.com/) y [JKAnime](https://jkanime.net/); para películas y series utiliza [Cuevana](https://cuevana3l.biz/) y [LaMovie](https://lamovie.org/) únicamente como proveedores de streams. Los únicos catálogos anunciados siguen siendo los tres de Hentaila.

El manifest incluye el logo oficial del addon en `/logo.jpg`.

No usa torrents, magnet links, `infoHash`, P2P, TorBox, Real-Debrid ni descargas locales. El manifest declara `p2p: false`.

> Los sitios y hosts de vídeo son servicios de terceros. Usa el proyecto solo donde el contenido y el acceso estén permitidos, y respeta sus términos y la legislación aplicable. El addon no evita autenticación, CAPTCHA, DRM, protecciones anti-bot ni restricciones de acceso.

## Instalación pública

Agrega este manifest en Nuvio o Stremio:

```text
https://amokin.onrender.com/manifest.json
```

El plan gratuito de Render puede suspender el servidor por inactividad. La primera solicitud después de una pausa puede tardar mientras la instancia despierta; las siguientes deberían responder normalmente.

## Catálogos

- `hentaila-popular`: Hentaila — Populares.
- `hentaila-airing`: Hentaila — Al aire.
- `hentaila-uncensored`: Hentaila — Sin Censura, usando el filtro oficial ordenado por popularidad.

Todos aceptan `skip` y traducen el desplazamiento a la página correspondiente del proveedor. Cada ficha usa un ID estable con el formato `amokin:{proveedor}:{slug}`; los episodios añaden `:{episodio}`.

## Funciones principales

- Endpoints estándar `catalog`, `meta` y `stream` del protocolo Stremio.
- Catálogos con póster, fondo, descripción, año, géneros, estado y episodios cuando la fuente los ofrece.
- Búsqueda de streams mediante IDs IMDb, TMDB y Kitsu.
- Matching prioritario por IMDb/TMDB cuando el proveedor publica identidad externa; títulos, alias, año y tipo quedan como fallback conservador.
- Cuevana permite localizar por TMDB numérico y confirma ese ID en sus reproductores; LaMovie verifica TMDB mediante `show_id` o sus embeds públicos.
- Títulos originales, ingleses, españoles, localizados y alternativos se consultan cuando los metadatos los proporcionan.
- Resolución de temporadas separadas: convierte una petición como `temporada 3, episodio 1` en la entrada independiente correcta del proveedor.
- AnimeAV1: HLS y MP4Upload actualmente compatibles; funciona solo como proveedor de streams.
- Hentaila: VIP/HLS, YourUpload y MP4Upload actualmente compatibles.
- JKAnime: reproductores públicos UM/UMV que exponen HLS directo; funciona solo como proveedor de streams.
- Cuevana: utiliza exclusivamente Trinity. Si Trinity no está disponible o su playlist no supera la validación, Cuevana no entrega un stream para ese contenido.
- LaMovie: usa su API pública de búsqueda, temporadas, episodios y embeds; solo procesa reproductores HTTP y nunca sus campos de descarga.
- Headers de reproducción en `behaviorHints.proxyHeaders` cuando el host los necesita.
- Deduplicación por URL final y aislamiento de errores: una caída de un proveedor no bloquea a los demás.
- Caché temporal independiente para búsquedas, catálogos, metadatos y páginas de contenido.
- Timeouts, límite de respuesta, validación de slugs/dominios y degradación segura a listas vacías.

No se inventan calidades. Cuando el servidor no publica una resolución fiable, el resultado se identifica por servidor y tipo (HLS o MP4).

## Endpoints

```text
GET /health
GET /manifest.json
GET /catalog/series/{catalogId}.json
GET /catalog/series/{catalogId}/skip=20.json
GET /meta/{type}/amokin:{provider}:{slug}.json
GET /stream/{type}/{id}.json
```

Ejemplos de IDs de stream admitidos:

```text
/stream/movie/tt1234567.json
/stream/series/tt1234567:1:2.json
/stream/movie/tmdb:12345.json
/stream/series/tmdb:12345:1:2.json
/stream/series/kitsu:12345:2.json
/stream/series/amokin:animeav1:slug:2.json
/stream/series/amokin:hentaila:slug:2.json
/stream/series/amokin:jkanime:slug:2.json
```

Los dos últimos segmentos de IMDb/TMDB son temporada y episodio. En Kitsu, el último segmento es el episodio. Los IDs `amokin:` nacen de los catálogos y no necesitan consultar un servicio externo de metadatos.

Cuando un proveedor publica cada temporada como un título independiente, AMOKIN utiliza el nombre ordinal, año de estreno, categoría y cantidad de episodios de la temporada. Si no existe evidencia suficiente para identificarla, devuelve cero streams antes que reproducir una temporada incorrecta.

## Ejecución local

Requisitos: Node.js 20 o superior y npm.

```bash
npm install
npm run build
npm start
```

El servidor queda en `http://127.0.0.1:7100`. Para desarrollo con recarga automática usa `npm run dev`.

Instala localmente:

```text
http://127.0.0.1:7100/manifest.json
```

No necesitas `.env` ni claves privadas para IMDb, TMDB, Kitsu o los IDs internos. Cinemeta y el addon público TMDB permiten convertir IDs cuando publican `moviedb_id`/`imdb_id`. Opcionalmente, configura `TMDB_API_KEY` como secreto del servidor para añadir títulos localizados y alternativos directamente desde TMDB; la clave nunca debe entrar al repositorio.

## Configuración

Copia `.env.example` como `.env` solo si necesitas cambiar valores. `.env` está excluido de Git.

| Variable | Predeterminado | Uso |
|---|---:|---|
| `HOST` | `0.0.0.0` | Interfaz de escucha. |
| `PORT` | `7100` | Puerto HTTP. |
| `ANIMEAV1_BASE_URL` | `https://animeav1.com` | Origen público de AnimeAV1. |
| `ANIMEAV1_CDN_BASE_URL` | `https://cdn.animeav1.com` | Imágenes de AnimeAV1. |
| `HENTAILA_BASE_URL` | `https://hentaila.com` | Origen público de Hentaila. |
| `HENTAILA_CDN_BASE_URL` | `https://cdn.hentaila.com` | Imágenes de Hentaila. |
| `JKANIME_BASE_URL` | `https://jkanime.net` | Origen público de JKAnime. |
| `CUEVANA_BASE_URL` | `https://cuevana3l.biz` | Origen público de Cuevana. |
| `LAMOVIE_BASE_URL` | `https://lamovie.org` | API/origen público de LaMovie. |
| `METADATA_BASE_URL` | `https://v3-cinemeta.strem.io` | Metadatos públicos para IMDb. |
| `METADATA_FALLBACK_BASE_URL` | addon TMDB público | Metadatos públicos para IDs TMDB. |
| `TMDB_API_KEY` | vacío | Clave opcional y privada para enriquecer aliases y convertir IDs si el servicio público falla. |
| `TMDB_BASE_URL` | `https://api.themoviedb.org/3` | API oficial TMDB usada solo cuando existe una clave. |
| `TMDB_LANGUAGE` | `es-ES` | Idioma localizado solicitado a TMDB. |
| `REQUEST_TIMEOUT_MS` | `10000` | Timeout de proveedores y hosts. |
| `CATALOG_CACHE_TTL_MS` | `900000` | Caché de catálogos (15 min). |
| `SEARCH_CACHE_TTL_MS` | `60000` | Caché de búsqueda. |
| `MEDIA_CACHE_TTL_MS` | `21600000` | Caché de fichas (6 h). |
| `MAX_STREAMS` | `8` | Máximo total de streams. |
| `MIN_MATCH_SCORE` | `0.72` | Umbral conservador de matching. |

Nunca publiques cookies ni URLs temporales de vídeo en el repositorio o los logs.

## Docker

```bash
docker compose up -d --build
```

O directamente:

```bash
docker build -t amokin .
docker run --rm -p 7100:7100 -e PORT=7100 amokin
```

El procedimiento para Render, Koyeb y un VPS está en [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). GitHub Pages no sirve porque el addon necesita un proceso Node.js activo para consultar los proveedores y resolver URLs temporales.

## Arquitectura

```text
Nuvio / Stremio
  ├─ /catalog → proveedor → página pública → metas normalizadas
  ├─ /meta    → ID amokin → ficha y episodios del proveedor
  └─ /stream
       ├─ ID amokin → proveedor conocido
       └─ IMDb/TMDB/Kitsu → metadatos y alias → proveedores en orden prioritario
            → matching y episodio → resolvers HTTP → deduplicación
```

- `src/providers/svelte/`: cliente compartido para los datos públicos SvelteKit.
- `src/providers/animeav1/`, `src/providers/hentaila/` y `src/providers/jkanime/`: configuración aislada por proveedor.
- `src/providers/cuevana/` y `src/providers/lamovie/`: clientes de películas y series, sin catálogos.
- `src/providers/general/`: claves estructuradas de temporada/episodio y resolvers seguros de Trinity y Vimeos.
- `src/providers/resolvers.ts`: resolvers directos compartidos y específicos.
- `src/metadata/`: IDs externos e internos y consultores de metadatos.
- `src/services/`: catálogos, fichas, matching y búsqueda multi-proveedor.
- `src/lib/`: HTTP limitado, caché y decodificación segura de datos.
- `src/app.ts`: rutas Fastify y respuestas del protocolo.

Las URLs de vídeo se resuelven al pedir streams porque algunas caducan. AMOKIN no almacena ni retransmite el vídeo: el reproductor solicita directamente la URL indicada con los headers declarados.

## Desarrollo y verificación

```bash
npm run typecheck
npm test
npm run build
npm run validate:live
```

Los tests cubren los tres catálogos públicos, manifest, IDs internos y externos sin secretos, búsqueda, temporadas separadas, episodios, uso exclusivo de Trinity en Cuevana, clientes generales, validación de dominios, resolvers, deduplicación, aislamiento y endpoints HTTP. La prueba real reproducible está en `scripts/validate-live.ts`. Consulta [docs/RESEARCH.md](docs/RESEARCH.md) para las comprobaciones en vivo y decisiones técnicas.

## Referencias

- [NuvioMobile](https://github.com/NuvioMedia/NuvioMobile)
- [Protocolo de addons de Stremio](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md)
- [Esquema oficial de Stream](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/stream.md)
- [AnimeAV1](https://animeav1.com/)
- [Hentaila](https://hentaila.com/)
- [JKAnime](https://jkanime.net/)
- [Cuevana](https://cuevana3l.biz/)
- [LaMovie](https://lamovie.org/)

## Licencia

MIT. El proyecto no está afiliado con Nuvio, Stremio, ninguno de los proveedores mencionados ni los hosts de vídeo.
