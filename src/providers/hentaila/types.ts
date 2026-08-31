export interface HentailaCategory {
  id?: number;
  name?: string;
  slug?: string;
}

export interface HentailaSearchResult {
  id: string;
  title: string;
  slug: string;
  synopsis?: string;
  category?: HentailaCategory;
}

export interface HentailaEpisodeSummary {
  id?: number;
  number: number;
  season?: number;
  relativeNumber?: number;
}

export interface HentailaMedia {
  id?: number;
  title: string;
  slug: string;
  aka: Record<string, string>;
  startDate?: string;
  episodesCount?: number;
  seasons?: unknown;
  category?: HentailaCategory;
  episodes: HentailaEpisodeSummary[];
}

export interface HentailaEmbed {
  server: string;
  url: string;
  language: string;
}

export interface HentailaEpisodePage {
  media: HentailaMedia;
  episodeNumber: number;
  embeds: HentailaEmbed[];
}

export interface HentailaProvider {
  search(query: string): Promise<HentailaSearchResult[]>;
  getMedia(slug: string): Promise<HentailaMedia | null>;
  getEpisode(slug: string, episode: number): Promise<HentailaEpisodePage | null>;
}
