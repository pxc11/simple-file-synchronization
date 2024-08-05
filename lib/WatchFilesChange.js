const Queue = require('./Queue');
const Chokidar = require('chokidar');
const Path = require("path");
const fs = require("fs");
const Common = require("./Common");

class WatchFilesChange extends Queue {

    constructor(paths, options, intervalTime) {
        super();
        this.name = 'watch files queue';
        this.paths = paths;
        this.options = options;
        this.unwatchPaths = new Set();
        this.ch = Chokidar.watch(this.paths, this.options);
        console.log("Watch dir:", this.paths);
        this.cacheEventList = [];
        this.ch.on('all', async (eventName, path, stats) => {
            path = this.handPathToLinux(Path.relative(this.paths, path));
            //console.log('file event',eventName,path);
            for (const v of this.unwatchPaths) {
                if (this.isSubOrSamePath(v, path)) {
                    return;
                }
            }

            if (eventName === 'add') {
                eventName = 'change';
            }
            let e = {
                eventName: eventName,
                relativePath: path,
                mtimeMs: stats?.mtimeMs
            }
            if (this.from) {
                e.from = this.from;
            }

            this.cacheEventList.push(e);

        })

        setInterval(() => {
            this.eventList = [...this.eventList, ...this.cacheEventList];
            this.cacheEventList = [];
            this.eventList = Common.optimizeQueue(this.eventList);
            this.attemptConsume();
        }, 2000);
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