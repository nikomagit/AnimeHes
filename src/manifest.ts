import { catalogDefinitions } from "./catalogs.js";

export const manifest = Object.freeze({
  id: "org.nuvio.amokin",
  version: "2.0.0",
  name: "AMOKIN",
  logo: "https://amokin.onrender.com/logo.jpg",
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
      idPrefixes: ["amokin:"],
    },
    {
      name: "stream",
      types: ["movie", "series"],
      idPrefixes: ["tt", "tmdb:", "kitsu:", "amokin:"],
    },
  ],
  types: ["movie", "series"],
  idPrefixes: ["tt", "tmdb:", "kitsu:", "amokin:"],
  behaviorHints: {
    configurable: false,
    configurationRequired: false,
    adult: true,
    p2p: false,
  },
});
