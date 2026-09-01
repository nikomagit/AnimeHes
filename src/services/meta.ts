import { parseMediaType } from "../metadata/media-id.js";
import { parseProviderMediaId, providerMediaId } from "../metadata/provider-id.js";
import type { DirectMediaProvider, ProviderMedia } from "../providers/types.js";
import type { AddonMeta, AddonVideo, MediaType, MetaService } from "../types.js";

function mediaType(media: ProviderMedia): MediaType {
  const category = `${media.category?.slug ?? ""} ${media.category?.name ?? ""}`.toLocaleLowerCase("es");
  return /pel[ií]cula|movie/.test(category) ? "movie" : "series";
}

function year(date: string | undefined): string | undefined {
  const match = date?.match(/^\d{4}/);
  return match?.[0];
}

function status(value: number | undefined): string | undefined {
  if (value === 0) return "Finalizado";
  if (value === 1) return "Próximamente";
  if (value === 2) return "En emisión";
  return undefined;
}

function image(provider: DirectMediaProvider, media: ProviderMedia, kind: "poster" | "backdrop"): string | undefined {
  const explicit = kind === "poster" ? media.poster : media.backdrop;
  if (explicit) return explicit;
  if (media.id === undefined) return undefined;
  const folder = kind === "poster" ? "covers" : "backdrops";
  return new URL(`${folder}/${media.id}.jpg`, `${provider.cdnBaseUrl}/`).toString();
}

export class ProviderMetaService implements MetaService {
  private readonly providers: Map<string, DirectMediaProvider>;

  constructor(providers: DirectMediaProvider[]) {
    this.providers = new Map(providers.map((provider) => [provider.id, provider]));
  }

  async getMeta(rawType: string, rawId: string): Promise<AddonMeta | null> {
    parseMediaType(rawType);
    const parsed = parseProviderMediaId(rawId);
    if (!parsed) return null;
    const provider = this.providers.get(parsed.provider);
    if (!provider) return null;
    const media = await provider.getMedia(parsed.slug);
    if (!media) return null;
    const id = providerMediaId(provider.id, media.slug);
    const type = mediaType(media);
    const poster = image(provider, media, "poster");
    const background = image(provider, media, "backdrop");
    const releaseInfo = year(media.startDate);
    const mediaStatus = status(media.status);
    const videos = type === "series" ? this.videos(provider, media) : undefined;
    return {
      id,
      type,
      name: media.title,
      ...(poster ? { poster } : {}),
      ...(background ? { background } : {}),
      ...(media.synopsis ? { description: media.synopsis } : {}),
      ...(releaseInfo ? { releaseInfo } : {}),
      ...(media.genres.length ? { genres: media.genres.map((genre) => genre.name) } : {}),
      ...(videos?.length ? { videos } : {}),
      ...(media.runtime ? { runtime: `${media.runtime} min` } : {}),
      ...(media.score !== undefined ? { imdbRating: String(media.score) } : {}),
      ...(mediaStatus ? { status: mediaStatus } : {}),
    };
  }

  private videos(provider: DirectMediaProvider, media: ProviderMedia): AddonVideo[] {
    return [...media.episodes]
      .sort((left, right) => left.number - right.number)
      .map((item) => ({
        id: providerMediaId(provider.id, media.slug, item.number),
        title: item.title || `Episodio ${item.relativeNumber ?? item.number}`,
        season: item.season || 1,
        episode: item.relativeNumber ?? item.number,
        ...(item.publishedAt ? { released: item.publishedAt } : {}),
      }));
  }
}
