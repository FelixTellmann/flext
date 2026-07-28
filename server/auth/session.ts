import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { type AuthJWT, signJWT, verifyJWT } from "./jwt";

export const SESSION_COOKIE = "flext_session";

// Must track signJWT's default maxAge of "120d", or the cookie outlives the token
// and produces a signed-in-looking UI that fails every request.
const MAX_AGE_SECONDS = 120 * 24 * 60 * 60;

export async function startSession(payload: AuthJWT): Promise<void> {
  const token = await signJWT(payload);

  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export function endSession(): void {
  deleteCookie(SESSION_COOKIE, { path: "/" });
}

export async function readSession(): Promise<AuthJWT | null> {
  const token = getCookie(SESSION_COOKIE);

  if (!token) {
    return null;
  }

  return verifyJWT(token);
}
