const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const DataProtocol = require('./DataProtocol');

const changeFileMap = new Map();

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
 * @param {net.Socket} client
 * @param {string} path1
 * @param {string} pathPrefix
 * @returns {Promise<void>}
 */
function sendFile(client, path1, pathPrefix) {
    sendData(client, 'SEND_FILE');
    sendData(client, path1);
    path1 = path.join(pathPrefix, path1);
    const readStream = fs.createReadStream(path1);
    readStream.setEncoding('utf8');
    if (fs.statSync(path1).size === 0) {
        sendData(client, '');
    }
    readStream.on('data', (chunk) => {
        sendData(client, chunk);
    });
    //readStream.pipe(client, {end: false});
    readStream.on('end', () => {
        sendData(client, 'END');
    });
}

/**
 * @param {net.Socket} client
 * @param {string} path
 */
function deleteFile(client, path) {
    sendData(client, 'DELETE_FILE');
    sendData(client, path);
    sendData(client, 'END');
}

/**
 * @param {net.Socket} client
 * @param {string} path
 */
function deleteDir(client, path) {
    sendData(client, 'DELETE_DIR');
    sendData(client, path);
    sendData(client, 'END');
}

/**
 * @param {net.Socket} client
 * @param {string} path
 */
function sendDir(client, path) {
    sendData(client, 'SEND_DIR');
    sendData(client, path);
    sendData(client, 'END');
}

/**
 *
 * @param {module:net.Socket} socket
 * @param {string} pathPrefix
 */
function listenFileChange(socket, pathPrefix) {
    let eventType = '';
    let path1 = '';
    let stream = false;
    const dataProtocol = new DataProtocol();

    const clear = function () {
        eventType = '';
        path1 = '';
        stream = '';
    };

    dataProtocol.onData((data1) => {
        data1 = data1.toString();
        if (['SEND_FILE', 'SEND_DIR', 'DELETE_DIR', 'DELETE_FILE'].includes(data1)) {
            eventType = data1;
            path1 = '';
            stream = false;
            console.log('receive data event:', data1);
        } else if (eventType && !path1) {
            console.log('receive data path:', data1);
            changeFileMap.set(data1, 1);
            path1 = path.join(pathPrefix, data1);
            console.log('absolute path:', path1);
            if (eventType === 'SEND_FILE') {
                createDirectory(path.dirname(path1));
                stream = fs.createWriteStream(path1, {flags: 'w'});
                return;
            }
        } else if (data1 === 'END') {
            console.log('receive end:', data1);
            clear();
        }

        if (eventType && path1) {
            switch (eventType) {
                case 'SEND_FILE':
                    console.log('write data in file:', path1);
                    stream.write(data1);
                    break;
                case 'SEND_DIR':
                    createDirectory(path1);
                    clear();
                    break;
                case 'DELETE_FILE':
                    fs.unlink(path1, (err) => {
                        if (!err) {
                            console.log('delete file success', path1);
                        } else {
                            console.log(err);
                        }
                    });
                    clear();
                    break;
                case 'DELETE_DIR':
                    console.log('rm dir', path1);
                    if (fs.existsSync(path1)) {
                        fs.rmdir(path1, (err) => {
                            if (!err) {
                                console.log('rm dir success', path1);
                            } else {
                                console.log(err);
                            }
                        });
                    }
                    clear();
                    break;

            }

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
 */
function watchFileChange(paths, options, socket) {
    const ch = chokidar.watch(paths, options);
    ch.on('all', (eventName, path2) => {
        console.log('event name:', eventName, 'path:', path2);
        path2 = path.relative(paths, path2);
        if (changeFileMap.get(path2)) {
            changeFileMap.delete(path2);
            return;
        }
        console.log('watch:', eventName, path2);
        if (['add', 'change'].includes(eventName)) {
            sendFile(socket, path2, paths);
        }
        if ('addDir' === eventName) {
            sendDir(socket, path2);
        }
        if ('unlink' === eventName) {
            deleteFile(socket, path2);
        }
        if ('unlinkDir' === eventName) {
            deleteDir(socket, path2);
        }
    });
}

/**
 * @param {net.Socket} client
 * @param {string} s
 *
 */
function sendData(client, s) {
    return client.write(DataProtocol.encodeData(Buffer.from(s)));
}

exports.listenFileChange = listenFileChange;
exports.watchFileChange = watchFileChange;
