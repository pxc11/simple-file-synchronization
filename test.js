const fs = require('fs');

// 创建一个空文件
fs.writeFileSync('test.txt', '');

// 获取文件的状态信息
const statsBefore = fs.statSync('test.txt');
console.log('Before writing:', statsBefore.mtime);

// 使用 WriteStream 写入空字符串
const ws = fs.createWriteStream('test.txt');
ws.write('');

// 结束写入
ws.end();

// 获取文件的状态信息
const statsAfter = fs.statSync('test.txt');
console.log('After writing:', statsAfter.mtime);