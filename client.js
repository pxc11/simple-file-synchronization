const net = require('net');
const client = new net.Socket();
const common = require('./lib/common.js');
const path = require("path");

const PORT = 3000;
const HOST = '127.0.0.1';
const WATCH_PATH = path.join(__dirname, '../test/client');
const LISTEN_PATH = WATCH_PATH;
const OPTIONS = {
    ignored: [

    ],
    ignoreInitial: true,

};

// 连接到服务器
client.connect(PORT, HOST, () => {
    console.log('Connected to server');
    common.listenFileChange(client, LISTEN_PATH);
    common.watchFileChange(WATCH_PATH, OPTIONS, client);

});

client.on('close', () => {
    console.log('Connection closed');
});



