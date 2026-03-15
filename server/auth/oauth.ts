export type OAuthProvider = "github" | "google" | "twitter" | "facebook";

type OAuthConfig = {
  authUrl: string;
  tokenUrl: string;
  profileUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
};

export function getProviderConfig(provider: OAuthProvider): OAuthConfig {
  switch (provider) {
    case "github":
      return {
        authUrl: "https://github.com/login/oauth/authorize",
        tokenUrl: "https://github.com/login/oauth/access_token",
        profileUrl: "https://api.github.com/user",
        clientId: process.env.GITHUB_ID!,
        clientSecret: process.env.GITHUB_SECRET!,
        scopes: ["read:user", "user:email"],
      };
    case "google":
      return {
        authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        profileUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        scopes: ["openid", "email", "profile"],
      };
    case "twitter":
      return {
        authUrl: "https://api.twitter.com/oauth/authenticate",
        tokenUrl: "https://api.twitter.com/oauth/access_token",
        profileUrl: "https://api.twitter.com/1.1/account/verify_credentials.json",
        clientId: process.env.TWITTER_CLIENT_ID!,
        clientSecret: process.env.TWITTER_CLIENT_SECRET!,
        scopes: [],
      };
    case "facebook":
      return {
        authUrl: "https://www.facebook.com/v18.0/dialog/oauth",
        tokenUrl: "https://graph.facebook.com/v18.0/oauth/access_token",
        profileUrl: "https://graph.facebook.com/me?fields=id,name,email,picture",
        clientId: process.env.FACEBOOK_CLIENT_ID!,
        clientSecret: process.env.FACEBOOK_CLIENT_SECRET!,
        scopes: ["email", "public_profile"],
      };
  }
}

export function buildAuthorizationUrl(provider: OAuthProvider, redirectUri: string, state: string): string {
  const config = getProviderConfig(provider);

  if (provider === "twitter") {
    // TODO: Twitter OAuth 1.0a requires separate implementation with oauth-1.0a signing
    throw new Error("Twitter OAuth 1.0a requires separate implementation");
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: config.scopes.join(" "),
    state,
  });

  return `${config.authUrl}?${params.toString()}`;
}

export async function exchangeCodeForToken(
  provider: OAuthProvider,
  code: string,
  redirectUri: string,
): Promise<{ access_token: string; [key: string]: unknown }> {
  const config = getProviderConfig(provider);

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  return response.json();
}

export async function fetchUserProfile(
  provider: OAuthProvider,
  accessToken: string,
): Promise<{ id: string; email: string; name: string; image?: string }> {
  const config = getProviderConfig(provider);

  const response = await fetch(config.profileUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await response.json();

  switch (provider) {
    case "github":
      return { id: String(data.id), email: data.email, name: data.name || data.login, image: data.avatar_url };
    case "google":
      return { id: data.id, email: data.email, name: data.name, image: data.picture };
    case "facebook":
      return { id: data.id, email: data.email, name: data.name, image: data.picture?.data?.url };
    default:
      return { id: data.id, email: data.email, name: data.name };
  }
}
