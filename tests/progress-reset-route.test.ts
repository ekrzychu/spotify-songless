import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ reset: vi.fn() }));

vi.mock("@/lib/game/selection", () => ({ resetSetProgress: mocks.reset }));
vi.mock("@/lib/server/cookies", () => ({ getSessionId: vi.fn(async () => "session") }));

import { POST } from "@/app/api/game/progress/reset/route";

function request(body: unknown): NextRequest {
  return new NextRequest("http://127.0.0.1:3000/api/game/progress/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("set progress reset route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reset.mockResolvedValue(7);
  });

  it("resets only the authenticated session's selected set", async () => {
    const response = await POST(request({ category: "rock", difficulty: "normal" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deletedRounds: 7 });
    expect(mocks.reset).toHaveBeenCalledWith({ sessionId: "session", category: "rock", difficulty: "normal" });
  });

  it("rejects an invalid set without deleting anything", async () => {
    const response = await POST(request({ category: "rock", difficulty: "legendary" }));
    expect(response.status).toBe(400);
    expect(mocks.reset).not.toHaveBeenCalled();
  });
});
