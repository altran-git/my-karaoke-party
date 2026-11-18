import {
	type Connection,
	type ConnectionContext,
	routePartykitRequest,
	Server,
	type WSMessage,
} from "partyserver";
import { moveInQueue } from "~/utils/playlist";
import {
	type KaraokeParty,
	LoadSongsRequest,
	type LoadSongsResponse,
	MAX_HISTORY_ENTRIES,
	MAX_PLAYLIST_SONGS,
	Message,
	type PartyDeleted,
	type PlaybackCommand,
	type PlaybackState,
	type PlaybackUpdate,
	type SettingsUpdate,
} from "./types";

const EXPIRY_PERIOD_MILLISECONDS = 30 * 24 * 60 * 60 * 1000; // 30 days

type Env = {
	/** Durable Object binding from wrangler.jsonc. Clients reach it at /parties/main/:room */
	Main: DurableObjectNamespace<KaraokeServer>;
	/**
	 * Shared with the Next.js app (same value as its PARTY_SECRET env var).
	 * Set with `npx wrangler secret put PARTY_SECRET`, or in .dev.vars locally.
	 */
	PARTY_SECRET?: string;
};

const encoder = new TextEncoder();

/** Constant-time check of the `Authorization: Bearer <secret>` header. */
function hasValidSecret(request: Request, secret: string): boolean {
	const header = request.headers.get("Authorization") ?? "";
	const expected = encoder.encode(`Bearer ${secret}`);
	const actual = encoder.encode(header);

	// timingSafeEqual needs equal lengths; compare against itself to keep timing flat.
	if (actual.byteLength !== expected.byteLength) {
		crypto.subtle.timingSafeEqual(expected, expected);
		return false;
	}

	return crypto.subtle.timingSafeEqual(actual, expected);
}

/**
 * One instance (a Cloudflare Durable Object) per party room. Holds the queue
 * in memory, persists it to Durable Object storage and broadcasts changes.
 */
export class KaraokeServer extends Server<Env> {
	// Let Cloudflare evict the object between messages while sockets stay open;
	// onStart reloads the party from storage when it wakes up.
	static options = { hibernate: true };

	karaokeParty: KaraokeParty | undefined;

	/** Last play/pause state the player screen reported, sent to guests as they join. */
	playback: PlaybackState | undefined;

	async fetch(request: Request): Promise<Response> {
		// Only parties created through the app (an authorized POST) can be joined.
		// Refuse the WebSocket upgrade for made-up room names before it is opened.
		const isWebSocket =
			request.headers.get("Upgrade")?.toLowerCase() === "websocket";

		if (
			isWebSocket &&
			!(await this.ctx.storage.get<KaraokeParty>("karaokeParty"))
		) {
			return new Response("Party not found =(", { status: 404 });
		}

		return super.fetch(request);
	}

	async onStart() {
		this.karaokeParty =
			await this.ctx.storage.get<KaraokeParty>("karaokeParty");
		this.playback = await this.ctx.storage.get<PlaybackState>("playback");
	}

	async onConnect(conn: Connection, ctx: ConnectionContext) {
		if (this.playback) {
			conn.send(
				JSON.stringify({
					type: "playback",
					...this.playback,
				} satisfies PlaybackUpdate),
			);
		}

		// A websocket just connected!
		console.log(
			`Connected:
      id: ${conn.id}
      room: ${this.name}
      url: ${new URL(ctx.request.url).pathname}`,
		);

		await this.ctx.storage.setAlarm(Date.now() + EXPIRY_PERIOD_MILLISECONDS);
	}

	async onClose(connection: Connection) {
		// A websocket just disconnected!
		console.log(`Disconnected: ${connection.id}`);
	}

	async onMessage(_sender: Connection, message: WSMessage) {
		if (!this.karaokeParty || typeof message !== "string") return;

		console.log("Received message:", message);

		const result = Message.safeParse(JSON.parse(message));

		if (!result.success) {
			console.error("Invalid message!", result.error);
			return;
		}

		const data = result.data;

		await this.ctx.storage.setAlarm(Date.now() + EXPIRY_PERIOD_MILLISECONDS);

		switch (data.type) {
			case "add-video": {
				if (
					!this.karaokeParty.playlist.find(
						(video) => video.id === data.id && !video.playedAt,
					)
				) {
					const video = {
						id: data.id,
						title: data.title,
						artist: "Some artist",
						song: "Song name",
						createdAt: new Date(),
						singerName: data.singerName,
						coverUrl: data.coverUrl,
						playedAt: null,
						postponedAt: null,
						duration: data.duration ?? undefined,
					};

					const playlist = this.karaokeParty.playlist;

					if (this.karaokeParty.settings.addSongsTo === "top") {
						// Next in line: right behind the song playing now, which
						// stays put. With nothing playing it simply goes first.
						const playingIndex = playlist.findIndex((v) => !v.playedAt);
						const insertAt =
							playingIndex === -1 ? playlist.length : playingIndex + 1;
						playlist.splice(insertAt, 0, video);
					} else {
						playlist.push(video);
					}

					await this.savekaraokeParty();
					this.broadcast(JSON.stringify(this.karaokeParty.playlist));
				}

				break;
			}

			case "remove-video": {
				// Played songs stay in the playlist, so match only the queued copy.
				const index = this.karaokeParty.playlist.findIndex(
					(video) => video.id === data.id && !video.playedAt,
				);

				if (index !== -1) {
					this.karaokeParty.playlist.splice(index, 1);
					await this.savekaraokeParty();
					this.broadcast(JSON.stringify(this.karaokeParty.playlist));
				}

				break;
			}

			case "postpone-video": {
				const playlist = this.karaokeParty.playlist;
				const index = playlist.findIndex(
					(video) => video.id === data.id && !video.playedAt,
				);

				if (index !== -1) {
					// Prefer a song whose singer hasn't already asked to wait this
					// turn, so two postponed songs don't alternate while a ready
					// singer sits behind them.
					const nextReadyIndex = playlist.findIndex(
						(video, i) => i > index && !video.playedAt && !video.postponedAt,
					);
					const nextIndex =
						nextReadyIndex !== -1
							? nextReadyIndex
							: playlist.findIndex((video, i) => i > index && !video.playedAt);

					if (nextIndex !== -1) {
						const postponed = playlist[index]!;
						postponed.postponedAt = new Date();

						[playlist[index], playlist[nextIndex]] = [
							playlist[nextIndex]!,
							postponed,
						];

						await this.savekaraokeParty();
						this.broadcast(JSON.stringify(playlist));
					}
				}

				break;
			}

			case "move-video": {
				const reordered = moveInQueue(
					this.karaokeParty.playlist,
					data.id,
					data.toIndex,
				);

				if (reordered !== this.karaokeParty.playlist) {
					this.karaokeParty.playlist = reordered;

					await this.savekaraokeParty();
					this.broadcast(JSON.stringify(reordered));
				}

				break;
			}

			case "set-add-songs-to": {
				if ((this.karaokeParty.settings.addSongsTo ?? "end") === data.mode) {
					break;
				}

				this.karaokeParty.settings.addSongsTo = data.mode;

				await this.savekaraokeParty();
				this.broadcastParty();

				break;
			}

			case "mark-as-played": {
				const video = this.karaokeParty.playlist.find(
					(video) => video.id === data.id && !video.playedAt,
				);

				if (video) {
					video.playedAt = new Date();

					// Log it where removing the song from the queue can't erase it,
					// so the host can later save the party's songs as a playlist.
					const history = (this.karaokeParty.history ??= []);
					history.push({
						id: video.id,
						title: video.title,
						coverUrl: video.coverUrl,
						duration: video.duration,
						singerName: video.singerName,
						playedAt: video.playedAt,
					});
					if (history.length > MAX_HISTORY_ENTRIES) {
						history.splice(0, history.length - MAX_HISTORY_ENTRIES);
					}

					// A song finished: everyone who postponed gets a fresh turn.
					for (const v of this.karaokeParty.playlist) {
						if (!v.playedAt) {
							v.postponedAt = null;
						}
					}

					await this.savekaraokeParty();
					this.broadcast(JSON.stringify(this.karaokeParty.playlist));
				}

				break;
			}

			case "set-playback": {
				// Only the player screen acts on this; it then reports the new
				// state back with "report-playback".
				this.broadcast(
					JSON.stringify({
						type: "playback-command",
						id: data.id,
						playing: data.playing,
					} satisfies PlaybackCommand),
				);
				break;
			}

			case "report-playback": {
				this.playback = { id: data.id, playing: data.playing };
				await this.ctx.storage.put<PlaybackState>("playback", this.playback);

				this.broadcast(
					JSON.stringify({
						type: "playback",
						...this.playback,
					} satisfies PlaybackUpdate),
				);
				break;
			}

			default: {
				console.error("Unknown message type", data);
			}
		}
	}

	async onRequest(req: Request) {
		if (req.method === "DELETE") {
			// The host deleted the party: tell everyone, disconnect them and
			// erase the queue for good.
			this.broadcast(
				JSON.stringify({ type: "party-deleted" } satisfies PartyDeleted),
			);
			for (const conn of this.getConnections()) {
				conn.close(1000, "Party deleted");
			}

			this.karaokeParty = undefined;
			this.playback = undefined;
			await this.ctx.storage.deleteAlarm();
			await this.ctx.storage.deleteAll();

			return new Response(null, { status: 204 });
		}

		const action = new URL(req.url).searchParams.get("action");

		if (req.method === "POST" && action === "load-songs") {
			return this.loadSongs(req);
		}

		if (req.method === "POST" && !this.karaokeParty) {
			console.log("Creating new karaoke party");

			this.karaokeParty = {
				playlist: [],
				settings: {
					addSongsTo: "end",
				},
			};

			await this.savekaraokeParty();
		}

		if (this.karaokeParty) {
			return new Response(JSON.stringify(this.karaokeParty), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}

		return new Response("Party not found =(", { status: 404 });
	}

	/**
	 * Adds a saved playlist's songs to the queue. Only the Next.js server calls
	 * this (it checks the host's key first), so guests can't load playlists.
	 */
	async loadSongs(req: Request): Promise<Response> {
		if (!this.karaokeParty) {
			return new Response("Party not found =(", { status: 404 });
		}

		let body: unknown;
		try {
			body = await req.json();
		} catch {
			return new Response("Invalid JSON", { status: 400 });
		}

		const parsed = LoadSongsRequest.safeParse(body);
		if (!parsed.success) {
			return new Response("Invalid request", { status: 400 });
		}

		const { songs, mode, singerName } = parsed.data;
		const party = this.karaokeParty;

		if (mode === "replace") {
			// Drop the upcoming songs, but keep the one on screen (the first
			// unplayed one) and everything already played.
			const playingIndex = party.playlist.findIndex((v) => !v.playedAt);
			party.playlist = party.playlist.filter(
				(v, i) => v.playedAt || i === playingIndex,
			);
		}

		const waiting = new Set(
			party.playlist.filter((v) => !v.playedAt).map((v) => v.id),
		);
		// With nothing playing, the first loaded song goes straight on screen.
		// Let the host start it rather than playing it the moment it loads.
		const queueWasEmpty = waiting.size === 0;
		const queueRoom = Math.max(0, MAX_PLAYLIST_SONGS * 2 - waiting.size);

		let added = 0;
		let skipped = 0;
		const now = new Date();

		for (const song of songs) {
			if (waiting.has(song.id) || added >= queueRoom) {
				skipped++;
				continue;
			}

			waiting.add(song.id);
			party.playlist.push({
				id: song.id,
				title: song.title,
				artist: "Some artist",
				song: "Song name",
				createdAt: now,
				singerName,
				coverUrl: song.coverUrl,
				playedAt: null,
				postponedAt: null,
				duration: song.duration,
				...(queueWasEmpty && added === 0 ? { waitForPlay: true } : {}),
			});
			added++;
		}

		if (added > 0 || mode === "replace") {
			await this.savekaraokeParty();
			this.broadcast(JSON.stringify(party.playlist));
			await this.ctx.storage.setAlarm(Date.now() + EXPIRY_PERIOD_MILLISECONDS);
		}

		return new Response(
			JSON.stringify({ added, skipped } satisfies LoadSongsResponse),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	}

	broadcastParty() {
		if (!this.karaokeParty) return;

		this.broadcast(JSON.stringify(this.karaokeParty.playlist));
		this.broadcast(
			JSON.stringify({
				type: "settings",
				settings: this.karaokeParty.settings,
			} satisfies SettingsUpdate),
		);
	}

	async savekaraokeParty() {
		if (this.karaokeParty) {
			await this.ctx.storage.put<KaraokeParty>(
				"karaokeParty",
				this.karaokeParty,
			);
		}
	}

	async onAlarm() {
		// The party has been idle for EXPIRY_PERIOD_MILLISECONDS: forget it.
		this.karaokeParty = undefined;
		this.playback = undefined;
		await this.ctx.storage.deleteAll();
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		return (
			(await routePartykitRequest(request, env, {
				// Browsers only use WebSockets (onBeforeConnect, left open so guests
				// can join). Plain HTTP requests (create a party, read its queue) only
				// come from the Next.js server, so they must carry the shared secret.
				onBeforeRequest(req) {
					const secret = env.PARTY_SECRET;

					if (!secret) {
						console.error("PARTY_SECRET is not set; rejecting HTTP request.");
						return new Response("Server misconfigured", { status: 500 });
					}

					if (!hasValidSecret(req, secret)) {
						return new Response("Unauthorized", { status: 401 });
					}
				},
			})) ?? new Response("Not Found", { status: 404 })
		);
	},
} satisfies ExportedHandler<Env>;
