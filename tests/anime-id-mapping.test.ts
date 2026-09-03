import { describe, expect, it, vi } from "vitest";
import { AnimeMappingClient } from "../src/metadata/anime-mapping.js";
import { RemoteMetadataProvider } from "../src/metadata/client.js";
import type { FetchText } from "../src/lib/http.js";
import { testConfig } from "./helpers.js";

const mappingPayload = {
  anidb: 69,
  anilist: 21,
  imdb: "tt0388629",
  kitsu: 12,
  myanimelist: 21,
  themoviedb: 37854,
  themoviedb_type: "tv",
  thetvdb: 81797,
  title: "One Piece",
  trakt_season: 1,
};

describe("anime ID mapping", () => {
  it("converts every accepted database ID to the complete external identity", async () => {
    const request = vi.fn<FetchText>().mockResolvedValue(JSON.stringify(mappingPayload));
    const client = new AnimeMappingClient(testConfig(), request);
    const inputs = [
      { provider: "imdb" as const, baseId: "tt0388629" },
      { provider: "tmdb" as const, baseId: "37854" },
      { provider: "tvdb" as const, baseId: "81797" },
      { provider: "kitsu" as const, baseId: "12" },
      { provider: "anilist" as const, baseId: "21" },
      { provider: "mal" as const, baseId: "21" },
      { provider: "anidb" as const, baseId: "69" },
    ];
    for (const parsed of inputs) {
      await expect(client.resolve("series", parsed)).resolves.toMatchObject({
        externalIds: {
          imdb: "tt0388629", tmdb: 37854, kitsu: 12, anilist: 21,
          mal: 21, anidb: 69, tvdb: 81797,
        },
      });
    }
    const paths = vi.mocked(request).mock.calls.map((call) => new URL(String(call[0])).pathname);
    expect(paths).toEqual(expect.arrayContaining([
      "/imdb/tt0388629", "/themoviedb/tv/37854", "/thetvdb/series/81797", "/kitsu/12",
      "/anilist/21", "/myanimelist/21", "/anidb/69",
    ]));
  });

  it("uses TMDB season identity before a series-level mapping", async () => {
    const request = vi.fn<FetchText>().mockResolvedValue(JSON.stringify({
      ...mappingPayload,
      anidb: 11991,
      anilist: 21698,
      kitsu: 11935,
      myanimelist: 32935,
      themoviedb: 60863,
      title: "Haikyuu!! Karasuno Koukou vs. Shiratorizawa Gakuen Koukou",
      trakt_season: 3,
    }));
    const client = new AnimeMappingClient(testConfig(), request);
    const result = await client.resolve("series", {
      provider: "imdb", baseId: "tt3398540", season: 3, episode: 1,
    }, { imdb: "tt3398540", tmdb: 60863 });
    expect(new URL(String(vi.mocked(request).mock.calls[0]?.[0])).pathname)
      .toBe("/themoviedb/tv/60863/seasons/3");
    expect(result).toMatchObject({
      title: "Haikyuu!! Karasuno Koukou vs. Shiratorizawa Gakuen Koukou",
      externalIds: { anilist: 21698, mal: 32935, kitsu: 11935 },
      season: 3,
    });
  });

  it("resolves a TVDB season through its season-specific mapping", async () => {
    const request = vi.fn<FetchText>().mockResolvedValue(JSON.stringify({
      ...mappingPayload,
      anilist: 21698,
      kitsu: 11935,
      myanimelist: 32935,
      themoviedb: 60863,
      thetvdb: 278157,
      title: "Haikyuu!! Karasuno Koukou vs. Shiratorizawa Gakuen Koukou",
      trakt_season: 3,
    }));
    const client = new AnimeMappingClient(testConfig(), request);
    const result = await client.resolve("series", {
      provider: "tvdb", baseId: "278157", season: 3, episode: 1,
    });
    expect(new URL(String(vi.mocked(request).mock.calls[0]?.[0])).pathname)
      .toBe("/thetvdb/series/278157/seasons/3");
    expect(result).toMatchObject({ externalIds: { tvdb: 278157, anilist: 21698 }, season: 3 });
  });

  it("does not reinterpret an entry-scoped Kitsu episode as TMDB season 1", async () => {
    const request = vi.fn<FetchText>().mockResolvedValue(JSON.stringify({
      ...mappingPayload,
      anilist: 21698,
      kitsu: 11935,
      myanimelist: 32935,
      themoviedb: 60863,
      title: "Haikyuu!! Karasuno Koukou vs. Shiratorizawa Gakuen Koukou",
      trakt_season: 3,
    }));
    const client = new AnimeMappingClient(testConfig(), request);
    await expect(client.resolve("series", {
      provider: "kitsu", baseId: "11935", season: 1, episode: 1,
    })).resolves.toMatchObject({ externalIds: { kitsu: 11935, anilist: 21698 }, season: 3 });
    expect(vi.mocked(request).mock.calls.map((call) => new URL(String(call[0])).pathname))
      .toEqual(["/kitsu/11935"]);
  });
});

describe("multi-source anime metadata", () => {
  const request = vi.fn<FetchText>(async (rawUrl, options) => {
    const url = new URL(String(rawUrl));
    if (url.hostname === "graphql.anilist.co") {
      const body = JSON.parse(options.body ?? "{}") as { variables?: { id?: number; idMal?: number } };
      const id = body.variables?.id ?? 21;
      return JSON.stringify({ data: { Media: {
        id,
        idMal: 21,
        format: "TV",
        episodes: 1100,
        startDate: { year: 1999 },
        title: { romaji: "One Piece", english: "One Piece", native: "ワンピース" },
        synonyms: ["Wan Pīsu"],
      } } });
    }
    if (url.hostname === "kitsu.io") return JSON.stringify({ data: { attributes: {
      canonicalTitle: "One Piece", startDate: "1999-10-20",
      titles: { en: "One Piece", en_jp: "One Piece", ja_jp: "ワンピース" },
      abbreviatedTitles: ["OP"],
    } } });
    if (url.hostname === "animeapi.my.id") return JSON.stringify(mappingPayload);
    throw new Error(`Unexpected URL ${url}`);
  });

  it("resolves TVDB, Kitsu, AniList, MAL and AniDB inputs with multilingual aliases", async () => {
    const provider = new RemoteMetadataProvider(testConfig(), request);
    const inputs = [
      { provider: "kitsu" as const, baseId: "12" },
      { provider: "tvdb" as const, baseId: "81797" },
      { provider: "anilist" as const, baseId: "21" },
      { provider: "mal" as const, baseId: "21" },
      { provider: "anidb" as const, baseId: "69" },
    ];
    for (const parsed of inputs) {
      const result = await provider.resolve("series", { ...parsed, season: 1, episode: 1 });
      expect(result.externalIds).toMatchObject({
        imdb: "tt0388629", tmdb: 37854, kitsu: 12, anilist: 21, mal: 21, anidb: 69,
      });
      expect(result.aliases).toEqual(expect.arrayContaining(["One Piece", "ワンピース", "Wan Pīsu"]));
    }
  });

  it("falls back to the anime map when a TMDB metadata service is unavailable", async () => {
    const provider = new RemoteMetadataProvider(testConfig(), request);
    const result = await provider.resolve("series", {
      provider: "tmdb", baseId: "37854", season: 1, episode: 1,
    });
    expect(result.title).toBe("One Piece");
    expect(result.externalIds).toMatchObject({
      imdb: "tt0388629", tmdb: 37854, kitsu: 12, anilist: 21, mal: 21, anidb: 69,
    });
    expect(result.aliases).toEqual(expect.arrayContaining(["ワンピース", "Wan Pīsu"]));
  });

  it("marks a TVDB season mapping as season-specific metadata", async () => {
    const seasonalRequest = vi.fn<FetchText>(async (rawUrl, options) => {
      const url = new URL(String(rawUrl));
      if (url.hostname === "animeapi.my.id") return JSON.stringify({
        ...mappingPayload,
        anidb: 11991, anilist: 21698, kitsu: 11935, myanimelist: 32935,
        themoviedb: 60863, thetvdb: 278157, trakt_season: 3,
        title: "Haikyuu!! Karasuno Koukou vs. Shiratorizawa Gakuen Koukou",
      });
      if (url.hostname === "graphql.anilist.co") {
        expect(options.method).toBe("POST");
        return JSON.stringify({ data: { Media: {
          id: 21698, idMal: 32935, format: "TV", episodes: 10,
          startDate: { year: 2016 },
          title: {
            romaji: "Haikyuu!! Karasuno Koukou vs. Shiratorizawa Gakuen Koukou",
            english: "HAIKYU!! 3rd Season", native: "ハイキュー!! 烏野高校 VS 白鳥沢学園高校",
          },
          synonyms: [],
        } } });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const provider = new RemoteMetadataProvider(testConfig(), seasonalRequest);
    const result = await provider.resolve("series", {
      provider: "tvdb", baseId: "278157", season: 3, episode: 1,
    });
    expect(result).toMatchObject({
      seasonYear: 2016,
      seasonEpisodeCount: 10,
      externalIds: { tvdb: 278157, tmdb: 60863, anilist: 21698, mal: 32935 },
    });
    expect(result.seasonAliases).toEqual(expect.arrayContaining([
      "Haikyuu!! Karasuno Koukou vs. Shiratorizawa Gakuen Koukou",
      "HAIKYU!! 3rd Season",
      "ハイキュー!! 烏野高校 VS 白鳥沢学園高校",
    ]));
  });
});
