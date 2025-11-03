import * as vscode from 'vscode';
import { SpotifyService } from './spotifyService';
import { SpotifyTrack, SpotifyPlaylist } from './types';

export class SpotifyViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private updateInterval?: NodeJS.Timeout;
  private currentView: 'player' | 'playlists' = 'player';

  constructor(
    private readonly extensionUri: vscode.Uri,
    private spotifyService: SpotifyService
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken
  ): void | Thenable<void> {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'play':
          await this.spotifyService.play();
          break;
        case 'pause':
          await this.spotifyService.pause();
          break;
        case 'next':
          await this.spotifyService.next();
          break;
        case 'previous':
          await this.spotifyService.previous();
          break;
        case 'showPlaylists':
          this.currentView = 'playlists';
          await this.showPlaylists();
          break;
        case 'backToPlayer':
          this.currentView = 'player';
          webviewView.webview.html = this.getHtmlContent(webviewView.webview);
          this.updateTrackInfo();
          break;
        case 'playPlaylist':
          await this.spotifyService.playPlaylist(message.playlistUri);
          this.currentView = 'player';
          webviewView.webview.html = this.getHtmlContent(webviewView.webview);
          setTimeout(() => this.updateTrackInfo(), 1000);
          break;
      }
    });

    // Update track info every 2 seconds
    this.updateInterval = setInterval(() => {
      if (this.currentView === 'player') {
        this.updateTrackInfo();
      }
    }, 2000);
    this.updateTrackInfo();
  }

  private async showPlaylists() {
    if (!this.view) return;

    const playlists = await this.spotifyService.getUserPlaylists();
    this.view.webview.html = this.getPlaylistsHtml(playlists);
  }

  private async updateTrackInfo() {
  if (!this.view) {
    console.log('No view available');
    return;
  }

  console.log('Checking authentication...');
  if (!this.spotifyService.isAuthenticated()) {
    console.log('Not authenticated');
    this.view.webview.postMessage({ 
      command: 'updateAuth', 
      authenticated: false 
    });
    return;
  }

  console.log('Authenticated! Fetching track...');
  try {
    const track = await this.spotifyService.getCurrentTrack();
    console.log('Track data:', track);
    
    this.view.webview.postMessage({ 
      command: 'updateTrack', 
      track 
    });
  } catch (error) {
    console.error('Error fetching track:', error);
  }
}

  private getHtmlContent(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Spotify Player</title>
    <style>
        body {
            padding: 10px;
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        .container {
            display: flex;
            flex-direction: column;
            gap: 15px;
            align-items: center;
        }
        .top-bar {
            width: 100%;
            display: flex;
            justify-content: flex-end;
            margin-bottom: 10px;
        }
        .playlists-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 4px;
            font-size: 13px;
        }
        .playlists-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .album-art {
            width: 200px;
            height: 200px;
            border-radius: 8px;
            object-fit: cover;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        }
        .track-info {
            text-align: center;
            width: 100%;
        }
        .track-name {
            font-size: 16px;
            font-weight: bold;
            margin: 5px 0;
        }
        .track-artist {
            font-size: 14px;
            opacity: 0.8;
        }
        .controls {
            display: flex;
            gap: 15px;
            justify-content: center;
            margin-top: 10px;
        }
        button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 10px 20px;
            cursor: pointer;
            border-radius: 4px;
            font-size: 20px;
        }
        button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .auth-message {
            text-align: center;
            padding: 20px;
        }
        .hidden {
            display: none;
        }
    </style>
</head>
<body>
    <div id="authRequired" class="auth-message">
        <p>Please authenticate with Spotify</p>
        <p>Run: <code>Spotify: Authenticate</code> from Command Palette</p>
    </div>
    
    <div id="player" class="container hidden">
        <div class="top-bar">
            <button class="playlists-btn" id="playlistsBtn">📋 Playlists</button>
        </div>
        <img id="albumArt" class="album-art" src="" alt="Album Art">
        <div class="track-info">
            <div id="trackName" class="track-name">No track playing</div>
            <div id="trackArtist" class="track-artist"></div>
        </div>
        <div class="controls">
            <button id="prevBtn" title="Previous">⏮️</button>
            <button id="playPauseBtn" title="Play/Pause">▶️</button>
            <button id="nextBtn" title="Next">⏭️</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const authRequired = document.getElementById('authRequired');
        const player = document.getElementById('player');
        const albumArt = document.getElementById('albumArt');
        const trackName = document.getElementById('trackName');
        const trackArtist = document.getElementById('trackArtist');
        const playPauseBtn = document.getElementById('playPauseBtn');

        let isPlaying = false;

        window.addEventListener('message', event => {
            const message = event.data;
            
            if (message.command === 'updateAuth') {
                if (message.authenticated) {
                    authRequired.classList.add('hidden');
                    player.classList.remove('hidden');
                } else {
                    authRequired.classList.remove('hidden');
                    player.classList.add('hidden');
                }
            }
            
            if (message.command === 'updateTrack') {
                const track = message.track;
                if (track) {
                    albumArt.src = track.albumArt;
                    trackName.textContent = track.name;
                    trackArtist.textContent = track.artist;
                    isPlaying = track.isPlaying;
                    playPauseBtn.textContent = isPlaying ? '⏸️' : '▶️';
                    authRequired.classList.add('hidden');
                    player.classList.remove('hidden');
                } else {
                    trackName.textContent = 'No track playing';
                    trackArtist.textContent = '';
                }
            }
        });

        document.getElementById('playPauseBtn').addEventListener('click', () => {
            vscode.postMessage({ command: isPlaying ? 'pause' : 'play' });
        });

        document.getElementById('nextBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'next' });
        });

        document.getElementById('prevBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'previous' });
        });

        document.getElementById('playlistsBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'showPlaylists' });
        });
    </script>
</body>
</html>`;
  }

  private getPlaylistsHtml(playlists: SpotifyPlaylist[]): string {
    const playlistItems = playlists.map(playlist => `
      <div class="playlist-item" onclick="playPlaylist('${playlist.id}')">
        <img src="${playlist.imageUrl || 'https://via.placeholder.com/60'}" class="playlist-img" alt="${playlist.name}">
        <div class="playlist-info">
          <div class="playlist-name">${playlist.name}</div>
          <div class="playlist-meta">${playlist.trackCount} songs</div>
        </div>
      </div>
    `).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Playlists</title>
    <style>
        body {
            padding: 10px;
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        .header {
            display: flex;
            align-items: center;
            margin-bottom: 15px;
            gap: 10px;
        }
        .back-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 4px;
            font-size: 13px;
        }
        .back-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        h2 {
            margin: 0;
            font-size: 18px;
            flex: 1;
        }
        .playlists-container {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .playlist-item {
            display: flex;
            gap: 12px;
            padding: 10px;
            border-radius: 6px;
            cursor: pointer;
            transition: background-color 0.2s;
        }
        .playlist-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .playlist-img {
            width: 60px;
            height: 60px;
            border-radius: 4px;
            object-fit: cover;
        }
        .playlist-info {
            flex: 1;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }
        .playlist-name {
            font-size: 14px;
            font-weight: bold;
            margin-bottom: 4px;
        }
        .playlist-meta {
            font-size: 12px;
            opacity: 0.7;
        }
        .empty-message {
            text-align: center;
            padding: 40px 20px;
            opacity: 0.7;
        }
    </style>
</head>
<body>
    <div class="header">
        <button class="back-btn" id="backBtn">← Back</button>
        <h2>Your Playlists</h2>
    </div>
    
    <div class="playlists-container">
        ${playlists.length > 0 ? playlistItems : '<div class="empty-message">No playlists found</div>'}
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        document.getElementById('backBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'backToPlayer' });
        });

        function playPlaylist(playlistId) {
            vscode.postMessage({ 
                command: 'playPlaylist', 
                playlistUri: 'spotify:playlist:' + playlistId 
            });
        }
    </script>
</body>
</html>`;
  }

  dispose() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
  }
}