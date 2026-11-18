"use client";

import { decode } from "html-entities";
import { Check, Copy, Loader2, Trash2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LoadMode } from "party/types";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DeletePlaylistDialog,
  LoadOptions,
  playlistUrl,
} from "~/components/playlist-dialogs";
import { Button } from "~/components/ui/ui/button";
import { Input } from "~/components/ui/ui/input";
import type { RouterOutputs } from "~/trpc/react";
import { api } from "~/trpc/react";
import { getRecentParties, type RecentParty } from "~/utils/recent-parties";

type Playlist = NonNullable<RouterOutputs["playlist"]["get"]>;

export default function PlaylistScene({ playlist }: { playlist: Playlist }) {
  const router = useRouter();

  const [name, setName] = useState(playlist.name);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Parties this browser hosts (has the key for), to load the songs into.
  const [parties, setParties] = useState<RecentParty[]>([]);
  const [partyHash, setPartyHash] = useState("");
  const [mode, setMode] = useState<LoadMode>("append");
  const [shuffle, setShuffle] = useState(false);

  // localStorage is only readable in the browser, after hydration.
  useEffect(() => {
    const hosted = getRecentParties().filter((p) => p.hostKey);
    setParties(hosted);
    setPartyHash(hosted[0]?.hash ?? "");
  }, []);

  const load = api.playlist.loadIntoParty.useMutation({
    onSuccess: ({ added, skipped }) => {
      toast.success(
        `Added ${added} ${added === 1 ? "song" : "songs"} to the queue` +
          (skipped > 0 ? ` (${skipped} already queued)` : "") +
          ".",
        {
          action: {
            label: "Open player",
            onClick: () => router.push(`/player/${partyHash}`),
          },
        },
      );
    },
    onError: (err) => toast.error(err.message),
  });

  const selectedParty = parties.find((p) => p.hash === partyHash);

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col gap-6 px-4 py-8 text-white">
      <header className="flex flex-col gap-2">
        <Link href="/" className="text-sm opacity-70 hover:underline">
          ← My Karaoke Party
        </Link>
        <h1 className="text-outline text-3xl font-extrabold tracking-tight">
          {name}
        </h1>
        <div className="flex items-center gap-3 text-sm opacity-80">
          <span>
            {playlist.songs.length}{" "}
            {playlist.songs.length === 1 ? "song" : "songs"}
          </span>
          <CopyLinkButton url={playlistUrl(playlist.hash)} />
        </div>
      </header>

      <section className="flex flex-col gap-3 rounded-lg border border-white/20 bg-black/30 p-4">
        <h2 className="text-lg font-bold">Load into my party</h2>
        {parties.length > 0 ? (
          <>
            <label className="flex flex-col gap-1 text-sm">
              Party
              <select
                value={partyHash}
                onChange={(e) => setPartyHash(e.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-foreground"
              >
                {parties.map((p) => (
                  <option key={p.hash} value={p.hash}>
                    {`${p.name} (${p.hash})`}
                  </option>
                ))}
              </select>
            </label>
            <LoadOptions
              mode={mode}
              onModeChange={setMode}
              shuffle={shuffle}
              onShuffleChange={setShuffle}
            />
            <Button
              className="self-start"
              disabled={
                !selectedParty?.hostKey ||
                load.isPending ||
                playlist.songs.length === 0
              }
              onClick={() =>
                selectedParty?.hostKey &&
                load.mutate({
                  partyHash: selectedParty.hash,
                  hostKey: selectedParty.hostKey,
                  playlistHash: playlist.hash,
                  mode,
                  shuffle,
                })
              }
            >
              {load.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Load songs
            </Button>
          </>
        ) : (
          <p className="text-sm opacity-80">
            No party is hosted in this browser yet.{" "}
            <Link href="/" className="underline">
              Start a party
            </Link>{" "}
            and come back to this link, or open your party&apos;s player screen
            and use <span className="font-semibold">Load playlist</span>. It
            asks for the host PIN if this browser didn&apos;t create the party.
          </p>
        )}
      </section>

      <section>
        <ol className="flex flex-col gap-2">
          {playlist.songs.map((song, i) => (
            <li
              key={`${song.id}-${i}`}
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
            </li>
          ))}
        </ol>
        {playlist.songs.length === 0 && (
          <p className="text-sm opacity-80">This playlist has no songs yet.</p>
        )}
      </section>

      <ManagePanel
        hash={playlist.hash}
        name={name}
        onRenamed={setName}
        onDelete={() => setDeleteOpen(true)}
      />
      <DeletePlaylistDialog
        playlist={deleteOpen ? { hash: playlist.hash, name } : null}
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
