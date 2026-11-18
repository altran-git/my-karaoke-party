"use client";

import { decode } from "html-entities";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  GripVertical,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  DeletePlaylistDialog,
  playlistUrl,
} from "~/components/playlist-dialogs";
import { SongSearch } from "~/components/song-search";
import { Button } from "~/components/ui/ui/button";
import { Input } from "~/components/ui/ui/input";
import { cn } from "~/lib/utils";
import { playlistFileName, toPlaylistFile } from "~/utils/playlist-file";
import type { RouterOutputs } from "~/trpc/react";
import { api } from "~/trpc/react";

type Playlist = NonNullable<RouterOutputs["playlist"]["get"]>;

/**
 * A saved playlist. Anyone with the link can add songs (by searching),
 * remove songs, rename it or delete it.
 */
export default function PlaylistScene({
  playlist: initial,
}: {
  playlist: Playlist;
}) {
  const router = useRouter();
  const utils = api.useUtils();

  // Kept fresh after every change, and when someone else edits it too.
  const { data } = api.playlist.get.useQuery(
    { hash: initial.hash },
    { initialData: initial },
  );
  const playlist = data ?? initial;
  const songs = playlist.songs;

  const [deleteOpen, setDeleteOpen] = useState(false);
  // Songs being removed right now, hidden at once.
  const [removing, setRemoving] = useState<Set<number>>(new Set());

  const refresh = () => utils.playlist.get.invalidate({ hash: initial.hash });

  const addSong = api.playlist.addSong.useMutation({
    onSuccess: (_data, { song }) => {
      toast.success(`Added “${decode(song.title)}”.`);
    },
    onError: (err) => toast.error(err.message),
    onSettled: () => void refresh(),
  });

  const removeSong = api.playlist.removeSong.useMutation({
    onError: (err) => toast.error(err.message),
    onSettled: async (_data, _err, { songId }) => {
      await refresh();
      setRemoving((current) => {
        const next = new Set(current);
        next.delete(songId);
        return next;
      });
    },
  });

  const visibleSongs = songs.filter((song) => !removing.has(song.songId));

  // The song being dragged, and the slot it's hovering over.
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const moveMutation = api.playlist.moveSong.useMutation({
    onError: (err) => toast.error(err.message),
    onSettled: () => void refresh(),
  });

  /** Moves a song to visible position `toVisible`, showing it right away. */
  function moveSong(songId: number, toVisible: number) {
    const target = visibleSongs[toVisible];
    if (!target || target.songId === songId) return;

    // Positions on the server count every song, so aim for the slot where
    // the song now at `toVisible` sits in the full list.
    const from = songs.findIndex((song) => song.songId === songId);
    const to = songs.findIndex((song) => song.songId === target.songId);
    if (from === -1 || to === -1) return;

    const reordered = [...songs];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved!);
    utils.playlist.get.setData({ hash: initial.hash }, (current) =>
      current ? { ...current, songs: reordered } : current,
    );

    moveMutation.mutate({ hash: playlist.hash, songId, toIndex: to });
  }

  return (
    <main className="mx-auto grid min-h-[100dvh] w-full max-w-7xl grid-cols-1 gap-6 px-4 py-8 text-white md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:grid-cols-[minmax(0,3fr)_minmax(0,4fr)_minmax(0,2.5fr)]">
      {/* Wide screens: search | playlist | manage. Medium: search on the
          left, playlist and manage on the right. Phones: playlist, manage,
          then search. The side columns stay in view while the page scrolls. */}
      <aside className="order-3 self-start md:sticky md:top-8 md:order-none md:col-start-1 md:row-span-2 md:row-start-1 md:max-h-[calc(100dvh-4rem)] md:overflow-y-auto">
        <section className="flex flex-col gap-3 rounded-lg border border-white/20 bg-black/30 p-4">
          <h2 className="text-lg flex items-center gap-2 font-bold">
            Add songs
            {addSong.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          </h2>
          <SongSearch
            playlist={songs.map((song) => ({ id: song.id }))}
            onVideoAdded={(id, title, coverUrl) =>
              addSong.mutate({
                hash: playlist.hash,
                song: { id, title: title.trim(), coverUrl },
              })
            }
          />
        </section>
      </aside>

      <div className="order-1 flex min-w-0 flex-col gap-6 md:order-none md:col-start-2 md:row-start-1">
        <header className="flex flex-col gap-2">
          <Link href="/" className="text-sm opacity-70 hover:underline">
            ← My Karaoke Party
          </Link>
          <h1 className="text-outline text-3xl font-extrabold tracking-tight">
            {playlist.name}
          </h1>
          <div className="flex items-center gap-3 text-sm opacity-80">
            <span>
              {visibleSongs.length}{" "}
              {visibleSongs.length === 1 ? "song" : "songs"}
            </span>
            <CopyLinkButton url={playlistUrl(playlist.hash)} />
          </div>
        </header>

        <section>
          <ol className="flex flex-col gap-2">
            {visibleSongs.map((song, i) => (
              <li
                key={song.songId}
                draggable
                onDragStart={(e) => {
                  // Firefox only starts a drag once some data is set.
                  e.dataTransfer.setData("text/plain", String(song.songId));
                  e.dataTransfer.effectAllowed = "move";
                  setDraggedId(song.songId);
                }}
                onDragEnd={() => {
                  setDraggedId(null);
                  setDragOverIndex(null);
                }}
                onDragOver={(e) => {
                  if (draggedId === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOverIndex(i);
                }}
                onDragLeave={() =>
                  setDragOverIndex((current) =>
                    current === i ? null : current,
                  )
                }
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggedId !== null) moveSong(draggedId, i);
                  setDraggedId(null);
                  setDragOverIndex(null);
                }}
                className={cn(
                  "flex cursor-grab items-center gap-3 rounded-md bg-black/20 p-2 active:cursor-grabbing",
                  draggedId === song.songId && "opacity-40",
                  dragOverIndex === i &&
                    draggedId !== song.songId &&
                    "ring-2 ring-amber-400",
                )}
              >
                <GripVertical
                  aria-hidden
                  className="h-4 w-4 shrink-0 opacity-40"
                />
                <span className="w-6 shrink-0 text-right text-sm opacity-60">
                  {i + 1}
                </span>
                <Image
                  src={song.coverUrl}
                  alt=""
                  width={80}
                  height={45}
                  draggable={false}
                  className="shrink-0 rounded object-cover"
                />
                <span className="min-w-0 flex-1 truncate">
                  {decode(song.title)}
                </span>
                {song.duration && (
                  <span className="shrink-0 text-sm opacity-60">
                    {song.duration}
                  </span>
                )}
                <div className="flex shrink-0 flex-col">
                  <button
                    type="button"
                    aria-label={`Move ${decode(song.title)} up`}
                    title="Move up"
                    disabled={i === 0}
                    onClick={() => moveSong(song.songId, i - 1)}
                    className="rounded p-0.5 opacity-70 hover:bg-white/10 hover:opacity-100 disabled:opacity-20"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${decode(song.title)} down`}
                    title="Move down"
                    disabled={i === visibleSongs.length - 1}
                    onClick={() => moveSong(song.songId, i + 1)}
                    className="rounded p-0.5 opacity-70 hover:bg-white/10 hover:opacity-100 disabled:opacity-20"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${decode(song.title)}`}
                  title="Remove from this playlist"
                  className="h-8 w-8 shrink-0 text-red-300 hover:text-red-200"
                  onClick={() => {
                    setRemoving((current) => new Set(current).add(song.songId));
                    removeSong.mutate({
                      hash: playlist.hash,
                      songId: song.songId,
                    });
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ol>
          {visibleSongs.length === 0 && (
            <p className="text-sm opacity-80">
              This playlist has no songs yet. Search for songs to add some.
            </p>
          )}
        </section>
      </div>

      <aside className="order-2 self-start md:order-none md:col-start-2 md:row-start-2 lg:sticky lg:top-8 lg:col-start-3 lg:row-span-2 lg:row-start-1">
        <ManagePanel
          hash={playlist.hash}
          name={playlist.name}
          stats={playlist}
          onExport={() => {
            // Built here from what's on screen: no server call needed.
            const blob = new Blob(
              [toPlaylistFile(playlist.name, visibleSongs)],
              { type: "application/json" },
            );
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = playlistFileName(playlist.name);
            link.click();
            URL.revokeObjectURL(url);
          }}
          onRenamed={() => void refresh()}
          onDelete={() => setDeleteOpen(true)}
        />
        <DeletePlaylistDialog
          playlist={
            deleteOpen ? { hash: playlist.hash, name: playlist.name } : null
          }
          onOpenChange={setDeleteOpen}
          onDeleted={() => router.replace("/")}
        />
      </aside>
    </main>
  );
}

function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="flex items-center gap-1 underline-offset-4 hover:underline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Couldn't copy the link.");
        }
      }}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}

/** Rename and delete. Anyone can do both. */
/** Like "Nov 18, 9:00 AM", with the year only when it isn't this year. */
function formatDate(date: Date | string | null | undefined) {
  if (!date) return "Never";
  const d = new Date(date);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Rename, delete and some numbers about the playlist. */
function ManagePanel({
  hash,
  name,
  stats,
  onRenamed,
  onDelete,
  onExport,
}: {
  hash: string;
  name: string;
  stats: Pick<
    Playlist,
    | "loadCount"
    | "lastLoadedAt"
    | "lastLoadedParty"
    | "lastLoadedPartyName"
    | "updatedAt"
    | "createdAt"
  >;
  onRenamed: (name: string) => void;
  onDelete: () => void;
  onExport: () => void;
}) {
  const rows: [string, string][] = [
    [
      "Loaded",
      `${stats.loadCount} ${stats.loadCount === 1 ? "time" : "times"}`,
    ],
    ["Last loaded", formatDate(stats.lastLoadedAt)],
    // Loads from before party names were kept only have the code.
    [
      "Last party",
      stats.lastLoadedPartyName ?? stats.lastLoadedParty ?? "None yet",
    ],
    ["Last modified", formatDate(stats.updatedAt)],
    ["Created", formatDate(stats.createdAt)],
  ];

  const [newName, setNewName] = useState(name);

  const update = api.playlist.update.useMutation({
    onSuccess: (_data, { name }) => {
      if (name) onRenamed(name);
      toast.success("Playlist renamed.");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-white/20 bg-black/30 p-4">
      <h2 className="text-lg font-bold">Manage playlist</h2>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="opacity-70">{label}</dt>
            {/* Dates are shown in the viewer's time zone, which the server
                can't know, so the first render may differ from the server's. */}
            <dd suppressHydrationWarning className="break-words">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate({ hash, name: newName });
        }}
      >
        <Input
          aria-label="Playlist name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          maxLength={100}
          required
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={
            update.isPending || !newName.trim() || newName.trim() === name
          }
        >
          Rename
        </Button>
      </form>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          title="Download the playlist's name and songs as a file, to keep or load into a party later"
          onClick={onExport}
        >
          <Download className="mr-2 h-4 w-4" />
          Export JSON
        </Button>
        <Button variant="destructive" onClick={onDelete}>
          <Trash2 className="mr-2 h-4 w-4" />
          Delete playlist
        </Button>
      </div>
    </section>
  );
}
