import {
  MAX_PLAYLIST_SONGS,
  PlaylistSongInput,
  type PlaylistSongInput as Song,
} from "party/types";
import { z } from "zod";

/** Marks a JSON file as a playlist exported from this app. */
const FORMAT = "my-karaoke-party-playlist";
const VERSION = 1;

/** Largest file accepted, far above what 200 songs take. */
export const MAX_PLAYLIST_FILE_BYTES = 1024 * 1024;

const PlaylistFile = z.object({
  format: z.literal(FORMAT),
  version: z.number().int(),
  name: z.string().max(100).optional(),
  songs: z.array(PlaylistSongInput),
});

/** The JSON text of a playlist file: its name and songs, no stats. */
export function toPlaylistFile(name: string, songs: Song[]) {
  return JSON.stringify(
    {
      format: FORMAT,
      version: VERSION,
      name,
      songs: songs.map(({ id, title, coverUrl, duration }) => ({
        id,
        title,
        coverUrl,
        ...(duration ? { duration } : {}),
      })),
    },
    null,
    2,
  );
}

/** A file name like "friday-hits.json". */
export function playlistFileName(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "playlist"}.json`;
}

/**
 * Reads a playlist file. Returns its name and songs, or an error message
 * fit to show the person.
 */
export function parsePlaylistFile(
  text: string,
): { name?: string; songs: Song[] } | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { error: "That file isn't valid JSON." };
  }

  const parsed = PlaylistFile.safeParse(json);
  if (!parsed.success) {
    return {
      error:
        "That file isn't a playlist exported from My Karaoke Party, or it was changed.",
    };
  }
  if (parsed.data.version > VERSION) {
    return {
      error: "That file is from a newer version of the app. Please reload.",
    };
  }
  if (parsed.data.songs.length === 0) {
    return { error: "That playlist file has no songs." };
  }
  if (parsed.data.songs.length > MAX_PLAYLIST_SONGS) {
    return {
      error: `That file has ${parsed.data.songs.length} songs; at most ${MAX_PLAYLIST_SONGS} can be loaded.`,
    };
  }

  return { name: parsed.data.name, songs: parsed.data.songs };
}
