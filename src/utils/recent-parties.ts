/**
 * Parties this browser has hosted, kept in localStorage so the host can get
 * back to the player screen after leaving it.
 */

export type RecentParty = {
  hash: string;
  name: string;
  lastOpenedAt: number;
  /** Secret that lets this browser delete the party. Only the creator has it. */
  hostKey?: string;
};

const STORAGE_KEY = "recent-parties";
const MAX_RECENT_PARTIES = 20;

export function getRecentParties(): RecentParty[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (p): p is RecentParty =>
          typeof p === "object" &&
          p !== null &&
          typeof (p as RecentParty).hash === "string" &&
          typeof (p as RecentParty).name === "string" &&
          typeof (p as RecentParty).lastOpenedAt === "number",
      )
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  } catch {
    return [];
  }
}

function saveRecentParties(parties: RecentParty[]) {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(parties.slice(0, MAX_RECENT_PARTIES)),
    );
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
  }
}

export function rememberParty(party: {
  hash: string;
  name: string;
  hostKey?: string;
}) {
  const all = getRecentParties();
  const existing = all.find((p) => p.hash === party.hash);
  const others = all.filter((p) => p.hash !== party.hash);
  saveRecentParties([
    {
      hash: party.hash,
      name: party.name,
      lastOpenedAt: Date.now(),
      // Reopening the player screen must not drop a key saved at creation.
      hostKey: party.hostKey ?? existing?.hostKey,
    },
    ...others,
  ]);
}

export function forgetParty(hash: string) {
  saveRecentParties(getRecentParties().filter((p) => p.hash !== hash));
}

/** The host key for a party this browser created, if it has one. */
export function getHostKey(hash: string) {
  return getRecentParties().find((p) => p.hash === hash)?.hostKey;
}
