const net = require('net');
const Queue = require('./Queue');
const {clientConfig} = require('../config');
const WatchFilesChange = require('./WatchFilesChange');
const DataProtocol = require('./DataProtocol');
const Path = require("path");
const fs = require("fs-extra");
const fs2 = require("fs");
const fsPromise = require("fs").promises;
const Common = require("./Common");


class Client extends Queue {
    constructor() {
        super();
        this.name = 'client queue';
        this.client = new net.Socket();
        this.maxThreadCount = clientConfig.MAX_FILE_CHANNEL_COUNT;
        this.client.connect(clientConfig.PORT, clientConfig.HOST, () => {
            this.client.write(DataProtocol.encodeData(Buffer.from(JSON.stringify({
                isSimply: 1
            }))));
            setInterval(() => {
                this.client.write(DataProtocol.encodeData(Buffer.from(JSON.stringify({
                    heartBeat: 1
                }))));
            }, 5000);
            this.watchFilesChange = new WatchFilesChange(clientConfig.WATCH_PATH, clientConfig.OPTIONS, 2);
            this.watchFilesChange.from = 'client';
            this.watchFilesChange.on('consume', (e, f) => {
                e.from = 'client';
                e.socket_id = this.client.id;
                //console.log('watch consume', JSON.stringify(e));
                this.enQueue(e);
                f();
            })
            this.dataProtocol = new DataProtocol();
            this.dataProtocol.onData((d) => {
                //console.log('client receive:', d.toString());
                d = JSON.parse(d.toString());
                if (d.heartBeat) {
                    return;
                }
                if (d.socket_id && !this.client.id) {
                    this.client.id = d.socket_id;
                    return;
                }
                d.socket_id = this.client.id;
                if (d.retry) {
                    this.eventList.unshift(d);
                    this.attemptConsume();
                } else {
                    this.enQueue(d);
                }
            })
            this.client.on('data', (c) => {
                this.dataProtocol.decodeData(c);
            })


            this.on('consume', async (e, end) => {
                //console.log('client consume', JSON.stringify(e));
                if (e.from === 'server') {
                    if (e.eventName === 'change') {
                        if (this.maxThreadCount <= 0) {
                            this.eventList.unshift(e);
                            this.consuming = false;
                        } else {
                            this.maxThreadCount--;
                            this.handEventFromServer(e).finally(() => {
                                this.maxThreadCount++;
                                setImmediate(() => {
                                    this.attemptConsume();
                                })
                            })
                            end();
                        }
                    } else {
                        this.handEventFromServer(e).finally(() => {
                            end();
                        });

                    }
                }
                if (e.from === 'client') {
                    if (e.eventName === 'change') {
                        if (this.maxThreadCount <= 0) {
                            this.eventList.unshift(e);
                            this.consuming = false;
                        } else {
                            this.maxThreadCount--;
                            this.handEventFromClient(e).finally(() => {
                                this.maxThreadCount++;
                                setImmediate(() => {
                                    this.attemptConsume();
                                })
                            })
                            end();
                        }
                    } else {
                        this.handEventFromClient(e).finally(() => {
                            end();
                        });
                    }
                }


            })
        })

        setInterval(() => {
            Common.optimizeQueue(this.eventList);
            if (this.eventList.length > 0) {
                console.log('The number of tasks remaining:', this.eventList.length);
                console.log('maxThreadCount:', this.maxThreadCount);

            }
        }, 2000)

        this.client.on('error', (e) => {
            console.error('this.client err:', e);
            process.exit();
        })
        this.client.on('close', () => {
            console.log('Connection closed');
            process.exit();
        });

    }

    handEventFromServer(e) {
        let e2 = structuredClone(e);
        return new Promise(async (resolve, reject) => {
            try {
                const absolutePath = Path.join(clientConfig.WATCH_PATH, e.relativePath);
                if (e.eventName === 'change') {
                    if (await fs.pathExists(absolutePath)) {
                        try {
                            const stat = await fsPromise.stat(absolutePath);
                            if (stat.mtimeMs >= e.mtimeMs && !e.retry) {
                                console.log('local file is newer than remote file', e.relativePath);
                                resolve();
                                return;
                            } else {
                                e.mtimeMs = stat.mtimeMs;
                            }
                        } catch (err) {
                            console.error('Error getting file stats:', err);
                            reject(err);
                            return;
                        }

                    } else {
                        e.mtimeMs = 0;
                    }

                    e.op = 'fileDownload';
                    e.commandType = 'file';
                    const client = (new net.Socket()).connect(clientConfig.PORT, clientConfig.HOST, () => {
                        const dp = new DataProtocol();
                        dp.onData(async (d) => {
                            try {
                                //console.log('client receive(file channel):', d.toString());
                                d = JSON.parse(d.toString());
                                client.removeAllListeners('data');
                                let t = dp.tempData;
                                dp.tempData = Buffer.alloc(0);
                                client.on('data', (d) => {
                                    t = Buffer.concat([t, d]);
                                })
                                if (d.status) {
                                    this.watchFilesChange.unwatchPaths.add(d.relativePath);
                                    await fs.mkdirp(Path.dirname(absolutePath));
                                    const ws = fs2.createWriteStream(absolutePath, {flags: 'w'});
                                    e2.retry = 1;
                                    ws.on('close', async () => {
                                        try {
                                            let stat = await fsPromise.stat(absolutePath);
                                            if (stat.size !== d.size) {
                                                reject(new Error('size is unequal'));
                                            }
                                        } catch (err) {
                                            console.error(err);
                                            reject(err);
                                        }
                                        setTimeout(async () => {
                                            this.watchFilesChange.unwatchPaths.delete(d.relativePath);
                                        }, 100);
                                        //console.log('Download file finish', JSON.stringify(d.relativePath));
                                        resolve();
                                    });
                                    ws.on('error', (err) => {
                                        console.error('writeStream err:', err);
                                        setTimeout(async () => {
                                            this.watchFilesChange.unwatchPaths.delete(d.relativePath);
                                        }, 100);
                                        client.end();
                                        ws.destroy();
                                        reject(err);
                                    })
                                    client.removeAllListeners('data');
                                    // if(t.toString()){
                                    //     console.log(t.toString());
                                    // }
                                    ws.write(t);
                                    client.pipe(ws);
                                } else {
                                    client.end();
                                    resolve();
                                }
                            } catch (err) {
                                console.error('Error processing data from server:', err);
                                client.end();
                                reject(err);
                            }
                        });
                        client.on('data', (d) => {
                            dp.decodeData(d);
                        });
                        client.write(DataProtocol.encodeData(Buffer.from(JSON.stringify(e))), (err) => {
                            if (err) {
                                reject(err);
                            }
                        });
                        //console.log('client send(file channel):', JSON.stringify(e));
                    });

                    client.on('error', (err) => {
                        console.error('Client connection error:', err);
                        client.destroy();
                        reject(err);
                    });

                } else {
                    try {
                        await this.watchFilesChange.ch.unwatch(absolutePath);
                        this.watchFilesChange.unwatchPaths.add(e.relativePath);
                        await Common.simplyCommandHandle(e.eventName, absolutePath);
                        //console.log('Event execute success:', JSON.stringify(e));
                        setTimeout(async () => {
                            await this.watchFilesChange.ch.add(absolutePath);
                            this.watchFilesChange.unwatchPaths.delete(e.relativePath);
                        }, 100)
                        resolve();
                    } catch (err) {
                        console.error('Error handling other events:', err);
                        reject(err);
                    }
                }
            } catch (err) {
                console.error('Error in handEventFromServer:', err);
                reject(err);
            }
        }).catch((err) => {
            console.error('Error in handEventFromServer 2:', err, JSON.stringify(e2));
            this.eventList.unshift(e2);
        });

    }

    handEventFromClient(e) {
        let e2 = structuredClone(e);
        return new Promise(async (f, r) => {  // f 用于 resolve，r 用于 reject
            try {
                const absolutePath = Path.join(clientConfig.WATCH_PATH, e.relativePath);
                if (e.eventName === 'change') {
                    if (!await fs.pathExists(absolutePath)) {
                        f();
                        return;
                    }
                    const stat = await fsPromise.stat(absolutePath).catch(err => {
                        console.error('Error getting file stats:', err);
                        r(err);
                    });
                    if (!stat) {
                        f();
                        return;
                    }
                    e.op = 'fileUpload';
                    e.commandType = 'file';
                    e.mtimeMs = stat.mtimeMs;
                    e.size = stat.size;

                    const client = new net.Socket();
                    client.setTimeout(10000);
                    client.connect(clientConfig.PORT, clientConfig.HOST, () => {
                        try {
                            client.write(DataProtocol.encodeData(Buffer.from(JSON.stringify(e))));
                            //console.log('client send(file channel):', JSON.stringify(e));
                            const rw = fs2.createReadStream(absolutePath);
                            rw.pipe(client);
                            rw.on('error', (err) => {
                                console.error('read stream error:', err);
                                rw.destroy();
                                client.end();
                                r(err);
                            })
                            client.on('close', () => {
                                f();
                            });
                        } catch (err) {
                            client.end();
                            r(err);
                        }
                    });

                    client.on('error', (err) => {
                        client.destroy();
                        r(err);
                    });
                } else {
                    e.commandType = 'simply';
                    this.client.write(DataProtocol.encodeData(Buffer.from(JSON.stringify(e))), (err) => {
                        if (err) {
                            r(err);
                        } else {
                            f();
                        }

                    });

                }
            } catch (err) {
                r(err);
            }
        }).catch((err) => {
            console.error('Error in handEventFromClient 2:', err);
            this.eventList.unshift(e2);
        });


    }
}

module.exports = Client;