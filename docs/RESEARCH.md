# Investigación y decisiones técnicas

Revisión realizada el 30 de agosto de 2026. Las integraciones con sitios públicos pueden cambiar; los tests con fixtures protegen el parsing, pero un cambio incompatible del proveedor requerirá actualizar el cliente o los resolvers.

## Nuvio y el protocolo de streams

Se revisó el código público de Nuvio, en particular sus modelos de addon, parser de streams y motor de reproducción. La implementación actual consume la respuesta estándar:

```json
{
  "streams": [
    {
      "name": "AnimeHes\nVIP",
      "title": "Título • Episodio 1\nVIP • HLS",
      "type": "hls",
      "url": "https://host.example/playlist",
      "behaviorHints": {
        "notWebReady": true,
        "proxyHeaders": {
          "request": {
            "Referer": "https://host.example/embed/..."
          }
        }
      }
    }
  ]
}
```

Nuvio pasa `proxyHeaders.request` al reproductor. Una entrada que contiene `url` y no contiene `infoHash` se trata como stream HTTP, no como torrent. El manifest de esta variante declara `behaviorHints.p2p: false`.

Fuentes revisadas:

- [NuvioMobile](https://github.com/NuvioMedia/NuvioMobile)
- [Objeto Stream del SDK de Stremio](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/stream.md)
- [Manifest del SDK de Stremio](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md)

## Referencia AnimeFLV

Se analizó [animeflv-stremio-addon](https://github.com/Pigamer37/animeflv-stremio-addon) en el commit `144f3b70cb3a1895a2588dc9afc912ae7f574212`, sin copiar sus proveedores ni su arquitectura completa. La idea útil fue el flujo:

1. Resolver el ID externo a metadatos.
2. Buscar y comparar candidatos.
3. Identificar el episodio.
4. Extraer los embeds.
5. Resolver únicamente servidores que entreguen un medio reproducible.
6. Devolver Streams estándar con los headers necesarios.

Esta implementación usa clientes, modelos y resolvers propios y su única fuente es Hentaila.

## Funcionamiento público observado de Hentaila

- La búsqueda pública usa `/catalogo?search=...`.
- Los títulos usan `/media/{slug}` y los episodios `/media/{slug}/{numero}`.
- La aplicación expone los datos de esas páginas mediante endpoints públicos SvelteKit `__data.json`.
- Los detalles observados incluyen título, alias, año, episodios y grupos de embeds.
- El addon decodifica la tabla de referencias JSON de SvelteKit sin ejecutar JavaScript remoto.

Se verificaron tres fuentes directas:

| Servidor | Resolución | Resultado |
|---|---|---|
| VIP | Transforma el identificador público del reproductor en su playlist del mismo host | HLS |
| YourUpload | Lee el HTML público del embed y valida el MP4 en dominios permitidos | MP4 |
| MP4Upload | Lee el HTML público del embed y valida el MP4 en dominios permitidos | MP4 |

No se incluyeron Mega ni mirrors cuyo resultado no era una URL de vídeo directa verificable o parecía depender de una sesión/IP. Tampoco se intenta sortear bloqueos: si un servidor niega el acceso, expira o cambia su formato, ese resultado se omite.

## Matching

El matching normaliza Unicode, diacríticos, mayúsculas, puntuación, guiones y espacios. Combina similitud de tokens y bigramas, compara todos los alias y utiliza el año como señal adicional. Primero obtiene una lista corta con datos de catálogo y después valida los detalles del título. Un candidato debe superar `MIN_MATCH_SCORE`; de lo contrario se devuelven cero streams para evitar falsos positivos.

Para temporadas posteriores se generan variantes de búsqueda con el número de temporada, pero la selección final exige que el episodio solicitado exista. Cuando los datos del sitio ofrecen temporada y número relativo, se prefieren esos campos; de lo contrario se usa el número absoluto de episodio.

## IDs y metadatos

- IMDb: Cinemeta y un fallback público de sugerencias para título/año.
- TMDB: API oficial mediante `TMDB_API_KEY` o `TMDB_READ_ACCESS_TOKEN`, incluyendo títulos alternativos.
- Kitsu: API pública de Kitsu, incluyendo títulos canónicos y alternativos.

La resolución de metadatos es independiente del proveedor de vídeo. Ninguna API key se incluye en el código ni en los fixtures.

## Validación real

Con el addon local se solicitó un episodio real mediante IMDb. El endpoint respondió tres streams: uno HLS de VIP y dos MP4. Los tres hosts respondieron correctamente a una comprobación de manifiesto o `HEAD` usando los headers entregados al reproductor. La respuesta no contenía `infoHash`, magnets ni trackers.

La validación confirma el contrato y el flujo actuales, pero no garantiza disponibilidad futura de contenido o mirrors de terceros.
