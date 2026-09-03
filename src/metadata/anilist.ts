import type { AppConfig } from "../config.js";
import { MetadataUnavailableError, UpstreamPayloadError } from "../errors.js";
import { AsyncTtlCache } from "../lib/cache.js";
import { fetchText, type FetchText } from "../lib/http.js";
import type { ExternalIds, MediaType } from "../types.js";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.map(text).filter((value): value is string => Boolean(value)))];
}

export interface AniListMetadata {
  title: string;
  aliases: string[];
  externalIds: ExternalIds;
  type: MediaType;
  year?: number;
  episodeCount?: number;
}

const QUERY = `
  query AmokinMetadata($id: Int, $idMal: Int) {
    Media(id: $id, idMal: $idMal, type: ANIME) {
      id
      idMal
      format
      episodes
      startDate { year }
      title { romaji english native userPreferred }
      synonyms
    }
  }
`;

/** Retrieves canonical, English, Japanese and romaji aliases without an API key. */
export class AniListMetadataClient {
  private readonly cache: AsyncTtlCache<string, AniListMetadata>;

  constructor(
    private readonly config: AppConfig,
    private readonly request: FetchText = fetchText,
  ) {
    this.cache = new AsyncTtlCache(config.metadataCacheTtlMs, config.cacheMaxEntries);
  }

  resolveByAniList(id: number): Promise<AniListMetadata> {
    return this.resolve("anilist", id);
  }

  resolveByMal(id: number): Promise<AniListMetadata> {
    return this.resolve("mal", id);
  }

  private resolve(kind: "anilist" | "mal", id: number): Promise<AniListMetadata> {
    return this.cache.getOrCreate(`${kind}:${id}`, async () => {
      let payload: Record<string, unknown> | undefined;
      try {
        payload = record(JSON.parse(await this.request(this.config.anilistBaseUrl, {
          timeoutMs: this.config.metadataTimeoutMs,
          maxBytes: this.config.maxResponseBytes,
          upstream: "AniList metadata",
          method: "POST",
          body: JSON.stringify({ query: QUERY, variables: kind === "anilist" ? { id } : { idMal: id } }),
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "user-agent": this.config.userAgent,
          },
        })));
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new UpstreamPayloadError("AniList metadata", "invalid JSON response");
        }
        throw error;
      }
      const media = record(record(payload?.data)?.Media);
      const titles = record(media?.title);
      const synonyms = Array.isArray(media?.synonyms) ? media.synonyms : [];
      const aliases = uniqueStrings([
        titles?.romaji,
        titles?.english,
        titles?.native,
        titles?.userPreferred,
        ...synonyms,
      ]);
      const title = aliases[0];
      const anilist = positiveInteger(media?.id);
      if (!title || anilist === undefined) throw new MetadataUnavailableError();
      const mal = positiveInteger(media?.idMal);
      const year = positiveInteger(record(media?.startDate)?.year);
      const episodeCount = positiveInteger(media?.episodes);
      const type = media?.format === "MOVIE" ? "movie" : "series";
      return {
        title,
        aliases,
        externalIds: { anilist, ...(mal ? { mal } : {}) },
        type,
        ...(year ? { year } : {}),
        ...(episodeCount ? { episodeCount } : {}),
      };
    });
  }
}
