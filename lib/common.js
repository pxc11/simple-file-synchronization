const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const DataProtocol = require('./DataProtocol.js');
const DataFormat = require('./DataFormat');
const chalk = require('chalk');
const debugMode = require('../config').debugMode;
const FileLock = require('./Lock.js');
const SendEventQueue = require('./SendEventQueue.js');


const {
    SEND_FILE_CONFIRM_EVENT_NAME,
    SEND_FILE_ACCEPT_EVENT_NAME,
    SEND_FILE_REJECT_EVENT_NAME,
    SEND_FILE_CHUNK_EVENT_NAME,
    CHUNK_SIZE
} = require('./enum.js');

const green = chalk.greenBright;
const red = chalk.redBright;
const yellow = chalk.yellowBright;
const blue = chalk.blueBright;
const magenta = chalk.magentaBright;
const cyan = chalk.cyanBright;
const white = chalk.whiteBright;

const lock = new FileLock(5);
const changeFileMap = new Map();
const sendEventQueue = new SendEventQueue();


/**
 *
 * @type {Map<string, fs.WriteStream>}
 */
const streamMap = new Map();

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
    if (fs.existsSync(folderPath) && fs.lstatSync(folderPath).isDirectory()) {
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
    if (!socket.writable) {
        console.log(red('Send event error'));
        event.print();
        process.exit();
    }
    let isSuccess = socket.write(DataProtocol.encodeData(Buffer.from(event.json())));
    if (!isSuccess) {
        console.log(red(`Can't write`));
        event.print();
        process.exit();
    }
    console.log(magenta(`Send event:`));
    event.print();
}

/**
 *
 * @param {module:net.Socket} socket
 * @param {string} pathPrefix
 */
function listenFileChange(socket, pathPrefix) {
    let path1 = '';
    const dataProtocol = new DataProtocol();
    sendEventQueue.init(socket, pathPrefix, lock);

    dataProtocol.onData((data1) => {
        let receiveData = data1.toString();
        data1 = DataFormat.jsonParse(receiveData);
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
                    sendEventQueue.enQueue(event);
                } else {
                    let event = new DataFormat(SEND_FILE_ACCEPT_EVENT_NAME, data1.relativePath);
                    sendEventQueue.enQueue(event);
                }
                break;
            case SEND_FILE_REJECT_EVENT_NAME:
                lock.releaseLock(data1.relativePath);
                break;
            case SEND_FILE_ACCEPT_EVENT_NAME:
                let event = new DataFormat(SEND_FILE_CHUNK_EVENT_NAME, data1.relativePath);
                sendEventQueue.enQueue(event);
                break;
            case SEND_FILE_CHUNK_EVENT_NAME:
                if (data1.isEnd) {
                    let stream = streamMap.get(data1.relativePath);
                    if (stream) {
                        streamMap.delete(data1.relativePath);
                        stream.on('finish',()=>{
                            stream.close((err) => {
                                if (err) {
                                    console.log('close fail:', err, data1.relativePath);
                                }
                                console.log(green(`Close stream success, path: ${data1.relativePath}, the stream map is `));
                                if (fs.existsSync(path1)) {
                                    changeFileMap.set('change' + data1.relativePath, fs.statSync(path1).mtimeMs);
                                }
                                lock.releaseLock(data1.relativePath);
                            });
                        })
                        stream.end();
                    }
                } else {
                    if (data1.isFirst) {
                        createDirectory(path.dirname(path1), pathPrefix);
                        let ws = fs.createWriteStream(path1, {flags: 'w'});
                        ws.on('ready', () => {
                            try {
                                let stat = fs.statSync(path1);
                                changeFileMap.set('change' + data1.relativePath, stat.mtimeMs);
                            } catch (error) {
                                if (error.code === 'ENOENT') {
                                    console.log(red(`Can't get file stat! path: ${path1}`));
                                } else {
                                    console.error(error);
                                }
                            }
                        })
                        streamMap.set(data1.relativePath, ws);
                    }
                    streamMap.get(data1.relativePath).write(Buffer.from(data1.data, 'base64'), (error) => {
                        if (error) {
                            console.log(red(`Write chunk error, path: ${data1.relativePath}, error: ${error}`));
                        } else {
                            console.log(green(`Write one chunk finish, path: ${data1.relativePath}`));
                            try {
                                let stat = fs.statSync(path1);
                                changeFileMap.set('change' + data1.relativePath, stat.mtimeMs);
                            } catch (error) {
                                if (error.code === 'ENOENT') {
                                    console.log(red(`Can't get file stat! path: ${path1}`));
                                } else {
                                    console.error(error);
                                }
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
    sendEventQueue.init(socket, paths, lock);
    ch.on('all', (eventName, path2, stats) => {
        path2 = handPathToLinux(path.relative(paths, path2));
        if (eventName === 'add') {
            eventName = 'change';
        }
        console.log(yellow(`Event name: ${eventName},path: ${path2}`));
        if (changeFileMap.get(eventName + path2)) {
            if (eventName === 'change') {
                let mtime = changeFileMap.get(eventName + path2);
                let fileTime = stats.mtimeMs;
                if (fileTime < mtime) {
                    console.log(yellow(`fileTime is expired, time in map is ${mtime}, file time is ${fileTime}`));
                    console.log(chalk.bgRedBright(`${eventName} event cancel send, path: ${path2}`));
                    return;
                } else if (fileTime === mtime) {
                    //changeFileMap.delete(eventName + path2);
                    console.log(chalk.bgRedBright(`${eventName} event cancel send, path: ${path2}`));
                    return;
                } else {
                    changeFileMap.delete(eventName + path2);
                    console.log(yellow(`mtime is different, time in map is ${mtime}, file time is ${fileTime}`));
                }
            } else {
                console.log(chalk.bgRedBright(`${eventName} event cancel send, path: ${path2}`));
                changeFileMap.delete(eventName + path2);
                return;

            }
        }

        // console.log(chalk.redBright(eventName),path2);
        // process.exit();
        queue.push({
            eventName: eventName,
            relativePath: path2,
        });

    });
    setInterval(() => {
        let uniqueQueue = Array.from(new Set(queue.reverse().map(a => JSON.stringify(a)))).map(a => JSON.parse(a)).reverse();
        queue = [];
        uniqueQueue.forEach(value => {
            let absolutePath = path.join(paths, value.relativePath);
            if (value.eventName === 'change') {
                let event = new DataFormat(SEND_FILE_CONFIRM_EVENT_NAME, value.relativePath);
                sendEventQueue.enQueue(event);
            } else {
                let event = new DataFormat(value.eventName, value.relativePath);
                sendEventQueue.enQueue(event);
            }

        });
    }, intervalTime * 1000);
}

function debug(path, mtime = 0) {
    console.log('AAAAAAAAAAAAAAAA', path, 'current time:', new Date(), ' file time:', mtime ? mtime : fs.existsSync(path) ? fs.statSync(path).mtime : 'no file');
}

exports.listenFileChange = listenFileChange;
exports.watchFileChange = watchFileChange;
