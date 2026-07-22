const socket = io();
const term = new Terminal({
    cursorBlink: true,
    fontFamily: '"Fira Code", monospace',
    fontSize: 14,
    theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff'
    }
});
const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById('terminal-container'));
fitAddon.fit();

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const connectBtn = document.getElementById('connectBtn');

let isAgentReady = false;

socket.on('connect', () => {
    term.write('\r\n*** Connected to Web Terminal UI Server ***\r\n');
});

socket.on('agent-ready', (config) => {
    isAgentReady = true;
    statusDot.style.backgroundColor = '#238636'; // GitHub green
    statusDot.style.boxShadow = '0 0 10px rgba(35, 134, 54, 0.5)';
    statusText.style.color = '#238636';
    statusText.textContent = 'Agent Ready!';
    
    connectBtn.disabled = false;
    connectBtn.textContent = 'Connect Terminal';
    connectBtn.classList.add('ready');
});

connectBtn.addEventListener('click', () => {
    if (isAgentReady) {
        socket.emit('connect-terminal');
        connectBtn.disabled = true;
        connectBtn.textContent = 'Connecting...';
        setTimeout(() => {
            if(isAgentReady) {
                connectBtn.disabled = false;
                connectBtn.textContent = 'Reconnect';
            }
        }, 3000);
    }
});

socket.on('terminal-output', (data) => {
    term.write(data);
});

term.onData((data) => {
    socket.emit('terminal-input', data);
});

window.addEventListener('resize', () => {
    fitAddon.fit();
    socket.emit('resize', { cols: term.cols, rows: term.rows });
});
