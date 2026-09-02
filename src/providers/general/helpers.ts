import type { MediaType } from "../../types.js";

export function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f\d]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

export function plainText(value: string): string {
  return decodeHtml(value.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function yearFrom(value: unknown): number | undefined {
  const match = String(value ?? "").match(/\b(19\d{2}|20\d{2}|21\d{2})\b/);
  return match?.[1] ? Number(match[1]) : undefined;
}

export function mediaKey(type: MediaType, slug: string): string {
  return `${type === "movie" ? "movie" : "series"}-${slug.replace(/^\/+|\/+$/g, "")}`;
}

export function parseMediaKey(value: string): { type: MediaType; slug: string } | null {
  if (value.startsWith("movie-") && value.length > 6) return { type: "movie", slug: value.slice(6) };
  if (value.startsWith("series-") && value.length > 7) return { type: "series", slug: value.slice(7) };
  return null;
}

export function episodeKey(season: number, episode: number): number {
  return season * 10_000 + episode;
}

export function parseEpisodeKey(value: number): { season: number; episode: number } | null {
  const season = Math.floor(value / 10_000);
  const episode = value % 10_000;
  return Number.isSafeInteger(season) && season >= 1 && Number.isSafeInteger(episode) && episode >= 1
    ? { season, episode }
    : null;
}

export function safeUrl(value: string, baseUrl: string): string | null {
  try {
    const url = new URL(decodeHtml(value), `${baseUrl}/`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function integer(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function tmdbIdFromUrl(value: string): number | undefined {
  try {
    const url = new URL(decodeHtml(value));
    const queryId = url.searchParams.get("tmdb") ?? url.searchParams.get("tmdbId");
    const pathId = url.pathname.match(/\/(?:e\/)?(?:movie|tv)\/(\d+)(?:\/|$)/iu)?.[1];
    const id = integer(queryId ?? pathId);
    return id !== undefined && id > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

export function absoluteAsset(baseUrl: string, value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  return safeUrl(raw, baseUrl) ?? undefined;
}

export function emptyCatalog() {
  return { results: [], currentPage: 1, recordsPerPage: 0, totalPages: 0, totalRecords: 0, orderKey: "", status: null, uncensored: null };
}
