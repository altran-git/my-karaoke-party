-- Playlists no longer have owners: anyone can rename or delete them.
ALTER TABLE "Playlist" DROP COLUMN "ownerKeyHash";
