-- The name of the party a playlist was last loaded into, kept after the party is deleted.
ALTER TABLE "Playlist" ADD COLUMN "lastLoadedPartyName" TEXT;
