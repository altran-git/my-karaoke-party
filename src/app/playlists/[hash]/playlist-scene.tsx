"use client";

import { decode } from "html-entities";
import { Check, Copy, Loader2, Trash2, X } from "lucide-react";
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

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col gap-6 px-4 py-8 text-white">
      <header className="flex flex-col gap-2">
        <Link href="/" className="text-sm opacity-70 hover:underline">
          ← My Karaoke Party
        </Link>
        <h1 className="text-outline text-3xl font-extrabold tracking-tight">
          {playlist.name}
        </h1>
        <div className="flex items-center gap-3 text-sm opacity-80">
          <span>
            {visibleSongs.length} {visibleSongs.length === 1 ? "song" : "songs"}
          </span>
          <CopyLinkButton url={playlistUrl(playlist.hash)} />
        </div>
      </header>

      <section>
        <ol className="flex flex-col gap-2">
          {visibleSongs.map((song, i) => (
            <li
              key={song.songId}
              className="flex items-center gap-3 rounded-md bg-black/20 p-2"
            >
              <span className="w-6 shrink-0 text-right text-sm opacity-60">
                {i + 1}
              </span>
              <Image
                src={song.coverUrl}
                alt=""
                width={80}
                height={45}
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
            This playlist has no songs yet. Search below to add some.
          </p>
        )}
      </section>

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

      <ManagePanel
        hash={playlist.hash}
        name={playlist.name}
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
function ManagePanel({
  hash,
  name,
  onRenamed,
  onDelete,
}: {
  hash: string;
  name: string;
  onRenamed: (name: string) => void;
  onDelete: () => void;
}) {
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

      <Button variant="destructive" className="self-start" onClick={onDelete}>
        <Trash2 className="mr-2 h-4 w-4" />
        Delete playlist
      </Button>
    </section>
  );
}
