const Fs = require('fs-extra');

class Common {
    static simplyCommandHandle(eventName, path) {
        switch (eventName) {
            case 'addDir':
                Fs.mkdirpSync(path);
                break;
            case 'unlinkDir':
            case 'unlink':
                Fs.removeSync(path);
                break;
        }
    }
}

module.exports = Common;