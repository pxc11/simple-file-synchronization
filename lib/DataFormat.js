class DataFormat {
  eventName;
  relativePath;
  data;
  isChunk;
  isFirst;
  isEnd;

  /**
   *
   * @param {string} eventName
   * @param {string} relativePath
   * @param {string} data
   * @param {boolean} isChunk
   * @param {boolean} isFirst
   * @param {boolean} isEnd
   */
  constructor(eventName, relativePath, isChunk = false, data = '', isFirst = false, isEnd = false) {
    this.eventName = eventName;
    this.relativePath = relativePath;
    this.data = data;
    this.isChunk = isChunk;
    this.isFirst = isFirst;
    this.isEnd = isEnd;
  }

  json() {
    return JSON.stringify(this);
  }

  static jsonParse(json) {
    let object = JSON.parse(json);
    return new this(object.eventName, object.relativePath, object.isChunk, object.data, object.isFirst, object.isEnd);
  }
}

module.exports = DataFormat;
