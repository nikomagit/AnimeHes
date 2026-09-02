import { describe, expect, it, vi } from "vitest";
import { CuevanaClient } from "../src/providers/cuevana/client.js";
import { episodeKey } from "../src/providers/general/helpers.js";
import { LaMovieClient } from "../src/providers/lamovie/client.js";
import type { FetchText } from "../src/lib/http.js";
import { testConfig } from "./helpers.js";

describe("general movie and series provider clients", () => {
  it("LaMovie selects an exact later-season episode and ignores non-HTTP downloads", async () => {
    const request: FetchText = vi.fn(async (rawUrl) => {
      const url = new URL(String(rawUrl));
      if (url.pathname === "/wp-api/v1/search") {
        return JSON.stringify({ data: { posts: [
          { _id: 20, type: "tvshows", slug: "breaking-bad", title: "Breaking Bad", release_date: "2008-01-20" },
          { _id: 21, type: "movies", slug: "breaking-bad-film", title: "Breaking Bad Film", release_date: "2020-01-01" },
        ] } });
      }
      if (url.pathname === "/wp-api/v1/single/tvshows") {
        return JSON.stringify({ data: { _id: 20, title: "Breaking Bad", original_title: "Breaking Bad", release_date: "2008-01-20" } });
      }
      if (url.pathname === "/wp-api/v1/single/episodes/list") {
        expect(url.searchParams.get("season")).toBe("3");
        return JSON.stringify({ data: { posts: [
          { _id: 305, show_id: "1396", season_number: 3, episode_number: 5, title: "Más" },
          { _id: 306, show_id: "1396", season_number: 3, episode_number: 6, title: "Sunset" },
        ] } });
      }
      if (url.pathname === "/wp-api/v1/player") {
        expect(url.searchParams.get("postId")).toBe("305");
        return JSON.stringify({ data: {
          downloads: [{ url: "magnet:?xt=urn:btih:not-allowed" }],
          embeds: [{ url: "https://vimeos.net/embed-test.html", lang: "Latino", quality: "1080p" }],
        } });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const client = new LaMovieClient(testConfig(), request);
    const context = { type: "series" as const, title: "Breaking Bad", aliases: [], externalIds: { imdb: "tt0903747", tmdb: 1396 }, year: 2008, season: 3, episode: 5 };
    const results = await client.search("Breaking Bad", context);
    expect(results).toEqual([expect.objectContaining({ slug: "series-breaking-bad", mediaType: "series", year: 2008 })]);
    const media = await client.getMedia("series-breaking-bad", context);
    expect(media?.externalIds).toEqual({ tmdb: 1396 });
    expect(media?.episodes).toContainEqual(expect.objectContaining({ number: episodeKey(3, 5), season: 3, relativeNumber: 5 }));
    const episode = await client.getEpisode("series-breaking-bad", episodeKey(3, 5), context);
    expect(episode?.embeds).toEqual([expect.objectContaining({ server: "Vimeos", language: "Latino", quality: "1080p" })]);
    expect(JSON.stringify(episode)).not.toContain("magnet:");
  });

  it("Cuevana resolves the requested season page and decodes Trinity without executing scripts", async () => {
    const trinity = "https://player.videasy.net/tv/1396/3/5";
    const wrapper = `https://cuevana3l.biz/ir/player.php?v=${Buffer.from(trinity).toString("base64")}`;
    const alternate = `https://cuevana3l.biz/ir/player.php?v=${Buffer.from("https://vidlink.pro/tv/1396/3/5").toString("base64")}`;
    const request: FetchText = vi.fn(async (rawUrl) => {
      const url = new URL(String(rawUrl));
      if (url.pathname === "/explorar") return `
        <div class="movie-item"><a href="https://cuevana3l.biz/serie/breaking-bad">
          <div class="item-detail"><p>Breaking Bad</p><span class="year">2008</span></div>
        </a></div>`;
      if (url.pathname === "/serie/breaking-bad") return "<h1>Serie Breaking Bad</h1>";
      if (url.pathname === "/serie/breaking-bad/temporada-3") {
        return '<a href="https://cuevana3l.biz/serie/breaking-bad/episodio-3x5">Episode 5</a>';
      }
      if (url.pathname === "/serie/breaking-bad/episodio-3x5") return `
        <div class="tab-item-name">Latino<div></div></div>
        <li data-server="${alternate}"><span>Servidor Death Star</span></li>
        <li data-server="${wrapper}"><span>Servidor Trinity</span></li>`;
      throw new Error(`Unexpected URL ${url}`);
    });
    const client = new CuevanaClient(testConfig(), request);
    const context = { type: "series" as const, title: "Breaking Bad", aliases: [], externalIds: { imdb: "tt0903747", tmdb: 1396 }, year: 2008, season: 3, episode: 5 };
    expect(await client.search("Breaking Bad", context)).toEqual([
      expect.objectContaining({ slug: "series-breaking-bad", mediaType: "series", year: 2008 }),
    ]);
    expect(await client.searchByExternalIds(context)).toEqual([
      expect.objectContaining({ slug: "series-breaking-bad", externalIds: { tmdb: 1396 } }),
    ]);
    const media = await client.getMedia("series-breaking-bad", context);
    expect(media?.externalIds).toEqual({ tmdb: 1396 });
    expect(media?.episodes).toEqual([{ number: episodeKey(3, 5), season: 3, relativeNumber: 5 }]);
    const episode = await client.getEpisode("series-breaking-bad", episodeKey(3, 5), context);
    expect(episode?.embeds).toEqual([expect.objectContaining({ server: "Trinity", url: trinity, language: "Latino" })]);
  });

  it("LaMovie preserves the original title and verifies a translated movie through its player TMDB ID", async () => {
    const request: FetchText = vi.fn(async (rawUrl) => {
      const url = new URL(String(rawUrl));
      if (url.pathname === "/wp-api/v1/search") return JSON.stringify({ data: { posts: [{
        _id: 90, type: "movies", slug: "que-paso-ayer-2009", title: "¿Qué Pasó Ayer? (2009)",
        original_title: "The Hangover", release_date: "2009-06-02",
      }] } });
      if (url.pathname === "/wp-api/v1/single/movies") return JSON.stringify({ data: {
        _id: 90, title: "¿Qué Pasó Ayer? (2009)", original_title: "The Hangover", release_date: "2009-06-02",
      } });
      if (url.pathname === "/wp-api/v1/player") return JSON.stringify({ data: { embeds: [
        { url: "https://videoapp.zip/e/movie/18785", server: "videoapp", lang: "Latino", quality: "Full HD" },
      ] } });
      throw new Error(`Unexpected URL ${url}`);
    });
    const client = new LaMovieClient(testConfig(), request);
    const context = {
      type: "movie" as const, title: "The Hangover", aliases: ["¿Qué pasó ayer?"],
      externalIds: { imdb: "tt1119646", tmdb: 18785 }, year: 2009,
    };
    await expect(client.search("¿Qué pasó ayer?", context)).resolves.toEqual([
      expect.objectContaining({ title: "¿Qué Pasó Ayer?", aliases: ["The Hangover"] }),
    ]);
    await expect(client.getMedia("movie-que-paso-ayer-2009", context)).resolves.toMatchObject({
      title: "¿Qué Pasó Ayer?", aka: { original: "The Hangover" }, externalIds: { tmdb: 18785 },
    });
  });

  it("Cuevana extracts a movie TMDB ID from its encoded public player URL", async () => {
    const player = "https://player.videasy.net/movie/603";
    const wrapper = `https://cuevana3l.biz/ir/player.php?v=${Buffer.from(player).toString("base64")}`;
    const request: FetchText = vi.fn().mockResolvedValue(`
      <meta property="og:title" content="Matrix (1999)">
      <h1>Matrix 8.2</h1>
      <li data-server="${wrapper}"><span>Servidor Trinity</span></li>`);
    const client = new CuevanaClient(testConfig(), request);
    await expect(client.getMedia("movie-matrix", {
      type: "movie", title: "The Matrix", aliases: ["Matrix"],
      externalIds: { imdb: "tt0133093", tmdb: 603 }, year: 1999,
    })).resolves.toMatchObject({ title: "Matrix", externalIds: { tmdb: 603 } });
  });
});
