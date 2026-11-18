import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { db as Db } from "~/server/db";

export function hashSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

/** Constant-time check of `secret` against a stored `hashSecret` value. */
export function secretMatches(storedHash: string | null, secret: string) {
  const expected = Buffer.from(storedHash ?? "", "hex");
  const actual = Buffer.from(hashSecret(secret), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Compares a host key with the stored hash. New parties use a 4-digit PIN;
 * earlier ones a host code (stored normalized, so dashes and capitals don't
 * matter) or a random key that must match exactly. Use checkHostKey, which
 * adds the lockout, rather than calling this directly.
 */
export function hostKeyMatches(storedHash: string | null, hostKey: string) {
  return (
    secretMatches(storedHash, normalizeHostCode(hostKey)) ||
    secretMatches(storedHash, hostKey)
  );
}

/**
 * The form of a host key that the browser should keep: the PIN or the
 * formatted host code, or an old random key exactly as typed.
 */
export function canonicalHostKey(storedHash: string | null, hostKey: string) {
  return secretMatches(storedHash, normalizeHostCode(hostKey))
    ? formatHostCode(hostKey)
    : hostKey.trim();
}

/** Wrong host PINs allowed in a row before PIN checks are locked. */
const MAX_WRONG_HOST_KEYS = 5;
const HOST_LOCK_MS = 15 * 60 * 1000;

function lockedError(lockedUntil: Date | null) {
  const minutes = lockedUntil
    ? Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000))
    : Math.round(HOST_LOCK_MS / 60_000);
  return new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: `Too many wrong PINs. Try again in ${minutes} ${
      minutes === 1 ? "minute" : "minutes"
    }.`,
  });
}

/**
 * Checks `hostKey` (a PIN, or an older party's host code) against the
 * party, with a lockout: after MAX_WRONG_HOST_KEYS wrong tries in a row, all
 * checks fail for HOST_LOCK_MS, so a 4-digit PIN can't be found by trying
 * every one. Throws TOO_MANY_REQUESTS or FORBIDDEN.
 */
export async function checkHostKey(
  db: typeof Db,
  party: { id: number; hostKeyHash: string | null },
  hostKey: string,
  forbiddenMessage = "Only the host of this party can do that.",
) {
  // Reserve an attempt first, in one atomic update, so many guesses sent at
  // once can't slip past the limit before it's recorded.
  const reserved = await db.party.updateMany({
    where: {
      id: party.id,
      hostFailedAttempts: { lt: MAX_WRONG_HOST_KEYS },
      OR: [{ hostLockedUntil: null }, { hostLockedUntil: { lt: new Date() } }],
    },
    data: { hostFailedAttempts: { increment: 1 } },
  });

  if (reserved.count === 0) {
    const current = await db.party.findUnique({
      where: { id: party.id },
      select: { hostLockedUntil: true },
    });
    throw lockedError(current?.hostLockedUntil ?? null);
  }

  if (hostKeyMatches(party.hostKeyHash, hostKey)) {
    await db.party.update({
      where: { id: party.id },
      data: { hostFailedAttempts: 0, hostLockedUntil: null },
    });
    return;
  }

  const after = await db.party.findUnique({
    where: { id: party.id },
    select: { hostFailedAttempts: true },
  });

  if ((after?.hostFailedAttempts ?? 0) >= MAX_WRONG_HOST_KEYS) {
    const lockedUntil = new Date(Date.now() + HOST_LOCK_MS);
    await db.party.update({
      where: { id: party.id },
      data: { hostFailedAttempts: 0, hostLockedUntil: lockedUntil },
    });
    throw lockedError(lockedUntil);
  }

  throw new TRPCError({ code: "FORBIDDEN", message: forbiddenMessage });
}

/**
 * Loads the party and checks that `hostKey` is its host's PIN or code.
 * Throws NOT_FOUND, FORBIDDEN or TOO_MANY_REQUESTS otherwise.
 */
export async function requirePartyHost(
  db: typeof Db,
  hash: string,
  hostKey: string,
  forbiddenMessage?: string,
) {
  const party = await db.party.findUnique({ where: { hash } });

  if (!party?.hash) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Party not found." });
  }

  await checkHostKey(db, party, hostKey, forbiddenMessage);

  return { ...party, hash: party.hash };
}

/**
 * Canonical form of a host code as typed: capitals, no spaces or dashes,
 * and the letters people confuse with digits read as those digits.
 */
export function normalizeHostCode(input: string) {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

export function formatHostCode(code: string) {
  return (
    normalizeHostCode(code)
      .match(/.{1,4}/g)
      ?.join("-") ?? ""
  );
}

/** Hash stored for a host code, however it was typed. */
export function hashHostCode(code: string) {
  return hashSecret(normalizeHostCode(code));
}

const LINK_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const LINK_HASH_LENGTH = 12; // About 71 bits: links can't be guessed.

/** Random public id for a playlist link: 12 letters and digits. */
export function generatePlaylistHash() {
  let hash = "";
  while (hash.length < LINK_HASH_LENGTH) {
    for (const byte of randomBytes(LINK_HASH_LENGTH)) {
      // Skip bytes past the last multiple of 62 so every letter is as likely.
      if (byte < 248 && hash.length < LINK_HASH_LENGTH) {
        hash += LINK_ALPHABET[byte % 62];
      }
    }
  }
  return hash;
}
