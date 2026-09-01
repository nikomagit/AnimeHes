import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import {
  AppError,
  InvalidMediaRequestError,
  MetadataUnavailableError,
} from "./errors.js";
import { manifest } from "./manifest.js";
import { RemoteMetadataProvider } from "./metadata/client.js";
import { AnimeAv1Client } from "./providers/animeav1/client.js";
import { HentailaClient } from "./providers/hentaila/client.js";
import { JkAnimeClient } from "./providers/jkanime/client.js";
import { DirectStreamResolverRegistry } from "./providers/resolvers.js";
import { ProviderCatalogService } from "./services/catalog.js";
import { ProviderMetaService } from "./services/meta.js";
import { ProviderSearchService } from "./services/search.js";
import type { CatalogService, MetaService, StreamSearchService } from "./types.js";

export interface AppDependencies {
  searchService?: StreamSearchService;
  catalogService?: CatalogService;
  metaService?: MetaService;
}

interface StreamParams {
  type: string;
  id: string;
}

interface CatalogParams extends StreamParams {
  extra?: string;
}

interface CatalogQuery {
  skip?: string;
}

function catalogSkip(query: string | undefined, extra: string | undefined): number {
  const raw = query ?? (extra ? new URLSearchParams(extra).get("skip") ?? undefined : undefined);
  if (raw === undefined || raw === "") return 0;
  if (!/^\d+$/.test(raw)) throw new InvalidMediaRequestError("Invalid catalog skip value");
  return Number(raw);
}

function publicError(error: AppError) {
  return {
    streams: [],
    error: {
      code: error.code,
      message: error.expose ? error.message : "Request failed",
    },
  };
}

export async function buildApp(
  config: AppConfig,
  dependencies: AppDependencies = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.logLevel === "silent" ? false : { level: config.logLevel },
    trustProxy: true,
    bodyLimit: 16 * 1024,
    requestTimeout: config.requestTimeoutMs * 3 + config.metadataTimeoutMs + 2_000,
  });

  await app.register(cors, {
    origin: "*",
    methods: ["GET", "HEAD", "OPTIONS"],
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    void reply.header("x-content-type-options", "nosniff");
    void reply.header("referrer-policy", "no-referrer");
    return payload;
  });

  const animeAv1 = new AnimeAv1Client(config);
  const hentaila = new HentailaClient(config);
  const jkAnime = new JkAnimeClient(config);
  const providers = [animeAv1, hentaila, jkAnime];
  const resolvers = new DirectStreamResolverRegistry(config);
  const searchService = dependencies.searchService ?? new ProviderSearchService(
    config,
    new RemoteMetadataProvider(config),
    providers.map((provider) => ({ provider, resolvers })),
  );
  const catalogService = dependencies.catalogService ?? new ProviderCatalogService(providers);
  const metaService = dependencies.metaService ?? new ProviderMetaService(providers);

  app.get("/", async (_request, reply) => {
    void reply.header("cache-control", "public, max-age=300");
    return {
      name: manifest.name,
      version: manifest.version,
      protocol: "Stremio addon protocol (Nuvio compatible)",
      manifest: "/manifest.json",
      health: "/health",
      sources: ["AnimeAV1", "Hentaila", "JKAnime"],
      streaming: "Direct HTTP/HTTPS only",
      p2p: false,
    };
  });

  app.get("/manifest.json", async (_request, reply) => {
    void reply.header("cache-control", "public, max-age=86400");
    return manifest;
  });

  app.get("/health", async (_request, reply) => {
    void reply.header("cache-control", "no-store");
    return { status: "ok", version: manifest.version, sources: ["AnimeAV1", "Hentaila", "JKAnime"], p2p: false };
  });

  const serveCatalog = async (
    request: { params: CatalogParams; query: CatalogQuery; log: FastifyInstance["log"] },
    reply: { header(name: string, value: string): unknown },
  ) => {
    void reply.header("cache-control", "public, max-age=600, stale-if-error=3600");
    try {
      const skip = catalogSkip(request.query.skip, request.params.extra);
      return { metas: await catalogService.getCatalog(request.params.type, request.params.id, skip) };
    } catch (error) {
      request.log.warn({ error, catalogId: request.params.id }, "Catalog request failed");
      return { metas: [] };
    }
  };

  app.get<{ Params: CatalogParams; Querystring: CatalogQuery }>(
    "/catalog/:type/:id.json",
    serveCatalog,
  );
  app.get<{ Params: CatalogParams; Querystring: CatalogQuery }>(
    "/catalog/:type/:id/:extra.json",
    serveCatalog,
  );

  app.get<{ Params: StreamParams }>("/meta/:type/:id.json", async (request, reply) => {
    void reply.header("cache-control", "public, max-age=3600, stale-if-error=86400");
    try {
      return { meta: await metaService.getMeta(request.params.type, request.params.id) };
    } catch (error) {
      request.log.warn({ error, mediaId: request.params.id }, "Metadata request failed");
      return { meta: null };
    }
  });

  app.get<{ Params: StreamParams }>("/stream/:type/:id.json", async (request, reply) => {
    void reply.header("cache-control", "public, max-age=60, stale-if-error=300");
    try {
      return { streams: await searchService.getStreams(request.params.type, request.params.id) };
    } catch (error) {
      if (
        error instanceof InvalidMediaRequestError ||
        error instanceof MetadataUnavailableError
      ) {
        request.log.info(
          { code: error.code, mediaType: request.params.type, mediaId: request.params.id },
          error.message,
        );
        return { streams: [] };
      }
      throw error;
    }
  });

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Endpoint not found" } });
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof AppError) {
      request.log.warn({ code: error.code, error }, error.message);
      return reply.status(error.statusCode).send(publicError(error));
    }
    request.log.error({ error }, "Unhandled request error");
    return reply.status(500).send({
      streams: [],
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });

  return app;
}
