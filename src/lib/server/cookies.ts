import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";

const baseCookie = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export async function getSessionId(): Promise<string> {
  const store = await cookies();
  const existing = store.get("nd_session")?.value;
  if (existing) return existing;
  const sessionId = randomBytes(24).toString("base64url");
  store.set("nd_session", sessionId, { ...baseCookie, maxAge: 60 * 60 * 24 * 30 });
  return sessionId;
}

export { baseCookie };
