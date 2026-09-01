import type { ProviderCatalogKind, ProviderId } from "./providers/types.js";

export interface CatalogDefinition {
  id: string;
  name: string;
  provider: ProviderId;
  kind: ProviderCatalogKind;
}

export const catalogDefinitions: readonly CatalogDefinition[] = Object.freeze([
  { id: "animeav1-popular", name: "AnimeAV1 — Populares", provider: "animeav1", kind: "popular" },
  { id: "animeav1-airing", name: "AnimeAV1 — Al aire", provider: "animeav1", kind: "airing" },
  { id: "hentaila-popular", name: "Hentaila — Populares", provider: "hentaila", kind: "popular" },
  { id: "hentaila-airing", name: "Hentaila — Al aire", provider: "hentaila", kind: "airing" },
  { id: "hentaila-uncensored", name: "Hentaila — Sin Censura", provider: "hentaila", kind: "uncensored" },
]);

export function findCatalogDefinition(id: string): CatalogDefinition | undefined {
  return catalogDefinitions.find((catalog) => catalog.id === id);
}
