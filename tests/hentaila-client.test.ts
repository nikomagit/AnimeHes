import { describe, expect, it, vi } from "vitest";
import { HentailaClient } from "../src/providers/hentaila/client.js";
import type { FetchText } from "../src/lib/http.js";
import { testConfig } from "./helpers.js";

const searchPayload = JSON.stringify({
  type: "data",
  nodes: [null, null, {
    type: "data",
    data: [
      { results: 1 },
      [2],
      { id: 3, title: 4, synopsis: 5, slug: 6, category: 7 },
      "894",
      "Kaede to Suzu The Animation",
      "Synopsis",
      "kaede-to-suzu-the-animation",
      { id: 8, name: 9, slug: 10 },
      1,
      "OVA",
      "ova",
    ],
  }],
});

const mediaPayload = JSON.stringify({
  type: "data",
  nodes: [null, null, {
    type: "data",
    data: [
      { media: 1 },
      { id: 2, title: 3, slug: 4, aka: 5, startDate: 8, episodesCount: 9, category: 10, episodes: 13 },
      894,
      "Kaede to Suzu The Animation",
      "kaede-to-suzu-the-animation",
      { "en-us": 6, "ja-jp": 7 },
      "Love Me: Kaede and Suzu The Animation",
      "らぶみー『楓と鈴』 THE ANIMATION",
      "2022-03-25",
      3,
      { id: 11, name: 12, slug: 4 },
      1,
      "OVA",
      [14, 16, 18],
      { id: 15, number: 11 },
      2124,
      { id: 17, number: 11 },
      2288,
      { id: 19, number: 9 },
      2737,
    ],
  }],
});

const episodePayload = JSON.stringify({
  type: "data",
  nodes: [null, null, {
    type: "data",
    data: [
      { media: 1, episode: 20, embeds: 22 },
      { id: 2, title: 3, slug: 4, aka: 5, startDate: 8, episodesCount: 9, category: 10, episodes: 13 },
      894,
      "Kaede to Suzu The Animation",
      "kaede-to-suzu-the-animation",
      { "en-us": 6, "ja-jp": 7 },
      "Love Me: Kaede and Suzu The Animation",
      "らぶみー『楓と鈴』 THE ANIMATION",
      "2022-03-25",
      3,
      { id: 11, name: 12, slug: 4 },
      1,
      "OVA",
      [14, 16, 18],
      { id: 15, number: 11 },
      2124,
      { id: 17, number: 11 },
      2288,
      { id: 19, number: 9 },
      2737,
      { number: 11, mirrors: -1 },
      {},
      { SUB: 23 },
      [24, 27],
      { server: 25, url: 26 },
      "VIP",
      "https://cdn.hvidserv.com/play/c71fcc3dec50f5ff2d0dd7b80afb08d3",
      { server: 28, url: 29 },
      "MP4Upload",
      "https://www.mp4upload.com/embed-test.html",
    ],
  }],
});

describe("Hentaila public data client", () => {
  it("parses search, media aliases, episodes and mirrors", async () => {
    const request: FetchText = vi.fn(async (url) => {
      const path = new URL(url).pathname;
      if (path === "/catalogo/__data.json") return searchPayload;
      if (path.endsWith("/1/__data.json")) return episodePayload;
      return mediaPayload;
    });
    const client = new HentailaClient(testConfig(), request);
    await expect(client.search("Kaede to Suzu")).resolves.toMatchObject([
      { id: "894", title: "Kaede to Suzu The Animation", slug: "kaede-to-suzu-the-animation" },
    ]);
    await expect(client.getMedia("kaede-to-suzu-the-animation")).resolves.toMatchObject({
      aka: { "en-us": "Love Me: Kaede and Suzu The Animation" },
      episodes: [{ number: 1 }, { number: 1 }, { number: 3 }],
    });
    await expect(client.getEpisode("kaede-to-suzu-the-animation", 1)).resolves.toMatchObject({
      episodeNumber: 1,
      embeds: [
        { server: "VIP", language: "SUB" },
        { server: "MP4Upload", language: "SUB" },
      ],
    });
  });

  it("does not make requests for unsafe slugs", async () => {
    const request: FetchText = vi.fn();
    const client = new HentailaClient(testConfig(), request);
    await expect(client.getMedia("../admin")).resolves.toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});
