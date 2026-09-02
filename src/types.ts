export type MediaType = "movie" | "series";
export type MediaProvider = "imdb" | "kitsu" | "tmdb";

export interface ParsedMediaId {
  provider: MediaProvider;
  baseId: string;
  season?: number;
  episode?: number;
}

export interface MediaMetadata extends ParsedMediaId {
  type: MediaType;
  title: string;
  aliases: string[];
  year?: number;
  episodeTitle?: string;
  seasonTitle?: string;
  seasonYear?: number;
  seasonEpisodeCount?: number;
}

export interface StreamProxyHeaders {
  request?: Record<string, string>;
  response?: Record<string, string>;
}

export interface StreamBehaviorHints {
  bingeGroup: string;
  filename: string;
  notWebReady: true;
  proxyHeaders?: StreamProxyHeaders;
}

export interface AddonStream {
  name: string;
  title: string;
  description: string;
  type: "hls" | "mp4";
  url: string;
  behaviorHints: StreamBehaviorHints;
  subtitles?: Array<{ id: string; url: string; lang: string }>;
}

export interface AddonMetaPreview {
  id: string;
  type: MediaType;
  name: string;
  poster?: string;
  background?: string;
  description?: string;
  releaseInfo?: string;
  genres?: string[];
}

export interface AddonVideo {
  id: string;
  title: string;
  season: number;
  episode: number;
  released?: string;
}

export interface AddonMeta extends AddonMetaPreview {
  videos?: AddonVideo[];
  runtime?: string;
  imdbRating?: string;
  status?: string;
}

export interface StreamSearchService {
  getStreams(type: string, id: string): Promise<AddonStream[]>;
}

export interface CatalogService {
  getCatalog(type: string, id: string, skip: number): Promise<AddonMetaPreview[]>;
}

export interface MetaService {
  getMeta(type: string, id: string): Promise<AddonMeta | null>;
}
