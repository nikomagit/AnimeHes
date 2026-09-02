import { describe, expect, it, vi } from "vitest";
import { CineCalidadClient } from "../src/providers/cinecalidad/client.js";
import { CuevanaClient } from "../src/providers/cuevana/client.js";
import { episodeKey } from "../src/providers/general/helpers.js";
import { GnulaHdClient } from "../src/providers/gnulahd/client.js";
import { LaMovieClient } from "../src/providers/lamovie/client.js";
import type { FetchText } from "../src/lib/http.js";
import { testConfig } from "./helpers.js";

function xorGnula(value: unknown): string {
  const input = Buffer.from(JSON.stringify(value), "utf8");
  const key = [103, 78, 55, 100];
  for (let index = 0; index < input.length; index += 1) {
    input[index] = (input[index] ?? 0) ^ (key[index & 3] ?? 0);
  }
  return input.toString("base64");
}

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
          { _id: 305, season_number: 3, episode_number: 5, title: "Más" },
          { _id: 306, season_number: 3, episode_number: 6, title: "Sunset" },
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
    const context = { type: "series" as const, title: "Breaking Bad", aliases: [], year: 2008, season: 3, episode: 5 };
    const results = await client.search("Breaking Bad", context);
    expect(results).toEqual([expect.objectContaining({ slug: "series-breaking-bad", mediaType: "series", year: 2008 })]);
    const media = await client.getMedia("series-breaking-bad", context);
    expect(media?.episodes).toContainEqual(expect.objectContaining({ number: episodeKey(3, 5), season: 3, relativeNumber: 5 }));
    const episode = await client.getEpisode("series-breaking-bad", episodeKey(3, 5), context);
    expect(episode?.embeds).toEqual([expect.objectContaining({ server: "Vimeos", language: "Latino", quality: "1080p" })]);
    expect(JSON.stringify(episode)).not.toContain("magnet:");
  });

  it("Cuevana resolves the requested season page and decodes Trinity without executing scripts", async () => {
    const trinity = "https://player.videasy.net/tv/1396/3/5";
    const wrapper = `https://cuevana3l.biz/ir/player.php?v=${Buffer.from(trinity).toString("base64")}`;
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
        <li data-server="${wrapper}"><span>Servidor Trinity</span></li>`;
      throw new Error(`Unexpected URL ${url}`);
    });
    const client = new CuevanaClient(testConfig(), request);
    const context = { type: "series" as const, title: "Breaking Bad", aliases: [], year: 2008, season: 3, episode: 5 };
    expect(await client.search("Breaking Bad", context)).toEqual([
      expect.objectContaining({ slug: "series-breaking-bad", mediaType: "series", year: 2008 }),
    ]);
    const media = await client.getMedia("series-breaking-bad", context);
    expect(media?.episodes).toEqual([{ number: episodeKey(3, 5), season: 3, relativeNumber: 5 }]);
    const episode = await client.getEpisode("series-breaking-bad", episodeKey(3, 5), context);
    expect(episode?.embeds).toEqual([expect.objectContaining({ server: "Trinity", url: trinity, language: "Latino" })]);
  });

  it("GnulaHD decodes its public player response and preserves language/server labels", async () => {
    const request: FetchText = vi.fn(async (rawUrl) => {
      const url = new URL(String(rawUrl));
      if (url.pathname === "/wp-json/gnrd/v1/search") {
        return JSON.stringify({ results: [{ type: "serie", title: "Los tipos malos: Malos comienzos", year: "2025", url: "https://ww3.gnulahd.nu/ver/los-tipos-malos/" }] });
      }
      if (url.pathname === "/ver/los-tipos-malos/") return `
        <meta property="og:title" content="Los tipos malos: Malos comienzos (2025)">
        <h1>Los tipos malos: Malos comienzos</h1>
        <a class="gnrd-epc" href="https://ww3.gnulahd.nu/ver/los-tipos-malos-2x5/" data-id="205" data-t="a1b2" data-s="2" data-e="5">
          <span class="gnrd-epc-title">Episodio 5</span>
        </a>`;
      if (url.pathname === "/wp-json/gnrd/v1/player") {
        expect(url.searchParams.get("id")).toBe("205");
        return JSON.stringify({ p: xorGnula({ langs: [{ label: "Subtitulado", servers: [{ src: "https://vidara.to/e/abc123", title: "Server 1" }] }] }) });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const client = new GnulaHdClient(testConfig(), request);
    const context = { type: "series" as const, title: "Los tipos malos: Malos comienzos", aliases: [], year: 2025, season: 2, episode: 5 };
    const media = await client.getMedia("series-los-tipos-malos", context);
    expect(media?.episodes).toContainEqual(expect.objectContaining({ number: episodeKey(2, 5), season: 2, relativeNumber: 5 }));
    const episode = await client.getEpisode("series-los-tipos-malos", episodeKey(2, 5), context);
    expect(episode?.embeds).toEqual([expect.objectContaining({ server: "Vidara", language: "Subtitulado", url: "https://vidara.to/e/abc123" })]);
  });

  it("CineCalidad selects an exact series episode and rejects YouTube trailers", async () => {
    const request: FetchText = vi.fn(async (rawUrl) => {
      const url = new URL(String(rawUrl));
      if (url.pathname === "/" && url.searchParams.has("s")) return `
        <article class="item"><a href="https://www.cinecalidad.am/ver-serie/breaking-bad/">
          <div class="in_title">Breaking Bad</div><span>2008</span>
        </a></article>`;
      if (url.pathname === "/ver-serie/breaking-bad/") return `
        <meta property="og:title" content="Ver Serie Breaking Bad Online en Cinecalidad">
        <a href="https://www.cinecalidad.am/ver-el-episodio/breaking-bad-3x5/">3x05</a>`;
      if (url.pathname === "/ver-el-episodio/breaking-bad-3x5/") return `
        <div id="panel_online"><div class="pane_descripcion">Audio latino</div></div>
        <li class="dooplay_player_option" data-option="https://vimeos.net/embed-series.html">Vimeos Latino</li>
        <li class="dooplay_player_option" data-option="https://youtube.com/embed/trailer">Trailer</li>`;
      throw new Error(`Unexpected URL ${url}`);
    });
    const client = new CineCalidadClient(testConfig(), request);
    const context = { type: "series" as const, title: "Breaking Bad", aliases: [], year: 2008, season: 3, episode: 5 };
    expect(await client.search("Breaking Bad", context)).toEqual([
      expect.objectContaining({ slug: "series-breaking-bad", mediaType: "series", year: 2008 }),
    ]);
    const media = await client.getMedia("series-breaking-bad", context);
    expect(media).toMatchObject({ title: "Breaking Bad", startDate: "2008-01-01" });
    expect(media?.episodes).toEqual([{ number: episodeKey(3, 5), season: 3, relativeNumber: 5 }]);
    const episode = await client.getEpisode("series-breaking-bad", episodeKey(3, 5), context);
    expect(episode?.embeds).toHaveLength(1);
    expect(episode?.embeds[0]).toMatchObject({ url: "https://vimeos.net/embed-series.html", language: "Latino" });
  });
});
