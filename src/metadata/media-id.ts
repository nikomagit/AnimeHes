import { InvalidMediaRequestError } from "../errors.js";
import type { MediaProvider, MediaType, ParsedMediaId } from "../types.js";

const IMDB_ID = /^tt\d{7,10}$/;
const POSITIVE_INTEGER = /^\d+$/;

function positiveInteger(
  value: string | undefined,
  maximum = 2_147_483_647,
): number | undefined {
  if (value === undefined || !POSITIVE_INTEGER.test(value)) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) return undefined;
  return parsed;
}

export function parseMediaType(value: string): MediaType {
  if (value === "movie" || value === "series") return value;
  throw new InvalidMediaRequestError("Only movie and series streams are supported");
}

function parsePrefixedId(
  type: MediaType,
  rawId: string,
  provider: Exclude<MediaProvider, "imdb">,
): ParsedMediaId {
  const parts = rawId.split(":");
  const baseIdNumber = positiveInteger(parts[1]);
  if (baseIdNumber === undefined) {
    throw new InvalidMediaRequestError(`Malformed ${provider.toUpperCase()} ID`);
  }
  const baseId = String(baseIdNumber);
  if (type === "movie") {
    if (provider === "tvdb") {
      throw new InvalidMediaRequestError("TVDB anime mapping supports series IDs only");
    }
    if (parts.length !== 2) {
      throw new InvalidMediaRequestError("Movie IDs cannot contain episode segments");
    }
    return { provider, baseId };
  }
  if (parts.length === 2) return { provider, baseId };
  if (parts.length === 3 && ["kitsu", "anilist", "mal", "anidb"].includes(provider)) {
    const episode = positiveInteger(parts[2], 100_000);
    if (episode === undefined) throw new InvalidMediaRequestError("Invalid episode number");
    return { provider, baseId, season: 1, episode };
  }
  if (parts.length !== 4) {
    throw new InvalidMediaRequestError(`Series ${provider.toUpperCase()} IDs must include a valid episode`);
  }
  const season = positiveInteger(parts[2], 10_000);
  const episode = positiveInteger(parts[3], 100_000);
  if (season === undefined || episode === undefined) {
    throw new InvalidMediaRequestError("Invalid season or episode number");
  }
  return { provider, baseId, season, episode };
}

export function parseMediaId(type: MediaType, rawId: string): ParsedMediaId {
  if (!rawId || rawId.length > 256) throw new InvalidMediaRequestError();

  const prefix = rawId.split(":", 1)[0];
  if (prefix === "tmdb" || prefix === "tvdb" || prefix === "kitsu" || prefix === "anilist" || prefix === "mal" || prefix === "anidb") {
    return parsePrefixedId(type, rawId, prefix);
  }

  const parts = rawId.split(":");
  const baseId = parts[0];
  if (!baseId || !IMDB_ID.test(baseId)) {
    throw new InvalidMediaRequestError("Malformed IMDb ID");
  }
  if (type === "movie") {
    if (parts.length !== 1) {
      throw new InvalidMediaRequestError("Movie IDs cannot contain episode segments");
    }
    return { provider: "imdb", baseId };
  }
  if (parts.length === 1) return { provider: "imdb", baseId };
  if (parts.length !== 3) {
    throw new InvalidMediaRequestError("Series IDs must use tt…:season:episode");
  }
  const season = positiveInteger(parts[1], 10_000);
  const episode = positiveInteger(parts[2], 100_000);
  if (season === undefined || episode === undefined) {
    throw new InvalidMediaRequestError("Invalid season or episode number");
  }
  return { provider: "imdb", baseId, season, episode };
}
