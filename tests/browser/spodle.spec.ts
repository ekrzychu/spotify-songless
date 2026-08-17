import { expect, test, type Page } from "@playwright/test";
import type { RoundView } from "../../src/types/game";

const activeRound = (id = "round-one"): RoundView => ({
  id,
  spotifyUri: "spotify:track:0123456789012345678901",
  attempt: 0,
  snippetLength: 0.1,
  finished: false,
  won: false,
  attempts: [],
});

const finishedRound: RoundView = {
  ...activeRound(),
  attempt: 0,
  finished: true,
  won: true,
  attempts: [{ number: 1, outcome: "correct", label: "Test Song — Test Artist" }],
  answer: {
    title: "Test Song", artistNames: "Test Artist", albumName: "Test Album",
    releaseDate: "2020", spotifyUrl: "https://open.spotify.com/track/0123456789012345678901",
    streamCount: "1000000000", difficulty: "easy",
  },
};

async function mockSpotifySdk(page: Page): Promise<void> {
  await page.route("https://sdk.scdn.co/spotify-player.js", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `
      window.Spotify = { Player: class {
        constructor() { this.listeners = {}; }
        addListener(name, callback) { this.listeners[name] = callback; return true; }
        connect() { setTimeout(() => this.listeners.ready?.({ device_id: 'browser-test' }), 0); return Promise.resolve(true); }
        disconnect() {}
        activateElement() { return Promise.resolve(); }
        pause() { return Promise.resolve(); }
        resume() { return Promise.resolve(); }
        seek() { return Promise.resolve(); }
        getCurrentState() { return Promise.resolve({ paused: true, position: 0, duration: 180000 }); }
      }};
      setTimeout(() => window.onSpotifyWebPlaybackSDKReady?.(), 0);
    `,
  }));
}

async function mockConnectedGame(page: Page, attemptResponse = activeRound()): Promise<{ roundRequests: () => number }> {
  await page.addInitScript(() => localStorage.clear());
  await page.route("**/api/auth/status", (route) => route.fulfill({ json: { connected: true } }));
  await mockSpotifySdk(page);
  let roundRequests = 0;
  await page.route("**/api/game/round", (route) => {
    roundRequests += 1;
    return route.fulfill({ json: activeRound(`round-${roundRequests}`) });
  });
  await page.route("**/api/game/round/*/attempt", (route) => route.fulfill({ json: attemptResponse }));
  return { roundRequests: () => roundRequests };
}

test("page hydrates and the connection check resolves to Connect Spotify", async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.route("**/api/auth/status", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 75));
    await route.fulfill({ json: { connected: false } });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "spodle" })).toBeVisible();
  await expect(page.getByText("Checking Spotify connection…")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connect Spotify to play" })).toBeVisible();
});

test("the real session overrides a stale auth callback and the query is cleaned", async ({ page }) => {
  await mockConnectedGame(page);
  await page.goto("/?auth=failed");
  await expect(page.getByText("Spotify is already connected.")).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.has("auth")).toBe(false);
  await expect(page.getByText("Attempt 1")).toBeVisible();
});

test("custom filters are dark, keyboard accessible, and only one opens", async ({ page }) => {
  await mockConnectedGame(page);
  await page.goto("/");
  await expect(page.getByText("Attempt 1")).toBeVisible();

  const category = page.getByRole("button", { name: "Category" });
  await category.press("Enter");
  const listbox = page.getByRole("listbox", { name: "Category" });
  await expect(listbox).toBeVisible();
  const colors = await listbox.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  expect(colors.background).not.toBe("rgb(255, 255, 255)");

  await page.getByRole("option", { name: "All Music" }).press("ArrowDown");
  await expect(page.getByRole("option", { name: "Pop" })).toBeFocused();
  await page.getByRole("option", { name: "Pop" }).press("Enter");
  const confirmation = page.getByRole("dialog", { name: "Start a new song?" });
  await expect(confirmation).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep playing" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeHidden();
  await expect(category).toBeFocused();

  await page.getByRole("button", { name: "Difficulty" }).click();
  await expect(page.getByRole("listbox", { name: "Difficulty" })).toBeVisible();
  await expect(listbox).toBeHidden();
  await page.getByRole("option", { name: "Hard" }).click();
  await page.getByRole("button", { name: "Start new song" }).click();
  await expect(page.getByRole("button", { name: "Difficulty" })).toContainText("Hard");
});

test("Skip advances an attempt", async ({ page }) => {
  await mockConnectedGame(page, {
    ...activeRound(), attempt: 1, snippetLength: 1,
    attempts: [{ number: 1, outcome: "skipped", label: "Skipped" }],
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByText("Skipped", { exact: true })).toBeVisible();
  await expect(page.getByText("Attempt 2")).toBeVisible();
});

test("result dialog owns focus and Next Song starts another round", async ({ page }) => {
  const state = await mockConnectedGame(page, finishedRound);
  await page.goto("/");
  await page.getByRole("button", { name: "Skip" }).click();
  const result = page.getByRole("dialog", { name: "Test Song" });
  await expect(result).toBeVisible();
  await expect(page.getByRole("button", { name: "Next Song" })).toBeFocused();
  await expect(page.locator("main")).toHaveAttribute("inert", "");
  await page.keyboard.press("Escape");
  await expect(result).toBeVisible();
  await page.getByRole("button", { name: "Next Song" }).click();
  await expect(result).toBeHidden();
  expect(state.roundRequests()).toBeGreaterThanOrEqual(2);
});

for (const width of [360, 375, 768, 1366, 1920]) {
  test(`filters remain inside a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockConnectedGame(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Category" }).click();
    const box = await page.getByRole("listbox", { name: "Category" }).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
