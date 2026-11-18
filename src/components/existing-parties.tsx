"use client";

import { Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "~/trpc/react";
import {
  forgetParty,
  getRecentParties,
  type RecentParty,
} from "~/utils/recent-parties";
import { rememberPlaylist } from "~/utils/saved-playlists";
import { playlistUrl } from "./playlist-dialogs";
import { Input } from "./ui/ui/input";
import { Button } from "./ui/ui/button";

/**
 * "Rejoin a party" panel on the start page: lists parties this browser has
 * hosted and lets the host reopen any party's player screen by its code.
 */
export function ExistingParties() {
  const router = useRouter();
  const utils = api.useUtils();

  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<RecentParty[]>([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const deleteParty = api.party.delete.useMutation({
    onSuccess: (_data, { hash }) => {
      forgetParty(hash);
      setRecent(getRecentParties());
    },
    onError: (err) => setListError(err.message),
  });

  const savePlaylist = api.playlist.saveFromParty.useMutation();

  async function confirmDelete(p: RecentParty) {
    if (!p.hostKey) return;
    const ok = window.confirm(
      `Permanently delete "${p.name}"?\n\n` +
        "The song queue is erased, anyone still connected is sent back to " +
        "the start page, and the party code can be used again. " +
        "This can't be undone.",
    );
    if (!ok) return;

    setListError(null);

    // Deleting erases the list of songs sung, so offer to keep it first.
    if (
      window.confirm(
        `Save the songs sung at "${p.name}" as a playlist before deleting?`,
      )
    ) {
      try {
        const playlist = await savePlaylist.mutateAsync({
          partyHash: p.hash,
          hostKey: p.hostKey,
          name: `${p.name} ${new Date().toLocaleDateString()}`,
        });
        rememberPlaylist(playlist);
        // A prompt, so the code can be selected and copied.
        window.prompt(
          `Saved "${playlist.name}" (${playlist.songCount} ` +
            `${playlist.songCount === 1 ? "song" : "songs"}) at ` +
            `${playlistUrl(playlist.hash)}\n\n` +
            "This browser remembers it. To edit it from another browser, " +
            "keep this recovery code:",
          playlist.recoveryCode,
        );
      } catch (err) {
        const code =
          err && typeof err === "object" && "data" in err
            ? (err.data as { code?: string } | undefined)?.code
            : undefined;
        // Nothing to save: go ahead and delete.
        if (code !== "BAD_REQUEST" && code !== "NOT_FOUND") {
          setListError(
            "Couldn't save the songs, so the party wasn't deleted. " +
              "Please try again.",
          );
          return;
        }
      }
    }

    deleteParty.mutate({ hash: p.hash, hostKey: p.hostKey });
  }

  function removeFromList(p: RecentParty) {
    if (
      p.hostKey &&
      !window.confirm(
        `Remove "${p.name}" from this list?\n\n` +
          "The party keeps running, but this browser won't be able to " +
          "delete it any more.",
      )
    ) {
      return;
    }
    forgetParty(p.hash);
    setRecent(getRecentParties());
  }

  // localStorage is only readable in the browser, after hydration.
  useEffect(() => {
    setRecent(getRecentParties());
  }, []);

  async function openByCode(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;

    setChecking(true);
    setError(null);
    try {
      const party = await utils.party.getByHash.fetch({ hash: trimmed });
      if (!party?.hash) {
        setError("No party found with that code.");
        return;
      }
      router.push(`/player/${party.hash}`);
    } catch {
      setError("Couldn't look up that code. Please try again.");
    } finally {
      setChecking(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 text-white underline-offset-4 hover:underline"
      >
        Rejoin an existing party →
      </button>
    );
  }

  return (
    <div className="flex w-full max-w-sm shrink-0 flex-col gap-3 rounded-lg border border-white/20 bg-black/30 p-4 text-white">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Rejoin a party</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="rounded p-1 hover:bg-white/10"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {recent.length > 0 && (
        <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
          {recent.map((p) => (
            <li key={p.hash} className="flex items-center gap-2">
              <Link
                href={`/player/${p.hash}`}
                className="flex min-w-0 flex-1 items-center rounded px-2 py-1 hover:bg-white/10"
              >
                <span className="truncate">{p.name}</span>
              </Link>
              {p.hostKey && (
                <button
                  type="button"
                  aria-label={`Permanently delete ${p.name}`}
                  title="Permanently delete this party"
                  disabled={deleteParty.isPending || savePlaylist.isPending}
                  onClick={() => void confirmDelete(p)}
                  className="rounded p-1 text-red-300 opacity-70 hover:bg-white/10 hover:opacity-100 disabled:opacity-30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                aria-label={`Remove ${p.name} from this list`}
                title="Remove from this list (the party keeps running)"
                onClick={() => removeFromList(p)}
                className="rounded p-1 opacity-60 hover:bg-white/10 hover:opacity-100"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {listError && <p className="text-sm text-red-300">{listError}</p>}

      <form onSubmit={openByCode} className="flex flex-col gap-1">
        <label htmlFor="party-code" className="text-sm opacity-80">
          Party code
        </label>
        <div className="flex gap-2">
          <Input
            id="party-code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setError(null);
            }}
            placeholder="Enter your party code"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className="font-mono"
          />
          <Button type="submit" variant="secondary" disabled={checking}>
            {checking ? "..." : "Open"}
          </Button>
        </div>
        {error && <p className="text-sm text-red-300">{error}</p>}
      </form>

      <Link href="/join" className="text-center text-sm hover:underline">
        Joining as a singer? Go to the join page
      </Link>
    </div>
  );
}
