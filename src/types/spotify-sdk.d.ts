export {};

declare global {
  interface Window {
    Spotify?: {
      Player: new (options: {
        name: string;
        getOAuthToken: (callback: (token: string) => void) => void;
        volume?: number;
        enableMediaSession?: boolean;
      }) => SpotifyPlayer;
    };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }

  type SpotifyPlayerState = { paused: boolean; position: number; duration: number };
  type SpotifyError = { message: string };
  type SpotifyReady = { device_id: string };

  interface SpotifyPlayer {
    connect(): Promise<boolean>;
    disconnect(): void;
    activateElement(): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    seek(positionMs: number): Promise<void>;
    getCurrentState(): Promise<SpotifyPlayerState | null>;
    addListener(event: "ready" | "not_ready", callback: (value: SpotifyReady) => void): boolean;
    addListener(event: "player_state_changed", callback: (value: SpotifyPlayerState | null) => void): boolean;
    addListener(event: "initialization_error" | "authentication_error" | "account_error" | "playback_error", callback: (value: SpotifyError) => void): boolean;
    addListener(event: "autoplay_failed", callback: () => void): boolean;
  }
}
