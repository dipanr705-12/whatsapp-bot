'use strict';

const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));

let currentQR = null;
let isConnected = false;
let isAuthenticating = false;
let pairingCode = null;
let lastPhotoForwarded = null;
let botStartTime = Date.now();

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err, origin) => {
    console.error('Uncaught Exception at:', origin, 'error:', err);
});

// ---------------------------------------------------------------------------
// Config — reads TARGET_NUMBER from env var (set in Render dashboard)
// so it survives restarts (Render's disk is ephemeral on free tier).
// ---------------------------------------------------------------------------
const configPath = path.join(__dirname, 'config.json');
let targetNumber = process.env.TARGET_NUMBER || '';

if (fs.existsSync(configPath)) {
    try {
        const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        targetNumber = saved.targetNumber || targetNumber;
    } catch (e) {
        console.error('Error loading config:', e);
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(configPath, JSON.stringify({ targetNumber }, null, 2));
        console.log(`[Config] Saved target number: ${targetNumber}`);
    } catch (e) {
        console.error('Error saving config:', e);
    }
}

// ---------------------------------------------------------------------------
// WhatsApp Client
// KEY FIX: webVersionCache pins a known-working WhatsApp Web version.
// Without this, authentication silently fails on cloud deployments.
// ---------------------------------------------------------------------------
const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'whatsapp-bot-persistent' }),
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
    },
    puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--no-zygote',
            '--disable-gpu'
            // NOTE: --single-process removed — causes Puppeteer crashes
        ]
    }
});

client.on('qr', async (qr) => {
    console.log('\n--- NEW QR CODE GENERATED ---');
    try {
        currentQR = await qrcode.toDataURL(qr);
        isConnected = false;
        isAuthenticating = false;
        pairingCode = null;
        console.log('QR ready. Open the dashboard to scan.');
    } catch (err) {
        console.error('Error generating QR code image:', err);
    }
});

client.on('authenticated', () => {
    console.log('\n🔐 QR Scanned! Authenticating...');
    isAuthenticating = true;
    currentQR = null;
    pairingCode = null;
});

client.on('ready', () => {
    console.log('\n✅ Bot is READY and listening for incoming photos!');
    isConnected = true;
    isAuthenticating = false;
    currentQR = null;
    pairingCode = null;
});

client.on('auth_failure', (msg) => {
    console.error('❌ Authentication failure:', msg);
    isConnected = false;
});

client.on('disconnected', (reason) => {
    console.log('⚠️  Bot disconnected:', reason);
    isConnected = false;
    isAuthenticating = false;
    currentQR = null;
    pairingCode = null;
    console.log('[Bot] Re-initializing in 5 seconds...');
    setTimeout(() => {
        client.initialize().catch(err => console.error('Re-init failed:', err));
    }, 5000);
});

client.on('message', async (msg) => {
    if (!msg.hasMedia) return;
    try {
        if (!targetNumber) {
            console.log('Photo received but no target number set. Skipping.');
            return;
        }
        const media = await msg.downloadMedia();
        if (media && media.mimetype && media.mimetype.startsWith('image/')) {
            console.log(`\nPhoto from ${msg.from} → forwarding to ${targetNumber}`);
            await client.sendMessage(targetNumber, media, {
                caption: `Forwarded photo from: ${msg.from}`
            });
            lastPhotoForwarded = { from: msg.from, time: new Date().toLocaleTimeString() };
            console.log('✅ Forwarded successfully!');
            await msg.reply('\uD83E\uDD16 Photo received and forwarded successfully!');
        }
    } catch (error) {
        console.error('Error handling media message:', error);
    }
});

client.initialize().catch(err => {
    console.error('Failed to initialize WhatsApp client:', err);
});

// ---------------------------------------------------------------------------
// Dashboard HTML
// ---------------------------------------------------------------------------
function getDashboard(status) {
    const uptime = Math.floor((Date.now() - botStartTime) / 60000);
    let content = '';

    if (!targetNumber) {
        content = `
            <div class="card">
                <div class="badge badge-warning">SETUP REQUIRED</div>
                <h1>Welcome to WhatsApp Bot</h1>
                <p>Enter the phone number (with country code) where you want photos forwarded.</p>
                <form action="/set-number" method="POST" class="setup-form">
                    <input type="text" name="number" placeholder="e.g. 918250885181" required />
                    <button type="submit">Start Botting</button>
                </form>
                <p class="hint">Photos received by your linked WhatsApp will be sent here.</p>
            </div>`;
    } else if (status === 'connected') {
        content = `
            <div class="card status-online">
                <div class="badge">ONLINE</div>
                <h1>Bot is Active \uD83E\uDD16</h1>
                <p>Forwarding photos to <strong>${targetNumber.split('@')[0]}</strong></p>
                <div class="stats">
                    <div class="stat-item">
                        <span class="label">Uptime</span>
                        <span class="value">${uptime} mins</span>
                    </div>
                    <div class="stat-item">
                        <span class="label">Last Forward</span>
                        <span class="value">${lastPhotoForwarded ? lastPhotoForwarded.time : 'None yet'}</span>
                    </div>
                </div>
                <div class="actions">
                    <button onclick="toggleEdit()" class="btn-secondary">Change Recipient</button>
                </div>
                <div id="edit-form" style="display:none; margin-top:20px;">
                    <form action="/set-number" method="POST" class="setup-form">
                        <input type="text" name="number" value="${targetNumber.split('@')[0]}" required />
                        <button type="submit">Update</button>
                    </form>
                </div>
            </div>`;
    } else if (status === 'qr') {
        let authContent = pairingCode ? `
                <div class="badge badge-warning">PAIRING CODE</div>
                <h1>Enter this code in WhatsApp</h1>
                <h2 style="letter-spacing:5px;color:var(--primary);font-size:32px;background:rgba(255,255,255,0.1);padding:15px;border-radius:12px;margin:20px 0;">${pairingCode}</h2>
                <p class="hint">WhatsApp &rarr; Linked Devices &rarr; Link with Phone Number Instead</p>
                <form action="/request-pairing" method="POST" class="setup-form" style="margin-top:20px;">
                    <input type="hidden" name="clear" value="true">
                    <button type="submit" class="btn-secondary">Go Back to QR</button>
                </form>` : `
                <div class="badge badge-warning">AUTHENTICATION REQUIRED</div>
                <h1>Link your WhatsApp</h1>
                <p>Scan this QR code with your phone. It refreshes automatically every 15 seconds.</p>
                <div class="qr-container">
                    <img src="${currentQR}" alt="QR Code" />
                    <div class="scan-line"></div>
                </div>
                <hr style="border:0;height:1px;background:rgba(255,255,255,0.1);margin:20px 0;">
                <p style="margin-bottom:10px;"><b>OR</b> Use Phone Number (more reliable)</p>
                <form action="/request-pairing" method="POST" class="setup-form">
                    <input type="text" name="phoneNumber" placeholder="e.g. 918250885181" required />
                    <button type="submit">Get Pairing Code</button>
                </form>`;

        content = `
            <div class="card">
                ${authContent}
                <div class="actions" style="margin-top:20px;">
                    <button onclick="toggleEdit()" class="btn-secondary">Change Recipient (${targetNumber.split('@')[0]})</button>
                </div>
                <div id="edit-form" style="display:none;margin-top:20px;">
                    <form action="/set-number" method="POST" class="setup-form">
                        <input type="text" name="number" value="${targetNumber.split('@')[0]}" required />
                        <button type="submit">Update</button>
                    </form>
                </div>
            </div>`;
    } else {
        content = `
            <div class="card">
                <div class="badge" style="background:rgba(59,130,246,0.1);color:#3b82f6;">LINKING DEVICE</div>
                <h1>Almost there! &#x1F517;</h1>
                <div class="loading-spinner" style="border-top-color:#3b82f6;margin-top:20px;"></div>
                <p style="margin-top:20px;">QR scanned! Loading your WhatsApp chats &amp; contacts...<br><small>This takes 1&ndash;2 minutes on first link.</small></p>
                <p class="hint">Do NOT close this page or your phone's WhatsApp.</p>
            </div>`;
    }

    // Auto-refresh: server-side meta as fallback. JS polling handles fast detection.
    let refreshMeta = '';
    if (status === 'loading') refreshMeta = '<meta http-equiv="refresh" content="8">';
    if (status === 'qr' && !pairingCode) refreshMeta = '<meta http-equiv="refresh" content="15">';
    if (status === 'authenticating') refreshMeta = '<meta http-equiv="refresh" content="5">';

    return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>WhatsApp Bot Dashboard</title>
            ${refreshMeta}
            <style>
                :root { --bg:#0f172a; --card-bg:rgba(30,41,59,0.7); --primary:#10b981; --text:#f8fafc; --text-muted:#94a3b8; }
                body { margin:0; font-family:'Inter',system-ui,-apple-system,sans-serif; background:radial-gradient(circle at top left,#1e293b,#0f172a); color:var(--text); display:flex; align-items:center; justify-content:center; min-height:100vh; overflow:auto; }
                .container { width:100%; max-width:450px; padding:20px; }
                .card { background:var(--card-bg); backdrop-filter:blur(12px); border:1px solid rgba(255,255,255,0.1); border-radius:24px; padding:40px; text-align:center; box-shadow:0 25px 50px -12px rgba(0,0,0,0.5); animation:slideIn 0.5s ease-out; }
                @keyframes slideIn { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
                h1 { font-size:24px; margin:16px 0 8px; }
                p { color:var(--text-muted); font-size:15px; line-height:1.5; margin-bottom:24px; }
                .badge { display:inline-block; padding:6px 12px; background:rgba(16,185,129,0.1); color:var(--primary); border-radius:99px; font-size:12px; font-weight:700; letter-spacing:.05em; }
                .badge-warning { background:rgba(245,158,11,0.1); color:#f59e0b; }
                .status-online { border-color:rgba(16,185,129,0.4); }
                .qr-container { position:relative; background:white; padding:15px; border-radius:16px; display:inline-block; margin:10px 0; box-shadow:0 0 20px rgba(16,185,129,0.2); }
                .qr-container img { width:220px; height:220px; display:block; }
                .scan-line { position:absolute; top:15px; left:15px; right:15px; height:2px; background:var(--primary); box-shadow:0 0 10px var(--primary); animation:scan 2s linear infinite; }
                @keyframes scan { 0%{top:15px} 50%{top:235px} 100%{top:15px} }
                .stats { display:flex; gap:15px; margin-top:30px; border-top:1px solid rgba(255,255,255,0.1); padding-top:20px; }
                .stat-item { flex:1; text-align:left; }
                .stat-item .label { display:block; font-size:11px; color:var(--text-muted); text-transform:uppercase; }
                .stat-item .value { font-size:16px; font-weight:600; color:var(--text); }
                .loading-spinner { width:40px; height:40px; border:3px solid rgba(16,185,129,0.1); border-top-color:var(--primary); border-radius:50%; margin:0 auto 20px; animation:spin 1s linear infinite; }
                @keyframes spin { to{transform:rotate(360deg)} }
                .hint { font-size:12px; margin-top:20px; }
                .setup-form { display:flex; flex-direction:column; gap:12px; }
                .setup-form input { background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); padding:12px 16px; border-radius:12px; color:white; font-size:16px; outline:none; }
                .setup-form input:focus { border-color:var(--primary); }
                .setup-form button, .actions button { background:var(--primary); color:white; border:none; padding:12px; border-radius:12px; font-weight:600; cursor:pointer; transition:opacity 0.2s; }
                .setup-form button:hover, .actions button:hover { opacity:0.9; }
                .btn-secondary { background:rgba(255,255,255,0.1)!important; color:var(--text-muted)!important; }
                .actions { margin-top:16px; }
            </style>
            <script>
                function toggleEdit() {
                    const f = document.getElementById('edit-form');
                    f.style.display = f.style.display === 'none' ? 'block' : 'none';
                }
                // Poll /health every 3s and reload as soon as bot is connected
                (function poll() {
                    fetch('/health').then(r => r.json()).then(data => {
                        if (data.status === 'connected') { location.reload(); return; }
                        setTimeout(poll, 3000);
                    }).catch(() => setTimeout(poll, 5000));
                })();
            </script>
        </head>
        <body><div class="container">${content}</div></body>
        </html>`;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
    if (isConnected)           res.send(getDashboard('connected'));
    else if (isAuthenticating) res.send(getDashboard('authenticating'));
    else if (currentQR)        res.send(getDashboard('qr'));
    else                       res.send(getDashboard('loading'));
});

app.get('/health', (req, res) => {
    res.json({
        status: isConnected ? 'connected' : isAuthenticating ? 'authenticating' : 'waiting',
        uptime: Math.floor((Date.now() - botStartTime) / 1000),
        targetNumber: targetNumber ? targetNumber.split('@')[0] : null
    });
});

app.post('/set-number', (req, res) => {
    let number = (req.body.number || '').trim().replace(/\D/g, '');
    if (number) {
        targetNumber = `${number}@c.us`;
        saveConfig();
    }
    res.redirect('/');
});

app.post('/request-pairing', async (req, res) => {
    if (req.body.clear) {
        pairingCode = null;
        return res.redirect('/');
    }
    const number = (req.body.phoneNumber || '').trim().replace(/\D/g, '');
    if (number && !isConnected) {
        try {
            console.log(`Requesting pairing code for ${number}...`);
            let code = await client.requestPairingCode(number);
            if (code && code.length === 8) code = code.slice(0, 4) + '-' + code.slice(4);
            pairingCode = code;
            console.log(`Pairing code: ${pairingCode}`);
        } catch (error) {
            console.error('Error requesting pairing code:', error);
            pairingCode = 'ERROR - Try again';
        }
    }
    res.redirect('/');
});

// ---------------------------------------------------------------------------
// Start server — bind to 0.0.0.0 so Render detects the open port
// ---------------------------------------------------------------------------
app.listen(port, '0.0.0.0', () => {
    console.log(`\n==============================================`);
    console.log(` Web server running on port ${port}`);
    console.log(`==============================================\n`);
});
