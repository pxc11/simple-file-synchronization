const Fs = require('fs-extra');

class Common {
    static simplyCommandHandle(eventName, path) {
        switch (eventName) {
            case 'addDir':
                return Fs.mkdirp(path);
            case 'unlinkDir':
            case 'unlink':
                return Fs.remove(path);
        }
    }

    static optimizeQueue(eventList) {
        let time = Date.now();
        let length = eventList.length;
        const map = new Map();
        eventList.forEach((e) => {
            const e1 = structuredClone(e);
            e.mtimeMs = 0;
            const key = JSON.stringify(e);
            map.delete(key);
            map.set(key, e1);
        });
        eventList = Array.from(map.values());

        let unlinkPaths = [];
        let addPaths = [];

        let unlinkPaths2 = [];
        let addPaths2 = [];
        eventList.forEach(e => {
            if (e.from === 'client') {
                if (['unlink', 'unlinkDir'].includes(e.eventName)) {
                    unlinkPaths.push(e.relativePath);
                }
                if (['change', 'addDir'].includes(e.eventName)) {
                    addPaths.push(e.relativePath);
                }
            }
            if (e.from === 'server') {
                if (['unlink', 'unlinkDir'].includes(e.eventName)) {
                    unlinkPaths2.push(e.relativePath);
                }
                if (['change', 'addDir'].includes(e.eventName)) {
                    addPaths2.push(e.relativePath);
                }
            }


        });
        unlinkPaths = this.retainParentDirectories(unlinkPaths);
        addPaths = this.retainSubDirectories(addPaths);

        unlinkPaths2 = this.retainParentDirectories(unlinkPaths2);
        addPaths2 = this.retainSubDirectories(addPaths2);

        eventList = eventList.filter(e => {
            if (e.from === 'client') {
                if (['unlink', 'unlinkDir'].includes(e.eventName)) {
                    return unlinkPaths.includes(e.relativePath);
                } else if (['change', 'addDir'].includes(e.eventName)) {
                    return addPaths.includes(e.relativePath);
                }
                return true;
            }
            if (e.from === 'server') {
                if (['unlink', 'unlinkDir'].includes(e.eventName)) {
                    return unlinkPaths2.includes(e.relativePath);
                } else if (['change', 'addDir'].includes(e.eventName)) {
                    return addPaths2.includes(e.relativePath);
                }
                return true;
            }


        })
        console.log('optimizeQueue use time', Date.now() - time, 'reduce count', length - eventList.length);
        return eventList;
    }

    static retainParentDirectories(paths) {
        paths.sort();
        const result = [];
        let previousPath = '';
        for (const path of paths) {
            if (!previousPath || !path.startsWith(previousPath + '/')) {
                result.push(path);
                previousPath = path;
            }
        }
        return result;
    }

    static retainSubDirectories(paths) {
        paths.sort();
        const result = [];
        for (let i = 0; i < paths.length; i++) {
            if (paths[i + 1] === undefined) {
                result.push(paths[i]);
            } else {
                if (!paths[i + 1].startsWith(paths[i] + '/')) {
                    result.push(paths[i]);
                }
            }
        }
        return result;
    }
}

module.exports = Common;