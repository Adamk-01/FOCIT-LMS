/**
 * Lightweight In-Memory Redis RESP2 Protocol Server
 * Used exclusively for multi-process integration tests and cluster stress chaos tests.
 * Enables true OS-level process forking (child_process.fork) without external daemon dependency.
 */

import net from 'node:net';

export class MiniRedisServer {
  constructor(port = 6379, host = '127.0.0.1') {
    this.port = port;
    this.host = host;
    this.server = null;
    this.storage = new Map(); // key -> string | object (hash) | array (stream)
    this.subscribers = new Set();
    this.commandLog = [];
    this.stats = {
      setNxCalls: 0,
      setNxWins: 0,
      publishCalls: 0,
      psubscribeCalls: 0,
      hincrbyCalls: 0,
      rotateCalls: 0,
      totalCommands: 0,
    };
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        let buffer = '';

        socket.on('data', (data) => {
          buffer += data.toString('utf8');
          while (buffer.length > 0) {
            const parsed = this._parseCommand(buffer);
            if (!parsed) break;
            const { command, args, bytesConsumed } = parsed;
            buffer = buffer.slice(bytesConsumed);
            this._handleCommand(socket, command, args);
          }
        });

        const cleanup = () => {
          this.subscribers.delete(socket);
        };
        socket.on('close', cleanup);
        socket.on('error', cleanup);
      });

      this.server.listen(this.port, this.host, () => {
        resolve();
      });
      this.server.on('error', reject);
    });
  }

  _parseCommand(buf) {
    if (!buf.startsWith('*')) {
      const idx = buf.indexOf('\r\n');
      if (idx === -1) return null;
      const line = buf.slice(0, idx).trim();
      const parts = line.split(/\s+/);
      return {
        command: parts[0]?.toUpperCase(),
        args: parts.slice(1),
        bytesConsumed: idx + 2,
      };
    }

    const lines = buf.split('\r\n');
    const numArgs = parseInt(lines[0].slice(1), 10);
    if (isNaN(numArgs)) return null;

    let lineIdx = 1;
    const args = [];
    let bytesConsumed = lines[0].length + 2;

    for (let i = 0; i < numArgs; i++) {
      if (lineIdx >= lines.length) return null;
      const lenLine = lines[lineIdx++];
      bytesConsumed += lenLine.length + 2;
      if (!lenLine.startsWith('$')) return null;
      const len = parseInt(lenLine.slice(1), 10);
      if (len === -1) {
        args.push(null);
        continue;
      }
      if (lineIdx >= lines.length) return null;
      const valLine = lines[lineIdx++];
      bytesConsumed += valLine.length + 2;
      args.push(valLine);
    }

    return {
      command: args[0]?.toUpperCase(),
      args: args.slice(1),
      bytesConsumed,
    };
  }

  _handleCommand(socket, cmd, args) {
    if (!cmd) return;
    this.stats.totalCommands++;
    this.commandLog.push({ cmd, args: args ? [...args] : [], ts: Date.now() });

    switch (cmd) {
      case 'COMMAND':
        socket.write('*0\r\n');
        break;

      case 'HELLO':
        socket.write("-ERR unknown command 'HELLO'\r\n");
        break;

      case 'INFO':
        const info = '# Server\r\nredis_version:7.2.0\r\n# Replication\r\nrole:master\r\nloading:0\r\n';
        socket.write(`$${Buffer.byteLength(info)}\r\n${info}\r\n`);
        break;

      case 'CLIENT':
        socket.write('+OK\r\n');
        break;

      case 'PING':
        socket.write('+PONG\r\n');
        break;

      case 'SELECT':
        socket.write('+OK\r\n');
        break;

      case 'PSUBSCRIBE': {
        this.stats.psubscribeCalls++;
        this.subscribers.add(socket);
        const pattern = args[0] || 'focit:channel:*';
        socket.write(`*3\r\n$10\r\npsubscribe\r\n$${pattern.length}\r\n${pattern}\r\n:1\r\n`);
        break;
      }

      case 'PUNSUBSCRIBE': {
        this.subscribers.delete(socket);
        const unpat = args[0] || 'focit:channel:*';
        socket.write(`*3\r\n$12\r\npunsubscribe\r\n$${unpat.length}\r\n${unpat}\r\n:0\r\n`);
        break;
      }

      case 'GET': {
        const key = args[0];
        const val = this.storage.get(key);
        if (typeof val === 'string') {
          socket.write(`$${Buffer.byteLength(val)}\r\n${val}\r\n`);
        } else {
          socket.write('$-1\r\n');
        }
        break;
      }

      case 'SET': {
        const key = args[0];
        const val = args[1];
        let isNx = false;
        let ttlMs = null;

        for (let i = 2; i < args.length; i++) {
          const arg = args[i]?.toUpperCase();
          if (arg === 'NX') isNx = true;
          if (arg === 'PX' && args[i + 1]) {
            ttlMs = parseInt(args[i + 1], 10);
            i++;
          }
          if (arg === 'EX' && args[i + 1]) {
            ttlMs = parseInt(args[i + 1], 10) * 1000;
            i++;
          }
        }

        if (isNx) {
          this.stats.setNxCalls++;
          if (this.storage.has(key)) {
            socket.write('$-1\r\n');
            return;
          }
          this.stats.setNxWins++;
        }

        this.storage.set(key, val);
        if (ttlMs) {
          setTimeout(() => {
            if (this.storage.get(key) === val) {
              this.storage.delete(key);
            }
          }, ttlMs).unref();
        }
        socket.write('+OK\r\n');
        break;
      }

      case 'SETEX': {
        const key = args[0];
        const ttlSec = parseInt(args[1], 10);
        const val = args[2];
        this.storage.set(key, val);
        if (ttlSec) {
          setTimeout(() => {
            if (this.storage.get(key) === val) {
              this.storage.delete(key);
            }
          }, ttlSec * 1000).unref();
        }
        socket.write('+OK\r\n');
        break;
      }

      case 'DEL': {
        let count = 0;
        for (const k of args) {
          if (this.storage.delete(k)) count++;
        }
        socket.write(`:${count}\r\n`);
        break;
      }

      case 'PUBLISH': {
        this.stats.publishCalls++;
        const channel = args[0];
        const msg = args[1];
        let sent = 0;
        for (const sub of this.subscribers) {
          try {
            sub.write(
              `*4\r\n$8\r\npmessage\r\n$15\r\nfocit:channel:*\r\n$${Buffer.byteLength(channel)}\r\n${channel}\r\n$${Buffer.byteLength(msg)}\r\n${msg}\r\n`
            );
            sent++;
          } catch {}
        }
        socket.write(`:${sent}\r\n`);
        break;
      }

      case 'EVAL': {
        const script = args[0];
        const numKeys = parseInt(args[1], 10);
        const keys = args.slice(2, 2 + numKeys);
        const scriptArgs = args.slice(2 + numKeys);

        // Safe lock release script
        if (script.includes('DEL') && script.includes('ARGV[1]')) {
          const stored = this.storage.get(keys[0]);
          if (stored === scriptArgs[0]) {
            this.storage.delete(keys[0]);
            socket.write(':1\r\n');
          } else {
            socket.write(':0\r\n');
          }
          return;
        }

        // LUA_ROTATE_METRICS script:
        // if redis.call("EXISTS", KEYS[2]) == 1 then return -1 end
        // if redis.call("EXISTS", KEYS[1]) == 0 then return 0 end
        // redis.call("RENAME", KEYS[1], KEYS[2]); return 1
        if (script.includes('EXISTS') && script.includes('RENAME')) {
          this.stats.rotateCalls++;
          const activeKey = keys[0];
          const flushingKey = keys[1];

          if (this.storage.has(flushingKey)) {
            socket.write(':-1\r\n');
            return;
          }
          if (!this.storage.has(activeKey)) {
            socket.write(':0\r\n');
            return;
          }
          const activeVal = this.storage.get(activeKey);
          this.storage.delete(activeKey);
          this.storage.set(flushingKey, activeVal);
          socket.write(':1\r\n');
          return;
        }

        socket.write(':0\r\n');
        break;
      }

      case 'HSET': {
        const key = args[0];
        let hash = this.storage.get(key);
        if (!hash || typeof hash !== 'object') {
          hash = {};
          this.storage.set(key, hash);
        }
        let addedCount = 0;
        for (let i = 1; i < args.length; i += 2) {
          const field = args[i];
          const val = args[i + 1];
          if (field !== undefined && val !== undefined) {
            if (hash[field] === undefined) addedCount++;
            hash[field] = val;
          }
        }
        socket.write(`:${addedCount}\r\n`);
        break;
      }

      case 'HMGET': {
        const key = args[0];
        const hash = this.storage.get(key);
        const fields = args.slice(1);
        let resp = `*${fields.length}\r\n`;
        for (const f of fields) {
          if (hash && typeof hash === 'object' && hash[f] !== undefined) {
            const val = String(hash[f]);
            resp += `$${Buffer.byteLength(val)}\r\n${val}\r\n`;
          } else {
            resp += '$-1\r\n';
          }
        }
        socket.write(resp);
        break;
      }

      case 'EXPIRE': {
        socket.write(':1\r\n');
        break;
      }

      case 'SADD': {
        const key = args[0];
        let set = this.storage.get(key);
        if (!(set instanceof Set)) {
          set = new Set();
          this.storage.set(key, set);
        }
        let added = 0;
        for (let i = 1; i < args.length; i++) {
          if (!set.has(args[i])) {
            set.add(args[i]);
            added++;
          }
        }
        socket.write(`:${added}\r\n`);
        break;
      }

      case 'HINCRBY': {
        this.stats.hincrbyCalls++;
        const key = args[0];
        const field = args[1];
        const incr = parseInt(args[2], 10);
        let hash = this.storage.get(key);
        if (!hash || typeof hash !== 'object') {
          hash = {};
          this.storage.set(key, hash);
        }
        hash[field] = (parseInt(hash[field] || '0', 10) + incr).toString();
        socket.write(`:${hash[field]}\r\n`);
        break;
      }

      case 'HGET': {
        const key = args[0];
        const field = args[1];
        const hash = this.storage.get(key);
        if (hash && typeof hash === 'object' && hash[field] !== undefined) {
          const val = String(hash[field]);
          socket.write(`$${Buffer.byteLength(val)}\r\n${val}\r\n`);
        } else {
          socket.write('$-1\r\n');
        }
        break;
      }

      case 'HGETALL': {
        const key = args[0];
        const hash = this.storage.get(key);
        if (!hash || typeof hash !== 'object') {
          socket.write('*0\r\n');
          return;
        }
        const entries = Object.entries(hash);
        let resp = `*${entries.length * 2}\r\n`;
        for (const [k, v] of entries) {
          resp += `$${Buffer.byteLength(k)}\r\n${k}\r\n$${Buffer.byteLength(String(v))}\r\n${v}\r\n`;
        }
        socket.write(resp);
        break;
      }

      case 'XADD': {
        const key = args[0];
        // Bounded stream simulation
        let stream = this.storage.get(key);
        if (!Array.isArray(stream)) {
          stream = [];
          this.storage.set(key, stream);
        }
        const id = `${Date.now()}-${stream.length}`;
        stream.push({ id, fields: args.slice(1) });
        socket.write(`$${id.length}\r\n${id}\r\n`);
        break;
      }

      case 'XRANGE': {
        const key = args[0];
        const stream = this.storage.get(key);
        if (!Array.isArray(stream) || stream.length === 0) {
          socket.write('*0\r\n');
          return;
        }
        // Return stream entries
        let resp = `*${stream.length}\r\n`;
        for (const entry of stream) {
          resp += `*2\r\n$${entry.id.length}\r\n${entry.id}\r\n*2\r\n$6\r\nitemId\r\n$36\r\n00000000-0000-0000-0000-000000000001\r\n`;
        }
        socket.write(resp);
        break;
      }

      case 'XDEL': {
        socket.write(':1\r\n');
        break;
      }

      case 'QUIT':
        socket.write('+OK\r\n');
        socket.end();
        break;

      default:
        socket.write('+OK\r\n');
        break;
    }
  }

  reset() {
    this.storage.clear();
    this.commandLog = [];
    this.stats = {
      setNxCalls: 0,
      setNxWins: 0,
      publishCalls: 0,
      psubscribeCalls: 0,
      hincrbyCalls: 0,
      rotateCalls: 0,
      totalCommands: 0,
    };
  }

  close() {
    return new Promise((resolve) => {
      for (const sub of this.subscribers) {
        try { sub.destroy(); } catch {}
      }
      this.subscribers.clear();
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
