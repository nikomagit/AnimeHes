import type { AppConfig } from "../config.js";
import {
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
          ? this.resolvePublicTmdb(type, parsed)
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
    try {
      return await this.resolveStremioMeta(
        type,
        parsed,
        this.config.metadataBaseUrl,
        parsed.baseId,
        "Cinemeta",
      );
    } catch (error) {
      if (!(error instanceof UpstreamHttpError && error.upstreamStatus === 404)) {
        // Fall through to IMDb's public suggestion endpoint.
      }
    }
    return this.resolveImdbSuggestion(type, parsed);
  }

  private async resolveStremioMeta(
    type: MediaType,
    parsed: ParsedMediaId,
    baseUrl: string,
    resourceId: string,
    upstream: string,
  ): Promise<MediaMetadata> {
    const url = new URL(
      `/meta/${type}/${encodeURIComponent(resourceId)}.json`,
      `${baseUrl}/`,
    );
    let payload: Record<string, unknown> | undefined;
    try {
      payload = record(JSON.parse(await this.request(url, this.options(upstream))));
    } catch (error) {
      if (error instanceof UpstreamHttpError) throw error;
      throw new UpstreamPayloadError(upstream, "invalid JSON response");
    }
    const meta = record(payload?.meta);
    const title = text(meta?.name);
    if (!title) throw new MetadataUnavailableError();
    const rawAliases = Array.isArray(meta?.aliases) ? meta.aliases : [];
    const aliases = uniqueStrings([title, meta?.originalName, ...rawAliases]);
    const videos = Array.isArray(meta?.videos) ? (meta.videos as CinemetaVideo[]) : [];
    const episodeVideo = videos.find((video) => {
      const exactId = text(video.id) === `${resourceId}:${parsed.season}:${parsed.episode}`;
      return exactId ||
        (Number(video.season) === parsed.season && Number(video.episode) === parsed.episode);
    });
    const episodeTitle = text(episodeVideo?.name ?? episodeVideo?.title);
    const seasonVideos = parsed.season === undefined
      ? []
      : videos.filter((video) => Number(video.season) === parsed.season);
    const seasonYear = yearFrom(episodeVideo?.released ?? seasonVideos[0]?.released);
    const seasonEpisodeCount = seasonVideos.length || undefined;
    const rawSeasons = Array.isArray(meta?.seasons) ? meta.seasons.map(record) : [];
    const seasonRecord = rawSeasons.find((item) => Number(item?.season) === parsed.season);
    const seasonTitle = text(seasonRecord?.name ?? seasonRecord?.title);
    const year = yearFrom(meta?.year ?? meta?.releaseInfo ?? meta?.released);
    return {
      ...parsed,
      type,
      title,
      aliases,
      ...(year === undefined ? {} : { year }),
      ...(episodeTitle ? { episodeTitle } : {}),
      ...(seasonTitle ? { seasonTitle } : {}),
      ...(seasonYear === undefined ? {} : { seasonYear }),
      ...(seasonEpisodeCount === undefined ? {} : { seasonEpisodeCount }),
    };
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

  private async resolvePublicTmdb(type: MediaType, parsed: ParsedMediaId): Promise<MediaMetadata> {
    try {
      return await this.resolveStremioMeta(
        type,
        parsed,
        this.config.metadataFallbackBaseUrl,
        `tmdb:${parsed.baseId}`,
        "Public metadata",
      );
    } catch (error) {
      if (error instanceof MetadataUnavailableError) throw error;
      if (error instanceof UpstreamHttpError && error.upstreamStatus === 404) {
        throw new MetadataUnavailableError();
      }
      throw error;
    }
  }
}
