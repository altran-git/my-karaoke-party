-- Counters that lock host PIN checks after too many wrong guesses.
ALTER TABLE "Party" ADD COLUMN "hostFailedAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Party" ADD COLUMN "hostLockedUntil" TIMESTAMP(3);
