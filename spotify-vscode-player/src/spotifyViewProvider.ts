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
    ) { }

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
                case 'authenticate':
                    await this.spotifyService.authenticate();
                    this.updateTrackInfo();
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
        
        // Send auth success first to show the player
        this.view.webview.postMessage({
            command: 'updateAuth',
            authenticated: true
        });
        
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
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.js'));
        const htmlPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'index.html');

        let htmlContent = '';
        try {
            // Read html file content synchronously
            const fs = require('fs');
            htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf8');
        } catch (err) {
            console.error('Error reading HTML file:', err);
            return 'Error loading player';
        }

        // Replace placeholders
        htmlContent = htmlContent
            .replace('{{styleUri}}', styleUri.toString())
            .replace('{{scriptUri}}', scriptUri.toString());

        return htmlContent;
    }

    private getPlaylistsHtml(playlists: SpotifyPlaylist[]): string {
        const playlistItems = playlists.map(playlist => `
      <div class="flex gap-3 p-2 rounded-lg cursor-pointer transition-all duration-200 bg-white/5 hover:bg-white/10 hover:translate-x-1" onclick="playPlaylist('${playlist.id}')">
        <img src="${playlist.imageUrl || 'https://via.placeholder.com/56/1a1a1a/1DB954?text=Music'}" class="w-14 h-14 rounded-md object-cover shadow-lg" alt="${playlist.name}">
        <div class="flex-1 flex flex-col justify-center min-w-0">
          <div class="text-sm font-semibold mb-1 truncate">${playlist.name}</div>
          <div class="text-xs opacity-60">${playlist.trackCount} songs</div>
        </div>
      </div>
    `).join('');

        const styleUri = this.view?.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.css'));

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Playlists</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    colors: {
                        spotify: {
                            green: '#1DB954',
                        }
                    }
                }
            }
        }
    </script>
    <link href="${styleUri}" rel="stylesheet">
</head>
<body class="font-sans bg-gradient-to-b from-[var(--vscode-editor-background)] to-[#0d0d0d] text-[var(--vscode-foreground)] m-0 p-3 min-h-screen">
    <div class="flex items-center gap-3 mb-4">
        <button class="bg-white/10 border-none py-2 px-4 rounded-full cursor-pointer text-white text-[13px] transition-all duration-200 flex items-center gap-1.5 hover:bg-white/20" id="backBtn">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
            </svg>
            Back
        </button>
        <h2 class="text-base font-semibold flex-1">Your Playlists</h2>
    </div>
    
    <div class="flex flex-col gap-2 pb-4">
        ${playlists.length > 0 ? playlistItems : '<div class="text-center py-10 opacity-50">No playlists found</div>'}
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