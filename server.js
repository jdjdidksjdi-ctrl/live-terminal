require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client } = require('ssh2');
const path = require('path');
const https = require('https');

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

let currentSshConfig = null;

// The webhook from GitHub Actions via Ntfy
app.post('/webhook', (req, res) => {
    try {
        const token = req.body.token; // "ssh xxx@nyc1.tmate.io"
        if (!token || !token.startsWith('ssh ')) {
            return res.status(400).send('Invalid token');
        }

        console.log('Got new Auto-Token:', token);
        
        const parts = token.replace('ssh ', '').trim().split('@');
        currentSshConfig = {
            username: parts[0],
            host: parts[1],
            port: 22
        };
        
        // Notify browser that agent is ready
        io.emit('agent-ready', currentSshConfig);
        res.status(200).send('OK');
    } catch (e) {
        res.status(500).send(e.message);
    }
});

io.on('connection', (socket) => {
    console.log('Browser connected');
    
    if (currentSshConfig) {
        socket.emit('agent-ready', currentSshConfig);
    }

    let sshClient = null;
    let sshStream = null;

    socket.on('connect-terminal', () => {
        if (!currentSshConfig) {
            socket.emit('terminal-output', '\r\nWaiting for GitHub Action to start...\r\n');
            return;
        }

        if (sshClient) {
            sshClient.end();
        }

        sshClient = new Client();
        
        socket.emit('terminal-output', '\r\n*** Connecting to Agent... ***\r\n');
        
        sshClient.on('ready', () => {
            socket.emit('terminal-output', '\r\n*** Agent Connected Successfully! ***\r\n');
            sshClient.shell({ term: 'xterm-color' }, (err, stream) => {
                if (err) {
                    socket.emit('terminal-output', '\r\n*** Shell Error: ' + err.message + ' ***\r\n');
                    return;
                }
                sshStream = stream;
                
                stream.on('data', (data) => {
                    socket.emit('terminal-output', data.toString('utf-8'));
                }).on('close', () => {
                    socket.emit('terminal-output', '\r\n*** Agent Disconnected ***\r\n');
                    sshClient.end();
                });
            });
        }).on('error', (err) => {
            socket.emit('terminal-output', '\r\n*** Connection Error: ' + err.message + ' ***\r\n');
        }).on('close', () => {
            socket.emit('terminal-output', '\r\n*** Connection Closed ***\r\n');
        });

        try {
            sshClient.connect({
                host: currentSshConfig.host,
                port: currentSshConfig.port,
                username: currentSshConfig.username,
                readyTimeout: 20000,
                algorithms: { serverHostKey: [ 'ssh-ed25519', 'ssh-rsa', 'ecdsa-sha2-nistp256' ] }
            });
        } catch (e) {
            socket.emit('terminal-output', '\r\n*** Connection Init Error: ' + e.message + ' ***\r\n');
        }
    });

    socket.on('terminal-input', (data) => {
        if (sshStream) {
            sshStream.write(data);
        }
    });

    socket.on('resize', (size) => {
        if (sshStream && size.cols && size.rows) {
            sshStream.setWindow(size.rows, size.cols, 480, 640);
        }
    });

    socket.on('disconnect', () => {
        console.log('Browser disconnected');
        if (sshClient) sshClient.end();
    });
});

// Start Ntfy Poller so we don't need a public webhook
const ntfyTopic = 'live_terminal_antigravity_xd_token_998877';
function pollNtfy() {
    https.get(`https://ntfy.sh/${ntfyTopic}/json?since=1m`, (res) => {
        res.on('data', (d) => {
            const lines = d.toString().split('\n');
            for (let line of lines) {
                if (!line.trim()) continue;
                try {
                    const msg = JSON.parse(line);
                    if (msg.event === 'message' && msg.message.startsWith('ssh ')) {
                        console.log('Received token from Ntfy polling');
                        const parts = msg.message.replace('ssh ', '').trim().split('@');
                        currentSshConfig = {
                            username: parts[0],
                            host: parts[1],
                            port: 22
                        };
                        io.emit('agent-ready', currentSshConfig);
                    }
                } catch(e){}
            }
        });
    }).on('error', () => {
        setTimeout(pollNtfy, 5000);
    });
}
pollNtfy();
setInterval(pollNtfy, 30000); // Failsafe poll

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Web Terminal Server running on port ${PORT}`);
});
