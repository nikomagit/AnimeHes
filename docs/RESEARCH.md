# Investigación y decisiones técnicas

Revisión en vivo actualizada el 1 de septiembre de 2026. Todos los proveedores y hosts son servicios externos y pueden cambiar. Los tests con fixtures protegen el contrato conocido; un cambio incompatible del proveedor requerirá actualizar el cliente o el resolver afectado.

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

## APIs públicas usadas por AnimeAV1 y Hentaila

AnimeAV1 y Hentaila usan una aplicación SvelteKit con una estructura pública equivalente. AnimeHes consulta las rutas `__data.json` utilizadas por el frontend y decodifica su tabla de referencias JSON sin ejecutar JavaScript remoto.

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

La paginación del protocolo se convierte con `page = floor(skip / recordsPerPage) + 1`. En el manifest 1.3.1 esta navegación se expone únicamente para los tres catálogos de Hentaila.

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

## JKAnime

JKAnime se integra únicamente como fuente de streams, sin catálogos públicos en el manifest. La búsqueda usa la ruta pública `GET /buscar?q={título}`; la ficha aporta título alternativo, tipo, año, géneros y cantidad de episodios. Los episodios se consultan con `/{slug}/{episodio}/`.

Solo se aceptan los reproductores públicos `UM` y `UMV` cuando su HTML expone una playlist HLS directa en un dominio permitido de `playmudos.com`. Los reproductores que no entregan una URL reproducible de forma pública se omiten. En la validación real, UM y UMV condujeron a la misma playlist y la deduplicación conservó una sola fuente. No se ejecuta JavaScript remoto, no se intenta sortear protección y no se usan cookies autenticadas.

## Películas y series

Cuevana y LaMovie son exclusivamente fuentes de `/stream`: no agregan catálogos al manifest. La prioridad de respuesta es Cuevana y luego LaMovie; se consultan de forma aislada y no se detiene la búsqueda al obtener el primer resultado.

### Cuevana y Trinity

- La búsqueda pública usa `/explorar?s={título}` y diferencia `/pelicula/` de `/serie/`.
- Las temporadas usan `/serie/{slug}/temporada-{n}` y los episodios `/serie/{slug}/episodio-{temporada}x{episodio}`.
- Los wrappers públicos contienen el embed final codificado en Base64; se decodifica como texto, sin ejecutar JavaScript.
- Trinity apunta a Videasy. Su API pública entrega una semilla y un payload cifrado que se descifra localmente con el mismo algoritmo determinista del frontend público.
- Cada HLS Trinity se valida con una petición real y `#EXTM3U` antes de aceptarlo. El CDN comprobado rechaza `Origin` y `Referer`, por lo que se conserva únicamente el `User-Agent` verificado.
- Si al menos un HLS Trinity supera la validación, se devuelven solo streams Trinity. Si todos fallan, el registry sondea los demás embeds de Cuevana de manera independiente.

En la inspección actual, los alternativos publicados fueron Goldmember (`vsembed.ru`), Death Star (`vidlink.pro`) y Mahoutokoro (`vidapi.xyz`). Sus páginas públicas no expusieron una URL multimedia final estática en un dominio permitido: dependen de aplicaciones JavaScript/niveles adicionales de agregación. Se probaron, pero no se añadieron resolvers frágiles ni ejecución remota; por ahora quedan descartados.

### LaMovie

LaMovie expone JSON público para búsqueda (`/wp-api/v1/search`), fichas, listado de episodios por temporada y player. El cliente usa los IDs internos de episodio y solo procesa `data.embeds`; ignora completamente `downloads`, magnets o cualquier mecanismo de descarga. El embed Vimeos se desempaqueta de forma estática y su master HLS se conserva.

## Matching, IDs y metadatos

Los elementos de catálogo usan `animehes:{provider}:{slug}` y los episodios `animehes:{provider}:{slug}:{episode}`. Esto evita una búsqueda redundante cuando Nuvio navega desde AnimeHes.

Para solicitudes externas:

- IMDb: Cinemeta y fallback público de sugerencias para título y año.
- TMDB: addon público de metadatos Stremio sin clave privada, conservando temporadas, episodios y alias cuando están disponibles.
- Kitsu: API pública de Kitsu, con títulos canónicos y alternativos.

El fallback TMDB usa el contrato público documentado por el proyecto [TMDB Addon](https://github.com/mrcanelas/tmdb-addon/blob/main/docs/api.md). Su disponibilidad es externa a AnimeHes y no se envían credenciales del usuario.

El matching normaliza Unicode, diacríticos, mayúsculas, puntuación, guiones y espacios. Combina similitud de tokens y bigramas, compara alias y usa el año como señal adicional. Si ningún candidato supera `MIN_MATCH_SCORE`, devuelve cero streams para evitar falsos positivos.

## Aislamiento, caché y seguridad

- Cada proveedor se consulta de forma independiente con `Promise.allSettled`.
- Cada resolver también falla de forma independiente.
- La deduplicación conserva una sola entrada por URL final exacta.
- Búsquedas, catálogos, fichas y episodios tienen cachés TTL limitadas; una promesa fallida no queda almacenada permanentemente.
- Las respuestas tienen timeout y tamaño máximo.
- Slugs, esquemas y hosts se validan antes de usar una URL.
- No se ejecuta código remoto ni se intenta evitar controles de acceso.

Las pruebas automatizadas aíslan los tres proveedores con `Promise.allSettled`: cualquiera de AnimeAV1, Hentaila o JKAnime puede fallar sin bloquear los streams de los otros dos.

## Resultado de la validación en vivo

- Manifest v1.3.1 con solo tres catálogos Hentaila, logo propio, descripción intacta y `p2p: false`.
- AnimeAV1 y JKAnime permanecen como proveedores internos de streams, sin catálogos anunciados.
- Metadatos, póster, géneros y episodios de los proveedores cuando la fuente los publica.
- AnimeAV1: 2 streams directos en el episodio probado.
- Hentaila: 3 streams directos en el episodio probado.
- JKAnime: búsqueda, ficha, episodio y playlist HLS directa comprobados.
- Los HLS finales de los tres proveedores respondieron `200` y comenzaron con `#EXTM3U`.
- Los IDs TMDB y Kitsu se probaron sin claves con un episodio real de One Piece.
- Resolución por IMDb comprobada en paralelo; cada proveedor devuelve únicamente coincidencias suficientemente sólidas.
- HLS y MP4 finales respondieron correctamente con los headers declarados.
- Ninguna respuesta inspeccionada contenía magnets, trackers ni `infoHash`.
- Cuevana/Trinity: HLS `200`, `application/vnd.apple.mpegurl` y `#EXTM3U` en Dune (2021), The Matrix (1999), Breaking Bad T1E1 y T3E5.
- LaMovie/Vimeos: HLS válido en las dos películas y los dos episodios de Breaking Bad.

## Temporadas publicadas como títulos independientes

Nuvio puede solicitar un episodio con un ID unificado, por ejemplo `IMDb:temporada:episodio`, aunque AnimeAV1 o JKAnime publiquen cada temporada como una ficha diferente. El resolver obtiene el año y la cantidad de episodios de la temporada desde fuentes públicas compatibles con Stremio, reconoce indicadores como `2nd Season` y `Third Season`, descarta películas/OVA y valida los candidatos antes de seleccionar el episodio relativo.

La regresión se comprobó con `tt3398540:1:1` hasta `tt3398540:4:1`: la temporada 1 selecciona `Haikyuu!!`, la 2 `Second Season`, la 3 `Karasuno vs. Shiratorizawa`/`Third Season` y la 4 `To the Top`. JKAnime participó correctamente en T1, T2 y T3; T4 se obtuvo de AnimeAV1 porque la publicación actual de JKAnime divide esa temporada en dos cours y su ficha no coincide con la cantidad total de episodios entregada por los metadatos. La política conservadora la omite antes que mapear episodios de forma incierta.

## Limitaciones actuales

- Los enlaces de vídeo pueden caducar y se resuelven en el momento de solicitar `/stream`.
- JKAnime UM y UMV pueden apuntar al mismo HLS; se devuelve una sola entrada después de deduplicar.
- La resolución de IDs TMDB depende de la disponibilidad del addon público de metadatos configurado.
- Si un proveedor divide una temporada en cours sin una numeración inequívoca de episodios absolutos, AnimeHes puede omitir ese proveedor para evitar reproducir el episodio equivocado.
- Trinity depende del formato público actual de Videasy y de su dominio CDN permitido `peakstorm.top`; un cambio de API o CDN hará que se omita y active los fallbacks, no que se acepte una URL arbitraria.
- Los reproductores alternativos de Cuevana quedan sin soporte hasta que expongan una URL final pública y estable sin ejecutar JavaScript remoto ni eludir controles.

La comprobación confirma el flujo al momento indicado, pero no garantiza la disponibilidad futura de contenido o mirrors de terceros.
