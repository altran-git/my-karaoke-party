import { notFound } from "next/navigation";
import { api } from "~/trpc/server";
import PlaylistScene from "./playlist-scene";

type Props = {
  params: { hash: string };
};

export async function generateMetadata({ params }: Props) {
  const playlist = await api.playlist.get({ hash: params.hash });

  if (!playlist) {
    notFound();
  }

  return {
    title: playlist.name,
  };
}

export default async function PlaylistPage({ params }: Props) {
  const playlist = await api.playlist.get({ hash: params.hash });

  if (!playlist) {
    notFound();
  }

  return <PlaylistScene playlist={playlist} />;
}
