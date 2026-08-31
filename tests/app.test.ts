import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { UpstreamTimeoutError } from "../src/errors.js";
import type { StreamSearchService } from "../src/types.js";
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
    expect(response.json()).toMatchObject({
      id: "org.nuvio.animehes",
      resources: [{ name: "stream", idPrefixes: ["tt", "tmdb:", "kitsu:"] }],
      behaviorHints: { adult: true, p2p: false, configurable: false },
    });
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
