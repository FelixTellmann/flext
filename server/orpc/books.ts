import { os } from "@orpc/server";
import { db } from "@server/db/drizzle";
import { books } from "@server/db/schema";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

export const booksProcedures = {
  get: os.handler(async () => {
    return db.select().from(books).limit(1000);
  }),

  add: os
    .input(
      z.object({
        read: z.boolean().optional(),
        published: z.boolean().optional(),
        name: z.string(),
        asin: z.string().optional(),
        isbn10: z.string().optional(),
        author: z.string().optional(),
        author_url: z.string().optional(),
        image: z.string().optional(),
        url: z.string().optional(),
        rating: z.number().optional(),
        votes: z.number().optional(),
      }),
    )
    .handler(async ({ input }) => {
      const result = await db.insert(books).values({ ...input, updatedAt: new Date() });
      return result;
    }),

  addMany: os
    .input(
      z.array(
        z.object({
          read: z.boolean(),
          published: z.boolean(),
          name: z.string(),
          asin: z.string().optional(),
          isbn10: z.string().optional(),
          author: z.string().optional(),
          author_url: z.string().optional(),
          image: z.string().optional(),
          url: z.string().optional(),
          rating: z.number().optional(),
          votes: z.number().optional(),
        }),
      ),
    )
    .handler(async ({ input }) => {
      const result = await db.insert(books).values(input.map((item) => ({ ...item, updatedAt: new Date() })));
      return result;
    }),

  upvote: os.input(z.object({ id: z.string() })).handler(async ({ input }) => {
    return db
      .update(books)
      .set({ votes: sql`${books.votes} + 1` })
      .where(eq(books.id, input.id));
  }),
};
