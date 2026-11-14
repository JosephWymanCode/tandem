import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  CLOSE,
  applyOp,
  clientMsgSchema,
  describeOp,
  type BoardState,
  type Cursor,
  type Op,
  type OpEvent,
  type Peer,
  type ServerMsg,
} from '@tandem/shared';
import type { Repo, User } from './repo';

const MAX_MESSAGES_PER_SECOND = 100;
const MAX_CATCHUP_OPS = 200;
const ACTIVITY_LENGTH = 50;
const HEARTBEAT_MS = 30_000;

interface Conn {
  id: string;
  ws: WebSocket;
  user: User;
  cursor: Cursor | null;
  editing: string | null;
  alive: boolean;
  windowStart: number;
  windowCount: number;
}

const toPeer = (conn: Conn): Peer => ({
  connId: conn.id,
  userId: conn.user.id,
  name: conn.user.name,
  color: conn.user.color,
  cursor: conn.cursor,
  editing: conn.editing,
});

/**
 * One live board. The room holds the board in memory while anyone is
 * connected and is the single place operations are ordered: each accepted
 * operation gets the next sequence number, is written to the database, and is
 * then sent to everyone, including the person who made it.
 */
class Room {
  readonly conns = new Map<string, Conn>();

  constructor(
    readonly boardId: string,
    private state: BoardState,
    private seq: number,
    private inviteToken: string,
    private readonly repo: Repo,
  ) {}

  private send(conn: Conn, msg: ServerMsg): void {
    if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(JSON.stringify(msg));
  }

  broadcast(msg: ServerMsg, except?: Conn): void {
    const data = JSON.stringify(msg);
    for (const conn of this.conns.values()) {
      if (conn !== except && conn.ws.readyState === conn.ws.OPEN) conn.ws.send(data);
    }
  }

  join(ws: WebSocket, user: User, since: number | null): Conn {
    const conn: Conn = {
      id: randomUUID(),
      ws,
      user,
      cursor: null,
      editing: null,
      alive: true,
      windowStart: Date.now(),
      windowCount: 0,
    };
    this.conns.set(conn.id, conn);

    const session = {
      you: { connId: conn.id, userId: user.id },
      members: this.repo.listMembers(this.boardId),
      peers: [...this.conns.values()].filter((other) => other !== conn).map(toPeer),
      inviteToken: this.inviteToken,
      commentCounts: this.repo.commentCounts(this.boardId),
    };

    // A client that was only briefly away gets just the operations it missed.
    const missed = since === null ? -1 : this.seq - since;
    const ops = missed >= 0 && missed <= MAX_CATCHUP_OPS ? this.repo.opsSince(this.boardId, since!, missed) : null;
    if (ops && ops.length === missed) {
      this.send(conn, { t: 'catchup', ops, ...session });
    } else {
      this.send(conn, {
        t: 'init',
        board: this.state,
        seq: this.seq,
        activity: this.repo.recentActivity(this.boardId, ACTIVITY_LENGTH),
        ...session,
      });
    }

    this.broadcast({ t: 'peer.join', peer: toPeer(conn) }, conn);
    ws.on('message', (data) => this.receive(conn, data.toString()));
    ws.on('pong', () => {
      conn.alive = true;
    });
    return conn;
  }

  leave(conn: Conn): void {
    if (!this.conns.delete(conn.id)) return;
    this.broadcast({ t: 'peer.leave', connId: conn.id });
  }

  sendMembers(): void {
    this.broadcast({ t: 'members', members: this.repo.listMembers(this.boardId) });
  }

  private receive(conn: Conn, text: string): void {
    // A connection dropped from the room (its person was removed) may still deliver frames while it closes.
    if (!this.conns.has(conn.id)) return;
    const now = Date.now();
    if (now - conn.windowStart >= 1000) {
      conn.windowStart = now;
      conn.windowCount = 0;
    }
    if (++conn.windowCount > MAX_MESSAGES_PER_SECOND) {
      conn.ws.close(CLOSE.rateLimited, 'Too many messages');
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return;
    }
    const parsed = clientMsgSchema.safeParse(raw);
    if (!parsed.success) {
      // Tell the sender which operation failed so it can roll back.
      const cid = (raw as { cid?: unknown } | null)?.cid;
      if (typeof cid === 'string') this.send(conn, { t: 'reject', cid: cid.slice(0, 40), reason: 'Invalid change' });
      return;
    }

    const msg = parsed.data;
    switch (msg.t) {
      case 'ping':
        this.send(conn, { t: 'pong' });
        return;
      case 'presence': {
        if (msg.cursor !== undefined) conn.cursor = msg.cursor;
        if (msg.editing !== undefined) conn.editing = msg.editing;
        this.broadcast({ t: 'presence', connId: conn.id, cursor: msg.cursor, editing: msg.editing }, conn);
        return;
      }
      case 'op':
        this.handleOp(conn, msg.cid, msg.op);
        return;
    }
  }

  private handleOp(conn: Conn, cid: string, op: Op): void {
    const error = this.commit(conn.user, cid, op);
    if (error) this.send(conn, { t: 'reject', cid, reason: error });
  }

  /** Orders, saves and sends one operation made by `user`. Returns the reason it was refused, or null. */
  private commit(user: User, cid: string, op: Op): string | null {
    const result = applyOp(this.state, op);
    if (!result.ok) return result.error;
    if (
      op.type === 'card.update' &&
      op.patch.assigneeId != null &&
      this.repo.getRole(this.boardId, op.patch.assigneeId) === null
    ) {
      return 'That person is not on this board';
    }

    const event: OpEvent = {
      seq: this.seq + 1,
      cid,
      op,
      by: user.id,
      byName: user.name,
      at: Date.now(),
      summary: describeOp(this.state, op),
    };
    try {
      this.repo.persistOp(this.boardId, event);
    } catch {
      return 'The change could not be saved';
    }

    this.state = result.state;
    this.seq = event.seq;
    this.broadcast({ t: 'op', ...event });
    return null;
  }

  /**
   * Someone was taken off the board (the database row is already gone): close
   * their connections, unassign their cards through the normal operation path
   * so every client and the log agree, and tell everyone else.
   */
  memberRemoved(userId: string, by: User): void {
    for (const conn of this.conns.values()) {
      if (conn.user.id !== userId) continue;
      conn.ws.close(CLOSE.forbidden, 'You are not on this board');
      this.leave(conn);
    }
    for (const card of Object.values(this.state.cards)) {
      if (card.assigneeId !== userId) continue;
      this.commit(by, randomUUID(), { type: 'card.update', id: card.id, patch: { assigneeId: null } });
    }
    this.sendMembers();
  }

  inviteReset(inviteToken: string): void {
    this.inviteToken = inviteToken;
    this.broadcast({ t: 'invite', inviteToken });
  }
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly heartbeat: NodeJS.Timeout;

  constructor(private readonly repo: Repo) {
    // Drop connections that stopped answering, so their cursors do not linger.
    this.heartbeat = setInterval(() => {
      for (const room of this.rooms.values()) {
        for (const conn of room.conns.values()) {
          if (!conn.alive) {
            conn.ws.terminate();
            continue;
          }
          conn.alive = false;
          conn.ws.ping();
        }
      }
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  /** The caller must already have checked that `user` is a member of the board. */
  connect(ws: WebSocket, user: User, boardId: string, since: number | null): void {
    let room = this.rooms.get(boardId);
    if (!room) {
      const loaded = this.repo.loadBoard(boardId);
      if (!loaded) {
        ws.close(CLOSE.notFound, 'Board not found');
        return;
      }
      room = new Room(boardId, loaded.state, loaded.seq, loaded.inviteToken, this.repo);
      this.rooms.set(boardId, room);
    }

    const active = room;
    const conn = active.join(ws, user, since);
    ws.on('close', () => {
      active.leave(conn);
      if (active.conns.size === 0 && this.rooms.get(boardId) === active) this.rooms.delete(boardId);
    });
    ws.on('error', () => ws.terminate());
  }

  membersChanged(boardId: string): void {
    this.rooms.get(boardId)?.sendMembers();
  }

  /** Sends a message to everyone who has the board open. */
  broadcast(boardId: string, msg: ServerMsg): void {
    this.rooms.get(boardId)?.broadcast(msg);
  }

  /**
   * Call after removing `userId` from the board in the database. Their cards
   * are unassigned through the open room if there is one. Otherwise the board
   * is read from the database and the same operations are written straight
   * back, so the log still lets a reconnecting client catch up.
   */
  memberRemoved(boardId: string, userId: string, by: User): void {
    let room = this.rooms.get(boardId);
    if (!room) {
      const loaded = this.repo.loadBoard(boardId);
      if (!loaded) return;
      // Nobody is connected, so this room is used once and never registered.
      room = new Room(boardId, loaded.state, loaded.seq, loaded.inviteToken, this.repo);
    }
    room.memberRemoved(userId, by);
  }

  inviteReset(boardId: string, inviteToken: string): void {
    this.rooms.get(boardId)?.inviteReset(inviteToken);
  }

  closeBoard(boardId: string): void {
    const room = this.rooms.get(boardId);
    if (!room) return;
    this.rooms.delete(boardId);
    for (const conn of room.conns.values()) conn.ws.close(CLOSE.notFound, 'Board deleted');
  }

  stop(): void {
    clearInterval(this.heartbeat);
    for (const room of this.rooms.values()) {
      for (const conn of room.conns.values()) conn.ws.terminate();
    }
    this.rooms.clear();
  }
}
