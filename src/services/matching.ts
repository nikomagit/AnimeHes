import type { MediaMetadata } from "../types.js";
import type { ProviderMedia, ProviderSearchResult } from "../providers/types.js";

const GENERIC_SUFFIX = /\b(?:the\s+animation|animation|animated|ova)\b/gu;
const FIRST_INSTALLMENT_SUFFIX = /\s+(?:part|parte|chapter|capitulo)\s+(?:one|uno|1)$/u;
const HUMAN_FIRST_INSTALLMENT_SUFFIX = /[\s:–—-]+(?:part|parte|chapter|cap[ií]tulo)\s+(?:one|uno|1)\s*$/iu;
const EXTRA_CATEGORY = /\b(?:movie|pelicula|film|ova|special|especial)\b/u;
const ORDINAL_SEASONS = new Map<string, number>([
  ["first", 1], ["second", 2], ["third", 3], ["fourth", 4], ["fifth", 5],
  ["sixth", 6], ["seventh", 7], ["eighth", 8], ["ninth", 9], ["tenth", 10],
]);

export function normalizeTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/&/g, " and ")
    .match(/[\p{L}\p{N}]+/gu)
    ?.join(" ")
    .replace(/\s+/g, " ")
    .trim() ?? "";
}

function variants(value: string): string[] {
  const normalized = normalizeTitle(value);
  if (!normalized) return [];
  const withoutSuffix = normalized.replace(GENERIC_SUFFIX, " ").replace(/\s+/g, " ").trim();
  const withoutFirstInstallment = withoutSuffix.replace(FIRST_INSTALLMENT_SUFFIX, "").trim();
  return [...new Set([normalized, withoutSuffix, withoutFirstInstallment].filter(Boolean))];
}

function tokenF1(left: string, right: string): number {
  const a = new Set(left.split(" ").filter(Boolean));
  const b = new Set(right.split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return (2 * intersection) / (a.size + b.size);
}

function bigrams(value: string): string[] {
  const compact = value.replace(/\s+/g, " ");
  if (compact.length < 2) return compact ? [compact] : [];
  const result: string[] = [];
  for (let index = 0; index < compact.length - 1; index += 1) {
    result.push(compact.slice(index, index + 2));
  }
  return result;
}

function dice(left: string, right: string): number {
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.length || !b.length) return 0;
  const counts = new Map<string, number>();
  for (const part of a) counts.set(part, (counts.get(part) ?? 0) + 1);
  let intersection = 0;
  for (const part of b) {
    const available = counts.get(part) ?? 0;
    if (available > 0) {
      intersection += 1;
      counts.set(part, available - 1);
    }
  }
  return (2 * intersection) / (a.length + b.length);
}

export function titleSimilarity(left: string, right: string): number {
  let best = 0;
  for (const a of variants(left)) {
    for (const b of variants(right)) {
      if (a === b) return a === normalizeTitle(left) && b === normalizeTitle(right) ? 1 : 0.98;
      const score = tokenF1(a, b) * 0.55 + dice(a, b) * 0.45;
      best = Math.max(best, score);
    }
  }
  return Math.min(1, best);
}

export function mediaAliases(metadata: MediaMetadata): string[] {
  return [...new Set([metadata.title, ...metadata.aliases].map((item) => item.trim()).filter(Boolean))];
}

export function candidateAliases(media: ProviderMedia): string[] {
  return [...new Set([media.title, ...Object.values(media.aka)].map((item) => item.trim()).filter(Boolean))];
}

function bestAliasScore(wanted: string[], available: string[]): number {
  let best = 0;
  for (const left of wanted) for (const right of available) best = Math.max(best, titleSimilarity(left, right));
  return best;
}

export function inferSeasonNumber(...values: Array<string | undefined>): number | undefined {
  for (const value of values) {
    if (!value) continue;
    const normalized = normalizeTitle(value);
    const numeric = normalized.match(/\b(?:season|temporada)\s+(\d{1,2})\b/u)?.[1]
      ?? normalized.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:season|temporada)\b/u)?.[1];
    if (numeric) {
      const parsed = Number(numeric);
      if (Number.isSafeInteger(parsed) && parsed >= 1) return parsed;
    }
    for (const [word, season] of ORDINAL_SEASONS) {
      if (new RegExp(`\\b${word}\\s+(?:season|temporada)\\b`, "u").test(normalized)) {
        return season;
      }
    }
  }
  return undefined;
}

function requestedSeason(metadata: MediaMetadata): number | undefined {
  // A Kitsu anime ID normally identifies one season as its own media entry.
  return metadata.provider === "kitsu" ? undefined : metadata.season;
}

function exactBaseTitle(metadata: MediaMetadata, media: ProviderMedia): boolean {
  const wanted = new Set(mediaAliases(metadata).map(normalizeTitle));
  return candidateAliases(media).some((alias) => wanted.has(normalizeTitle(alias)));
}

function structuredSeason(media: ProviderMedia, season: number): boolean {
  return media.episodes.some((episode) => episode.season === season && episode.relativeNumber !== undefined);
}

function isExtra(media: ProviderMedia): boolean {
  return EXTRA_CATEGORY.test(normalizeTitle(`${media.category?.name ?? ""} ${media.category?.slug ?? ""}`));
}

export function isSeasonCompatible(metadata: MediaMetadata, media: ProviderMedia): boolean {
  const season = requestedSeason(metadata);
  if (season === undefined) return true;
  if (structuredSeason(media, season)) return true;
  if (isExtra(media)) return false;

  const marker = inferSeasonNumber(media.title, ...Object.values(media.aka), media.slug);
  if (marker !== undefined) return marker === season;
  if (season <= 1) return exactBaseTitle(metadata, media);

  const candidateYear = yearFrom(media.startDate);
  if (metadata.seasonYear === undefined || candidateYear !== metadata.seasonYear) return false;
  if (exactBaseTitle(metadata, media)) return false;

  const episodeCountMatches = metadata.seasonEpisodeCount !== undefined
    && media.episodes.length === metadata.seasonEpisodeCount;
  const belongsToFranchise = bestAliasScore(mediaAliases(metadata), candidateAliases(media)) >= 0.4;
  return episodeCountMatches && belongsToFranchise;
}

function yearFrom(date: string | undefined): number | undefined {
  const match = date?.match(/^\d{4}/);
  return match ? Number(match[0]) : undefined;
}

export function preliminaryScore(metadata: MediaMetadata, result: ProviderSearchResult): number {
  let score = bestAliasScore(mediaAliases(metadata), [result.title]);
  const season = requestedSeason(metadata);
  if (season !== undefined && season > 1) {
    const marker = inferSeasonNumber(result.title, result.slug);
    if (marker === season) score += 0.35;
    else if (marker !== undefined) score -= 0.4;
    else score -= 0.08;
  }
  return Math.max(0, Math.min(1, score));
}

export function detailedScore(metadata: MediaMetadata, media: ProviderMedia): number {
  let score = bestAliasScore(mediaAliases(metadata), candidateAliases(media));
  const candidateYear = yearFrom(media.startDate);
  if (metadata.year !== undefined && candidateYear !== undefined) {
    const difference = Math.abs(metadata.year - candidateYear);
    if (difference === 0) score += 0.02;
    else if (difference > 1) score -= Math.min(0.12, difference * 0.02);
  }
  const season = requestedSeason(metadata);
  if (season !== undefined && season > 1) {
    if (structuredSeason(media, season)) {
      // Conventional series retain the base title and original premiere year;
      // their explicit S/E structure is stronger than separate-season heuristics.
      score += 0.08;
    } else {
      const marker = inferSeasonNumber(media.title, ...Object.values(media.aka), media.slug);
      if (marker === season) score += 0.35;
      if (metadata.seasonYear !== undefined && candidateYear !== undefined) {
        score += candidateYear === metadata.seasonYear ? 0.35 : -0.2;
      }
      if (metadata.seasonEpisodeCount !== undefined
        && media.episodes.length === metadata.seasonEpisodeCount) score += 0.12;
      if (exactBaseTitle(metadata, media)) score -= 0.3;
    }
  }
  return Math.max(0, Math.min(1, score));
}

function ordinal(value: number): string {
  const remainder100 = value % 100;
  const suffix = remainder100 >= 11 && remainder100 <= 13
    ? "th"
    : value % 10 === 1 ? "st" : value % 10 === 2 ? "nd" : value % 10 === 3 ? "rd" : "th";
  return `${value}${suffix}`;
}

export function buildSearchQueries(metadata: MediaMetadata, maximum: number): string[] {
  const base = mediaAliases(metadata).flatMap((title) => {
    const withoutFirstInstallment = title.replace(HUMAN_FIRST_INSTALLMENT_SUFFIX, "").trim();
    return withoutFirstInstallment && withoutFirstInstallment !== title
      ? [title, withoutFirstInstallment]
      : [title];
  });
  const season = requestedSeason(metadata);
  const candidates = season && season > 1
    ? base.flatMap((title) => [
        ...(metadata.seasonTitle ? [`${title} ${metadata.seasonTitle}`] : []),
        `${title} ${ordinal(season)} Season`,
        `${title} Season ${season}`,
        `${title} ${season}`,
        title,
      ])
    : base;
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const candidate of candidates) {
    const key = normalizeTitle(candidate);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    queries.push(candidate.trim());
    if (queries.length >= maximum) break;
  }
  return queries;
}
