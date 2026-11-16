import { notFound, redirect } from "next/navigation";
import { type KaraokeParty } from "party/types";
import { fetchPartyServer } from "~/server/party-server";
import { api } from "~/trpc/server";
import { PartyScene } from "./party-scene";

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

export default async function PartyHashPage({ params }: Props) {
  const partyHash = params.hash;

  const party = await api.party.getByHash({ hash: partyHash });

  if (!party?.hash) {
    return <div>Party not found</div>;
  }

  // The code may have been typed with different capitals or spaces.
  if (party.hash !== partyHash) {
    redirect(`/party/${party.hash}`);
  }

  const req = await fetchPartyServer(partyHash, {
    method: "GET",
    next: {
      revalidate: 0,
    },
  });

  if (!req.ok) {
    if (req.status === 404) {
      notFound();
    } else {
      throw new Error("Something went wrong.");
    }
  }

  const playlist = (await req.json()) as KaraokeParty;

  return (
    <PartyScene key={party.hash} party={party} initialPlaylist={playlist} />
  );
}
