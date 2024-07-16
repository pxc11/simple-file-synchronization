# simple-file-synchronization
双向文件同步程序
Simple two-way  file synchronization used to sync file between remote and local.

Can automatically synchronize all file changes between two directories
能自动同步两个目录的所有文件变动

## how use
rename [config.js.example](config.js.example) to [config.js](config.js) and config it.
Then execute:  
`node server.js`  in remote.  
`node client.js`  in local.  
