const net = require('net');
const client = new net.Socket();
const common = require('./lib/common.js');
const {PORT, HOST, WATCH_PATH, LISTEN_PATH, OPTIONS, WATCH_INTERVAL_TIME} = require('./config.js').clientConfig;
// 连接到服务器
client.connect(PORT, HOST, () => {
    console.log('Connected to server');
    common.listenFileChange(client, LISTEN_PATH);
    common.watchFileChange(WATCH_PATH, OPTIONS, client, WATCH_INTERVAL_TIME);

});

client.on('error', (e) => {
    console.log(e);
    process.exit();
})
client.on('close', () => {
    console.log('Connection closed');
    process.exit();
});
