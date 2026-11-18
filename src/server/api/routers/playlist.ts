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
  formatRecoveryCode,
  generatePlaylistHash,
  generateRecoveryCode,
  hashRecoveryCode,
  normalizeRecoveryCode,
  requirePartyHost,
  secretMatches,
} from "~/server/utils/secrets";

/** Every song loaded from a playlist is sung by the host. */
const LOADED_SINGER_NAME = "Host";

const PlaylistName = z.string().trim().min(1).max(100);
const Songs = z.array(PlaylistSongInput).max(MAX_PLAYLIST_SONGS);
const Hash = z.string().min(1).max(100);
const Secret = z.string().min(1).max(200);

const WRONG_CODE_MESSAGE = "That recovery code doesn't match this playlist.";

function toSongRows(songs: PlaylistSongInput[]) {
  return songs.map((song, position) => ({
    position,
    videoId: song.id,
    title: song.title,
    coverUrl: song.coverUrl,
    duration: song.duration ?? null,
  }));
}

/** Creates a playlist with a fresh link and recovery code. */
async function createPlaylist(
  db: typeof Db,
  data: { name: string; songs: PlaylistSongInput[]; sourceParty?: string },
) {
  const recoveryCode = generateRecoveryCode();

  // The hash is random, so a clash is all but impossible; retry just in case.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const playlist = await db.playlist.create({
        data: {
          hash: generatePlaylistHash(),
          name: data.name,
          ownerKeyHash: hashRecoveryCode(recoveryCode),
          sourceParty: data.sourceParty,
          songs: { create: toSongRows(data.songs) },
        },
      });

      return {
        hash: playlist.hash,
        name: playlist.name,
        songCount: data.songs.length,
        recoveryCode,
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

async function requirePlaylistOwner(
  db: typeof Db,
  hash: string,
  recoveryCode: string,
) {
  const playlist = await db.playlist.findUnique({ where: { hash } });

  if (!playlist) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Playlist not found." });
  }

  // Compared after normalizing, so dashes and lowercase don't matter.
  if (
    !secretMatches(playlist.ownerKeyHash, normalizeRecoveryCode(recoveryCode))
  ) {
    throw new TRPCError({ code: "FORBIDDEN", message: WRONG_CODE_MESSAGE });
  }

  return playlist;
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

  /**
   * Checks a recovery code. Returns it in its canonical form, which the
   * browser keeps to edit the playlist later.
   */
  verifyOwner: publicProcedure
    .input(z.object({ hash: Hash, recoveryCode: Secret }))
    .mutation(async ({ ctx, input }) => {
      await requirePlaylistOwner(ctx.db, input.hash, input.recoveryCode);
      return { recoveryCode: formatRecoveryCode(input.recoveryCode) };
    }),

  /** Renames the playlist and/or replaces its songs. */
  update: publicProcedure
    .input(
      z.object({
        hash: Hash,
        recoveryCode: Secret,
        name: PlaylistName.optional(),
        songs: Songs.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const playlist = await requirePlaylistOwner(
        ctx.db,
        input.hash,
        input.recoveryCode,
      );

      await ctx.db.$transaction(async (tx) => {
        if (input.songs) {
          await tx.playlistSong.deleteMany({
            where: { playlistId: playlist.id },
          });
          await tx.playlistSong.createMany({
            data: toSongRows(input.songs).map((row) => ({
              ...row,
              playlistId: playlist.id,
            })),
          });
        }

        await tx.playlist.update({
          where: { id: playlist.id },
          // Touch updatedAt even when only the songs changed.
          data: { name: input.name ?? playlist.name },
        });
      });

      return { updated: true };
    }),

  delete: publicProcedure
    .input(z.object({ hash: Hash, recoveryCode: Secret }))
    .mutation(async ({ ctx, input }) => {
      const playlist = await requirePlaylistOwner(
        ctx.db,
        input.hash,
        input.recoveryCode,
      );

      await ctx.db.playlist.delete({ where: { id: playlist.id } });

      log.info("Playlist deleted", { hash: playlist.hash });
      return { deleted: true };
    }),

  /** Saves the songs played so far at a party as a new playlist. */
  saveFromParty: publicProcedure
    .input(z.object({ partyHash: Hash, hostKey: Secret, name: PlaylistName }))
    .mutation(async ({ ctx, input }) => {
      const party = await requirePartyHost(
        ctx.db,
        input.partyHash,
        input.hostKey,
        "Only the browser that started this party can save its songs.",
      );

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
      const played = karaokeParty.history?.length
        ? karaokeParty.history
        : karaokeParty.playlist
            .filter((v) => v.playedAt)
            .sort(
              (a, b) =>
                new Date(a.playedAt!).getTime() -
                new Date(b.playedAt!).getTime(),
            );

      // Each song once, in the order it was first sung.
      const seen = new Set<string>();
      const songs: PlaylistSongInput[] = [];
      for (const video of played) {
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
          message: "No songs have been played at this party yet.",
        });
      }

      const created = await createPlaylist(ctx.db, {
        name: input.name,
        songs,
        sourceParty: party.hash,
      });

      log.info("Playlist saved from party", {
        hash: created.hash,
        party: party.hash,
        songs: songs.length,
      });
      return created;
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
