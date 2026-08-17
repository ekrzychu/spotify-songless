export type OAuthAttempt = {
  state: string;
  verifier: string;
  expiresAt: number;
};

export type OAuthAttemptStore = { version: 1; attempts: OAuthAttempt[] };

const MAX_ATTEMPTS = 5;

export function parseOAuthAttemptStore(value: unknown, now = Date.now()): OAuthAttemptStore {
  if (isStore(value)) return { version: 1, attempts: prune(value.attempts, now) };
  // Preserve an authorization that started immediately before this upgrade.
  if (isAttemptShape(value)) {
    return { version: 1, attempts: [{ ...value, expiresAt: now + 10 * 60_000 }] };
  }
  return { version: 1, attempts: [] };
}

export function addOAuthAttempt(
  store: OAuthAttemptStore,
  attempt: OAuthAttempt,
  now = Date.now(),
): OAuthAttemptStore {
  const attempts = [...prune(store.attempts, now).filter((item) => item.state !== attempt.state), attempt];
  return { version: 1, attempts: attempts.slice(-MAX_ATTEMPTS) };
}

export function consumeOAuthAttempt(
  store: OAuthAttemptStore,
  returnedState: string,
  now = Date.now(),
): { attempt: OAuthAttempt | null; remaining: OAuthAttemptStore; reason?: "mismatch" | "expired" } {
  const matching = store.attempts.find((attempt) => attempt.state === returnedState);
  const remaining = {
    version: 1 as const,
    attempts: prune(store.attempts.filter((attempt) => attempt.state !== returnedState), now),
  };
  if (!matching) return { attempt: null, remaining, reason: "mismatch" };
  if (matching.expiresAt <= now) return { attempt: null, remaining, reason: "expired" };
  return { attempt: matching, remaining };
}

function prune(attempts: OAuthAttempt[], now: number): OAuthAttempt[] {
  return attempts.filter((attempt) => attempt.expiresAt > now);
}

function isStore(value: unknown): value is OAuthAttemptStore {
  return Boolean(
    value && typeof value === "object"
    && (value as { version?: unknown }).version === 1
    && Array.isArray((value as { attempts?: unknown }).attempts)
    && (value as { attempts: unknown[] }).attempts.every(isFullAttempt),
  );
}

function isAttemptShape(value: unknown): value is Omit<OAuthAttempt, "expiresAt"> {
  return Boolean(value && typeof value === "object"
    && typeof (value as { state?: unknown }).state === "string"
    && typeof (value as { verifier?: unknown }).verifier === "string");
}

function isFullAttempt(value: unknown): value is OAuthAttempt {
  return isAttemptShape(value) && typeof (value as { expiresAt?: unknown }).expiresAt === "number";
}
