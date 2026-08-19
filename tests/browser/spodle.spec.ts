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
  setProgress: { completed: 0, total: 81 },
});

const finishedRound: RoundView = {
  ...activeRound(),
  attempt: 0,
  finished: true,
  won: true,
  setProgress: { completed: 1, total: 81 },
  attempts: [{ number: 1, outcome: "correct", label: "Test Song — Test Artist" }],
  answer: {
    title: "Test Song", artistNames: "Test Artist", albumName: "Test Album",
    releaseDate: "2020", spotifyUrl: "https://open.spotify.com/track/0123456789012345678901",
    streamCount: "1000000000", difficulty: "easy",
  },
};

const unrankedFinishedRound: RoundView = {
  ...finishedRound,
  answer: {
    ...finishedRound.answer!,
    streamCount: null,
    difficulty: "unranked",
  },
};

async function mockSpotifySdk(page: Page): Promise<void> {
  await page.route("https://sdk.scdn.co/spotify-player.js", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `
      window.__spodleSdkTest = {
        player: null,
        instances: 0,
        initialVolumes: [],
        events: [],
        confirm(uri, position = 0) {
          const player = this.player;
          setTimeout(() => {
            player.positionBase = position;
            player.startedAt = performance.now();
            player.state = { paused: false, position, duration: 180000, disallows: {}, track_window: { current_track: {
              id: uri.split(':').at(-1), uri, name: 'Test Song', artists: [{ name: 'Test Artist' }],
              album: { name: 'Test Album', images: [{ url: 'https://i.scdn.co/image/browsercover123', width: 640, height: 640 }] }
            } } };
            player.listeners.player_state_changed?.(player.state);
          }, 25);
        },
        firePlaybackError(message) { this.player.listeners.playback_error?.({ message }); }
      };
      window.Spotify = { Player: class {
        constructor(options) {
          this.listeners = {};
          this.pauseCalls = 0;
          this.resumeCalls = 0;
          this.seekCalls = [];
          this.setVolumeCalls = [];
          this.volume = options.volume;
          this.startedAt = 0;
          this.positionBase = 0;
          this.state = { paused: true, position: 0, duration: 180000, disallows: {}, track_window: { current_track: { uri: null } } };
          window.__spodleSdkTest.instances += 1;
          window.__spodleSdkTest.initialVolumes.push(options.volume);
          window.__spodleSdkTest.player = this;
        }
        addListener(name, callback) { this.listeners[name] = callback; return true; }
        connect() { setTimeout(() => this.listeners.ready?.({ device_id: 'browser-test' }), 0); return Promise.resolve(true); }
        disconnect() {}
        activateElement() { window.__spodleSdkTest.events.push('activate'); return Promise.resolve(); }
        pause() {
          this.pauseCalls += 1;
          setTimeout(() => {
            if (!this.state.paused) this.state = { ...this.state, position: this.positionBase + performance.now() - this.startedAt };
            this.state = { ...this.state, paused: true };
            this.listeners.player_state_changed?.(this.state);
          }, 20);
          return Promise.resolve();
        }
        resume() {
          this.resumeCalls += 1;
          setTimeout(() => {
            this.positionBase = this.state.position;
            this.startedAt = performance.now();
            this.state = { ...this.state, paused: false };
            this.listeners.player_state_changed?.(this.state);
          }, 20);
          return Promise.resolve();
        }
        seek(position) {
          this.seekCalls.push(position);
          setTimeout(() => {
            this.state = { ...this.state, position };
            this.listeners.player_state_changed?.(this.state);
          }, 20);
          return Promise.resolve();
        }
        getVolume() { return Promise.resolve(this.volume); }
        setVolume(volume) { this.setVolumeCalls.push(volume); this.volume = volume; return Promise.resolve(); }
        getCurrentState() {
          if (!this.state.paused) this.state = { ...this.state, position: this.positionBase + performance.now() - this.startedAt };
          return Promise.resolve(this.state);
        }
      }};
      setTimeout(() => window.onSpotifyWebPlaybackSDKReady?.(), 0);
    `,
  }));
}

async function mockConnectedGame(
  page: Page,
  attemptResponse = activeRound(),
  options: { initialRound?: RoundView; autoConfirmPlayback?: boolean } = {},
): Promise<{
  roundRequests: () => number;
  roundBodies: () => Array<{ category: string; difficulty: string }>;
  playbackBodies: () => Array<{ positionMs: number; spotifyUri: string }>;
  resetRequests: () => number;
}> {
  await page.addInitScript(() => localStorage.clear());
  await page.route("**/api/auth/status", (route) => route.fulfill({ json: { connected: true } }));
  await mockSpotifySdk(page);
  let roundRequests = 0;
  const roundBodies: Array<{ category: string; difficulty: string }> = [];
  const playbackBodies: Array<{ positionMs: number; spotifyUri: string }> = [];
  let resetRequests = 0;
  await page.route("**/api/game/round", (route) => {
    roundRequests += 1;
    roundBodies.push(route.request().postDataJSON() as { category: string; difficulty: string });
    return route.fulfill({ json: options.initialRound ?? activeRound(roundRequests === 1 ? "round-one" : `round-${roundRequests}`) });
  });
  await page.route("**/api/game/round/*/attempt", (route) => route.fulfill({ json: attemptResponse }));
  await page.route("**/api/game/progress/reset", (route) => {
    resetRequests += 1;
    return route.fulfill({ json: { deletedRounds: 4 } });
  });
  await page.route("**/api/spotify/playback", async (route) => {
    const body = route.request().postDataJSON() as { positionMs: number; spotifyUri: string };
    playbackBodies.push(body);
    await page.evaluate(() => (window as unknown as { __spodleSdkTest: { events: string[] } }).__spodleSdkTest.events.push("remote-play"));
    if (options.autoConfirmPlayback !== false) {
      await page.evaluate((uri) => (window as unknown as { __spodleSdkTest: { confirm: (value: string) => void } }).__spodleSdkTest.confirm(uri), body.spotifyUri);
    }
    await route.fulfill({ json: { ok: true } });
  });
  return {
    roundRequests: () => roundRequests,
    roundBodies: () => roundBodies,
    playbackBodies: () => playbackBodies,
    resetRequests: () => resetRequests,
  };
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

test("category and exposed difficulty controls are dark and keyboard accessible", async ({ page }) => {
  const state = await mockConnectedGame(page);
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

  await expect(page.getByRole("button", { name: "Normal", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Unranked", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Unranked", exact: true }).click();
  await page.getByRole("button", { name: "Start new song" }).click();
  await expect(page.getByRole("button", { name: "Unranked", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => state.roundBodies().at(-1)?.difficulty).toBe("unranked");
  await expect(listbox).toBeHidden();
});

test("ranked difficulties apply their centralized gameplay accent themes", async ({ page }) => {
  await mockConnectedGame(page);
  await page.goto("/");
  await expect(page.getByText("Attempt 1")).toBeVisible();

  for (const [difficulty, accent] of [
    ["Easy", "#a9dc63"],
    ["Normal", "#f1c75b"],
    ["Hard", "#ef9446"],
    ["Extreme", "#eb6965"],
    ["Impossible", "#b88cf2"],
  ] as const) {
    const button = page.getByRole("button", { name: difficulty, exact: true });
    if (await button.getAttribute("aria-pressed") !== "true") {
      await button.click();
      await page.getByRole("button", { name: "Start new song" }).click();
    }
    await expect(page.locator(".app-theme")).toHaveAttribute("data-difficulty", difficulty.toLowerCase());
    await expect.poll(() => page.locator(".app-theme").evaluate((element) => (
      getComputedStyle(element).getPropertyValue("--game-accent").trim()
    ))).toBe(accent);
  }
});

test("only active genres and decades remain selectable", async ({ page }) => {
  await mockConnectedGame(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Category" }).click();

  for (const removed of ["Indie / Alternative", "Metal", "Punk", "Country", "Jazz"]) {
    await expect(page.getByRole("option", { name: removed, exact: true })).toHaveCount(0);
  }
  for (const active of ["Pop", "Rock", "Hip-Hop / Rap", "R&B / Soul", "Electronic / Dance", "Classical", "70s", "80s", "90s", "2000s", "2010s", "2020s"]) {
    await expect(page.getByRole("option", { name: active, exact: true })).toBeVisible();
  }
});

test("a retired saved jazz filter is repaired and persisted as All Music", async ({ page }) => {
  const state = await mockConnectedGame(page);
  await page.addInitScript(() => localStorage.setItem("spodle:filters", JSON.stringify({ category: "jazz", difficulty: "normal" })));
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Category" })).toContainText("All Music");
  await expect.poll(() => state.roundBodies().at(0)?.category).toBe("all");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("spodle:filters") ?? "{}"))).toEqual({
    category: "all",
    difficulty: "normal",
  });
});

test("volume defaults to 65 and user changes stay local", async ({ page }) => {
  const state = await mockConnectedGame(page);
  await page.goto("/");
  await expect(page.getByText("Attempt 1")).toBeVisible();
  const volume = page.getByRole("slider", { name: "Volume" });
  await expect(volume).toHaveValue("65");
  await expect(page.locator(".volume-control > span")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __spodleSdkTest: { initialVolumes: number[] } }).__spodleSdkTest.initialVolumes)).toEqual([0.65]);

  for (const [percent, sdkVolume] of [[0, 0], [65, 0.65], [100, 1]] as const) {
    await volume.fill(String(percent));
    await expect(volume).toHaveAttribute("aria-valuetext", `${percent}%`);
    await expect.poll(() => page.evaluate(() => {
      const sdk = (window as unknown as { __spodleSdkTest: { player: { setVolumeCalls: number[] } } }).__spodleSdkTest;
      return sdk.player.setVolumeCalls.at(-1);
    })).toBe(sdkVolume);
  }

  expect(await page.evaluate(() => localStorage.getItem("spodle:volume"))).toBe("100");
  expect(await page.evaluate(() => (window as unknown as { __spodleSdkTest: { instances: number } }).__spodleSdkTest.instances)).toBe(1);
  expect(state.roundRequests()).toBe(1);
  expect(state.playbackBodies()).toEqual([]);
});

test("volume keyboard input stays local and does not trigger the Space playback shortcut", async ({ page }) => {
  const state = await mockConnectedGame(page);
  await page.goto("/");
  const volume = page.getByRole("slider", { name: "Volume" });
  await volume.fill("65");
  await volume.focus();
  await volume.press("ArrowRight");
  await expect(volume).toHaveValue("66");
  await expect.poll(() => page.evaluate(() => {
    const sdk = (window as unknown as { __spodleSdkTest: { player: { setVolumeCalls: number[] } } }).__spodleSdkTest;
    return sdk.player.setVolumeCalls.at(-1);
  })).toBe(0.66);
  await volume.press("Space");
  expect(state.playbackBodies()).toEqual([]);
});

test("stored volume initializes the SDK without recreating the player", async ({ page }) => {
  await mockConnectedGame(page);
  await page.addInitScript(() => localStorage.setItem("spodle:volume", "37"));
  await page.goto("/");
  await expect(page.getByRole("slider", { name: "Volume" })).toHaveValue("37");
  expect(await page.evaluate(() => (window as unknown as { __spodleSdkTest: { initialVolumes: number[]; instances: number } }).__spodleSdkTest)).toMatchObject({
    initialVolumes: [0.37],
    instances: 1,
  });
});

test("development playback errors retain Spotify's exact message", async ({ page }) => {
  const consoleMessages: string[] = [];
  page.on("console", (message) => consoleMessages.push(message.text()));
  const state = await mockConnectedGame(page, activeRound(), { autoConfirmPlayback: false });
  await page.goto("/");
  await page.getByRole("button", { name: "Play song snippet" }).click();
  await expect.poll(() => state.playbackBodies().length).toBe(1);
  await page.evaluate(() => {
    (window as unknown as { __spodleSdkTest: { firePlaybackError: (message: string) => void } })
      .__spodleSdkTest.firePlaybackError("Mock Spotify playback failure");
  });

  await expect(page.getByText("Spotify playback failed: Mock Spotify playback failure")).toBeVisible();
  await expect.poll(() => consoleMessages.some((message) => message.includes("[spodle spotify playback_error]"))).toBe(true);
  await expect(page.getByText("This track could not be played.")).toHaveCount(0);
});

test("Play and Pause keep the same prominent circular geometry", async ({ page }) => {
  const oneSecondRound = { ...activeRound(), attempt: 1, snippetLength: 1 };
  await mockConnectedGame(page, oneSecondRound, { initialRound: oneSecondRound });
  await page.goto("/");
  const play = page.getByRole("button", { name: "Play song snippet" });
  const playBox = await play.boundingBox();
  expect(playBox).not.toBeNull();
  expect(playBox!.width).toBeGreaterThanOrEqual(118);
  expect(playBox!.width).toBeLessThanOrEqual(130);
  expect(playBox!.height).toBe(playBox!.width);

  await play.click();
  const pause = page.getByRole("button", { name: "Pause song snippet" });
  await expect(pause).toBeVisible();
  const pauseBox = await pause.boundingBox();
  expect(pauseBox).not.toBeNull();
  expect(pauseBox!.width).toBe(playBox!.width);
  expect(pauseBox!.height).toBe(playBox!.height);
});

test("rapid double Play sends only one initial remote start request", async ({ page }) => {
  const state = await mockConnectedGame(page);
  await page.goto("/");
  const play = page.getByRole("button", { name: "Play song snippet" });
  await play.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  await expect.poll(() => state.playbackBodies().length).toBe(1);
  await page.waitForTimeout(250);
  expect(state.playbackBodies()).toHaveLength(1);
});

test("user activation is invoked synchronously before the remote play request", async ({ page }) => {
  const remotePauseRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/spotify/playback/pause")) remotePauseRequests.push(request.url());
  });
  await mockConnectedGame(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Play song snippet" }).click();
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { __spodleSdkTest: { events: string[] } }
  ).__spodleSdkTest.events)).toEqual(["activate", "remote-play"]);
  await page.waitForTimeout(1_200);
  expect(remotePauseRequests).toEqual([]);
});

test("the normal play area shows duration without transport status copy", async ({ page }) => {
  await mockConnectedGame(page);
  await page.goto("/");
  await expect(page.locator(".snippet-duration")).toHaveText("0.1s");
  await expect(page.getByText(/Play 0\.1s intro|Preparing Spotify|Stopping Spotify/)).toHaveCount(0);
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

test("Skip during playback continues the same run to the next absolute endpoint", async ({ page }) => {
  const nextRound = {
    ...activeRound(), attempt: 1, snippetLength: 1,
    attempts: [{ number: 1, outcome: "skipped" as const, label: "Skipped" }],
  };
  const state = await mockConnectedGame(page, nextRound);
  await page.goto("/");
  await page.getByRole("button", { name: "Play song snippet" }).click();
  await expect(page.getByRole("button", { name: "Pause song snippet" })).toBeVisible();
  const before = await page.evaluate(() => {
    const player = (window as unknown as { __spodleSdkTest: { player: { resumeCalls: number; seekCalls: number[] } } }).__spodleSdkTest.player;
    return { resume: player.resumeCalls, seek: player.seekCalls.length };
  });
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByText("Attempt 2")).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const player = (window as unknown as { __spodleSdkTest: { player: { resumeCalls: number; seekCalls: number[] } } }).__spodleSdkTest.player;
    return { resume: player.resumeCalls, seek: player.seekCalls.length };
  })).toEqual(before);
  expect(state.playbackBodies()).toHaveLength(1);
});

test("a failed Skip request safely stops the optimistically extended transport", async ({ page }) => {
  await mockConnectedGame(page);
  await page.route("**/api/game/round/*/attempt", (route) => route.fulfill({ status: 500, json: { error: "Mock attempt failure" } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Play song snippet" }).click();
  await expect(page.getByRole("button", { name: "Pause song snippet" })).toBeVisible();
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByText("Mock attempt failure")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { __spodleSdkTest: { player: { state: { paused: boolean } } } }
  ).__spodleSdkTest.player.state.paused)).toBe(true);
});

test("first play primes remotely and replay uses the same local snippet lifecycle", async ({ page }) => {
  const state = await mockConnectedGame(page, activeRound(), { autoConfirmPlayback: false });
  await page.goto("/");
  await expect(page.getByText("Attempt 1")).toBeVisible();

  await page.getByRole("button", { name: "Play song snippet" }).click();
  await expect.poll(() => state.playbackBodies().length).toBe(1);
  await page.waitForTimeout(250);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spodleSdkTest: { player: { pauseCalls: number } } }).__spodleSdkTest.player.pauseCalls)).toBe(0);

  await page.evaluate((uri) => (window as unknown as { __spodleSdkTest: { confirm: (value: string) => void } }).__spodleSdkTest.confirm(uri), activeRound().spotifyUri);
  await expect(page.getByRole("button", { name: "Pause song snippet" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spodleSdkTest: { player: { pauseCalls: number } } }).__spodleSdkTest.player.pauseCalls)).toBe(2);
  await expect(page.getByRole("progressbar", { name: "Snippet playback" })).toHaveAttribute("aria-valuenow", "100");

  await page.getByRole("button", { name: "Play song snippet" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spodleSdkTest: { player: { resumeCalls: number } } }).__spodleSdkTest.player.resumeCalls)).toBe(2);
  expect(state.playbackBodies().map((body) => body.positionMs)).toEqual([0]);
  expect(await page.evaluate(() => (window as unknown as { __spodleSdkTest: { player: { seekCalls: number[] } } }).__spodleSdkTest.player.seekCalls)).toEqual([0, 0]);
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
  const state = await mockConnectedGame(page, gaveUp, { initialRound: finalAttempt });
  await page.route("**/api/game/search?*", (route) => route.fulfill({ json: { items: [{
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
  const result = page.getByRole("dialog", { name: "Test Song" });
  await expect(result).toBeVisible();
  await expect(result.getByText("Not solved")).toBeVisible();
  await expect.poll(() => state.playbackBodies().length).toBe(1);
  expect(state.playbackBodies()[0]).toMatchObject({ positionMs: 0, spotifyUri: finishedRound.spotifyUri });
});

test("a correct guess triggers one 15-second answer playback from zero", async ({ page }) => {
  const state = await mockConnectedGame(page, finishedRound);
  await page.route("**/api/game/search?*", (route) => route.fulfill({ json: { items: [{
    spotifyTrackId: "0123456789012345678901", isrc: null, title: "Test Song", artistNames: "Test Artist", albumName: "Test Album",
  }] } }));
  await page.goto("/");
  await page.getByRole("combobox", { name: "Search for a song" }).fill("Test Song");
  await page.getByRole("option", { name: /Test Song/ }).click();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByRole("dialog", { name: "Test Song" })).toBeVisible();
  await expect.poll(() => state.playbackBodies().length).toBe(1);
  expect(state.playbackBodies()[0]).toMatchObject({ positionMs: 0, spotifyUri: finishedRound.spotifyUri });
});

test("an ordinary wrong attempt does not trigger answer playback", async ({ page }) => {
  const wrongRound: RoundView = {
    ...activeRound(), attempt: 1, snippetLength: 1,
    attempts: [{ number: 1, outcome: "incorrect", label: "Wrong Song — Wrong Artist" }],
  };
  const state = await mockConnectedGame(page, wrongRound);
  await page.goto("/");
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByText("Attempt 2")).toBeVisible();
  expect(state.playbackBodies()).toEqual([]);
});

test("a final incorrect submission triggers one answer playback", async ({ page }) => {
  const finalAttempt = { ...activeRound(), attempt: 5, snippetLength: 15 };
  const lostRound: RoundView = {
    ...finishedRound,
    attempt: 5,
    won: false,
    attempts: Array.from({ length: 6 }, (_, index) => ({
      number: index + 1,
      outcome: index === 5 ? "incorrect" as const : "skipped" as const,
      label: index === 5 ? "Wrong Song — Wrong Artist" : "Skipped",
    })),
  };
  const state = await mockConnectedGame(page, lostRound, { initialRound: finalAttempt });
  await page.route("**/api/game/search?*", (route) => route.fulfill({ json: { items: [{
    spotifyTrackId: "1111111111111111111111", isrc: null, title: "Wrong Song", artistNames: "Wrong Artist", albumName: "Album",
  }] } }));
  await page.goto("/");
  await page.getByRole("combobox", { name: "Search for a song" }).fill("Wrong Song");
  await page.getByRole("option", { name: /Wrong Song/ }).click();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByRole("dialog", { name: "Test Song" })).toBeVisible();
  await expect.poll(() => state.playbackBodies().length).toBe(1);
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
  await expect(page.getByRole("heading", { name: "You've played every available song." })).toBeVisible();
  await expect(page.getByText("Set complete")).toBeVisible();
  await expect(page.getByText(/All Music · Normal/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);

  await page.getByRole("button", { name: "Hard", exact: true }).click();
  await expect(page.getByText("Attempt 1")).toBeVisible();
  await expect(page.getByRole("button", { name: "Hard", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("result dialog owns focus and its Next Song starts another round", async ({ page }) => {
  const state = await mockConnectedGame(page, finishedRound);
  await page.goto("/");
  await page.getByRole("button", { name: "Skip" }).click();
  const result = page.getByRole("dialog", { name: "Test Song" });
  await expect(result).toBeVisible();
  await expect(result.locator(".result-artwork")).toBeVisible();
  await expect(result.locator(".result-artwork img")).toHaveAttribute("src", "https://i.scdn.co/image/browsercover123");
  await expect(result.getByText("It was...")).toBeVisible();
  await expect(result.getByText("Solved in 1 / 6")).toBeVisible();
  await expect.poll(() => state.playbackBodies().length).toBe(1);
  await expect(page.getByRole("button", { name: "Next Song" })).toBeFocused();
  await expect(page.locator("main")).toHaveAttribute("inert", "");
  await page.getByRole("button", { name: "Next Song" }).click();
  await expect(result).toBeHidden();
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { __spodleSdkTest: { player: { state: { paused: boolean } } } }
  ).__spodleSdkTest.player.state.paused)).toBe(true);
  expect(state.roundRequests()).toBeGreaterThanOrEqual(2);
});

test("closing a result preserves the finished round and exposes the main Next Song", async ({ page }) => {
  const state = await mockConnectedGame(page, finishedRound);
  await page.goto("/");
  await page.getByRole("button", { name: "Skip" }).click();
  const result = page.getByRole("dialog", { name: "Test Song" });
  await expect(result).toBeVisible();
  const pauseCallsBeforeDismiss = await page.evaluate(() => (
    window as unknown as { __spodleSdkTest: { player: { pauseCalls: number } } }
  ).__spodleSdkTest.player.pauseCalls);
  const requestsBeforeDismiss = state.roundRequests();

  const close = result.getByRole("button", { name: "Close result" });
  await expect(close).toHaveCSS("width", "38px");
  await expect(close).toHaveCSS("height", "38px");
  await close.click();

  await expect(result).toBeHidden();
  await expect(page.locator("main")).not.toHaveAttribute("inert", "");
  await expect(page.locator(".attempt-list")).toContainText("Test Song");
  await expect(page.locator(".set-progress")).toContainText("1 / 81");
  const mainNext = page.locator("main").getByRole("button", { name: "Next Song" });
  await expect(mainNext).toBeVisible();
  await expect(mainNext).toBeFocused();
  expect(state.roundRequests()).toBe(requestsBeforeDismiss);
  expect(await page.evaluate(() => (
    window as unknown as { __spodleSdkTest: { player: { pauseCalls: number } } }
  ).__spodleSdkTest.player.pauseCalls)).toBe(pauseCallsBeforeDismiss);

  await mainNext.click();
  await expect(page.getByText("Attempt 1")).toBeVisible();
  await expect.poll(() => state.roundRequests()).toBeGreaterThan(requestsBeforeDismiss);
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { __spodleSdkTest: { player: { state: { paused: boolean } } } }
  ).__spodleSdkTest.player.state.paused)).toBe(true);
});

test("dismissing one result does not suppress the next round's result", async ({ page }) => {
  await mockConnectedGame(page, finishedRound);
  const secondFinishedRound: RoundView = {
    ...finishedRound,
    id: "round-2",
    answer: { ...finishedRound.answer!, title: "Second Song" },
  };
  await page.route("**/api/game/round/*/attempt", (route) => route.fulfill({
    json: route.request().url().includes("round-2") ? secondFinishedRound : finishedRound,
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("dialog", { name: "Test Song" }).getByRole("button", { name: "Close result" }).click();
  await page.locator("main").getByRole("button", { name: "Next Song" }).click();
  await expect(page.getByText("Attempt 1")).toBeVisible();
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByRole("dialog", { name: "Second Song" })).toBeVisible();
});

test("a win offers the next difficulty, keeps category, and safely starts a new round", async ({ page }) => {
  const state = await mockConnectedGame(page, finishedRound);
  await page.goto("/");
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByRole("button", { name: "Try higher difficulty" })).toBeVisible();
  await page.getByRole("button", { name: "Try higher difficulty" }).click();
  await expect.poll(() => state.roundBodies().at(-1)).toEqual({ category: "all", difficulty: "hard" });
  await expect(page.getByRole("button", { name: "Hard", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("losses do not offer higher difficulty", async ({ page }) => {
  await mockConnectedGame(page, { ...finishedRound, won: false });
  await page.goto("/");
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByRole("button", { name: "Try higher difficulty" })).toHaveCount(0);
});

test("set progress is visible and reset confirms before clearing only the current set", async ({ page }) => {
  const state = await mockConnectedGame(page);
  await page.goto("/");
  await expect(page.locator(".set-progress")).toContainText("0 / 81");
  await page.locator(".set-progress").getByRole("button", { name: "Reset" }).click();
  const dialog = page.getByRole("dialog", { name: "Reset this set?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Reset progress" }).click();
  await expect.poll(() => state.resetRequests()).toBe(1);
  await expect.poll(() => state.roundRequests()).toBeGreaterThanOrEqual(2);
});

test("restoring a previously finished round does not autoplay its answer", async ({ page }) => {
  const state = await mockConnectedGame(page);
  await page.addInitScript(() => localStorage.setItem("spodle:round", JSON.stringify({
    id: "round-one", category: "all", difficulty: "normal",
  })));
  await page.route("**/api/game/round/round-one", (route) => route.fulfill({ json: finishedRound }));
  await page.goto("/");
  await expect(page.getByRole("dialog", { name: "Test Song" })).toBeVisible();
  await expect(page.locator(".result-artwork img")).toHaveCount(0);
  await expect(page.locator(".result-artwork--placeholder")).toBeVisible();
  await page.waitForTimeout(250);
  expect(state.playbackBodies()).toEqual([]);
});

test("refresh restores the active unfinished round without consuming another song", async ({ page }) => {
  const state = await mockConnectedGame(page);
  await page.addInitScript(() => localStorage.setItem("spodle:round", JSON.stringify({
    id: "round-one", category: "all", difficulty: "normal",
  })));
  await page.route("**/api/game/round/round-one", (route) => route.fulfill({ json: activeRound() }));
  await page.goto("/");
  await expect(page.getByText("Attempt 1")).toBeVisible();
  expect(state.roundRequests()).toBe(0);
});

test("an Unranked result labels missing stream data without displaying zero", async ({ page }) => {
  await mockConnectedGame(page, unrankedFinishedRound);
  await page.addInitScript(() => localStorage.setItem("spodle:filters", JSON.stringify({ category: "all", difficulty: "unranked" })));
  await page.goto("/");
  await page.getByRole("button", { name: "Skip" }).click();
  const result = page.getByRole("dialog", { name: "Test Song" });
  await expect(result).toContainText("DifficultyUnranked");
  await expect(result).toContainText("StreamsNot ranked yet");
  await expect(result.locator(".result-meta")).not.toContainText("0");
  await expect(result.getByRole("button", { name: "Try higher difficulty" })).toHaveCount(0);
});

for (const width of [320, 390, 768, 1024, 1440, 1920]) {
  test(`workspace hierarchy remains usable inside a ${width}px viewport`, async ({ page }) => {
    const height = width === 1920 ? 1080 : 900;
    await page.setViewportSize({ width, height });
    await mockConnectedGame(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Category" }).click();
    const box = await page.getByRole("listbox", { name: "Category" }).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    const playBox = await page.getByRole("button", { name: "Play song snippet" }).boundingBox();
    const timelineBox = await page.getByRole("progressbar", { name: "Snippet playback" }).boundingBox();
    const searchBox = await page.getByRole("combobox", { name: "Search for a song" }).boundingBox();
    const filtersBox = await page.locator(".filters").boundingBox();
    const stagesBox = await page.locator(".stage-panel").boundingBox();
    const volumeBox = await page.locator(".volume-control").boundingBox();
    const shellBox = await page.locator(".game-shell").boundingBox();
    expect(playBox).not.toBeNull();
    expect(timelineBox).not.toBeNull();
    expect(searchBox).not.toBeNull();
    expect(filtersBox).not.toBeNull();
    expect(stagesBox).not.toBeNull();
    expect(volumeBox).not.toBeNull();
    expect(shellBox).not.toBeNull();
    const expectedPlaySize = width <= 600 ? 92 : 124;
    expect(playBox!.width).toBeGreaterThanOrEqual(expectedPlaySize - 2);
    expect(playBox!.width).toBeLessThanOrEqual(expectedPlaySize + 2);
    expect(playBox!.height).toBe(playBox!.width);
    expect(playBox!.y + playBox!.height).toBeLessThan(height);
    expect(timelineBox!.y).toBeLessThan(searchBox!.y);
    expect(searchBox!.y + searchBox!.height).toBeLessThan(height);
    await expect(page.getByRole("button", { name: "Normal", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".stage-marker[aria-current='step']")).toContainText("0.1s");

    if (width >= 901) {
      expect(filtersBox!.x + filtersBox!.width).toBeLessThan(playBox!.x);
      expect(playBox!.x + playBox!.width).toBeLessThan(stagesBox!.x);
    } else {
      expect(filtersBox!.y).toBeLessThan(stagesBox!.y);
      expect(stagesBox!.y).toBeLessThan(playBox!.y);
      expect(searchBox!.y).toBeLessThan(volumeBox!.y);
    }
    if (width === 1920) expect(shellBox!.width).toBeGreaterThanOrEqual(1400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
