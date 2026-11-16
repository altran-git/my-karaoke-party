import { api } from "~/trpc/server";
import { fetchPartyServer } from "~/server/party-server";
import { notFound, redirect } from "next/navigation";
import { type KaraokeParty } from "party/types";
import PlayerScene from "./player-scene";

type Props = {
  params: { hash: string };
};

export async function generateMetadata({ params }: Props) {
  const partyHash = params.hash;

  const party = await api.party.getByHash({ hash: partyHash });

  if (!party) {
    notFound();
  }

  return {
    title: party.name,
  };
}

export default async function PartyPage({ params }: Props) {
  const party = await api.party.getByHash({ hash: params.hash });

  if (!party?.hash) {
    notFound();
  }

  // The code may have been typed with different capitals or spaces.
  if (party.hash !== params.hash) {
    redirect(`/player/${party.hash}`);
  }

  const partyKitRes = await fetchPartyServer(party.hash, {
    method: "GET",
    next: {
      revalidate: 0,
    },
  });

  if (!partyKitRes.ok) {
    if (partyKitRes.status === 404) {
      notFound();
    } else {
      throw new Error("Something went wrong.");
    }
  }

  const playlist = (await partyKitRes.json()) as KaraokeParty;

  return <PlayerScene party={party} initialPlaylist={playlist} />;
}
