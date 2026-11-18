import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { log } from "next-axiom";
import {
  type KaraokeParty,
  LoadMode,
  type LoadSongsRequest,
  type LoadSongsResponse,
  MAX_PLAYLIST_SONGS,
  PlaylistSongInput,
} from "party/types";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import type { db as Db } from "~/server/db";
import { fetchPartyServer } from "~/server/party-server";
import {
  checkHostKey,
  generatePlaylistHash,
  requirePartyHost,
} from "~/server/utils/secrets";

/** Every song loaded from a playlist is sung by the host. */
const LOADED_SINGER_NAME = "Host";

const PlaylistName = z.string().trim().min(1).max(100);
const Songs = z.array(PlaylistSongInput).max(MAX_PLAYLIST_SONGS);
const Hash = z.string().min(1).max(100);
const Secret = z.string().min(1).max(200);

function toSongRows(songs: PlaylistSongInput[]) {
  return songs.map((song, position) => ({
    position,
    videoId: song.id,
    title: song.title,
    coverUrl: song.coverUrl,
    duration: song.duration ?? null,
  }));
}

/** Creates a playlist with a fresh random link. */
async function createPlaylist(
  db: typeof Db,
  data: {
    name: string;
    songs: PlaylistSongInput[];
    sourceParty?: string;
    hostKeyHash?: string | null;
  },
) {
  // The hash is random, so a clash is all but impossible; retry just in case.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const playlist = await db.playlist.create({
        data: {
          hash: generatePlaylistHash(),
          name: data.name,
          sourceParty: data.sourceParty,
          hostKeyHash: data.hostKeyHash ?? null,
          songs: { create: toSongRows(data.songs) },
        },
      });

      return {
        hash: playlist.hash,
        name: playlist.name,
        songCount: data.songs.length,
      };
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        continue;
      }
      throw e;
    }
  }

  throw new Error("Couldn't pick a unique playlist link");
}

/**
 * The playlist `hash`, if the caller may overwrite it from `party`: they
 * must be its verified host (checkHostKey, with the PIN lockout), and the
 * playlist must have been saved from a party with the same code and the
 * same host PIN. Throws otherwise.
 */
async function requireOverwritable(
  db: typeof Db,
  party: { id: number; hash: string; hostKeyHash: string | null },
  hostKey: string | undefined,
  hash: string,
) {
  if (!hostKey) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the host can overwrite a playlist.",
    });
  }
  await checkHostKey(
    db,
    party,
    hostKey,
    "Only the host can overwrite a playlist.",
  );

  const target = await db.playlist.findUnique({ where: { hash } });
  if (!target) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Playlist not found." });
  }
  if (
    !target.hostKeyHash ||
    !party.hostKeyHash ||
    target.sourceParty !== party.hash ||
    target.hostKeyHash !== party.hostKeyHash
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "You can only overwrite playlists saved from parties you hosted.",
    });
  }
  return target;
}

export const playlistRouter = createTRPCRouter({
  /** Public view of a playlist: anyone with the link can see it. */
  get: publicProcedure
    .input(z.object({ hash: Hash }))
    .query(async ({ ctx, input }) => {
      const playlist = await ctx.db.playlist.findUnique({
        where: { hash: input.hash },
        include: { songs: { orderBy: { position: "asc" } } },
      });

      if (!playlist) return null;

      return {
        hash: playlist.hash,
        name: playlist.name,
        createdAt: playlist.createdAt,
        updatedAt: playlist.updatedAt,
        songs: playlist.songs.map((s) => ({
          id: s.videoId,
          title: s.title,
          coverUrl: s.coverUrl,
          duration: s.duration ?? undefined,
        })),
      };
    }),

  /**
   * Every saved playlist, newest first, optionally filtered by name. Anyone
   * can see and load any playlist.
   */
  list: publicProcedure
    .input(
      z.object({
        search: z.string().trim().max(100).optional(),
        limit: z.number().int().min(1).max(100).default(50),
        /** `nextCursor` from the previous page. */
        cursor: z.number().int().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const playlists = await ctx.db.playlist.findMany({
        where: {
          ...(input.search
            ? { name: { contains: input.search, mode: "insensitive" } }
            : {}),
          ...(input.cursor ? { id: { lt: input.cursor } } : {}),
        },
        orderBy: { id: "desc" },
        take: input.limit + 1,
        select: {
          id: true,
          hash: true,
          name: true,
          createdAt: true,
          _count: { select: { songs: true } },
        },
      });

      const hasMore = playlists.length > input.limit;
      const page = hasMore ? playlists.slice(0, input.limit) : playlists;

      return {
        items: page.map((p) => ({
          hash: p.hash,
          name: p.name,
          createdAt: p.createdAt,
          songCount: p._count.songs,
        })),
        nextCursor: hasMore ? page[page.length - 1]!.id : undefined,
      };
    }),

  /** Names and song counts of several playlists, for lists in the UI. */
  getMany: publicProcedure
    .input(z.object({ hashes: z.array(Hash).max(100) }))
    .query(async ({ ctx, input }) => {
      if (input.hashes.length === 0) return [];

      const playlists = await ctx.db.playlist.findMany({
        where: { hash: { in: input.hashes } },
        select: {
          hash: true,
          name: true,
          updatedAt: true,
          _count: { select: { songs: true } },
        },
      });

      return playlists.map((p) => ({
        hash: p.hash,
        name: p.name,
        updatedAt: p.updatedAt,
        songCount: p._count.songs,
      }));
    }),

  create: publicProcedure
    .input(z.object({ name: PlaylistName, songs: Songs.default([]) }))
    .mutation(async ({ ctx, input }) => {
      const created = await createPlaylist(ctx.db, input);
      log.info("Playlist created", { hash: created.hash });
      return created;
    }),

  /** Renames the playlist and/or replaces its songs. Anyone can do this. */
  update: publicProcedure
    .input(z.object({ hash: Hash, name: PlaylistName }))
    .mutation(async ({ ctx, input }) => {
      const playlist = await ctx.db.playlist.findUnique({
        where: { hash: input.hash },
      });
      if (!playlist) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Playlist not found.",
        });
      }

      await ctx.db.playlist.update({
        where: { id: playlist.id },
        data: { name: input.name },
      });

      return { updated: true };
    }),

  /**
   * Anyone can delete any playlist. The person has to type DELETE first,
   * which guards against accidents, not against people.
   */
  delete: publicProcedure
    .input(
      z.object({
        hash: Hash,
        confirm: z.literal("DELETE", {
          errorMap: () => ({ message: "Type DELETE to confirm." }),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // deleteMany, so a playlist someone else just deleted isn't an error.
      const { count } = await ctx.db.playlist.deleteMany({
        where: { hash: input.hash },
      });

      if (count > 0) log.info("Playlist deleted", { hash: input.hash });
      return { deleted: true };
    }),

  /**
   * Saves a party's songs (sung, queued or both) as a new playlist. Open to
   * anyone with the party code.
   */
  saveFromParty: publicProcedure
    .input(
      z
        .object({
          partyHash: Hash,
          name: PlaylistName,
          /**
           * Replace the songs of this playlist instead of creating a new one.
           * Only for the host of the party it was saved from (see
           * requireOverwritable); needs `hostKey`.
           */
          overwriteHash: Hash.optional(),
          hostKey: Secret.optional(),
          /** Songs already sung, in the order they were played. */
          includePlayed: z.boolean().default(true),
          /** Songs still waiting, in queue order (the one on screen first). */
          includeQueued: z.boolean().default(true),
        })
        .refine((input) => input.includePlayed || input.includeQueued, {
          message: "Pick songs already sung, songs in the queue, or both.",
        }),
    )
    .mutation(async ({ ctx, input }) => {
      // Anyone at the party can save its songs as a new playlist: they can
      // already see them. Overwriting is for the host only.
      const found = await ctx.db.party.findUnique({
        where: { hash: input.partyHash },
      });
      if (!found?.hash) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Party not found." });
      }
      const party = { ...found, hash: found.hash };

      // Check before reading the queue, so a refusal costs nothing.
      const target = input.overwriteHash
        ? await requireOverwritable(
            ctx.db,
            party,
            input.hostKey,
            input.overwriteHash,
          )
        : null;

      const res = await fetchPartyServer(party.hash, {
        method: "GET",
        cache: "no-store",
      });
      if (!res.ok) {
        log.error("Couldn't read party to save it", {
          hash: party.hash,
          status: res.status,
        });
        throw new TRPCError({
          code: res.status === 404 ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR",
          message:
            res.status === 404
              ? "This party's songs are no longer available."
              : "Couldn't read the party's songs. Please try again.",
        });
      }

      const karaokeParty = (await res.json()) as KaraokeParty;

      // Parties from before the history log only have the played songs that
      // are still in the queue.
      const played = !input.includePlayed
        ? []
        : karaokeParty.history?.length
          ? karaokeParty.history
          : karaokeParty.playlist
              .filter((v) => v.playedAt)
              .sort(
                (a, b) =>
                  new Date(a.playedAt!).getTime() -
                  new Date(b.playedAt!).getTime(),
              );

      const queued = input.includeQueued
        ? karaokeParty.playlist.filter((v) => !v.playedAt)
        : [];

      // Each song once: first the songs sung, in the order they were played,
      // then the queue in its current order.
      const seen = new Set<string>();
      const songs: PlaylistSongInput[] = [];
      for (const video of [...played, ...queued]) {
        if (seen.has(video.id)) continue;
        seen.add(video.id);

        const song = PlaylistSongInput.safeParse({
          id: video.id,
          title: video.title,
          coverUrl: video.coverUrl,
          duration: video.duration ?? undefined,
        });
        if (song.success) songs.push(song.data);
        if (songs.length >= MAX_PLAYLIST_SONGS) break;
      }

      if (songs.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: !input.includeQueued
            ? "No songs have been played at this party yet."
            : !input.includePlayed
              ? "There are no songs in the queue."
              : "This party has no songs to save yet.",
        });
      }

      if (target) {
        await ctx.db.$transaction([
          ctx.db.playlistSong.deleteMany({ where: { playlistId: target.id } }),
          ctx.db.playlistSong.createMany({
            data: toSongRows(songs).map((row) => ({
              ...row,
              playlistId: target.id,
            })),
          }),
          // Touch updatedAt, so it moves up in lists sorted by date.
          ctx.db.playlist.update({
            where: { id: target.id },
            data: { updatedAt: new Date() },
          }),
        ]);

        log.info("Playlist overwritten from party", {
          hash: target.hash,
          party: party.hash,
          songs: songs.length,
        });
        return {
          hash: target.hash,
          name: target.name,
          songCount: songs.length,
          overwritten: true,
        };
      }

      const created = await createPlaylist(ctx.db, {
        name: input.name,
        songs,
        sourceParty: party.hash,
        hostKeyHash: party.hostKeyHash,
      });

      log.info("Playlist saved from party", {
        hash: created.hash,
        party: party.hash,
        songs: songs.length,
      });
      return { ...created, overwritten: false };
    }),

  /**
   * Playlists the host of this party may overwrite: ones saved from a party
   * with this code and this host PIN. Newest first.
   */
  overwritable: publicProcedure
    .input(z.object({ partyHash: Hash, hostKey: Secret }))
    .query(async ({ ctx, input }) => {
      const party = await requirePartyHost(
        ctx.db,
        input.partyHash,
        input.hostKey,
      );
      if (!party.hostKeyHash) return [];

      const playlists = await ctx.db.playlist.findMany({
        where: { sourceParty: party.hash, hostKeyHash: party.hostKeyHash },
        orderBy: { updatedAt: "desc" },
        take: 50,
        select: {
          hash: true,
          name: true,
          updatedAt: true,
          _count: { select: { songs: true } },
        },
      });

      return playlists.map((p) => ({
        hash: p.hash,
        name: p.name,
        updatedAt: p.updatedAt,
        songCount: p._count.songs,
      }));
    }),

  /** Adds a playlist's songs to the queue of a party this browser hosts. */
  loadIntoParty: publicProcedure
    .input(
      z.object({
        partyHash: Hash,
        hostKey: Secret,
        playlistHash: Hash,
        mode: LoadMode.default("append"),
        shuffle: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const party = await requirePartyHost(
        ctx.db,
        input.partyHash,
        input.hostKey,
        "Only the host of this party can load a playlist into it.",
      );

      const playlist = await ctx.db.playlist.findUnique({
        where: { hash: input.playlistHash },
        include: { songs: { orderBy: { position: "asc" } } },
      });
      if (!playlist) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Playlist not found.",
        });
      }

      const songs: PlaylistSongInput[] = playlist.songs.map((s) => ({
        id: s.videoId,
        title: s.title,
        coverUrl: s.coverUrl,
        duration: s.duration ?? undefined,
      }));

      if (input.shuffle) {
        for (let i = songs.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [songs[i], songs[j]] = [songs[j]!, songs[i]!];
        }
      }

      const res = await fetchPartyServer(
        party.hash,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            songs,
            mode: input.mode,
            singerName: LOADED_SINGER_NAME,
          } satisfies LoadSongsRequest),
          cache: "no-store",
        },
        { action: "load-songs" },
      );

      const result = res.ok
        ? ((await res.json()) as Partial<LoadSongsResponse>)
        : null;

      // An older live server answers this POST with the whole party instead.
      if (!result || typeof result.added !== "number") {
        log.error("Couldn't load playlist into party", {
          party: party.hash,
          playlist: playlist.hash,
          status: res.status,
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Couldn't load the playlist. Please try again.",
        });
      }

      log.info("Playlist loaded into party", {
        party: party.hash,
        playlist: playlist.hash,
        ...result,
      });
      return { added: result.added, skipped: result.skipped ?? 0 };
    }),
});
