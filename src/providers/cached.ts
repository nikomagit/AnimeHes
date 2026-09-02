import type { AppConfig } from "../config.js";
import { AsyncTtlCache } from "../lib/cache.js";
import type {
  DirectMediaProvider,
  ProviderCatalogKind,
  ProviderCatalogPage,
  ProviderEpisodePage,
  ProviderMedia,
  ProviderRequestContext,
  ProviderSearchResult,
  ProviderScope,
} from "./types.js";

function contextKey(context?: ProviderRequestContext): string {
  if (!context) return "";
  return [context.type, context.year ?? "", context.season ?? "", context.episode ?? ""].join(":");
}

/** Adds the same bounded, coalescing caches used by the existing anime clients. */
export class CachedDirectMediaProvider implements DirectMediaProvider {
  readonly scope: ProviderScope;
  private readonly searchCache: AsyncTtlCache<string, ProviderSearchResult[]>;
  private readonly mediaCache: AsyncTtlCache<string, ProviderMedia | null>;
  private readonly episodeCache: AsyncTtlCache<string, ProviderEpisodePage | null>;

  constructor(private readonly inner: DirectMediaProvider, config: AppConfig) {
    this.scope = inner.scope ?? "anime";
    this.searchCache = new AsyncTtlCache(config.searchCacheTtlMs, config.cacheMaxEntries);
    this.mediaCache = new AsyncTtlCache(config.mediaCacheTtlMs, config.cacheMaxEntries);
    // Player URLs may be temporary, so keep episode/player data on the short search TTL.
    this.episodeCache = new AsyncTtlCache(config.searchCacheTtlMs, config.cacheMaxEntries);
  }

  get id() { return this.inner.id; }
  get name() { return this.inner.name; }
  get baseUrl() { return this.inner.baseUrl; }
  get cdnBaseUrl() { return this.inner.cdnBaseUrl; }

  search(query: string, context?: ProviderRequestContext): Promise<ProviderSearchResult[]> {
    const cleaned = query.trim().replace(/\s+/g, " ").slice(0, 180);
    if (!cleaned) return Promise.resolve([]);
    const key = `${contextKey(context)}|${cleaned.toLocaleLowerCase("es")}`;
    return this.searchCache.getOrCreate(key, () => this.inner.search(cleaned, context));
  }

  getCatalog(kind: ProviderCatalogKind, page: number): Promise<ProviderCatalogPage> {
    return this.inner.getCatalog(kind, page);
  }

  getMedia(slug: string, context?: ProviderRequestContext): Promise<ProviderMedia | null> {
    const key = `${slug}|${contextKey(context)}`;
    return this.mediaCache.getOrCreate(key, () => this.inner.getMedia(slug, context));
  }

  getEpisode(slug: string, episode: number, context?: ProviderRequestContext): Promise<ProviderEpisodePage | null> {
    const key = `${slug}:${episode}|${contextKey(context)}`;
    return this.episodeCache.getOrCreate(key, () => this.inner.getEpisode(slug, episode, context));
  }
}
