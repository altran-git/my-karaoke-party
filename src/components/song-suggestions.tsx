"use client";

import { decode } from "html-entities";
import { Check, Plus } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import type { SuggestedSong } from "~/server/suggestions";

type QueueItem = {
  id: string;
  title: string;
  playedAt: Date | string | null;
};

type AddSong = (videoId: string, title: string, coverUrl: string) => void;

/** How many recently sung songs the suggestions are based on. */
const RECENT_SONGS = 10;

/**
 * Suggestions from the saved playlists, based on what's been sung at this
 * party. Songs already played or waiting in the queue are left out.
 */
export function useSongSuggestions(
  playlist: QueueItem[],
  { enabled = true, count }: { enabled?: boolean; count: number },
) {
  const played = playlist
    .filter((v) => v.playedAt)
    .sort(
      (a, b) =>
        new Date(b.playedAt!).getTime() - new Date(a.playedAt!).getTime(),
    );

  const recentIds = [...new Set(played.map((v) => v.id))].slice(
    0,
    RECENT_SONGS,
  );

  const { data } = api.playlist.suggestions.useQuery(
    { recentIds },
    {
      enabled,
      // Saved playlists rarely change during a party.
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: false,
    },
  );

  const inParty = new Set(playlist.map((v) => v.id));
  const songs = (data ?? []).filter((s) => !inParty.has(s.id)).slice(0, count);

  // Name the last song sung if the suggestions grew out of it.
  const lastSong = played[0];
  const basedOnLast =
    !!lastSong && songs.some((s) => s.becauseOf === lastSong.id);

  return {
    songs,
    heading: songs.some((s) => s.reason === "related")
      ? basedOnLast
        ? `Because you sang ${decode(lastSong.title)}`
        : "Based on tonight's songs"
      : "Popular in your playlists",
  };
}

/** Songs clicked here, so they show a check until the queue catches up. */
function useJustAdded() {
  const [justAdded, setJustAdded] = useState<string[]>([]);
  return {
    has: (id: string) => justAdded.includes(id),
    add: (id: string) => setJustAdded((ids) => [...ids, id]),
  };
}

/** Grid of suggestions for the TV, in place of the empty player. */
export function TvSuggestions({
  songs,
  heading,
  onAdd,
}: {
  songs: SuggestedSong[];
  heading: string;
  onAdd: AddSong;
}) {
  const justAdded = useJustAdded();

  return (
    <div className="flex min-h-0 w-full grow flex-col">
      <div className="mb-3 text-center">
        <h2 className="text-outline text-2xl font-extrabold tracking-tight lg:text-3xl">
          Sing one of these next?
        </h2>
        <p className="truncate text-sm text-slate-300 lg:text-base">
          {heading}
        </p>
      </div>
      <div className="grid min-h-0 grow grid-cols-4 grid-rows-2 gap-3 lg:gap-5">
        {songs.map((song) => {
          const added = justAdded.has(song.id);
          const title = decode(song.title);

          return (
            <button
              key={song.id}
              type="button"
              title={`Add “${title}” to the queue`}
              disabled={added}
              onClick={() => {
                justAdded.add(song.id);
                onAdd(song.id, song.title, song.coverUrl);
              }}
              className="group relative min-h-0 overflow-hidden rounded-lg bg-black text-left ring-primary animate-in fade-in focus-visible:outline-none focus-visible:ring-4 hover:ring-4"
            >
              <Image
                src={song.coverUrl}
                alt=""
                fill
                unoptimized
                className="object-cover opacity-80 transition-opacity group-hover:opacity-100"
              />
              <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/90 to-transparent p-2 pb-6 lg:p-3 lg:pb-8">
                <p className="line-clamp-2 text-sm font-semibold leading-snug text-white lg:text-lg">
                  {title}
                </p>
              </div>
              <span
                className={cn(
                  "absolute bottom-2 right-2 rounded-full p-1.5 text-white shadow-lg lg:p-2",
                  added ? "bg-emerald-600" : "bg-primary",
                )}
              >
                {added ? <Check size={18} /> : <Plus size={18} />}
              </span>
              {song.duration && (
                <span className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 text-xs text-white lg:text-sm">
                  {song.duration}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** List of suggestions for a guest's phone. */
export function PhoneSuggestions({
  songs,
  heading,
  onAdd,
  className,
}: {
  songs: SuggestedSong[];
  heading: string;
  onAdd: AddSong;
  className?: string;
}) {
  const justAdded = useJustAdded();

  if (songs.length === 0) return null;

  return (
    <section className={cn("text-left", className)}>
      <h2 className="text-lg font-bold">Suggested songs</h2>
      <p className="mb-3 truncate text-sm opacity-75">{heading}</p>
      <ul className="flex flex-col gap-2">
        {songs.map((song) => {
          const added = justAdded.has(song.id);
          const title = decode(song.title);

          return (
            <li
              key={song.id}
              className="flex flex-row items-center gap-3 rounded-lg bg-black/30 p-2 animate-in fade-in"
            >
              <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded">
                <Image
                  src={song.coverUrl}
                  alt=""
                  fill
                  unoptimized
                  className="object-cover"
                />
              </div>
              <div className="line-clamp-2 min-w-0 grow break-words text-sm leading-snug">
                {title}
              </div>
              <button
                type="button"
                aria-label={added ? "Added" : `Add ${title}`}
                disabled={added}
                onClick={() => {
                  justAdded.add(song.id);
                  onAdd(song.id, song.title, song.coverUrl);
                }}
                className={cn(
                  "shrink-0 rounded-full p-2 text-white",
                  added ? "bg-emerald-600" : "bg-primary hover:opacity-90",
                )}
              >
                {added ? <Check size={20} /> : <Plus size={20} />}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
