import { log } from "next-axiom";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

export const youtubeRouter = createTRPCRouter({
  search: publicProcedure
    .input(z.object({ keyword: z.string() }))
    .query(async ({ input, ctx }) => {
      log.info("Searching for videos", { keyword: input.keyword });

      // "v2": results now leave out videos that can't be embedded. A new key
      // stops older cached results that still include them from being used.
      const cacheKey = `youtube-search:v2:${input.keyword}`;

      const cachedVideos =
        await ctx.cache.get<ReturnType<typeof ctx.youtube.searchVideo>>(
          cacheKey,
        );

      if (cachedVideos === null) {
        // cache miss
        log.info("Cache miss, searching YouTube API", {
          keyword: input.keyword,
        });

        const videos = await ctx.youtube.searchVideo(input.keyword, 24);

        if (videos) {
          log.info("Storing results in cache for", { keyword: input.keyword });
          await ctx.cache.set(cacheKey, videos, 60 * 60 * 24); // 24h cache
        }

        return videos;
      }

      return cachedVideos;
    }),
});
