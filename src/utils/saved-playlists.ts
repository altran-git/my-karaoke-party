/**
 * Playlists this browser knows about, kept in localStorage: the ones it
 * created or unlocked (with their recovery code) and ones opened from a
 * shared link (without one).
 */

export type SavedPlaylist = {
  hash: string;
  name: string;
  lastOpenedAt: number;
  /** Lets this browser edit or delete the playlist. Only owners have it. */
  recoveryCode?: string;
};

const STORAGE_KEY = "saved-playlists";
const MAX_SAVED_PLAYLISTS = 50;

export function getSavedPlaylists(): SavedPlaylist[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (p): p is SavedPlaylist =>
          typeof p === "object" &&
          p !== null &&
          typeof (p as SavedPlaylist).hash === "string" &&
          typeof (p as SavedPlaylist).name === "string" &&
          typeof (p as SavedPlaylist).lastOpenedAt === "number",
      )
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  } catch {
    return [];
  }
}

function save(playlists: SavedPlaylist[]) {
  // Never push out a playlist this browser owns to make room for one it
  // only viewed: losing it would mean needing the recovery code again.
  const owned = playlists.filter((p) => p.recoveryCode);
  const viewed = playlists.filter((p) => !p.recoveryCode);
  const kept = [
    ...owned,
    ...viewed.slice(0, Math.max(0, MAX_SAVED_PLAYLISTS - owned.length)),
  ].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
  }
}

export function rememberPlaylist(playlist: {
  hash: string;
  name: string;
  recoveryCode?: string;
}) {
  const all = getSavedPlaylists();
  const existing = all.find((p) => p.hash === playlist.hash);
  const others = all.filter((p) => p.hash !== playlist.hash);
  save([
    {
      hash: playlist.hash,
      name: playlist.name,
      lastOpenedAt: Date.now(),
      // Opening a shared link must not drop a code this browser already has.
      recoveryCode: playlist.recoveryCode ?? existing?.recoveryCode,
    },
    ...others,
  ]);
}

export function forgetPlaylist(hash: string) {
  save(getSavedPlaylists().filter((p) => p.hash !== hash));
}

/** What this browser knows about playlist `hash`, if anything. */
export function getSavedPlaylist(hash: string) {
  return getSavedPlaylists().find((p) => p.hash === hash);
}
