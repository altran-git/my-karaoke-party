import {
  type KaraokeParty,
  MAX_PLAYLIST_SONGS,
  PlaylistSongInput,
} from "party/types";

/**
 * A party's songs split the way "Save as playlist" offers them: songs already
 * sung, in the order they were played, and the songs still in the queue, in
 * queue order (the one on screen first).
 */
export function splitPartySongs(party: KaraokeParty) {
  // Parties from before the history log only have the played songs that are
  // still in the queue.
  const played = party.history?.length
    ? party.history
    : party.playlist
        .filter((v) => v.playedAt)
        .sort(
          (a, b) =>
            new Date(a.playedAt!).getTime() - new Date(b.playedAt!).getTime(),
        );

  const queued = party.playlist.filter((v) => !v.playedAt);

  const toSongs = (videos: typeof played) =>
    videos.flatMap((video) => {
      const song = PlaylistSongInput.safeParse({
        id: video.id,
        title: video.title,
        coverUrl: video.coverUrl,
        duration: video.duration ?? undefined,
      });
      return song.success ? [song.data] : [];
    });

  return { played: toSongs(played), queued: toSongs(queued) };
}

/**
 * The songs a playlist saved with these choices holds. Each song once: first
 * the songs sung, then the queue, leaving out the ids in `excludeIds`, capped
 * at MAX_PLAYLIST_SONGS.
 */
export function pickSongsToSave(
  songs: { played: PlaylistSongInput[]; queued: PlaylistSongInput[] },
  {
    includePlayed,
    includeQueued,
    excludeIds = [],
  }: {
    includePlayed: boolean;
    includeQueued: boolean;
    excludeIds?: readonly string[];
  },
) {
  const seen = new Set<string>(excludeIds);
  const picked: PlaylistSongInput[] = [];
  for (const song of [
    ...(includePlayed ? songs.played : []),
    ...(includeQueued ? songs.queued : []),
  ]) {
    if (seen.has(song.id)) continue;
    seen.add(song.id);
    picked.push(song);
    if (picked.length >= MAX_PLAYLIST_SONGS) break;
  }
  return picked;
}
