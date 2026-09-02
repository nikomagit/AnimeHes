import { afterEach, describe, expect, it, vi } from "vitest";
import type { FetchText } from "../src/lib/http.js";
import { GeneralStreamResolver } from "../src/providers/general/resolvers.js";
import { DirectStreamResolverRegistry, type ResolvedDirectStream } from "../src/providers/resolvers.js";
import { testConfig } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());

function stream(server: string, url: string): ResolvedDirectStream {
  return { server, language: "Latino", url, type: "hls", label: "HLS", headers: {} };
}

describe("general direct stream resolvers", () => {
  it("uses only Trinity when Trinity resolves successfully", async () => {
    const spy = vi.spyOn(GeneralStreamResolver.prototype, "resolve").mockImplementation(async (embed) => [
      stream(embed.server, embed.server === "Trinity" ? "https://cdn.example/trinity.m3u8" : "https://cdn.example/alternate.m3u8"),
    ]);
    const registry = new DirectStreamResolverRegistry(testConfig());
    const result = await registry.resolveAll([
      { server: "Vimeos", language: "Latino", url: "https://vimeos.net/embed-alt.html" },
      { server: "Trinity", language: "Latino", url: "https://player.videasy.net/movie/438631" },
    ], "https://cuevana3l.biz/pelicula/duna");
    expect(result.map((item) => item.server)).toEqual(["Trinity"]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("falls back to other Cuevana players when Trinity fails", async () => {
    vi.spyOn(GeneralStreamResolver.prototype, "resolve").mockImplementation(async (embed) => embed.server === "Trinity"
      ? []
      : [stream(embed.server, "https://cdn.example/fallback.m3u8")]);
    const registry = new DirectStreamResolverRegistry(testConfig());
    const result = await registry.resolveAll([
      { server: "Trinity", language: "Latino", url: "https://player.videasy.net/movie/438631" },
      { server: "Vimeos", language: "Latino", url: "https://vimeos.net/embed-alt.html" },
    ], "https://cuevana3l.biz/pelicula/duna");
    expect(result).toEqual([expect.objectContaining({ server: "Vimeos" })]);
  });

  it("actually probes a supported Cuevana alternate after Trinity fails", async () => {
    const request: FetchText = vi.fn(async (rawUrl) => {
      const url = new URL(String(rawUrl));
      if (url.hostname === "api.speedracelight.com") return JSON.stringify({});
      if (url.hostname === "vidlink.pro") return '<script>const file="https://moon.peakstorm.top/fallback/master.m3u8";</script>';
      throw new Error(`Unexpected URL ${url}`);
    });
    const registry = new DirectStreamResolverRegistry(testConfig(), request);
    const result = await registry.resolveAll([
      { server: "Trinity", language: "Latino", url: "https://player.videasy.net/movie/438631" },
      { server: "Death Star", language: "Latino", url: "https://vidlink.pro/movie/438631" },
    ], "https://cuevana3l.biz/pelicula/dune-2");
    expect(result).toEqual([expect.objectContaining({ server: "Death Star", url: "https://moon.peakstorm.top/fallback/master.m3u8" })]);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ hostname: "vidlink.pro" }), expect.anything());
  });

  it("statically unpacks a Vimeos master HLS and supplies playback headers", async () => {
    const packed = "eval(function(p,a,c,k,e,d){return p;}('{0:\"1\"}',36,2,'file|https://cdn.vimeos.zip/media/master.m3u8?token=test'.split('|')))";
    const request: FetchText = vi.fn().mockResolvedValue(packed);
    const registry = new DirectStreamResolverRegistry(testConfig(), request);
    const result = await registry.resolveAll([
      { server: "Vimeos", language: "Castellano", quality: "1080p", url: "https://vimeos.net/embed-test.html" },
    ], "https://lamovie.org/movie/test");
    expect(result).toEqual([expect.objectContaining({
      server: "Vimeos",
      language: "Castellano",
      quality: "1080p",
      type: "hls",
      url: "https://cdn.vimeos.zip/media/master.m3u8?token=test",
      headers: expect.objectContaining({ Origin: "https://vimeos.net", Referer: "https://vimeos.net/embed-test.html" }),
    })]);
  });

  it("does not accept a Vimeos-like playlist on an arbitrary domain", async () => {
    const packed = "eval(function(p,a,c,k,e,d){return p;}('{0:\"1\"}',36,2,'file|https://attacker.example/media/master.m3u8'.split('|')))";
    const registry = new DirectStreamResolverRegistry(testConfig(), vi.fn().mockResolvedValue(packed));
    await expect(registry.resolveAll([
      { server: "Vimeos", language: "Latino", url: "https://vimeos.net/embed-test.html" },
    ], "https://lamovie.org/movie/test")).resolves.toEqual([]);
  });
});
