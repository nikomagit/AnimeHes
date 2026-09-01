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

  it("resolves a TMDB season through a public Stremio metadata source without credentials", async () => {
    const request = vi.fn().mockResolvedValue(JSON.stringify({
      meta: {
        name: "Haikyu!!",
        originalName: "ハイキュー!!",
        aliases: ["Haikyuu!!"],
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
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.mocked(request).mock.calls[0]?.[0].toString()).toContain("/meta/series/tmdb%3A123.json");
  });
});
