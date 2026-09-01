export type ProviderId = "animeav1" | "hentaila";
export type ProviderCatalogKind = "popular" | "airing" | "uncensored";

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
}

export interface ProviderEmbed {
  server: string;
  url: string;
  language: string;
}

export interface ProviderEpisodePage {
  media: ProviderMedia;
  episodeNumber: number;
  embeds: ProviderEmbed[];
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
  readonly baseUrl: string;
  readonly cdnBaseUrl: string;
  search(query: string): Promise<ProviderSearchResult[]>;
  getCatalog(kind: ProviderCatalogKind, page: number): Promise<ProviderCatalogPage>;
  getMedia(slug: string): Promise<ProviderMedia | null>;
  getEpisode(slug: string, episode: number): Promise<ProviderEpisodePage | null>;
}
