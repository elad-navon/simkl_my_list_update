/**
 * Network name/logo resolution. Ported from app.js:596-657.
 *
 * The local-override table exists because TMDB has no logo for several
 * Israeli broadcasters and SIMKL had none either. With SIMKL gone, TMDB is
 * the only remote source, so the overrides carry more weight than before.
 * The base64 blobs the old app inlined (app.js:20-26) become real files
 * under `public/networks/` - see `LOCAL_NETWORK_LOGOS`.
 */

export type TmdbNetwork = { name?: string | null; logo_path?: string | null };

export type LocalNetworkLogo = {
  /** Every name variant this network appears under, across languages/sources. */
  names: string[];
  /** URL relative to the app base. */
  logo: string;
};

export const LOCAL_NETWORK_LOGOS: readonly LocalNetworkLogo[] = [
  { names: ["רשת", "Reshet"], logo: "networks/reshet.png" },
  { names: ["כאן", "כאן 11", "Kan", "Kan 11"], logo: "networks/kan.png" },
  { names: ["HOT", "הוט"], logo: "networks/hot.png" },
  { names: ["קשת", "קשת 12", "Keshet", "Keshet 12"], logo: "networks/keshet.png" },
];

/**
 * TMDB lists every network a show ever aired on, oldest first - an Israeli
 * show that moved Channel 2 -> Reshet 13 -> Channel 12 lists all three. The
 * last entry is the current one.
 */
export function latestNetwork(networks: readonly TmdbNetwork[] | null | undefined): TmdbNetwork | null {
  if (!networks || !networks.length) return null;
  return networks[networks.length - 1] ?? null;
}

/**
 * Strips a trailing channel number and lowercases, so "Reshet" and
 * "Reshet 13" - or "Keshet" and "Keshet 12" - collapse to one key.
 */
export function normalizeNetworkName(name: string | null | undefined): string {
  return (name ?? "").trim().replace(/\s+\d+$/, "").trim().toLowerCase();
}

export function findLocalNetworkLogo(networkName: string | null | undefined): string | null {
  const key = normalizeNetworkName(networkName);
  if (!key) return null;
  const entry = LOCAL_NETWORK_LOGOS.find((e) =>
    e.names.some((n) => normalizeNetworkName(n) === key),
  );
  return entry ? entry.logo : null;
}

export function resolveNetworkLogoUrl(
  networkName: string | null | undefined,
  tmdbLogoPath: string | null | undefined,
  tmdbLogoBase: string,
): string | null {
  if (tmdbLogoPath) return tmdbLogoBase + tmdbLogoPath;
  return findLocalNetworkLogo(networkName);
}
