const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const DataProtocol = require('./DataProtocol.js');
const DataFormat = require('./DataFormat');
const chalk = require('chalk');
const debugMode = require('../config').debugMode;
const FileLock = require('./Lock.js');

const green = chalk.greenBright;
const red = chalk.redBright;
const yellow = chalk.yellowBright;
const blue = chalk.blueBright;
const magenta = chalk.magentaBright;
const cyan = chalk.cyanBright;
const white = chalk.whiteBright;

class Map2 extends Map {
    constructor() {
        super();
    }

    set(key, value) {
        super.set(key, value);
        console.log(green(`The changeFileMap add key ${key} , and it's`));
        log(super.entries());
    }

    delete(key) {
        super.delete(key);
        console.log(red(`The changeFileMap delete key ${key} , and it's`));
        log(super.entries());
    }
}

const lock = new FileLock(5);
const changeFileMap = new Map2();


/**
 *
 * @type {Map<string, fs.WriteStream>}
 */
const streamMap = new Map();

const SEND_FILE_CONFIRM_EVENT_NAME = 'sendFileConfirm';
const SEND_FILE_ACCEPT_EVENT_NAME = 'sendFileAccept';
const SEND_FILE_REJECT_EVENT_NAME = 'sendFileReject';
const SEND_FILE_CHUNK_EVENT_NAME = 'sendFileChunk';

const CHUNK_SIZE = 45 * 1024;

function log(...v) {
    if (debugMode) {
        console.log(v);
    }
}

function createDirectory(dirname, pathPrefix) {
    if (fs.existsSync(dirname)) {
        return;
    }
    let dir = path.dirname(dirname);
    if (!fs.existsSync(dir)) {
        createDirectory(dir, pathPrefix);
    }
    fs.mkdirSync(dirname);
    let path1 = path.relative(pathPrefix, dirname);

    changeFileMap.set('addDir' + handPathToLinux(path1), 1);
    console.log(green(`dir ${dirname} is created`));

}

/**
 *
 * @param {string} folderPath
 * @param {string} pathPrefix
 */
function deleteDirectory(folderPath, pathPrefix) {
    if (fs.existsSync(folderPath)) {
        fs.readdirSync(folderPath).forEach((file, index) => {
            const curPath = path.join(folderPath, file);
            if (fs.lstatSync(curPath).isDirectory()) { // 递归删除文件夹
                deleteDirectory(curPath, pathPrefix);
            } else { // 删除文件
                fs.unlinkSync(curPath);
                changeFileMap.set('unlink' + handPathToLinux(path.relative(pathPrefix, curPath)), 1);
            }
        });
        fs.rmdirSync(folderPath); // 删除空文件夹
        console.log(green(`Deleted folder: ${folderPath}`));
        changeFileMap.set('unlinkDir' + handPathToLinux(path.relative(pathPrefix, folderPath)), 1);
    }
}

/**
 *
 * @param {module:net.Socket} socket
 * @param {DataFormat} event
 */
function sendEvent(socket, event) {
    console.log(magenta(`Send event:`));
    event.print();
    if (!socket.writable) {
        console.log(red('Send event error'));
        process.exit();
    }
    socket.write(DataProtocol.encodeData(Buffer.from(event.json())));
}

/**
 *
 * @param {module:net.Socket} socket
 * @param {string} pathPrefix
 */
function listenFileChange(socket, pathPrefix) {
    let path1 = '';
    const dataProtocol = new DataProtocol();

    dataProtocol.onData((data1) => {
        data1 = DataFormat.jsonParse(data1.toString());
        console.log(blue('Receive event:'));
        data1.print();
        path1 = path.join(pathPrefix, data1.relativePath);
        console.log(blue('Current absolute path:'), path1);
        switch (data1.eventName) {
            case 'addDir':
                createDirectory(path1, pathPrefix);
                break;
            case 'unlinkDir':
                deleteDirectory(path1, pathPrefix);
                break;
            case 'unlink':
                if (fs.existsSync(path1)) {
                    fs.unlink(path1, (err) => {
                        if (!err) {
                            console.log(green('Delete file success:'), path1);
                            changeFileMap.set(data1.eventName + data1.relativePath, 1);
                        } else {
                            console.log(err);
                        }
                    });
                }
                break;
            case SEND_FILE_CONFIRM_EVENT_NAME:
                if (!lock.addLock(data1.relativePath)) {
                    let event = new DataFormat(SEND_FILE_REJECT_EVENT_NAME, data1.relativePath);
                    sendEvent(socket, event);
                } else {
                    let event = new DataFormat(SEND_FILE_ACCEPT_EVENT_NAME, data1.relativePath);
                    sendEvent(socket, event);
                }
                break;
            case SEND_FILE_REJECT_EVENT_NAME:
                lock.releaseLock(data1.relativePath);
                break;
            case SEND_FILE_ACCEPT_EVENT_NAME:
                if (!fs.existsSync(path1)) {
                    lock.releaseLock(data1.relativePath);
                } else {
                    const sendFile = () => {
                        let isFirst = true;
                        if (fs.statSync(path1).size) {
                            const readStream = fs.createReadStream(path1, {highWaterMark: CHUNK_SIZE});
                            readStream.on('data', (chunk) => {
                                console.log(magenta(`Send path: ${data1.relativePath}, chunk length: ${chunk.length}`));
                                let event = new DataFormat(SEND_FILE_CHUNK_EVENT_NAME, data1.relativePath, true, chunk.toString('base64'), isFirst);
                                sendEvent(socket, event);
                                isFirst = false;
                            });
                            readStream.on('end', () => {
                                let event = new DataFormat(SEND_FILE_CHUNK_EVENT_NAME, data1.relativePath, true, '', false, true);
                                sendEvent(socket, event);
                                lock.releaseLock(data1.relativePath);
                            });
                        } else {
                            let event = new DataFormat(SEND_FILE_CHUNK_EVENT_NAME, data1.relativePath, true, '', isFirst);
                            sendEvent(socket, event);
                            event = new DataFormat(SEND_FILE_CHUNK_EVENT_NAME, data1.relativePath, true, '', false, true);
                            sendEvent(socket, event);
                            lock.releaseLock(data1.relativePath);

                        }
                    };
                    try {
                        sendFile();
                    } catch (e) {
                        console.log(red(`Send file fail: ${e}`));
                    }


                }
                break;
            case SEND_FILE_CHUNK_EVENT_NAME:
                if (data1.isEnd) {
                    let stream = streamMap.get(data1.relativePath);
                    streamMap.delete(data1.relativePath);
                    stream.close((err) => {
                        if (err) {
                            console.log('close fail:', err, data1.relativePath);
                        }
                        console.log(green(`Close stream success, path: ${data1.relativePath}, the stream map is `));
                        log(streamMap);
                        lock.releaseLock(data1.relativePath);
                    });
                } else {
                    if (data1.isFirst) {
                        createDirectory(path.dirname(path1), pathPrefix);
                        let ws = fs.createWriteStream(path1, {flags: 'w'});
                        ws.on('ready', () => {
                            if (!fs.existsSync(path1)) {
                                console.log(red`File is deleted,path: ${path1}`);
                            } else {
                                changeFileMap.set('change' + data1.relativePath, fs.statSync(path1).mtimeMs);
                            }
                        })
                        streamMap.set(data1.relativePath, ws);
                    }
                    streamMap.get(data1.relativePath).write(Buffer.from(data1.data, 'base64'), (error) => {
                        if (error) {
                            console.log(red(`Write chunk error, path: ${data1.relativePath}, error: ${error}`));
                        } else {
                            console.log(green(`Write one chunk finish, path: ${data1.relativePath}`));
                            if (!fs.existsSync(path1)) {
                                console.log(red(`File is deleted! path: ${path1}`));
                            } else {
                                changeFileMap.set('change' + data1.relativePath, fs.statSync(path1).mtimeMs);
                            }
                        }
                    });

                }

                break;

        }

    });
    socket.on('data', (data) => {
        dataProtocol.decodeData(data);
    });

}

function handPathToLinux(path) {
    if (process.platform === 'win32') {
        path = path.replace(/\\/g, '/');
    }
    return path;
}

/**
 *
 * @param {string} paths
 * @param {chokidar.WatchOptions|null} options
 * @param {module:net.Socket} socket
 * @param {number} intervalTime
 */
function watchFileChange(paths, options, socket, intervalTime) {
    console.log(green(`WatchFileChange:${paths}`));
    const ch = chokidar.watch(paths, options);
    let queue = [];
    ch.on('all', (eventName, path2, stats) => {
        path2 = handPathToLinux(path.relative(paths, path2));
        if (eventName === 'add') {
            eventName = 'change';
        }
        console.log(yellow(`Event name: ${eventName},path: ${path2}`));
        if (changeFileMap.get(eventName + path2)) {
            if (eventName === 'change') {
                let mtimems = changeFileMap.get(eventName + path2);
                let fileTime = stats.mtimeMs;
                if (fileTime < mtimems) {
                    console.log(yellow(`fileTime is expired, time in map is ${mtimems}, file time is ${fileTime}`));
                    console.log(chalk.bgRedBright(`${eventName} event cancel send, path: ${path2}`));
                    return;
                } else if (fileTime <= mtimems) {
                    changeFileMap.delete(eventName + path2);
                    console.log(chalk.bgRedBright(`${eventName} event cancel send, path: ${path2}`));
                    return;
                } else {
                    changeFileMap.delete(eventName + path2);
                    console.log(yellow(`mtime is different, time in map is ${mtimems}, file time is ${fileTime}`));
                    // console.log(chalk.bgRedBright(`${eventName} event cancel send, path: ${path2}`));
                }
            } else {
                console.log(chalk.bgRedBright(`${eventName} event cancel send, path: ${path2}`));
                changeFileMap.delete(eventName + path2);
                return;

            }
        }


        queue.push({
            eventName: eventName,
            relativePath: path2,
        });

    });
    setInterval(() => {
        let uniqueQueue = Array.from(new Set(queue.map(a => JSON.stringify(a)))).map(a => JSON.parse(a));
        queue = [];
        uniqueQueue.forEach(value => {
            let absolutePath = path.join(paths, value.relativePath);
            if (value.eventName === 'change') {
                if (!fs.existsSync(absolutePath)) {
                    return;
                }
                if (!lock.addLock(value.relativePath)) {
                    console.log(yellow(`The path is locked, path: ${value.relativePath}`));
                    queue.push(value);
                } else {
                    let event = new DataFormat(SEND_FILE_CONFIRM_EVENT_NAME, value.relativePath);
                    sendEvent(socket, event);
                }
            } else {
                let event = new DataFormat(value.eventName, value.relativePath);
                sendEvent(socket, event);
            }

        });
    }, intervalTime * 1000);
}

exports.listenFileChange = listenFileChange;
exports.watchFileChange = watchFileChange;
