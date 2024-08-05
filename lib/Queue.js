const EventEmitter = require("events");

class Queue extends EventEmitter {
    consuming = false;
    eventList = [];
    name = '';

    enQueue(event) {
        //console.log(`[${this.name}]`, 'enQueue', event);
        this.eventList.push(event);
        this.attemptConsume();
    }

    isEmpty() {
        return this.eventList.length === 0;
    }

    attemptConsume() {
        if (this.consuming || this.isEmpty()) {
            //console.log(`[${this.name}]`, 'consuming',this.consuming, 'isEmpty',this.isEmpty());
            return;
        }
        this.consuming = true;
        let event = this.eventList.shift();
        const fn = () => {
            this.consuming = false;
            //console.log(`[${this.name}]`, 'Event use time:', Date.now() - t, JSON.stringify(event));
            setImmediate(() => {
                this.attemptConsume();
            })
        }
        // console.log(`[${this.name}]`, 'start consume', JSON.stringify(event));
        this.emit('consume', event, fn)
    }
}

module.exports = Queue;