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

      const redirectUri = `http://localhost:${this.port}/callback`;
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

      // Create HTTP server to catch callback
      this.server = http.createServer(async (req, res) => {
        const parsedUrl = url.parse(req.url || '', true);
        
        if (parsedUrl.pathname === '/callback') {
          const code = parsedUrl.query.code as string;
          const returnedState = parsedUrl.query.state as string;
          const error = parsedUrl.query.error as string;

          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(this.getErrorHtml(error));
            this.server?.close();
            resolve(null);
            return;
          }

          if (returnedState !== state) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(this.getErrorHtml('State mismatch'));
            this.server?.close();
            resolve(null);
            return;
          }

          if (code) {
            try {
              // Exchange code for token
              const tokenResponse = await this.exchangeCodeForToken(clientId, code, redirectUri);
              
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(this.getSuccessHtml());
              
              this.server?.close();
              resolve(tokenResponse);
            } catch (error) {
              console.error('Error exchanging code for token:', error);
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(this.getErrorHtml('Failed to get access token'));
              this.server?.close();
              resolve(null);
            }
          }
        }
      });

      this.server.listen(this.port, () => {
        console.log(`Auth server listening on port ${this.port}`);
        vscode.env.openExternal(vscode.Uri.parse(authUrl));
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        if (this.server) {
          this.server.close();
          resolve(null);
        }
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