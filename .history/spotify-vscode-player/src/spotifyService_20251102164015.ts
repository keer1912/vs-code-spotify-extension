import * as vscode from 'vscode';
import axios from 'axios';
import { SpotifyTrack, SpotifyTokens } from './types';

export class SpotifyService {
  private static readonly SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
  private static readonly AUTH_URL = 'https://accounts.spotify.com/authorize';
  private static readonly TOKEN_URL = 'https://accounts.spotify.com/api/token';
  
  private tokens: SpotifyTokens | null = null;
  private clientId: string;
  private redirectUri = 'https://localhost:8888/callback';

  constructor(private context: vscode.ExtensionContext) {
    this.clientId = vscode.workspace.getConfiguration('spotify').get('clientId') || '';
    this.loadTokens();
  }

  private loadTokens() {
    const saved = this.context.globalState.get<SpotifyTokens>('spotifyTokens');
    if (saved && saved.expiresAt > Date.now()) {
      this.tokens = saved;
    }
  }

  private async saveTokens(tokens: SpotifyTokens) {
    this.tokens = tokens;
    await this.context.globalState.update('spotifyTokens', tokens);
  }

  async authenticate(): Promise<boolean> {
    if (!this.clientId) {
      vscode.window.showErrorMessage('Please set Spotify Client ID in settings');
      return false;
    }

    const scopes = [
      'user-read-playback-state',
      'user-modify-playback-state',
      'user-read-currently-playing'
    ].join(' ');

    const authUrl = `${SpotifyService.AUTH_URL}?client_id=${this.clientId}&response_type=token&redirect_uri=${encodeURIComponent(this.redirectUri)}&scope=${encodeURIComponent(scopes)}`;

    vscode.env.openExternal(vscode.Uri.parse(authUrl));
    
    // Simplified: In production, set up a local server to catch the redirect
    const token = await vscode.window.showInputBox({
      prompt: 'Paste the access token from the URL',
      ignoreFocusOut: true
    });

    if (token) {
      await this.saveTokens({
        accessToken: token,
        refreshToken: '',
        expiresAt: Date.now() + 3600 * 1000
      });
      return true;
    }

    return false;
  }

  async getCurrentTrack(): Promise<SpotifyTrack | null> {
    if (!this.tokens) return null;

    try {
      const response = await axios.get(`${SpotifyService.SPOTIFY_API_BASE}/me/player/currently-playing`, {
        headers: { 'Authorization': `Bearer ${this.tokens.accessToken}` }
      });

      if (response.status === 204 || !response.data.item) {
        return null;
      }

      const item = response.data.item;
      return {
        name: item.name,
        artist: item.artists.map((a: any) => a.name).join(', '),
        album: item.album.name,
        albumArt: item.album.images[0]?.url || '',
        duration: item.duration_ms,
        progress: response.data.progress_ms,
        isPlaying: response.data.is_playing
      };
    } catch (error) {
      console.error('Error fetching track:', error);
      return null;
    }
  }

  async play(): Promise<void> {
    if (!this.tokens) return;
    try {
      await axios.put(`${SpotifyService.SPOTIFY_API_BASE}/me/player/play`, {}, {
        headers: { 'Authorization': `Bearer ${this.tokens.accessToken}` }
      });
    } catch (error) {
      console.error('Error playing:', error);
    }
  }

  async pause(): Promise<void> {
    if (!this.tokens) return;
    try {
      await axios.put(`${SpotifyService.SPOTIFY_API_BASE}/me/player/pause`, {}, {
        headers: { 'Authorization': `Bearer ${this.tokens.accessToken}` }
      });
    } catch (error) {
      console.error('Error pausing:', error);
    }
  }

  async next(): Promise<void> {
    if (!this.tokens) return;
    try {
      await axios.post(`${SpotifyService.SPOTIFY_API_BASE}/me/player/next`, {}, {
        headers: { 'Authorization': `Bearer ${this.tokens.accessToken}` }
      });
    } catch (error) {
      console.error('Error skipping:', error);
    }
  }

  async previous(): Promise<void> {
    if (!this.tokens) return;
    try {
      await axios.post(`${SpotifyService.SPOTIFY_API_BASE}/me/player/previous`, {}, {
        headers: { 'Authorization': `Bearer ${this.tokens.accessToken}` }
      });
    } catch (error) {
      console.error('Error going back:', error);
    }
  }

  isAuthenticated(): boolean {
    return this.tokens !== null && this.tokens.expiresAt > Date.now();
  }
}