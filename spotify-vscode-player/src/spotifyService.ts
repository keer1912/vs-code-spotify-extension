import * as vscode from 'vscode';
import axios from 'axios';
import { SpotifyTrack, SpotifyTokens, SpotifyPlaylist } from './types';
import { AuthServer } from './authServer';

export class SpotifyService {
  private static readonly SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
  private static readonly TOKEN_URL = 'https://accounts.spotify.com/api/token';
  private static readonly CLIENT_ID = '3a0a1cc0ad994ad1ba5cf091571e79c2';

  private tokens: SpotifyTokens | null = null;
  private authServer: AuthServer | null = null;

  constructor(private context: vscode.ExtensionContext) {
    this.loadTokens();
  }

  private get clientId(): string {
    return SpotifyService.CLIENT_ID;
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
    if (!this.clientId || this.clientId === 'YOUR_SPOTIFY_CLIENT_ID_HERE') {
      vscode.window.showErrorMessage('Extension not configured: Client ID not set by developer');
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

      console.log('Got tokens from Spotify!');
      console.log('Access token length:', result.accessToken.length);
      console.log('Has refresh token:', !!result.refreshToken);

      await this.saveTokens({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt: Date.now() + (result.expiresIn * 1000)
      });

      vscode.window.showInformationMessage('Successfully authenticated with Spotify!');

      // Open Spotify app
      await vscode.env.openExternal(vscode.Uri.parse('spotify:'));

      // Test immediately
      const track = await this.getCurrentTrack();
      if (track) {
        vscode.window.showInformationMessage(`Now playing: ${track.name} by ${track.artist}`);
      } else {
        vscode.window.showInformationMessage('Connected! Start playing music on Spotify to see it here.');
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
          client_id: this.clientId,
          code_verifier: '' // Not needed for refresh generally, but check spec if fails
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      await this.saveTokens({
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token || tokens.refreshToken,
        expiresAt: Date.now() + (response.data.expires_in * 1000)
      });

      console.log('Token refreshed successfully');
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
      // First try to get available devices
      const devicesResponse = await axios.get(`${SpotifyService.SPOTIFY_API_BASE}/me/player/devices`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      const devices = devicesResponse.data.devices;
      
      if (devices.length === 0) {
        // No devices available, prompt to open Spotify
        const choice = await vscode.window.showWarningMessage(
          'No Spotify devices found. Open Spotify and try again.',
          'Open Spotify'
        );
        if (choice === 'Open Spotify') {
          await vscode.env.openExternal(vscode.Uri.parse('spotify:'));
        }
        return;
      }

      // Prioritize the local computer device
      const computerDevice = devices.find((d: any) => d.type === 'Computer');
      
      if (computerDevice) {
        // Transfer playback to the computer device
        await axios.put(`${SpotifyService.SPOTIFY_API_BASE}/me/player`, 
          { device_ids: [computerDevice.id], play: true },
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
      } else {
        // No computer device found, check if there's an active device to resume
        const activeDevice = devices.find((d: any) => d.is_active);
        if (activeDevice) {
          // Resume on the active device
          await axios.put(`${SpotifyService.SPOTIFY_API_BASE}/me/player/play`, {}, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
        } else {
          // No active device, open Spotify
          await vscode.env.openExternal(vscode.Uri.parse('spotify:'));
        }
      }
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
      // First check if there are any active devices
      const devicesResponse = await axios.get(`${SpotifyService.SPOTIFY_API_BASE}/me/player/devices`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      const devices = devicesResponse.data.devices;
      const hasActiveDevice = devices.some((d: any) => d.is_active);
      
      if (!hasActiveDevice) {
        // No active device, open Spotify
        await vscode.env.openExternal(vscode.Uri.parse('spotify:'));
        return;
      }

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

  async getUserPlaylists(): Promise<SpotifyPlaylist[]> {
    const token = await this.getValidToken();
    if (!token) {
      vscode.window.showWarningMessage('Please authenticate with Spotify first');
      return [];
    }

    try {
      const response = await axios.get(
        `${SpotifyService.SPOTIFY_API_BASE}/me/playlists?limit=50`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );

      return response.data.items.map((playlist: any) => ({
        id: playlist.id,
        name: playlist.name,
        description: playlist.description || '',
        imageUrl: playlist.images[0]?.url || '',
        trackCount: playlist.tracks.total,
        owner: playlist.owner.display_name
      }));
    } catch (error: any) {
      console.error('Error fetching playlists:', error);
      await this.handleApiError(error, 'fetch playlists');
      return [];
    }
  }

  async playPlaylist(playlistUri: string): Promise<void> {
    const token = await this.getValidToken();
    if (!token) {
      vscode.window.showWarningMessage('Please authenticate with Spotify first');
      return;
    }

    try {
      await axios.put(
        `${SpotifyService.SPOTIFY_API_BASE}/me/player/play`,
        { context_uri: playlistUri },
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      vscode.window.showInformationMessage('Playing playlist...');
    } catch (error: any) {
      await this.handleApiError(error, 'play playlist');
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
      const choice = await vscode.window.showWarningMessage(
        'No active Spotify device found.',
        'Open Spotify'
      );
      if (choice === 'Open Spotify') {
        await vscode.env.openExternal(vscode.Uri.parse('spotify:'));
      }
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