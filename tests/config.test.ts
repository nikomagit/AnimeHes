import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("metadata configuration", () => {
  it("starts with public metadata defaults and no embedded credential", () => {
    const config = loadConfig({});
    expect(config.metadataFallbackBaseUrl).toMatch(/^https:\/\//);
    expect(config.jkAnimeBaseUrl).toBe("https://jkanime.net");
    expect(config.animeMappingBaseUrl).toBe("https://animeapi.my.id");
    expect(config.anilistBaseUrl).toBe("https://graphql.anilist.co");
    expect(config).not.toHaveProperty("tmdbApiKey");
    expect(config.tmdbLanguage).toBe("es-ES");
  });

  it("accepts a TMDB API key only through the runtime environment", () => {
    const config = loadConfig({ TMDB_API_KEY: "private-test-key", TMDB_LANGUAGE: "es-CL" });
    expect(config.tmdbApiKey).toBe("private-test-key");
    expect(config.tmdbLanguage).toBe("es-CL");
  });
});
