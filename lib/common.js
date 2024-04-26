const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const DataProtocol = require('./DataProtocol.js');
const DataFormat = require('./DataFormat');

const changeFileMap = new Map();
const changeFileLockMap = new Map();
/**
 *
 * @type {Map<string, fs.WriteStream>}
 */
const streamMap = new Map();

const SEND_FILE_CONFIRM_EVENT_NAME = 'sendFileConfirm';
const SEND_FILE_ACCEPT_EVENT_NAME = 'sendFileAccept';
const SEND_FILE_REJECT_EVENT_NAME = 'sendFileReject';
const SEND_FILE_CHUNK_EVENT_NAME = 'sendFileChunk';

const CHUNK_SIZE = 60 * 1024;

function createDirectory(dirname) {
    if (fs.existsSync(dirname)) {
        return;
    }
    let dir = path.dirname(dirname);
    if (!fs.existsSync(dir)) {
        createDirectory(dir);
        console.log(`dir ${dir} created`);
    } else {
        fs.mkdirSync(dirname);
        console.log(`dir ${dirname} created`);
    }
}

/**
 *
 * @param {module:net.Socket} socket
 * @param {DataFormat} event
 */
function sendEvent(socket, event) {
    console.log('send event:', event.eventName, event.relativePath, 'isChunk', event.isChunk, 'isFirst', event.isFirst, 'isEnd', event.isEnd);
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
        console.log('receive data:', data1.eventName, data1.relativePath, 'isChunk:', data1.isChunk, 'isFirst:', data1.isFirst, 'isEnd', data1.isEnd);
        path1 = path.join(pathPrefix, data1.relativePath);
        switch (data1.eventName) {
            case 'addDir':
                createDirectory(path1);
                changeFileMap.set(data1.eventName + data1.relativePath, 1);
                break;
            case 'unlinkDir':
                if (fs.existsSync(path1)) {
                    fs.rmdir(path1, (err) => {
                        if (!err) {
                            console.log('rm dir success', path1);
                            changeFileMap.set(data1.eventName + data1.relativePath, 1);
                        } else {
                            console.log(err);
                        }
                    });
                }
                break;
            case 'unlink':
                fs.unlink(path1, (err) => {
                    if (!err) {
                        console.log('delete file success', path1);
                        changeFileMap.set(data1.eventName + data1.relativePath, 1);
                    } else {
                        console.log(err);
                    }
                });
                break;
            case SEND_FILE_CONFIRM_EVENT_NAME:
                if (changeFileLockMap.get(data1.relativePath)) {
                    let event = new DataFormat(SEND_FILE_REJECT_EVENT_NAME, data1.relativePath);
                    sendEvent(socket, event);
                } else {
                    let event = new DataFormat(SEND_FILE_ACCEPT_EVENT_NAME, data1.relativePath);
                    sendEvent(socket, event);
                }
                break;
            case SEND_FILE_REJECT_EVENT_NAME:
                changeFileLockMap.delete(data1.relativePath);
                break;
            case SEND_FILE_ACCEPT_EVENT_NAME:
                if (!fs.existsSync(path1)) {
                    changeFileLockMap.delete(data1.relativePath);
                } else {
                    const sendFile = () => {
                        let isFirst = true;
                        if (fs.statSync(path1).size) {
                            const readStream = fs.createReadStream(path1, {highWaterMark: CHUNK_SIZE});
                            readStream.on('data', (chunk) => {
                                console.log('send chunk length', data1.relativePath, chunk.length);
                                let event = new DataFormat(SEND_FILE_CHUNK_EVENT_NAME, data1.relativePath, true, chunk.toString(), isFirst);
                                sendEvent(socket, event);
                                isFirst = false;
                            });
                            readStream.on('end', () => {
                                let event = new DataFormat(SEND_FILE_CHUNK_EVENT_NAME, data1.relativePath, true, '', false, true);
                                sendEvent(socket, event);
                                changeFileLockMap.delete(data1.relativePath);
                            });
                        } else {
                            let event = new DataFormat(SEND_FILE_CHUNK_EVENT_NAME, data1.relativePath, true, '', isFirst);
                            sendEvent(socket, event);
                            event = new DataFormat(SEND_FILE_CHUNK_EVENT_NAME, data1.relativePath, true, '', false, true);
                            sendEvent(socket, event);

                        }
                    };
                    sendFile();

                }
                break;
            case SEND_FILE_CHUNK_EVENT_NAME:
                if (data1.isEnd) {
                    streamMap.get(data1.relativePath).close();
                    streamMap.delete(data1.relativePath);
                    changeFileLockMap.delete(data1.relativePath);
                } else {
                    console.log('set changeFileMap:', data1.relativePath);
                    changeFileMap.set(data1.eventName + data1.relativePath, 1);
                    if (data1.isFirst) {
                        changeFileLockMap.set(data1.relativePath, 1);
                        createDirectory(path.dirname(path1));
                        streamMap.set(data1.relativePath, fs.createWriteStream(path1, {flags: 'w'}));
                    }
                    streamMap.get(data1.relativePath).write(data1.data, (error) => {
                        if (error) {
                            console.log('write chunk error', data1.relativePath, error);
                        } else {
                            console.log('write one chunk finish', data1.relativePath);
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

/**
 *
 * @param {string} paths
 * @param {chokidar.WatchOptions|null} options
 * @param {module:net.Socket} socket
 * @param {number} intervalTime
 */
function watchFileChange(paths, options, socket, intervalTime) {
    console.log('watchFileChange:', paths);
    const ch = chokidar.watch(paths, options);
    let queue = [];
    ch.on('all', (eventName, path2) => {
        path2 = path.relative(paths, path2);
        console.log('event name:', eventName, 'path:', path2);
        if (eventName === 'add') {
            eventName = 'change';
        }
        let changeFileMapKey = eventName === 'change' ? SEND_FILE_CHUNK_EVENT_NAME : eventName;
        if (changeFileMap.get(changeFileMapKey + path2)) {
            console.log('event cancel send:', eventName, 'path:', path2);
            changeFileMap.delete(changeFileMapKey + path2);
            return;
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
                if (changeFileLockMap.get(value.relativePath)) {
                    queue.push(value);
                } else {
                    changeFileLockMap.set(value.relativePath, 1);
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
