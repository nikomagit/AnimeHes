export interface AppConfig {
  host: string;
  port: number;
  logLevel: string;
  hentailaBaseUrl: string;
  metadataBaseUrl: string;
  tmdbBaseUrl: string;
  tmdbApiKey?: string;
  tmdbReadAccessToken?: string;
  tmdbLanguage: string;
  requestTimeoutMs: number;
  metadataTimeoutMs: number;
  maxResponseBytes: number;
  maxSearchQueries: number;
  maxCandidates: number;
  maxStreams: number;
  minMatchScore: number;
  searchCacheTtlMs: number;
  mediaCacheTtlMs: number;
  metadataCacheTtlMs: number;
  cacheMaxEntries: number;
  userAgent: string;
  playbackUserAgent: string;
}

function optionalSecret(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  if (!value) return undefined;
  if (/[\r\n]/.test(value)) throw new Error(`${name} contains invalid characters`);
  return value;
}

function integer(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function decimal(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a number between ${minimum} and ${maximum}`);
  }
  return value;
}

function baseUrl(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const raw = env[name]?.trim() || fallback;
  const value = new URL(raw);
  if (!(value.protocol === "http:" || value.protocol === "https:")) {
    throw new Error(`${name} must use http or https`);
  }
  if (value.username || value.password) {
    throw new Error(`${name} must not contain embedded credentials`);
  }
  value.pathname = value.pathname.replace(/\/+$/, "");
  value.search = "";
  value.hash = "";
  return value.toString().replace(/\/$/, "");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = integer(env, "PORT", 7100, 1, 65_535);
  const tmdbApiKey = optionalSecret(env, "TMDB_API_KEY");
  const tmdbReadAccessToken = optionalSecret(env, "TMDB_READ_ACCESS_TOKEN");
  const tmdbLanguage = env.TMDB_LANGUAGE?.trim() || "en-US";
  if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(tmdbLanguage)) {
    throw new Error("TMDB_LANGUAGE must look like en or en-US");
  }

  return {
    host: env.HOST?.trim() || "0.0.0.0",
    port,
    logLevel: env.LOG_LEVEL?.trim() || "info",
    hentailaBaseUrl: baseUrl(env, "HENTAILA_BASE_URL", "https://hentaila.com"),
    metadataBaseUrl: baseUrl(env, "METADATA_BASE_URL", "https://v3-cinemeta.strem.io"),
    tmdbBaseUrl: baseUrl(env, "TMDB_BASE_URL", "https://api.themoviedb.org/3"),
    ...(tmdbApiKey ? { tmdbApiKey } : {}),
    ...(tmdbReadAccessToken ? { tmdbReadAccessToken } : {}),
    tmdbLanguage,
    requestTimeoutMs: integer(env, "REQUEST_TIMEOUT_MS", 10_000, 1_000, 60_000),
    metadataTimeoutMs: integer(env, "METADATA_TIMEOUT_MS", 6_000, 1_000, 60_000),
    maxResponseBytes: integer(
      env,
      "MAX_RESPONSE_BYTES",
      5 * 1024 * 1024,
      64 * 1024,
      20 * 1024 * 1024,
    ),
    maxSearchQueries: integer(env, "MAX_SEARCH_QUERIES", 4, 1, 8),
    maxCandidates: integer(env, "MAX_CANDIDATES", 5, 1, 12),
    maxStreams: integer(env, "MAX_STREAMS", 3, 1, 8),
    minMatchScore: decimal(env, "MIN_MATCH_SCORE", 0.72, 0.5, 1),
    searchCacheTtlMs: integer(
      env,
      "SEARCH_CACHE_TTL_MS",
      60_000,
      0,
      24 * 60 * 60_000,
    ),
    mediaCacheTtlMs: integer(
      env,
      "MEDIA_CACHE_TTL_MS",
      6 * 60 * 60_000,
      0,
      7 * 24 * 60 * 60_000,
    ),
    metadataCacheTtlMs: integer(
      env,
      "METADATA_CACHE_TTL_MS",
      24 * 60 * 60_000,
      0,
      7 * 24 * 60 * 60_000,
    ),
    cacheMaxEntries: integer(env, "CACHE_MAX_ENTRIES", 500, 1, 10_000),
    userAgent:
      env.USER_AGENT?.trim() || "AnimeHes/1.0 (+self-hosted)",
    playbackUserAgent:
      env.PLAYBACK_USER_AGENT?.trim() ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  };
}
