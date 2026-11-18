"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { LoadMode } from "party/types";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { rememberParty } from "~/utils/recent-parties";
import {
  getSavedPlaylists,
  rememberPlaylist,
  type SavedPlaylist,
} from "~/utils/saved-playlists";
import { getUrl } from "~/utils/url";
import { Button } from "./ui/ui/button";
import { Input } from "./ui/ui/input";

const CONTENT_CLASS =
  "fixed left-1/2 top-1/2 z-[60] max-h-[90vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background p-5 text-left text-foreground shadow-xl";

export function playlistUrl(hash: string) {
  return getUrl(`/playlists/${hash}`);
}

/** Pulls a playlist hash out of a pasted link, or takes the text as one. */
export function parsePlaylistHash(input: string) {
  const trimmed = input.trim();
  const fromLink = /\/playlists\/([A-Za-z0-9_-]+)/.exec(trimmed);
  if (fromLink) return fromLink[1]!;
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={label}
      title={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Couldn't copy. Select the text and copy it instead.");
        }
      }}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

/** Link and recovery code of a playlist that was just created. */
export function NewPlaylistDetails({
  hash,
  recoveryCode,
}: {
  hash: string;
  recoveryCode: string;
}) {
  const url = playlistUrl(hash);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">
          Share this link. Anyone with it can load the songs into their own
          party.
        </span>
        <div className="flex items-center gap-2">
          <Input readOnly value={url} className="text-xs font-mono" />
          <CopyButton text={url} label="Copy link" />
        </div>
      </div>

      <div className="flex flex-col gap-1 rounded-md border border-amber-500/60 bg-amber-500/10 p-3">
        <span className="text-sm font-semibold">Recovery code</span>
        <div className="flex items-center gap-2">
          <span className="text-lg select-all font-mono tracking-wider">
            {recoveryCode}
          </span>
          <CopyButton text={recoveryCode} label="Copy recovery code" />
        </div>
        <span className="text-xs text-muted-foreground">
          This browser remembers it for you. Write it down to edit or delete the
          playlist from another browser. It won&apos;t be shown again.
        </span>
      </div>
    </div>
  );
}

/** Append-or-replace and shuffle choices for loading a playlist. */
export function LoadOptions({
  mode,
  onModeChange,
  shuffle,
  onShuffleChange,
  className,
}: {
  mode: LoadMode;
  onModeChange: (mode: LoadMode) => void;
  shuffle: boolean;
  onShuffleChange: (shuffle: boolean) => void;
  className?: string;
}) {
  return (
    <fieldset className={cn("flex flex-col gap-2 text-sm", className)}>
      <legend className="mb-1 text-muted-foreground">
        Add the songs to the queue
      </legend>
      <label className="flex items-center gap-2">
        <input
          type="radio"
          name="load-mode"
          checked={mode === "append"}
          onChange={() => onModeChange("append")}
        />
        After the songs already queued
      </label>
      <label className="flex items-center gap-2">
        <input
          type="radio"
          name="load-mode"
          checked={mode === "replace"}
          onChange={() => onModeChange("replace")}
        />
        Instead of the queued songs (the song playing now stays)
      </label>
      <label className="mt-1 flex items-center gap-2">
        <input
          type="checkbox"
          checked={shuffle}
          onChange={(e) => onShuffleChange(e.target.checked)}
        />
        Shuffle
      </label>
    </fieldset>
  );
}

type PartyHostProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partyHash: string;
  hostKey: string;
};

/** Saves the songs played so far at the party as a new playlist. */
export function SavePlaylistDialog({
  open,
  onOpenChange,
  partyHash,
  defaultName,
}: Omit<PartyHostProps, "hostKey"> & { defaultName: string }) {
  const [name, setName] = useState(defaultName);
  const [includePlayed, setIncludePlayed] = useState(true);
  const [includeQueued, setIncludeQueued] = useState(true);

  const save = api.playlist.saveFromParty.useMutation({
    onSuccess: (playlist) => {
      rememberPlaylist(playlist);
    },
  });

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setIncludePlayed(true);
      setIncludeQueued(true);
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultName]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/70" />
        <Dialog.Content aria-describedby={undefined} className={CONTENT_CLASS}>
          <Dialog.Title className="text-lg mb-4 font-semibold">
            {save.data ? "Playlist saved" : "Save songs as a playlist"}
          </Dialog.Title>

          {save.data ? (
            <>
              <p className="mb-4 text-sm">
                {`“${save.data.name}” has ${save.data.songCount} ${
                  save.data.songCount === 1 ? "song" : "songs"
                }.`}
              </p>
              <NewPlaylistDetails
                hash={save.data.hash}
                recoveryCode={save.data.recoveryCode}
              />
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="outline" asChild>
                  <Link href={`/playlists/${save.data.hash}`} target="_blank">
                    Open <ExternalLink className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Dialog.Close asChild>
                  <Button>Done</Button>
                </Dialog.Close>
              </div>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate({
                  partyHash,
                  name,
                  includePlayed,
                  includeQueued,
                });
              }}
              className="flex flex-col gap-3"
            >
              <fieldset className="flex flex-col gap-2 text-sm">
                <legend className="mb-1 text-muted-foreground">
                  Songs to save (each song is saved once)
                </legend>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={includePlayed}
                    onChange={(e) => {
                      setIncludePlayed(e.target.checked);
                      save.reset();
                    }}
                  />
                  Songs already sung, in the order they were played
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={includeQueued}
                    onChange={(e) => {
                      setIncludeQueued(e.target.checked);
                      save.reset();
                    }}
                  />
                  Songs in the queue, including the one playing now
                </label>
              </fieldset>
              <label htmlFor="playlist-name" className="text-sm">
                Playlist name
              </label>
              <Input
                id="playlist-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                required
              />
              {save.error && (
                <p className="text-sm text-red-400">{save.error.message}</p>
              )}
              <div className="mt-2 flex justify-end gap-2">
                <Dialog.Close asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </Dialog.Close>
                <Button
                  type="submit"
                  disabled={
                    save.isPending ||
                    !name.trim() ||
                    (!includePlayed && !includeQueued)
                  }
                >
                  {save.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Save
                </Button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Lets the host pick a playlist and add its songs to the queue. */
export function LoadPlaylistDialog({
  open,
  onOpenChange,
  partyHash,
  hostKey,
}: PartyHostProps) {
  const utils = api.useUtils();

  const [saved, setSaved] = useState<SavedPlaylist[]>([]);
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [mode, setMode] = useState<LoadMode>("append");
  const [shuffle, setShuffle] = useState(false);
  const [loadingHash, setLoadingHash] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSaved(getSavedPlaylists());
      setLink("");
      setLinkError(null);
    }
  }, [open]);

  // Current names and song counts; drops playlists deleted since.
  const details = api.playlist.getMany.useQuery(
    { hashes: saved.map((p) => p.hash) },
    { enabled: open && saved.length > 0 },
  );
  const playlists = details.data
    ? saved.flatMap((p) => {
        const d = details.data.find((x) => x.hash === p.hash);
        return d ? [{ ...p, name: d.name, songCount: d.songCount }] : [];
      })
    : saved.map((p) => ({ ...p, songCount: undefined }));

  const load = api.playlist.loadIntoParty.useMutation({
    onSuccess: ({ added, skipped }) => {
      toast.success(
        `Added ${added} ${added === 1 ? "song" : "songs"} to the queue` +
          (skipped > 0 ? ` (${skipped} already queued)` : "") +
          ".",
      );
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
    onSettled: () => setLoadingHash(null),
  });

  function loadPlaylist(playlistHash: string) {
    setLoadingHash(playlistHash);
    load.mutate({ partyHash, hostKey, playlistHash, mode, shuffle });
  }

  async function loadFromLink(e: React.FormEvent) {
    e.preventDefault();
    const hash = parsePlaylistHash(link);
    if (!hash) {
      setLinkError("Paste a playlist link.");
      return;
    }

    setLinkError(null);
    try {
      const playlist = await utils.playlist.get.fetch({ hash });
      if (!playlist) {
        setLinkError("No playlist found at that link.");
        return;
      }
      rememberPlaylist({ hash: playlist.hash, name: playlist.name });
      loadPlaylist(playlist.hash);
    } catch {
      setLinkError("Couldn't look up that link. Please try again.");
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/70" />
        <Dialog.Content aria-describedby={undefined} className={CONTENT_CLASS}>
          <Dialog.Title className="text-lg mb-4 font-semibold">
            Load a playlist
          </Dialog.Title>

          <LoadOptions
            className="mb-4"
            mode={mode}
            onModeChange={setMode}
            shuffle={shuffle}
            onShuffleChange={setShuffle}
          />

          {playlists.length > 0 ? (
            <ul className="mb-4 flex max-h-64 flex-col gap-1 overflow-y-auto">
              {playlists.map((p) => (
                <li
                  key={p.hash}
                  className="flex items-center gap-2 rounded px-2 py-1 hover:bg-white/5"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <Link
                      href={`/playlists/${p.hash}`}
                      target="_blank"
                      className="truncate hover:underline"
                    >
                      {p.name}
                    </Link>
                    {p.songCount !== undefined && (
                      <span className="text-xs text-muted-foreground">
                        {p.songCount} {p.songCount === 1 ? "song" : "songs"}
                        {p.recoveryCode ? " · yours" : ""}
                      </span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    disabled={load.isPending || p.songCount === 0}
                    onClick={() => loadPlaylist(p.hash)}
                  >
                    {loadingHash === p.hash ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Load"
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-muted-foreground">
              No playlists in this browser yet. Save one from a party, or paste
              a link someone shared with you.
            </p>
          )}

          <form onSubmit={loadFromLink} className="flex flex-col gap-1">
            <label htmlFor="playlist-link" className="text-sm">
              Or paste a playlist link
            </label>
            <div className="flex gap-2">
              <Input
                id="playlist-link"
                value={link}
                onChange={(e) => {
                  setLink(e.target.value);
                  setLinkError(null);
                }}
                placeholder={playlistUrl("…")}
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                type="submit"
                variant="secondary"
                disabled={load.isPending || !link.trim()}
              >
                Load
              </Button>
            </div>
            {linkError && <p className="text-sm text-red-400">{linkError}</p>}
          </form>

          <div className="mt-5 flex justify-end">
            <Dialog.Close asChild>
              <Button variant="outline">Close</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A party's host code, with a copy button. */
export function HostCodeBox({ hostKey }: { hostKey: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-amber-500/60 bg-amber-500/10 p-3">
      <span className="text-sm font-semibold">Host code</span>
      <div className="flex items-center gap-2">
        <span className="text-lg select-all break-all font-mono tracking-wider">
          {hostKey}
        </span>
        <CopyButton text={hostKey} label="Copy host code" />
      </div>
      <span className="text-xs text-muted-foreground">
        This browser remembers it. Write it down to load playlists or delete the
        party from another browser or device. Don&apos;t share it with guests.
      </span>
    </div>
  );
}

/** Shown once, right after the party is created. */
export function NewPartyHostCodeDialog({
  open,
  onOpenChange,
  hostKey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hostKey: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/70" />
        <Dialog.Content aria-describedby={undefined} className={CONTENT_CLASS}>
          <Dialog.Title className="text-lg mb-4 font-semibold">
            Your party is ready
          </Dialog.Title>
          <HostCodeBox hostKey={hostKey} />
          <p className="text-xs mt-3 text-muted-foreground">
            You can see this code again with &ldquo;Host code&rdquo; under the
            party code.
          </p>
          <div className="mt-5 flex justify-end">
            <Dialog.Close asChild>
              <Button>Got it</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Asks for the party's host code in a browser that doesn't have it, and
 * remembers it there once the server accepts it.
 */
export function UnlockHostDialog({
  open,
  onOpenChange,
  partyHash,
  partyName,
  onUnlocked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partyHash: string;
  partyName: string;
  onUnlocked: (hostKey: string) => void;
}) {
  const [code, setCode] = useState("");

  const verify = api.party.verifyHost.useMutation({
    onSuccess: ({ hostKey }) => {
      rememberParty({ hash: partyHash, name: partyName, hostKey });
      onUnlocked(hostKey);
    },
  });

  useEffect(() => {
    if (open) {
      setCode("");
      verify.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/70" />
        <Dialog.Content aria-describedby={undefined} className={CONTENT_CLASS}>
          <Dialog.Title className="text-lg mb-2 font-semibold">
            Enter the host code
          </Dialog.Title>
          <p className="mb-4 text-sm text-muted-foreground">
            Only the host can load playlists into this party. The host code was
            shown when the party was created, and under &ldquo;Host code&rdquo;
            in the browser that created it.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              verify.mutate({ hash: partyHash, hostKey: code });
            }}
            className="flex flex-col gap-1"
          >
            <label htmlFor="host-code" className="text-sm">
              Host code
            </label>
            <div className="flex gap-2">
              <Input
                id="host-code"
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
              <Button type="submit" disabled={verify.isPending || !code.trim()}>
                {verify.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Unlock"
                )}
              </Button>
            </div>
            {verify.error && (
              <p className="text-sm text-red-400">{verify.error.message}</p>
            )}
          </form>
          <div className="mt-5 flex justify-end">
            <Dialog.Close asChild>
              <Button variant="outline">Cancel</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Shows this browser's host code again. */
export function HostCodeDialog({
  open,
  onOpenChange,
  hostKey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hostKey: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/70" />
        <Dialog.Content aria-describedby={undefined} className={CONTENT_CLASS}>
          <Dialog.Title className="text-lg mb-4 font-semibold">
            Host code
          </Dialog.Title>
          <HostCodeBox hostKey={hostKey} />
          <div className="mt-5 flex justify-end">
            <Dialog.Close asChild>
              <Button>Close</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
