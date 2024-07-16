const EventEmitter = require("events");

class Queue extends EventEmitter {
    consuming = false;
    eventList = [];

    enQueue(event) {
        this.eventList.push(event);
        this.attemptConsume();
    }

    isEmpty() {
        return this.eventList.length === 0;
    }

    attemptConsume() {
        if (this.consuming || this.isEmpty()) {
            return;
        }
        this.consuming = true;
        let event = this.eventList.shift();
        const fn = () => {
            this.consuming = false;
            this.attemptConsume();
        }
        this.emit('consume', event, fn)
    }
}

module.exports = Queue;