const SEND_FILE_CONFIRM_EVENT_NAME = 'sendFileConfirm';
const SEND_FILE_ACCEPT_EVENT_NAME = 'sendFileAccept';
const SEND_FILE_REJECT_EVENT_NAME = 'sendFileReject';
const SEND_FILE_CHUNK_EVENT_NAME = 'sendFileChunk';
const CHUNK_SIZE = 45 * 1024;
module.exports = {
    SEND_FILE_CONFIRM_EVENT_NAME,
    SEND_FILE_ACCEPT_EVENT_NAME,
    SEND_FILE_REJECT_EVENT_NAME,
    SEND_FILE_CHUNK_EVENT_NAME,
    CHUNK_SIZE,
}