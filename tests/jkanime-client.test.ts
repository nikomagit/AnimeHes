import { describe, expect, it, vi } from "vitest";
import type { FetchText } from "../src/lib/http.js";
import { JkAnimeClient } from "../src/providers/jkanime/client.js";
import { testConfig } from "./helpers.js";

const searchFixture = `
  <div class="anime__item">
    <h5><a href="https://jkanime.net/haikyuu-third-season/">Haikyuu!! Third Season</a></h5>
  </div>
  <div class="anime__item">
    <h5><a href="https://jkanime.net/haikyuu-movie-3-sainou-to-sense/">Haikyuu!! Movie 3</a></h5>
  </div>`;

const mediaFixture = `
  <div class="anime_info">
    <h3>Haikyuu!! Third Season</h3>
    <span>Haikyu!! 3rd Season</span>
    <p class="scroll">La tercera temporada del equipo de Karasuno.</p>
    <div class="anisabi_player"></div>
  </div>
  <div class="movpic"><img src="https://cdn.jkdesa.com/assets/images/animes/image/haikyuu-third-season.jpg"></div>
  <li rel="tipo"><span>Tipo:</span> Serie</li>
  <li><span>Temporada:</span> Otoño 2016</li>
  <li><span>Episodios:</span> 10</li>
  <li><span>Duracion:</span> 24 min.</li>
  <a href="https://jkanime.net/genero/deportes/">Deportes</a>
  <a href="https://jkanime.net/genero/escuela/">Escuela</a>`;

const episodeFixture = `
  <iframe src="/jkplayer/um/?u=public-one"></iframe>
  <iframe src="https://jkanime.net/jkplayer/umv/?u=public-two"></iframe>
  <iframe src="https://jkanime.net/jkplayer/jk/?u=unsupported"></iframe>
  <iframe src="https://evil.example/jkplayer/um/?u=blocked"></iframe>`;

describe("JKAnime public client", () => {
  it("parses realistic search, media, episodes and supported public players", async () => {
    const request: FetchText = vi.fn(async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/buscar") return searchFixture;
      if (parsed.pathname === "/haikyuu-third-season/") return mediaFixture;
      if (parsed.pathname === "/haikyuu-third-season/1/") return episodeFixture;
      throw new Error(`unexpected request: ${parsed.toString()}`);
    });
    const client = new JkAnimeClient(testConfig(), request);

    await expect(client.search("Haikyu!! 3rd Season")).resolves.toEqual([
      expect.objectContaining({ title: "Haikyuu!! Third Season", slug: "haikyuu-third-season" }),
      expect.objectContaining({ slug: "haikyuu-movie-3-sainou-to-sense" }),
    ]);
    await expect(client.getMedia("haikyuu-third-season")).resolves.toMatchObject({
      title: "Haikyuu!! Third Season",
      aka: { "en-us": "Haikyu!! 3rd Season" },
      startDate: "2016-01-01",
      episodesCount: 10,
      runtime: 24,
      category: { name: "Serie", slug: "tv-anime" },
      genres: [{ name: "Deportes", slug: "deportes" }, { name: "Escuela", slug: "escuela" }],
    });
    const episode = await client.getEpisode("haikyuu-third-season", 1);
    expect(episode?.embeds).toEqual([
      expect.objectContaining({ server: "JKAnime UM", url: "https://jkanime.net/jkplayer/um/?u=public-one" }),
      expect.objectContaining({ server: "JKAnime UMV", url: "https://jkanime.net/jkplayer/umv/?u=public-two" }),
    ]);
  });

  it("rejects invalid slugs before making a request", async () => {
    const request: FetchText = vi.fn();
    const client = new JkAnimeClient(testConfig(), request);
    await expect(client.getMedia("../admin")).resolves.toBeNull();
    await expect(client.getEpisode("../admin", 1)).resolves.toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});
