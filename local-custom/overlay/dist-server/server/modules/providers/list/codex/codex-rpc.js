import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import readline from 'node:readline';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

/** Bidirectional connection to the existing daemon; never starts/stops it. */
export class CodexRpc extends EventEmitter {
  constructor({ cli = process.env.CODEX_CLI_PATH || 'codex', args = null, socketPath = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'app-server-control/app-server-control.sock') } = {}) {
    super();
    this.pending = new Map();
    this.nextId = 1;
    const receive = line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.method) {
        this.emit('message', message);
        return;
      }
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(Object.assign(new Error(message.error.message), { rpcCode: message.error.code }));
      else request.resolve(message.result);
    };
    const fail = error => {
      this.closed = true;
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(error);
      }
      this.pending.clear();
      this.emit('closed', error);
    };
    if (args) {
      this.child = spawn(cli, args, { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
      this.stderr = '';
      this.child.stderr.on('data', data => { this.stderr = (this.stderr + data).slice(-2000); });
      this.reader = readline.createInterface({ input: this.child.stdout });
      this.reader.on('line', receive);
      this.child.on('error', fail);
      this.child.on('exit', () => fail(new Error('Codex connection closed.')));
      this.child.stdin.on('error', () => {});
      this.ready = Promise.resolve();
    } else {
      this.socket = new WebSocket('ws://localhost/', { handshakeTimeout: 10000, createConnection: () => net.createConnection(socketPath) });
      this.ready = new Promise((resolve, reject) => {
        this.socket.once('open', resolve);
        this.socket.once('error', reject);
      });
      this.socket.on('message', receive);
      this.socket.on('error', fail);
      this.socket.on('close', () => fail(new Error('Codex connection closed.')));
    }
  }
  send(message) {
    if (this.closed) throw new Error('Codex connection is closed.');
    if (this.socket) this.socket.send(JSON.stringify(message));
    else this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  call(method, params = {}, timeout = 30000) {
    if (this.closed) return Promise.reject(new Error('Codex connection is closed.'));
    const id = `cloudcli-${this.nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out.`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ jsonrpc: '2.0', id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async initialize() {
    await this.ready;
    await this.call('initialize', {
      clientInfo: { name: 'cloudcli', title: 'CloudCLI', version: '1.37.7' },
      capabilities: { experimentalApi: true },
    });
    this.send({ jsonrpc: '2.0', method: 'initialized', params: {} });
    return this;
  }
  close() { this.reader?.close(); this.child?.kill(); this.socket?.close(); }
}

let sharedConnection;
const execFileAsync = promisify(execFile);
export async function openCodexConnection({createRpc = () => new CodexRpc(), startDaemon = () => execFileAsync(
  process.env.CODEX_CLI_PATH || 'codex', ['app-server', 'daemon', 'start'], {timeout: 15000, maxBuffer: 128 * 1024},
)} = {}) {
  let rpc = createRpc();
  try { return await rpc.initialize(); }
  catch (error) {
    rpc.close();
    // The supported CLI command starts only if absent. Never restart a daemon
    // or replace an active thread owner; a successful connection needs no CLI.
    if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error;
    await startDaemon();
    rpc = createRpc();
    try { return await rpc.initialize(); }
    catch (retryError) { rpc.close(); throw retryError; }
  }
}
export async function getCodexConnection() {
  if (!sharedConnection) {
    const connecting = openCodexConnection();
    sharedConnection = connecting;
    connecting.then(rpc => {
      rpc.once('closed', () => { if (sharedConnection === connecting) sharedConnection = null; });
      if (rpc.closed && sharedConnection === connecting) sharedConnection = null;
    }, () => {});
    connecting.catch(() => { if (sharedConnection === connecting) sharedConnection = null; });
  }
  return sharedConnection;
}
