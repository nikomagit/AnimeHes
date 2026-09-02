import type { AppConfig } from "../../config.js";
import { fetchText, type FetchText } from "../../lib/http.js";
import type {
  DirectMediaProvider,
  ProviderCatalogKind,
  ProviderCatalogPage,
  ProviderEpisodePage,
  ProviderMedia,
  ProviderRequestContext,
  ProviderSearchResult,
} from "../types.js";
import {
  emptyCatalog,
  episodeKey,
  mediaKey,
  parseEpisodeKey,
  parseMediaKey,
  plainText,
  safeUrl,
  yearFrom,
} from "../general/helpers.js";

export class CuevanaClient implements DirectMediaProvider {
  readonly id = "cuevana" as const;
  readonly name = "Cuevana";
  readonly scope = "general" as const;
  readonly baseUrl: string;
  readonly cdnBaseUrl: string;
  private readonly episodeUrls = new Map<string, string>();

  constructor(private readonly config: AppConfig, private readonly request: FetchText = fetchText) {
    this.baseUrl = config.cuevanaBaseUrl;
    this.cdnBaseUrl = config.cuevanaBaseUrl;
  }

  async search(query: string, context?: ProviderRequestContext): Promise<ProviderSearchResult[]> {
    const url = new URL("/explorar", `${this.baseUrl}/`);
    url.search = new URLSearchParams({ s: query }).toString();
    const html = await this.html(url, "Cuevana search");
    const results: ProviderSearchResult[] = [];
    for (const match of html.matchAll(/<div\b[^>]*class=["']movie-item["'][^>]*>\s*<a\b[^>]*href=["']([^"']+\/(pelicula|serie)\/([^"'/?#]+))["'][^>]*>([\s\S]*?)<\/a>\s*<\/div>/gi)) {
      const mediaType = match[2]?.toLocaleLowerCase("es") === "pelicula" ? "movie" : "series";
      if (context && mediaType !== context.type) continue;
      const block = match[4] ?? "";
      const title = plainText(
        block.match(/class=["']item-detail["'][^>]*>[\s\S]*?<p>([\s\S]*?)<\/p>/i)?.[1]
        ?? block.match(/<img[^>]+alt=["'][^"']*?\s([^"']+)["']/i)?.[1]
        ?? "",
      );
      const slug = match[3];
      if (!title || !slug) continue;
      const year = yearFrom(block.match(/class=["'][^"']*\byear\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]);
      results.push({
        id: slug,
        title,
        slug: mediaKey(mediaType, slug),
        mediaType,
        ...(year === undefined ? {} : { year }),
      });
    }
    return results;
  }

  async getCatalog(_kind: ProviderCatalogKind, _page: number): Promise<ProviderCatalogPage> {
    return emptyCatalog();
  }

  async getMedia(key: string, context?: ProviderRequestContext): Promise<ProviderMedia | null> {
    const parsed = parseMediaKey(key);
    if (!parsed || (context && parsed.type !== context.type)) return null;
    const path = parsed.type === "movie" ? `/pelicula/${parsed.slug}` : `/serie/${parsed.slug}`;
    const pageUrl = new URL(path, `${this.baseUrl}/`).toString();
    const html = await this.html(pageUrl, "Cuevana media");
    const title = plainText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "")
      .replace(/^Serie\s+/iu, "")
      .replace(/\d+(?:[.,]\d+)?\s*$/u, "")
      .trim();
    if (!title) return null;
    const episodes = parsed.type === "movie"
      ? [{ number: 1, season: 1, relativeNumber: 1 }]
      : await this.getSeasonEpisodes(key, parsed.slug, context?.season ?? 1);
    const startYear = yearFrom(html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]);
    return {
      title,
      slug: key,
      aka: {},
      genres: [],
      episodes,
      mediaType: parsed.type,
      episodesCount: episodes.length,
      ...(startYear === undefined ? {} : { startDate: `${startYear}-01-01` }),
    };
  }

  async getEpisode(key: string, episodeNumber: number, context?: ProviderRequestContext): Promise<ProviderEpisodePage | null> {
    const parsed = parseMediaKey(key);
    if (!parsed) return null;
    const media = await this.getMedia(key, context);
    if (!media) return null;
    const pageUrl = parsed.type === "movie"
      ? new URL(`/pelicula/${parsed.slug}`, `${this.baseUrl}/`).toString()
      : this.episodeUrls.get(`${key}:${episodeNumber}`)
        ?? (() => {
          const episode = parseEpisodeKey(episodeNumber);
          return episode ? new URL(`/serie/${parsed.slug}/episodio-${episode.season}x${episode.episode}`, `${this.baseUrl}/`).toString() : "";
        })();
    if (!pageUrl) return null;
    const html = await this.html(pageUrl, "Cuevana player");
    const embeds = [...html.matchAll(/<li\b[^>]*data-server=["']([^"']+)["'][^>]*>\s*<span>([\s\S]*?)<\/span>/gi)].flatMap((match) => {
      const wrapper = safeUrl(match[1] ?? "", this.baseUrl);
      if (!wrapper) return [];
      const encoded = new URL(wrapper).searchParams.get("v");
      if (!encoded) return [];
      let decoded: string;
      try {
        decoded = Buffer.from(encoded, "base64").toString("utf8");
      } catch {
        return [];
      }
      const url = safeUrl(decoded, this.baseUrl);
      if (!url) return [];
      const server = plainText(match[2] ?? "").replace(/^Servidor\s+/iu, "").trim();
      const before = html.slice(Math.max(0, (match.index ?? 0) - 1800), match.index ?? 0);
      const languageMatches = [...before.matchAll(/class=["']tab-item-name["'][^>]*>([\s\S]*?)(?:<div|<\/div>)/gi)];
      const language = plainText(languageMatches.at(-1)?.[1] ?? "");
      const quality = /Calidad\s*·\s*HD/i.test(before) ? "HD" : undefined;
      return [{ server: server || new URL(url).hostname, url, language, ...(quality ? { quality } : {}) }];
    });
    return { media, episodeNumber, embeds, pageUrl };
  }

  private async getSeasonEpisodes(key: string, slug: string, season: number) {
    const pageUrl = new URL(`/serie/${slug}/temporada-${season}`, `${this.baseUrl}/`).toString();
    const html = await this.html(pageUrl, "Cuevana episodes");
    const episodes = new Map<number, { number: number; season: number; relativeNumber: number }>();
    for (const match of html.matchAll(/href=["']([^"']+\/serie\/[^"'/?#]+\/episodio-(\d{1,3})x(\d{1,4}))["']/gi)) {
      const itemSeason = Number(match[2]);
      const episode = Number(match[3]);
      const url = safeUrl(match[1] ?? "", this.baseUrl);
      if (!url || itemSeason < 1 || episode < 1) continue;
      const number = episodeKey(itemSeason, episode);
      episodes.set(number, { number, season: itemSeason, relativeNumber: episode });
      this.episodeUrls.set(`${key}:${number}`, url);
    }
    return [...episodes.values()].sort((left, right) => left.number - right.number);
  }

  private html(url: URL | string, upstream: string): Promise<string> {
    return this.request(url, {
      timeoutMs: this.config.requestTimeoutMs,
      maxBytes: this.config.maxResponseBytes,
      upstream,
      headers: { accept: "text/html,application/xhtml+xml", "accept-language": "es-ES,es;q=0.9", "user-agent": this.config.userAgent },
    });
  }
}
