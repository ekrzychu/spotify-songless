import type { GameRound, GameTrack, RoundAttempt } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isCorrectGuess } from "@/lib/game/correctness";
import { MAX_ATTEMPTS, applyAttempt, snippetLengthForAttempt } from "@/lib/game/snippets";
import { selectRandomTrack } from "@/lib/game/selection";
import type { GameDifficulty, RoundView, SearchTrack } from "@/types/game";

type LoadedRound = GameRound & { track: GameTrack; attempts: RoundAttempt[] };

export class RoundNotFoundError extends Error {}
export class RoundFinishedError extends Error {}
export class NoTracksError extends Error {}
export class PoolExhaustedError extends Error {}

function reveal(track: GameTrack, difficulty: GameDifficulty) {
  return {
    title: track.title, artistNames: track.artistNames, albumName: track.albumName,
    releaseDate: track.releaseDate, spotifyUrl: track.spotifyUrl,
    streamCount: difficulty === "unranked" ? null : track.streamCount?.toString() ?? null, difficulty,
  };
}

export function roundView(round: LoadedRound): RoundView {
  return {
    id: round.id,
    spotifyUri: round.track.spotifyUri,
    attempt: round.attempt,
    snippetLength: snippetLengthForAttempt(round.attempt),
    finished: round.finished,
    won: round.won,
    attempts: round.attempts.sort((a, b) => a.number - b.number).map((attempt) => ({
      number: attempt.number,
      outcome: attempt.outcome as "skipped" | "incorrect" | "correct",
      label: attempt.outcome === "skipped"
        ? "Skipped"
        : `${attempt.guessTitle ?? "Unknown track"} — ${attempt.guessArtists ?? "Unknown artist"}`,
    })),
    ...(round.finished ? { answer: reveal(round.track, round.difficulty as GameDifficulty) } : {}),
  };
}

export async function createRound(sessionId: string, category: string, difficulty: GameDifficulty): Promise<RoundView> {
  const selection = await selectRandomTrack({ sessionId, category, difficulty });
  if (selection.status === "empty") throw new NoTracksError();
  if (selection.status === "exhausted") throw new PoolExhaustedError();
  const track = selection.track;
  const round = await db.gameRound.create({
    data: { sessionId, trackId: track.id, categoryId: category, difficulty },
    include: { track: true, attempts: true },
  });
  return roundView(round);
}

export async function getRound(roundId: string, sessionId: string): Promise<RoundView> {
  const round = await db.gameRound.findFirst({
    where: { id: roundId, sessionId }, include: { track: true, attempts: true },
  });
  if (!round) throw new RoundNotFoundError();
  return roundView(round);
}

export async function recordAttempt(
  roundId: string,
  sessionId: string,
  guess: SearchTrack | null,
): Promise<RoundView> {
  try {
    return await db.$transaction(async (tx) => {
      const round = await tx.gameRound.findFirst({
        where: { id: roundId, sessionId }, include: { track: true, attempts: true },
      });
      if (!round) throw new RoundNotFoundError();
      if (round.finished) throw new RoundFinishedError();
      const correct = guess ? isCorrectGuess(guess, {
        spotifyTrackId: round.track.spotifyTrackId, isrc: round.track.isrc,
      }) : false;
      const next = applyAttempt(
        { attempt: round.attempt, finished: round.finished, won: round.won },
        correct ? "correct" : guess ? "wrong" : "skip",
      );
      await tx.roundAttempt.create({
        data: {
          roundId, number: round.attempt + 1,
          outcome: correct ? "correct" : guess ? "incorrect" : "skipped",
          guessTrackId: guess?.spotifyTrackId, guessTitle: guess?.title, guessArtists: guess?.artistNames,
        },
      });
      const updated = await tx.gameRound.update({
        where: { id: roundId },
        data: {
          attempt: next.attempt, finished: next.finished, won: next.won,
          finishedAt: next.finished ? new Date() : null,
        },
        include: { track: true, attempts: true },
      });
      return roundView(updated);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return getRound(roundId, sessionId);
    }
    throw error;
  }
}

export async function replaceUnavailableRound(roundId: string, sessionId: string): Promise<RoundView> {
  const round = await db.gameRound.findFirst({ where: { id: roundId, sessionId } });
  if (!round) throw new RoundNotFoundError();
  await db.$transaction([
    db.sessionUnavailableTrack.upsert({
      where: { sessionId_trackId: { sessionId, trackId: round.trackId } },
      create: { sessionId, trackId: round.trackId },
      update: {},
    }),
    db.gameRound.update({ where: { id: round.id }, data: { finished: true, finishedAt: new Date() } }),
  ]);
  return createRound(sessionId, round.categoryId, round.difficulty as GameDifficulty);
}

export { MAX_ATTEMPTS };
