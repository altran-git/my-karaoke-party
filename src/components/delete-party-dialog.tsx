"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "~/trpc/react";
import type { RecentParty } from "~/utils/recent-parties";
import { Button } from "./ui/ui/button";

type SavedPlaylist = { hash: string; name: string; songCount: number };

/** The tRPC error code of a failed call, if it has one. */
function errorCode(err: unknown) {
  return err && typeof err === "object" && "data" in err
    ? (err.data as { code?: string } | undefined)?.code
    : undefined;
}

/**
 * Confirms deleting a party and asks whether to save its songs (sung and
 * still queued) as a playlist first, since deleting erases them.
 */
export function DeletePartyDialog({
  party,
  onOpenChange,
  onDeleted,
}: {
  /** The party to delete; the dialog is open while this is set. */
  party: RecentParty | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: (hash: string) => void;
}) {
  // Which button was pressed, while saving and deleting are in progress.
  const [working, setWorking] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const savePlaylist = api.playlist.saveFromParty.useMutation();
  const deleteParty = api.party.delete.useMutation();

  useEffect(() => {
    if (party) {
      setWorking(null);
      setError(null);
    }
  }, [party?.hash]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(saveFirst: boolean) {
    if (!party?.hostKey) return;
    setError(null);
    setWorking(saveFirst ? "save" : "delete");

    let playlist: SavedPlaylist | null = null;

    if (saveFirst) {
      try {
        playlist = await savePlaylist.mutateAsync({
          partyHash: party.hash,
          name: `${party.name} ${new Date().toLocaleDateString()}`,
          // Don't fail the delete over a name clash: add " (2)" etc.
          suffixIfTaken: true,
        });
      } catch (err) {
        const code = errorCode(err);
        // No songs to save, or the queue already expired: delete anyway.
        if (code !== "BAD_REQUEST" && code !== "NOT_FOUND") {
          setWorking(null);
          setError(
            "Couldn't save the songs, so the party wasn't deleted. " +
              "Please try again.",
          );
          return;
        }
      }
    }

    try {
      await deleteParty.mutateAsync({
        hash: party.hash,
        hostKey: party.hostKey,
      });
    } catch (err) {
      setWorking(null);
      setError(
        (err instanceof Error && err.message) ||
          "Couldn't delete the party. Please try again.",
      );
      return;
    }

    setWorking(null);
    onDeleted(party.hash);

    toast.success(
      playlist
        ? `Deleted “${party.name}”. Its ${playlist.songCount} ${
            playlist.songCount === 1 ? "song was" : "songs were"
          } saved as “${playlist.name}”.`
        : saveFirst
          ? `Deleted “${party.name}”. It had no songs to save.`
          : `Deleted “${party.name}”.`,
    );
    onOpenChange(false);
  }

  return (
    <Dialog.Root
      open={!!party}
      onOpenChange={(open) => {
        // Don't close halfway through saving or deleting.
        if (!working) onOpenChange(open);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/70" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[60] max-h-[90vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background p-5 text-left text-foreground shadow-xl"
        >
          <Dialog.Title className="text-lg mb-2 font-semibold">
            {`Delete “${party?.name ?? ""}”?`}
          </Dialog.Title>
          <p className="mb-4 text-sm text-muted-foreground">
            The song queue is erased, anyone still connected is sent back to the
            start page, and the party code can be used again. This can&apos;t be
            undone.
          </p>
          <p className="text-sm font-medium">
            Save its songs (the ones sung and the ones still queued) as a
            playlist first?
          </p>

          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="outline" disabled={!!working}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              variant="destructive"
              disabled={!!working}
              onClick={() => void run(false)}
            >
              {working === "delete" && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              No
            </Button>
            <Button disabled={!!working} onClick={() => void run(true)}>
              {working === "save" && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Yes
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
