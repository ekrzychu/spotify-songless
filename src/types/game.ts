export const RANKED_DIFFICULTIES = ["easy", "normal", "hard", "extreme", "impossible"] as const;
export type RankedDifficulty = (typeof RANKED_DIFFICULTIES)[number];

export const GAME_DIFFICULTIES = [...RANKED_DIFFICULTIES, "unranked"] as const;
export type GameDifficulty = (typeof GAME_DIFFICULTIES)[number];

export type Artist = { id: string; name: string };

export type TrackIdentity = {
  spotifyTrackId: string;
  isrc: string | null;
};

export type AttemptView = {
  number: number;
  outcome: "skipped" | "incorrect" | "correct";
  label: string;
};

export type AnswerView = {
  title: string;
  artistNames: string;
  albumName: string;
  releaseDate: string | null;
  spotifyUrl: string;
  streamCount: string | null;
  difficulty: GameDifficulty;
};

export type SetProgressView = {
  completed: number;
  total: number;
};

export type RoundView = {
  id: string;
  spotifyUri: string;
  attempt: number;
  snippetLength: number;
  finished: boolean;
  won: boolean;
  attempts: AttemptView[];
  setProgress?: SetProgressView;
  answer?: AnswerView;
};

export type SearchTrack = TrackIdentity & {
  title: string;
  artistNames: string;
  albumName: string;
};
