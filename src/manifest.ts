import { catalogDefinitions } from "./catalogs.js";

export const manifest = Object.freeze({
  id: "org.nuvio.animehes",
  version: "1.2.0",
  name: "AnimeHes",
  description:
    "Catálogos de Hentaila y streams HTTP/HTTPS directos de Hentaila, AnimeAV1 y JKAnime, sin P2P.",
  catalogs: catalogDefinitions.map((catalog) => ({
    type: "series",
    id: catalog.id,
    name: catalog.name,
    extra: [{ name: "skip", isRequired: false }],
  })),
  resources: [
    {
      name: "catalog",
      types: ["series"],
    },
    {
      name: "meta",
      types: ["movie", "series"],
      idPrefixes: ["animehes:"],
    },
    {
      name: "stream",
      types: ["movie", "series"],
      idPrefixes: ["tt", "tmdb:", "kitsu:", "animehes:"],
    },
  ],
  types: ["movie", "series"],
  idPrefixes: ["tt", "tmdb:", "kitsu:", "animehes:"],
  behaviorHints: {
    configurable: false,
    configurationRequired: false,
    adult: true,
    p2p: false,
  },
});
