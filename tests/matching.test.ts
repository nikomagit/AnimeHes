import { describe, expect, it } from "vitest";
import {
  buildSearchQueries,
  detailedScore,
  inferSeasonNumber,
  isSeasonCompatible,
  normalizeTitle,
  titleSimilarity,
} from "../src/services/matching.js";
import type { MediaMetadata } from "../src/types.js";

const metadata: MediaMetadata = {
  provider: "kitsu",
  baseId: "123",
  type: "series",
  title: "Kaede to Suzu",
  aliases: ["Love Me: Kaede and Suzu The Animation", "らぶみー『楓と鈴』 THE ANIMATION"],
  year: 2022,
  season: 1,
  episode: 2,
};

describe("conservative title matching", () => {
  it("normalizes punctuation, case and generic animation suffixes", () => {
    expect(normalizeTitle("Love Me: Kaede-and-Suzu!" )).toBe("love me kaede and suzu");
    expect(titleSimilarity("Kaede to Suzu", "Kaede to Suzu The Animation")).toBeGreaterThan(0.95);
  });

  it("does not accept a result sharing only one generic word", () => {
    expect(titleSimilarity("Love Me Kaede", "Love Colon")).toBeLessThan(0.72);
  });

  it("uses alternative and Japanese titles and checks the year", () => {
    const score = detailedScore(metadata, {
      title: "Kaede to Suzu The Animation",
      slug: "kaede-to-suzu-the-animation",
      aka: { "en-us": "Love Me: Kaede and Suzu The Animation" },
      startDate: "2022-03-25",
      genres: [],
      episodes: [{ number: 1 }, { number: 2 }],
    });
    expect(score).toBeGreaterThanOrEqual(0.98);
  });

  it("adds season-aware queries before the base title", () => {
    expect(buildSearchQueries({ ...metadata, provider: "imdb", season: 2 }, 3)).toEqual([
      "Kaede to Suzu 2nd Season",
      "Kaede to Suzu Season 2",
      "Kaede to Suzu 2",
    ]);
  });

  it("recognizes numeric and written season markers", () => {
    expect(inferSeasonNumber("Haikyu!! 3rd Season")).toBe(3);
    expect(inferSeasonNumber("Haikyuu!! Second Season")).toBe(2);
    expect(inferSeasonNumber("Temporada 4")).toBe(4);
  });

  it("rejects the base entry and accepts the split entry for a later season", () => {
    const seasonThree: MediaMetadata = {
      provider: "imdb",
      baseId: "tt3398540",
      type: "series",
      title: "Haikyu!!",
      aliases: ["Haikyuu!!"],
      year: 2014,
      season: 3,
      episode: 1,
      seasonYear: 2016,
      seasonEpisodeCount: 10,
    };
    const base = {
      title: "Haikyuu!!", slug: "haikyuu", aka: {}, startDate: "2014-04-06",
      category: { name: "TV Anime", slug: "tv-anime" }, genres: [],
      episodes: Array.from({ length: 25 }, (_, index) => ({ number: index + 1 })),
    };
    const third = {
      title: "Haikyuu!! Karasuno Koukou vs. Shiratorizawa Gakuen Koukou",
      slug: "haikyuu-third-season",
      aka: { "en-us": "Haikyu!! 3rd Season" },
      startDate: "2016-10-08",
      category: { name: "TV Anime", slug: "tv-anime" }, genres: [],
      episodes: Array.from({ length: 10 }, (_, index) => ({ number: index + 1 })),
    };
    expect(isSeasonCompatible(seasonThree, base)).toBe(false);
    expect(isSeasonCompatible(seasonThree, third)).toBe(true);
    expect(detailedScore(seasonThree, third)).toBeGreaterThan(detailedScore(seasonThree, base));
  });

  it("uses year and episode count for a named season without a number", () => {
    const seasonFour: MediaMetadata = {
      provider: "imdb", baseId: "tt3398540", type: "series", title: "Haikyu!!",
      aliases: ["Haikyuu!!"], season: 4, episode: 1, seasonYear: 2020, seasonEpisodeCount: 25,
    };
    expect(isSeasonCompatible(seasonFour, {
      title: "Haikyuu!! To the Top", slug: "haikyuu-to-the-top", aka: {},
      startDate: "2020-01-11", category: { name: "TV Anime", slug: "tv-anime" }, genres: [],
      episodes: Array.from({ length: 25 }, (_, index) => ({ number: index + 1 })),
    })).toBe(true);
    expect(isSeasonCompatible(seasonFour, {
      title: "Haikyuu!! Riku vs. Kuu", slug: "haikyuu-riku-vs-kuu", aka: {},
      startDate: "2020-01-22", category: { name: "OVA", slug: "ova" }, genres: [],
      episodes: [{ number: 1 }, { number: 2 }],
    })).toBe(false);
  });
});
