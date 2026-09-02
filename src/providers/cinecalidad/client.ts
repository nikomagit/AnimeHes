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
  decodeHtml,
  emptyCatalog,
  episodeKey,
  mediaKey,
  parseEpisodeKey,
  parseMediaKey,
  plainText,
  safeUrl,
  yearFrom,
} from "../general/helpers.js";

export class CineCalidadClient implements DirectMediaProvider {
  readonly id = "cinecalidad" as const;
  readonly name = "CineCalidad";
  readonly scope = "general" as const;
  readonly baseUrl: string;
  readonly cdnBaseUrl: string;
  private readonly episodeUrls = new Map<string, string>();
  private readonly knownYears = new Map<string, number>();

  constructor(private readonly config: AppConfig, private readonly request: FetchText = fetchText) {
    this.baseUrl = config.cineCalidadBaseUrl;
    this.cdnBaseUrl = config.cineCalidadBaseUrl;
  }

  async search(query: string, context?: ProviderRequestContext): Promise<ProviderSearchResult[]> {
    const url = new URL("/", `${this.baseUrl}/`);
    url.search = new URLSearchParams({ s: query }).toString();
    const html = await this.html(url, "CineCalidad search");
    const results: ProviderSearchResult[] = [];
    for (const match of html.matchAll(/<article\b[^>]*class=["'][^"']*\bitem\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi)) {
      const block = match[1] ?? "";
      const link = block.match(/href=["']([^"']+\/ver-(pelicula|serie)\/([^"'/?#]+)\/?)['"]/i);
      const title = block.match(/class=["']in_title["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]
        ?? block.match(/<img[^>]+alt=["']([^"']+)["']/i)?.[1];
      if (!link?.[2] || !link[3] || !title) continue;
      const mediaType = link[2].toLocaleLowerCase("en") === "pelicula" ? "movie" : "series";
      if (context && mediaType !== context.type) continue;
      const year = yearFrom(block);
      const key = mediaKey(mediaType, link[3]);
      if (year !== undefined) this.knownYears.set(key, year);
      results.push({
        id: link[3],
        title: plainText(title),
        slug: key,
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
    const path = parsed.type === "movie" ? `/ver-pelicula/${parsed.slug}/` : `/ver-serie/${parsed.slug}/`;
    const pageUrl = new URL(path, `${this.baseUrl}/`).toString();
    const html = await this.html(pageUrl, "CineCalidad media");
    const title = plainText(
      html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
      ?? html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
      ?? "",
    )
      .replace(/^Ver\s+(?:Serie\s+)?/iu, "")
      .replace(/\s+(?:Online|Gratis|HD|en Cinecalidad)[\s\S]*$/iu, "")
      .trim();
    if (!title) return null;
    const episodes = parsed.type === "movie" ? [{ number: 1, season: 1, relativeNumber: 1 }] : this.parseEpisodes(key, html);
    const startDate = this.knownYears.get(key);
    return {
      title,
      slug: key,
      aka: {},
      genres: [],
      episodes,
      mediaType: parsed.type,
      episodesCount: episodes.length,
      ...(startDate === undefined ? {} : { startDate: `${startDate}-01-01` }),
    };
  }

  async getEpisode(key: string, episodeNumber: number, context?: ProviderRequestContext): Promise<ProviderEpisodePage | null> {
    const parsed = parseMediaKey(key);
    if (!parsed) return null;
    const media = await this.getMedia(key, context);
    if (!media) return null;
    const pageUrl = parsed.type === "movie"
      ? new URL(`/ver-pelicula/${parsed.slug}/`, `${this.baseUrl}/`).toString()
      : this.episodeUrls.get(`${key}:${episodeNumber}`)
        ?? (() => {
          const episode = parseEpisodeKey(episodeNumber);
          return episode
            ? new URL(`/ver-el-episodio/${parsed.slug}-${episode.season}x${episode.episode}/`, `${this.baseUrl}/`).toString()
            : "";
        })();
    if (!pageUrl) return null;
    const html = await this.html(pageUrl, "CineCalidad player");
    const audioValue = plainText(
      html.match(/id=["']panel_online["'][\s\S]*?class=["']pane_descripcion["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "",
    ).replace(/^Audio\s+/iu, "").trim();
    const audio = audioValue ? `${audioValue[0]?.toLocaleUpperCase("es")}${audioValue.slice(1)}` : "";
    const embeds = [...html.matchAll(/<li\b[^>]*class=["'][^"']*\bdooplay_player_option\b[^"']*["'][^>]*data-option=["']([^"']+)["'][^>]*>([\s\S]*?)<\/li>/gi)]
      .flatMap((match) => {
        const url = safeUrl(match[1] ?? "", this.baseUrl);
        if (!url || /youtube\.com|youtu\.be/i.test(url)) return [];
        const label = plainText(match[2] ?? "").replace(/recomendado/giu, "").replace(/-->/g, "").trim();
        const server = label || new URL(url).hostname;
        return [{ server, url, language: audio }];
      });
    return { media, episodeNumber, embeds, pageUrl };
  }

  private parseEpisodes(key: string, html: string) {
    const result = new Map<number, { number: number; season: number; relativeNumber: number }>();
    for (const match of html.matchAll(/href=["']([^"']+\/ver-el-episodio\/([^"'/?#]+)-(\d{1,3})x(\d{1,4})\/?)['"]/gi)) {
      const url = safeUrl(decodeHtml(match[1] ?? ""), this.baseUrl);
      const season = Number(match[3]);
      const episode = Number(match[4]);
      if (!url || !Number.isSafeInteger(season) || season < 1 || !Number.isSafeInteger(episode) || episode < 1) continue;
      const number = episodeKey(season, episode);
      result.set(number, { number, season, relativeNumber: episode });
      this.episodeUrls.set(`${key}:${number}`, url);
    }
    return [...result.values()].sort((left, right) => left.number - right.number);
  }

  private html(url: URL | string, upstream: string): Promise<string> {
    return this.request(url, {
      timeoutMs: this.config.requestTimeoutMs,
      maxBytes: this.config.maxResponseBytes,
      upstream,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "es-ES,es;q=0.9",
        "user-agent": this.config.userAgent,
      },
    });
  }
}
