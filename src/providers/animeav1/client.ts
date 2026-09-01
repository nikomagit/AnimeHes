import type { AppConfig } from "../../config.js";
import { fetchText, type FetchText } from "../../lib/http.js";
import { SvelteMediaClient } from "../svelte/client.js";

export class AnimeAv1Client extends SvelteMediaClient {
  constructor(config: AppConfig, request: FetchText = fetchText) {
    super({
      id: "animeav1",
      name: "AnimeAV1",
      baseUrl: config.animeAv1BaseUrl,
      cdnBaseUrl: config.animeAv1CdnBaseUrl,
      requestTimeoutMs: config.requestTimeoutMs,
      maxResponseBytes: config.maxResponseBytes,
      searchCacheTtlMs: config.searchCacheTtlMs,
      mediaCacheTtlMs: config.mediaCacheTtlMs,
      catalogCacheTtlMs: config.catalogCacheTtlMs,
      cacheMaxEntries: config.cacheMaxEntries,
      userAgent: config.userAgent,
    }, request);
  }
}
