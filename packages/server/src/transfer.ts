import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  IMPORT_MAX_BYTES,
  IMPORT_MESSAGES,
  LABELS,
  LIMITS,
  dueDateSchema,
  cardsInColumn,
  initialKeys,
  sortedColumns,
  type BoardState,
  type Card,
  type Column,
} from '@tandem/shared';
import { RateLimiter } from './auth';
import type { Repo, User } from './repo';

/** Import attempts per person per minute: room for retries, too few to fill the disk with boards. */
const IMPORTS_PER_MINUTE = 20;

// ---- Export ---------------------------------------------------------------

/**
 * The card fields that travel in an export. Ids, positions and assignees stay
 * behind: the people on this board may not exist wherever the file is imported.
 * To carry another plain card field, add it here and to `importCard` below.
 */
const exportCard = (card: Card) => ({
  title: card.title,
  description: card.description,
  labels: card.labels,
  dueDate: card.dueDate,
});

export type ExportedCard = ReturnType<typeof exportCard>;

export interface BoardExport {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  title: string;
  columns: { title: string; cards: ExportedCard[] }[];
}

/** The board as a portable document, with columns and cards in the order they appear on screen. */
export function toExport(state: BoardState): BoardExport {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    title: state.title,
    columns: sortedColumns(state).map((column) => ({
      title: column.title,
      cards: cardsInColumn(state, column.id).map(exportCard),
    })),
  };
}

/**
 * One CSV cell. Text a spreadsheet would run as a formula gets a leading
 * apostrophe, and anything holding a quote, comma or line break is quoted (RFC 4180).
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** Written as a char code so no editor or formatter can silently drop it. */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

/** One row per card. Starts with a byte order mark so Excel reads the file as UTF-8. */
export function toCsv(board: BoardExport): string {
  const rows: string[][] = [['Column', 'Title', 'Description', 'Labels', 'Due date']];
  for (const column of board.columns) {
    for (const card of column.cards) {
      rows.push([column.title, card.title, card.description, card.labels.join('; '), card.dueDate ?? '']);
    }
  }
  return BYTE_ORDER_MARK + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** A download name made from the board title, reduced to characters every file system and header accepts. */
export function exportFilename(title: string, extension: 'json' | 'csv'): string {
  const base = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return `${base || 'board'}.${extension}`;
}

/**
 * The Content-Disposition value: an ASCII name for every browser, plus the
 * full title (RFC 5987) for browsers that understand it, so a title in any
 * script still downloads under its own name.
 */
export function contentDisposition(title: string, extension: 'json' | 'csv'): string {
  const ascii = exportFilename(title, extension);
  // Control characters and characters file systems forbid become dashes.
  const name = title.replace(/[\p{Cc}\\/:*?"<>|]+/gu, '-').trim().slice(0, 100);
  const encoded = encodeURIComponent(`${name || 'board'}.${extension}`).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

// ---- Import ---------------------------------------------------------------

const importTitle = z
  .string('must be text')
  .trim()
  .min(1, 'is empty')
  .max(LIMITS.titleLength, `is longer than ${LIMITS.titleLength} characters`);

const importCard = z.object(
  {
    title: importTitle,
    description: z
      .string('must be text')
      .max(LIMITS.descriptionLength, `is longer than ${LIMITS.descriptionLength} characters`)
      .default(''),
    labels: z
      .array(z.enum(LABELS, `must be one of ${LABELS.join(', ')}`), 'must be a list')
      .max(LABELS.length, `has more than ${LABELS.length} entries`)
      .transform((labels) => [...new Set(labels)])
      .default([]),
    // Checked by the same schema as a card edit, with one plain message for any way it can be wrong.
    dueDate: z
      .custom<string | null>(
        (value) => value === null || dueDateSchema.safeParse(value).success,
        'must be a real date written as YYYY-MM-DD',
      )
      .default(null),
  },
  'must be an object',
);

const importBody = z.object(
  {
    format: z.literal(EXPORT_FORMAT),
    version: z.literal(EXPORT_VERSION),
    title: importTitle,
    columns: z
      .array(
        z.object({ title: importTitle, cards: z.array(importCard, 'must be a list').default([]) }, 'must be an object'),
        'must be a list',
      )
      .max(LIMITS.columnsPerBoard, `has more than ${LIMITS.columnsPerBoard} entries`),
  },
  'must be an object',
);

export type BoardImport = z.infer<typeof importBody>;

const NOT_AN_EXPORT = IMPORT_MESSAGES.notAnExport;

/** Says where in the document a problem is, in the words a person would use: "Column 2, card 3: title". */
function describePath(path: PropertyKey[]): string {
  const parts: string[] = [];
  for (let index = 0; index < path.length; index++) {
    const key = path[index];
    const next = path[index + 1];
    if ((key === 'columns' || key === 'cards' || key === 'labels') && typeof next === 'number') {
      parts.push(`${key.slice(0, -1)} ${next + 1}`);
      index++;
    } else {
      parts.push(key === 'dueDate' ? 'due date' : String(key));
    }
  }
  const last = parts.pop() ?? '';
  const where = parts.join(', ');
  const text = where ? `${where}: ${last}` : last;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Checks an uploaded document. On failure the message says what is wrong in plain words. */
export function parseImport(body: unknown): { ok: true; board: BoardImport } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, error: NOT_AN_EXPORT };
  const document = body as Record<string, unknown>;
  if (document.format !== EXPORT_FORMAT) return { ok: false, error: NOT_AN_EXPORT };
  if (document.version !== EXPORT_VERSION) {
    return { ok: false, error: 'This export was made by a different version of Tandem and cannot be imported.' };
  }

  const parsed = importBody.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return { ok: false, error: `This file cannot be imported. ${describePath(issue.path)} ${issue.message}.` };
  }
  const cardCount = parsed.data.columns.reduce((total, column) => total + column.cards.length, 0);
  if (cardCount > LIMITS.cardsPerBoard) {
    return {
      ok: false,
      error: `This file cannot be imported. It has ${cardCount} cards and a board can have at most ${LIMITS.cardsPerBoard}.`,
    };
  }
  return { ok: true, board: parsed.data };
}

/** Builds a brand new board from an imported document: fresh ids, fresh positions, owned by the importer. */
export function createImportedBoard(repo: Repo, ownerId: string, board: BoardImport): string {
  const columns: Column[] = [];
  const cards: Omit<Card, 'assigneeId'>[] = [];
  const columnKeys = initialKeys(board.columns.length);

  board.columns.forEach((importedColumn, columnIndex) => {
    const columnId = randomUUID();
    columns.push({ id: columnId, title: importedColumn.title, pos: columnKeys[columnIndex]! });
    const cardKeys = initialKeys(importedColumn.cards.length);
    importedColumn.cards.forEach((importedCard, cardIndex) => {
      cards.push({ ...importedCard, id: randomUUID(), columnId, pos: cardKeys[cardIndex]! });
    });
  });

  return repo.createBoard(ownerId, board.title, { columns, cards });
}

// ---- Routes ---------------------------------------------------------------

export interface TransferDeps {
  repo: Repo;
  requireUser: (request: FastifyRequest, reply: FastifyReply) => User | null;
}

export function registerTransferRoutes(app: FastifyInstance, { repo, requireUser }: TransferDeps): void {
  const importLimiter = new RateLimiter(IMPORTS_PER_MINUTE, 60_000);

  app.get<{ Params: { boardId: string }; Querystring: { format?: string } }>(
    '/api/boards/:boardId/export',
    async (request, reply) => {
      const user = requireUser(request, reply);
      if (!user) return;
      const { format } = request.query;
      if (format !== 'json' && format !== 'csv') {
        return reply.code(400).send({ error: 'Choose a format: json or csv.' });
      }
      // A stranger cannot tell the board exists.
      const loaded = repo.getRole(request.params.boardId, user.id) === null ? null : repo.loadBoard(request.params.boardId);
      if (!loaded) return reply.code(404).send({ error: 'Board not found.' });

      const board = toExport(loaded.state);
      reply.header('Content-Disposition', contentDisposition(board.title, format));
      reply.header('Cache-Control', 'no-store');
      if (format === 'csv') return reply.type('text/csv; charset=utf-8').send(toCsv(board));
      return reply.type('application/json; charset=utf-8').send(JSON.stringify(board, null, 2) + '\n');
    },
  );

  app.post(
    '/api/boards/import',
    {
      // Imports are whole boards, so they need more room than the 16 KB allowed for other requests.
      bodyLimit: IMPORT_MAX_BYTES,
      // Fastify's own wording for an oversized or unreadable body is not written for people.
      errorHandler(error: { statusCode?: number }, _request, reply) {
        if (error.statusCode === 413) {
          return reply.code(413).send({ error: IMPORT_MESSAGES.tooLarge });
        }
        if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
          return reply.code(400).send({ error: NOT_AN_EXPORT });
        }
        reply.send(error);
      },
    },
    async (request, reply) => {
      const user = requireUser(request, reply);
      if (!user) return;
      if (!importLimiter.allow(user.id)) {
        return reply.code(429).send({ error: 'Too many imports. Wait a minute and try again.' });
      }
      const parsed = parseImport(request.body);
      if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
      return { boardId: createImportedBoard(repo, user.id, parsed.board) };
    },
  );
}
