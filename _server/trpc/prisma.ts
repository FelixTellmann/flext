/**
 * Instantiates a single instance PrismaClient and save it on the global object.
 * @link https://www.prisma.io/docs/support/help-articles/nextjs-prisma-client-dev-practices
 */
import { PrismaClient } from "@prisma/client";

/*
export const DB = (global as unknown as { prisma: PrismaClient }).prisma ?? new PrismaClient();

if (process.env.NODE_ENV === "development") {
  (global as unknown as { prisma: PrismaClient }).prisma = DB;
}
*/

const prismaGlobal = global as typeof global & {
  prisma?: PrismaClient;
};

export const DB: PrismaClient =
  prismaGlobal.prisma ||
  new PrismaClient({
    // log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  prismaGlobal.prisma = DB;
}
