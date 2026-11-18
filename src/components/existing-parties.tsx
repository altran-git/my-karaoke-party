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
import { DeletePartyDialog } from "./delete-party-dialog";
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

  // The party whose delete dialog is open.
  const [toDelete, setToDelete] = useState<RecentParty | null>(null);

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
      router.push(`/player/${party.hash}?rejoin=1`);
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
                href={`/player/${p.hash}?rejoin=1`}
                className="flex min-w-0 flex-1 items-center rounded px-2 py-1 hover:bg-white/10"
              >
                <span className="truncate">{p.name}</span>
              </Link>
              {p.hostKey && (
                <button
                  type="button"
                  aria-label={`Permanently delete ${p.name}`}
                  title="Permanently delete this party"
                  onClick={() => setToDelete(p)}
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

      <DeletePartyDialog
        party={toDelete}
        onOpenChange={(isOpen) => {
          if (!isOpen) setToDelete(null);
        }}
        onDeleted={(hash) => {
          forgetParty(hash);
          setRecent(getRecentParties());
        }}
      />

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
