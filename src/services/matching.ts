import type { MediaMetadata } from "../types.js";
import type { HentailaMedia, HentailaSearchResult } from "../providers/hentaila/types.js";

const GENERIC_SUFFIX = /\b(?:the\s+animation|animation|animated|ova)\b/gu;

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
  return [...new Set([normalized, withoutSuffix].filter(Boolean))];
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

export function candidateAliases(media: HentailaMedia): string[] {
  return [...new Set([media.title, ...Object.values(media.aka)].map((item) => item.trim()).filter(Boolean))];
}

function bestAliasScore(wanted: string[], available: string[]): number {
  let best = 0;
  for (const left of wanted) for (const right of available) best = Math.max(best, titleSimilarity(left, right));
  return best;
}

function yearFrom(date: string | undefined): number | undefined {
  const match = date?.match(/^\d{4}/);
  return match ? Number(match[0]) : undefined;
}

export function preliminaryScore(metadata: MediaMetadata, result: HentailaSearchResult): number {
  return bestAliasScore(mediaAliases(metadata), [result.title]);
}

export function detailedScore(metadata: MediaMetadata, media: HentailaMedia): number {
  let score = bestAliasScore(mediaAliases(metadata), candidateAliases(media));
  const candidateYear = yearFrom(media.startDate);
  if (metadata.year !== undefined && candidateYear !== undefined) {
    const difference = Math.abs(metadata.year - candidateYear);
    if (difference === 0) score += 0.02;
    else if (difference > 1) score -= Math.min(0.12, difference * 0.02);
  }
  return Math.max(0, Math.min(1, score));
}

export function buildSearchQueries(metadata: MediaMetadata, maximum: number): string[] {
  const base = mediaAliases(metadata);
  const season = metadata.season;
  const candidates = season && season > 1
    ? base.flatMap((title) => [`${title} Season ${season}`, `${title} ${season}`, title])
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
