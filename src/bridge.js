/**
 * WebSocket bridge to the in-browser connector script (小狸连接器).
 *
 * The MCP server hosts a WS server on 127.0.0.1 (default port 6700). A small
 * Tavern-Helper script running inside SillyTavern connects out to it and
 * executes commands in the browser context — where presets, worldbooks and
 * prompt assembly actually live. This is what enables "playing" a card.
 */
import { WebSocketServer } from 'ws';
import { CLAIM_FILE, me as whoAmI, mayHold, readClaim } from './claim.js';

export class Bridge {
  /**
   * @param {number} port
   * @param {{me?: string, claimFile?: string, pollMs?: number}} [opts] 測試用：身分、牌檔、輪詢間隔
   */
  constructor(port = Number(process.env.ST_BRIDGE_PORT ?? 6700), opts = {}) {
    this.port = port;
    this.me = opts.me ?? whoAmI();
    this.claimFile = opts.claimFile ?? CLAIM_FILE;
    this.pollMs = opts.pollMs ?? 5000;
    this.socket = null;
    this.pending = new Map();
    this.nextId = 1;
    this.disabled = false;
    this.wss = null;
    this.claim = null;
    this.busyLogged = false;
    this.#tick();
    this.timer = setInterval(() => this.#tick(), this.pollMs);
    this.timer.unref?.();
  }

  // 每 5 秒一拍：先看代玩牌（claim.js），再決定綁／放／等。
  // 26-09-07 的補位邏輯併進來：搶不到埠不自廢，下一拍再試，前一個實例一死就接手。
  // 26-10-13 代玩牌：牌上不是我就不綁、拿著也放——把線交給指定的窗不用再關窗碰運氣（沐晴投件）。
  #tick() {
    this.claim = readClaim(this.claimFile);
    if (!mayHold(this.claim, this.me)) {
      if (this.wss) this.#release(`代玩牌在「${this.claim.who}」手上`);
      return;
    }
    if (!this.wss && !this.disabled) this.#bind();
  }

  #bind() {
    if (this.binding) return;
    this.binding = true;
    const wss = new WebSocketServer({ host: '127.0.0.1', port: this.port });
    wss.on('error', (e) => {
      this.binding = false;
      wss.close();
      if (this.wss === wss) this.wss = null;
      if (e.code === 'EADDRINUSE') {
        if (!this.busyLogged) {
          this.busyLogged = true;
          console.error(`[bridge] port ${this.port} busy (another tavern-tanuki instance) — will retry every ${this.pollMs / 1000}s and take over when it exits or the 代玩牌 names this window.`);
        }
        return;
      }
      this.disabled = true;
      console.error(`[bridge] WS server error (${e.code ?? e.message}) — play tools disabled.`);
    });
    wss.on('listening', () => {
      this.binding = false;
      this.wss = wss;
      this.disabled = false;
      if (this.busyLogged) {
        this.busyLogged = false;
        console.error(`[bridge] port ${this.port} acquired — play tools enabled.`);
      }
    });
    wss.on('connection', (ws) => {
      // Newest connection wins (e.g. after a tavern page reload).
      if (this.socket && this.socket.readyState === 1) this.socket.close();
      this.socket = ws;
      ws.on('message', (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        const waiter = this.pending.get(msg.id);
        if (waiter) {
          this.pending.delete(msg.id);
          waiter(msg);
        }
      });
      ws.on('close', () => {
        if (this.socket === ws) this.socket = null;
      });
    });
  }

  #release(reason) {
    const wss = this.wss;
    this.wss = null;
    try {
      if (this.socket) this.socket.close();
    } catch {
      /* 已斷 */
    }
    this.socket = null;
    for (const [id, waiter] of this.pending) {
      this.pending.delete(id);
      waiter({ id, ok: false, error: `bridge released: ${reason}` });
    }
    wss?.close();
    console.error(`[bridge] port ${this.port} released — ${reason}.`);
  }

  /** 拿著 6700 嗎（不等於瀏覽器已連上，那看 connected）。 */
  get holding() {
    return !!this.wss;
  }

  get connected() {
    return !!this.socket && this.socket.readyState === 1;
  }

  /** 給 play_status 看的一眼狀態。 */
  status() {
    return { me: this.me || null, holder: this.claim?.who ?? null, holding: this.holding, connected: this.connected };
  }

  /** 測試與收尾用：停輪詢、放埠。 */
  close() {
    clearInterval(this.timer);
    if (this.wss) this.#release('closed');
  }

  /** Send a command to the connector script and await its response. */
  call(cmd, args = {}, timeoutMs = 30_000) {
    if (!this.connected) {
      const why = !this.holding && this.claim && this.claim.who !== this.me
        ? `這扇窗沒拿代玩線：代玩牌在「${this.claim.who}」手上（play_claim 可以把牌改成自己）。`
        : 'Tavern connector is not connected. Make sure SillyTavern is open in a browser ' +
          'and the 小狸连接器 script is enabled in Tavern-Helper (酒馆助手 → 脚本库).';
      throw new Error(why);
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Bridge command "${cmd}" timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.ok) resolve(msg.data);
        else reject(new Error(msg.error ?? 'Unknown bridge error'));
      });
      this.socket.send(JSON.stringify({ id, cmd, args }));
    });
  }
}
