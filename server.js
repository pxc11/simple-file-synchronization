const net = require('net');
const common = require('./lib/common.js');
const path = require("path");

const PORT = 3000;
const WATCH_PATHS = path.join(__dirname, '../test/server');
const LISTEN_PATH = WATCH_PATHS;
const OPTIONS = {
    ignored: [

    ],
    ignoreInitial: true,

};

const server = net.createServer((socket) => {
    console.log('Client connected');
    common.listenFileChange(socket, LISTEN_PATH);
    common.watchFileChange(WATCH_PATHS, OPTIONS, socket);

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