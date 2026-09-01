# AnimeHes para Nuvio/Stremio

AnimeHes es un addon de reproducción directa con dos proveedores independientes: [AnimeAV1](https://animeav1.com/) y [Hentaila](https://hentaila.com/). Incluye catálogos navegables, metadatos de series y episodios, búsqueda por IDs externos y streams HTTP/HTTPS.

No usa torrents, magnet links, `infoHash`, P2P, TorBox, Real-Debrid ni descargas locales. El manifest declara `p2p: false`.

> Los sitios y hosts de vídeo son servicios de terceros. Usa el proyecto solo donde el contenido y el acceso estén permitidos, y respeta sus términos y la legislación aplicable. El addon no evita autenticación, CAPTCHA, DRM, protecciones anti-bot ni restricciones de acceso.

## Instalación pública

Agrega este manifest en Nuvio o Stremio:

```text
https://animehes.onrender.com/manifest.json
```

El plan gratuito de Render puede suspender el servidor por inactividad. La primera solicitud después de una pausa puede tardar mientras la instancia despierta; las siguientes deberían responder normalmente.

## Catálogos

- `animeav1-popular`: AnimeAV1 — Populares.
- `animeav1-airing`: AnimeAV1 — Al aire.
- `hentaila-popular`: Hentaila — Populares.
- `hentaila-airing`: Hentaila — Al aire.
- `hentaila-uncensored`: Hentaila — Sin Censura, usando el filtro oficial ordenado por popularidad.

Todos aceptan `skip` y traducen el desplazamiento a la página correspondiente del proveedor. Cada ficha usa un ID estable con el formato `animehes:{proveedor}:{slug}`; los episodios añaden `:{episodio}`.

## Funciones principales

- Endpoints estándar `catalog`, `meta` y `stream` del protocolo Stremio.
- Catálogos con póster, fondo, descripción, año, géneros, estado y episodios cuando la fuente los ofrece.
- Búsqueda de streams mediante IDs IMDb, TMDB y Kitsu.
- Matching tolerante con títulos originales, alternativos, japoneses e ingleses, con año como señal adicional.
- AnimeAV1: HLS y MP4Upload actualmente compatibles.
- Hentaila: VIP/HLS, YourUpload y MP4Upload actualmente compatibles.
- Headers de reproducción en `behaviorHints.proxyHeaders` cuando el host los necesita.
- Deduplicación por URL final y aislamiento de errores: una caída de un proveedor no bloquea al otro.
- Caché temporal independiente para búsquedas, catálogos, metadatos y páginas de contenido.
- Timeouts, límite de respuesta, validación de slugs/dominios y degradación segura a listas vacías.

No se inventan calidades. Cuando el servidor no publica una resolución fiable, el resultado se identifica por servidor y tipo (HLS o MP4).

## Endpoints

```text
GET /health
GET /manifest.json
GET /catalog/series/{catalogId}.json
GET /catalog/series/{catalogId}/skip=20.json
GET /meta/{type}/animehes:{provider}:{slug}.json
GET /stream/{type}/{id}.json
```

Ejemplos de IDs de stream admitidos:

```text
/stream/movie/tt1234567.json
/stream/series/tt1234567:1:2.json
/stream/movie/tmdb:12345.json
/stream/series/tmdb:12345:1:2.json
/stream/series/kitsu:12345:2.json
/stream/series/animehes:animeav1:slug:2.json
/stream/series/animehes:hentaila:slug:2.json
```

Los dos últimos segmentos de IMDb/TMDB son temporada y episodio. En Kitsu, el último segmento es el episodio. Los IDs `animehes:` nacen de los catálogos y no necesitan consultar un servicio externo de metadatos.

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

No necesitas `.env` para IMDb, Kitsu o los IDs internos. TMDB requiere una clave o token del usuario.

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
| `TMDB_API_KEY` | vacío | Clave v3 opcional de TMDB. |
| `TMDB_READ_ACCESS_TOKEN` | vacío | Token v4 opcional, alternativo. |
| `REQUEST_TIMEOUT_MS` | `10000` | Timeout de proveedores y hosts. |
| `CATALOG_CACHE_TTL_MS` | `900000` | Caché de catálogos (15 min). |
| `SEARCH_CACHE_TTL_MS` | `60000` | Caché de búsqueda. |
| `MEDIA_CACHE_TTL_MS` | `21600000` | Caché de fichas (6 h). |
| `MAX_STREAMS` | `8` | Máximo total de streams. |
| `MIN_MATCH_SCORE` | `0.72` | Umbral conservador de matching. |

Nunca publiques claves, tokens, cookies ni URLs temporales de vídeo en el repositorio o los logs.

## Docker

```bash
docker compose up -d --build
```

O directamente:

```bash
docker build -t animehes .
docker run --rm -p 7100:7100 -e PORT=7100 animehes
```

El procedimiento para Render, Koyeb y un VPS está en [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). GitHub Pages no sirve porque el addon necesita un proceso Node.js activo para consultar los proveedores y resolver URLs temporales.

## Arquitectura

```text
Nuvio / Stremio
  ├─ /catalog → proveedor → página pública → metas normalizadas
  ├─ /meta    → ID animehes → ficha y episodios del proveedor
  └─ /stream
       ├─ ID animehes → proveedor conocido
       └─ IMDb/TMDB/Kitsu → metadatos y alias → búsqueda paralela
            → matching y episodio → resolvers HTTP → deduplicación
```

- `src/providers/svelte/`: cliente compartido para los datos públicos SvelteKit.
- `src/providers/animeav1/` y `src/providers/hentaila/`: configuración aislada por proveedor.
- `src/providers/resolvers.ts`: resolvers directos compartidos y específicos.
- `src/metadata/`: IDs externos e internos y consultores de metadatos.
- `src/services/`: catálogos, fichas, matching y búsqueda multi-proveedor.
- `src/lib/`: HTTP limitado, caché y decodificación segura de datos.
- `src/app.ts`: rutas Fastify y respuestas del protocolo.

Las URLs de vídeo se resuelven al pedir streams porque algunas caducan. AnimeHes no almacena ni retransmite el vídeo: el reproductor solicita directamente la URL indicada con los headers declarados.

## Desarrollo y verificación

```bash
npm run typecheck
npm test
npm run build
```

Los tests cubren los cinco catálogos, filtros y paginación, manifest, IDs internos y externos, búsqueda, episodios, resolvers, deduplicación, aislamiento de fallos y endpoints HTTP. Consulta [docs/RESEARCH.md](docs/RESEARCH.md) para las comprobaciones en vivo y decisiones técnicas.

## Referencias

- [NuvioMobile](https://github.com/NuvioMedia/NuvioMobile)
- [Protocolo de addons de Stremio](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md)
- [Esquema oficial de Stream](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/stream.md)
- [AnimeAV1](https://animeav1.com/)
- [Hentaila](https://hentaila.com/)

## Licencia

MIT. El proyecto no está afiliado con Nuvio, Stremio, AnimeAV1, Hentaila ni los hosts de vídeo.
