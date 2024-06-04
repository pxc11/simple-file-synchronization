const {
    SEND_FILE_CONFIRM_EVENT_NAME,
    SEND_FILE_ACCEPT_EVENT_NAME,
    SEND_FILE_REJECT_EVENT_NAME,
    SEND_FILE_CHUNK_EVENT_NAME,
    CHUNK_SIZE
} = require('./enum.js');
const DataProtocol = require("./DataProtocol");
const DataFormat = require("./DataFormat");
const chalk = require('chalk');
const path = require('path');
const fs = require('fs');

class SendEventQueue {

    consuming = false;

    /**
     *
     * @type {DataFormat[]}
     */
    queue = [];

    prefixPath;

    /**
     * @type {module:net.Socket}
     */
    socket;

    /**
     * @type {Lock}
     */
    lock;

    /**
     *
     * @param {module:net.Socket} socket
     * @param {string} prefixPath
     * @param {Lock} lock
     */
    constructor(socket, prefixPath, lock) {
        this.prefixPath = prefixPath;
        this.socket = socket;
        this.lock = lock;
    }

    /**
     *
     * @param {module:net.Socket} socket
     * @param {string} prefixPath
     * @param {Lock} lock
     */
    init(socket, prefixPath, lock) {
        this.prefixPath = prefixPath;
        this.socket = socket;
        this.lock = lock;
    }

    enQueue(event) {
        this.queue.push(event);
        this.consume();
    }

    isEmpty() {
        return this.queue.length === 0;
    }

    uniqueQuote() {
        this.queue = Array.from(new Set(this.queue.reverse().map(a => JSON.stringify(a)))).map(a => JSON.parse(a)).reverse();
    }

    consume() {
        if (this.consuming || this.isEmpty()) {
            return;
        }
        this.consuming = true;
        let event = this.queue.shift();
        console.log(chalk.greenBright(`Send event`));
        event.print();
        if (event.eventName === SEND_FILE_CHUNK_EVENT_NAME) {
            this.sendFile(event);
        } else if (event.eventName === SEND_FILE_CONFIRM_EVENT_NAME) {
            if (!this.lock.addLock(event.relativePath)) {
                console.log(`${event.relativePath}`, chalk.redBright(`is locked`));
                this.enQueue(event);
                this.consuming = false;
                this.consume();
            } else {
                this.sendSimpleEvent(event);
            }

        } else {
            this.sendSimpleEvent(event);
        }


    }

    sendSimpleEvent(event) {
        this.sendEvent(event).finally(() => {
            this.consuming = false;
            this.consume();
        }).catch((err) => {
            console.log(err);
            event.print();
            this.enQueue(event);
        })
    }


    /**
     *
     * @param {DataFormat} event
     */
    sendEvent(event) {
        return new Promise((resolve, reject) => {
            this.socket.write(DataProtocol.encodeData(Buffer.from(event.json())), (err) => {
                if (err) {
                    reject(chalk.redBright(`send event fail:`) + err)
                } else {
                    console.log(chalk.greenBright(`Send event actually`));
                    event.print();
                    resolve();
                }

            });
        });

    }

    /**
     *
     * @param {DataFormat} data
     */
    sendFile(data) {
        let absolutePath = path.join(this.prefixPath, data.relativePath);

        if (!fs.existsSync(absolutePath)) {
            this.lock.releaseLock(data.relativePath);
        } else {
            let mtime = fs.statSync(absolutePath).mtime;
            let isFirst = true;
            if (fs.statSync(absolutePath).size) {
                const readStream = fs.createReadStream(absolutePath, {highWaterMark: CHUNK_SIZE});
                readStream.on('data', async (chunk) => {
                    let mtime1 = fs.statSync(absolutePath).mtime;
                    if (mtime1.toString() !== mtime.toString()) {
                        console.log(chalk.redBright('File is change,cancel send'), mtime1, mtime);
                        data.print();
                        this.enQueue(data);
                        this.sendFileEnd(data.relativePath);
                        readStream.close();
                        return;
                    }
                    console.log(chalk.magenta(`Send path: ${data.relativePath}, chunk length: ${chunk.length}`));
                    let event = new DataFormat(SEND_FILE_CHUNK_EVENT_NAME, data.relativePath, true, chunk.toString('base64'), isFirst);
                    await this.sendEvent(event).catch((err) => {
                        console.log(err);
                        event.print();
                        this.enQueue(data);
                        this.sendFileEnd(data.relativePath);
                        readStream.close();
                    });
                    isFirst = false;
                });
                readStream.on('end', () => {
                    this.sendFileEnd(data.relativePath);
                });
            } else {
                let event = new DataFormat(SEND_FILE_CHUNK_EVENT_NAME, data.relativePath, true, '', isFirst);
                this.sendEvent(event).catch(err => {
                    console.log(err);
                    data.print();
                    this.enQueue(data);
                }).finally(() => {
                    this.sendFileEnd(data.relativePath);
                })

            }
        }
    }

    sendFileEnd(relativePath) {
        let event = new DataFormat(SEND_FILE_CHUNK_EVENT_NAME, relativePath, true, '', false, true);
        this.sendEvent(event).then(() => {
            this.consuming = false;
            this.consume();
        }).catch(err => {
            console.log(err);
            process.exit();
        }).finally(() => {
            this.lock.releaseLock(relativePath);
        });
    }
}

module.exports = SendEventQueue;