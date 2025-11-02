import * as vscode from 'vscode';
import { SpotifyService } from './spotifyService';
import { SpotifyViewProvider } from './spotifyViewProvider';

export function activate(context: vscode.ExtensionContext) {
  console.log('Spotify extension is now active!');

  const spotifyService = new SpotifyService(context);
  const provider = new SpotifyViewProvider(context.extensionUri, spotifyService);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('spotifyPlayer', provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('spotify.authenticate', async () => {
      const success = await spotifyService.authenticate();
      if (success) {
        vscode.window.showInformationMessage('Successfully authenticated with Spotify!');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('spotify.play', () => spotifyService.play())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('spotify.pause', () => spotifyService.pause())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('spotify.next', () => spotifyService.next())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('spotify.previous', () => spotifyService.previous())
  );
}

export function deactivate() {}