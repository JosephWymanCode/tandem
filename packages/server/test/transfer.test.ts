import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IMPORT_MAX_BYTES, LIMITS, byPos, keyBetween } from '@tandem/shared';
import { contentDisposition, csvCell, exportFilename, toCsv, type BoardExport } from '../src/transfer';
import { Person, startServer, type Server } from './helpers';

let server: Server;
beforeEach(async () => {
  server = await startServer();
});
afterEach(async () => {
  await server.app.close();
});

/** Fetches an export as raw text, since a CSV download is not JSON. */
async function download(person: Person, boardId: string, format: string) {
  const response = await fetch(`${server.http}/api/boards/${boardId}/export?format=${format}`, {
    headers: person.cookie ? { Cookie: person.cookie } : {},
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  // TextDecoder drops a leading byte order mark, so callers check for it in bytes.
  return { status: response.status, headers: response.headers, bytes, text: new TextDecoder().decode(bytes) };
}

async function postImport(person: Person, body: string) {
  const response = await fetch(`${server.http}/api/boards/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(person.cookie ? { Cookie: person.cookie } : {}) },
    body,
  });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

const doc = (columns: unknown, extra: Record<string, unknown> = {}) => ({
  format: 'tandem-board',
  version: 1,
  title: 'Imported',
  columns,
  ...extra,
});

describe('export', () => {
  it('exports the board as JSON in on-screen order, without ids or people', async () => {
    const owner = await new Person(server).asGuest();
    const socket = owner.open();
    const init = await socket.next('init');
    // Move the last card of "Done" to the top so the order differs from the insertion order.
    const done = Object.values(init.board.columns).find((column) => column.title === 'Done')!;
    const doneCards = Object.values(init.board.cards)
      .filter((card) => card.columnId === done.id)
      .sort(byPos);
    socket.op({ type: 'card.move', id: doneCards[1]!.id, columnId: done.id, pos: keyBetween(null, doneCards[0]!.pos) });
    const last = socket.op({ type: 'card.update', id: doneCards[0]!.id, patch: { assigneeId: owner.userId, dueDate: '2026-12-01' } });
    await socket.next('op', (msg) => msg.cid === last);
    await socket.close();

    const result = await download(owner, owner.boardId, 'json');
    expect(result.status).toBe(200);
    expect(result.headers.get('content-type')).toMatch(/^application\/json/);
    expect(result.headers.get('content-disposition')).toBe(
      `attachment; filename="Website-relaunch.json"; filename*=UTF-8''Website%20relaunch.json`,
    );

    const board = JSON.parse(result.text) as BoardExport;
    expect(board).toMatchObject({ format: 'tandem-board', version: 1, title: 'Website relaunch' });
    expect(board.columns.map((column) => column.title)).toEqual(['Start here', 'To do', 'In progress', 'Done']);
    expect(board.columns[3]!.cards).toEqual([
      { title: 'Agree the launch date', description: '', labels: [], dueDate: null },
      { title: 'Set up error reporting', description: '', labels: ['green'], dueDate: '2026-12-01' },
    ]);
    expect(result.text).not.toContain(owner.userId);
    expect(result.text).not.toContain(owner.boardId);
    expect(result.text).not.toMatch(/"(id|pos|assigneeId|columnId|inviteToken)"/);
  });

  it('exports CSV with a byte order mark, a header row and one row per card', async () => {
    const owner = await new Person(server).asGuest();
    const result = await download(owner, owner.boardId, 'csv');
    expect(result.status).toBe(200);
    expect(result.headers.get('content-type')).toMatch(/^text\/csv/);
    expect(result.headers.get('content-disposition')).toBe(
      `attachment; filename="Website-relaunch.csv"; filename*=UTF-8''Website%20relaunch.csv`,
    );
    expect([...result.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = result.text.trimEnd().split('\r\n');
    expect(lines[0]).toBe('Column,Title,Description,Labels,Due date');
    expect(lines).toHaveLength(1 + 10);
    expect(lines).toContain('In progress,Move image uploads to background jobs,,amber,');
    expect(lines).toContain(
      'In progress,Redesign the onboarding checklist,Cut it from seven steps to four. Draft is in the design file.,teal; blue,',
    );
  });

  it('is only for people on the board, and only in known formats', async () => {
    const owner = await new Person(server).asGuest();
    const stranger = await new Person(server).asGuest();
    expect((await download(stranger, owner.boardId, 'json')).status).toBe(404);
    expect((await download(stranger, 'no-such-board', 'csv')).status).toBe(404);
    expect((await download(new Person(server), owner.boardId, 'json')).status).toBe(401);
    expect((await download(owner, owner.boardId, 'xml')).status).toBe(400);
    expect((await download(owner, owner.boardId, '')).status).toBe(400);
  });

  it('sanitises the file name', async () => {
    const owner = await new Person(server).asGuest();
    const { body } = await owner.request('POST', '/api/boards', { title: 'Q3 "plans"; résumé/../x' });
    const result = await download(owner, body.boardId as string, 'json');
    expect(result.headers.get('content-disposition')).toBe(
      `attachment; filename="Q3-plans-resume-x.json"; filename*=UTF-8''Q3%20-plans-%3B%20r%C3%A9sum%C3%A9-..-x.json`,
    );
    // Titles in other scripts keep their name for browsers that read filename*.
    expect(contentDisposition('项目计划', 'csv')).toBe(
      `attachment; filename="board.csv"; filename*=UTF-8''%E9%A1%B9%E7%9B%AE%E8%AE%A1%E5%88%92.csv`,
    );
    expect(contentDisposition("It's (done)*", 'json')).toBe(
      `attachment; filename="It-s-done.json"; filename*=UTF-8''It%27s%20%28done%29-.json`,
    );

    expect(exportFilename('Café déjà vu', 'csv')).toBe('Cafe-deja-vu.csv');
    expect(exportFilename('日本語', 'json')).toBe('board.json');
    expect(exportFilename('\r\nSet-Cookie: x', 'json')).toBe('Set-Cookie-x.json');
    expect(exportFilename('a'.repeat(200), 'csv')).toBe(`${'a'.repeat(60)}.csv`);
  });
});

describe('CSV cells', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('two\r\nlines')).toBe('"two\r\nlines"');
    expect(csvCell('')).toBe('');
  });

  it('stops a spreadsheet from running a cell as a formula', () => {
    expect(csvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('\tx')).toBe("'\tx");
    expect(csvCell('\rx')).toBe('"\'\rx"');
    expect(csvCell('=HYPERLINK("http://x", "y")')).toBe('"\'=HYPERLINK(""http://x"", ""y"")"');
    expect(csvCell('a=b')).toBe('a=b');
  });

  it('builds whole rows', () => {
    const csv = toCsv({
      format: 'tandem-board',
      version: 1,
      title: 'T',
      columns: [
        { title: 'To, do', cards: [{ title: '=1+1', description: 'x "y"', labels: ['red', 'blue'], dueDate: '2026-01-02' }] },
      ],
    });
    expect(csv).toBe('﻿Column,Title,Description,Labels,Due date\r\n"To, do",\'=1+1,"x ""y""",red; blue,2026-01-02\r\n');
  });
});

describe('import', () => {
  it('round-trips: an imported export has the same columns and cards in the same order', async () => {
    const owner = await new Person(server).asGuest();
    const exported = (await download(owner, owner.boardId, 'json')).text;

    const importer = await new Person(server).asGuest();
    const imported = await postImport(importer, exported);
    expect(imported.status).toBe(200);
    const boardId = imported.body.boardId as string;
    expect(boardId).not.toBe(owner.boardId);

    expect((await download(importer, boardId, 'json')).text).toBe(exported);
    const boards = (await importer.request('GET', '/api/boards')).body.boards as { id: string; role: string }[];
    expect(boards.find((board) => board.id === boardId)?.role).toBe('owner');
    // The original board is untouched and the importer did not join it.
    expect((await download(importer, owner.boardId, 'json')).status).toBe(404);
  });

  it('keeps due dates and fills in missing optional fields', async () => {
    const person = await new Person(server).asGuest();
    const imported = await postImport(
      person,
      JSON.stringify(
        doc([
          { title: 'Only', cards: [{ title: 'A', dueDate: '2028-02-29' }, { title: 'B', labels: ['red', 'red'] }] },
          { title: 'Empty' },
        ]),
      ),
    );
    expect(imported.status).toBe(200);
    const board = JSON.parse((await download(person, imported.body.boardId, 'json')).text) as BoardExport;
    expect(board.columns).toEqual([
      {
        title: 'Only',
        cards: [
          { title: 'A', description: '', labels: [], dueDate: '2028-02-29' },
          { title: 'B', description: '', labels: ['red'], dueDate: null },
        ],
      },
      { title: 'Empty', cards: [] },
    ]);
  });

  it('rejects documents that are not valid exports with a plain message', async () => {
    const person = await new Person(server).asGuest();
    const cases: [unknown, RegExp][] = [
      [{ hello: 'world' }, /not a Tandem board export/],
      [[1, 2], /not a Tandem board export/],
      [doc([], { version: 2 }), /different version/],
      [doc([], { title: '' }), /Title is empty/],
      [doc([{ title: 'x'.repeat(LIMITS.titleLength + 1), cards: [] }]), /Column 1: title is longer than 120/],
      [doc([{ title: 'A', cards: [{ title: 'B', labels: ['pink'] }] }]), /Column 1, card 1: label 1 must be one of red/],
      [doc([{ title: 'A', cards: [{ title: 'B', dueDate: '2026-02-30' }] }]), /Column 1, card 1: due date must be a real date/],
      [doc([{ title: 'A', cards: [{ title: 'B', description: 'x'.repeat(LIMITS.descriptionLength + 1) }] }]), /longer than 4000/],
      [doc('nope'), /Columns must be a list/],
    ];
    for (const [body, message] of cases) {
      const result = await postImport(person, JSON.stringify(body));
      expect(result.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(result.body.error).toMatch(message);
    }
    const broken = await postImport(person, '{"format": "tandem-board", ');
    expect(broken.status).toBe(400);
    expect(broken.body.error).toBe('This file is not a Tandem board export.');
    expect((await person.request('GET', '/api/boards')).body.boards).toHaveLength(1);
  });

  it('enforces the column and card limits', async () => {
    const person = await new Person(server).asGuest();
    const tooManyColumns = Array.from({ length: LIMITS.columnsPerBoard + 1 }, (_, i) => ({ title: `C${i}`, cards: [] }));
    const columns = await postImport(person, JSON.stringify(doc(tooManyColumns)));
    expect(columns.status).toBe(400);
    expect(columns.body.error).toMatch(/more than 30/);

    const cards = (count: number) => Array.from({ length: count }, (_, i) => ({ title: `Card ${i}` }));
    const tooManyCards = await postImport(
      person,
      JSON.stringify(doc([{ title: 'A', cards: cards(300) }, { title: 'B', cards: cards(LIMITS.cardsPerBoard - 299) }])),
    );
    expect(tooManyCards.status).toBe(400);
    expect(tooManyCards.body.error).toMatch(/501 cards.*at most 500/);

    const justEnough = await postImport(
      person,
      JSON.stringify(doc([{ title: 'A', cards: cards(300) }, { title: 'B', cards: cards(LIMITS.cardsPerBoard - 300) }])),
    );
    expect(justEnough.status).toBe(200);
    const listed = (await person.request('GET', '/api/boards')).body.boards as { id: string; cardCount: number }[];
    expect(listed.find((board) => board.id === justEnough.body.boardId)?.cardCount).toBe(LIMITS.cardsPerBoard);
  });

  it('round-trips the largest board the limits allow, even in a three-byte script', async () => {
    const person = await new Person(server).asGuest();
    const description = '项'.repeat(LIMITS.descriptionLength);
    const title = '计'.repeat(LIMITS.titleLength);
    const perColumn = LIMITS.cardsPerBoard / 10;
    const largest = doc(
      Array.from({ length: 10 }, () => ({
        title,
        cards: Array.from({ length: perColumn }, () => ({ title, description, labels: ['red', 'blue'] })),
      })),
    );
    const body = JSON.stringify(largest);
    expect(Buffer.byteLength(body)).toBeGreaterThan(5 * 1024 * 1024);
    const imported = await postImport(person, body);
    expect(imported.status).toBe(200);

    // Its own export, pretty-printed, imports again.
    const exported = await download(person, imported.body.boardId, 'json');
    expect((await postImport(person, exported.text)).status).toBe(200);
  });

  it('refuses bodies over the import limit', async () => {
    const person = await new Person(server).asGuest();
    const huge = doc([{ title: 'A', cards: [] }], { padding: 'x'.repeat(IMPORT_MAX_BYTES) });
    // In-process, because over a socket the server may reset the connection before the upload ends.
    const refused = await server.app.inject({
      method: 'POST',
      url: '/api/boards/import',
      headers: { 'content-type': 'application/json', cookie: person.cookie },
      payload: JSON.stringify(huge),
    });
    expect(refused.statusCode).toBe(413);
    expect(refused.json().error).toMatch(/too large/);
  });

  it('limits how often one person can import', async () => {
    const person = await new Person(server).asGuest();
    const body = JSON.stringify(doc([]));
    for (let i = 0; i < 20; i++) expect((await postImport(person, body)).status).toBe(200);
    const refused = await postImport(person, body);
    expect(refused.status).toBe(429);
    expect(refused.body.error).toMatch(/Too many imports/);
    // Someone else is not affected.
    expect((await postImport(await new Person(server).asGuest(), body)).status).toBe(200);
  });

  it('requires a session', async () => {
    const result = await postImport(new Person(server), JSON.stringify(doc([])));
    expect(result.status).toBe(401);
  });
});
