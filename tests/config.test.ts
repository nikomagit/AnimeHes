import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("configuration without private metadata credentials", () => {
  it("starts with public metadata defaults and exposes no credential fields", () => {
    const config = loadConfig({});
    expect(config.metadataFallbackBaseUrl).toMatch(/^https:\/\//);
    expect(config.jkAnimeBaseUrl).toBe("https://jkanime.net");
    expect(config).not.toHaveProperty("tmdbApiKey");
    expect(config).not.toHaveProperty("tmdbReadAccessToken");
  });
});
