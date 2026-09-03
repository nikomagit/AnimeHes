import type { AppConfig } from "../config.js";
import {
  MetadataUnavailableError,
  UpstreamHttpError,
  UpstreamPayloadError,
} from "../errors.js";
import { AsyncTtlCache } from "../lib/cache.js";
import { fetchText, type FetchText } from "../lib/http.js";
import type { ExternalIds, MediaMetadata, MediaType, ParsedMediaId } from "../types.js";
import { AniListMetadataClient } from "./anilist.js";
import { AnimeMappingClient } from "./anime-mapping.js";

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

function positiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function imdbId(value: unknown): string | undefined {
  const parsed = text(value);
  return parsed && /^tt\d{7,10}$/u.test(parsed) ? parsed : undefined;
}

function tmdbAliases(payload: Record<string, unknown>): string[] {
  const alternatives = record(payload.alternative_titles);
  const alternativeValues = Array.isArray(alternatives?.titles)
    ? alternatives.titles
    : Array.isArray(alternatives?.results) ? alternatives.results : [];
  const alternativeTitles = alternativeValues.flatMap((value) => {
    const item = record(value);
    return [item?.title, item?.name];
  });
  const translations = record(payload.translations)?.translations;
  const translatedTitles = Array.isArray(translations) ? translations.flatMap((value) => {
    const item = record(value);
    const language = text(item?.iso_639_1);
    if (language !== "es" && language !== "en") return [];
    const data = record(item?.data);
    return [data?.title, data?.name];
  }) : [];
  return uniqueStrings([
    payload.title,
    payload.name,
    payload.original_title,
    payload.original_name,
    ...alternativeTitles,
    ...translatedTitles,
  ]);
}

interface TmdbEnrichment {
  title: string;
  aliases: string[];
  year?: number;
  externalIds: ExternalIds;
}

export interface MetadataProvider {
  resolve(type: MediaType, parsed: ParsedMediaId): Promise<MediaMetadata>;
}

export class RemoteMetadataProvider implements MetadataProvider {
  private readonly cache: AsyncTtlCache<string, MediaMetadata>;
  private readonly mapping: AnimeMappingClient;
  private readonly anilist: AniListMetadataClient;

  constructor(
    private readonly config: AppConfig,
    private readonly request: FetchText = fetchText,
  ) {
    this.cache = new AsyncTtlCache(config.metadataCacheTtlMs, config.cacheMaxEntries);
    this.mapping = new AnimeMappingClient(config, request);
    this.anilist = new AniListMetadataClient(config, request);
  }

  resolve(type: MediaType, parsed: ParsedMediaId): Promise<MediaMetadata> {
    const key = [type, parsed.provider, parsed.baseId, parsed.season, parsed.episode].join(":");
    return this.cache.getOrCreate(key, () => this.resolveComplete(type, parsed));
  }

  private async resolveComplete(type: MediaType, parsed: ParsedMediaId): Promise<MediaMetadata> {
    let base: MediaMetadata;
    try {
      switch (parsed.provider) {
        case "imdb": base = await this.resolveImdb(type, parsed); break;
        case "tmdb": base = await this.resolvePublicTmdb(type, parsed); break;
        case "tvdb": base = await this.resolveMappedInput(type, parsed); break;
        case "kitsu": base = await this.resolveKitsu(type, parsed); break;
        case "anilist": base = await this.resolveAniListInput(type, parsed, false); break;
        case "mal": base = await this.resolveAniListInput(type, parsed, true); break;
        case "anidb": base = await this.resolveMappedInput(type, parsed); break;
      }
    } catch (error) {
      base = await this.resolveMappedFallback(type, parsed).catch(() => { throw error; });
    }

    const mapping = await this.mapping.resolve(type, parsed, base.externalIds).catch(() => null);
    const externalIds: ExternalIds = {
      ...this.sourceExternalId(parsed),
      ...base.externalIds,
      ...mapping?.externalIds,
    };
    const anilistId = externalIds.anilist;
    const anime = anilistId === undefined
      ? undefined
      : await this.anilist.resolveByAniList(anilistId).catch(() => undefined);
    Object.assign(externalIds, anime?.externalIds);

    const seasonSpecific = parsed.season !== undefined
      && parsed.season > 1
      && (parsed.provider === "imdb" || parsed.provider === "tmdb" || parsed.provider === "tvdb");
    const mappedAliases = uniqueStrings([mapping?.title, ...(anime?.aliases ?? [])]);
    const aliases = uniqueStrings([base.title, ...base.aliases, ...mappedAliases]);
    const seasonAliases = seasonSpecific ? mappedAliases : base.seasonAliases;
    return {
      ...base,
      aliases,
      externalIds,
      ...(base.year === undefined && anime?.year !== undefined ? { year: anime.year } : {}),
      ...(seasonAliases?.length ? { seasonAliases } : {}),
      ...(seasonSpecific && anime?.year !== undefined ? { seasonYear: anime.year } : {}),
      ...(seasonSpecific && anime?.episodeCount !== undefined
        ? { seasonEpisodeCount: anime.episodeCount }
        : {}),
    };
  }

  private async resolveMappedFallback(
    type: MediaType,
    parsed: ParsedMediaId,
  ): Promise<MediaMetadata> {
    const mapping = await this.mapping.resolve(type, parsed);
    if (!mapping) throw new MetadataUnavailableError();
    const anime = mapping.externalIds.anilist === undefined
      ? undefined
      : await this.anilist.resolveByAniList(mapping.externalIds.anilist).catch(() => undefined);
    const aliases = uniqueStrings([mapping.title, ...(anime?.aliases ?? [])]);
    const title = aliases[0];
    if (!title) throw new MetadataUnavailableError();
    const seasonSpecific = parsed.season !== undefined
      && parsed.season > 1
      && (parsed.provider === "imdb" || parsed.provider === "tmdb" || parsed.provider === "tvdb");
    return {
      ...parsed,
      type,
      title,
      aliases,
      externalIds: { ...this.sourceExternalId(parsed), ...mapping.externalIds, ...anime?.externalIds },
      ...(anime?.year === undefined ? {} : { year: anime.year }),
      ...(seasonSpecific ? { seasonAliases: aliases } : {}),
      ...(seasonSpecific && anime?.year !== undefined ? { seasonYear: anime.year } : {}),
      ...(anime?.episodeCount === undefined ? {} : { seasonEpisodeCount: anime.episodeCount }),
    };
  }

  private sourceExternalId(parsed: ParsedMediaId): ExternalIds {
    if (parsed.provider === "imdb") return { imdb: parsed.baseId };
    const id = positiveInteger(parsed.baseId);
    if (id === undefined) return {};
    return { [parsed.provider]: id };
  }

  private async resolveAniListInput(
    type: MediaType,
    parsed: ParsedMediaId,
    byMal: boolean,
  ): Promise<MediaMetadata> {
    const id = positiveInteger(parsed.baseId);
    if (id === undefined) throw new MetadataUnavailableError();
    const anime = byMal
      ? await this.anilist.resolveByMal(id)
      : await this.anilist.resolveByAniList(id);
    if (anime.type !== type) throw new MetadataUnavailableError();
    return {
      ...parsed,
      type,
      title: anime.title,
      aliases: anime.aliases,
      externalIds: { ...anime.externalIds, ...(byMal ? { mal: id } : { anilist: id }) },
      ...(anime.year === undefined ? {} : { year: anime.year }),
      ...(anime.episodeCount === undefined ? {} : { seasonEpisodeCount: anime.episodeCount }),
    };
  }

  private async resolveMappedInput(type: MediaType, parsed: ParsedMediaId): Promise<MediaMetadata> {
    const mapping = await this.mapping.resolve(type, parsed);
    if (!mapping) throw new MetadataUnavailableError();
    const anilist = mapping.externalIds.anilist === undefined
      ? undefined
      : await this.anilist.resolveByAniList(mapping.externalIds.anilist).catch(() => undefined);
    if (anilist && anilist.type !== type) throw new MetadataUnavailableError();
    const aliases = uniqueStrings([mapping.title, ...(anilist?.aliases ?? [])]);
    const title = aliases[0];
    if (!title) throw new MetadataUnavailableError();
    return {
      ...parsed,
      type,
      title,
      aliases,
      externalIds: { ...mapping.externalIds, ...anilist?.externalIds },
      ...(anilist?.year === undefined ? {} : { year: anilist.year }),
      ...(anilist?.episodeCount === undefined ? {} : { seasonEpisodeCount: anilist.episodeCount }),
    };
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
    if (this.config.tmdbApiKey) {
      try {
        return await this.resolveImdbThroughTmdb(type, parsed);
      } catch {
        // IMDb's public suggestion endpoint remains the final credential-free fallback.
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
    const baseTmdb = parsed.provider === "tmdb"
      ? positiveInteger(parsed.baseId)
      : positiveInteger(meta?.moviedb_id ?? meta?.tmdb_id);
    const enrichment = baseTmdb === undefined || !this.config.tmdbApiKey
      ? undefined
      : await this.resolveTmdbEnrichment(type, baseTmdb).catch(() => undefined);
    const aliases = uniqueStrings([title, meta?.originalName, ...rawAliases, ...(enrichment?.aliases ?? [])]);
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
    const baseImdb = parsed.provider === "imdb" ? imdbId(parsed.baseId) : imdbId(meta?.imdb_id);
    const resolvedImdb = baseImdb ?? enrichment?.externalIds.imdb;
    const resolvedTmdb = baseTmdb ?? enrichment?.externalIds.tmdb;
    const externalIds: ExternalIds = {
      ...(resolvedImdb ? { imdb: resolvedImdb } : {}),
      ...(resolvedTmdb ? { tmdb: resolvedTmdb } : {}),
    };
    return {
      ...parsed,
      type,
      title,
      aliases,
      externalIds,
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
        externalIds: { imdb: parsed.baseId },
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
        externalIds: { kitsu: Number(parsed.baseId) },
        ...(year === undefined ? {} : { year }),
      };
    } catch (error) {
      if (error instanceof MetadataUnavailableError) throw error;
      throw new MetadataUnavailableError();
    }
  }

  private async resolveTmdbEnrichment(type: MediaType, tmdb: number): Promise<TmdbEnrichment> {
    if (!this.config.tmdbApiKey) throw new MetadataUnavailableError();
    const resource = type === "movie" ? "movie" : "tv";
    const url = new URL(`${resource}/${tmdb}`, `${this.config.tmdbBaseUrl}/`);
    url.searchParams.set("api_key", this.config.tmdbApiKey);
    url.searchParams.set("language", this.config.tmdbLanguage);
    url.searchParams.set("append_to_response", "alternative_titles,external_ids,translations");
    let payload: Record<string, unknown> | undefined;
    try {
      payload = record(JSON.parse(await this.request(url, this.options("TMDB metadata"))));
    } catch (error) {
      if (error instanceof UpstreamHttpError && error.upstreamStatus === 404) {
        throw new MetadataUnavailableError();
      }
      if (error instanceof SyntaxError) throw new UpstreamPayloadError("TMDB metadata", "invalid JSON response");
      throw error;
    }
    const aliases = payload ? tmdbAliases(payload) : [];
    const title = aliases[0];
    if (!payload || !title) throw new MetadataUnavailableError();
    const external = record(payload.external_ids);
    const resolvedImdb = imdbId(payload.imdb_id ?? external?.imdb_id);
    const year = yearFrom(type === "movie" ? payload.release_date : payload.first_air_date);
    return {
      title,
      aliases,
      externalIds: { ...(resolvedImdb ? { imdb: resolvedImdb } : {}), tmdb },
      ...(year === undefined ? {} : { year }),
    };
  }

  private async resolveImdbThroughTmdb(type: MediaType, parsed: ParsedMediaId): Promise<MediaMetadata> {
    if (!this.config.tmdbApiKey) throw new MetadataUnavailableError();
    const url = new URL(`find/${encodeURIComponent(parsed.baseId)}`, `${this.config.tmdbBaseUrl}/`);
    url.searchParams.set("api_key", this.config.tmdbApiKey);
    url.searchParams.set("external_source", "imdb_id");
    const payload = record(JSON.parse(await this.request(url, this.options("TMDB ID conversion"))));
    const results = type === "movie" ? payload?.movie_results : payload?.tv_results;
    const first = Array.isArray(results) ? record(results[0]) : undefined;
    const tmdb = positiveInteger(first?.id);
    if (tmdb === undefined) throw new MetadataUnavailableError();
    const enrichment = await this.resolveTmdbEnrichment(type, tmdb);
    const seasonData = type === "series" && parsed.season !== undefined
      ? await this.resolveOfficialTmdbSeason(tmdb, parsed.season, parsed.episode)
      : {};
    return {
      ...parsed,
      type,
      title: enrichment.title,
      aliases: enrichment.aliases,
      externalIds: { ...enrichment.externalIds, imdb: parsed.baseId, tmdb },
      ...(enrichment.year === undefined ? {} : { year: enrichment.year }),
      ...seasonData,
    };
  }

  private async resolveOfficialTmdb(type: MediaType, parsed: ParsedMediaId): Promise<MediaMetadata> {
    const tmdb = positiveInteger(parsed.baseId);
    if (tmdb === undefined) throw new MetadataUnavailableError();
    const enrichment = await this.resolveTmdbEnrichment(type, tmdb);
    const seasonData = type === "series" && parsed.season !== undefined
      ? await this.resolveOfficialTmdbSeason(tmdb, parsed.season, parsed.episode)
      : {};
    return {
      ...parsed,
      type,
      title: enrichment.title,
      aliases: enrichment.aliases,
      externalIds: enrichment.externalIds,
      ...(enrichment.year === undefined ? {} : { year: enrichment.year }),
      ...seasonData,
    };
  }

  private async resolveOfficialTmdbSeason(
    tmdb: number,
    season: number,
    requestedEpisode: number | undefined,
  ): Promise<Pick<MediaMetadata, "episodeTitle" | "seasonTitle" | "seasonYear" | "seasonEpisodeCount">> {
    if (!this.config.tmdbApiKey) return {};
    const url = new URL(`tv/${tmdb}/season/${season}`, `${this.config.tmdbBaseUrl}/`);
    url.searchParams.set("api_key", this.config.tmdbApiKey);
    url.searchParams.set("language", this.config.tmdbLanguage);
    try {
      const payload = record(JSON.parse(await this.request(url, this.options("TMDB season metadata"))));
      const episodes = Array.isArray(payload?.episodes) ? payload.episodes.map(record) : [];
      const episode = episodes.find((item) => Number(item?.episode_number) === requestedEpisode);
      const episodeTitle = text(episode?.name);
      const seasonTitle = text(payload?.name);
      const seasonYear = yearFrom(payload?.air_date ?? episode?.air_date);
      const seasonEpisodeCount = episodes.length || undefined;
      return {
        ...(episodeTitle ? { episodeTitle } : {}),
        ...(seasonTitle ? { seasonTitle } : {}),
        ...(seasonYear === undefined ? {} : { seasonYear }),
        ...(seasonEpisodeCount === undefined ? {} : { seasonEpisodeCount }),
      };
    } catch {
      return {};
    }
  }

  private async resolvePublicTmdb(type: MediaType, parsed: ParsedMediaId): Promise<MediaMetadata> {
    if (this.config.tmdbApiKey) {
      try {
        return await this.resolveOfficialTmdb(type, parsed);
      } catch (officialError) {
        try {
          return await this.resolveStremioMeta(
            type,
            parsed,
            this.config.metadataFallbackBaseUrl,
            `tmdb:${parsed.baseId}`,
            "Public metadata",
          );
        } catch {
          throw officialError;
        }
      }
    }

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
