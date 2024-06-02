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
     *
     * @param {module:net.Socket} socket
     * @param {string} prefixPath
     */
    constructor(socket, prefixPath) {
        this.prefixPath = prefixPath;
        this.socket = socket;
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
        if (this.consuming && this.isEmpty()) {
            return;
        }
        this.consuming = true;
        let event = this.queue.shift();
        if (event.eventName === SEND_FILE_CHUNK_EVENT_NAME) {
            this.sendFile(event);
        } else {
            this.sendEvent(event)
        }


    }


    /**
     *
     * @param {DataFormat} event
     * @param {function(err,resolve)} f
     */
    sendEvent(event, f = undefined) {
        return new Promise((resolve) => {
            this.socket.write(DataProtocol.encodeData(Buffer.from(event.json())), (err) => {
                if (f) {
                    f(err, resolve);
                } else {
                    if (err) {
                        console.log(chalk.redBright(`send event fail:`), err);
                        event.print();
                        this.enQueue(event);
                    }
                    this.consuming = false;
                    resolve();
                    this.consume();


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

        } else {
            let mtime = fs.statSync(absolutePath).mtime;
            let isFirst = true;
            if (fs.statSync(absolutePath).size) {
                const readStream = fs.createReadStream(absolutePath, {highWaterMark: CHUNK_SIZE});
                readStream.on('data', (chunk) => {
                    let mtime1 = fs.statSync(absolutePath).mtime;
                    if (mtime1 !== mtime) {
                        console.log(chalk.redBright('File is change,cancel send'));
                        data.print();
                        this.sendFileEnd(data.relativePath);
                        readStream.close();
                        return;
                    }
                    console.log(chalk.magenta(`Send path: ${data.relativePath}, chunk length: ${chunk.length}`));
                    let event = new DataFormat(SEND_FILE_CHUNK_EVENT_NAME, data.relativePath, true, chunk.toString('base64'), isFirst);
                    this.sendEvent(event, (err) => {
                        if (err) {
                            console.log(chalk.redBright(`send file chunk event fail:`), err);
                            event.print()
                            this.enQueue(data);
                            this.sendFileEnd(data.relativePath);
                        }
                    });
                    isFirst = false;
                });
                readStream.on('end', () => {
                    this.sendFileEnd(data.relativePath);
                });
            } else {
                let event = new DataFormat(SEND_FILE_CHUNK_EVENT_NAME, data.relativePath, true, '', isFirst);
                this.sendEvent(event, (err,r) => {
                    if (err) {
                        console.log(chalk.redBright(`send file event fail:`), err);
                        event.print()
                        this.enQueue(event);
                        r();
                    }
                    this.sendFileEnd(data.relativePath);


                })

            }
        }
    }

    sendFileEnd(relativePath) {
        let event = new DataFormat(SEND_FILE_CHUNK_EVENT_NAME, relativePath, true, '', false, true);
        this.sendEvent(event, (err,r) => {
            if (err) {
                console.log(chalk.redBright(`send file event end fail:`), err);
                process.exit();
            } else {
                this.consuming = false;
                r();
                this.consume();
            }
        });
    }
}