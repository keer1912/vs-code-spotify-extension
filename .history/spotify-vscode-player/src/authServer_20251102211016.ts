import * as vscode from 'vscode';
import * as http from 'http';
import * as url from 'url';
import axios from 'axios';
import { generateCodeVerifier, generateCodeChallenge } from './pkce';

export class AuthServer {
  private server: http.Server | null = null;
  private readonly port = 8888;
  private codeVerifier: string = '';

async authenticate(clientId: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number } | null> {
  return new Promise((resolve) => {
    // Generate PKCE codes
    this.codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(this.codeVerifier);

    const scopes = [
      'user-read-playback-state',
      'user-modify-playback-state',
      'user-read-currently-playing'
    ].join(' ');

    // Use a redirect URI that Spotify accepts
    const redirectUri = `https://open.spotify.com/`;
    const state = this.generateRandomString(16);

    const authUrl = `https://accounts.spotify.com/authorize?` +
      `client_id=${clientId}` +
      `&response_type=code` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&code_challenge_method=S256` +
      `&code_challenge=${codeChallenge}` +
      `&state=${state}` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&show_dialog=true`;

    // Since we can't catch the callback automatically with HTTPS,
    // we'll ask the user to paste the code
    vscode.env.openExternal(vscode.Uri.parse(authUrl));

    vscode.window.showInformationMessage(
      'After authorizing, you will be redirected. Copy the "code" parameter from the URL and paste it in the next prompt.',
      'OK'
    ).then(async () => {
      const code = await vscode.window.showInputBox({
        prompt: 'Paste the authorization code from the URL (the value after "?code=" or "&code=")',
        placeHolder: 'AQD...',
        ignoreFocusOut: true,
        validateInput: (value) => {
          if (!value) {
            return 'Code is required';
          }
          if (value.length < 10) {
            return 'Code seems too short';
          }
          if (value.includes('http') || value.includes('?') || value.includes('&')) {
            return 'Please paste only the code value, not the entire URL';
          }
          return null;
        }
      });

      if (code) {
        try {
          // Exchange code for token
          const tokenResponse = await this.exchangeCodeForToken(clientId, code, redirectUri);
          resolve(tokenResponse);
        } catch (error: any) {
          console.error('Error exchanging code for token:', error);
          vscode.window.showErrorMessage('Failed to get access token: ' + (error.response?.data?.error_description || error.message));
          resolve(null);
        }
      } else {
        resolve(null);
      }
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      resolve(null);
    }, 300000);
  });
}

  private async exchangeCodeForToken(clientId: string, code: string, redirectUri: string) {
    const response = await axios.post('https://accounts.spotify.com/api/token', 
      new URLSearchParams({
        client_id: clientId,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
        code_verifier: this.codeVerifier
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresIn: response.data.expires_in
    };
  }

  private generateRandomString(length: number): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < length; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  private getSuccessHtml(): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Spotify Auth Success</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #1db954 0%, #191414 100%);
            color: white;
          }
          .container {
            text-align: center;
            background: rgba(0,0,0,0.5);
            padding: 40px;
            border-radius: 20px;
          }
          .success { color: #1db954; font-size: 64px; margin-bottom: 20px; }
          h1 { margin-bottom: 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success">✓</div>
          <h1>Authentication Successful!</h1>
          <p>You can close this window and return to VS Code.</p>
        </div>
      </body>
      </html>
    `;
  }

  private getErrorHtml(error: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Spotify Auth Error</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #ff6b6b 0%, #191414 100%);
            color: white;
          }
          .container {
            text-align: center;
            background: rgba(0,0,0,0.5);
            padding: 40px;
            border-radius: 20px;
          }
          .error { color: #ff6b6b; font-size: 64px; margin-bottom: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="error">✗</div>
          <h1>Authentication Failed</h1>
          <p>Error: ${error}</p>
          <p>Please try again in VS Code.</p>
        </div>
      </body>
      </html>
    `;
  }

  dispose() {
    if (this.server) {
      this.server.close();
    }
  }
}