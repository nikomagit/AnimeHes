import type { AppConfig } from "../../config.js";
import { UpstreamPayloadError } from "../../errors.js";
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
  parseMediaKey,
  plainText,
  record,
  safeUrl,
  text,
  yearFrom,
} from "../general/helpers.js";

interface PlayerReference {
  id: string;
  token: string;
  pageUrl: string;
}

export class GnulaHdClient implements DirectMediaProvider {
  readonly id = "gnulahd" as const;
  readonly name = "GnulaHD";
  readonly scope = "general" as const;
  readonly baseUrl: string;
  readonly cdnBaseUrl: string;
  private readonly players = new Map<string, PlayerReference>();

  constructor(private readonly config: AppConfig, private readonly request: FetchText = fetchText) {
    this.baseUrl = config.gnulaHdBaseUrl;
    this.cdnBaseUrl = config.gnulaHdBaseUrl;
  }

  async search(query: string, context?: ProviderRequestContext): Promise<ProviderSearchResult[]> {
    const url = new URL("/wp-json/gnrd/v1/search", `${this.baseUrl}/`);
    url.search = new URLSearchParams({ q: query }).toString();
    const values = (await this.json(url, "GnulaHD search")).results;
    if (!Array.isArray(values)) return [];
    return values.flatMap((value): ProviderSearchResult[] => {
      const item = record(value);
      const rawType = text(item?.type)?.toLocaleLowerCase("es");
      const mediaType = rawType === "pelicula" || rawType === "película" ? "movie" : rawType === "serie" ? "series" : undefined;
      const title = text(item?.title);
      const itemUrl = text(item?.url);
      const slug = itemUrl?.match(/\/ver\/([^/?#]+)\/?/i)?.[1];
      if (!mediaType || !title || !slug || (context && mediaType !== context.type)) return [];
      const year = yearFrom(item?.year);
      return [{
        id: slug,
        title,
        slug: mediaKey(mediaType, slug),
        mediaType,
        ...(year === undefined ? {} : { year }),
      }];
    });
  }

  async getCatalog(_kind: ProviderCatalogKind, _page: number): Promise<ProviderCatalogPage> {
    return emptyCatalog();
  }

  async getMedia(key: string, context?: ProviderRequestContext): Promise<ProviderMedia | null> {
    const parsed = parseMediaKey(key);
    if (!parsed || (context && parsed.type !== context.type)) return null;
    const pageUrl = new URL(`/ver/${parsed.slug}/`, `${this.baseUrl}/`).toString();
    const html = await this.html(pageUrl, "GnulaHD media");
    const title = plainText(
      html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
      ?? html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
      ?? "",
    ).replace(/\s*\((?:19|20|21)\d{2}\)[\s\S]*$/u, "");
    if (!title) return null;
    const episodes = parsed.type === "movie" ? [{ number: 1, season: 1, relativeNumber: 1 }] : this.parseEpisodes(key, html);
    if (parsed.type === "movie") {
      const id = html.match(/_gnrdPid\s*=\s*(\d+)/)?.[1];
      const token = html.match(/_gnrdTok\s*=\s*["']([a-f\d]+)["']/i)?.[1];
      if (id && token) this.players.set(`${key}:1`, { id, token, pageUrl });
    }
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
    const media = await this.getMedia(key, context);
    const reference = this.players.get(`${key}:${episodeNumber}`);
    if (!media || !reference) return null;
    const url = new URL("/wp-json/gnrd/v1/player", `${this.baseUrl}/`);
    url.search = new URLSearchParams({ id: reference.id, t: reference.token }).toString();
    const packed = text((await this.json(url, "GnulaHD player")).p);
    if (!packed) return null;
    const payload = this.unpack(packed);
    const languages = payload.langs;
    if (!Array.isArray(languages)) return null;
    const embeds = languages.flatMap((languageValue) => {
      const language = record(languageValue);
      const label = text(language?.label) ?? "";
      const servers = language?.servers;
      if (!Array.isArray(servers)) return [];
      return servers.flatMap((serverValue) => {
        const server = record(serverValue);
        const source = text(server?.src);
        const url = source ? safeUrl(source, this.baseUrl) : null;
        if (!url) return [];
        const host = new URL(url).hostname.toLocaleLowerCase("en");
        const serverName = host.includes("vidara") ? "Vidara" : host.includes("vidsonic") ? "Vidsonic" : text(server?.title) ?? host;
        const quality = text(server?.quality);
        return [{ server: serverName, url, language: label, ...(quality ? { quality } : {}) }];
      });
    });
    return { media, episodeNumber, embeds, pageUrl: reference.pageUrl };
  }

  private parseEpisodes(key: string, html: string) {
    const result = new Map<number, { number: number; season: number; relativeNumber: number; title?: string }>();
    for (const match of html.matchAll(/<a\b[^>]*class=["'][^"']*\bgnrd-epc\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*data-id=["'](\d+)["'][^>]*data-t=["']([a-f\d]+)["'][^>]*data-s=["'](\d+)["'][^>]*data-e=["'](\d+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const pageUrl = safeUrl(match[1] ?? "", this.baseUrl);
      const id = match[2];
      const token = match[3];
      const season = Number(match[4]);
      const episode = Number(match[5]);
      if (!pageUrl || !id || !token || season < 1 || episode < 1) continue;
      const number = episodeKey(season, episode);
      const title = plainText(match[6]?.match(/class=["']gnrd-epc-title["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "");
      result.set(number, { number, season, relativeNumber: episode, ...(title ? { title } : {}) });
      this.players.set(`${key}:${number}`, { id, token, pageUrl });
    }
    return [...result.values()].sort((left, right) => left.number - right.number);
  }

  private unpack(value: string): Record<string, unknown> {
    try {
      const input = Buffer.from(value, "base64");
      const key = [103, 78, 55, 100];
      const decoded = Buffer.alloc(input.length);
      for (let index = 0; index < input.length; index += 1) decoded[index] = (input[index] ?? 0) ^ (key[index & 3] ?? 0);
      const payload = record(JSON.parse(decoded.toString("utf8")));
      if (!payload) throw new Error("not an object");
      return payload;
    } catch {
      throw new UpstreamPayloadError("GnulaHD player", "invalid packed player response");
    }
  }

  private async json(url: URL, upstream: string): Promise<Record<string, unknown>> {
    try {
      const payload = record(JSON.parse(await this.html(url, upstream)));
      if (!payload) throw new Error("not an object");
      return payload;
    } catch (error) {
      if (error instanceof SyntaxError) throw new UpstreamPayloadError(upstream, "invalid JSON response");
      throw error;
    }
  }

  private html(url: URL | string, upstream: string): Promise<string> {
    return this.request(url, {
      timeoutMs: this.config.requestTimeoutMs,
      maxBytes: this.config.maxResponseBytes,
      upstream,
      headers: { accept: "text/html,application/json", "accept-language": "es-ES,es;q=0.9", "user-agent": this.config.userAgent },
    });
  }
}
