import type { AppConfig } from "../src/config.js";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    host: "127.0.0.1",
    port: 7100,
    logLevel: "silent",
    hentailaBaseUrl: "https://hentaila.com",
    metadataBaseUrl: "https://v3-cinemeta.strem.io",
    tmdbBaseUrl: "https://api.themoviedb.org/3",
    tmdbLanguage: "en-US",
    requestTimeoutMs: 2_000,
    metadataTimeoutMs: 2_000,
    maxResponseBytes: 1024 * 1024,
    maxSearchQueries: 4,
    maxCandidates: 5,
    maxStreams: 3,
    minMatchScore: 0.72,
    searchCacheTtlMs: 60_000,
    mediaCacheTtlMs: 60_000,
    metadataCacheTtlMs: 60_000,
    cacheMaxEntries: 50,
    userAgent: "Test/1.0",
    playbackUserAgent: "Mozilla/5.0 TestBrowser/1.0",
    ...overrides,
  };
}
