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

  it("matches a first-installment metadata suffix to the base theatrical title", () => {
    expect(titleSimilarity("Dune: Part One", "Dune")).toBeGreaterThan(0.95);
    expect(titleSimilarity("Dune: Part One", "Dune: Part Two")).toBeLessThan(0.9);
    expect(buildSearchQueries({
      provider: "imdb", baseId: "tt1160419", type: "movie", title: "Dune: Part One",
      aliases: ["Dune: Part One"], year: 2021,
    }, 4)).toEqual(["Dune: Part One", "Dune"]);
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

  it("accepts an exact later season inside a conventional multi-season series", () => {
    const breakingBad: MediaMetadata = {
      provider: "imdb", baseId: "tt0903747", type: "series", title: "Breaking Bad",
      aliases: ["Breaking Bad"], year: 2008, season: 3, episode: 5,
      seasonYear: 2010, seasonEpisodeCount: 13,
    };
    const media = {
      title: "Breaking Bad", slug: "series-breaking-bad", aka: {}, startDate: "2008-01-20",
      genres: [], episodes: Array.from({ length: 13 }, (_, index) => ({
        number: 30_001 + index, season: 3, relativeNumber: index + 1,
      })),
    };
    expect(isSeasonCompatible(breakingBad, media)).toBe(true);
    expect(detailedScore(breakingBad, media)).toBeGreaterThan(0.9);
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

  it("selects Haikyuu seasons 1 through 4 without falling back to season 1", () => {
    const candidates = [
      {
        title: "Haikyuu!!", slug: "haikyuu", aka: {}, startDate: "2014-04-06",
        category: { name: "TV Anime", slug: "tv-anime" }, genres: [],
        episodes: Array.from({ length: 25 }, (_, index) => ({ number: index + 1 })),
      },
      {
        title: "Haikyuu!! Second Season", slug: "haikyuu-second-season", aka: {}, startDate: "2015-10-04",
        category: { name: "TV Anime", slug: "tv-anime" }, genres: [],
        episodes: Array.from({ length: 25 }, (_, index) => ({ number: index + 1 })),
      },
      {
        title: "Haikyuu!! Karasuno Koukou vs. Shiratorizawa Gakuen Koukou", slug: "haikyuu-third-season",
        aka: { "en-us": "Haikyu!! 3rd Season" }, startDate: "2016-10-08",
        category: { name: "TV Anime", slug: "tv-anime" }, genres: [],
        episodes: Array.from({ length: 10 }, (_, index) => ({ number: index + 1 })),
      },
      {
        title: "Haikyuu!! To the Top", slug: "haikyuu-to-the-top", aka: {}, startDate: "2020-01-11",
        category: { name: "TV Anime", slug: "tv-anime" }, genres: [],
        episodes: Array.from({ length: 25 }, (_, index) => ({ number: index + 1 })),
      },
    ];
    const expectations = [
      { season: 1, seasonYear: 2014, seasonEpisodeCount: 25, slug: "haikyuu" },
      { season: 2, seasonYear: 2015, seasonEpisodeCount: 25, slug: "haikyuu-second-season" },
      { season: 3, seasonYear: 2016, seasonEpisodeCount: 10, slug: "haikyuu-third-season" },
      { season: 4, seasonYear: 2020, seasonEpisodeCount: 25, slug: "haikyuu-to-the-top" },
    ];
    for (const expected of expectations) {
      const wanted: MediaMetadata = {
        provider: "imdb", baseId: "tt3398540", type: "series", title: "Haikyu!!",
        aliases: ["Haikyuu!!"], season: expected.season, episode: 1,
        seasonYear: expected.seasonYear, seasonEpisodeCount: expected.seasonEpisodeCount,
      };
      expect(candidates.filter((candidate) => isSeasonCompatible(wanted, candidate)).map((candidate) => candidate.slug))
        .toEqual([expected.slug]);
    }
  });
});
