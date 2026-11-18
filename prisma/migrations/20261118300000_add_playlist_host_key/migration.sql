-- Lets the host of the party a playlist came from overwrite it later.
ALTER TABLE "Playlist" ADD COLUMN "hostKeyHash" TEXT;
