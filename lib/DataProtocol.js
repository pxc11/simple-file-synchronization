const events = require("events");

class DataProtocol {
    event = new events();
    length = -1;
    tempData = Buffer.alloc(0);

    /**
     *
     * @param {Buffer} data
     */
    static encodeData(data) {
        let length = Buffer.alloc(2);
        length.writeUInt16BE(data.length);
        return Buffer.concat([length, data]);
    }


    /**
     *
     * @param {Buffer} b
     */
    decodeData(b) {
        let bufferZ = Buffer.alloc(0);
        b = Buffer.concat([this.tempData, b]);
        if (this.length === -1) {
            if (b.length < 2) {
                this.tempData = b;
            } else {
                this.length = b.readUInt16BE();
                this.tempData = b.subarray(2);
                if (this.tempData.length >= this.length) {
                    this.decodeData(bufferZ);
                }
            }
        } else {
            if (b.length < this.length) {
                this.tempData = b;
            } else {
                let data = b.subarray(0, this.length);
                this.tempData = b.subarray(this.length);
                this.event.emit('data', data);
                this.length = -1;
                if (this.tempData.length >= 2) {
                    this.decodeData(bufferZ);
                }
            }
        }
    }

    onData(fn) {
        this.event.on('data', fn);
    }
}

module.exports = DataProtocol;



