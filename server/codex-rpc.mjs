// Minimal JSON-RPC client for `codex app-server` over stdio.
// One warm process; callers start threads/turns and listen for notifications.
// Always forces model_provider="openai" so it runs on the ChatGPT subscription,
// not the user's default claude-shim provider. stderr is swallowed (may contain config).
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';

export class CodexRPC extends EventEmitter {
  constructor(cwd) {
    super();
    this.cwd = cwd;
    this.pending = new Map();
    this.id = 0;
    this.ready = null;
    this.setMaxListeners(100);
  }

  connect() {
    if (!this.ready) this.ready = this.open().catch(e => { this.ready = null; throw e; });
    return this.ready;
  }

  async open() {
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    // mcp_servers={} skips the user's MCP servers, which otherwise add ~20 s to every new thread.
    const args = ['app-server', '-c', 'model_provider="openai"', '-c', 'mcp_servers={}', ...(process.env.I3D_CODEX_ARGS ? JSON.parse(process.env.I3D_CODEX_ARGS) : ['-c', 'features.apps=false', '-c', 'features.plugins=false'])];
    this.child = spawn(process.env.CODEX_BIN || 'codex', args, { cwd: this.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.on('data', () => {});
    const child = this.child;
    process.once('exit', () => { try { child.kill(); } catch {} });
    this.child.on('error', e => this.fail(e));
    this.child.on('exit', () => { this.ready = null; this.fail(new Error('Codex app-server stopped')); });
    createInterface({ input: this.child.stdout }).on('line', line => {
      let m;
      try { m = JSON.parse(line); } catch { return; }
      if (m.id !== undefined && !m.method && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        clearTimeout(p.timer);
        m.error ? p.reject(new Error(m.error.message || 'Codex error')) : p.resolve(m.result);
      } else if (m.id !== undefined && m.method) {
        // Server-initiated requests (approvals etc.): never grant anything.
        this.child.stdin.write(JSON.stringify({ id: m.id, error: { code: -32603, message: 'Not permitted in this demo.' } }) + '\n');
      } else if (m.method) {
        this.emit('event', m);
      }
    });
    await this.call('initialize', {
      clientInfo: { name: 'intelligent-3d', title: 'Intelligent 3D', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    });
    this.child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    let accountType = 'unknown';
    try {
      const account = await this.call('account/read', { refreshToken: false });
      accountType = account?.account?.type || 'unknown';
    } catch {}
    this.accountType = accountType;
    return { accountType };
  }

  call(method, params, timeoutMs = 30000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      if (!this.child || this.child.exitCode !== null) return reject(new Error('Codex app-server not running'));
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }

  fail(error) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
    this.emit('disconnected', error.message);
  }

  close() { this.child?.kill(); }
}
