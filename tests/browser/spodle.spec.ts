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
      window.__spodleSdkTest = {
        player: null,
        confirm(uri, position = 0) {
          const player = this.player;
          player.state = { paused: false, position, duration: 180000, track_window: { current_track: { uri } } };
          player.listeners.player_state_changed?.(player.state);
        }
      };
      window.Spotify = { Player: class {
        constructor() {
          this.listeners = {};
          this.pauseCalls = 0;
          this.state = { paused: true, position: 0, duration: 180000, track_window: { current_track: { uri: null } } };
          window.__spodleSdkTest.player = this;
        }
        addListener(name, callback) { this.listeners[name] = callback; return true; }
        connect() { setTimeout(() => this.listeners.ready?.({ device_id: 'browser-test' }), 0); return Promise.resolve(true); }
        disconnect() {}
        activateElement() { return Promise.resolve(); }
        pause() { this.pauseCalls += 1; this.state = { ...this.state, paused: true }; return Promise.resolve(); }
        resume() { return Promise.resolve(); }
        seek() { return Promise.resolve(); }
        getCurrentState() { return Promise.resolve(this.state); }
      }};
      setTimeout(() => window.onSpotifyWebPlaybackSDKReady?.(), 0);
    `,
  }));
}

async function mockConnectedGame(
  page: Page,
  attemptResponse = activeRound(),
  options: { initialRound?: RoundView; autoConfirmPlayback?: boolean } = {},
): Promise<{ roundRequests: () => number; playbackBodies: () => Array<{ positionMs: number; spotifyUri: string }> }> {
  await page.addInitScript(() => localStorage.clear());
  await page.route("**/api/auth/status", (route) => route.fulfill({ json: { connected: true } }));
  await mockSpotifySdk(page);
  let roundRequests = 0;
  const playbackBodies: Array<{ positionMs: number; spotifyUri: string }> = [];
  await page.route("**/api/game/round", (route) => {
    roundRequests += 1;
    return route.fulfill({ json: options.initialRound ?? activeRound(`round-${roundRequests}`) });
  });
  await page.route("**/api/game/round/*/attempt", (route) => route.fulfill({ json: attemptResponse }));
  await page.route("**/api/spotify/playback", async (route) => {
    const body = route.request().postDataJSON() as { positionMs: number; spotifyUri: string };
    playbackBodies.push(body);
    if (options.autoConfirmPlayback !== false) {
      await page.evaluate((uri) => (window as unknown as { __spodleSdkTest: { confirm: (value: string) => void } }).__spodleSdkTest.confirm(uri), body.spotifyUri);
    }
    await route.fulfill({ json: { ok: true } });
  });
  return { roundRequests: () => roundRequests, playbackBodies: () => playbackBodies };
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
  await page.getByRole("button", { name: "Play song snippet" }).click();
  await expect(page.getByRole("progressbar", { name: "Snippet playback" })).toHaveAttribute("aria-valuenow", "100");
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByText("Skipped", { exact: true })).toBeVisible();
  await expect(page.getByText("Attempt 2")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Snippet playback" })).toHaveAttribute("aria-valuenow", "0");
});

test("snippet timing waits for SDK confirmation and replay always requests position zero", async ({ page }) => {
  const state = await mockConnectedGame(page, activeRound(), { autoConfirmPlayback: false });
  await page.goto("/");
  await expect(page.getByText("Attempt 1")).toBeVisible();

  await page.getByRole("button", { name: "Play song snippet" }).click();
  await expect.poll(() => state.playbackBodies().length).toBe(1);
  await page.waitForTimeout(250);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spodleSdkTest: { player: { pauseCalls: number } } }).__spodleSdkTest.player.pauseCalls)).toBe(1);

  await page.evaluate((uri) => (window as unknown as { __spodleSdkTest: { confirm: (value: string) => void } }).__spodleSdkTest.confirm(uri), activeRound().spotifyUri);
  await expect(page.getByRole("button", { name: "Pause song snippet" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spodleSdkTest: { player: { pauseCalls: number } } }).__spodleSdkTest.player.pauseCalls)).toBe(2);
  await expect(page.getByRole("progressbar", { name: "Snippet playback" })).toHaveAttribute("aria-valuenow", "100");

  await page.getByRole("button", { name: "Play song snippet" }).click();
  await expect.poll(() => state.playbackBodies().length).toBe(2);
  expect(state.playbackBodies().map((body) => body.positionMs)).toEqual([0, 0]);
});

test("one-second playback fills one fifteenth of the fixed timeline", async ({ page }) => {
  const oneSecondRound = { ...activeRound(), attempt: 1, snippetLength: 1 };
  await mockConnectedGame(page, oneSecondRound, { initialRound: oneSecondRound });
  await page.goto("/");
  await page.getByRole("button", { name: "Play song snippet" }).click();
  const progress = page.getByRole("progressbar", { name: "Snippet playback" });
  await expect(progress).toHaveAttribute("aria-valuenow", "1000");
  await expect(progress.locator(".duration-fill")).toHaveAttribute("style", /scaleX\(0\.066666[0-9]*\)/);
  await page.getByRole("button", { name: "Category" }).click();
  await page.getByRole("option", { name: "Pop" }).click();
  await page.getByRole("button", { name: "Start new song" }).click();
  await expect(progress).toHaveAttribute("aria-valuenow", "0");
});

test("the sixth empty attempt says Give up but a selected song still says Submit", async ({ page }) => {
  const finalAttempt = { ...activeRound(), attempt: 5, snippetLength: 15 };
  const gaveUp: RoundView = {
    ...finishedRound,
    attempt: 5,
    won: false,
    attempts: Array.from({ length: 6 }, (_, index) => ({ number: index + 1, outcome: "skipped" as const, label: "Skipped" })),
  };
  await mockConnectedGame(page, gaveUp, { initialRound: finalAttempt });
  await page.route("**/api/spotify/search?*", (route) => route.fulfill({ json: { items: [{
    spotifyTrackId: "1111111111111111111111", isrc: null, title: "Candidate", artistNames: "Test Artist", albumName: "Album",
  }] } }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Give up" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Snippet playback" }).locator(".duration-fill")).toHaveAttribute("style", /scaleX\(0\)/);
  await page.getByRole("combobox", { name: "Search for a song" }).fill("Candidate");
  await page.getByRole("option", { name: /Candidate/ }).click();
  await expect(page.getByRole("button", { name: "Submit" })).toBeVisible();
  await page.getByRole("button", { name: "Clear selected song" }).click();
  await page.getByRole("button", { name: "Give up" }).click();
  await expect(page.getByRole("dialog", { name: "Test Song" })).toBeVisible();
});

test("pool exhaustion has a dedicated state and leaves filters usable", async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.route("**/api/auth/status", (route) => route.fulfill({ json: { connected: true } }));
  await mockSpotifySdk(page);
  let requests = 0;
  await page.route("**/api/game/round", (route) => {
    requests += 1;
    if (requests === 1) return route.fulfill({ status: 409, json: { code: "pool_exhausted", error: "Pool exhausted" } });
    return route.fulfill({ json: activeRound("after-filter-change") });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "You cleared this set." })).toBeVisible();
  await expect(page.getByText(/every available All Music · Normal track/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);

  await page.getByRole("button", { name: "Difficulty" }).click();
  await page.getByRole("option", { name: "Hard" }).click();
  await expect(page.getByText("Attempt 1")).toBeVisible();
  await expect(page.getByRole("button", { name: "Difficulty" })).toContainText("Hard");
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
