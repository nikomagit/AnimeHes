import { loadConfig } from "../src/config.js";
import { RemoteMetadataProvider, type MetadataProvider } from "../src/metadata/client.js";
import { CuevanaClient } from "../src/providers/cuevana/client.js";
import { AnimeAv1Client } from "../src/providers/animeav1/client.js";
import { HentailaClient } from "../src/providers/hentaila/client.js";
import { JkAnimeClient } from "../src/providers/jkanime/client.js";
import { LaMovieClient } from "../src/providers/lamovie/client.js";
import { DirectStreamResolverRegistry } from "../src/providers/resolvers.js";
import type { DirectMediaProvider } from "../src/providers/types.js";
import { ProviderSearchService } from "../src/services/search.js";
import type { AddonStream, MediaMetadata, MediaType } from "../src/types.js";

interface CheckTarget {
  label: string;
  type: MediaType;
  id: string;
  metadata?: MediaMetadata;
  providers?: string[];
  remoteMetadata?: boolean;
}

interface Validation {
  provider: string;
  target: string;
  streams: number;
  checked: number;
  valid: number;
  matchedTitles: string[];
  results: Array<{ server: string; type: string; status: number; contentType: string; finalHost: string; playlist: boolean }>;
  error?: string;
}

const config = loadConfig({
  ...process.env,
  LOG_LEVEL: "silent",
  REQUEST_TIMEOUT_MS: "15000",
  METADATA_TIMEOUT_MS: "10000",
  MAX_STREAMS: "8",
});
const resolver = new DirectStreamResolverRegistry(config);
const providers: DirectMediaProvider[] = [
  new CuevanaClient(config),
  new LaMovieClient(config),
];

const targets: CheckTarget[] = [
  {
    label: "Dune (2021)", type: "movie", id: "tt1160419",
    metadata: { provider: "imdb", baseId: "tt1160419", type: "movie", title: "Dune", aliases: ["Duna"], year: 2021 },
  },
  {
    label: "The Matrix (1999)", type: "movie", id: "tt0133093",
    metadata: { provider: "imdb", baseId: "tt0133093", type: "movie", title: "The Matrix", aliases: ["Matrix"], year: 1999 },
  },
  {
    label: "Breaking Bad S1E1", type: "series", id: "tt0903747:1:1",
    metadata: { provider: "imdb", baseId: "tt0903747", type: "series", title: "Breaking Bad", aliases: [], year: 2008, season: 1, episode: 1 },
  },
  {
    label: "Breaking Bad S3E5", type: "series", id: "tt0903747:3:5",
    metadata: { provider: "imdb", baseId: "tt0903747", type: "series", title: "Breaking Bad", aliases: [], year: 2008, season: 3, episode: 5 },
  },
  {
    label: "How I Met Your Mother → Cómo conocí a vuestra madre S1E1",
    type: "series", id: "tt0460649:1:1", providers: ["cuevana"], remoteMetadata: true,
  },
  {
    label: "Money Heist → La Casa de Papel S1E1",
    type: "series", id: "tt6468322:1:1", providers: ["cuevana"], remoteMetadata: true,
  },
  {
    label: "The Matrix → Matrix (1999)",
    type: "movie", id: "tt0133093", providers: ["lamovie"], remoteMetadata: true,
  },
];

function serverName(stream: AddonStream): string {
  return stream.name.split("•").at(-1)?.trim() || "unknown";
}

async function validateStream(stream: AddonStream) {
  const headers = new Headers(stream.behaviorHints?.proxyHeaders?.request ?? {});
  if (stream.type === "mp4") headers.set("range", "bytes=0-2047");
  const response = await fetch(stream.url, { redirect: "follow", headers, signal: AbortSignal.timeout(15_000) });
  const contentType = response.headers.get("content-type") ?? "";
  let playlist = false;
  if (stream.type === "hls" && response.ok) {
    const body = await response.text();
    playlist = body.trimStart().startsWith("#EXTM3U");
  } else if (response.body) {
    await response.body.cancel();
  }
  return {
    server: serverName(stream),
    type: stream.type ?? "unknown",
    status: response.status,
    contentType,
    finalHost: new URL(response.url).hostname,
    playlist,
  };
}

const validations: Validation[] = [];
for (const target of targets) {
  for (const provider of providers.filter((item) => !target.providers || target.providers.includes(item.id))) {
    const metadataProvider: MetadataProvider = target.remoteMetadata
      ? new RemoteMetadataProvider(config)
      : { resolve: async () => target.metadata! };
    const service = new ProviderSearchService(config, metadataProvider, [{ provider, resolvers: resolver }]);
    try {
      const streams = await service.getStreams(target.type, target.id);
      const results = [];
      for (const stream of streams.slice(0, 2)) {
        try { results.push(await validateStream(stream)); } catch (error) {
          results.push({ server: serverName(stream), type: stream.type ?? "unknown", status: 0, contentType: "", finalHost: "", playlist: false });
        }
      }
      validations.push({
        provider: provider.name,
        target: target.label,
        streams: streams.length,
        checked: results.length,
        valid: results.filter((item) => item.status >= 200 && item.status < 400 && (item.type !== "hls" || item.playlist)).length,
        matchedTitles: streams.map((stream) => stream.title.split("\n")[0] ?? stream.title),
        results,
      });
    } catch (error) {
      validations.push({ provider: provider.name, target: target.label, streams: 0, checked: 0, valid: 0, matchedTitles: [], results: [], error: error instanceof Error ? error.message : "unknown error" });
    }
  }
}

for (const check of [
  { provider: new AnimeAv1Client(config), slug: "one-piece", episode: 1, label: "AnimeAV1 regression" },
  { provider: new JkAnimeClient(config), slug: "one-piece", episode: 1, label: "JKAnime regression" },
  { provider: new HentailaClient(config), slug: "kaede-to-suzu-the-animation", episode: 1, label: "Hentaila regression" },
]) {
  try {
    const media = await check.provider.getMedia(check.slug);
    const episode = media ? await check.provider.getEpisode(check.slug, check.episode) : null;
    const streams = episode ? await resolver.resolveAll(episode.embeds, episode.pageUrl ?? check.provider.baseUrl) : [];
    const results = [];
    for (const stream of streams.slice(0, 1)) {
      const addonStream: AddonStream = {
        name: `AMOKIN\n${check.provider.name} • ${stream.server}`,
        title: check.label,
        description: check.label,
        url: stream.url,
        type: stream.type,
        behaviorHints: { proxyHeaders: { request: stream.headers } },
      };
      results.push(await validateStream(addonStream));
    }
    validations.push({
      provider: check.provider.name, target: check.label, streams: streams.length, checked: results.length,
      valid: results.filter((item) => item.status >= 200 && item.status < 400 && (item.type !== "hls" || item.playlist)).length,
      matchedTitles: [check.label],
      results,
    });
  } catch (error) {
    validations.push({ provider: check.provider.name, target: check.label, streams: 0, checked: 0, valid: 0, matchedTitles: [], results: [], error: error instanceof Error ? error.message : "unknown error" });
  }
}

process.stdout.write(`${JSON.stringify(validations, null, 2)}\n`);
