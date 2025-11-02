import * as vscode from 'vscode';
import axios from 'axios';
import { SpotifyTrack, SpotifyTokens } from './types';
import { AuthServer } from './authServer';

export class SpotifyService {
  private static readonly SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
  private static readonly TOKEN_URL = 'https://accounts.spotify.com/api/token';
  
  private tokens: SpotifyTokens | null = null;
  private clientId: string;
  private authServer: AuthServer | null = null;

  constructor(private context: vscode.ExtensionContext) {
    this.clientId = this.getClientId();
    this.loadTokens();
  }

  private getClientId(): string {
    const config = vscode.workspace.getConfiguration('spotify');
    const clientId = config.get<string>('clientId', '');
    console.log('Client ID from settings:', clientId);
    return clientId;
  }

  private async loadTokens() {
    const saved = this.context.globalState.get<SpotifyTokens>('spotifyTokens');
    if (saved) {
      // Check if token is expired
      if (saved.expiresAt > Date.now()) {
        this.tokens = saved;
        console.log('Loaded valid tokens from storage');
      } else if (saved.refreshToken) {
        // Try to refresh expired token
        console.log('Token expired, attempting refresh...');
        await this.refreshAccessToken();
      } else {
        console.log('Token expired and no refresh token available');
      }
    }
  }

  private async saveTokens(tokens: SpotifyTokens): Promise<void> {
    console.log('Saving tokens - expires in:', Math.round((tokens.expiresAt - Date.now()) / 1000), 'seconds');
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

    try {
      vscode.window.showInformationMessage('Opening Spotify authorization in browser...');
      
      this.authServer = new AuthServer();
      const result = await this.authServer.authenticate(this.clientId);
      
      if (!result) {
        vscode.window.showErrorMessage('Authentication cancelled or failed');
        return false;
      }

      console.log('✅ Got tokens from Spotify!');
      console.log('Access token length:', result.accessToken.length);
      console.log('Has refresh token:', !!result.refreshToken);

      await this.saveTokens({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt: Date.now() + (result.expiresIn * 1000)
      });

      vscode.window.showInformationMessage('✅ Successfully authenticated with Spotify!');

      // Test immediately
      const track = await this.getCurrentTrack();
      if (track) {
        vscode.window.showInformationMessage(`🎵 Now playing: ${track.name} by ${track.artist}`);
      } else {
        vscode.window.showInformationMessage('✅ Connected! Start playing music on Spotify to see it here.');
      }

      return true;
    } catch (error: any) {
      console.error('Auth error:', error);
      vscode.window.showErrorMessage('Authentication failed: ' + (error.message || error));
      return false;
    } finally {
      this.authServer?.dispose();
      this.authServer = null;
    }
  }

  async refreshAccessToken(): Promise<boolean> {
    const tokens = await this.context.globalState.get<SpotifyTokens>('spotifyTokens');
    
    if (!tokens?.refreshToken) {
      console.error('No refresh token available');
      return false;
    }

    try {
      console.log('Refreshing access token...');
      
      const response = await axios.post(SpotifyService.TOKEN_URL,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: tokens.refreshToken,
          client_id: this.clientId
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      await this.saveTokens({
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token || tokens.refreshToken, // Use new refresh token if provided, otherwise keep old one
        expiresAt: Date.now() + (response.data.expires_in * 1000)
      });

      console.log('✅ Token refreshed successfully');
      vscode.window.showInformationMessage('Spotify token refreshed successfully');
      return true;
    } catch (error: any) {
      console.error('Error refreshing token:', error.response?.data || error.message);
      
      // If refresh fails, clear tokens and ask user to re-authenticate
      this.tokens = null;
      await this.context.globalState.update('spotifyTokens', null);
      
      const choice = await vscode.window.showWarningMessage(
        'Failed to refresh Spotify token. Please authenticate again.',
        'Authenticate'
      );
      if (choice === 'Authenticate') {
        await this.authenticate();
      }
      
      return false;
    }
  }

  private async getValidToken(): Promise<string | null> {
    // Check if we have tokens
    if (!this.tokens) {
      await this.loadTokens();
    }

    if (!this.tokens) {
      return null;
    }

    // Check if token is expired or about to expire (within 5 minutes)
    if (this.tokens.expiresAt < Date.now() + 5 * 60 * 1000) {
      if (this.tokens.refreshToken) {
        const refreshed = await this.refreshAccessToken();
        if (!refreshed) {
          return null;
        }
      } else {
        return null;
      }
    }

    return this.tokens.accessToken;
  }

  async getCurrentTrack(): Promise<SpotifyTrack | null> {
    const token = await this.getValidToken();
    if (!token) {
      return null;
    }

    try {
      const response = await axios.get(`${SpotifyService.SPOTIFY_API_BASE}/me/player/currently-playing`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.status === 204 || !response.data || !response.data.item) {
        console.log('No track currently playing');
        return null;
      }

      const item = response.data.item;
      return {
        name: item.name,
        artist: item.artists.map((a: any) => a.name).join(', '),
        album: item.album.name,
        albumArt: item.album.images[0]?.url || '',
        duration: item.duration_ms,
        progress: response.data.progress_ms || 0,
        isPlaying: response.data.is_playing
      };
    } catch (error: any) {
      if (error.response?.status === 401) {
        console.error('Token invalid (401). Attempting refresh...');
        const refreshed = await this.refreshAccessToken();
        if (refreshed) {
          // Retry once after refresh
          return this.getCurrentTrack();
        }
      } else if (error.response?.status === 204) {
        return null;
      } else {
        console.error('Error fetching track:', error.response?.status, error.message);
      }
      return null;
    }
  }

  async play(): Promise<void> {
    const token = await this.getValidToken();
    if (!token) {
      vscode.window.showWarningMessage('Please authenticate with Spotify first');
      return;
    }

    try {
      await axios.put(`${SpotifyService.SPOTIFY_API_BASE}/me/player/play`, {}, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (error: any) {
      await this.handleApiError(error, 'play');
    }
  }

  async pause(): Promise<void> {
    const token = await this.getValidToken();
    if (!token) {
      vscode.window.showWarningMessage('Please authenticate with Spotify first');
      return;
    }

    try {
      await axios.put(`${SpotifyService.SPOTIFY_API_BASE}/me/player/pause`, {}, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (error: any) {
      await this.handleApiError(error, 'pause');
    }
  }

  async next(): Promise<void> {
    const token = await this.getValidToken();
    if (!token) {
      vscode.window.showWarningMessage('Please authenticate with Spotify first');
      return;
    }

    try {
      await axios.post(`${SpotifyService.SPOTIFY_API_BASE}/me/player/next`, {}, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      // Give Spotify a moment to update
      setTimeout(() => {
        vscode.commands.executeCommand('spotify.refresh');
      }, 500);
    } catch (error: any) {
      await this.handleApiError(error, 'skip to next track');
    }
  }

  async previous(): Promise<void> {
    const token = await this.getValidToken();
    if (!token) {
      vscode.window.showWarningMessage('Please authenticate with Spotify first');
      return;
    }

    try {
      await axios.post(`${SpotifyService.SPOTIFY_API_BASE}/me/player/previous`, {}, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      // Give Spotify a moment to update
      setTimeout(() => {
        vscode.commands.executeCommand('spotify.refresh');
      }, 500);
    } catch (error: any) {
      await this.handleApiError(error, 'go to previous track');
    }
  }

  private async handleApiError(error: any, action: string): Promise<void> {
    if (error.response?.status === 401) {
      console.error(`Token invalid during ${action}. Attempting refresh...`);
      const refreshed = await this.refreshAccessToken();
      if (!refreshed) {
        vscode.window.showErrorMessage('Spotify token expired. Please authenticate again.');
      }
    } else if (error.response?.status === 404) {
      vscode.window.showWarningMessage('No active Spotify device found. Please open Spotify and start playing something.');
    } else if (error.response?.status === 403) {
      vscode.window.showWarningMessage('This action is not allowed. Make sure Spotify Premium is active.');
    } else {
      console.error(`Error during ${action}:`, error.response?.status, error.message);
      vscode.window.showErrorMessage(`Failed to ${action}: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  isAuthenticated(): boolean {
    return this.tokens !== null && (this.tokens.expiresAt > Date.now() || !!this.tokens.refreshToken);
  }

  async clearTokens(): Promise<void> {
    this.tokens = null;
    await this.context.globalState.update('spotifyTokens', null);
    console.log('Tokens cleared');
  }
}