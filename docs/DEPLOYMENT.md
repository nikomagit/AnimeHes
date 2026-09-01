# Despliegue

AnimeHes necesita un servidor Node.js activo. GitHub Pages no es suficiente porque solo publica archivos estáticos.

## Instalación pública actual

Repositorio:

```text
https://github.com/nikomagit/AnimeHes
```

Manifest:

```text
https://animehes.onrender.com/manifest.json
```

El servicio de Render está conectado a la rama `main`; cada actualización inicia un despliegue automático. El plan gratuito puede entrar en reposo y provocar un arranque lento en la primera solicitud.

## Render desde cero

1. Crea un repositorio de GitHub sin `.env`, `node_modules` ni `dist`.
2. En Render selecciona **New > Blueprint** y conecta el repositorio.
3. Render detectará `render.yaml` y construirá el `Dockerfile`.
4. Agrega `TMDB_API_KEY` o `TMDB_READ_ACCESS_TOKEN` como secreto si usarás IDs `tmdb:`. IMDb, Kitsu y los IDs `animehes:` no necesitan una clave.
5. Espera a que `/health` responda `{"status":"ok",...}`.
6. Instala `https://TU-SERVICIO.onrender.com/manifest.json` en Nuvio/Stremio.

Los valores predeterminados ya incluyen los orígenes públicos de AnimeAV1 y Hentaila. Solo cámbialos si mantienes un mirror compatible autorizado.

## Koyeb

1. Crea un Web Service desde el repositorio de GitHub.
2. Selecciona el `Dockerfile`, tipo **Web**, una instancia gratuita y una región disponible.
3. Expón el puerto `7100` y configura `/health` como health check.
4. Agrega `HOST=0.0.0.0`, `PORT=7100` y, opcionalmente, el secreto TMDB.
5. Instala `https://TU-SERVICIO.koyeb.app/manifest.json`.

## VPS con Docker Compose

Requisitos: Docker Engine, Compose v2, un dominio y un proxy HTTPS como Caddy o Nginx.

```bash
git clone https://github.com/nikomagit/AnimeHes.git
cd AnimeHes
docker compose up -d --build
curl http://127.0.0.1:7100/health
```

Publica `127.0.0.1:7100` detrás del proxy HTTPS y agrega en Nuvio:

```text
https://addon.tu-dominio.example/manifest.json
```

## Variables de producción

| Variable | Valor recomendado |
|---|---|
| `HOST` | `0.0.0.0` |
| `PORT` | `7100` |
| `LOG_LEVEL` | `info` |
| `ANIMEAV1_BASE_URL` | `https://animeav1.com` |
| `ANIMEAV1_CDN_BASE_URL` | `https://cdn.animeav1.com` |
| `HENTAILA_BASE_URL` | `https://hentaila.com` |
| `HENTAILA_CDN_BASE_URL` | `https://cdn.hentaila.com` |
| `CATALOG_CACHE_TTL_MS` | `900000` |

Mantén TMDB como secreto del proveedor de hosting, no como texto en `render.yaml` ni `.env.example`.

## Verificación posterior

Comprueba al menos:

```text
GET /health
GET /manifest.json
GET /catalog/series/animeav1-popular.json
GET /catalog/series/hentaila-popular.json
GET /catalog/series/hentaila-uncensored.json
```

Después abre una ficha, un episodio y una respuesta `/stream/...`. Confirma que las URLs son HTTPS y que no existe `infoHash`.

## Actualizar un VPS

```bash
git pull --ff-only
docker compose up -d --build
docker compose logs --tail=100 animehes
```

No registres query strings de vídeo, cookies ni headers privados: algunos enlaces contienen tokens temporales. Mantén dependencias e imagen base actualizadas.
