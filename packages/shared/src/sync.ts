import { applyOp, type BoardState, type Op } from './model';

/**
 * Client-side sync state.
 *
 * `confirmed` is the board exactly as the server last described it.
 * `pending` holds operations this client has made that the server has not yet
 * acknowledged. `view` is what the user sees: confirmed plus pending, replayed
 * in order. Whenever either input changes, the view is rebuilt from scratch,
 * so a rejected or conflicting operation simply disappears.
 */
export interface PendingOp {
  cid: string;
  op: Op;
}

export interface SyncState {
  confirmed: BoardState;
  seq: number;
  pending: PendingOp[];
  view: BoardState;
}

function rebuild(confirmed: BoardState, pending: PendingOp[]): Pick<SyncState, 'view' | 'pending'> {
  let view = confirmed;
  const kept: PendingOp[] = [];
  for (const item of pending) {
    const result = applyOp(view, item.op);
    // An operation that no longer applies (its card was deleted by someone
    // else, say) is dropped; the server will reject it too.
    if (!result.ok) continue;
    view = result.state;
    kept.push(item);
  }
  return { view, pending: kept };
}

/** Starts from a server snapshot, keeping any operations still waiting to be sent or acknowledged. */
export function createSync(board: BoardState, seq: number, pending: PendingOp[] = []): SyncState {
  return { confirmed: board, seq, ...rebuild(board, pending) };
}

/** Applies the user's own operation immediately. Returns null if it is not valid right now. */
export function applyLocal(state: SyncState, item: PendingOp): SyncState | null {
  const result = applyOp(state.view, item.op);
  if (!result.ok) return null;
  return { ...state, view: result.state, pending: [...state.pending, item] };
}

export type RemoteResult =
  | { status: 'applied'; state: SyncState }
  | { status: 'duplicate'; state: SyncState }
  | { status: 'gap'; state: SyncState };

/** Applies an operation the server has accepted (ours or someone else's). */
export function applyRemote(
  state: SyncState,
  event: { seq: number; cid: string; op: Op },
): RemoteResult {
  if (event.seq <= state.seq) return { status: 'duplicate', state };
  if (event.seq !== state.seq + 1) return { status: 'gap', state };

  const result = applyOp(state.confirmed, event.op);
  if (!result.ok) return { status: 'gap', state };

  const pending = state.pending.filter((item) => item.cid !== event.cid);
  return {
    status: 'applied',
    state: { confirmed: result.state, seq: event.seq, ...rebuild(result.state, pending) },
  };
}

/** The server refused one of our operations: forget it and rebuild the view without it. */
export function applyReject(state: SyncState, cid: string): SyncState {
  const pending = state.pending.filter((item) => item.cid !== cid);
  return { ...state, ...rebuild(state.confirmed, pending) };
}
