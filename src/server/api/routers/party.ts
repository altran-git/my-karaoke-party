import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { log } from "next-axiom";
import { z } from "zod";
import { fetchPartyServer } from "~/server/party-server";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  normalizeCustomCode,
  validateCustomCode,
} from "~/server/utils/sqids";

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

      let party;
      try {
        party = await ctx.db.party.createWithHash({
          name: input.name,
          hash: customCode,
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

      log.info("Party created", { party });
      return party;
    }),

  getByHash: publicProcedure
    .input(z.object({ hash: z.string() }))
    .query(async ({ input, ctx }) => {
      const hash = input.hash.trim();

      const party = await ctx.db.party.findUnique({ where: { hash } });
      if (party) return party;

      // Custom codes are stored lowercase, so "Andy-Party" finds "andy-party".
      const lower = hash.toLowerCase();
      if (lower === hash) return null;

      return ctx.db.party.findUnique({ where: { hash: lower } });
    }),
});
