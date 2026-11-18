-- How often and when a playlist was loaded into a party, and into which one.
ALTER TABLE "Playlist" ADD COLUMN "loadCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Playlist" ADD COLUMN "lastLoadedAt" TIMESTAMP(3);
ALTER TABLE "Playlist" ADD COLUMN "lastLoadedParty" TEXT;
