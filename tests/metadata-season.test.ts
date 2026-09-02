import { describe, expect, it, vi } from "vitest";
import { UpstreamHttpError } from "../src/errors.js";
import { RemoteMetadataProvider } from "../src/metadata/client.js";
import { testConfig } from "./helpers.js";

describe("season-specific metadata", () => {
  it("derives the season year and episode count from Cinemeta videos", async () => {
    const request = vi.fn().mockResolvedValue(JSON.stringify({
      meta: {
        name: "Haikyu!!",
        imdb_id: "tt3398540",
        moviedb_id: 19830,
        year: "2014–2020",
        videos: [
          { id: "tt3398540:3:1", season: 3, episode: 1, name: "Greetings", released: "2016-10-07T19:00:00Z" },
          { id: "tt3398540:3:2", season: 3, episode: 2, name: "The Threat of Left", released: "2016-10-14T19:00:00Z" },
        ],
      },
    }));
    const provider = new RemoteMetadataProvider(testConfig(), request);
    await expect(provider.resolve("series", {
      provider: "imdb", baseId: "tt3398540", season: 3, episode: 1,
    })).resolves.toMatchObject({
      title: "Haikyu!!", year: 2014, episodeTitle: "Greetings",
      seasonYear: 2016, seasonEpisodeCount: 2,
      externalIds: { imdb: "tt3398540", tmdb: 19830 },
    });
  });

  it("resolves a TMDB season through a public Stremio metadata source without credentials", async () => {
    const request = vi.fn().mockResolvedValue(JSON.stringify({
      meta: {
        name: "Haikyu!!",
        originalName: "ハイキュー!!",
        aliases: ["Haikyuu!!"],
        imdb_id: "tt3398540",
        year: "2014–2020",
        seasons: [{ season: 3, name: "Season 3" }],
        videos: Array.from({ length: 10 }, (_, index) => ({
          id: `tmdb:123:3:${index + 1}`,
          season: 3,
          episode: index + 1,
          name: index === 0 ? "Greetings" : `Episode ${index + 1}`,
          released: `2016-10-${String(8 + index).padStart(2, "0")}T00:00:00Z`,
        })),
      },
    }));
    const provider = new RemoteMetadataProvider(testConfig(), request);
    await expect(provider.resolve("series", {
      provider: "tmdb", baseId: "123", season: 3, episode: 1,
    })).resolves.toMatchObject({
      title: "Haikyu!!", year: 2014, episodeTitle: "Greetings", seasonTitle: "Season 3",
      seasonYear: 2016, seasonEpisodeCount: 10,
      externalIds: { imdb: "tt3398540", tmdb: 123 },
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.mocked(request).mock.calls[0]?.[0].toString()).toContain("/meta/series/tmdb%3A123.json");
  });

  it("enriches IMDb metadata with localized and alternative TMDB titles when a private key is configured", async () => {
    const request = vi.fn(async (rawUrl: URL | string) => {
      const url = new URL(String(rawUrl));
      if (url.hostname === "v3-cinemeta.strem.io") return JSON.stringify({ meta: {
        name: "How I Met Your Mother", imdb_id: "tt0460649", moviedb_id: 1100, year: "2005–2014",
      } });
      if (url.hostname === "api.themoviedb.org" && url.pathname === "/3/tv/1100") return JSON.stringify({
        id: 1100,
        name: "Cómo conocí a vuestra madre",
        original_name: "How I Met Your Mother",
        first_air_date: "2005-09-19",
        external_ids: { imdb_id: "tt0460649" },
        alternative_titles: { results: [{ title: "Cómo conocí a tu madre" }] },
        translations: { translations: [
          { iso_639_1: "en", data: { name: "How I Met Your Mother" } },
          { iso_639_1: "es", data: { name: "Cómo conocí a vuestra madre" } },
        ] },
      });
      throw new Error(`Unexpected URL ${url}`);
    });
    const provider = new RemoteMetadataProvider(testConfig({ tmdbApiKey: "test-key" }), request);
    const result = await provider.resolve("series", { provider: "imdb", baseId: "tt0460649" });
    expect(result.externalIds).toEqual({ imdb: "tt0460649", tmdb: 1100 });
    expect(result.aliases).toEqual(expect.arrayContaining([
      "How I Met Your Mother", "Cómo conocí a vuestra madre", "Cómo conocí a tu madre",
    ]));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("converts IMDb to TMDB through the official find endpoint when Cinemeta lacks the record", async () => {
    const request = vi.fn(async (rawUrl: URL | string) => {
      const url = new URL(String(rawUrl));
      if (url.hostname === "v3-cinemeta.strem.io") throw new UpstreamHttpError("Cinemeta", 404);
      if (url.pathname === "/3/find/tt0460649") return JSON.stringify({ tv_results: [{ id: 1100 }] });
      if (url.pathname === "/3/tv/1100") return JSON.stringify({
        id: 1100, name: "Cómo conocí a vuestra madre", original_name: "How I Met Your Mother",
        first_air_date: "2005-09-19", external_ids: { imdb_id: "tt0460649" },
      });
      if (url.pathname === "/3/tv/1100/season/1") return JSON.stringify({
        name: "Temporada 1", air_date: "2005-09-19",
        episodes: [{ episode_number: 1, name: "Piloto", air_date: "2005-09-19" }],
      });
      throw new Error(`Unexpected URL ${url}`);
    });
    const provider = new RemoteMetadataProvider(testConfig({ tmdbApiKey: "test-key" }), request);
    await expect(provider.resolve("series", {
      provider: "imdb", baseId: "tt0460649", season: 1, episode: 1,
    })).resolves.toMatchObject({
      title: "Cómo conocí a vuestra madre",
      externalIds: { imdb: "tt0460649", tmdb: 1100 },
      seasonTitle: "Temporada 1", episodeTitle: "Piloto", seasonEpisodeCount: 1,
    });
  });
});
