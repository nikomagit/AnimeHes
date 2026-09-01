import type { AppConfig } from "../config.js";
import {
  AppConfigurationError,
  MetadataUnavailableError,
  UpstreamHttpError,
  UpstreamPayloadError,
} from "../errors.js";
import { AsyncTtlCache } from "../lib/cache.js";
import { fetchText, type FetchText } from "../lib/http.js";
import type { MediaMetadata, MediaType, ParsedMediaId } from "../types.js";

interface CinemetaVideo {
  id?: unknown;
  name?: unknown;
  title?: unknown;
  season?: unknown;
  episode?: unknown;
  released?: unknown;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function yearFrom(value: unknown): number | undefined {
  if (typeof value === "number" && value >= 1900 && value <= 2200) return value;
  const match = String(value ?? "").match(/\b(19\d{2}|20\d{2}|21\d{2})\b/);
  return match?.[1] ? Number(match[1]) : undefined;
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.map(text).filter((value): value is string => Boolean(value)))];
}

function alternativeTitles(payload: Record<string, unknown> | undefined): string[] {
  const group = record(payload?.alternative_titles);
  const values = Array.isArray(group?.titles) ? group.titles : Array.isArray(group?.results) ? group.results : [];
  return values.map(record).map((item) => text(item?.title)).filter((item): item is string => Boolean(item));
}

export interface MetadataProvider {
  resolve(type: MediaType, parsed: ParsedMediaId): Promise<MediaMetadata>;
}

export class RemoteMetadataProvider implements MetadataProvider {
  private readonly cache: AsyncTtlCache<string, MediaMetadata>;

  constructor(
    private readonly config: AppConfig,
    private readonly request: FetchText = fetchText,
  ) {
    this.cache = new AsyncTtlCache(config.metadataCacheTtlMs, config.cacheMaxEntries);
  }

  resolve(type: MediaType, parsed: ParsedMediaId): Promise<MediaMetadata> {
    const key = [type, parsed.provider, parsed.baseId, parsed.season, parsed.episode].join(":");
    return this.cache.getOrCreate(key, () =>
      parsed.provider === "kitsu"
        ? this.resolveKitsu(type, parsed)
        : parsed.provider === "tmdb"
          ? this.resolveTmdb(type, parsed)
          : this.resolveImdb(type, parsed),
    );
  }

  private options(upstream: string, accept = "application/json") {
    return {
      timeoutMs: this.config.metadataTimeoutMs,
      maxBytes: this.config.maxResponseBytes,
      upstream,
      headers: { accept, "user-agent": this.config.userAgent },
    };
  }

  private async resolveImdb(type: MediaType, parsed: ParsedMediaId): Promise<MediaMetadata> {
    const url = new URL(
      `/meta/${type}/${encodeURIComponent(parsed.baseId)}.json`,
      `${this.config.metadataBaseUrl}/`,
    );
    try {
      const payload = record(JSON.parse(await this.request(url, this.options("Cinemeta"))));
      const meta = record(payload?.meta);
      const title = text(meta?.name);
      if (title) {
        const rawAliases = Array.isArray(meta?.aliases) ? meta.aliases : [];
        const aliases = uniqueStrings([title, ...rawAliases]);
        const videos = Array.isArray(meta?.videos) ? (meta.videos as CinemetaVideo[]) : [];
        const episodeVideo = videos.find((video) => {
          const exactId = text(video.id) === `${parsed.baseId}:${parsed.season}:${parsed.episode}`;
          return exactId ||
            (Number(video.season) === parsed.season && Number(video.episode) === parsed.episode);
        });
        const episodeTitle = text(episodeVideo?.name ?? episodeVideo?.title);
        const seasonVideos = parsed.season === undefined
          ? []
          : videos.filter((video) => Number(video.season) === parsed.season);
        const seasonYear = yearFrom(episodeVideo?.released ?? seasonVideos[0]?.released);
        const seasonEpisodeCount = seasonVideos.length || undefined;
        const year = yearFrom(meta?.year ?? meta?.releaseInfo ?? meta?.released);
        return {
          ...parsed,
          type,
          title,
          aliases,
          ...(year === undefined ? {} : { year }),
          ...(episodeTitle ? { episodeTitle } : {}),
          ...(seasonYear === undefined ? {} : { seasonYear }),
          ...(seasonEpisodeCount === undefined ? {} : { seasonEpisodeCount }),
        };
      }
    } catch (error) {
      if (!(error instanceof UpstreamHttpError && error.upstreamStatus === 404)) {
        // Fall through to IMDb's public suggestion endpoint.
      }
    }
    return this.resolveImdbSuggestion(type, parsed);
  }

  private async resolveImdbSuggestion(type: MediaType, parsed: ParsedMediaId): Promise<MediaMetadata> {
    const url = new URL(
      `https://v3.sg.media-imdb.com/suggestion/a/${encodeURIComponent(parsed.baseId)}.json`,
    );
    try {
      const payload = record(JSON.parse(await this.request(url, this.options("IMDb metadata"))));
      const results = Array.isArray(payload?.d) ? payload.d : [];
      const match = results.map(record).find((item) => text(item?.id) === parsed.baseId);
      const title = text(match?.l);
      if (!title) throw new MetadataUnavailableError();
      const year = yearFrom(match?.y ?? match?.yr);
      return {
        ...parsed,
        type,
        title,
        aliases: [title],
        ...(year === undefined ? {} : { year }),
      };
    } catch (error) {
      if (error instanceof MetadataUnavailableError) throw error;
      throw new MetadataUnavailableError();
    }
  }

  private async resolveKitsu(type: MediaType, parsed: ParsedMediaId): Promise<MediaMetadata> {
    const url = new URL(`https://kitsu.io/api/edge/anime/${encodeURIComponent(parsed.baseId)}`);
    try {
      const payload = record(
        JSON.parse(await this.request(url, this.options("Kitsu metadata", "application/vnd.api+json"))),
      );
      const attributes = record(record(payload?.data)?.attributes);
      const titles = record(attributes?.titles);
      const abbreviations = Array.isArray(attributes?.abbreviatedTitles)
        ? attributes.abbreviatedTitles
        : [];
      const aliases = uniqueStrings([
        attributes?.canonicalTitle,
        titles?.en,
        titles?.en_jp,
        titles?.ja_jp,
        ...abbreviations,
      ]);
      const title = aliases[0];
      if (!title) throw new MetadataUnavailableError();
      const year = yearFrom(attributes?.startDate);
      return {
        ...parsed,
        type,
        title,
        aliases,
        ...(year === undefined ? {} : { year }),
      };
    } catch (error) {
      if (error instanceof MetadataUnavailableError) throw error;
      throw new MetadataUnavailableError();
    }
  }

  private async resolveTmdb(type: MediaType, parsed: ParsedMediaId): Promise<MediaMetadata> {
    if (!this.config.tmdbReadAccessToken && !this.config.tmdbApiKey) {
      throw new AppConfigurationError(
        "TMDB IDs require TMDB_API_KEY or TMDB_READ_ACCESS_TOKEN on the addon server",
      );
    }
    const resource = type === "movie" ? "movie" : "tv";
    const url = new URL(`${resource}/${encodeURIComponent(parsed.baseId)}`, `${this.config.tmdbBaseUrl}/`);
    url.searchParams.set("language", this.config.tmdbLanguage);
    url.searchParams.set("append_to_response", "alternative_titles");
    if (!this.config.tmdbReadAccessToken && this.config.tmdbApiKey) {
      url.searchParams.set("api_key", this.config.tmdbApiKey);
    }

    let body: string;
    try {
      body = await this.request(url, {
        ...this.options("TMDB metadata"),
        headers: {
          accept: "application/json",
          "user-agent": this.config.userAgent,
          ...(this.config.tmdbReadAccessToken
            ? { authorization: `Bearer ${this.config.tmdbReadAccessToken}` }
            : {}),
        },
      });
    } catch (error) {
      if (error instanceof UpstreamHttpError && error.upstreamStatus === 404) {
        throw new MetadataUnavailableError();
      }
      throw error;
    }

    let payload: Record<string, unknown> | undefined;
    try {
      payload = record(JSON.parse(body));
    } catch {
      throw new UpstreamPayloadError("TMDB metadata", "invalid JSON response");
    }
    const title = text(type === "movie" ? payload?.title : payload?.name);
    const originalTitle = text(type === "movie" ? payload?.original_title : payload?.original_name);
    if (!title && !originalTitle) throw new MetadataUnavailableError();
    const aliases = uniqueStrings([title, originalTitle, ...alternativeTitles(payload)]);
    const year = yearFrom(type === "movie" ? payload?.release_date : payload?.first_air_date);
    const seasonMetadata = type === "series" && parsed.season !== undefined
      ? await this.resolveTmdbSeason(parsed.baseId, parsed.season)
      : {};
    return {
      ...parsed,
      type,
      title: title ?? originalTitle!,
      aliases,
      ...(year === undefined ? {} : { year }),
      ...seasonMetadata,
    };
  }

  private async resolveTmdbSeason(
    baseId: string,
    season: number,
  ): Promise<Pick<MediaMetadata, "seasonTitle" | "seasonYear" | "seasonEpisodeCount">> {
    const url = new URL(
      `tv/${encodeURIComponent(baseId)}/season/${season}`,
      `${this.config.tmdbBaseUrl}/`,
    );
    url.searchParams.set("language", this.config.tmdbLanguage);
    if (!this.config.tmdbReadAccessToken && this.config.tmdbApiKey) {
      url.searchParams.set("api_key", this.config.tmdbApiKey);
    }
    try {
      const payload = record(JSON.parse(await this.request(url, {
        ...this.options("TMDB season metadata"),
        headers: {
          accept: "application/json",
          "user-agent": this.config.userAgent,
          ...(this.config.tmdbReadAccessToken
            ? { authorization: `Bearer ${this.config.tmdbReadAccessToken}` }
            : {}),
        },
      })));
      const seasonTitle = text(payload?.name);
      const seasonYear = yearFrom(payload?.air_date);
      const episodes = Array.isArray(payload?.episodes) ? payload.episodes : [];
      const seasonEpisodeCount = episodes.length || undefined;
      return {
        ...(seasonTitle ? { seasonTitle } : {}),
        ...(seasonYear === undefined ? {} : { seasonYear }),
        ...(seasonEpisodeCount === undefined ? {} : { seasonEpisodeCount }),
      };
    } catch {
      // The base metadata remains useful if a season page is temporarily unavailable.
      return {};
    }
  }
}
