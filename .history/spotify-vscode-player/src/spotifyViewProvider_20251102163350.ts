import * as vscode from 'vscode';
import { SpotifyService } from './spotifyService';
import { SpotifyTrack } from './types';

export class SpotifyViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private updateInterval?: NodeJS.Timeout;

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
      }
    });

    // Update track info every 2 seconds
    this.updateInterval = setInterval(() => this.updateTrackInfo(), 2000);
    this.updateTrackInfo();
  }

  private async updateTrackInfo() {
    if (!this.view) return;

    if (!this.spotifyService.isAuthenticated()) {
      this.view.webview.postMessage({ 
        command: 'updateAuth', 
        authenticated: false 
      });
      return;
    }

    const track = await this.spotifyService.getCurrentTrack();
    this.view.webview.postMessage({ 
      command: 'updateTrack', 
      track 
    });
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