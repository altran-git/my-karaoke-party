"use client";

import { decode } from "html-entities";
import { Check, Copy, KeyRound, Loader2, Trash2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LoadMode } from "party/types";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LoadOptions, playlistUrl } from "~/components/playlist-dialogs";
import { Button } from "~/components/ui/ui/button";
import { Input } from "~/components/ui/ui/input";
import type { RouterOutputs } from "~/trpc/react";
import { api } from "~/trpc/react";
import { getRecentParties, type RecentParty } from "~/utils/recent-parties";
import {
  forgetPlaylist,
  getSavedPlaylist,
  rememberPlaylist,
} from "~/utils/saved-playlists";

type Playlist = NonNullable<RouterOutputs["playlist"]["get"]>;

export default function PlaylistScene({ playlist }: { playlist: Playlist }) {
  const router = useRouter();

  const [name, setName] = useState(playlist.name);
  const [recoveryCode, setRecoveryCode] = useState<string | undefined>();

  // Parties this browser hosts (has the key for), to load the songs into.
  const [parties, setParties] = useState<RecentParty[]>([]);
  const [partyHash, setPartyHash] = useState("");
  const [mode, setMode] = useState<LoadMode>("append");
  const [shuffle, setShuffle] = useState(false);

  // localStorage is only readable in the browser, after hydration.
  useEffect(() => {
    // Opening the link adds the playlist to this browser's list, so the
    // player screen's "Load playlist" offers it.
    rememberPlaylist({ hash: playlist.hash, name: playlist.name });
    setRecoveryCode(getSavedPlaylist(playlist.hash)?.recoveryCode);

    const hosted = getRecentParties().filter((p) => p.hostKey);
    setParties(hosted);
    setPartyHash(hosted[0]?.hash ?? "");
  }, [playlist.hash, playlist.name]);

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
            You need to be hosting a party in this browser.{" "}
            <Link href="/" className="underline">
              Start a party
            </Link>
            , then come back to this link, or use{" "}
            <span className="font-semibold">Load playlist</span> on the player
            screen.
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

      {recoveryCode ? (
        <OwnerPanel
          hash={playlist.hash}
          name={name}
          recoveryCode={recoveryCode}
          onRenamed={setName}
          onDeleted={() => {
            forgetPlaylist(playlist.hash);
            router.replace("/");
          }}
        />
      ) : (
        <UnlockPanel
          hash={playlist.hash}
          onUnlocked={(code) => {
            rememberPlaylist({ hash: playlist.hash, name, recoveryCode: code });
            setRecoveryCode(code);
          }}
        />
      )}
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

/** Rename and delete, for a browser that holds the recovery code. */
function OwnerPanel({
  hash,
  name,
  recoveryCode,
  onRenamed,
  onDeleted,
}: {
  hash: string;
  name: string;
  recoveryCode: string;
  onRenamed: (name: string) => void;
  onDeleted: () => void;
}) {
  const [newName, setNewName] = useState(name);
  const [showCode, setShowCode] = useState(false);

  const update = api.playlist.update.useMutation({
    onSuccess: (_data, { name }) => {
      if (name) {
        onRenamed(name);
        rememberPlaylist({ hash, name });
      }
      toast.success("Playlist renamed.");
    },
    onError: (err) => toast.error(err.message),
  });

  const remove = api.playlist.delete.useMutation({
    onSuccess: onDeleted,
    onError: (err) => toast.error(err.message),
  });

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-white/20 bg-black/30 p-4">
      <h2 className="text-lg font-bold">You own this playlist</h2>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate({ hash, recoveryCode, name: newName });
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

      <div className="text-sm">
        {showCode ? (
          <span>
            Recovery code:{" "}
            <span className="select-all font-mono tracking-wider">
              {recoveryCode}
            </span>
          </span>
        ) : (
          <button
            type="button"
            className="underline-offset-4 hover:underline"
            onClick={() => setShowCode(true)}
          >
            Show recovery code
          </button>
        )}
      </div>

      <Button
        variant="destructive"
        className="self-start"
        disabled={remove.isPending}
        onClick={() => {
          if (
            window.confirm(
              `Permanently delete "${name}"?\n\n` +
                "The link stops working for everyone. This can't be undone.",
            )
          ) {
            remove.mutate({ hash, recoveryCode });
          }
        }}
      >
        <Trash2 className="mr-2 h-4 w-4" />
        Delete playlist
      </Button>
    </section>
  );
}

/** Lets the owner unlock editing in a new browser with the recovery code. */
function UnlockPanel({
  hash,
  onUnlocked,
}: {
  hash: string;
  onUnlocked: (recoveryCode: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");

  const verify = api.playlist.verifyOwner.useMutation({
    onSuccess: ({ recoveryCode }) => {
      toast.success("Playlist unlocked in this browser.");
      onUnlocked(recoveryCode);
    },
  });

  if (!open) {
    return (
      <button
        type="button"
        className="flex items-center gap-2 self-start text-sm underline-offset-4 opacity-80 hover:underline"
        onClick={() => setOpen(true)}
      >
        <KeyRound className="h-4 w-4" />
        Is this your playlist? Enter its recovery code
      </button>
    );
  }

  return (
    <form
      className="flex flex-col gap-1 rounded-lg border border-white/20 bg-black/30 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        verify.mutate({ hash, recoveryCode: code });
      }}
    >
      <label htmlFor="recovery-code" className="text-sm">
        Recovery code
      </label>
      <div className="flex gap-2">
        <Input
          id="recovery-code"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            verify.reset();
          }}
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="font-mono"
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={verify.isPending || !code.trim()}
        >
          Unlock
        </Button>
      </div>
      {verify.error && (
        <p className="text-sm text-red-300">{verify.error.message}</p>
      )}
    </form>
  );
}
