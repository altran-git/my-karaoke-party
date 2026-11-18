"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useDebouncedValue } from "@mantine/hooks";
import { Check, Copy, ExternalLink, Loader2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { LoadMode } from "party/types";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { rememberParty } from "~/utils/recent-parties";
import {
  forgetPlaylist,
  getSavedPlaylists,
  rememberPlaylist,
} from "~/utils/saved-playlists";
import { getUrl } from "~/utils/url";
import { Button } from "./ui/ui/button";
import { Input } from "./ui/ui/input";

const CONTENT_CLASS =
  "fixed left-1/2 top-1/2 z-[60] max-h-[90vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background p-5 text-left text-foreground shadow-xl";

export function playlistUrl(hash: string) {
  return getUrl(`/playlists/${hash}`);
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
          Anyone can now find it under Load playlist. This link opens it
          directly.
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
          Lets you rename the playlist. This browser remembers it; write it down
          to rename from another browser. It won&apos;t be shown again.
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

  const utils = api.useUtils();
  const save = api.playlist.saveFromParty.useMutation({
    onSuccess: (playlist) => {
      rememberPlaylist(playlist);
      void utils.playlist.list.invalidate();
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

/**
 * Asks the person to type DELETE before deleting a playlist. Anyone can
 * delete any playlist, so this only guards against accidents.
 */
export function DeletePlaylistDialog({
  playlist,
  onOpenChange,
  onDeleted,
}: {
  /** The playlist to delete; the dialog is open while this is set. */
  playlist: { hash: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
  onDeleted?: (hash: string) => void;
}) {
  const utils = api.useUtils();
  const [typed, setTyped] = useState("");

  const remove = api.playlist.delete.useMutation({
    onSuccess: (_data, { hash }) => {
      forgetPlaylist(hash);
      void utils.playlist.list.invalidate();
      toast.success("Playlist deleted.");
      onOpenChange(false);
      onDeleted?.(hash);
    },
    onError: (err) => toast.error(err.message),
  });

  useEffect(() => {
    if (playlist) {
      setTyped("");
      remove.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlist?.hash]);

  const confirmed = typed.trim() === "DELETE";

  return (
    <Dialog.Root open={!!playlist} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/70" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(CONTENT_CLASS, "z-[70]")}
        >
          <Dialog.Title className="text-lg mb-2 font-semibold">
            {`Delete “${playlist?.name ?? ""}”?`}
          </Dialog.Title>
          <p className="mb-4 text-sm text-muted-foreground">
            The playlist is deleted for everyone and its link stops working.
            This can&apos;t be undone.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (playlist && confirmed) {
                remove.mutate({ hash: playlist.hash, confirm: "DELETE" });
              }
            }}
            className="flex flex-col gap-1"
          >
            <label htmlFor="confirm-delete" className="text-sm">
              Type <span className="font-mono font-semibold">DELETE</span> to
              confirm
            </label>
            <Input
              id="confirm-delete"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="font-mono"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button
                type="submit"
                variant="destructive"
                disabled={!confirmed || remove.isPending}
              >
                {remove.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Delete
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const LIST_PAGE_SIZE = 50;

/** Lets the host pick any saved playlist and add its songs to the queue. */
export function LoadPlaylistDialog({
  open,
  onOpenChange,
  partyHash,
  hostKey,
}: PartyHostProps) {
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebouncedValue(search.trim(), 300);
  const [mode, setMode] = useState<LoadMode>("append");
  const [shuffle, setShuffle] = useState(false);
  const [loadingHash, setLoadingHash] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<{
    hash: string;
    name: string;
  } | null>(null);
  // Playlists this browser created or unlocked, to mark them as yours.
  const [ownHashes, setOwnHashes] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setSearch("");
      setOwnHashes(
        new Set(
          getSavedPlaylists()
            .filter((p) => p.recoveryCode)
            .map((p) => p.hash),
        ),
      );
    }
  }, [open]);

  const list = api.playlist.list.useInfiniteQuery(
    { search: debouncedSearch || undefined, limit: LIST_PAGE_SIZE },
    {
      enabled: open,
      getNextPageParam: (last) => last.nextCursor,
      refetchOnWindowFocus: false,
    },
  );
  const playlists = list.data?.pages.flatMap((page) => page.items) ?? [];

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

          <Input
            aria-label="Search playlists"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search playlists by name..."
            autoComplete="off"
            className="mb-2"
          />

          {list.isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : list.isError ? (
            <p className="py-4 text-sm text-red-400">
              Couldn&apos;t load the playlists. Please try again.
            </p>
          ) : playlists.length > 0 ? (
            <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
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
                    <span className="text-xs text-muted-foreground">
                      {p.songCount} {p.songCount === 1 ? "song" : "songs"}
                      {ownHashes.has(p.hash) ? " · yours" : ""}
                    </span>
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
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Delete ${p.name}`}
                    title="Delete this playlist"
                    className="h-8 w-8 text-red-400 hover:text-red-300"
                    onClick={() => setToDelete({ hash: p.hash, name: p.name })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
              {list.hasNextPage && (
                <li className="flex justify-center py-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={list.isFetchingNextPage}
                    onClick={() => void list.fetchNextPage()}
                  >
                    {list.isFetchingNextPage ? "Loading..." : "Show more"}
                  </Button>
                </li>
              )}
            </ul>
          ) : (
            <p className="py-4 text-sm text-muted-foreground">
              {debouncedSearch
                ? `No playlists match “${debouncedSearch}”.`
                : "No playlists yet. Save one from a party first."}
            </p>
          )}

          <div className="mt-5 flex justify-end">
            <Dialog.Close asChild>
              <Button variant="outline">Close</Button>
            </Dialog.Close>
          </div>

          <DeletePlaylistDialog
            playlist={toDelete}
            onOpenChange={(isOpen) => {
              if (!isOpen) setToDelete(null);
            }}
          />
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
