import type { AppConfig } from "../config.js";
import { UpstreamHttpError, UpstreamPayloadError } from "../errors.js";
import { AsyncTtlCache } from "../lib/cache.js";
import { fetchText, type FetchText } from "../lib/http.js";
import type { ExternalIds, MediaType, ParsedMediaId } from "../types.js";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function imdbId(value: unknown): string | undefined {
  return typeof value === "string" && /^tt\d{7,10}$/u.test(value) ? value : undefined;
}

export interface AnimeMapping {
  title?: string;
  externalIds: ExternalIds;
  mediaType?: MediaType;
  season?: number;
}

/** Lightweight client for the public cross-database map maintained by nattadasu/animeApi. */
export class AnimeMappingClient {
  private readonly cache: AsyncTtlCache<string, AnimeMapping | null>;

  constructor(
    private readonly config: AppConfig,
    private readonly request: FetchText = fetchText,
  ) {
    this.cache = new AsyncTtlCache(config.metadataCacheTtlMs, config.cacheMaxEntries);
  }

  resolve(
    type: MediaType,
    parsed: ParsedMediaId,
    hints: ExternalIds = {},
  ): Promise<AnimeMapping | null> {
    const key = [type, parsed.provider, parsed.baseId, parsed.season, hints.tmdb].join(":");
    return this.cache.getOrCreate(key, () => this.resolveUncached(type, parsed, hints));
  }

  private async resolveUncached(
    type: MediaType,
    parsed: ParsedMediaId,
    hints: ExternalIds,
  ): Promise<AnimeMapping | null> {
    const seasonAware = parsed.provider === "imdb"
      || parsed.provider === "tmdb"
      || parsed.provider === "tvdb";
    if (type === "series" && parsed.season !== undefined && seasonAware) {
      if (parsed.provider === "tvdb") {
        const seasonal = await this.fetchMapping(
          `thetvdb/series/${parsed.baseId}/seasons/${parsed.season}`,
        );
        if (seasonal && (!seasonal.mediaType || seasonal.mediaType === type)) return seasonal;
      }
      const tmdb = parsed.provider === "tmdb" ? positiveInteger(parsed.baseId) : hints.tmdb;
      if (tmdb !== undefined) {
        const seasonal = await this.fetchMapping(`themoviedb/tv/${tmdb}/seasons/${parsed.season}`);
        if (seasonal && (!seasonal.mediaType || seasonal.mediaType === type)) return seasonal;
      }
    }

    const path = this.pathFor(type, parsed);
    const base = await this.fetchMapping(path);
    if (!base || base.mediaType && base.mediaType !== type) return null;

    if (type === "series" && parsed.season !== undefined && seasonAware
      && base.externalIds.tmdb !== undefined) {
      const seasonal = await this.fetchMapping(
        `themoviedb/tv/${base.externalIds.tmdb}/seasons/${parsed.season}`,
      );
      if (seasonal && (!seasonal.mediaType || seasonal.mediaType === type)) return seasonal;
    }
    return base;
  }

  private pathFor(type: MediaType, parsed: ParsedMediaId): string {
    switch (parsed.provider) {
      case "imdb": return `imdb/${parsed.baseId}`;
      case "tmdb": return `themoviedb/${type === "movie" ? "movie" : "tv"}/${parsed.baseId}`;
      case "tvdb": return `thetvdb/series/${parsed.baseId}`;
      case "kitsu": return `kitsu/${parsed.baseId}`;
      case "anilist": return `anilist/${parsed.baseId}`;
      case "mal": return `myanimelist/${parsed.baseId}`;
      case "anidb": return `anidb/${parsed.baseId}`;
    }
  }

  private async fetchMapping(path: string): Promise<AnimeMapping | null> {
    const url = new URL(path, `${this.config.animeMappingBaseUrl}/`);
    let payload: Record<string, unknown> | undefined;
    try {
      payload = record(JSON.parse(await this.request(url, {
        timeoutMs: this.config.metadataTimeoutMs,
        maxBytes: this.config.maxResponseBytes,
        upstream: "Anime ID mapping",
        headers: { accept: "application/json", "user-agent": this.config.userAgent },
      })));
    } catch (error) {
      if (error instanceof UpstreamHttpError && error.upstreamStatus === 404) return null;
      if (error instanceof SyntaxError) {
        throw new UpstreamPayloadError("Anime ID mapping", "invalid JSON response");
      }
      throw error;
    }
    if (!payload) throw new UpstreamPayloadError("Anime ID mapping", "invalid mapping object");
    const imdb = imdbId(payload.imdb);
    const tmdb = positiveInteger(payload.themoviedb);
    const kitsu = positiveInteger(payload.kitsu);
    const anilist = positiveInteger(payload.anilist);
    const mal = positiveInteger(payload.myanimelist);
    const anidb = positiveInteger(payload.anidb);
    const tvdb = positiveInteger(payload.thetvdb);
    const externalIds: ExternalIds = {
      ...(imdb ? { imdb } : {}),
      ...(tmdb ? { tmdb } : {}),
      ...(kitsu ? { kitsu } : {}),
      ...(anilist ? { anilist } : {}),
      ...(mal ? { mal } : {}),
      ...(anidb ? { anidb } : {}),
      ...(tvdb ? { tvdb } : {}),
    };
    const rawType = payload.themoviedb_type;
    const mediaType = rawType === "movie" ? "movie" : rawType === "tv" ? "series" : undefined;
    const title = typeof payload.title === "string" && payload.title.trim()
      ? payload.title.trim()
      : undefined;
    const season = positiveInteger(payload.trakt_season);
    return {
      externalIds,
      ...(title ? { title } : {}),
      ...(mediaType ? { mediaType } : {}),
      ...(season ? { season } : {}),
    };
  }
}
