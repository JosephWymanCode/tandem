import { z } from 'zod';
import { opSchema, type BoardState, type Op } from './model';

/** WebSocket close codes the client reacts to. */
export const CLOSE = {
  unauthenticated: 4401,
  forbidden: 4403,
  notFound: 4404,
  rateLimited: 4429,
  resync: 4409,
} as const;

export interface Member {
  id: string;
  name: string;
  color: string;
  role: 'owner' | 'member';
}

export interface Cursor {
  x: number;
  y: number;
}

/** One open browser tab on a board. The same user can appear more than once. */
export interface Peer {
  connId: string;
  userId: string;
  name: string;
  color: string;
  cursor: Cursor | null;
  editing: string | null;
}

/** An operation the server has accepted, numbered and attributed. */
export interface OpEvent {
  seq: number;
  cid: string;
  op: Op;
  by: string;
  byName: string;
  at: number;
  summary: string;
}

export interface Activity {
  seq: number;
  by: string;
  byName: string;
  at: number;
  summary: string;
}

interface SessionInfo {
  you: { connId: string; userId: string };
  members: Member[];
  peers: Peer[];
  inviteToken: string;
}

export type ServerMsg =
  | ({ t: 'init'; board: BoardState; seq: number; activity: Activity[] } & SessionInfo)
  | ({ t: 'catchup'; ops: OpEvent[] } & SessionInfo)
  | ({ t: 'op' } & OpEvent)
  | { t: 'reject'; cid: string; reason: string }
  | { t: 'peer.join'; peer: Peer }
  | { t: 'peer.leave'; connId: string }
  | { t: 'presence'; connId: string; cursor?: Cursor | null; editing?: string | null }
  | { t: 'members'; members: Member[] }
  | { t: 'pong' };

const coordinate = z.number().finite().min(-100_000).max(100_000);

export const clientMsgSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('op'), cid: z.string().min(1).max(40), op: opSchema }),
  z.object({
    t: z.literal('presence'),
    cursor: z.object({ x: coordinate, y: coordinate }).nullable().optional(),
    editing: z.string().max(40).nullable().optional(),
  }),
  z.object({ t: z.literal('ping') }),
]);

export type ClientMsg = z.infer<typeof clientMsgSchema>;
