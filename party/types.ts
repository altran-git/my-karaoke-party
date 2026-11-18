// Shared between the realtime server (party/index.ts) and the Next.js app.
// Keep this file free of Cloudflare Worker imports so the app can import it.
import type { Video } from "@prisma/client";
import { z } from "zod";

const AddVideo = z.object({
	type: z.literal("add-video"),
	id: z.string(),
	title: z.string(),
	artist: z.string().optional(),
	song: z.string().optional(),
	coverUrl: z.string(),
	duration: z.string().optional(),
	singerName: z.string(),
});

const MarkAsPlayed = z.object({
	type: z.literal("mark-as-played"),
	id: z.string(),
});

const RemoveVideo = z.object({
	type: z.literal("remove-video"),
	id: z.string(),
});

const PostponeVideo = z.object({
	type: z.literal("postpone-video"),
	id: z.string(),
});

const MoveVideo = z.object({
	type: z.literal("move-video"),
	id: z.string(),
	/** Target position in the queue of unplayed videos. 0 is the song playing right now. */
	toIndex: z.number().int().nonnegative(),
});

/** Where newly requested songs go: "end" of the queue, or "top" (next in line). */
export const AddSongsTo = z.enum(["end", "top"]);

const SetAddSongsTo = z.object({
	type: z.literal("set-add-songs-to"),
	mode: AddSongsTo,
});

/**
 * A guest asks the player screen to play or pause the song on screen.
 * Without `playing` (the guest doesn't know its state yet) it toggles.
 */
const SetPlayback = z.object({
	type: z.literal("set-playback"),
	id: z.string(),
	playing: z.boolean().optional(),
});

/** The player screen reports whether the song on screen is playing. */
const ReportPlayback = z.object({
	type: z.literal("report-playback"),
	id: z.string(),
	playing: z.boolean(),
});

export const Message = z.union([
	AddVideo,
	RemoveVideo,
	MarkAsPlayed,
	PostponeVideo,
	MoveVideo,
	SetAddSongsTo,
	SetPlayback,
	ReportPlayback,
]);

export type PlaybackState = {
	/** Id of the video the state is about. */
	id: string;
	playing: boolean;
};

/** Relayed to the player screen: play or pause video `id` (toggle without `playing`). */
export type PlaybackCommand = {
	type: "playback-command";
	id: string;
	playing?: boolean;
};

/** Relayed to everyone: whether video `id` is playing on the player screen. */
export type PlaybackUpdate = PlaybackState & {
	type: "playback";
};

export type AddSongsTo = z.infer<typeof AddSongsTo>;

export type KaraokePartySettings = {
	/** Missing on parties saved before this setting existed: treat as "end". */
	addSongsTo?: AddSongsTo;
};

export type Message = z.infer<typeof Message>;

export type VideoInPlaylist = Omit<Video, "duration"> & {
	singerName: string;
	playedAt: Date | null;
	postponedAt?: Date | null;
	duration: string | undefined;
};

/** One song that finished (or was skipped past) on the player screen. */
export type HistoryEntry = {
	id: string;
	title: string;
	coverUrl: string;
	duration: string | undefined;
	singerName: string;
	playedAt: Date;
};

export type KaraokeParty = {
	playlist: VideoInPlaylist[];
	settings: KaraokePartySettings;
	/**
	 * Every song played at this party, oldest first. Unlike `playlist`, entries
	 * stay here even when someone removes the song from the queue. Missing on
	 * parties saved before this existed.
	 */
	history?: HistoryEntry[];
};

/** Most songs one playlist can hold, and one load can add to a party. */
export const MAX_PLAYLIST_SONGS = 200;

/** Most entries kept in a party's history; the oldest are dropped first. */
export const MAX_HISTORY_ENTRIES = 500;

export const PlaylistSongInput = z.object({
	/** YouTube video id. */
	id: z.string().regex(/^[a-zA-Z0-9_-]{11}$/),
	title: z.string().min(1).max(300),
	coverUrl: z.string().url().max(500),
	duration: z.string().max(20).optional(),
});

export type PlaylistSongInput = z.infer<typeof PlaylistSongInput>;

/** How a loaded playlist joins the queue. */
export const LoadMode = z.enum(["append", "replace"]);

export type LoadMode = z.infer<typeof LoadMode>;

/**
 * Body of POST /parties/main/:room?action=load-songs, sent only by the
 * Next.js server after it has checked the host's key.
 */
export const LoadSongsRequest = z.object({
	songs: z.array(PlaylistSongInput).max(MAX_PLAYLIST_SONGS),
	mode: LoadMode,
	/** Shown as the singer of every loaded song. */
	singerName: z.string().min(1).max(50),
});

export type LoadSongsRequest = z.infer<typeof LoadSongsRequest>;

export type LoadSongsResponse = {
	added: number;
	/** Songs left out because they were already waiting in the queue. */
	skipped: number;
};

export type SettingsUpdate = {
	type: "settings";
	settings: KaraokePartySettings;
};

/** Sent to everyone in the room right before the party is deleted. */
export type PartyDeleted = {
	type: "party-deleted";
};
