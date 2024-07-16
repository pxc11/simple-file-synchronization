const Queue = require('./Queue');
const Chokidar = require('chokidar');
const Path = require("path");
const fs = require("fs");

class WatchFilesChange extends Queue {

    constructor(paths, options, intervalTime) {
        super();
        this.paths = paths;
        this.options = options;
        this.intervalTime = intervalTime;
        this.unwatchPaths = new Set();
        this.ch = Chokidar.watch(this.paths, this.options);
        this.ch.on('all', (eventName, path, stats) => {
            try {
                if (eventName === 'change' || eventName === 'add') {
                    let st = fs.lstatSync(path);
                    if (st && st.isSymbolicLink()) {
                        console.log(path,'is symbolic link');
                        return;
                    }
                }
                if (stats) {
                    if (stats.isSymbolicLink()) {
                        return;
                    }
                }
                path = this.handPathToLinux(Path.relative(this.paths, path));
                for (const v of this.unwatchPaths) {
                    if (this.isSubOrSamePath(v, path)) {
                        return;
                    }
                }

            } catch (error) {
                console.log(error);
                return;
            }

            console.log(eventName, path);
            if (eventName === 'add') {
                eventName = 'change';
            }

            this.enQueue({
                eventName: eventName,
                relativePath: path,
                mtimeMs: stats?.mtimeMs
            });
        })

        setInterval(() => {
            this.eventList = Array.from(new Set(this.eventList.reverse().map(a => JSON.stringify(a)))).map(a => JSON.parse(a)).reverse();
            //console.log("item length:",this.eventList.length);
        }, this.intervalTime * 1000);

    }

    handPathToLinux(path) {
        if (process.platform === 'win32') {
            path = path.replace(/\\/g, '/');
        }
        return path;
    }

    isSubOrSamePath(parent, sub) {
        const parentPath = Path.resolve(parent);
        const subPath = Path.resolve(sub);
        if (parentPath === subPath) {
            return true;
        }
        const relative = Path.relative(parentPath, subPath);
        return relative && !relative.startsWith('..') && !Path.isAbsolute(relative);
    }

}

module.exports = WatchFilesChange;