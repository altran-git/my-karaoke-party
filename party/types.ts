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

const SetFairQueue = z.object({
	type: z.literal("set-fair-queue"),
	enabled: z.boolean(),
});

export const Message = z.union([
	AddVideo,
	RemoveVideo,
	MarkAsPlayed,
	PostponeVideo,
	MoveVideo,
	SetFairQueue,
]);

export type KaraokePartySettings = {
	orderByFairness: boolean;
};

export type Message = z.infer<typeof Message>;

export type VideoInPlaylist = Omit<Video, "duration"> & {
	singerName: string;
	playedAt: Date | null;
	postponedAt?: Date | null;
	duration: string | undefined;
};

export type KaraokeParty = {
	playlist: VideoInPlaylist[];
	settings: KaraokePartySettings;
};

export type SettingsUpdate = {
	type: "settings";
	settings: KaraokePartySettings;
};

/** Sent to everyone in the room right before the party is deleted. */
export type PartyDeleted = {
	type: "party-deleted";
};
