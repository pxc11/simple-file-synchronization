const chalk = require('chalk');
class Lock {
    lockMap;
    lockDuration;

    constructor(lockDuration = 0) {
        this.lockMap = new Map();
        this.lockDuration = lockDuration;
    }

    addLock(key) {
        let v = this.lockMap.get(key);
        if (v) {
            if (this.lockDuration === 0) {
                console.log(chalk.yellowBright(`The key: ${key} is locked.`))
                return false;
            } else {
                if (Date.now() - v <= this.lockDuration) {
                    console.log(chalk.yellowBright(`The key: ${key} is locked. But it's not expired.`))
                    return false;
                }
            }
        }
        this.lockMap.set(key, Date.now());
        return true;
    }

    releaseLock(key) {
        this.lockMap.delete(key);
    }


}

module.exports = Lock;