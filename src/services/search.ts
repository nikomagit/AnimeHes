import type { AppConfig } from "../config.js";
import { parseMediaId, parseMediaType } from "../metadata/media-id.js";
import type { MetadataProvider } from "../metadata/client.js";
import type { HentailaMedia, HentailaProvider, HentailaSearchResult } from "../providers/hentaila/types.js";
import type { DirectStreamResolver } from "../providers/hentaila/resolvers.js";
import type { AddonStream, MediaMetadata, StreamSearchService } from "../types.js";
import {
  buildSearchQueries,
  detailedScore,
  normalizeTitle,
  preliminaryScore,
} from "./matching.js";

interface Candidate {
  result: HentailaSearchResult;
  preliminary: number;
}

function safeFilename(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "Hentaila";
}

function chooseEpisode(metadata: MediaMetadata, media: HentailaMedia): number | null {
  const requested = metadata.episode;
  if (requested !== undefined) {
    const exactSeason = metadata.season === undefined
      ? undefined
      : media.episodes.find(
          (item) => item.season === metadata.season && item.relativeNumber === requested,
        );
    if (exactSeason) return exactSeason.number;
    return media.episodes.some((item) => item.number === requested) ? requested : null;
  }
  if (media.episodes.length === 0) return null;
  return [...media.episodes].sort((a, b) => a.number - b.number)[0]?.number ?? null;
}

export class HentailaSearchService implements StreamSearchService {
  constructor(
    private readonly config: AppConfig,
    private readonly metadataProvider: MetadataProvider,
    private readonly hentaila: HentailaProvider,
    private readonly resolvers: DirectStreamResolver,
  ) {}

  async getStreams(rawType: string, rawId: string): Promise<AddonStream[]> {
    const type = parseMediaType(rawType);
    const parsed = parseMediaId(type, rawId);
    const metadata = await this.metadataProvider.resolve(type, parsed);
    const match = await this.findBestMatch(metadata);
    if (!match) return [];
    const episodeNumber = chooseEpisode(metadata, match);
    if (episodeNumber === null) return [];

    const episode = await this.hentaila.getEpisode(match.slug, episodeNumber);
    if (!episode || episode.media.slug !== match.slug) return [];
    const episodePageUrl = new URL(
      `media/${encodeURIComponent(match.slug)}/${episodeNumber}`,
      `${this.config.hentailaBaseUrl}/`,
    ).toString();
    const resolved = await this.resolvers.resolveAll(episode.embeds, episodePageUrl);
    const title = safeFilename(match.title);
    const episodeLabel = `Episodio ${episodeNumber}`;

    return resolved.map((stream) => {
      const language = stream.language ? ` • ${stream.language}` : "";
      const filename = `${title} - E${String(episodeNumber).padStart(2, "0")} - ${stream.server}.${stream.type === "hls" ? "m3u8" : "mp4"}`;
      return {
        name: `AnimeHes\n${stream.server}`,
        title: `${title} • ${episodeLabel}\n${stream.server} • ${stream.label}${language}`,
        description: `${title} • ${episodeLabel} • ${stream.server} • ${stream.label}${language}`,
        type: stream.type,
        url: stream.url,
        behaviorHints: {
          bingeGroup: `animehes|${normalizeTitle(stream.server)}|${stream.language.toLocaleLowerCase("en")}`,
          filename,
          notWebReady: true,
          proxyHeaders: { request: stream.headers },
        },
      };
    });
  }

  private async findBestMatch(metadata: MediaMetadata): Promise<HentailaMedia | null> {
    const queries = buildSearchQueries(metadata, this.config.maxSearchQueries);
    const searches = await Promise.allSettled(queries.map((query) => this.hentaila.search(query)));
    const candidates = new Map<string, Candidate>();
    for (const search of searches) {
      if (search.status !== "fulfilled") continue;
      for (const result of search.value) {
        const score = preliminaryScore(metadata, result);
        const existing = candidates.get(result.slug);
        if (!existing || score > existing.preliminary) {
          candidates.set(result.slug, { result, preliminary: score });
        }
      }
    }
    const shortlist = [...candidates.values()]
      .sort((a, b) => b.preliminary - a.preliminary)
      .slice(0, this.config.maxCandidates);
    if (!shortlist.length) return null;

    const details = await Promise.allSettled(
      shortlist.map(async (candidate) => ({
        candidate,
        media: await this.hentaila.getMedia(candidate.result.slug),
      })),
    );
    let best: { media: HentailaMedia; score: number } | undefined;
    for (const detail of details) {
      if (detail.status !== "fulfilled" || !detail.value.media) continue;
      const score = detailedScore(metadata, detail.value.media);
      if (!best || score > best.score) best = { media: detail.value.media, score };
    }
    return best && best.score >= this.config.minMatchScore ? best.media : null;
  }
}
