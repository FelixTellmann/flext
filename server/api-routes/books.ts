import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { prisma } from "server/trpc/prisma";
import { t } from "server/trpc/trpc";
import { z } from "zod";
import { JSONParse } from "utils/json-parse";

export const bookRouter = t.router({
  get: t.procedure.query(async () => {
    const books = await prisma.books.findMany({ take: 1000 });

    return books;
  }),
  add: t.procedure
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
      })
    )
    .mutation(async ({ input }) => {
      const { read, published, name, asin, isbn10, author, author_url, image, url, rating, votes } =
        input;
      const book = await prisma.books.create({
        data: {
          read,
          published,
          name,
          asin,
          isbn10,
          author,
          author_url,
          image,
          url,
          rating,
          votes,
        },
      });

      return book;
    }),
  addMany: t.procedure
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
        })
      )
    )
    .mutation(async ({ input }) => {
      input;
      const book = await prisma.books.createMany({
        data: input,
      });
      return book;
    }),
  upvote: t.procedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      input;
      const book = await prisma.books.update({
        where: {
          id: input.id,
        },
        data: {
          votes: {
            increment: 1,
          },
        },
      });
      return book;
    }),
});
