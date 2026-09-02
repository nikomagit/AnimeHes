import { describe, expect, it, vi } from "vitest";
import type { DirectMediaProvider, ProviderCatalogKind, ProviderCatalogPage, ProviderId } from "../src/providers/types.js";
import { ProviderCatalogService } from "../src/services/catalog.js";
import { ProviderMetaService } from "../src/services/meta.js";

function page(kind: ProviderCatalogKind, currentPage: number): ProviderCatalogPage {
  return {
    results: Array.from({ length: 20 }, (_, index) => ({
      id: String(currentPage * 100 + index),
      title: `${kind} ${currentPage}-${index}`,
      slug: `${kind}-${currentPage}-${index}`,
      synopsis: "Descripción",
      category: { id: 1, name: "TV Anime", slug: "tv-anime" },
    })),
    currentPage,
    recordsPerPage: 20,
    totalPages: 10,
    totalRecords: 200,
    orderKey: kind === "airing" ? "default" : "popular",
    status: kind === "airing" ? 2 : null,
    uncensored: kind === "uncensored" ? true : null,
  };
}

function fakeProvider(id: ProviderId): DirectMediaProvider {
  return {
    id,
    name: id === "animeav1" ? "AnimeAV1" : id === "jkanime" ? "JKAnime" : "Hentaila",
    baseUrl: `https://${id}.example`,
    cdnBaseUrl: `https://cdn.${id}.example`,
    search: vi.fn(),
    getCatalog: vi.fn(async (kind, currentPage) => page(kind, currentPage)),
    getMedia: vi.fn().mockResolvedValue(null),
    getEpisode: vi.fn(),
  };
}

describe("catalog and provider metadata services", () => {
  it("routes only the three Hentaila catalog IDs to their source filters", async () => {
    const anime = fakeProvider("animeav1");
    const hentai = fakeProvider("hentaila");
    const jkanime = fakeProvider("jkanime");
    const service = new ProviderCatalogService([anime, hentai, jkanime]);
    const ids = [
      ["hentaila-popular", hentai, "popular"],
      ["hentaila-airing", hentai, "airing"],
      ["hentaila-uncensored", hentai, "uncensored"],
    ] as const;
    for (const [catalogId, provider, kind] of ids) {
      const metas = await service.getCatalog("series", catalogId, 0);
      expect(metas).toHaveLength(20);
      expect(provider.getCatalog).toHaveBeenCalledWith(kind, 1);
      expect(metas[0]).toMatchObject({
        id: expect.stringContaining(`amokin:${provider.id}:`),
        poster: expect.stringContaining("/covers/"),
        background: expect.stringContaining("/backdrops/"),
      });
    }
    expect(anime.getCatalog).not.toHaveBeenCalled();
    expect(jkanime.getCatalog).not.toHaveBeenCalled();
  });

  it("translates skip into upstream pages without limiting the catalog to page one", async () => {
    const hentai = fakeProvider("hentaila");
    const service = new ProviderCatalogService([hentai]);
    const metas = await service.getCatalog("series", "hentaila-popular", 40);
    expect(hentai.getCatalog).toHaveBeenCalledWith("popular", 3);
    expect(metas[0]?.name).toBe("popular 3-0");
  });

  it("builds rich metadata and episode IDs from a provider-native catalog ID", async () => {
    const anime = fakeProvider("animeav1");
    vi.mocked(anime.getMedia).mockResolvedValue({
      id: 197,
      title: "One Piece",
      slug: "one-piece",
      aka: { "ja-jp": "ONE PIECE" },
      synopsis: "Piratas y aventuras.",
      startDate: "1999-10-20",
      status: 2,
      score: 8.73,
      category: { id: 1, name: "TV Anime", slug: "tv-anime" },
      genres: [{ id: 1, name: "Acción", slug: "accion" }],
      episodes: [{ id: 1, number: 1 }, { id: 2, number: 2 }],
    });
    const service = new ProviderMetaService([anime]);
    await expect(service.getMeta("series", "amokin:animeav1:one-piece")).resolves.toMatchObject({
      id: "amokin:animeav1:one-piece",
      type: "series",
      name: "One Piece",
      releaseInfo: "1999",
      genres: ["Acción"],
      status: "En emisión",
      videos: [
        { id: "amokin:animeav1:one-piece:1", season: 1, episode: 1 },
        { id: "amokin:animeav1:one-piece:2", season: 1, episode: 2 },
      ],
    });
  });
});
