export const manifest = Object.freeze({
  id: "org.nuvio.animehes",
  version: "1.0.0",
  name: "AnimeHes",
  description:
    "AnimeHes ofrece streams HTTP/HTTPS directos de Hentaila para Nuvio/Stremio, sin P2P.",
  catalogs: [],
  resources: [
    {
      name: "stream",
      types: ["movie", "series"],
      idPrefixes: ["tt", "tmdb:", "kitsu:"],
    },
  ],
  types: ["movie", "series"],
  idPrefixes: ["tt", "tmdb:", "kitsu:"],
  behaviorHints: {
    configurable: false,
    configurationRequired: false,
    adult: true,
    p2p: false,
  },
});
