import { describe, expect, it } from "vitest";
import { parseMediaId, parseMediaType } from "../src/metadata/media-id.js";
import { parseProviderMediaId, providerMediaId } from "../src/metadata/provider-id.js";

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

  it("creates and parses stable AnimeHes provider and episode IDs", () => {
    expect(providerMediaId("animeav1", "one-piece", 1176)).toBe("animehes:animeav1:one-piece:1176");
    expect(parseProviderMediaId("animehes:animeav1:one-piece:1176")).toEqual({
      provider: "animeav1", slug: "one-piece", episode: 1176,
    });
    expect(parseProviderMediaId("animehes:hentaila:itadaki-seieki")).toEqual({
      provider: "hentaila", slug: "itadaki-seieki",
    });
    expect(() => parseProviderMediaId("animehes:animeav1:../admin")).toThrow();
  });

  it("rejects malformed IDs and unsupported types", () => {
    expect(() => parseMediaType("anime")).toThrow();
    expect(() => parseMediaId("movie", "tt1234567:1:1")).toThrow();
    expect(() => parseMediaId("series", "tmdb:nope:1:1")).toThrow();
  });
});
