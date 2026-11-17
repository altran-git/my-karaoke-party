/* eslint-disable */
"use client";

import type { Party } from "@prisma/client";
import type { Message, KaraokeParty } from "party/types";
import usePartySocket from "partysocket/react";
import { useEffect, useState } from "react";
import { env } from "~/env";
import { readLocalStorageValue, useLocalStorage } from "@mantine/hooks";
import { SongSearch } from "~/components/song-search";
import {
  ChevronDown,
  ChevronUp,
  ListMusic,
  Pause,
  Play,
  PlayCircle,
  X,
} from "lucide-react";
import type { PlaybackState } from "party/types";
import { moveInQueue, playNowInQueue } from "~/utils/playlist";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/ui/ui/accordion";
import { decode } from "html-entities";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export function PartyScene({
  party,
  initialPlaylist,
}: {
  party: Omit<Party, "hostKeyHash">;
  initialPlaylist?: KaraokeParty;
}) {
  const [name] = useLocalStorage<string>({ key: "name" });
  const router = useRouter();


  const [playlist, setPlaylist] = useState<KaraokeParty["playlist"]>(
    initialPlaylist?.playlist ?? [],
  );

  // What the player screen last reported about the song on screen.
  const [playback, setPlayback] = useState<PlaybackState | null>(null);

  useEffect(() => {
    const value = readLocalStorageValue({ key: "name" });

    if (!value) {
      router.push(`/join/${party.hash}`);
    }
  }, [router, party.hash]);

  const socket = usePartySocket({
    host: env.NEXT_PUBLIC_PARTYKIT_URL,
    party: "main",
    room: party.hash ?? "",
    // onOpen(_event) {
    //   if (name) {
    //     socket.send(
    //       JSON.stringify({
    //         type: "join",
    //         name,
    //       }),
    //     );
    //   }
    // },
    onMessage(event) {
      try {
        const eventData = JSON.parse(event.data);

        if (eventData.type === "party-deleted") {
          socket.close();
          toast.info("The host ended this party.");
          router.replace("/");
          return;
        }

        if (eventData.type === "playback") {
          setPlayback({
            id: String(eventData.id),
            playing: Boolean(eventData.playing),
          });
        }

        // If it's an array, it's the playlist update
        if (Array.isArray(eventData)) {
          setPlaylist(eventData);
        }
      } catch (error) {
        console.error("Error parsing message:", error);
      }
    },
  });

  const addSong = async (videoId: string, title: string, coverUrl: string) => {
    socket.send(
      JSON.stringify({
        type: "add-video",
        id: videoId,
        title,
        singerName: name,
        coverUrl,
      } satisfies Message),
    );
  };

  const removeSong = (videoId: string) => {
    // Show it gone right away; the server broadcast confirms it.
    setPlaylist((current) => current.filter((video) => video.id !== videoId));

    socket.send(
      JSON.stringify({
        type: "remove-video",
        id: videoId,
      } satisfies Message),
    );
  };

  /** Moves an upcoming song to `toIndex` in the queue (0 is the song playing now). */
  const moveSong = (videoId: string, toIndex: number) => {
    const reordered = moveInQueue(playlist, videoId, toIndex);

    if (reordered === playlist) return;

    setPlaylist(reordered);

    socket.send(
      JSON.stringify({
        type: "move-video",
        id: videoId,
        toIndex,
      } satisfies Message),
    );
  };

  const nextVideos = playlist.filter((video) => !video.playedAt);
  const nextVideo = nextVideos[0] ?? null;

  /** Stops the song on screen, drops it from the queue and plays `videoId` now. */
  const playNow = (videoId: string, title: string) => {
    const current = nextVideo;
    if (!current) return;

    if (
      !window.confirm(
        `Play "${title}" now?\n\nThis stops "${decode(current.title)}" and removes it from the queue.`,
      )
    ) {
      return;
    }

    const reordered = playNowInQueue(playlist, videoId);
    if (reordered === playlist) return;

    setPlaylist(reordered);

    // Built from messages the queue server already understands, so it works
    // without redeploying it: make the song next in line, then finish the
    // one on screen. The player screen moves on to the new song by itself.
    socket.send(
      JSON.stringify({
        type: "move-video",
        id: videoId,
        toIndex: 1,
      } satisfies Message),
    );
    socket.send(
      JSON.stringify({
        type: "mark-as-played",
        id: current.id,
      } satisfies Message),
    );
  };

  // Only trust the reported state if it is about the song on screen now.
  const knowsPlayback = !!nextVideo && playback?.id === nextVideo.id;
  const isPlaying = knowsPlayback && playback.playing;

  const togglePlayback = () => {
    if (!nextVideo) return;

    socket.send(
      JSON.stringify({
        type: "set-playback",
        id: nextVideo.id,
        // Without a report from the player screen yet, let it toggle
        // instead of guessing which state the song is in.
        ...(knowsPlayback ? { playing: !isPlaying } : {}),
      } satisfies Message),
    );
  };

  return (
    <>
      <div className="container mx-auto p-6 pb-16 text-center">
        <div>
          <h1 className="text-outline scroll-m-20 text-3xl font-extrabold tracking-tight lg:text-4xl">
            {party.name}
          </h1>
        </div>

        <div className="mt-5">
          <SongSearch onVideoAdded={addSong} playlist={playlist} />
        </div>
      </div>

      <div className="fixed bottom-0 z-50 flex w-full flex-row items-start gap-2 bg-primary p-2 text-primary-foreground text-white">
        <button
          type="button"
          aria-label={isPlaying ? "Pause" : "Play"}
          title={
            isPlaying ? "Pause the song on screen" : "Play the song on screen"
          }
          className="mt-2 shrink-0 rounded-full bg-white/15 p-2 hover:bg-white/30 disabled:opacity-30"
          disabled={!nextVideo}
          onClick={togglePlayback}
        >
          {isPlaying ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <Accordion
          type="single"
          collapsible
          className="max-h-screen min-w-0 grow"
        >
          <AccordionItem value="item-1" className="border-0">
            <AccordionTrigger disabled={nextVideos.length < 1}>
              <div className="flex min-w-0 flex-row text-left">
                <ListMusic className="mr-3 shrink-0" />
                <span className="truncate">
                  {nextVideo ? decode(nextVideo.title) : "Playlist is empty"}
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <ul className="max-h-[60vh] divide-y divide-accent-foreground overflow-y-auto">
                {nextVideos.map((video, i) => {
                  // The first one is on screen right now: it stays put.
                  const isPlaying = i === 0;

                  return (
                    <li
                      key={video.id}
                      className="flex flex-row items-center gap-2 p-2 text-left first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0 grow">
                        <div className="truncate">{decode(video.title)}</div>
                        <div className="truncate text-xs opacity-75">
                          {isPlaying ? "Now playing" : `#${i}`}
                          {video.singerName ? ` · ${video.singerName}` : ""}
                        </div>
                      </div>

                      {!isPlaying && (
                        <>
                          <button
                            type="button"
                            aria-label="Play now"
                            title="Play this song now"
                            className="rounded p-2 text-emerald-300 hover:bg-white/20"
                            onClick={() =>
                              playNow(video.id, decode(video.title))
                            }
                          >
                            <PlayCircle size={20} />
                          </button>
                          <button
                            type="button"
                            aria-label="Move up"
                            title="Move up one spot"
                            className="rounded p-2 hover:bg-white/20 disabled:opacity-30"
                            disabled={i <= 1}
                            onClick={() => moveSong(video.id, i - 1)}
                          >
                            <ChevronUp size={20} />
                          </button>
                          <button
                            type="button"
                            aria-label="Move down"
                            title="Move down one spot"
                            className="rounded p-2 hover:bg-white/20 disabled:opacity-30"
                            disabled={i >= nextVideos.length - 1}
                            onClick={() => moveSong(video.id, i + 1)}
                          >
                            <ChevronDown size={20} />
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        aria-label="Remove from queue"
                        title="Remove from queue"
                        className="rounded p-2 text-red-300 hover:bg-white/20"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Remove "${decode(video.title)}" from the queue?`,
                            )
                          ) {
                            removeSong(video.id);
                          }
                        }}
                      >
                        <X size={20} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </>
  );
}
