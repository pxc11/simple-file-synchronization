const net = require('net');
const {serverConfig} = require('../config');
const WatchFilesChange = require('./WatchFilesChange');
const DataProtocol = require('./DataProtocol');
const Path = require("path");
const fs = require("fs-extra");
const Common = require("./Common");

class Server {
    constructor() {
        this.id = 0;
        this.sockets = new Map();
        this.watchFilesChange = new WatchFilesChange(serverConfig.WATCH_PATH, serverConfig.OPTIONS, serverConfig.WATCH_INTERVAL_TIME);
        this.watchFilesChange.on('consume', (e, f) => {
            e.from = 'server';
            this.sendMessagesToAllSockets(e, () => {
                f();
            })

        })

        this.server = net.createServer((socket) => {
            this.id++;
            console.log('Client connected: ', this.id);
            socket.id = this.id;


            socket.on('close', () => {
                this.sockets.delete(socket.id);
                if (socket.isSimply) {
                    process.exit();
                }
                console.log(socket.id, 'Bye!');
            });
            socket.on('error', (error) => {
                console.error(socket.id, 'Socket error:', error);
                this.sockets.delete(socket.id);
                socket.destroy();
            });

            const dataProtocol = new DataProtocol();
            socket.on('data', (data) => {
                dataProtocol.decodeData(data);
            });
            dataProtocol.onData(async (data) => {
                console.log('server receive:', data.toString());
                data = JSON.parse(data.toString());
                if (data.isSimply) {
                    socket.isSimply = 1;
                    this.sockets.set(socket.id, socket);
                    return;
                }

                const absolutePath = Path.join(serverConfig.WATCH_PATH, data.relativePath);
                // Another connect.
                if (data.commandType === 'file') {
                    if (data.op === 'fileUpload') {
                        socket.removeAllListeners('data');
                        let t = dataProtocol.tempData;
                        dataProtocol.tempData = Buffer.alloc(0);
                        if (fs.existsSync(absolutePath)) {
                            let stat = fs.statSync(absolutePath);
                            if (stat && stat.mtimeMs > data.mtimeMs) {
                                socket.end();
                                return;
                            }
                        }
                        fs.mkdirpSync(Path.dirname(absolutePath));
                        await this.watchFilesChange.ch.unwatch(absolutePath);
                        this.watchFilesChange.unwatchPaths.add(data.relativePath);
                        const ws = fs.createWriteStream(absolutePath, {flags: 'w'});
                        ws.write(t);
                        socket.pipe(ws);
                        ws.on('close', () => {
                            this.watchFilesChange.ch.add(absolutePath);
                            this.watchFilesChange.unwatchPaths.delete(data.relativePath);
                        });
                    }
                    if (data.op === 'fileDownload') {
                        if (!fs.existsSync(absolutePath)) {
                            data.status = 0;
                            socket.write(DataProtocol.encodeData(Buffer.from(JSON.stringify(data))));
                            console.log('server send:', JSON.stringify(data));
                            return;
                        } else {
                            data.status = 1;
                            socket.write(DataProtocol.encodeData(Buffer.from(JSON.stringify(data))))
                            console.log('server send:', JSON.stringify(data));
                            const rs = fs.createReadStream(absolutePath);
                            rs.pipe(socket);
                        }
                    }

                }
                if (data.commandType === 'simply') {
                    await this.watchFilesChange.ch.unwatch(absolutePath);
                    this.watchFilesChange.unwatchPaths.add(data.relativePath);
                    Common.simplyCommandHandle(data.eventName, absolutePath);
                    this.watchFilesChange.ch.add(absolutePath);
                    this.watchFilesChange.unwatchPaths.delete(data.relativePath);
                    data.status = 1;
                    socket.write(DataProtocol.encodeData(Buffer.from(JSON.stringify(data))));
                    console.log('server send:', JSON.stringify(data));
                }

            });


        });
    }

    listen() {
        this.server.listen(serverConfig.PORT, () => {
            console.log(`Server running on port ${serverConfig.PORT}`);
        })
    }

    sendMessagesToAllSockets(e, f) {
        if (this.sockets.size === 0) {
            f();
            return;
        }
        const m = DataProtocol.encodeData(Buffer.from(
            JSON.stringify(e)
        ));
        const messages = [];
        this.sockets.forEach((s) => {
            messages.push(new Promise((r) => {
                s.write(m, (err) => {
                        if (err) {
                            console.log(err);
                        }
                        console.log('server send to', s.id, s.isSimply, JSON.stringify(e));
                        r();
                    }
                )
            }))
        })
        Promise.all(messages).then(() => {
            f();
        })
    }
}


module.exports = Server;