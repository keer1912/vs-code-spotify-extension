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
  this.clientId = this.getClientId();
  this.loadTokens();
}

private getClientId(): string {
  const config = vscode.workspace.getConfiguration('spotify');
  const clientId = config.get<string>('clientId', '');
  console.log('Client ID from settings:', clientId); // Debug log
  return clientId;
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
  // Refresh client ID in case it was just set
  this.clientId = this.getClientId();
  
  if (!this.clientId) {
    vscode.window.showErrorMessage('Please set Spotify Client ID in settings');
    await vscode.commands.executeCommand('workbench.action.openSettings', 'spotify.clientId');
    return false;
  }

  // Direct user to get token from Spotify Console
  const choice = await vscode.window.showInformationMessage(
    'Get your Spotify access token',
    'Open Token Generator',
    'I have a token'
  );

  if (choice === 'Open Token Generator') {
    // Open Spotify's official token generator
    vscode.env.openExternal(vscode.Uri.parse('https://developer.spotify.com/console/get-current-user/'));
    
    vscode.window.showInformationMessage(
      'Click "Get Token", select the scopes (user-read-playback-state, user-modify-playback-state, user-read-currently-playing), then copy the token'
    );
  }
  
  const token = await vscode.window.showInputBox({
    prompt: 'Paste your Spotify access token here',
    placeHolder: 'BQD...',
    password: true,
    ignoreFocusOut: true
  });

  if (token && token.length > 20) {
    await this.saveTokens({
      accessToken: token.trim(),
      refreshToken: '',
      expiresAt: Date.now() + 3600 * 1000 // 1 hour
    });
    vscode.window.showInformationMessage('✅ Successfully authenticated with Spotify!');
    return true;
  } else if (token) {
    vscode.window.showErrorMessage('Token seems invalid. Please try again.');
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
    } catch (error: any) {
      if (error.response?.status === 401) {
        console.error('Token expired or invalid (401). Clearing tokens.');
        this.tokens = null;
        await this.context.globalState.update('spotifyTokens', null);
        vscode.window.showWarningMessage('Spotify token expired. Please authenticate again.', 'Authenticate')
          .then(choice => {
            if (choice === 'Authenticate') {
              vscode.commands.executeCommand('spotify.authenticate');
            }
          });
      } else {
        console.error('Error fetching track:', error.response?.status, error.message);
      }
      return null;
    }
  }

  async play(): Promise<void> {
    if (!this.tokens) return;
    try {
      await axios.put(`${SpotifyService.SPOTIFY_API_BASE}/me/player/play`, {}, {
        headers: { 'Authorization': `Bearer ${this.tokens.accessToken}` }
      });
    } catch (error: any) {
      if (error.response?.status === 401) {
        await this.handleTokenExpiry();
      } else {
        console.error('Error playing:', error.response?.status, error.message);
        vscode.window.showErrorMessage(`Failed to play: ${error.response?.data?.error?.message || error.message}`);
      }
    }
  }

  async pause(): Promise<void> {
    if (!this.tokens) return;
    try {
      await axios.put(`${SpotifyService.SPOTIFY_API_BASE}/me/player/pause`, {}, {
        headers: { 'Authorization': `Bearer ${this.tokens.accessToken}` }
      });
    } catch (error: any) {
      if (error.response?.status === 401) {
        await this.handleTokenExpiry();
      } else {
        console.error('Error pausing:', error.response?.status, error.message);
        vscode.window.showErrorMessage(`Failed to pause: ${error.response?.data?.error?.message || error.message}`);
      }
    }
  }

  async next(): Promise<void> {
    if (!this.tokens) return;
    try {
      await axios.post(`${SpotifyService.SPOTIFY_API_BASE}/me/player/next`, {}, {
        headers: { 'Authorization': `Bearer ${this.tokens.accessToken}` }
      });
    } catch (error: any) {
      if (error.response?.status === 401) {
        await this.handleTokenExpiry();
      } else {
        console.error('Error skipping:', error.response?.status, error.message);
        vscode.window.showErrorMessage(`Failed to skip: ${error.response?.data?.error?.message || error.message}`);
      }
    }
  }

  async previous(): Promise<void> {
    if (!this.tokens) return;
    try {
      await axios.post(`${SpotifyService.SPOTIFY_API_BASE}/me/player/previous`, {}, {
        headers: { 'Authorization': `Bearer ${this.tokens.accessToken}` }
      });
    } catch (error: any) {
      if (error.response?.status === 401) {
        await this.handleTokenExpiry();
      } else {
        console.error('Error going back:', error.response?.status, error.message);
        vscode.window.showErrorMessage(`Failed to go back: ${error.response?.data?.error?.message || error.message}`);
      }
    }
  }

  private async handleTokenExpiry() {
    console.error('Token expired or invalid (401). Clearing tokens.');
    this.tokens = null;
    await this.context.globalState.update('spotifyTokens', null);
    const choice = await vscode.window.showWarningMessage(
      'Spotify token expired. Please authenticate again.',
      'Authenticate'
    );
    if (choice === 'Authenticate') {
      await vscode.commands.executeCommand('spotify.authenticate');
    }
  }

  isAuthenticated(): boolean {
    return this.tokens !== null && this.tokens.expiresAt > Date.now();
  }
}