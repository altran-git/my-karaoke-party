/* eslint-disable */
"use client";

import {
  readLocalStorageValue,
  useFullscreen,
  useHotkeys,
} from "@mantine/hooks";
import type { Party } from "@prisma/client";
import { decode } from "html-entities";
import {
  ChevronLeft,
  ChevronRight,
  ListMusic,
  ListPlus,
  Maximize,
  Minimize,
  MoveDown,
  ListStart,
  Save,
  SkipForward,
  X,
} from "lucide-react";
import Image from "next/image";
import type { AddSongsTo, Message, KaraokeParty } from "party/types";
import usePartySocket from "partysocket/react";
import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { EmptyPlayer } from "~/components/empty-player";
import { Player } from "~/components/player";
import { SongSearch } from "~/components/song-search";
import { Button } from "~/components/ui/ui/button";
import { env } from "~/env";
import { cn } from "~/lib/utils";
import { moveInQueue } from "~/utils/playlist";
import { getUrl } from "~/utils/url";
import { forgetParty, getHostKey, rememberParty } from "~/utils/recent-parties";
import {
  HostCodeDialog,
  LoadPlaylistDialog,
  SavePlaylistDialog,
  UnlockHostDialog,
} from "~/components/playlist-dialogs";

type Props = {
  party: Omit<Party, "hostKeyHash">;
  initialPlaylist: KaraokeParty;
  /**
   * True when the host reopened this party from "Rejoin a party": the song
   * on screen then waits for the host to press play instead of starting.
   */
  rejoined?: boolean;
};

export default function PlayerScene({
  party,
  initialPlaylist,
  rejoined = false,
}: Props) {
  const [playlist, setPlaylist] = useState<KaraokeParty["playlist"]>(
    initialPlaylist.playlist ?? [],
  );

  const [addSongsTo, setAddSongsTo] = useState<AddSongsTo>(
    initialPlaylist.settings?.addSongsTo ?? "end",
  );

  // Ids of the song being dragged and of the slot it is hovering over, so the
  // strip can show where it would land.
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // The host PIN proves this browser hosts the party, which loading a
  // playlist needs. The browser that created the party has it; any other
  // browser gets it by typing the PIN.
  const [hostKey, setHostKey] = useState<string | undefined>();
  const [saveOpen, setSaveOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [hostCodeOpen, setHostCodeOpen] = useState(false);

  // Remember this party in this browser so the host can come back to it from
  // the start page.
  useEffect(() => {
    if (party.hash) {
      rememberParty({ hash: party.hash, name: party.name });
      setHostKey(getHostKey(party.hash));
    }
  }, [party.hash, party.name]);

  const togglePlayPauseRef = useRef<(() => void) | null>(null);
  const setPlayingRef = useRef<((playing?: boolean) => void) | null>(null);
  // Id of the song on screen, read from inside the socket message handler.
  const currentVideoIdRef = useRef<string | null>(null);

  const socket = usePartySocket({
    host: env.NEXT_PUBLIC_PARTYKIT_URL,
    party: "main",
    room: party.hash ?? "",
    onMessage(event) {
      // TODO: Improve type safety
      const eventData = JSON.parse(event.data);
      console.log(eventData);

      if (eventData.type === "party-deleted") {
        // The host deleted this party (maybe from another tab or device).
        if (party.hash) forgetParty(party.hash);
        socket.close();
        window.location.replace("/");
        return;
      }

      if (eventData.type === "playback-command") {
        // A guest pressed play/pause on their phone. Ignore it if the song
        // they were looking at is no longer the one on screen.
        if (eventData.id === currentVideoIdRef.current) {
          setPlayingRef.current?.(
            typeof eventData.playing === "boolean"
              ? eventData.playing
              : undefined,
          );
        }
      }

      if (eventData.type === "settings") {
        setAddSongsTo(eventData.settings?.addSongsTo === "top" ? "top" : "end");
      }

      if (Array.isArray(eventData)) {
        setPlaylist(eventData as KaraokeParty["playlist"]);
      }
    },
  });

  const { ref, toggle, fullscreen } = useFullscreen();

  const currentVideo = playlist.find((video) => !video.playedAt);
  const nextVideos = playlist.filter((video) => !video.playedAt);
  currentVideoIdRef.current = currentVideo?.id ?? null;

  // On rejoin, the song that was on screen when the page opened waits for
  // play. Songs after it start on their own as usual.
  const [rejoinVideoId] = useState<string | null>(() =>
    rejoined
      ? (initialPlaylist.playlist?.find((v) => !v.playedAt)?.id ?? null)
      : null,
  );

  const addSong = (videoId: string, title: string, coverUrl: string) => {
    const singerName = readLocalStorageValue({
      key: "name",
      defaultValue: "Host",
    });

    socket.send(
      JSON.stringify({
        type: "add-video",
        id: videoId,
        title,
        singerName,
        coverUrl,
      } satisfies Message),
    );
  };

  const removeSong = (videoId: string) => {
    socket.send(
      JSON.stringify({
        type: "remove-video",
        id: videoId,
      } satisfies Message),
    );
  };

  /** Tells guests' phones whether the song on screen is playing. */
  const reportPlayback = (videoId: string, playing: boolean) => {
    socket.send(
      JSON.stringify({
        type: "report-playback",
        id: videoId,
        playing,
      } satisfies Message),
    );
  };

  const markAsPlayed = () => {
    if (currentVideo) {
      // setShowOpenInYouTubeButton(false);

      socket.send(
        JSON.stringify({
          type: "mark-as-played",
          id: currentVideo.id,
        } satisfies Message),
      );
    }
  };

  const postponeSong = () => {
    if (currentVideo) {
      socket.send(
        JSON.stringify({
          type: "postpone-video",
          id: currentVideo.id,
        } satisfies Message),
      );
    }
  };

  /** Moves an upcoming song to `toIndex` in the queue (0 is the song playing now). */
  const moveSong = (videoId: string, toIndex: number) => {
    const reordered = moveInQueue(playlist, videoId, toIndex);

    if (reordered === playlist) return;

    // Show the new order right away; the server broadcast confirms it.
    setPlaylist(reordered);

    socket.send(
      JSON.stringify({
        type: "move-video",
        id: videoId,
        toIndex,
      } satisfies Message),
    );
  };

  const toggleAddSongsTo = () => {
    const mode = addSongsTo === "top" ? "end" : "top";

    setAddSongsTo(mode);

    socket.send(
      JSON.stringify({
        type: "set-add-songs-to",
        mode,
      } satisfies Message),
    );

    toast.info(
      mode === "top"
        ? "Top - new songs play next."
        : "Default - new songs go to the end of the queue.",
    );
  };

  // Add keyboard shortcuts
  // f - fullscreen toggle, space - play/pause, right arrow - skip video
  useHotkeys([
    ["f", toggle],
    ["Space", () => togglePlayPauseRef.current?.()],
    [
      "ArrowRight",
      () => {
        if (currentVideo) {
          markAsPlayed();
        }
      },
    ],
  ]);

  const joinPartyUrl = getUrl(`/join/${party.hash}`);

  return (
    <div className="flex h-screen w-full flex-row flex-nowrap">
      <div className="grow-0 basis-1/3 overflow-y-auto border-r border-slate-500 px-4">
        <div className="py-4 text-center">
          <h1 className="text-outline scroll-m-20 text-3xl font-extrabold tracking-tight lg:text-4xl">
            {party.name}
          </h1>
          <p className="mt-1 text-sm text-slate-300">
            Party code:{" "}
            <span className="select-all font-mono text-base text-white">
              {party.hash}
            </span>
          </p>
          {party.hash && (
            <>
              <div className="mt-3 flex justify-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    hostKey ? setLoadOpen(true) : setUnlockOpen(true)
                  }
                >
                  <ListMusic className="mr-2 h-4 w-4" />
                  Load playlist
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  title="Save the songs sung so far and the queue as a playlist"
                  onClick={() => setSaveOpen(true)}
                >
                  <Save className="mr-2 h-4 w-4" />
                  Save as playlist
                </Button>
              </div>
              {hostKey && (
                <button
                  type="button"
                  className="text-xs mt-2 text-slate-300 underline-offset-4 hover:underline"
                  onClick={() => setHostCodeOpen(true)}
                >
                  {/^\d{4}$/.test(hostKey) ? "Host PIN" : "Host code"}
                </button>
              )}
              {hostKey && (
                <>
                  <LoadPlaylistDialog
                    open={loadOpen}
                    onOpenChange={setLoadOpen}
                    partyHash={party.hash}
                    hostKey={hostKey}
                  />
                  <HostCodeDialog
                    open={hostCodeOpen}
                    onOpenChange={setHostCodeOpen}
                    hostKey={hostKey}
                  />
                </>
              )}
              <UnlockHostDialog
                open={unlockOpen}
                onOpenChange={setUnlockOpen}
                partyHash={party.hash}
                partyName={party.name}
                onUnlocked={(key) => {
                  setHostKey(key);
                  setUnlockOpen(false);
                  setLoadOpen(true);
                }}
              />
              <SavePlaylistDialog
                open={saveOpen}
                onOpenChange={setSaveOpen}
                partyHash={party.hash}
                hostKey={hostKey}
                defaultName={`${party.name} ${new Date().toLocaleDateString()}`}
              />
            </>
          )}
        </div>
        <SongSearch
          key={party.hash}
          playlist={playlist}
          onVideoAdded={addSong}
        />
      </div>
      <div className="grow-0 basis-2/3 overflow-auto">
        <div className="flex h-full flex-col">
          <div className="relative h-5/6" ref={ref}>
            <Button
              onClick={toggle}
              variant="ghost"
              size="icon"
              className="absolute bottom-0 right-3 z-10"
            >
              {fullscreen ? <Minimize /> : <Maximize />}
            </Button>
            {currentVideo ? (
              <Player
                key={currentVideo.id}
                video={
                  currentVideo.id === rejoinVideoId
                    ? { ...currentVideo, waitForPlay: true }
                    : currentVideo
                }
                nextVideo={nextVideos[1]}
                joinPartyUrl={joinPartyUrl}
                isFullscreen={fullscreen}
                onPlayerEnd={() => {
                  markAsPlayed();
                }}
                onTogglePlayPauseRef={togglePlayPauseRef}
                onSetPlayingRef={setPlayingRef}
                onPlayingChange={(playing) =>
                  reportPlayback(currentVideo.id, playing)
                }
              />
            ) : (
              <EmptyPlayer
                joinPartyUrl={joinPartyUrl}
                className={fullscreen ? "bg-gradient" : ""}
              />
            )}
          </div>
          <div className="flex h-1/6 min-h-[150px] flex-row space-x-3 border-t border-slate-500 p-4">
            <div className="flex shrink-0 flex-col items-center justify-center">
              <Button
                variant="ghost"
                size="icon"
                title={
                  addSongsTo === "top"
                    ? "Top - new songs play next. Click to add them to the end instead"
                    : "Default - new songs go to the end. Click to have them play next instead"
                }
                onClick={toggleAddSongsTo}
              >
                <ListStart
                  className={
                    addSongsTo === "top" ? "text-emerald-400" : "text-slate-400"
                  }
                />
              </Button>
              <span className="text-[10px] uppercase tracking-wide text-slate-400">
                {addSongsTo === "top" ? "Top" : "Default"}
              </span>
            </div>
            {nextVideos.length > 0 ? (
              <>
                <div className="no-scrollbar flex h-full grow flex-row space-x-2 overflow-x-scroll">
                  {nextVideos.map((v, i) => {
                    // The first one is on screen right now: it stays put.
                    const isPlaying = i === 0;
                    const isDragging = draggedId === v.id;

                    return (
                      <div
                        key={v.id}
                        title={decode(v.title)}
                        draggable={!isPlaying}
                        onDragStart={(e) => {
                          // Firefox only starts a drag once some data is set.
                          e.dataTransfer.setData("text/plain", v.id);
                          e.dataTransfer.effectAllowed = "move";
                          setDraggedId(v.id);
                        }}
                        onDragEnd={() => {
                          setDraggedId(null);
                          setDragOverIndex(null);
                        }}
                        onDragOver={(e) => {
                          if (!draggedId || isPlaying) return;

                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          setDragOverIndex(i);
                        }}
                        onDragLeave={() => {
                          setDragOverIndex((current) =>
                            current === i ? null : current,
                          );
                        }}
                        onDrop={(e) => {
                          e.preventDefault();

                          if (draggedId && !isPlaying) {
                            moveSong(draggedId, i);
                          }

                          setDraggedId(null);
                          setDragOverIndex(null);
                        }}
                        className={cn(
                          "relative flex aspect-[4/3] h-full items-center justify-center rounded-lg bg-slate-200 p-3 text-center text-primary-foreground animate-in slide-in-from-bottom first:border-2 first:border-amber-500",
                          !isPlaying && "cursor-grab active:cursor-grabbing",
                          isDragging && "opacity-40",
                          dragOverIndex === i &&
                            !isDragging &&
                            "ring-2 ring-amber-400",
                        )}
                      >
                        <Image
                          src={v.coverUrl}
                          fill={true}
                          className="pointer-events-none rounded-lg hover:opacity-50"
                          alt="Cover"
                        />

                        <Button
                          variant="link"
                          size="icon"
                          className="absolute right-0 top-0 z-10 hover:bg-gray-400"
                          onClick={() => {
                            removeSong(v.id);
                          }}
                        >
                          <X color="red" />
                        </Button>

                        {isPlaying && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute bottom-0 right-0 z-10 rounded text-yellow-300 hover:bg-gray-400"
                            onClick={() => {
                              markAsPlayed();
                            }}
                          >
                            <SkipForward />
                          </Button>
                        )}

                        {isPlaying && nextVideos.length > 1 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute bottom-0 left-0 z-10 rounded text-yellow-300 hover:bg-gray-400"
                            title="Postpone (move back one spot)"
                            onClick={() => {
                              postponeSong();
                            }}
                          >
                            <MoveDown />
                          </Button>
                        )}

                        {!isPlaying && i > 1 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute bottom-0 left-0 z-10 rounded text-yellow-300 hover:bg-gray-400"
                            title="Move up one spot"
                            onClick={() => {
                              moveSong(v.id, i - 1);
                            }}
                          >
                            <ChevronLeft />
                          </Button>
                        )}

                        {!isPlaying && i < nextVideos.length - 1 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute bottom-0 right-0 z-10 rounded text-yellow-300 hover:bg-gray-400"
                            title="Move back one spot"
                            onClick={() => {
                              moveSong(v.id, i + 1);
                            }}
                          >
                            <ChevronRight />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="flex aspect-[4/3] h-full items-center justify-center rounded-lg border-2 border-dashed border-slate-500 bg-slate-200 p-3 text-center text-slate-500">
                <ListPlus
                  size={32}
                  strokeWidth={1.5}
                  className="animate-bounce"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
