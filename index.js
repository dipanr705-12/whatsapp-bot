// Entry point — simply delegates to bot.js
// (Previously this spawned bot.js as a child process, which caused issues
//  on Render because the parent process had no HTTP server and the child
//  process restart loop interfered with the port scan.)
require('./bot');
