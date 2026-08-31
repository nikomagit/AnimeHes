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
import { HentailaClient } from "./providers/hentaila/client.js";
import { DirectStreamResolverRegistry } from "./providers/hentaila/resolvers.js";
import { HentailaSearchService } from "./services/search.js";
import type { StreamSearchService } from "./types.js";

export interface AppDependencies {
  searchService?: StreamSearchService;
}

interface StreamParams {
  type: string;
  id: string;
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

  const hentaila = new HentailaClient(config);
  const searchService = dependencies.searchService ?? new HentailaSearchService(
    config,
    new RemoteMetadataProvider(config),
    hentaila,
    new DirectStreamResolverRegistry(config),
  );

  app.get("/", async (_request, reply) => {
    void reply.header("cache-control", "public, max-age=300");
    return {
      name: manifest.name,
      version: manifest.version,
      protocol: "Stremio addon protocol (Nuvio compatible)",
      manifest: "/manifest.json",
      health: "/health",
      source: "Hentaila",
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
    return { status: "ok", version: manifest.version, source: "Hentaila", p2p: false };
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
