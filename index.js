const { spawn } = require('child_process');

function startBot() {
    console.log('[Manager] Spawning bot process...');
        const bot = spawn('node', ['bot.js'], {
                stdio: 'inherit'
                    });

                        bot.on('close', (code) => {
                                console.log(`[Manager] Bot process exited with code ${code}.`);
                                        console.log('[Manager] Restarting bot in 2 seconds...');
                                                setTimeout(startBot, 2000);
                                                    });
                                                    }

                                                    startBot();
