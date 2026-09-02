import type { MediaMetadata, MediaType } from "../types.js";

export type ProviderId =
  | "animeav1"
  | "hentaila"
  | "jkanime"
  | "cuevana"
  | "lamovie";
export type ProviderCatalogKind = "popular" | "airing" | "uncensored";
export type ProviderScope = "anime" | "general";
export type ProviderRequestContext = Pick<
  MediaMetadata,
  "type" | "title" | "aliases" | "year" | "season" | "episode"
>;

export interface ProviderCategory {
  id?: number;
  name?: string;
  slug?: string;
}

export interface ProviderGenre {
  id?: number;
  name: string;
  slug?: string;
}

export interface ProviderSearchResult {
  id: string;
  title: string;
  slug: string;
  synopsis?: string;
  category?: ProviderCategory;
  mediaType?: MediaType;
  year?: number;
}

export interface ProviderEpisodeSummary {
  id?: number;
  number: number;
  season?: number;
  relativeNumber?: number;
  title?: string;
  publishedAt?: string;
}

export interface ProviderMedia {
  id?: number;
  title: string;
  slug: string;
  aka: Record<string, string>;
  synopsis?: string;
  poster?: string;
  backdrop?: string;
  startDate?: string;
  endDate?: string;
  status?: number;
  runtime?: number;
  score?: number;
  votes?: number;
  episodesCount?: number;
  seasons?: unknown;
  category?: ProviderCategory;
  genres: ProviderGenre[];
  episodes: ProviderEpisodeSummary[];
  mediaType?: MediaType;
}

export interface ProviderSubtitle {
  id?: string;
  url: string;
  language: string;
}

export interface ProviderEmbed {
  server: string;
  url: string;
  language: string;
  quality?: string;
  subtitles?: ProviderSubtitle[];
}

export interface ProviderEpisodePage {
  media: ProviderMedia;
  episodeNumber: number;
  embeds: ProviderEmbed[];
  pageUrl?: string;
}

export interface ProviderCatalogPage {
  results: ProviderSearchResult[];
  currentPage: number;
  recordsPerPage: number;
  totalPages: number;
  totalRecords: number;
  orderKey: string;
  status: number | null;
  uncensored: boolean | null;
}

export interface DirectMediaProvider {
  readonly id: ProviderId;
  readonly name: string;
  readonly scope?: ProviderScope;
  readonly baseUrl: string;
  readonly cdnBaseUrl: string;
  search(query: string, context?: ProviderRequestContext): Promise<ProviderSearchResult[]>;
  getCatalog(kind: ProviderCatalogKind, page: number): Promise<ProviderCatalogPage>;
  getMedia(slug: string, context?: ProviderRequestContext): Promise<ProviderMedia | null>;
  getEpisode(slug: string, episode: number, context?: ProviderRequestContext): Promise<ProviderEpisodePage | null>;
}
