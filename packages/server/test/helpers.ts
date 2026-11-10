import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import type { ClientMsg, Op, ServerMsg } from '@tandem/shared';
import { buildApp } from '../src/app';

export async function startServer() {
  const app = await buildApp({ dbPath: ':memory:', authRateLimit: 1000 });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return { app, http: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}` };
}

export type Server = Awaited<ReturnType<typeof startServer>>;

/** A signed-in person: keeps the session cookie and talks to the HTTP API. */
export class Person {
  cookie = '';
  userId = '';
  boardId = '';

  constructor(private readonly server: Server) {}

  async request(method: string, path: string, body?: unknown) {
    const response = await fetch(this.server.http + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0]!;
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  }

  async asGuest(): Promise<this> {
    const { body } = await this.request('POST', '/api/auth/guest');
    this.userId = body.user.id;
    this.boardId = body.boardId;
    return this;
  }

  open(boardId = this.boardId, options: { since?: number; origin?: string } = {}): Socket {
    const query = `board=${boardId}${options.since === undefined ? '' : `&since=${options.since}`}`;
    return new Socket(
      new WebSocket(`${this.server.ws}/ws?${query}`, {
        headers: { ...(this.cookie ? { Cookie: this.cookie } : {}), ...(options.origin ? { Origin: options.origin } : {}) },
      }),
    );
  }
}

/** A WebSocket that records everything it receives and lets a test wait for a particular message. */
export class Socket {
  readonly received: ServerMsg[] = [];
  private waiters: { test: (msg: ServerMsg) => boolean; resolve: (msg: ServerMsg) => void }[] = [];
  private cidCounter = 0;
  readonly closed: Promise<number>;

  constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as ServerMsg;
      this.received.push(msg);
      this.waiters = this.waiters.filter((waiter) => {
        if (!waiter.test(msg)) return true;
        waiter.resolve(msg);
        return false;
      });
    });
    this.closed = new Promise((resolve) => {
      ws.on('close', (code) => resolve(code));
      ws.on('error', () => resolve(-1));
    });
  }

  /** Resolves with the first message of the given kind, whether already received or still to come. */
  next<T extends ServerMsg['t']>(
    type: T,
    test: (msg: Extract<ServerMsg, { t: T }>) => boolean = () => true,
  ): Promise<Extract<ServerMsg, { t: T }>> {
    type Wanted = Extract<ServerMsg, { t: T }>;
    const matches = (msg: ServerMsg) => msg.t === type && test(msg as Wanted);
    const existing = this.received.find(matches);
    if (existing) return Promise.resolve(existing as Wanted);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${type}"`)), 2000);
      this.waiters.push({
        test: matches,
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg as Wanted);
        },
      });
    });
  }

  send(msg: ClientMsg | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(msg));
  }

  op(op: Op): string {
    const cid = `t${++this.cidCounter}-${Math.random().toString(36).slice(2, 8)}`;
    this.send({ t: 'op', cid, op });
    return cid;
  }

  async close(): Promise<void> {
    this.ws.close();
    await this.closed;
  }
}
