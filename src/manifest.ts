import { catalogDefinitions } from "./catalogs.js";

export const manifest = Object.freeze({
  id: "org.nuvio.animehes",
  version: "1.3.0",
  name: "AnimeHes",
  logo: "https://animehes.onrender.com/logo.jpg",
  description:
    "Streams HTTP/HTTPS directos de AnimeAv1, JKanime y Hentaila, sin P2P ni adicionales. No esta vinculado a ninguna de las 3 plataformas mencionadas.",
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
