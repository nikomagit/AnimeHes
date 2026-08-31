import { describe, expect, it } from "vitest";
import { buildSearchQueries, detailedScore, normalizeTitle, titleSimilarity } from "../src/services/matching.js";
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
      episodes: [{ number: 1 }, { number: 2 }],
    });
    expect(score).toBeGreaterThanOrEqual(0.98);
  });

  it("adds season-aware queries before the base title", () => {
    expect(buildSearchQueries({ ...metadata, season: 2 }, 3)).toEqual([
      "Kaede to Suzu Season 2",
      "Kaede to Suzu 2",
      "Kaede to Suzu",
    ]);
  });
});
