# AnimeHes para Nuvio

AnimeHes es un addon de streams compatible con Nuvio y con el protocolo de addons de Stremio. Busca el título solicitado en Hentaila, selecciona el episodio y devuelve fuentes HTTP/HTTPS reproducibles directamente.

Esta variante es independiente del addon anterior: no usa Sukebei, torrents, magnet links, `infoHash`, P2P, TorBox, Real-Debrid ni descargas locales. Su único proveedor de contenido es Hentaila.

> El sitio y los hosts de vídeo son servicios de terceros. Usa el proyecto solo donde el contenido y el acceso estén permitidos, y respeta sus términos y la legislación aplicable. El addon no evita autenticación, CAPTCHA, protecciones anti-bot ni restricciones de acceso.

## Qué incluye

- Endpoint estándar `GET /stream/{type}/{id}.json`.
- IDs IMDb, TMDB y Kitsu.
- Matching tolerante con títulos originales, alternativos, japoneses, ingleses y año.
- Selección exacta de episodio para series.
- Fuentes verificadas actualmente: VIP (HLS), YourUpload (MP4) y MP4Upload (MP4).
- Encabezados de reproducción en `behaviorHints.proxyHeaders`, que Nuvio puede aplicar al reproductor.
- Caché en memoria, timeouts, límites de respuesta, deduplicación y tolerancia a fuentes incompletas.
- Tests, Docker, Docker Compose y configuración para Render.
- Manifest marcado explícitamente como contenido adulto y `p2p: false`.

No se inventan resoluciones: si el host no anuncia una calidad fiable, el stream se identifica como HLS o MP4.

## Requisitos

- Node.js 20 o superior y npm; o Docker.
- Acceso permitido desde el servidor a `hentaila.com` y a sus hosts de vídeo.
- Una clave de TMDB solo si Nuvio envía IDs con prefijo `tmdb:`. IMDb y Kitsu no requieren esa clave.

## Ejecución local

```bash
npm install
npm run build
npm start
```

El servidor queda en `http://127.0.0.1:7100`. No es obligatorio crear un `.env` para utilizar IMDb o Kitsu.

Para desarrollo con recarga automática:

```bash
npm run dev
```

Comprobaciones rápidas:

```text
http://127.0.0.1:7100/health
http://127.0.0.1:7100/manifest.json
```

## Configuración

Copia `.env.example` como `.env` únicamente si necesitas cambiar valores:

```powershell
Copy-Item .env.example .env
```

En macOS o Linux:

```bash
cp .env.example .env
```

Variables principales:

| Variable | Predeterminado | Uso |
|---|---:|---|
| `HOST` | `0.0.0.0` | Interfaz de escucha. |
| `PORT` | `7100` | Puerto HTTP del addon. |
| `TMDB_API_KEY` | vacío | Clave v3 opcional de TMDB. |
| `TMDB_READ_ACCESS_TOKEN` | vacío | Token v4 opcional, alternativo a la clave v3. |
| `TMDB_LANGUAGE` | `en-US` | Idioma solicitado a TMDB. |
| `REQUEST_TIMEOUT_MS` | `10000` | Timeout para Hentaila y hosts de vídeo. |
| `MIN_MATCH_SCORE` | `0.72` | Umbral conservador de coincidencia. |
| `MAX_STREAMS` | `3` | Máximo de fuentes devueltas. |

Nunca publiques una clave real en Git. `.env` está excluido mediante `.gitignore`.

## Instalar en Nuvio

Con Nuvio en el mismo PC, agrega esta URL de manifest:

```text
http://127.0.0.1:7100/manifest.json
```

Luego abre un título compatible y selecciona una fuente que empiece por `AnimeHes`.

Desde otro equipo de la red local, usa la IP privada del PC servidor, por ejemplo:

```text
http://192.168.1.50:7100/manifest.json
```

En ese caso el proceso debe seguir ejecutándose y el firewall de Windows debe permitir TCP 7100 en la red privada. Para acceder desde Internet utiliza un despliegue HTTPS; no expongas el puerto doméstico sin TLS y controles de red adecuados.

### Formatos de ID aceptados

```text
/stream/movie/tt1234567.json
/stream/series/tt1234567:1:2.json
/stream/movie/tmdb:12345.json
/stream/series/tmdb:12345:1:2.json
/stream/series/kitsu:12345:2.json
```

Los dos últimos segmentos de IMDb/TMDB son temporada y episodio. En Kitsu, el último segmento es el número de episodio.

## Docker

```bash
docker compose up -d --build
```

Para habilitar TMDB, define `TMDB_API_KEY` o `TMDB_READ_ACCESS_TOKEN` en un archivo `.env` situado junto a `docker-compose.yml` antes de ejecutar Compose.

También puedes usar Docker directamente:

```bash
docker build -t animehes .
docker run --rm -p 7100:7100 -e PORT=7100 animehes
```

## Despliegue remoto

El método recomendado es desplegar el `Dockerfile` como un Web Service gratuito de Koyeb. Koyeb proporciona un dominio HTTPS público y el addon no necesita disco persistente. El repositorio también incluye `render.yaml` como alternativa para Render. El procedimiento completo está en [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

GitHub Pages no puede ejecutar este addon porque Pages sirve archivos estáticos y aquí se necesita un proceso Node.js que consulta metadatos y resuelve URLs temporales en cada petición. Sí puedes guardar el código en GitHub y desplegarlo desde allí en Koyeb, Render, un VPS u otro servicio compatible con contenedores.

## Arquitectura

```text
Nuvio /stream
  -> parser de ID (IMDb, TMDB o Kitsu)
  -> proveedor de metadatos y alias
  -> búsqueda pública de Hentaila
  -> matching conservador de título y año
  -> selección de episodio
  -> resolvers directos (VIP / YourUpload / MP4Upload)
  -> { streams: [{ url, type, behaviorHints }] }
```

El código está separado para que otros proveedores pudieran añadirse después, pero esta versión registra exclusivamente Hentaila:

- `src/metadata/`: interpretación de IDs y metadatos.
- `src/providers/hentaila/`: cliente y resolvers de vídeo.
- `src/services/`: matching y orquestación.
- `src/lib/`: HTTP limitado, caché y decodificación segura de datos públicos.
- `src/app.ts`: endpoints Fastify.

Las URLs de vídeo se resuelven al pedir streams porque algunas pueden caducar. El addon no almacena ni retransmite el vídeo: Nuvio lo solicita directamente al host indicado usando los headers declarados.

## Desarrollo y verificación

```bash
npm run typecheck
npm test
npm run build
```

Los tests cubren IDs, decodificación de datos, parsing de Hentaila, matching, selección de episodios, resolvers, deduplicación y endpoints HTTP.

## Respuestas y errores

- Sin coincidencia, episodio inexistente o metadatos no disponibles: `{ "streams": [] }`.
- Un espejo caído no elimina los demás; cada resolver se ejecuta de forma independiente.
- Los requests remotos tienen timeout y tamaño máximo.
- Solo se aceptan slugs y dominios esperados, y solo URLs finales HTTP/HTTPS de hosts explícitamente permitidos.
- Cambios incompatibles en el sitio producen cero fuentes en vez de devolver URLs dudosas.

## Referencias

- [Repositorio oficial de Nuvio](https://github.com/NuvioMedia/NuvioMobile)
- [Protocolo de addons de Stremio](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md)
- [Esquema oficial de Stream](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/stream.md)
- [Proyecto de AnimeFLV usado solo como referencia conceptual](https://github.com/Pigamer37/animeflv-stremio-addon)
- [Hentaila](https://hentaila.com/)

Consulta [docs/RESEARCH.md](docs/RESEARCH.md) para el análisis técnico y las decisiones de compatibilidad.

## Licencia

MIT. Este proyecto no está afiliado con Nuvio, Stremio, Hentaila ni los hosts de vídeo.
