const vscode = acquireVsCodeApi();

// Elements
const authRequired = document.getElementById('authRequired');
const player = document.getElementById('player');
const albumArt = document.getElementById('albumArt');
const trackName = document.getElementById('trackName');
const trackArtist = document.getElementById('trackArtist');
const playPauseBtn = document.getElementById('playPauseBtn');
const playIcon = document.getElementById('playIcon');
const pauseIcon = document.getElementById('pauseIcon');
const vinylRecord = document.getElementById('vinylRecord');
const vinylGlow = document.getElementById('vinylGlow');
const progressBar = document.getElementById('progressBar');
const currentTimeEl = document.getElementById('currentTime');
const totalTimeEl = document.getElementById('totalTime');

let isPlaying = false;

function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins + ':' + secs.toString().padStart(2, '0');
}

function updateProgress(progress, duration) {
    if (duration > 0) {
        const percent = progress / duration;

        // Update linear progress bar
        progressBar.style.width = (percent * 100) + '%';

        currentTimeEl.textContent = formatTime(progress);
        totalTimeEl.textContent = formatTime(duration);
    }
}

function updatePlayState(playing) {
    isPlaying = playing;
    if (playing) {
        playIcon.classList.add('hidden');
        pauseIcon.classList.remove('hidden');
        vinylRecord.classList.add('spinning');
        vinylRecord.classList.remove('paused');
        vinylGlow.classList.add('active');
    } else {
        playIcon.classList.remove('hidden');
        pauseIcon.classList.add('hidden');
        vinylRecord.classList.remove('spinning');
        vinylGlow.classList.remove('active');
    }
}

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
            albumArt.style.backgroundColor = '';
            trackName.textContent = track.name;
            trackArtist.textContent = track.artist;
            updatePlayState(track.isPlaying);
            updateProgress(track.progress, track.duration);
            authRequired.classList.add('hidden');
            player.classList.remove('hidden');
        } else {
            albumArt.src = '';
            albumArt.style.backgroundColor = 'white';
            trackName.textContent = 'No track playing';
            trackArtist.textContent = '';
            updatePlayState(false);
        }
    }
});

playPauseBtn.addEventListener('click', () => {
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

document.getElementById('authBtn')?.addEventListener('click', () => {
    vscode.postMessage({ command: 'authenticate' });
});

// Extract dominant color from album art
function extractDominantColor(imgElement, callback) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.crossOrigin = 'Anonymous';

    img.onload = function () {
        canvas.width = 50;
        canvas.height = 50;
        ctx.drawImage(img, 0, 0, 50, 50);

        try {
            const imageData = ctx.getImageData(0, 0, 50, 50).data;
            let r = 0, g = 0, b = 0, count = 0;

            // Sample pixels and find vibrant colors
            for (let i = 0; i < imageData.length; i += 16) {
                const pr = imageData[i];
                const pg = imageData[i + 1];
                const pb = imageData[i + 2];

                // Skip very dark or very light pixels
                const brightness = (pr + pg + pb) / 3;
                if (brightness > 30 && brightness < 220) {
                    // Weight by saturation
                    const max = Math.max(pr, pg, pb);
                    const min = Math.min(pr, pg, pb);
                    const saturation = max === 0 ? 0 : (max - min) / max;

                    if (saturation > 0.2) {
                        const weight = saturation + 0.5;
                        r += pr * weight;
                        g += pg * weight;
                        b += pb * weight;
                        count += weight;
                    }
                }
            }

            if (count > 0) {
                r = Math.round(r / count);
                g = Math.round(g / count);
                b = Math.round(b / count);
                callback(r, g, b);
            } else {
                callback(29, 185, 84); // Default Spotify green
            }
        } catch (e) {
            callback(29, 185, 84); // Default on error
        }
    };

    img.onerror = function () {
        callback(29, 185, 84); // Default on error
    };

    img.src = imgElement.src;
}

function applyGlowColor(r, g, b) {
    document.documentElement.style.setProperty('--glow-color', 'rgba(' + r + ', ' + g + ', ' + b + ', 0.3)');
    document.documentElement.style.setProperty('--glow-color-dim', 'rgba(' + r + ', ' + g + ', ' + b + ', 0.1)');
    document.documentElement.style.setProperty('--glow-color-bright', 'rgba(' + r + ', ' + g + ', ' + b + ', 0.5)');
    document.documentElement.style.setProperty('--progress-color', 'rgb(' + r + ', ' + g + ', ' + b + ')');
    progressBar.style.backgroundColor = 'rgb(' + r + ', ' + g + ', ' + b + ')';
}

// Store last album art URL to avoid re-extracting
let lastAlbumArtUrl = '';

// Modify the message handler to extract color on track change
const originalHandler = window.onmessage;
window.addEventListener('message', event => {
    const message = event.data;
    if (message.command === 'updateTrack' && message.track && message.track.albumArt) {
        if (message.track.albumArt !== lastAlbumArtUrl) {
            lastAlbumArtUrl = message.track.albumArt;
            // Wait for image to load then extract color
            setTimeout(() => {
                extractDominantColor(albumArt, applyGlowColor);
            }, 100);
        }
    }
});
