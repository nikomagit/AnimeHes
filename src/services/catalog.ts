import { InvalidMediaRequestError } from "../errors.js";
import { findCatalogDefinition } from "../catalogs.js";
import { parseMediaType } from "../metadata/media-id.js";
import { providerMediaId } from "../metadata/provider-id.js";
import type { DirectMediaProvider, ProviderSearchResult } from "../providers/types.js";
import type { AddonMetaPreview, CatalogService, MediaType } from "../types.js";

const SITE_PAGE_SIZE = 20;

function mediaType(result: ProviderSearchResult): MediaType {
  const category = `${result.category?.slug ?? ""} ${result.category?.name ?? ""}`.toLocaleLowerCase("es");
  return /pel[ií]cula|movie/.test(category) ? "movie" : "series";
}

function image(baseUrl: string, folder: "covers" | "backdrops", id: string): string | undefined {
  if (!/^\d+$/.test(id)) return undefined;
  return new URL(`${folder}/${id}.jpg`, `${baseUrl}/`).toString();
}

export class ProviderCatalogService implements CatalogService {
  private readonly providers: Map<string, DirectMediaProvider>;

  constructor(providers: DirectMediaProvider[]) {
    this.providers = new Map(providers.map((provider) => [provider.id, provider]));
  }

  async getCatalog(rawType: string, id: string, skip: number): Promise<AddonMetaPreview[]> {
    parseMediaType(rawType);
    if (!Number.isSafeInteger(skip) || skip < 0 || skip > 1_000_000) {
      throw new InvalidMediaRequestError("Invalid catalog skip value");
    }
    const definition = findCatalogDefinition(id);
    if (!definition) throw new InvalidMediaRequestError("Unknown catalog");
    const provider = this.providers.get(definition.provider);
    if (!provider) return [];

    const pageNumber = Math.floor(skip / SITE_PAGE_SIZE) + 1;
    const firstPage = await provider.getCatalog(definition.kind, pageNumber);
    const pageSize = firstPage.recordsPerPage || SITE_PAGE_SIZE;
    const offset = Math.max(0, skip - (firstPage.currentPage - 1) * pageSize);
    let results = firstPage.results.slice(offset);
    if (results.length < pageSize && firstPage.currentPage < firstPage.totalPages) {
      const nextPage = await provider.getCatalog(definition.kind, firstPage.currentPage + 1);
      results = results.concat(nextPage.results).slice(0, pageSize);
    }
    return results.map((result) => this.preview(provider, result));
  }

  private preview(provider: DirectMediaProvider, result: ProviderSearchResult): AddonMetaPreview {
    const type = mediaType(result);
    const poster = image(provider.cdnBaseUrl, "covers", result.id);
    const background = image(provider.cdnBaseUrl, "backdrops", result.id);
    return {
      id: providerMediaId(provider.id, result.slug),
      type,
      name: result.title,
      ...(poster ? { poster } : {}),
      ...(background ? { background } : {}),
      ...(result.synopsis ? { description: result.synopsis } : {}),
      ...(result.category?.name ? { genres: [result.category.name] } : {}),
    };
  }
}
