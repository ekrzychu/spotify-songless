export const DIFFICULTIES = ["easy", "normal", "hard", "extreme", "impossible"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

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
  difficulty: Difficulty;
};

export type RoundView = {
  id: string;
  spotifyUri: string;
  attempt: number;
  snippetLength: number;
  finished: boolean;
  won: boolean;
  attempts: AttemptView[];
  answer?: AnswerView;
};

export type SearchTrack = TrackIdentity & {
  title: string;
  artistNames: string;
  albumName: string;
};
