import { SignJWT, jwtVerify } from "jose";

const JWT_SECRET = () => new TextEncoder().encode(process.env.JWT_SECRET);

export type AuthJWT = {
  user_id: string;
  email: string;
  name: string;
  image?: string;
  provider: string;
  email_verified?: boolean;
  accept_marketing?: boolean;
};

export async function signJWT(payload: AuthJWT, maxAge = "120d"): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(maxAge)
    .sign(JWT_SECRET());
}

export async function verifyJWT(token: string): Promise<AuthJWT | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET());
    return payload as unknown as AuthJWT;
  } catch {
    return null;
  }
}
