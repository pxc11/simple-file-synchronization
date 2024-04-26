const net = require('net');
const common = require('./lib/common.js');
const path = require('path');

const {PORT, WATCH_PATH, LISTEN_PATH, OPTIONS, WATCH_INTERVAL_TIME} = require('./config.js').serverConfig;


const server = net.createServer((socket) => {
    console.log('Client connected');
    common.listenFileChange(socket, LISTEN_PATH);
    common.watchFileChange(WATCH_PATH, OPTIONS, socket, WATCH_INTERVAL_TIME);

    socket.on('end', () => {
        console.log('Bye!');
    });

    socket.on('error', (error) => {
        console.error('Socket error:', error);
        socket.destroy();
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});