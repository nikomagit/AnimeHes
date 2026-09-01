# Investigación y decisiones técnicas

Revisión en vivo realizada el 31 de agosto de 2026. AnimeAV1, Hentaila y sus hosts son servicios externos y pueden cambiar. Los tests con fixtures protegen el contrato conocido; un cambio incompatible del proveedor requerirá actualizar el cliente o el resolver afectado.

## Contrato Nuvio/Stremio

AnimeHes implementa los recursos estándar `catalog`, `meta` y `stream`. Los catálogos anuncian `extra: skip`; las fichas usan IDs internos estables y los streams contienen `url`, nunca `infoHash`.

Ejemplo resumido:

```json
{
  "streams": [
    {
      "name": "AnimeHes\nAnimeAV1 • HLS",
      "title": "Título • Episodio 1\nHLS",
      "type": "hls",
      "url": "https://host.example/m3u8/id",
      "behaviorHints": {
        "notWebReady": true,
        "proxyHeaders": { "request": { "Referer": "https://host.example/play/id" } }
      }
    }
  ]
}
```

Nuvio pasa `proxyHeaders.request` al reproductor. Una entrada con `url` y sin `infoHash` es un stream HTTP. El manifest declara `behaviorHints.p2p: false`.

Fuentes de referencia:

- [NuvioMobile](https://github.com/NuvioMedia/NuvioMobile)
- [Stream del SDK de Stremio](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/stream.md)
- [Manifest del SDK de Stremio](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md)

## API pública usada por los proveedores

Ambos sitios usan una aplicación SvelteKit con una estructura pública equivalente. AnimeHes consulta las rutas `__data.json` utilizadas por el frontend y decodifica su tabla de referencias JSON sin ejecutar JavaScript remoto.

| Función | Ruta/consulta observada |
|---|---|
| Buscar | `/catalogo/__data.json?search={texto}` |
| Popular | `/catalogo/__data.json?order=popular` |
| Al aire | `/catalogo/__data.json?status=emision` |
| Sin censura de Hentaila | `/catalogo/__data.json?uncensored=&order=popular` |
| Página N | agrega `page={N}` |
| Ficha | `/media/{slug}/__data.json` |
| Episodio | `/media/{slug}/{episodio}/__data.json` |

El frontend traduce `order=popular` al campo de votos en orden descendente. En la prueba real de Hentaila, la respuesta de Sin Censura confirmó `orderKey: popular`, `uncensored: true`, 20 elementos por página y 16 páginas. Los votos de los primeros ocho elementos fueron descendentes: 40237, 38734, 35908, 26718, 25683, 18802, 17050 y 15348.

La paginación del protocolo se convierte con `page = floor(skip / recordsPerPage) + 1`. Se verificó que `skip=20` devuelve una segunda página distinta en los cinco catálogos.

## AnimeAV1

Se validó búsqueda, ficha, listado de episodios y streams con una serie larga disponible públicamente. La ficha expuso título, alias, estado, fechas, score, votos, géneros y 1176 episodios.

Fuentes compatibles observadas:

| Servidor | Resolución | Resultado |
|---|---|---|
| Reproductor HLS | convierte `/play/{id}` en `/m3u8/{id}` en el mismo host permitido | playlist HLS |
| MP4Upload | analiza el HTML público del embed y valida el host final | MP4 |

El manifiesto HLS real respondió `200`, `application/x-mpegURL` y comenzó con `#EXTM3U`. La URL MP4 respondió correctamente a `HEAD`.

## Hentaila

La integración previa se mantuvo y se migró al cliente compartido. Sus búsquedas, fichas, episodios y tres resolvers siguen operativos:

| Servidor | Resolución | Resultado |
|---|---|---|
| VIP | convierte el identificador público del reproductor en su playlist del mismo host | HLS |
| YourUpload | analiza el HTML público del embed y valida el dominio final | MP4 |
| MP4Upload | analiza el HTML público del embed y valida el dominio final | MP4 |

No se incluyen mirrors que no entregan una URL directa verificable o que parecen depender de sesión/IP. Si un servidor niega acceso, expira o cambia de formato, se omite sin afectar los demás.

## Matching, IDs y metadatos

Los elementos de catálogo usan `animehes:{provider}:{slug}` y los episodios `animehes:{provider}:{slug}:{episode}`. Esto evita una búsqueda redundante cuando Nuvio navega desde AnimeHes.

Para solicitudes externas:

- IMDb: Cinemeta y fallback público de sugerencias para título y año.
- TMDB: API oficial mediante `TMDB_API_KEY` o `TMDB_READ_ACCESS_TOKEN`, incluyendo títulos alternativos.
- Kitsu: API pública de Kitsu, con títulos canónicos y alternativos.

El matching normaliza Unicode, diacríticos, mayúsculas, puntuación, guiones y espacios. Combina similitud de tokens y bigramas, compara alias y usa el año como señal adicional. Si ningún candidato supera `MIN_MATCH_SCORE`, devuelve cero streams para evitar falsos positivos.

## Aislamiento, caché y seguridad

- Cada proveedor se consulta de forma independiente con `Promise.allSettled`.
- Cada resolver también falla de forma independiente.
- La deduplicación conserva una sola entrada por URL final exacta.
- Búsquedas, catálogos, fichas y episodios tienen cachés TTL limitadas; una promesa fallida no queda almacenada permanentemente.
- Las respuestas tienen timeout y tamaño máximo.
- Slugs, esquemas y hosts se validan antes de usar una URL.
- No se ejecuta código remoto ni se intenta evitar controles de acceso.

Las pruebas reales incluyeron dos servidores locales con un origen configurado a un puerto inaccesible. Con AnimeAV1 caído, Hentaila entregó 20 elementos y 3 streams; con Hentaila caído, AnimeAV1 entregó 20 elementos y 2 streams.

## Resultado de la validación en vivo

- Manifest v1.1.0 con cinco catálogos y `p2p: false`.
- Primera y segunda página de los cinco catálogos, 20 elementos por página.
- Metadatos, póster, fondo, géneros, estado y episodios de ambas fuentes.
- AnimeAV1: 2 streams directos en el episodio probado.
- Hentaila: 3 streams directos en el episodio probado.
- Resolución por IMDb comprobada para ambos proveedores.
- HLS y MP4 finales respondieron correctamente con los headers declarados.
- Ninguna respuesta inspeccionada contenía magnets, trackers ni `infoHash`.

La comprobación confirma el flujo al momento indicado, pero no garantiza la disponibilidad futura de contenido o mirrors de terceros.
