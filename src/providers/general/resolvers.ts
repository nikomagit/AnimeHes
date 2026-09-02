import type { AppConfig } from "../../config.js";
import { fetchText, type FetchText } from "../../lib/http.js";
import type { ResolvedDirectStream } from "../resolvers.js";
import type { ProviderEmbed } from "../types.js";

function allowedHost(url: URL, domain: string): boolean {
  return url.hostname === domain || url.hostname.endsWith(`.${domain}`);
}

function cleanUrl(value: string): string {
  return value.replace(/\\u0026/gi, "&").replace(/\\\//g, "/").replace(/&amp;/gi, "&").trim();
}

function directHeaders(embedUrl: URL, userAgent: string): Record<string, string> {
  return { Accept: "*/*", Origin: embedUrl.origin, Referer: embedUrl.toString(), "User-Agent": userAgent };
}

const CUEVANA_FALLBACK_HOSTS = ["vsembed.ru", "vidlink.pro", "vidapi.xyz"];
const KNOWN_MEDIA_HOSTS = ["peakstorm.top", "vimeos.zip", "vimeos.net", "s1q2105.com"];

export class GeneralStreamResolver {
  constructor(private readonly config: AppConfig, private readonly request: FetchText = fetchText) {}

  supports(embed: ProviderEmbed): boolean {
    const server = embed.server.toLocaleLowerCase("en");
    const host = this.host(embed.url);
    return server === "trinity" || server === "vimeos" || server === "vidara"
      || host.endsWith("videasy.net") || host.endsWith("videasy.to")
      || host.endsWith("vimeos.net") || host.endsWith("vidara.to") || host.endsWith("vidara.so")
      || CUEVANA_FALLBACK_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  }

  async resolve(embed: ProviderEmbed, episodePageUrl: string): Promise<ResolvedDirectStream[]> {
    const server = embed.server.toLocaleLowerCase("en");
    const host = this.host(embed.url);
    if (server === "trinity" || host.endsWith("videasy.net") || host.endsWith("videasy.to")) return this.resolveVideasy(embed);
    if (server === "vimeos" || host.endsWith("vimeos.net")) {
      const stream = await this.resolveVimeos(embed, episodePageUrl);
      return stream ? [stream] : [];
    }
    if (server === "vidara" || host.endsWith("vidara.to") || host.endsWith("vidara.so")) {
      const stream = await this.resolveVidara(embed);
      return stream ? [stream] : [];
    }
    if (CUEVANA_FALLBACK_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
      return this.resolveStaticFallback(embed, episodePageUrl);
    }
    return [];
  }

  private host(value: string): string {
    try { return new URL(value).hostname.toLocaleLowerCase("en"); } catch { return ""; }
  }

  private details(embed: ProviderEmbed) {
    return {
      ...(embed.quality ? { quality: embed.quality } : {}),
      ...(embed.subtitles?.length
        ? { subtitles: embed.subtitles.map((subtitle, index) => ({ id: subtitle.id ?? `subtitle-${index + 1}`, url: subtitle.url, language: subtitle.language })) }
        : {}),
    };
  }

  private async resolveVimeos(embed: ProviderEmbed, episodePageUrl: string): Promise<ResolvedDirectStream | null> {
    const source = new URL(embed.url);
    if (!allowedHost(source, "vimeos.net") || !/^\/embed-[a-z\d]+\.html$/i.test(source.pathname)) return null;
    const body = await this.request(source, this.pageOptions("Vimeos", episodePageUrl));
    const unpacked = this.unpackPacker(body);
    const rawUrl = unpacked?.match(/(?:file|src)\s*:\s*["'](https?:\\?\/\\?\/[^"']+?\.m3u8(?:\?[^"']*)?)["']/i)?.[1];
    const url = rawUrl ? this.validMediaUrl(rawUrl, ["vimeos.zip", "vimeos.net"]) : null;
    if (!url) return null;
    return {
      server: embed.server, language: embed.language, url, type: "hls", label: "HLS",
      headers: directHeaders(source, this.config.playbackUserAgent), ...this.details(embed),
    };
  }

  private async resolveStaticFallback(embed: ProviderEmbed, episodePageUrl: string): Promise<ResolvedDirectStream[]> {
    const source = new URL(embed.url);
    const body = cleanUrl(await this.request(source, this.pageOptions(`${embed.server} fallback`, episodePageUrl)));
    const candidates = [...body.matchAll(/https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/gi)];
    const streams = new Map<string, ResolvedDirectStream>();
    for (const match of candidates) {
      const url = this.validMediaUrl(match[0], KNOWN_MEDIA_HOSTS);
      if (!url || streams.has(url)) continue;
      const type = /\.m3u8(?:\?|$)/i.test(url) ? "hls" : "mp4";
      streams.set(url, {
        server: embed.server,
        language: embed.language,
        url,
        type,
        label: type === "hls" ? "HLS" : "MP4",
        headers: directHeaders(source, this.config.playbackUserAgent),
        ...this.details(embed),
      });
    }
    return [...streams.values()];
  }

  private unpackPacker(body: string): string | null {
    const match = body.match(/eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)(?:,0,\{\})?\)\)/i);
    if (!match?.[1] || !match[2] || !match[4]) return null;
    const radix = Number(match[2]);
    if (!Number.isSafeInteger(radix) || radix < 2 || radix > 36) return null;
    const payload = match[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    const symbols = match[4].replace(/\\'/g, "'").replace(/\\\\/g, "\\").split("|");
    return payload.replace(/\b[0-9a-z]+\b/gi, (token) => {
      const index = Number.parseInt(token, radix);
      if (!Number.isSafeInteger(index) || index < 0 || index >= symbols.length || index.toString(radix) !== token.toLocaleLowerCase("en")) return token;
      return symbols[index] || token;
    });
  }

  private async resolveVidara(embed: ProviderEmbed): Promise<ResolvedDirectStream | null> {
    const source = new URL(embed.url);
    if ((!allowedHost(source, "vidara.to") && !allowedHost(source, "vidara.so")) || !/^\/e\/[a-z\d]+\/?$/i.test(source.pathname)) return null;
    const filecode = source.pathname.match(/^\/e\/([a-z\d]+)/i)?.[1];
    if (!filecode) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const response = await fetch(new URL("/api/stream", source.origin), {
        method: "POST", redirect: "follow", signal: controller.signal,
        headers: { "content-type": "application/json", origin: source.origin, referer: source.toString(), "user-agent": this.config.playbackUserAgent },
        body: JSON.stringify({ filecode, device: "web" }),
      });
      if (!response.ok) return null;
      const body = await response.text();
      if (Buffer.byteLength(body, "utf8") > this.config.maxResponseBytes) return null;
      const payload = JSON.parse(body) as Record<string, unknown>;
      const url = typeof payload.streaming_url === "string"
        ? this.validMediaUrl(payload.streaming_url, ["s1q2105.com", "vidara.to", "vidara.so"])
        : null;
      if (!url) return null;
      const subtitles = Array.isArray(payload.subtitles) ? payload.subtitles.flatMap((value, index) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const item = value as Record<string, unknown>;
        const subtitleUrl = typeof item.file_path === "string" ? this.validSubtitleUrl(item.file_path) : null;
        if (!subtitleUrl || (item.type !== undefined && Number(item.type) !== 0)) return [];
        return [{ id: `vidara-${index + 1}`, url: subtitleUrl, language: typeof item.language === "string" ? item.language : "Unknown" }];
      }) : [];
      return {
        server: embed.server, language: embed.language, url,
        type: url.toLocaleLowerCase("en").includes(".m3u8") ? "hls" : "mp4",
        label: url.toLocaleLowerCase("en").includes(".m3u8") ? "HLS" : "MP4",
        headers: directHeaders(source, this.config.playbackUserAgent), ...this.details(embed),
        ...(subtitles.length ? { subtitles } : {}),
      };
    } catch { return null; } finally { clearTimeout(timer); }
  }

  private async resolveVideasy(embed: ProviderEmbed): Promise<ResolvedDirectStream[]> {
    const source = new URL(embed.url);
    if (!allowedHost(source, "videasy.net") && !allowedHost(source, "videasy.to")) return [];
    const movie = source.pathname.match(/^\/movie\/(\d+)\/?$/i);
    const television = source.pathname.match(/^\/tv\/(\d+)\/(\d+)\/(\d+)\/?$/i);
    if (!movie && !television) return [];
    const mediaId = Number(movie?.[1] ?? television?.[1]);
    if (!Number.isSafeInteger(mediaId) || mediaId < 1) return [];
    const apiBase = "https://api.speedracelight.com";
    const seedUrl = new URL("/seed", apiBase);
    seedUrl.searchParams.set("mediaId", String(mediaId));
    const seedPayload = JSON.parse(await this.request(seedUrl, this.apiOptions("Trinity seed"))) as Record<string, unknown>;
    const seed = typeof seedPayload.seed === "string" ? seedPayload.seed : "";
    if (!seed) return [];
    const apiUrl = new URL("/cdn/sources-with-title", apiBase);
    apiUrl.searchParams.set("mediaType", movie ? "movie" : "tv");
    apiUrl.searchParams.set("tmdbId", String(mediaId));
    if (television?.[2] && television[3]) {
      apiUrl.searchParams.set("seasonId", television[2]);
      apiUrl.searchParams.set("episodeId", television[3]);
    }
    apiUrl.searchParams.set("enc", "2");
    apiUrl.searchParams.set("seed", seed);
    const payload = JSON.parse(this.decryptVideasy(await this.request(apiUrl, this.apiOptions("Trinity sources")), seed, mediaId)) as Record<string, unknown>;
    const subtitles = Array.isArray(payload.subtitles) ? payload.subtitles.flatMap((value, index) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const item = value as Record<string, unknown>;
      const rawUrl = typeof item.url === "string" ? item.url : typeof item.file === "string" ? item.file : "";
      const url = this.validSubtitleUrl(rawUrl);
      if (!url) return [];
      const language = typeof item.lang === "string" ? item.lang : typeof item.label === "string" ? item.label : "Unknown";
      return [{ id: `trinity-${index + 1}`, url, language }];
    }) : [];
    if (!Array.isArray(payload.sources)) return [];
    const candidates = payload.sources.flatMap((value): ResolvedDirectStream[] => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const item = value as Record<string, unknown>;
      const url = typeof item.url === "string" ? this.validMediaUrl(item.url, ["peakstorm.top"]) : null;
      if (!url) return [];
      const quality = typeof item.quality === "string" && item.quality.trim() ? item.quality.trim() : undefined;
      return [{
        server: embed.server, language: embed.language, url,
        type: url.toLocaleLowerCase("en").includes(".m3u8") ? "hls" : "mp4",
        label: url.toLocaleLowerCase("en").includes(".m3u8") ? "HLS" : "MP4",
        // This CDN rejects requests that include Origin or Referer. Preserve only
        // the browser User-Agent that was verified against the public playlist.
        headers: { "User-Agent": this.config.playbackUserAgent },
        ...(quality ? { quality } : {}), ...(subtitles.length ? { subtitles } : {}),
      }];
    });
    const validated = await Promise.allSettled(candidates.map(async (stream) => {
      if (stream.type !== "hls") return stream;
      const playlist = await this.request(stream.url, {
        timeoutMs: this.config.requestTimeoutMs,
        maxBytes: Math.min(this.config.maxResponseBytes, 1024 * 1024),
        upstream: "Trinity playlist",
        headers: { accept: "application/vnd.apple.mpegurl,*/*", ...stream.headers },
      });
      return playlist.trimStart().startsWith("#EXTM3U") ? stream : null;
    }));
    return validated.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
  }

  private apiOptions(upstream: string) {
    return { timeoutMs: this.config.requestTimeoutMs, maxBytes: this.config.maxResponseBytes, upstream, headers: { accept: "application/json,text/plain,*/*", "user-agent": this.config.userAgent } };
  }

  private pageOptions(upstream: string, referer: string) {
    return { timeoutMs: this.config.requestTimeoutMs, maxBytes: this.config.maxResponseBytes, upstream, headers: { accept: "text/html,application/xhtml+xml", referer, "user-agent": this.config.playbackUserAgent } };
  }

  private validMediaUrl(value: string, domains?: string[]): string | null {
    try {
      const url = new URL(cleanUrl(value));
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      if (domains && !domains.some((domain) => allowedHost(url, domain))) return null;
      return /\.(?:m3u8|mp4)$/i.test(url.pathname) ? url.toString() : null;
    } catch { return null; }
  }

  private validSubtitleUrl(value: string): string | null {
    try {
      const url = new URL(cleanUrl(value));
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      return /\.(?:vtt|srt|ass|ssa)$/i.test(url.pathname) ? url.toString() : null;
    } catch { return null; }
  }

  private decryptVideasy(payload: string, seed: string, mediaId: number): string {
    const bytes = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const stream = this.videasyKeystream(seed, mediaId, bytes.length);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = (bytes[index] ?? 0) ^ (stream[index] ?? 0);
    if (bytes[0] !== 109 || bytes[1] !== 118 || bytes[2] !== 109 || bytes[3] !== 49) throw new Error("Invalid Trinity payload");
    return bytes.subarray(4).toString("utf8");
  }

  private videasyKeystream(seed: string, mediaId: number, length: number): Uint8Array {
    const constants = [1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614881032,3248222580];
    let state: { values: number[]; accumulator: number };
    if (((seed.length * (seed.length + 1)) & 1) === 1) {
      const values = Array.from({ length: 256 }, (_value, index) => index);
      let cursor = 0;
      for (let index = 0; index < 256; index += 1) {
        cursor = (cursor + (values[index] ?? 0) + seed.charCodeAt(index % seed.length)) & 255;
        [values[index], values[cursor]] = [values[cursor] ?? 0, values[index] ?? 0];
      }
      let accumulator = 1732584193;
      for (let index = 0; index < seed.length; index += 1) accumulator = this.rotate((accumulator ^ Math.imul(seed.charCodeAt(index), constants[15 & index] ?? 0)) >>> 0, 5);
      state = { values, accumulator: this.mix(accumulator) };
    } else {
      const values: number[] = Array(61);
      let hash = 2166136261;
      for (let index = 0; index < seed.length; index += 1) hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619) >>> 0;
      let accumulator = this.mix(this.mix(hash) ^ this.mix((mediaId >>> 0) ^ 2654435769)) >>> 0;
      for (let index = 0; index < 8; index += 1) {
        if (((index * (index + 1)) & 1) === 0) {
          const position = accumulator % 61;
          accumulator = this.rotate((accumulator + 2654435769) >>> 0, 7 + (7 & index));
          values[position] = (accumulator ^ this.mix(accumulator)) >>> 0;
          accumulator = this.mix((accumulator + position) >>> 0);
        } else values[index] = constants[15 & index] ?? 0;
      }
      state = { values, accumulator: this.mix(2779096485 ^ accumulator) >>> 0 };
    }
    const output = new Uint8Array(length);
    let offset = 0;
    let counter = 0;
    while (offset < length) {
      const position = state.accumulator % 61;
      const mask = 0 - Number(position in state.values);
      const selected = (state.values[position] ?? 0) >>> 0;
      const keyed = (selected ^ Math.imul(2654435769, counter + 1)) >>> 0;
      let value = ((state.accumulator ^ keyed) >>> 0 | ((state.accumulator & keyed & mask) >>> 0)) >>> 0;
      value = (this.rotate((value + state.accumulator) >>> 0, 31 & position) ^ this.rotate(state.accumulator, 31 & Math.imul(position, 7))) >>> 0;
      state.accumulator = this.mix((value + 2654435769) >>> 0);
      state.values[position] = state.accumulator;
      counter += 1;
      output[offset++] = state.accumulator & 255;
      if (offset < length) output[offset++] = (state.accumulator >>> 8) & 255;
      if (offset < length) output[offset++] = (state.accumulator >>> 16) & 255;
      if (offset < length) output[offset++] = (state.accumulator >>> 24) & 255;
    }
    return output;
  }

  private mix(value: number): number {
    value >>>= 0; value ^= value >>> 16; value = Math.imul(value, 2246822507) >>> 0; value ^= value >>> 13; value = Math.imul(value, 3266489909) >>> 0; return (value ^ (value >>> 16)) >>> 0;
  }

  private rotate(value: number, amount: number): number {
    value >>>= 0; amount &= 31; return amount === 0 ? value : (value << amount | value >>> (32 - amount)) >>> 0;
  }
}
