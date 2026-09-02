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
  absoluteAsset,
  emptyCatalog,
  episodeKey,
  integer,
  mediaKey,
  parseMediaKey,
  record,
  text,
  yearFrom,
} from "../general/helpers.js";

interface EpisodeReference {
  id: number;
  season: number;
  episode: number;
  title?: string;
}

export class LaMovieClient implements DirectMediaProvider {
  readonly id = "lamovie" as const;
  readonly name = "LaMovie";
  readonly scope = "general" as const;
  readonly baseUrl: string;
  readonly cdnBaseUrl: string;
  private readonly episodes = new Map<string, EpisodeReference>();

  constructor(private readonly config: AppConfig, private readonly request: FetchText = fetchText) {
    this.baseUrl = config.laMovieBaseUrl;
    this.cdnBaseUrl = config.laMovieBaseUrl;
  }

  async search(query: string, context?: ProviderRequestContext): Promise<ProviderSearchResult[]> {
    const url = new URL("/wp-api/v1/search", `${this.baseUrl}/`);
    url.search = new URLSearchParams({ postType: "any", q: query, postsPerPage: "12" }).toString();
    const payload = await this.json(url, "LaMovie search");
    const posts = record(payload.data)?.posts;
    if (!Array.isArray(posts)) return [];
    return posts.flatMap((value): ProviderSearchResult[] => {
      const item = record(value);
      const rawType = text(item?.type);
      const mediaType = rawType === "movies" ? "movie" : rawType === "tvshows" ? "series" : undefined;
      const slug = text(item?.slug);
      const title = text(item?.title);
      if (!mediaType || !slug || !title || (context && mediaType !== context.type)) return [];
      const synopsis = text(item?.overview);
      const year = yearFrom(item?.release_date ?? title);
      return [{
        id: String(integer(item?._id) ?? slug),
        title: title.replace(/\s*\((?:19|20|21)\d{2}\)\s*$/u, ""),
        slug: mediaKey(mediaType, slug),
        mediaType,
        ...(synopsis ? { synopsis } : {}),
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
    const postType = parsed.type === "movie" ? "movies" : "tvshows";
    const url = new URL(`/wp-api/v1/single/${postType}`, `${this.baseUrl}/`);
    url.search = new URLSearchParams({ slug: parsed.slug, postType }).toString();
    const item = record((await this.json(url, "LaMovie media")).data);
    const id = integer(item?._id);
    const title = text(item?.title);
    if (!item || id === undefined || !title) return null;
    const originalTitle = text(item.original_title);
    const episodes = parsed.type === "movie"
      ? [{ number: 1, season: 1, relativeNumber: 1 }]
      : await this.getSeasonEpisodes(key, id, context?.season ?? 1);
    const images = record(item.images);
    const synopsis = text(item.overview);
    const poster = absoluteAsset(this.baseUrl, images?.poster);
    const backdrop = absoluteAsset(this.baseUrl, images?.backdrop);
    const startDate = text(item.release_date);
    return {
      id,
      title: title.replace(/\s*\((?:19|20|21)\d{2}\)\s*$/u, ""),
      slug: key,
      aka: originalTitle ? { original: originalTitle } : {},
      genres: [],
      episodes,
      mediaType: parsed.type,
      ...(synopsis ? { synopsis } : {}),
      ...(poster ? { poster } : {}),
      ...(backdrop ? { backdrop } : {}),
      ...(startDate ? { startDate } : {}),
      episodesCount: episodes.length,
    };
  }

  async getEpisode(key: string, episodeNumber: number, context?: ProviderRequestContext): Promise<ProviderEpisodePage | null> {
    const parsed = parseMediaKey(key);
    if (!parsed) return null;
    const media = await this.getMedia(key, context);
    if (!media) return null;
    let postId = media.id;
    if (parsed.type === "series") {
      const reference = this.episodes.get(`${key}:${episodeNumber}`);
      if (!reference) return null;
      postId = reference.id;
    }
    if (postId === undefined) return null;
    const url = new URL("/wp-api/v1/player", `${this.baseUrl}/`);
    url.search = new URLSearchParams({ postId: String(postId), demo: "0" }).toString();
    const embeds = record((await this.json(url, "LaMovie player")).data)?.embeds;
    if (!Array.isArray(embeds)) return null;
    const normalized = embeds.flatMap((value) => {
      const item = record(value);
      const embedUrl = text(item?.url);
      if (!embedUrl?.startsWith("https://") && !embedUrl?.startsWith("http://")) return [];
      const host = new URL(embedUrl).hostname.toLocaleLowerCase("en");
      const server = host.includes("vimeos") ? "Vimeos" : text(item?.server) ?? host;
      const language = text(item?.lang) ?? "";
      const quality = text(item?.quality);
      return [{ server, url: embedUrl, language, ...(quality ? { quality } : {}) }];
    });
    return { media, episodeNumber, embeds: normalized, pageUrl: url.toString() };
  }

  private async getSeasonEpisodes(key: string, id: number, season: number) {
    const url = new URL("/wp-api/v1/single/episodes/list", `${this.baseUrl}/`);
    url.search = new URLSearchParams({ _id: String(id), season: String(season), page: "1", postsPerPage: "100" }).toString();
    const posts = record((await this.json(url, "LaMovie episodes")).data)?.posts;
    if (!Array.isArray(posts)) return [];
    return posts.flatMap((value) => {
      const item = record(value);
      const episode = integer(item?.episode_number);
      const itemSeason = integer(item?.season_number);
      const episodeId = integer(item?._id);
      if (!episode || !itemSeason || !episodeId) return [];
      const number = episodeKey(itemSeason, episode);
      const title = text(item?.title);
      this.episodes.set(`${key}:${number}`, { id: episodeId, season: itemSeason, episode, ...(title ? { title } : {}) });
      return [{ number, season: itemSeason, relativeNumber: episode, ...(title ? { title } : {}) }];
    });
  }

  private async json(url: URL, upstream: string): Promise<Record<string, unknown>> {
    try {
      const value: unknown = JSON.parse(await this.request(url, {
        timeoutMs: this.config.requestTimeoutMs,
        maxBytes: this.config.maxResponseBytes,
        upstream,
        headers: { accept: "application/json", "user-agent": this.config.userAgent },
      }));
      const payload = record(value);
      if (!payload) throw new Error("not an object");
      return payload;
    } catch (error) {
      if (error instanceof SyntaxError) throw new UpstreamPayloadError(upstream, "invalid JSON response");
      throw error;
    }
  }
}
