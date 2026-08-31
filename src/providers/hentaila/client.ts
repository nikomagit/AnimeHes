import type { AppConfig } from "../../config.js";
import { UpstreamHttpError, UpstreamPayloadError } from "../../errors.js";
import { AsyncTtlCache } from "../../lib/cache.js";
import { fetchText, type FetchText } from "../../lib/http.js";
import { parseSvelteDataResponse } from "../../lib/svelte-data.js";
import type {
  HentailaEmbed,
  HentailaEpisodePage,
  HentailaEpisodeSummary,
  HentailaMedia,
  HentailaProvider,
  HentailaSearchResult,
} from "./types.js";

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function integer(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function safeSlug(value: unknown): string | undefined {
  const slug = text(value);
  return slug && SAFE_SLUG.test(slug) ? slug : undefined;
}

function parseCategory(value: unknown) {
  const source = record(value);
  if (!source) return undefined;
  const id = integer(source.id);
  const name = text(source.name);
  const slug = safeSlug(source.slug);
  if (id === undefined && !name && !slug) return undefined;
  return {
    ...(id === undefined ? {} : { id }),
    ...(name ? { name } : {}),
    ...(slug ? { slug } : {}),
  };
}

function parseSearchResult(value: unknown): HentailaSearchResult | undefined {
  const source = record(value);
  const title = text(source?.title);
  const slug = safeSlug(source?.slug);
  if (!source || !title || !slug) return undefined;
  const id = text(source.id) ?? String(integer(source.id) ?? "");
  if (!id) return undefined;
  const synopsis = text(source.synopsis);
  const category = parseCategory(source.category);
  return {
    id,
    title,
    slug,
    ...(synopsis ? { synopsis } : {}),
    ...(category ? { category } : {}),
  };
}

function parseEpisodeSummary(value: unknown): HentailaEpisodeSummary | undefined {
  const source = record(value);
  const number = integer(source?.number);
  if (!source || number === undefined || number < 1) return undefined;
  const id = integer(source.id);
  const season = integer(source.season);
  const relativeNumber = integer(source.relativeNumber);
  return {
    number,
    ...(id === undefined ? {} : { id }),
    ...(season === undefined ? {} : { season }),
    ...(relativeNumber === undefined ? {} : { relativeNumber }),
  };
}

function parseMedia(value: unknown): HentailaMedia | undefined {
  const source = record(value);
  const title = text(source?.title);
  const slug = safeSlug(source?.slug);
  if (!source || !title || !slug) return undefined;

  const akaSource = record(source.aka);
  const aka: Record<string, string> = {};
  for (const [locale, rawTitle] of Object.entries(akaSource ?? {})) {
    const alias = text(rawTitle);
    if (alias && /^[a-z]{2}(?:-[a-z]{2})?$/i.test(locale)) aka[locale] = alias;
  }
  const episodes = (Array.isArray(source.episodes) ? source.episodes : [])
    .map(parseEpisodeSummary)
    .filter((episode): episode is HentailaEpisodeSummary => Boolean(episode));
  const id = integer(source.id);
  const startDate = text(source.startDate);
  const episodesCount = integer(source.episodesCount);
  const category = parseCategory(source.category);
  return {
    title,
    slug,
    aka,
    episodes,
    ...(id === undefined ? {} : { id }),
    ...(startDate ? { startDate } : {}),
    ...(episodesCount === undefined ? {} : { episodesCount }),
    ...(source.seasons === undefined || source.seasons === null ? {} : { seasons: source.seasons }),
    ...(category ? { category } : {}),
  };
}

function parseEmbeds(value: unknown): HentailaEmbed[] {
  const groups = record(value);
  if (!groups) return [];
  const embeds: HentailaEmbed[] = [];
  for (const [language, rawEmbeds] of Object.entries(groups)) {
    if (!Array.isArray(rawEmbeds)) continue;
    for (const rawEmbed of rawEmbeds) {
      const embed = record(rawEmbed);
      const server = text(embed?.server);
      const url = text(embed?.url);
      if (!server || !url) continue;
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
        embeds.push({ server, url: parsed.toString(), language: language.toUpperCase() });
      } catch {
        // Ignore incomplete mirrors and keep the remaining valid ones.
      }
    }
  }
  return embeds;
}

export class HentailaClient implements HentailaProvider {
  private readonly searchCache: AsyncTtlCache<string, HentailaSearchResult[]>;
  private readonly mediaCache: AsyncTtlCache<string, HentailaMedia | null>;
  private readonly episodeCache: AsyncTtlCache<string, HentailaEpisodePage | null>;

  constructor(
    private readonly config: AppConfig,
    private readonly request: FetchText = fetchText,
  ) {
    this.searchCache = new AsyncTtlCache(config.searchCacheTtlMs, config.cacheMaxEntries);
    this.mediaCache = new AsyncTtlCache(config.mediaCacheTtlMs, config.cacheMaxEntries);
    this.episodeCache = new AsyncTtlCache(config.searchCacheTtlMs, config.cacheMaxEntries);
  }

  search(query: string): Promise<HentailaSearchResult[]> {
    const cleaned = query.trim().replace(/\s+/g, " ").slice(0, 160);
    if (!cleaned) return Promise.resolve([]);
    return this.searchCache.getOrCreate(cleaned.toLocaleLowerCase("en"), async () => {
      const url = new URL("catalogo/__data.json", `${this.config.hentailaBaseUrl}/`);
      url.searchParams.set("search", cleaned);
      const data = parseSvelteDataResponse(await this.request(url, this.options()), "Hentaila");
      return (Array.isArray(data.results) ? data.results : [])
        .map(parseSearchResult)
        .filter((result): result is HentailaSearchResult => Boolean(result));
    });
  }

  getMedia(slug: string): Promise<HentailaMedia | null> {
    if (!SAFE_SLUG.test(slug)) return Promise.resolve(null);
    return this.mediaCache.getOrCreate(slug, async () => {
      const url = new URL(`media/${encodeURIComponent(slug)}/__data.json`, `${this.config.hentailaBaseUrl}/`);
      try {
        const data = parseSvelteDataResponse(await this.request(url, this.options()), "Hentaila");
        const media = parseMedia(data.media);
        if (!media) throw new UpstreamPayloadError("Hentaila", "invalid media record");
        return media;
      } catch (error) {
        if (error instanceof UpstreamHttpError && error.upstreamStatus === 404) return null;
        throw error;
      }
    });
  }

  getEpisode(slug: string, episode: number): Promise<HentailaEpisodePage | null> {
    if (!SAFE_SLUG.test(slug) || !Number.isSafeInteger(episode) || episode < 1) {
      return Promise.resolve(null);
    }
    const key = `${slug}:${episode}`;
    return this.episodeCache.getOrCreate(key, async () => {
      const url = new URL(
        `media/${encodeURIComponent(slug)}/${episode}/__data.json`,
        `${this.config.hentailaBaseUrl}/`,
      );
      try {
        const data = parseSvelteDataResponse(await this.request(url, this.options()), "Hentaila");
        const media = parseMedia(data.media);
        const episodeRecord = record(data.episode);
        const episodeNumber = integer(episodeRecord?.number);
        if (!media || episodeNumber === undefined || episodeNumber < 1) {
          throw new UpstreamPayloadError("Hentaila", "invalid episode record");
        }
        return { media, episodeNumber, embeds: parseEmbeds(data.embeds) };
      } catch (error) {
        if (error instanceof UpstreamHttpError && error.upstreamStatus === 404) return null;
        throw error;
      }
    });
  }

  private options() {
    return {
      timeoutMs: this.config.requestTimeoutMs,
      maxBytes: this.config.maxResponseBytes,
      upstream: "Hentaila",
      headers: {
        accept: "application/json",
        "accept-language": "es-ES,es;q=0.9,en;q=0.8",
        "user-agent": this.config.userAgent,
      },
    };
  }
}
