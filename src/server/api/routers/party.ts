import { randomBytes } from "node:crypto";
import { type Party, Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { log } from "next-axiom";
import { z } from "zod";
import { fetchPartyServer } from "~/server/party-server";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { hashSecret, secretMatches } from "~/server/utils/secrets";
import {
  normalizeCustomCode,
  validateCustomCode,
} from "~/server/utils/sqids";

/** The party without its host key hash, safe to send to any browser. */
function toPublicParty({ hostKeyHash: _hostKeyHash, ...party }: Party) {
  return party;
}

const CODE_IN_USE_MESSAGE =
  "That code is already in use. Please pick another one.";

export const partyRouter = createTRPCRouter({
  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(3),
        code: z.string().max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      log.info("Creating party", { name: input.name });

      let customCode: string | undefined;
      if (input.code?.trim()) {
        customCode = normalizeCustomCode(input.code);

        const invalid = validateCustomCode(customCode);
        if (invalid) {
          throw new TRPCError({ code: "BAD_REQUEST", message: invalid });
        }

        const existing = await ctx.db.party.findUnique({
          where: { hash: customCode },
        });
        if (existing) {
          throw new TRPCError({ code: "CONFLICT", message: CODE_IN_USE_MESSAGE });
        }
      }

      // Only the browser that creates the party gets this key, which it needs
      // to delete the party later. The database keeps just its hash.
      const hostKey = randomBytes(32).toString("base64url");

      let party;
      try {
        party = await ctx.db.party.createWithHash({
          name: input.name,
          hash: customCode,
          hostKeyHash: hashSecret(hostKey),
        });
      } catch (e) {
        // Someone else took the same code between the check and the insert.
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002"
        ) {
          throw new TRPCError({ code: "CONFLICT", message: CODE_IN_USE_MESSAGE });
        }
        throw e;
      }

      if (!party.hash) {
        throw new Error("Party was created without a hash");
      }

      const res = await fetchPartyServer(party.hash, { method: "POST" });

      if (!res.ok) {
        await ctx.db.party.delete({ where: { id: party.id } });

        log.error("Failed to create party", { response: res });
        throw new Error("Failed to create party");
      }

      const publicParty = toPublicParty(party);
      log.info("Party created", { party: publicParty });
      return { ...publicParty, hostKey };
    }),

  delete: publicProcedure
    .input(z.object({ hash: z.string(), hostKey: z.string().max(200) }))
    .mutation(async ({ ctx, input }) => {
      const party = await ctx.db.party.findUnique({
        where: { hash: input.hash },
      });

      if (!party) {
        // Already gone, so there's nothing left to delete.
        return { deleted: true };
      }

      if (!secretMatches(party.hostKeyHash, input.hostKey)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the browser that started this party can delete it.",
        });
      }

      // Erase the queue on the live server first, so a failure there leaves
      // the party intact and the host can try again.
      const res = await fetchPartyServer(party.hash!, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        log.error("Failed to delete party on the live server", {
          hash: party.hash,
          status: res.status,
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Couldn't delete the party. Please try again.",
        });
      }

      await ctx.db.party.delete({ where: { id: party.id } });

      log.info("Party deleted", { hash: party.hash });
      return { deleted: true };
    }),

  getByHash: publicProcedure
    .input(z.object({ hash: z.string() }))
    .query(async ({ input, ctx }) => {
      const hash = input.hash.trim();

      const party = await ctx.db.party.findUnique({ where: { hash } });
      if (party) return toPublicParty(party);

      // Custom codes are stored lowercase, so "Andy-Party" finds "andy-party".
      const lower = hash.toLowerCase();
      if (lower === hash) return null;

      const lowerParty = await ctx.db.party.findUnique({
        where: { hash: lower },
      });
      return lowerParty ? toPublicParty(lowerParty) : null;
    }),
});
