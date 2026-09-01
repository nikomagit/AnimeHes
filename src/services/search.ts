import type { AppConfig } from "../config.js";
import { parseMediaId, parseMediaType } from "../metadata/media-id.js";
import type { MetadataProvider } from "../metadata/client.js";
import { parseProviderMediaId } from "../metadata/provider-id.js";
import type { DirectStreamResolver } from "../providers/resolvers.js";
import type { DirectMediaProvider, ProviderMedia, ProviderSearchResult } from "../providers/types.js";
import type { AddonStream, MediaMetadata, StreamSearchService } from "../types.js";
import {
  buildSearchQueries,
  detailedScore,
  isSeasonCompatible,
  normalizeTitle,
  preliminaryScore,
} from "./matching.js";

interface Candidate {
  result: ProviderSearchResult;
  preliminary: number;
}

export interface ProviderRuntime {
  provider: DirectMediaProvider;
  resolvers: DirectStreamResolver;
}

function safeFilename(value: string): string {
  return value.normalize("NFKD").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "AnimeHes";
}

function chooseEpisode(metadata: Pick<MediaMetadata, "episode" | "season">, media: ProviderMedia): number | null {
  const requested = metadata.episode;
  if (requested !== undefined) {
    const exactSeason = metadata.season === undefined
      ? undefined
      : media.episodes.find((item) => item.season === metadata.season && item.relativeNumber === requested);
    if (exactSeason) return exactSeason.number;
    return media.episodes.some((item) => item.number === requested) ? requested : null;
  }
  if (media.episodes.length === 0) return null;
  return [...media.episodes].sort((left, right) => left.number - right.number)[0]?.number ?? null;
}

export class ProviderSearchService implements StreamSearchService {
  constructor(
    private readonly config: AppConfig,
    private readonly metadataProvider: MetadataProvider,
    private readonly providers: ProviderRuntime[],
  ) {}

  async getStreams(rawType: string, rawId: string): Promise<AddonStream[]> {
    const type = parseMediaType(rawType);
    const native = parseProviderMediaId(rawId);
    if (native) {
      const runtime = this.providers.find((item) => item.provider.id === native.provider);
      if (!runtime) return [];
      try {
        const media = await runtime.provider.getMedia(native.slug);
        if (!media) return [];
        const episodeNumber = chooseEpisode(
          native.episode === undefined ? {} : { episode: native.episode },
          media,
        );
        return episodeNumber === null ? [] : await this.resolveMedia(runtime, media, episodeNumber);
      } catch {
        return [];
      }
    }

    const parsed = parseMediaId(type, rawId);
    const metadata = await this.metadataProvider.resolve(type, parsed);
    const settled = await Promise.allSettled(
      this.providers.map(async (runtime) => {
        const match = await this.findBestMatch(runtime.provider, metadata);
        if (!match) return [];
        const episodeNumber = chooseEpisode(metadata, match);
        return episodeNumber === null ? [] : this.resolveMedia(runtime, match, episodeNumber);
      }),
    );
    const deduplicated = new Map<string, AddonStream>();
    for (const result of settled) {
      if (result.status !== "fulfilled") continue;
      for (const stream of result.value) {
        const key = stream.url.toLocaleLowerCase("en");
        if (!deduplicated.has(key)) deduplicated.set(key, stream);
      }
    }
    return [...deduplicated.values()].slice(0, this.config.maxStreams);
  }

  private async resolveMedia(runtime: ProviderRuntime, media: ProviderMedia, episodeNumber: number): Promise<AddonStream[]> {
    const episode = await runtime.provider.getEpisode(media.slug, episodeNumber);
    if (!episode || episode.media.slug !== media.slug) return [];
    const episodePageUrl = new URL(
      `media/${encodeURIComponent(media.slug)}/${episodeNumber}`,
      `${runtime.provider.baseUrl}/`,
    ).toString();
    const resolved = await runtime.resolvers.resolveAll(episode.embeds, episodePageUrl);
    const title = safeFilename(media.title);
    const episodeLabel = `Episodio ${episodeNumber}`;
    return resolved.map((stream) => {
      const language = stream.language ? ` • ${stream.language}` : "";
      const extension = stream.type === "hls" ? "m3u8" : "mp4";
      return {
        name: `AnimeHes\n${runtime.provider.name} • ${stream.server}`,
        title: `${title} • ${episodeLabel}\n${runtime.provider.name} • ${stream.server} • ${stream.label}${language}`,
        description: `${title} • ${episodeLabel} • ${runtime.provider.name} • ${stream.server} • ${stream.label}${language}`,
        type: stream.type,
        url: stream.url,
        behaviorHints: {
          bingeGroup: `animehes|${runtime.provider.id}|${normalizeTitle(stream.server)}|${stream.language.toLocaleLowerCase("en")}`,
          filename: `${title} - E${String(episodeNumber).padStart(2, "0")} - ${runtime.provider.name} - ${stream.server}.${extension}`,
          notWebReady: true,
          proxyHeaders: { request: stream.headers },
        },
      };
    });
  }

  private async findBestMatch(provider: DirectMediaProvider, metadata: MediaMetadata): Promise<ProviderMedia | null> {
    const queries = buildSearchQueries(metadata, this.config.maxSearchQueries);
    const searches = await Promise.allSettled(queries.map((query) => provider.search(query)));
    const candidates = new Map<string, Candidate>();
    for (const search of searches) {
      if (search.status !== "fulfilled") continue;
      for (const result of search.value) {
        const score = preliminaryScore(metadata, result);
        const existing = candidates.get(result.slug);
        if (!existing || score > existing.preliminary) candidates.set(result.slug, { result, preliminary: score });
      }
    }
    const seasonalRequest = metadata.provider !== "kitsu" && (metadata.season ?? 1) > 1;
    const candidateLimit = seasonalRequest
      ? Math.min(12, Math.max(this.config.maxCandidates, this.config.maxCandidates * 2))
      : this.config.maxCandidates;
    const shortlist = [...candidates.values()]
      .sort((left, right) => right.preliminary - left.preliminary)
      .slice(0, candidateLimit);
    const details = await Promise.allSettled(shortlist.map(async (candidate) => ({ media: await provider.getMedia(candidate.result.slug) })));
    let best: { media: ProviderMedia; score: number } | undefined;
    for (const detail of details) {
      if (detail.status !== "fulfilled" || !detail.value.media) continue;
      if (!isSeasonCompatible(metadata, detail.value.media)) continue;
      const score = detailedScore(metadata, detail.value.media);
      if (!best || score > best.score) best = { media: detail.value.media, score };
    }
    return best && best.score >= this.config.minMatchScore ? best.media : null;
  }
}

/** Backward-compatible single-provider constructor used by existing self-hosted integrations. */
export class HentailaSearchService extends ProviderSearchService {
  constructor(config: AppConfig, metadataProvider: MetadataProvider, hentaila: DirectMediaProvider, resolvers: DirectStreamResolver) {
    super(config, metadataProvider, [{ provider: hentaila, resolvers }]);
  }
}
