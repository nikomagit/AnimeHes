import { afterEach, describe, expect, it, vi } from "vitest";
import type { FetchText } from "../src/lib/http.js";
import { DirectStreamResolverRegistry } from "../src/providers/resolvers.js";
import { testConfig } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());

describe("general direct stream resolvers", () => {
  it("does not support Cuevana players other than Trinity", async () => {
    const request: FetchText = vi.fn(async (rawUrl) => {
      const url = new URL(String(rawUrl));
      throw new Error(`Unexpected URL ${url}`);
    });
    const registry = new DirectStreamResolverRegistry(testConfig(), request);
    const result = await registry.resolveAll([
      { server: "Death Star", language: "Latino", url: "https://vidlink.pro/movie/438631" },
    ], "https://cuevana3l.biz/pelicula/dune-2");
    expect(result).toEqual([]);
    expect(request).not.toHaveBeenCalled();
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
