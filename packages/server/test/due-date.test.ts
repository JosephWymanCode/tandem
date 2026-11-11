import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cardsInColumn, sortedColumns } from '@tandem/shared';
import { Person, startServer, type Server } from './helpers';

let server: Server;
beforeEach(async () => {
  server = await startServer();
});
afterEach(async () => {
  await server.app.close();
});

describe('due dates', () => {
  it('starts seed cards without due dates', async () => {
    const guest = await new Person(server).asGuest();
    const socket = guest.open();
    const { board } = await socket.next('init');
    expect(Object.values(board.cards).every((card) => card.dueDate === null)).toBe(true);
    await socket.close();
  });

  it('keeps a due date after everyone disconnects, and keeps it cleared', async () => {
    const guest = await new Person(server).asGuest();
    const first = guest.open();
    const { board } = await first.next('init');
    const [column] = sortedColumns(board);
    const [kept, cleared] = cardsInColumn(board, column!.id);

    first.op({ type: 'card.update', id: kept!.id, patch: { dueDate: '2026-11-14' } });
    first.op({ type: 'card.update', id: cleared!.id, patch: { dueDate: '2026-12-01' } });
    first.op({ type: 'card.update', id: cleared!.id, patch: { dueDate: null } });
    await first.next('op', (msg) => msg.seq === 3);
    await first.close();

    // With nobody connected the room is dropped, so this reads back from the database.
    const second = guest.open();
    const init = await second.next('init');
    expect(init.seq).toBe(3);
    expect(init.board.cards[kept!.id]!.dueDate).toBe('2026-11-14');
    expect(init.board.cards[cleared!.id]!.dueDate).toBeNull();
    expect(init.activity.at(0)!.summary).toBe(`changed the due date of “${kept!.title}”`);
    await second.close();
  });

  it('rejects a date that does not exist', async () => {
    const guest = await new Person(server).asGuest();
    const socket = guest.open();
    const { board } = await socket.next('init');
    const card = Object.values(board.cards)[0]!;
    const cid = socket.op({ type: 'card.update', id: card.id, patch: { dueDate: '2026-02-30' } });
    const reply = await socket.next('reject', (msg) => msg.cid === cid);
    expect(reply.cid).toBe(cid);
    await socket.close();
  });
});
