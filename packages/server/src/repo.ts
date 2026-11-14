import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Activity, BoardState, Card, Column, Comment, Label, Member, Op, OpEvent } from '@tandem/shared';
import { transaction, type Db } from './db';

export interface User {
  id: string;
  email: string | null;
  name: string;
  color: string;
  isGuest: boolean;
}

export interface BoardSummary {
  id: string;
  title: string;
  role: 'owner' | 'member';
  memberCount: number;
  cardCount: number;
  createdAt: number;
}

export const USER_COLORS = [
  '#E5484D',
  '#F76B15',
  '#12A594',
  '#3E63DD',
  '#8E4EC6',
  '#D6409F',
  '#30A46C',
  '#0090FF',
];

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type Row = Record<string, string | number | null>;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

function toUser(row: Row): User {
  return {
    id: row.id as string,
    email: row.email as string | null,
    name: row.name as string,
    color: row.color as string,
    isGuest: row.is_guest === 1,
  };
}

/** All database access goes through this class, so swapping SQLite for another store touches one file. */
export class Repo {
  constructor(private readonly db: Db) {}

  // ---- Users and sessions -------------------------------------------------

  createUser(input: { email: string | null; name: string; passwordHash: string | null; isGuest: boolean }): User {
    const user: User = {
      id: randomUUID(),
      email: input.email,
      name: input.name,
      color: USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)]!,
      isGuest: input.isGuest,
    };
    this.db
      .prepare(
        'INSERT INTO users (id, email, name, password_hash, is_guest, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(user.id, user.email, user.name, input.passwordHash, input.isGuest ? 1 : 0, user.color, Date.now());
    return user;
  }

  findUserByEmail(email: string): (User & { passwordHash: string | null }) | null {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as Row | undefined;
    return row ? { ...toUser(row), passwordHash: row.password_hash as string | null } : null;
  }

  /** Returns the raw session token. Only its hash is stored, so a leaked database cannot be used to log in. */
  createSession(userId: string): string {
    const token = randomBytes(32).toString('base64url');
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(hashToken(token), userId, Date.now() + SESSION_TTL_MS);
    return token;
  }

  findUserBySession(token: string): User | null {
    const row = this.db
      .prepare(
        `SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
         WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
      )
      .get(hashToken(token), Date.now()) as Row | undefined;
    return row ? toUser(row) : null;
  }

  deleteSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  }

  // ---- Boards -------------------------------------------------------------

  createBoard(
    ownerId: string,
    title: string,
    content: { columns: Column[]; cards: Omit<Card, 'assigneeId' | 'dueDate'>[] } = { columns: [], cards: [] },
  ): string {
    const boardId = randomUUID();
    const now = Date.now();
    transaction(this.db, () => {
      this.db
        .prepare('INSERT INTO boards (id, title, owner_id, invite_token, seq, created_at) VALUES (?, ?, ?, ?, 0, ?)')
        .run(boardId, title, ownerId, randomBytes(12).toString('base64url'), now);
      this.db
        .prepare("INSERT INTO board_members (board_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)")
        .run(boardId, ownerId, now);
      const insertColumn = this.db.prepare('INSERT INTO columns (board_id, id, title, pos) VALUES (?, ?, ?, ?)');
      for (const column of content.columns) insertColumn.run(boardId, column.id, column.title, column.pos);
      const insertCard = this.db.prepare(
        'INSERT INTO cards (board_id, id, column_id, title, description, labels, pos) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      for (const card of content.cards) {
        insertCard.run(
          boardId,
          card.id,
          card.columnId,
          card.title,
          card.description,
          JSON.stringify(card.labels),
          card.pos,
        );
      }
    });
    return boardId;
  }

  listBoards(userId: string): BoardSummary[] {
    const rows = this.db
      .prepare(
        `SELECT boards.id, boards.title, boards.created_at, mine.role,
                (SELECT COUNT(*) FROM board_members WHERE board_id = boards.id) AS member_count,
                (SELECT COUNT(*) FROM cards WHERE board_id = boards.id) AS card_count
         FROM board_members AS mine JOIN boards ON boards.id = mine.board_id
         WHERE mine.user_id = ?
         ORDER BY boards.created_at DESC`,
      )
      .all(userId) as Row[];
    return rows.map((row) => ({
      id: row.id as string,
      title: row.title as string,
      role: row.role as 'owner' | 'member',
      memberCount: row.member_count as number,
      cardCount: row.card_count as number,
      createdAt: row.created_at as number,
    }));
  }

  getRole(boardId: string, userId: string): 'owner' | 'member' | null {
    const row = this.db
      .prepare('SELECT role FROM board_members WHERE board_id = ? AND user_id = ?')
      .get(boardId, userId) as Row | undefined;
    return (row?.role as 'owner' | 'member' | undefined) ?? null;
  }

  listMembers(boardId: string): Member[] {
    const rows = this.db
      .prepare(
        `SELECT users.id, users.name, users.color, board_members.role
         FROM board_members JOIN users ON users.id = board_members.user_id
         WHERE board_members.board_id = ? ORDER BY board_members.joined_at`,
      )
      .all(boardId) as Row[];
    return rows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      color: row.color as string,
      role: row.role as 'owner' | 'member',
    }));
  }

  findBoardByInvite(token: string): { id: string; title: string } | null {
    const row = this.db.prepare('SELECT id, title FROM boards WHERE invite_token = ?').get(token) as Row | undefined;
    return row ? { id: row.id as string, title: row.title as string } : null;
  }

  /** Returns true if the user was newly added. */
  addMember(boardId: string, userId: string): boolean {
    const result = this.db
      .prepare("INSERT OR IGNORE INTO board_members (board_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)")
      .run(boardId, userId, Date.now());
    return result.changes > 0;
  }

  /** Removes a member who is not the owner. Returns true if someone was removed. */
  removeMember(boardId: string, userId: string): boolean {
    const result = this.db
      .prepare("DELETE FROM board_members WHERE board_id = ? AND user_id = ? AND role = 'member'")
      .run(boardId, userId);
    return result.changes > 0;
  }

  /** Replaces the board's invite token, so the old link stops working, and returns the new one. */
  resetInviteToken(boardId: string): string {
    const token = randomBytes(12).toString('base64url');
    this.db.prepare('UPDATE boards SET invite_token = ? WHERE id = ?').run(token, boardId);
    return token;
  }

  deleteBoard(boardId: string): void {
    transaction(this.db, () => {
      this.db.prepare('DELETE FROM cards WHERE board_id = ?').run(boardId);
      this.db.prepare('DELETE FROM boards WHERE id = ?').run(boardId);
    });
  }

  loadBoard(boardId: string): { state: BoardState; seq: number; inviteToken: string } | null {
    const board = this.db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId) as Row | undefined;
    if (!board) return null;

    const state: BoardState = { id: boardId, title: board.title as string, columns: {}, cards: {} };
    for (const row of this.db.prepare('SELECT * FROM columns WHERE board_id = ?').all(boardId) as Row[]) {
      state.columns[row.id as string] = { id: row.id as string, title: row.title as string, pos: row.pos as string };
    }
    for (const row of this.db.prepare('SELECT * FROM cards WHERE board_id = ?').all(boardId) as Row[]) {
      state.cards[row.id as string] = {
        id: row.id as string,
        columnId: row.column_id as string,
        title: row.title as string,
        description: row.description as string,
        labels: JSON.parse(row.labels as string) as Label[],
        assigneeId: row.assignee_id as string | null,
        dueDate: (row.due_date as string | null) ?? null,
        pos: row.pos as string,
      };
    }
    return { state, seq: board.seq as number, inviteToken: board.invite_token as string };
  }

  // ---- Operations ---------------------------------------------------------

  /** Writes one accepted operation: the change itself, the new sequence number and the log entry, atomically. */
  persistOp(boardId: string, event: OpEvent): void {
    transaction(this.db, () => {
      this.writeOp(boardId, event.op);
      this.db.prepare('UPDATE boards SET seq = ? WHERE id = ?').run(event.seq, boardId);
      this.db
        .prepare(
          'INSERT INTO ops (board_id, seq, cid, user_id, user_name, op, summary, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(boardId, event.seq, event.cid, event.by, event.byName, JSON.stringify(event.op), event.summary, event.at);
    });
  }

  private writeOp(boardId: string, op: Op): void {
    const db = this.db;
    switch (op.type) {
      case 'board.rename':
        db.prepare('UPDATE boards SET title = ? WHERE id = ?').run(op.title, boardId);
        return;
      case 'column.add':
        db.prepare('INSERT INTO columns (board_id, id, title, pos) VALUES (?, ?, ?, ?)').run(
          boardId,
          op.id,
          op.title,
          op.pos,
        );
        return;
      case 'column.rename':
        db.prepare('UPDATE columns SET title = ? WHERE board_id = ? AND id = ?').run(op.title, boardId, op.id);
        return;
      case 'column.move':
        db.prepare('UPDATE columns SET pos = ? WHERE board_id = ? AND id = ?').run(op.pos, boardId, op.id);
        return;
      case 'column.delete':
        db.prepare('DELETE FROM columns WHERE board_id = ? AND id = ?').run(boardId, op.id);
        return;
      case 'card.add':
        db.prepare('INSERT INTO cards (board_id, id, column_id, title, pos) VALUES (?, ?, ?, ?, ?)').run(
          boardId,
          op.id,
          op.columnId,
          op.title,
          op.pos,
        );
        return;
      case 'card.update': {
        const { patch } = op;
        if (patch.title !== undefined) {
          db.prepare('UPDATE cards SET title = ? WHERE board_id = ? AND id = ?').run(patch.title, boardId, op.id);
        }
        if (patch.description !== undefined) {
          db.prepare('UPDATE cards SET description = ? WHERE board_id = ? AND id = ?').run(
            patch.description,
            boardId,
            op.id,
          );
        }
        if (patch.labels !== undefined) {
          db.prepare('UPDATE cards SET labels = ? WHERE board_id = ? AND id = ?').run(
            JSON.stringify([...new Set(patch.labels)]),
            boardId,
            op.id,
          );
        }
        if (patch.assigneeId !== undefined) {
          db.prepare('UPDATE cards SET assignee_id = ? WHERE board_id = ? AND id = ?').run(
            patch.assigneeId,
            boardId,
            op.id,
          );
        }
        if (patch.dueDate !== undefined) {
          db.prepare('UPDATE cards SET due_date = ? WHERE board_id = ? AND id = ?').run(patch.dueDate, boardId, op.id);
        }
        return;
      }
      case 'card.move':
        db.prepare('UPDATE cards SET column_id = ?, pos = ? WHERE board_id = ? AND id = ?').run(
          op.columnId,
          op.pos,
          boardId,
          op.id,
        );
        return;
      case 'card.delete':
        db.prepare('DELETE FROM cards WHERE board_id = ? AND id = ?').run(boardId, op.id);
        return;
    }
  }

  opsSince(boardId: string, since: number, limit: number): OpEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM ops WHERE board_id = ? AND seq > ? ORDER BY seq LIMIT ?')
      .all(boardId, since, limit) as Row[];
    return rows.map((row) => ({
      seq: row.seq as number,
      cid: row.cid as string,
      op: JSON.parse(row.op as string) as Op,
      by: row.user_id as string,
      byName: row.user_name as string,
      at: row.at as number,
      summary: row.summary as string,
    }));
  }

  recentActivity(boardId: string, limit: number): Activity[] {
    const rows = this.db
      .prepare('SELECT seq, user_id, user_name, summary, at FROM ops WHERE board_id = ? ORDER BY seq DESC LIMIT ?')
      .all(boardId, limit) as Row[];
    return rows.reverse().map((row) => ({
      seq: row.seq as number,
      by: row.user_id as string,
      byName: row.user_name as string,
      at: row.at as number,
      summary: row.summary as string,
    }));
  }

  // ---- Comments -----------------------------------------------------------

  cardExists(boardId: string, cardId: string): boolean {
    return this.db.prepare('SELECT 1 FROM cards WHERE board_id = ? AND id = ?').get(boardId, cardId) !== undefined;
  }

  /** Oldest first. */
  listComments(boardId: string, cardId: string): Comment[] {
    const rows = this.db
      .prepare('SELECT * FROM comments WHERE board_id = ? AND card_id = ? ORDER BY created_at, rowid')
      .all(boardId, cardId) as Row[];
    return rows.map(toComment);
  }

  addComment(boardId: string, cardId: string, author: User, body: string): Comment {
    const comment: Comment = {
      id: randomUUID(),
      cardId,
      authorId: author.id,
      authorName: author.name,
      body,
      createdAt: Date.now(),
    };
    this.db
      .prepare(
        'INSERT INTO comments (id, board_id, card_id, author_id, author_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(comment.id, boardId, cardId, author.id, author.name, body, comment.createdAt);
    return comment;
  }

  findComment(boardId: string, commentId: string): Comment | null {
    const row = this.db.prepare('SELECT * FROM comments WHERE board_id = ? AND id = ?').get(boardId, commentId) as
      | Row
      | undefined;
    return row ? toComment(row) : null;
  }

  /** Returns true if the comment was there to delete. */
  deleteComment(boardId: string, commentId: string): boolean {
    return this.db.prepare('DELETE FROM comments WHERE board_id = ? AND id = ?').run(boardId, commentId).changes > 0;
  }

  /** Comment totals by card, leaving out cards that have none. */
  commentCounts(boardId: string): Record<string, number> {
    const rows = this.db
      .prepare('SELECT card_id, COUNT(*) AS total FROM comments WHERE board_id = ? GROUP BY card_id')
      .all(boardId) as Row[];
    return Object.fromEntries(rows.map((row) => [row.card_id as string, row.total as number]));
  }
}

function toComment(row: Row): Comment {
  return {
    id: row.id as string,
    cardId: row.card_id as string,
    authorId: row.author_id as string,
    authorName: row.author_name as string,
    body: row.body as string,
    createdAt: row.created_at as number,
  };
}
