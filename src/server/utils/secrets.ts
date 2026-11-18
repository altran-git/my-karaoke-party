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
 * Checks a party host key. New parties get a host code as their key
 * (stored hashed in its normalized form, so dashes and capitals don't
 * matter); older parties have a random key that must match exactly.
 */
export function hostKeyMatches(storedHash: string | null, hostKey: string) {
  return (
    secretMatches(storedHash, normalizeHostCode(hostKey)) ||
    secretMatches(storedHash, hostKey)
  );
}

/**
 * The form of a host key that the browser should keep: the formatted
 * host code for new parties, or the key exactly as typed for old ones.
 */
export function canonicalHostKey(storedHash: string | null, hostKey: string) {
  return secretMatches(storedHash, normalizeHostCode(hostKey))
    ? formatHostCode(hostKey)
    : hostKey.trim();
}

/**
 * Loads the party and checks that `hostKey` is the key its creator got.
 * Throws NOT_FOUND or FORBIDDEN otherwise.
 */
export async function requirePartyHost(
  db: typeof Db,
  hash: string,
  hostKey: string,
  forbiddenMessage = "Only the browser that started this party can do that.",
) {
  const party = await db.party.findUnique({ where: { hash } });

  if (!party?.hash) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Party not found." });
  }

  if (!hostKeyMatches(party.hostKeyHash, hostKey)) {
    throw new TRPCError({ code: "FORBIDDEN", message: forbiddenMessage });
  }

  return { ...party, hash: party.hash };
}

// Crockford base32: no I, L, O or U, so a code is hard to misread or mistype.
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 20; // 100 bits: far too many to guess.

/** A new host code like "K7QF-29XM-TR4P-8BWD-3NHA". */
export function generateHostCode() {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (const byte of bytes) {
    // 256 is a multiple of 32, so every character is equally likely.
    code += CODE_ALPHABET[byte % 32];
  }
  return formatHostCode(code);
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
