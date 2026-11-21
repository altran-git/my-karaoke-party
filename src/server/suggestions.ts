import "server-only";

import type { db as Db } from "~/server/db";

/** One suggested song. */
export type SuggestedSong = {
  /** YouTube video id. */
  id: string;
  title: string;
  coverUrl: string;
  duration: string | null;
  /**
   * "related": it shares a saved playlist with a song sung recently.
   * "popular": it's in many saved playlists (used when there's too little
   * to go on, for example at the start of a party).
   */
  reason: "related" | "popular";
  /** For "related": the recently sung song that led to it most. */
  becauseOf?: string;
};

/**
 * How many suggestions to return. Far more than the screens show, so the
 * browser can drop songs already played or queued, and pick a different
 * mix each time someone presses Suggest.
 */
const CANDIDATES = 120;

/** Playlists looked at per request, newest first. Keeps big libraries fast. */
const MAX_RELATED_PLAYLISTS = 50;

/** Most-shared songs looked at to fill up the list. */
const MAX_POPULAR = 150;

type SongRow = {
  videoId: string;
  title: string;
  coverUrl: string;
  duration: string | null;
};

/**
 * Picks songs to sing next from the saved playlists.
 *
 * Every saved playlist that contains a recently sung song "votes" for its
 * other songs. The newest song's playlists count most (1, then 1/2, 1/3...
 * for older songs), and songs right next to it in a playlist get a bonus,
 * since playlists are often in a deliberate order. Songs in many playlists
 * fill up the list after that.
 *
 * `recentIds` are the songs sung at this party, newest first.
 */
export async function suggestSongs(
  db: typeof Db,
  recentIds: string[],
): Promise<SuggestedSong[]> {
  const seeds = [...new Set(recentIds)];
  const seedWeight = new Map(seeds.map((id, i) => [id, 1 / (i + 1)]));

  const scores = new Map<
    string,
    { song: SongRow; score: number; because: Map<string, number> }
  >();

  const vote = (song: SongRow, score: number, because?: string) => {
    let entry = scores.get(song.videoId);
    if (!entry) {
      entry = { song, score: 0, because: new Map() };
      scores.set(song.videoId, entry);
    }
    entry.score += score;
    if (because) {
      entry.because.set(because, (entry.because.get(because) ?? 0) + score);
    }
  };

  if (seeds.length > 0) {
    // Where the recent songs appear in saved playlists.
    const seedRows = await db.playlistSong.findMany({
      where: { videoId: { in: seeds } },
      select: { playlistId: true, position: true, videoId: true },
      orderBy: { playlist: { updatedAt: "desc" } },
      take: MAX_RELATED_PLAYLISTS * 4,
    });

    const seedsByPlaylist = new Map<
      number,
      { position: number; videoId: string }[]
    >();
    for (const row of seedRows) {
      const list = seedsByPlaylist.get(row.playlistId) ?? [];
      if (list.length === 0 && seedsByPlaylist.size >= MAX_RELATED_PLAYLISTS) {
        continue;
      }
      list.push(row);
      seedsByPlaylist.set(row.playlistId, list);
    }

    if (seedsByPlaylist.size > 0) {
      const songs = await db.playlistSong.findMany({
        where: { playlistId: { in: [...seedsByPlaylist.keys()] } },
        select: {
          playlistId: true,
          position: true,
          videoId: true,
          title: true,
          coverUrl: true,
          duration: true,
        },
      });

      for (const song of songs) {
        if (seedWeight.has(song.videoId)) continue;

        for (const seed of seedsByPlaylist.get(song.playlistId) ?? []) {
          const weight = seedWeight.get(seed.videoId) ?? 0;
          const distance = Math.abs(song.position - seed.position);
          // Right after or before the seed song: up to 2x the vote.
          const nearby = distance <= 3 ? (4 - distance) / 3 : 0;
          vote(song, weight * (1 + nearby), seed.videoId);
        }
      }
    }
  }

  const related = [...scores.values()].sort((a, b) => b.score - a.score);

  const result: SuggestedSong[] = related
    .slice(0, CANDIDATES)
    .map(({ song, because }) => ({
      id: song.videoId,
      title: song.title,
      coverUrl: song.coverUrl,
      duration: song.duration,
      reason: "related" as const,
      becauseOf: [...because.entries()].sort((a, b) => b[1] - a[1])[0]?.[0],
    }));

  if (result.length < CANDIDATES) {
    const taken = new Set([...result.map((s) => s.id), ...seeds]);

    const popular = await db.playlistSong.groupBy({
      by: ["videoId"],
      _count: { videoId: true },
      orderBy: { _count: { videoId: "desc" } },
      take: MAX_POPULAR,
    });

    const popularIds = popular
      .map((p) => p.videoId)
      .filter((id) => !taken.has(id));

    if (popularIds.length > 0) {
      const details = await db.playlistSong.findMany({
        where: { videoId: { in: popularIds } },
        distinct: ["videoId"],
        select: { videoId: true, title: true, coverUrl: true, duration: true },
      });
      const byId = new Map(details.map((d) => [d.videoId, d]));

      for (const id of popularIds) {
        const song = byId.get(id);
        if (!song) continue;
        result.push({
          id,
          title: song.title,
          coverUrl: song.coverUrl,
          duration: song.duration,
          reason: "popular",
        });
        if (result.length >= CANDIDATES) break;
      }
    }
  }

  return result;
}
