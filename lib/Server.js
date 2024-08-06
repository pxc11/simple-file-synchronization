const net = require('net');
const {serverConfig} = require('../config');
const WatchFilesChange = require('./WatchFilesChange');
const DataProtocol = require('./DataProtocol');
const Path = require("path");
const fs = require("fs-extra");
const fs2 = require("fs");
const fsPromise = require("fs").promises;
const Common = require("./Common");

class Server {
    constructor() {
        this.id = 0;
        this.sockets = new Map();
        this.watchFilesChange = new WatchFilesChange(serverConfig.WATCH_PATH, serverConfig.OPTIONS, serverConfig.WATCH_DEBOUNCE_INTERVAL);
        this.watchFilesChange.from = 'server';
        this.watchFilesChange.on('consume', (e, f) => {
            e.from = 'server';
            //console.log('watch consume', JSON.stringify(e));
            this.sendMessagesToAllSockets(e, f)
        })

        this.server = net.createServer((socket) => {
            this.id++;
            console.log('Client connected: ', this.id);
            socket.id = this.id;

            socket.on('close', () => {
                this.sockets.delete(socket.id);
                // if (socket.isSimply) {
                //     process.exit();
                // }
                console.log('Client', socket.id, 'Bye!');
            });
            socket.on('error', (error) => {
                console.error(socket.id, 'Socket error:', error);
                this.sockets.delete(socket.id);
                socket.destroy();
            });

            const dataProtocol = new DataProtocol();
            socket.dataProtocol = dataProtocol;
            socket.on('data', (data) => {
                //console.log(data);
                dataProtocol.decodeData(data);
            });
            dataProtocol.onData(async (data) => {
                //console.log('server receive:', data.toString(), ' file channel:', !socket.isSimply);
                data = JSON.parse(data.toString());
                if (data.isSimply) {
                    socket.isSimply = 1;
                    socket.write(DataProtocol.encodeData(Buffer.from(JSON.stringify({
                        socket_id: socket.id,
                    }))));
                    this.sockets.set(socket.id, socket);
                    return;
                }

                if (data.heartBeat) {
                    socket.write(DataProtocol.encodeData(Buffer.from(JSON.stringify(data))));
                    return;
                }
                const absolutePath = Path.join(serverConfig.WATCH_PATH, data.relativePath);
                // Another connect.
                if (data.commandType === 'file') {
                    if (data.op === 'fileUpload') {
                        this.fileUpload(socket, absolutePath, data);
                    }
                    if (data.op === 'fileDownload') {
                        this.fileDownload(socket, absolutePath, data);
                    }
                }
                if (data.commandType === 'simply') {
                    this.simplyHand(absolutePath, data);
                }

            });


        });
    }

    rejectFileUpload(data, socket) {
        data.status = 0;
        socket.write(DataProtocol.encodeData(Buffer.from(JSON.stringify(data))));
        //console.log('server send:', JSON.stringify(data), ' file channel:', !socket.isSimply);
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
                            console.error('send error:', err);
                        }
                        //console.log('server send to', s.id, JSON.stringify(e), ' file channel:', !s.isSimply);
                        r();
                    }
                )
            }))
        })
        Promise.all(messages).then(() => {
            f();
        })
    }


    /**
     *
     * @param {net.Socket} socket
     * @param {string} absolutePath
     * @param {Object} data
     */
    async fileUpload(socket, absolutePath, data) {
        try {
            let dataProtocol = socket.dataProtocol;
            socket.removeAllListeners('data');
            let t = dataProtocol.tempData;
            dataProtocol.tempData = Buffer.alloc(0);
            socket.on('data', (d) => {
                t = Buffer.concat([t, d]);
            })

            if (!data.retry && await fs.pathExists(absolutePath)) {
                let stat = await fsPromise.stat(absolutePath);
                if (stat.mtimeMs > data.mtimeMs) {
                    socket.end();
                    return;
                }
            }

            await fs.mkdirp(Path.dirname(absolutePath));
            this.watchFilesChange.unwatchPaths.add(data.relativePath);
            const ws = fs2.createWriteStream(absolutePath, {flags: 'w'});
            ws.on('close', async () => {
                //console.log('write stream close', data.relativePath);
                try {
                    let stat = await fsPromise.stat(absolutePath);
                    if (stat.size !== data.size) {
                        console.error('size is unequal', JSON.stringify(data));
                        data.retry = 1;
                        this.sockets.get(data.socket_id).write(DataProtocol.encodeData(Buffer.from(JSON.stringify(data))));
                    }
                } catch (err) {
                    console.error('close error', err);
                }
                setTimeout(() => {
                    this.watchFilesChange.unwatchPaths.delete(data.relativePath);
                }, 100);
            });

            ws.on('error', (err) => {
                console.error('Error writing to stream:', err);
                setTimeout(() => {
                    this.watchFilesChange.unwatchPaths.delete(data.relativePath);
                }, 100);
                ws.destroy();
                socket.end();
            });
            socket.removeAllListeners('data');
            // if(t.toString()){
            //     console.log(t.toString());
            // }
            ws.write(t);
            socket.pipe(ws);

        } catch (err) {
            console.error('Error during file upload:', err);
            socket.end();
        }
    }

    /**
     *
     * @param {net.Socket} socket
     * @param {string} absolutePath
     * @param {Object} data
     */
    async fileDownload(socket, absolutePath, data) {
        let time = Date.now();
        try {
            if (!await fs.pathExists(absolutePath)) {
                this.rejectFileUpload(data, socket);
            } else {
                let stat = await fsPromise.stat(absolutePath);
                if (!data.retry && stat.mtimeMs <= data.mtimeMs) {
                    this.rejectFileUpload(data, socket);
                    return;
                }
                data.status = 1;
                data.size = stat.size;
                socket.write(DataProtocol.encodeData(Buffer.from(JSON.stringify(data))));
                //console.log('server send:', JSON.stringify(data), ' file channel:', !socket.isSimply);
                const rs = fs2.createReadStream(absolutePath);
                rs.pipe(socket);
                rs.on('error', (err) => {
                    console.error('Error during file download 2:', err);
                    rs.destroy();
                    socket.end();
                })
                socket.on('close', () => {
                    console.log("event", JSON.stringify(data), ' use time', Date.now() - time);
                })
            }
        } catch (err) {
            console.error('Error during file download:', err);
            this.rejectFileUpload(data, socket);
        }

    }

    /**
     *
     * @param {string} absolutePath
     * @param {Object} data
     */
    async simplyHand(absolutePath, data) {
        try {
            await this.watchFilesChange.ch.unwatch(absolutePath);
            this.watchFilesChange.unwatchPaths.add(data.relativePath);
            await Common.simplyCommandHandle(data.eventName, absolutePath);
            await this.watchFilesChange.ch.add(absolutePath);
            this.watchFilesChange.unwatchPaths.delete(data.relativePath);
        } catch (err) {
            console.error('Error during simply hand:', err);
        }
    }
}


module.exports = Server;