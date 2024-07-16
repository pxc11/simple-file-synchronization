const net = require('net');
const Queue = require('./Queue');
const {clientConfig} = require('../config');
const WatchFilesChange = require('./WatchFilesChange');
const DataProtocol = require('./DataProtocol');
const Path = require("path");
const fs = require("fs-extra");
const fs2 = require("fs");
const Common = require("./Common");


class Client extends Queue {
    constructor() {
        super();

        this.client = new net.Socket();
        this.client.connect(clientConfig.PORT, clientConfig.HOST, () => {
            this.client.write(DataProtocol.encodeData(Buffer.from(JSON.stringify({
                isSimply: 1
            }))));
            this.watchFilesChange = new WatchFilesChange(clientConfig.WATCH_PATH, clientConfig.OPTIONS, 2);
            this.watchFilesChange.on('consume', (e, f) => {
                e.from = 'client';
                this.enQueue(e);
                f();
            })
            this.dataProtocol = new DataProtocol();
            this.dataProtocol.onData((d) => {
                d = JSON.parse(d.toString());
                if (d.status) {
                    this.consuming = false;
                    this.attemptConsume();
                } else {
                    this.enQueue(d);
                }

            })
            this.client.on('data', (c) => {
                this.dataProtocol.decodeData(c);
            })
            this.on('consume', async (e, f) => {
                console.log('client consume:', JSON.stringify(e));
                const absolutePath = Path.join(clientConfig.WATCH_PATH, e.relativePath);
                if (e.from === 'server') {
                    if (e.eventName === 'change') {
                        if (fs.pathExistsSync(absolutePath)) {
                            const stat = fs.statSync(absolutePath);
                            if (stat && stat.mtimeMs > e.mtimeMs) {
                                f();
                                return;
                            }
                        }
                        e.op = 'fileDownload';
                        e.commandType = 'file';
                        const client = (new net.Socket()).connect(clientConfig.PORT, clientConfig.HOST, () => {
                            const dp = new DataProtocol();
                            client.on('data', (d) => {
                                dp.decodeData(d);
                            })
                            dp.onData(async (d) => {
                                console.log('client receive data:', d.toString());
                                d = JSON.parse(d.toString());
                                client.removeAllListeners('data');
                                let t = dp.tempData;
                                dp.tempData = Buffer.alloc(0);
                                if (d.status) {
                                    await this.watchFilesChange.ch.unwatch(absolutePath);
                                    this.watchFilesChange.unwatchPaths.add(d.relativePath);
                                    const ws = fs2.createWriteStream(absolutePath, {flags: 'w'});
                                    ws.on('close', () => {
                                        this.watchFilesChange.ch.add(absolutePath);
                                        this.watchFilesChange.unwatchPaths.delete(d.relativePath);
                                        f();
                                    });
                                    ws.write(t);
                                    client.pipe(ws);
                                } else {
                                    client.end();
                                    f();
                                }
                            })
                            client.write(DataProtocol.encodeData(Buffer.from(JSON.stringify(e))));
                            console.log('client send:', JSON.stringify(e));
                        })

                    } else {
                        await this.watchFilesChange.ch.unwatch(absolutePath);
                        this.watchFilesChange.unwatchPaths.add(e.relativePath);
                        Common.simplyCommandHandle(e.eventName, absolutePath);
                        this.watchFilesChange.ch.add(absolutePath);
                        this.watchFilesChange.unwatchPaths.delete(e.relativePath);
                        f();
                    }
                }
                if (e.from === 'client') {
                    if (e.eventName === 'change') {
                        if (!fs.pathExistsSync(absolutePath)) {
                            f();
                            return;
                        }
                        const stat = fs.statSync(absolutePath);
                        if (!stat) {
                            f();
                            return;
                        }
                        if (stat.mtimeMs !== e.mtimeMs) {
                            f();
                            return;
                        }
                        e.op = 'fileUpload';
                        e.commandType = 'file';
                        e.mtimeMs = stat.mtimeMs;

                        const client = (new net.Socket()).connect(clientConfig.PORT, clientConfig.HOST, () => {
                            client.write(DataProtocol.encodeData(Buffer.from(JSON.stringify(e))));
                            console.log('client send:', JSON.stringify(e));
                            const rw = fs2.createReadStream(absolutePath);
                            rw.pipe(client);
                            client.on('close', () => {
                                f();
                            })
                        })


                    } else {
                        e.commandType = 'simply';
                        this.client.write(DataProtocol.encodeData(Buffer.from(JSON.stringify(e))));
                        console.log('client send:', JSON.stringify(e));
                    }
                }
            })
        })

        // setInterval(()=>{
        //    console.log('client queue:',this.eventList.length);
        // },3000)

        this.client.on('error', (e) => {
            console.log(e);
            process.exit();
        })
        this.client.on('close', () => {
            console.log('Connection closed');
            process.exit();
        });
    }
}

module.exports = Client;