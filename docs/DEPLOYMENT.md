# Despliegue

El addon necesita un servidor Node.js activo. Un hosting estático como GitHub Pages no es suficiente.

## Koyeb gratuito (recomendado)

1. Sube esta carpeta a un repositorio privado o público de GitHub sin incluir `.env` ni `node_modules`.
2. En Koyeb selecciona **Create Web Service > GitHub** y conecta el repositorio.
3. Selecciona el builder **Dockerfile**, tipo **Web**, instancia **Free** y una región disponible.
4. Expón el puerto HTTP `7100` con la ruta `/`.
5. Agrega estas variables:

   ```text
   HOST=0.0.0.0
   PORT=7100
   LOG_LEVEL=info
   ```

6. Si utilizarás IDs TMDB, agrega `TMDB_API_KEY` o `TMDB_READ_ACCESS_TOKEN` como secreto. IMDb y Kitsu funcionan sin esas variables.
7. Configura `/health` como health check y despliega.
8. Cuando `https://TU-SERVICIO.koyeb.app/health` responda `{"status":"ok",...}`, instala en Nuvio:

   ```text
   https://TU-SERVICIO.koyeb.app/manifest.json
   ```

La instancia gratuita puede suspenderse después de un periodo sin tráfico. La primera petición siguiente puede tardar algunos segundos mientras el servicio despierta.

## Render con Blueprint (alternativa)

1. Sube esta carpeta a un repositorio privado o público de GitHub sin incluir `.env`.
2. En Render selecciona **New > Blueprint** y conecta el repositorio.
3. Render detectará `render.yaml` y construirá el `Dockerfile`.
4. Si utilizarás IDs TMDB, agrega `TMDB_API_KEY` o `TMDB_READ_ACCESS_TOKEN` como secreto en el servicio. IMDb y Kitsu funcionan sin esa variable.
5. Espera a que `https://TU-SERVICIO.onrender.com/health` responda `{"status":"ok",...}`.
6. Instala en Nuvio:

   ```text
   https://TU-SERVICIO.onrender.com/manifest.json
   ```

Render suspende con mayor rapidez sus servicios gratuitos y el primer arranque puede tardar lo suficiente para provocar un timeout en Nuvio. Por eso Koyeb es la opción gratuita preferida para este proyecto.

## VPS con Docker Compose

Requisitos: Docker Engine, Compose v2, un dominio y un proxy HTTPS como Caddy o Nginx.

```bash
git clone URL_DEL_REPOSITORIO
cd AnimeHes
docker compose up -d --build
curl http://127.0.0.1:7100/health
```

Publica `127.0.0.1:7100` detrás del proxy HTTPS y agrega en Nuvio:

```text
https://addon.tu-dominio.example/manifest.json
```

No registres ni envíes a terceros los query strings de las URLs de vídeo: pueden contener tokens temporales. En producción limita el acceso a logs, mantén las dependencias actualizadas y no añadas la clave TMDB al repositorio.

## Actualizar

```bash
git pull --ff-only
docker compose up -d --build
docker compose logs --tail=100 animehes
```

Comprueba después `/health`, `/manifest.json` y una petición `/stream/...` válida.
