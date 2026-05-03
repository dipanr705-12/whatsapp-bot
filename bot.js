const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

let currentQR = null;
let isConnected = false;

const targetNumber = '918250885181@c.us';

const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'bot-' + Date.now() }),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', async (qr) => {
    console.log('\n--- NEW QR CODE GENERATED ---');
    try {
        currentQR = await qrcode.toDataURL(qr);
    } catch (err) {
        console.error('Error generating QR code image', err);
    }
});

client.on('ready', () => {
    console.log('Bot is ready!');
    isConnected = true;
    currentQR = null;
});

client.on('disconnected', async (reason) => {
    console.log('Bot was disconnected:', reason);
    process.exit(1);
});

client.on('message', async (msg) => {
    if (msg.hasMedia) {
        try {
            const media = await msg.downloadMedia();
            if (media && media.mimetype && media.mimetype.startsWith('image/')) {
                await client.sendMessage(targetNumber, media, {
                    caption: `Forwarded photo from: ${msg.from}`
                });
                await msg.reply('Thank you! Your photo has been successfully uploaded and forwarded.');
            }
        } catch (error) {
            console.error('Error handling media message:', error);
        }
    }
});

client.initialize();

app.get('/', (req, res) => {
    if (isConnected) {
        res.send('<h1>✅ Bot is Successfully Connected!</h1>');
    } else if (currentQR) {
        res.send(`<h1>Scan to Login</h1><img src="${currentQR}" width="300" /><meta http-equiv="refresh" content="5">`);
    } else {
        res.send('<h1>⏳ Generating QR Code...</h1><meta http-equiv="refresh" content="2">');
    }
});

app.listen(port, () => {
    console.log('Server running on port ' + port);
});
