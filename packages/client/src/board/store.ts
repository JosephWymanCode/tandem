import { create } from 'zustand';
import {
  CLOSE,
  applyLocal,
  applyReject,
  applyRemote,
  createSync,
  invertOp,
  type Activity,
  type BoardState,
  type ClientMsg,
  type Cursor,
  type Member,
  type Op,
  type OpEvent,
  type Peer,
  type ServerMsg,
  type SyncState,
} from '@tandem/shared';
import { useComments } from './comments';
import { createOutbox } from './outbox';
import { dropRejected, emptyHistory, recordChange, recordStep, takeStep, type History } from './history';

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'closed';
export type ClosedReason = 'signed-out' | 'forbidden' | 'not-found';

interface BoardStore {
  status: ConnectionStatus;
  closedReason: ClosedReason | null;
  /** The board as the user should see it: server state plus their unconfirmed changes. */
  board: BoardState | null;
  pendingCount: number;
  members: Member[];
  peers: Record<string, Peer>;
  you: { connId: string; userId: string } | null;
  inviteToken: string | null;
  activity: Activity[];
  /** Shown briefly when the server refuses a change. */
  notice: string | null;

  connect: (boardId: string) => void;
  disconnect: () => void;
  dispatch: (op: Op) => boolean;
  /** Whether the person has a change of their own to undo or redo. */
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  setCursor: (cursor: Cursor | null) => void;
  setEditing: (cardId: string | null) => void;
  clearNotice: () => void;
}

const ACTIVITY_LENGTH = 50;
const PING_MS = 25_000;
const CURSOR_INTERVAL_MS = 40;

const initial = {
  status: 'connecting' as ConnectionStatus,
  closedReason: null,
  board: null,
  pendingCount: 0,
  members: [],
  peers: {},
  you: null,
  inviteToken: null,
  activity: [],
  notice: null,
  canUndo: false,
  canRedo: false,
};

// Connection state lives outside the store: components never need to render from it.
let socket: WebSocket | null = null;
let boardId: string | null = null;
let sync: SyncState | null = null;
let attempts = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let pingTimer: ReturnType<typeof setInterval> | undefined;
let editing: string | null = null;
let lastCursorSent = 0;
let cursorTimer: ReturnType<typeof setTimeout> | undefined;
let queuedCursor: Cursor | null | undefined;
let history: History = emptyHistory;

export const useBoard = create<BoardStore>((set, get) => {
  const publish = () => set({ board: sync?.view ?? null, pendingCount: sync?.pending.length ?? 0 });

  const send = (msg: ClientMsg) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  };
  const outbox = createOutbox(send);

  const toActivity = (event: OpEvent): Activity => ({
    seq: event.seq,
    by: event.by,
    byName: event.byName,
    at: event.at,
    summary: event.summary,
  });

  /** Throws away local sequence knowledge and reconnects for a full snapshot. */
  const resync = () => {
    if (sync) sync = { ...sync, seq: -1 };
    socket?.close(CLOSE.resync);
  };

  /** Returns false if the events do not follow on from what we have. */
  const applyEvents = (events: OpEvent[]): boolean => {
    for (const event of events) {
      if (!sync) return false;
      const result = applyRemote(sync, event);
      if (result.status === 'gap') return false;
      sync = result.state;
    }
    return true;
  };

  const afterHandshake = (msg: Extract<ServerMsg, { t: 'init' | 'catchup' }>) => {
    attempts = 0;
    // Anything the server never acknowledged is sent again. Operations are
    // safe to repeat: a second "add" of the same card is refused, and moves
    // and edits simply land on the same value.
    outbox.clear();
    for (const item of sync?.pending ?? []) outbox.push({ t: 'op', ...item });
    if (editing) send({ t: 'presence', editing });
    set({
      status: 'live',
      closedReason: null,
      members: msg.members,
      peers: Object.fromEntries(msg.peers.map((peer) => [peer.connId, peer])),
      you: msg.you,
      inviteToken: msg.inviteToken,
    });
    useComments.getState().handshake(msg.commentCounts);
    publish();
  };

  const onMessage = (msg: ServerMsg) => {
    switch (msg.t) {
      case 'init':
        sync = createSync(msg.board, msg.seq, sync?.pending ?? []);
        set({ activity: msg.activity });
        afterHandshake(msg);
        return;

      case 'catchup':
        if (!applyEvents(msg.ops)) return resync();
        set({ activity: [...get().activity, ...msg.ops.map(toActivity)].slice(-ACTIVITY_LENGTH) });
        afterHandshake(msg);
        return;

      case 'op':
        if (!sync) return;
        if (msg.seq <= sync.seq) return;
        if (!applyEvents([msg])) return resync();
        set({ activity: [...get().activity, toActivity(msg)].slice(-ACTIVITY_LENGTH) });
        publish();
        return;

      case 'reject':
        if (!sync) return;
        sync = applyReject(sync, msg.cid);
        setHistory(dropRejected(history, msg.cid));
        set({ notice: `Your change was undone. ${msg.reason}.` });
        publish();
        return;

      case 'peer.join':
        set({ peers: { ...get().peers, [msg.peer.connId]: msg.peer } });
        return;

      case 'peer.leave': {
        const peers = { ...get().peers };
        delete peers[msg.connId];
        set({ peers });
        return;
      }

      case 'presence': {
        const peer = get().peers[msg.connId];
        if (!peer) return;
        const next = { ...peer };
        if (msg.cursor !== undefined) next.cursor = msg.cursor;
        if (msg.editing !== undefined) next.editing = msg.editing;
        set({ peers: { ...get().peers, [msg.connId]: next } });
        return;
      }

      case 'members':
        set({ members: msg.members });
        return;

      case 'comment.added':
        useComments.getState().added(msg.comment, true);
        return;

      case 'comment.deleted':
        useComments.getState().removed(msg.cardId, msg.commentId, true);
        return;

      case 'pong':
        return;
    }
  };

  const open = () => {
    if (!boardId) return;
    clearTimeout(retryTimer);
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const since = sync && sync.seq >= 0 ? `&since=${sync.seq}` : '';
    const ws = new WebSocket(`${protocol}://${location.host}/ws?board=${encodeURIComponent(boardId)}${since}`);
    socket = ws;

    ws.onmessage = (event) => {
      if (socket !== ws) return;
      onMessage(JSON.parse(event.data as string) as ServerMsg);
    };

    ws.onclose = (event) => {
      if (socket !== ws) return;
      socket = null;
      outbox.clear();
      const reasons: Record<number, ClosedReason> = {
        [CLOSE.unauthenticated]: 'signed-out',
        [CLOSE.forbidden]: 'forbidden',
        [CLOSE.notFound]: 'not-found',
      };
      const closedReason = reasons[event.code];
      if (closedReason) {
        set({ status: 'closed', closedReason, peers: {} });
        return;
      }
      set({ status: sync ? 'reconnecting' : 'connecting', peers: {} });
      // Back off between attempts, with jitter so clients do not all return at once.
      const delay = event.code === CLOSE.resync ? 0 : Math.min(8000, 400 * 2 ** attempts) * (0.75 + Math.random() / 2);
      attempts++;
      retryTimer = setTimeout(open, delay);
    };
  };

  const setHistory = (next: History) => {
    history = next;
    set({ canUndo: history.undo.length > 0, canRedo: history.redo.length > 0 });
  };

  /** Applies one operation locally and sends it. Returns its id, or null if it is not valid right now. */
  const run = (op: Op): string | null => {
    if (!sync) return null;
    const item = { cid: crypto.randomUUID(), op };
    const next = applyLocal(sync, item);
    if (!next) return null;
    sync = next;
    publish();
    // If we are offline the change waits in `pending` and goes out on reconnect.
    outbox.push({ t: 'op', ...item });
    return item.cid;
  };

  /** Takes the newest step off one history stack and records its reverse on the other. */
  const travel = (from: keyof History) => {
    if (!sync) return;
    const { stack, step } = takeStep(sync.view, history[from]);
    let next: History = { ...history, [from]: stack };
    if (step) {
      const cids = step.apply.map(run).filter((cid): cid is string => cid !== null);
      next = recordStep(next, from === 'undo' ? 'redo' : 'undo', { ops: step.inverse, cids });
    }
    setHistory(next);
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      if (boardId && !socket) {
        attempts = 0;
        open();
      }
    });
  }

  return {
    ...initial,

    connect: (id) => {
      get().disconnect();
      boardId = id;
      set({ ...initial });
      open();
      pingTimer = setInterval(() => send({ t: 'ping' }), PING_MS);
    },

    disconnect: () => {
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      clearTimeout(cursorTimer);
      const ws = socket;
      socket = null;
      boardId = null;
      sync = null;
      editing = null;
      attempts = 0;
      history = emptyHistory;
      outbox.clear();
      ws?.close();
      set({ ...initial });
      useComments.getState().reset();
    },

    dispatch: (op) => {
      // The way back is worked out from the board as it is just before the change.
      const inverse = sync ? invertOp(sync.view, op) : null;
      const cid = run(op);
      if (!cid) return false;
      setHistory(recordChange(history, { ops: inverse ?? [], cids: [cid] }));
      return true;
    },

    undo: () => travel('undo'),
    redo: () => travel('redo'),

    setCursor: (cursor) => {
      // Cursor updates are frequent and disposable, so only the latest one in each interval is sent.
      queuedCursor = cursor;
      if (cursorTimer !== undefined) return;
      const wait = Math.max(0, CURSOR_INTERVAL_MS - (Date.now() - lastCursorSent));
      cursorTimer = setTimeout(() => {
        cursorTimer = undefined;
        lastCursorSent = Date.now();
        if (queuedCursor !== undefined) send({ t: 'presence', cursor: queuedCursor });
        queuedCursor = undefined;
      }, wait);
    },

    setEditing: (cardId) => {
      if (editing === cardId) return;
      editing = cardId;
      send({ t: 'presence', editing: cardId });
    },

    clearNotice: () => set({ notice: null }),
  };
});

/** Lets the end-to-end tests cut the connection to check that the client recovers. */
if (typeof window !== 'undefined') {
  (window as unknown as { __tandemDropConnection?: () => void }).__tandemDropConnection = () => socket?.close();
}
