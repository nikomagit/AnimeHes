import { describe, expect, it } from "vitest";
import { parseMediaId, parseMediaType } from "../src/metadata/media-id.js";

describe("Nuvio media IDs", () => {
  it("parses IMDb, TMDB and Kitsu episode IDs", () => {
    expect(parseMediaId("series", "tt1234567:2:4")).toEqual({
      provider: "imdb", baseId: "tt1234567", season: 2, episode: 4,
    });
    expect(parseMediaId("series", "tmdb:123:1:2")).toEqual({
      provider: "tmdb", baseId: "123", season: 1, episode: 2,
    });
    expect(parseMediaId("series", "kitsu:456:3")).toEqual({
      provider: "kitsu", baseId: "456", season: 1, episode: 3,
    });
  });

  it("rejects malformed IDs and unsupported types", () => {
    expect(() => parseMediaType("anime")).toThrow();
    expect(() => parseMediaId("movie", "tt1234567:1:1")).toThrow();
    expect(() => parseMediaId("series", "tmdb:nope:1:1")).toThrow();
  });
});
