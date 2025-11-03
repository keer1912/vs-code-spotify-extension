export interface SpotifyTrack {
  name: string;
  artist: string;
  album: string;
  albumArt: string;
  duration: number;
  progress: number;
  isPlaying: boolean;
}

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  trackCount: number;
  owner: string;
}