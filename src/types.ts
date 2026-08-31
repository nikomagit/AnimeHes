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
}

export interface StreamSearchService {
  getStreams(type: string, id: string): Promise<AddonStream[]>;
}
