import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ createRound: vi.fn() }));

vi.mock("@/lib/game/round-service", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/game/round-service")>(),
  createRound: mocks.createRound,
}));
vi.mock("@/lib/server/cookies", () => ({ getSessionId: vi.fn(async () => "session") }));
vi.mock("@/lib/db", () => ({ db: { gameTrack: { count: vi.fn() } } }));

import { NoTracksError, PoolExhaustedError } from "@/lib/game/round-service";
import { POST } from "@/app/api/game/round/route";

function request(difficulty = "normal"): NextRequest {
  return new NextRequest("http://127.0.0.1:3000/api/game/round", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category: "all", difficulty }),
  });
}

describe("new-round API pool states", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a machine-readable 409 when the scoped pool is exhausted", async () => {
    mocks.createRound.mockRejectedValue(new PoolExhaustedError());
    const response = await POST(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "pool_exhausted" });
  });

  it("keeps a truly empty pool as the ordinary unavailable-filter response", async () => {
    mocks.createRound.mockRejectedValue(new NoTracksError());
    const response = await POST(request());
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.not.toHaveProperty("code", "pool_exhausted");
  });

  it("passes Unranked through as its own persisted gameplay history scope", async () => {
    mocks.createRound.mockResolvedValue({ id: "unranked-round" });
    const response = await POST(request("unranked"));
    expect(response.status).toBe(200);
    expect(mocks.createRound).toHaveBeenCalledWith("session", "all", "unranked");
  });
});
