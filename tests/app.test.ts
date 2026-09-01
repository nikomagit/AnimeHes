import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { UpstreamTimeoutError } from "../src/errors.js";
import type { CatalogService, MetaService, StreamSearchService } from "../src/types.js";
import { testConfig } from "./helpers.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("HTTP addon interface", () => {
  it("serves a Nuvio-compatible, explicitly non-P2P manifest", async () => {
    const app = await buildApp(testConfig(), {
      searchService: { getStreams: vi.fn().mockResolvedValue([]) },
    });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/manifest.json" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("*");
    const body = response.json();
    expect(body).toMatchObject({
      id: "org.nuvio.animehes",
      version: "1.1.1",
      behaviorHints: { adult: true, p2p: false, configurable: false },
    });
    expect(body.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "catalog" }),
      expect.objectContaining({ name: "meta", idPrefixes: ["animehes:"] }),
      expect.objectContaining({ name: "stream", idPrefixes: ["tt", "tmdb:", "kitsu:", "animehes:"] }),
    ]));
    expect(body.catalogs.map((catalog: { id: string }) => catalog.id)).toEqual([
      "animeav1-popular",
      "animeav1-airing",
      "hentaila-popular",
      "hentaila-airing",
      "hentaila-uncensored",
    ]);
  });

  it("serves catalog pagination and provider-native metadata envelopes", async () => {
    const catalogService: CatalogService = {
      getCatalog: vi.fn().mockResolvedValue([{ id: "animehes:animeav1:one-piece", type: "series", name: "One Piece" }]),
    };
    const metaService: MetaService = {
      getMeta: vi.fn().mockResolvedValue({ id: "animehes:animeav1:one-piece", type: "series", name: "One Piece" }),
    };
    const app = await buildApp(testConfig(), {
      searchService: { getStreams: vi.fn().mockResolvedValue([]) },
      catalogService,
      metaService,
    });
    apps.push(app);
    const catalog = await app.inject({ method: "GET", url: "/catalog/series/animeav1-popular/skip=20.json" });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().metas).toHaveLength(1);
    expect(catalogService.getCatalog).toHaveBeenCalledWith("series", "animeav1-popular", 20);
    const meta = await app.inject({ method: "GET", url: "/meta/series/animehes:animeav1:one-piece.json" });
    expect(meta.statusCode).toBe(200);
    expect(meta.json().meta.name).toBe("One Piece");
  });

  it("returns the standard streams envelope", async () => {
    const service: StreamSearchService = {
      getStreams: vi.fn().mockResolvedValue([{ url: "https://cdn.example/video.mp4" }]),
    } as unknown as StreamSearchService;
    const app = await buildApp(testConfig(), { searchService: service });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/stream/movie/tt1234567.json" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ streams: [{ url: "https://cdn.example/video.mp4" }] });
  });

  it("maps upstream timeouts to a diagnostic response", async () => {
    const app = await buildApp(testConfig(), {
      searchService: {
        getStreams: vi.fn().mockRejectedValue(new UpstreamTimeoutError("Hentaila")),
      },
    });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/stream/movie/tt1234567.json" });
    expect(response.statusCode).toBe(504);
    expect(response.json()).toMatchObject({ streams: [], error: { code: "UPSTREAM_TIMEOUT" } });
  });
});
