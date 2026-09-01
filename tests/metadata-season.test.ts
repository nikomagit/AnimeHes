import { describe, expect, it, vi } from "vitest";
import { RemoteMetadataProvider } from "../src/metadata/client.js";
import { testConfig } from "./helpers.js";

describe("season-specific metadata", () => {
  it("derives the season year and episode count from Cinemeta videos", async () => {
    const request = vi.fn().mockResolvedValue(JSON.stringify({
      meta: {
        name: "Haikyu!!",
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
    });
  });

  it("loads the requested TMDB season without making the base lookup fragile", async () => {
    const request = vi.fn().mockImplementation((url: URL) => Promise.resolve(JSON.stringify(
      url.pathname.endsWith("/season/3")
        ? { name: "Season 3", air_date: "2016-10-08", episodes: Array.from({ length: 10 }, (_, index) => ({ episode_number: index + 1 })) }
        : { name: "Haikyu!!", original_name: "ハイキュー!!", first_air_date: "2014-04-06", alternative_titles: { results: [] } },
    )));
    const provider = new RemoteMetadataProvider(testConfig({ tmdbApiKey: "test-key" }), request);
    await expect(provider.resolve("series", {
      provider: "tmdb", baseId: "123", season: 3, episode: 1,
    })).resolves.toMatchObject({
      title: "Haikyu!!", year: 2014, seasonTitle: "Season 3",
      seasonYear: 2016, seasonEpisodeCount: 10,
    });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
