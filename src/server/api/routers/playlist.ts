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
import { suggestSongs } from "~/server/suggestions";
import { fetchPartyServer } from "~/server/party-server";
import { pickSongsToSave, splitPartySongs } from "~/utils/party-songs";
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

/** Reads a party's live state from the party server, to save its songs. */
async function readPartySongs(partyHash: string) {
  const res = await fetchPartyServer(partyHash, {
    method: "GET",
    cache: "no-store",
  });
  if (!res.ok) {
    log.error("Couldn't read party to save it", {
      hash: partyHash,
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
  return (await res.json()) as KaraokeParty;
}

function toSongRows(songs: PlaylistSongInput[]) {
  return songs.map((song, position) => ({
    position,
    videoId: song.id,
    title: song.title,
    coverUrl: song.coverUrl,
    duration: song.duration ?? null,
  }));
}

/** Whether another playlist already has this name, ignoring capitals. */
async function nameTaken(db: typeof Db, name: string, exceptId?: number) {
  const other = await db.playlist.findFirst({
    where: {
      name: { equals: name.trim(), mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  return !!other;
}

function nameTakenError(name: string) {
  return new TRPCError({
    code: "CONFLICT",
    message: `A playlist named “${name.trim()}” already exists. Please pick another name.`,
  });
}

/**
 * Creates a playlist with a fresh random link. Its name must be unused;
 * with `suffixIfTaken`, " (2)", " (3)"... is added instead of refusing.
 */
async function createPlaylist(
  db: typeof Db,
  data: {
    name: string;
    songs: PlaylistSongInput[];
    sourceParty?: string;
    hostKeyHash?: string | null;
    suffixIfTaken?: boolean;
  },
) {
  let name = data.name.trim();
  if (await nameTaken(db, name)) {
    if (!data.suffixIfTaken) throw nameTakenError(name);

    let n = 2;
    while (await nameTaken(db, `${name} (${n})`)) n++;
    name = `${name} (${n})`;
  }

  // The hash is random, so a clash is all but impossible; retry just in case.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const playlist = await db.playlist.create({
        data: {
          hash: generatePlaylistHash(),
          name,
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

/**
 * Sends songs to the party's queue on the live server (shuffled first if
 * asked), sung by the host. Throws if the live server didn't take them.
 */
async function sendSongsToParty(
  partyHash: string,
  input: PlaylistSongInput[],
  mode: LoadMode,
  shuffle: boolean,
) {
  const songs = [...input];
  if (shuffle) {
    for (let i = songs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [songs[i], songs[j]] = [songs[j]!, songs[i]!];
    }
  }

  const res = await fetchPartyServer(
    partyHash,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        songs,
        mode,
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
    log.error("Couldn't load songs into party", {
      party: partyHash,
      status: res.status,
    });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Couldn't load the playlist. Please try again.",
    });
  }

  return { added: result.added, skipped: result.skipped ?? 0 };
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
        sourceParty: playlist.sourceParty,
        loadCount: playlist.loadCount,
        lastLoadedAt: playlist.lastLoadedAt,
        lastLoadedParty: playlist.lastLoadedParty,
        lastLoadedPartyName: playlist.lastLoadedPartyName,
        songs: playlist.songs.map((s) => ({
          /** This entry in the playlist, for removeSong. */
          songId: s.id,
          id: s.videoId,
          title: s.title,
          coverUrl: s.coverUrl,
          duration: s.duration ?? undefined,
        })),
      };
    }),

  /**
   * Adds a song to the end of a playlist. Anyone with the link can. A song
   * already in the playlist isn't added twice.
   */
  addSong: publicProcedure
    .input(z.object({ hash: Hash, song: PlaylistSongInput }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.$transaction(async (tx) => {
        const playlist = await tx.playlist.findUnique({
          where: { hash: input.hash },
          select: { id: true, _count: { select: { songs: true } } },
        });
        if (!playlist) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Playlist not found.",
          });
        }
        if (playlist._count.songs >= MAX_PLAYLIST_SONGS) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `A playlist can have at most ${MAX_PLAYLIST_SONGS} songs.`,
          });
        }

        const existing = await tx.playlistSong.findFirst({
          where: { playlistId: playlist.id, videoId: input.song.id },
          select: { id: true },
        });
        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "That song is already in this playlist.",
          });
        }

        const last = await tx.playlistSong.aggregate({
          where: { playlistId: playlist.id },
          _max: { position: true },
        });
        const [row] = toSongRows([input.song]);
        await tx.playlistSong.create({
          data: {
            ...row!,
            position: (last._max.position ?? -1) + 1,
            playlistId: playlist.id,
          },
        });
        await tx.playlist.update({
          where: { id: playlist.id },
          data: { updatedAt: new Date() },
        });

        return { added: true };
      });
    }),

  /**
   * Moves one song to `toIndex` (0 is the top) and renumbers the playlist.
   * Anyone with the link can. Works from the order saved right now, so
   * people reordering at once can't leave the list scrambled.
   */
  moveSong: publicProcedure
    .input(
      z.object({
        hash: Hash,
        songId: z.number().int(),
        toIndex: z.number().int().nonnegative(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.$transaction(async (tx) => {
        // Lock the playlist row first, so concurrent moves run one after
        // another and each reads the order the previous one saved.
        const locked = await tx.playlist.updateMany({
          where: { hash: input.hash },
          data: { updatedAt: new Date() },
        });
        if (locked.count === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Playlist not found.",
          });
        }

        const songs = await tx.playlistSong.findMany({
          where: { playlist: { hash: input.hash } },
          orderBy: [{ position: "asc" }, { id: "asc" }],
          select: { id: true },
        });

        const order = songs.map((song) => song.id);
        const from = order.indexOf(input.songId);
        // Removed by someone else in the meantime: nothing to move.
        if (from === -1) return { moved: false };

        const to = Math.min(input.toIndex, order.length - 1);
        if (from === to) return { moved: false };

        order.splice(from, 1);
        order.splice(to, 0, input.songId);

        // Renumber every song 0, 1, 2... in one statement.
        await tx.$executeRaw`
          UPDATE "PlaylistSong" AS s
          SET "position" = (v.pos - 1)::int
          FROM unnest(${order}::int[]) WITH ORDINALITY AS v(id, pos)
          WHERE s.id = v.id`;

        return { moved: true };
      });
    }),

  /** Removes one song from a playlist. Anyone with the link can. */
  removeSong: publicProcedure
    .input(z.object({ hash: Hash, songId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      // Matched on both, so a song can only be removed from its own
      // playlist. Already gone (someone else removed it) isn't an error.
      const { count } = await ctx.db.playlistSong.deleteMany({
        where: { id: input.songId, playlist: { hash: input.hash } },
      });
      if (count > 0) {
        await ctx.db.playlist.update({
          where: { hash: input.hash },
          data: { updatedAt: new Date() },
        });
      }
      return { removed: count > 0 };
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

  /** Renames the playlist. Anyone can do this. */
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

      if (await nameTaken(ctx.db, input.name, playlist.id)) {
        throw nameTakenError(input.name);
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
  /**
   * A party's songs as "Save as playlist" offers them, so the dialog can show
   * what will be saved before saving it.
   */
  partySongs: publicProcedure
    .input(z.object({ partyHash: Hash }))
    .query(async ({ ctx, input }) => {
      const found = await ctx.db.party.findUnique({
        where: { hash: input.partyHash },
        select: { hash: true },
      });
      if (!found?.hash) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Party not found." });
      }
      return splitPartySongs(await readPartySongs(found.hash));
    }),

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
          /**
           * If the name is taken, add " (2)" etc. instead of refusing. Used
           * when saving automatically before deleting a party.
           */
          suffixIfTaken: z.boolean().default(false),
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

      const songs = pickSongsToSave(
        splitPartySongs(await readPartySongs(party.hash)),
        input,
      );

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
        suffixIfTaken: input.suffixIfTaken,
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

      const result = await sendSongsToParty(
        party.hash,
        songs,
        input.mode,
        input.shuffle,
      );

      // Raw SQL, so loading doesn't count as a change (updatedAt).
      await ctx.db.$executeRaw`
        UPDATE "Playlist"
        SET "loadCount" = "loadCount" + 1,
            "lastLoadedAt" = now() AT TIME ZONE 'UTC',
            "lastLoadedParty" = ${party.hash},
            "lastLoadedPartyName" = ${party.name}
        WHERE id = ${playlist.id}`;

      log.info("Playlist loaded into party", {
        party: party.hash,
        playlist: playlist.hash,
        ...result,
      });
      return result;
    }),

  /**
   * Adds songs given directly (from a playlist file) to the queue of a party
   * this browser hosts. No saved playlist is involved, so no stats change.
   */
  loadSongsIntoParty: publicProcedure
    .input(
      z.object({
        partyHash: Hash,
        hostKey: Secret,
        songs: Songs.min(1, "The file has no songs."),
        mode: LoadMode.default("append"),
        shuffle: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const party = await requirePartyHost(
        ctx.db,
        input.partyHash,
        input.hostKey,
        "Only the host of this party can load songs into it.",
      );

      const result = await sendSongsToParty(
        party.hash,
        input.songs,
        input.mode,
        input.shuffle,
      );

      log.info("Playlist file loaded into party", {
        party: party.hash,
        ...result,
      });
      return result;
    }),

  /**
   * Songs to sing next, picked from saved playlists. Songs that share
   * playlists with `recentIds` (the songs just sung, newest first) rank
   * highest; songs found in many playlists fill the rest. The caller
   * leaves out songs already played or queued.
   */
  suggestions: publicProcedure
    .input(
      z.object({
        recentIds: z.array(z.string().regex(/^[a-zA-Z0-9_-]{11}$/)).max(10),
      }),
    )
    .query(({ ctx, input }) => suggestSongs(ctx.db, input.recentIds)),
});
