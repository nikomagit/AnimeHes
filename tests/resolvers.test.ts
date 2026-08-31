import { describe, expect, it, vi } from "vitest";
import type { FetchText } from "../src/lib/http.js";
import { DirectStreamResolverRegistry } from "../src/providers/hentaila/resolvers.js";
import { testConfig } from "./helpers.js";

describe("direct video resolvers", () => {
  it("resolves only verified VIP, YourUpload and MP4Upload mirrors", async () => {
    const request: FetchText = vi.fn(async (url) => {
      const host = new URL(url).hostname;
      if (host.includes("yourupload")) {
        return `file: "https://vidcache.net:8161/path/video.mp4"`;
      }
      if (host.includes("mp4upload")) {
        return `player.src({ type: "video/mp4", src: "https://a1.mp4upload.com:183/d/token/video.mp4" });`;
      }
      throw new Error("unexpected resolver request");
    });
    const registry = new DirectStreamResolverRegistry(testConfig(), request);
    const result = await registry.resolveAll([
      { server: "VIP", language: "SUB", url: "https://cdn.hvidserv.com/play/c71fcc3dec50f5ff2d0dd7b80afb08d3" },
      { server: "Mega", language: "SUB", url: "https://mega.nz/embed/not-direct" },
      { server: "YourUpload", language: "SUB", url: "https://www.yourupload.com/embed/example" },
      { server: "MP4Upload", language: "SUB", url: "https://www.mp4upload.com/embed-example.html" },
    ], "https://hentaila.com/media/title/1");

    expect(result.map((item) => [item.server, item.type])).toEqual([
      ["VIP", "hls"],
      ["YourUpload", "mp4"],
      ["MP4Upload", "mp4"],
    ]);
    expect(result[0]?.url).toBe("https://cdn.hvidserv.com/m3u8/c71fcc3dec50f5ff2d0dd7b80afb08d3");
    expect(result[0]?.headers).toMatchObject({
      Referer: "https://cdn.hvidserv.com/play/c71fcc3dec50f5ff2d0dd7b80afb08d3",
      Origin: "https://cdn.hvidserv.com",
    });
  });

  it("rejects media URLs injected from an unexpected host", async () => {
    const request: FetchText = vi.fn().mockResolvedValue(`file: "https://evil.example/video.mp4"`);
    const registry = new DirectStreamResolverRegistry(testConfig(), request);
    await expect(registry.resolveAll([
      { server: "YourUpload", language: "SUB", url: "https://www.yourupload.com/embed/example" },
    ], "https://hentaila.com/media/title/1")).resolves.toEqual([]);
  });
});
