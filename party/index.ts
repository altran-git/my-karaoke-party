import {
	type Connection,
	type ConnectionContext,
	routePartykitRequest,
	Server,
	type WSMessage,
} from "partyserver";
import { orderByFairness } from "~/utils/array";
import { moveInQueue } from "~/utils/playlist";
import {
	type KaraokeParty,
	Message,
	type SettingsUpdate,
} from "./types";

const EXPIRY_PERIOD_MILLISECONDS = 30 * 24 * 60 * 60 * 1000; // 30 days

type Env = {
	/** Durable Object binding from wrangler.jsonc. Clients reach it at /parties/main/:room */
	Main: DurableObjectNamespace<KaraokeServer>;
};

/**
 * One instance (a Cloudflare Durable Object) per party room. Holds the queue
 * in memory, persists it to Durable Object storage and broadcasts changes.
 */
export class KaraokeServer extends Server<Env> {
	// Let Cloudflare evict the object between messages while sockets stay open;
	// onStart reloads the party from storage when it wakes up.
	static options = { hibernate: true };

	karaokeParty: KaraokeParty | undefined;

	async onStart() {
		this.karaokeParty =
			await this.ctx.storage.get<KaraokeParty>("karaokeParty");
	}

	async onConnect(conn: Connection, ctx: ConnectionContext) {
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
					this.karaokeParty.playlist.push({
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
					});

					if (this.karaokeParty.settings.orderByFairness) {
						this.reorderPlaylistByFairness();
					}

					await this.savekaraokeParty();
					this.broadcast(JSON.stringify(this.karaokeParty.playlist));
				}

				break;
			}

			case "remove-video": {
				const index = this.karaokeParty.playlist.findIndex(
					(video) => video.id === data.id,
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

					// The host just said where this song goes; re-running the fair
					// order on the next add would throw that away.
					this.karaokeParty.settings.orderByFairness = false;

					await this.savekaraokeParty();
					this.broadcastParty();
				}

				break;
			}

			case "set-fair-queue": {
				if (this.karaokeParty.settings.orderByFairness === data.enabled) {
					break;
				}

				this.karaokeParty.settings.orderByFairness = data.enabled;

				if (data.enabled) {
					this.reorderPlaylistByFairness();
				}

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

			case "horn": {
				// Just broadcast the horn event to all clients
				this.broadcast(JSON.stringify({ type: "horn" }));
				break;
			}

			default: {
				console.error("Unknown message type", data);
			}
		}
	}

	async onRequest(req: Request) {
		if (req.method === "POST" && !this.karaokeParty) {
			console.log("Creating new karaoke party");

			this.karaokeParty = {
				playlist: [],
				settings: {
					orderByFairness: true,
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
		await this.ctx.storage.deleteAll();
	}

	reorderPlaylistByFairness() {
		if (!this.karaokeParty || this.karaokeParty.playlist.length === 0) return;

		const ordered = orderByFairness(
			this.karaokeParty.playlist,
			(video) => video.singerName,
			(a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
		);

		const playedVideos = this.karaokeParty.playlist.filter(
			(video) => video.playedAt,
		);
		const currentVideo = this.karaokeParty.playlist.find((v) => !v.playedAt);
		const nextVideos = ordered.filter(
			(video) => !video.playedAt && video !== currentVideo,
		);

		const newPlaylist = [...playedVideos];

		if (currentVideo) {
			newPlaylist.push(currentVideo);
		}

		newPlaylist.push(...nextVideos);

		this.karaokeParty.playlist = newPlaylist;
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		return (
			(await routePartykitRequest(request, env)) ??
			new Response("Not Found", { status: 404 })
		);
	},
} satisfies ExportedHandler<Env>;
