import { describe, expect, it, vi } from "vitest";
import type { MetadataProvider } from "../src/metadata/client.js";
import type { DirectStreamResolver } from "../src/providers/resolvers.js";
import type { DirectMediaProvider, ProviderId } from "../src/providers/types.js";
import { ProviderSearchService } from "../src/services/search.js";
import { testConfig } from "./helpers.js";

const media = {
  id: 197,
  title: "One Piece",
  slug: "one-piece",
  aka: { "ja-jp": "ONE PIECE" },
  startDate: "1999-10-20",
  genres: [],
  episodes: [{ number: 1 }, { number: 1176 }],
};

function provider(id: ProviderId, failure = false): DirectMediaProvider {
  return {
    id,
    name: id === "animeav1" ? "AnimeAV1" : "Hentaila",
    baseUrl: `https://${id}.example`,
    cdnBaseUrl: `https://cdn.${id}.example`,
    search: failure
      ? vi.fn().mockRejectedValue(new Error("provider unavailable"))
      : vi.fn().mockResolvedValue([{ id: "197", title: "One Piece", slug: "one-piece" }]),
    getCatalog: vi.fn(),
    getMedia: vi.fn().mockResolvedValue(media),
    getEpisode: vi.fn().mockResolvedValue({
      media,
      episodeNumber: 1176,
      embeds: [{ server: "HLS", language: "SUB", url: "https://player.zilla-networks.com/play/id" }],
    }),
  };
}

const metadata: MetadataProvider = {
  resolve: vi.fn().mockResolvedValue({
    provider: "imdb",
    baseId: "tt0388629",
    type: "series",
    title: "One Piece",
    aliases: ["ONE PIECE"],
    year: 1999,
    season: 1,
    episode: 1176,
  }),
};

function resolver(url = "https://video.example/master.m3u8"): DirectStreamResolver {
  return {
    resolveAll: vi.fn().mockResolvedValue([{
      server: "HLS",
      language: "SUB",
      url,
      type: "hls",
      label: "HLS",
      headers: { Referer: "https://player.example/play/id" },
    }]),
  };
}

describe("multi-provider stream orchestration", () => {
  it("keeps AnimeAV1 working when Hentaila fails", async () => {
    const anime = provider("animeav1");
    const hentai = provider("hentaila", true);
    const service = new ProviderSearchService(testConfig(), metadata, [
      { provider: anime, resolvers: resolver() },
      { provider: hentai, resolvers: resolver("https://other.example/master.m3u8") },
    ]);
    const streams = await service.getStreams("series", "tt0388629:1:1176");
    expect(streams).toHaveLength(1);
    expect(streams[0]?.name).toContain("AnimeAV1");
  });

  it("keeps Hentaila working when AnimeAV1 fails", async () => {
    const service = new ProviderSearchService(testConfig(), metadata, [
      { provider: provider("animeav1", true), resolvers: resolver() },
      { provider: provider("hentaila"), resolvers: resolver() },
    ]);
    const streams = await service.getStreams("series", "tt0388629:1:1176");
    expect(streams).toHaveLength(1);
    expect(streams[0]?.name).toContain("Hentaila");
  });

  it("deduplicates identical final URLs across providers", async () => {
    const shared = "https://video.example/same.m3u8";
    const service = new ProviderSearchService(testConfig(), metadata, [
      { provider: provider("animeav1"), resolvers: resolver(shared) },
      { provider: provider("hentaila"), resolvers: resolver(shared) },
    ]);
    await expect(service.getStreams("series", "tt0388629:1:1176")).resolves.toHaveLength(1);
  });

  it("resolves AnimeAV1 catalog episode IDs directly without external metadata", async () => {
    const directMetadata: MetadataProvider = { resolve: vi.fn() };
    const anime = provider("animeav1");
    const service = new ProviderSearchService(testConfig(), directMetadata, [
      { provider: anime, resolvers: resolver() },
    ]);
    const streams = await service.getStreams("series", "animehes:animeav1:one-piece:1176");
    expect(streams).toHaveLength(1);
    expect(anime.getEpisode).toHaveBeenCalledWith("one-piece", 1176);
    expect(directMetadata.resolve).not.toHaveBeenCalled();
  });
});
