import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLOSE, applyOp, cardsInColumn, keyBetween, sortedColumns, type BoardState } from '@tandem/shared';
import { Person, startServer, type Server } from './helpers';

let server: Server;
beforeEach(async () => {
  server = await startServer();
});
afterEach(async () => {
  await server.app.close();
});

/** Two people on the same board, both connected. */
async function pair() {
  const ada = await new Person(server).asGuest();
  const ben = await new Person(server).asGuest();
  const adaSocket = ada.open();
  const init = await adaSocket.next('init');
  await ben.request('POST', `/api/invites/${init.inviteToken}/join`);
  const benSocket = ben.open(ada.boardId);
  await benSocket.next('init');
  return { ada, ben, adaSocket, benSocket, board: init.board };
}

describe('connecting', () => {
  it('sends the whole board on first connect', async () => {
    const guest = await new Person(server).asGuest();
    const socket = guest.open();
    const init = await socket.next('init');
    expect(init.seq).toBe(0);
    expect(sortedColumns(init.board).map((column) => column.title)).toEqual([
      'Start here',
      'To do',
      'In progress',
      'Done',
    ]);
    expect(init.you.userId).toBe(guest.userId);
    expect(init.members).toHaveLength(1);
    expect(init.peers).toEqual([]);
    await socket.close();
  });

  it('turns away visitors who are signed out or not on the board', async () => {
    const owner = await new Person(server).asGuest();
    const stranger = await new Person(server).asGuest();
    expect(await new Person(server).open(owner.boardId).closed).toBe(CLOSE.unauthenticated);
    expect(await stranger.open(owner.boardId).closed).toBe(CLOSE.forbidden);
    expect(await stranger.open('no-such-board').closed).toBe(CLOSE.forbidden);
  });

  it('refuses sockets opened from another website', async () => {
    const owner = await new Person(server).asGuest();
    const socket = owner.open(owner.boardId, { origin: 'https://evil.example' });
    expect(await socket.closed).toBe(-1);
    expect(socket.received).toEqual([]);
  });
});

describe('collaboration', () => {
  it('delivers a change to everyone, numbered and attributed', async () => {
    const { ada, adaSocket, benSocket, board } = await pair();
    const column = sortedColumns(board)[0]!;
    const cid = adaSocket.op({ type: 'card.add', id: 'new-card', columnId: column.id, title: 'Hello', pos: 'z' });

    const seenByAda = await adaSocket.next('op');
    const seenByBen = await benSocket.next('op');
    expect(seenByAda).toEqual(seenByBen);
    expect(seenByBen).toMatchObject({
      seq: 1,
      cid,
      by: ada.userId,
      summary: 'added “Hello” to “Start here”',
    });
    await Promise.all([adaSocket.close(), benSocket.close()]);
  });

  it('keeps both clients identical through simultaneous edits', async () => {
    const { adaSocket, benSocket, board } = await pair();
    const [first, second] = sortedColumns(board);
    const card = cardsInColumn(board, first!.id)[0]!;

    // Both act at once, on the same card and on the same gap between cards.
    adaSocket.op({ type: 'card.update', id: card.id, patch: { title: 'Ada’s title' } });
    benSocket.op({ type: 'card.update', id: card.id, patch: { description: 'Ben’s notes' } });
    adaSocket.op({ type: 'card.move', id: card.id, columnId: second!.id, pos: keyBetween(null, null) });
    benSocket.op({ type: 'card.add', id: 'ben-card', columnId: second!.id, title: 'Ben’s card', pos: keyBetween(null, null) });
    adaSocket.op({ type: 'column.rename', id: second!.id, title: 'Next up' });

    await adaSocket.next('op', (msg) => msg.seq === 5);
    await benSocket.next('op', (msg) => msg.seq === 5);

    const replay = (socket: typeof adaSocket) => {
      let state: BoardState = board;
      for (const msg of socket.received) {
        if (msg.t !== 'op') continue;
        const result = applyOp(state, msg.op);
        if (!result.ok) throw new Error(result.error);
        state = result.state;
      }
      return state;
    };
    const adaBoard = replay(adaSocket);
    expect(adaBoard).toEqual(replay(benSocket));
    expect(adaBoard.cards[card.id]).toMatchObject({
      title: 'Ada’s title',
      description: 'Ben’s notes',
      columnId: second!.id,
    });
    expect(adaBoard.columns[second!.id]!.title).toBe('Next up');
    await Promise.all([adaSocket.close(), benSocket.close()]);
  });

  it('rejects a change that lost a race, only to the person who made it', async () => {
    const { adaSocket, benSocket, board } = await pair();
    const card = Object.values(board.cards)[0]!;
    adaSocket.op({ type: 'card.delete', id: card.id });
    await benSocket.next('op');
    const cid = benSocket.op({ type: 'card.update', id: card.id, patch: { title: 'Too late' } });

    const reject = await benSocket.next('reject');
    expect(reject).toMatchObject({ cid, reason: 'Card no longer exists' });
    expect(adaSocket.received.filter((msg) => msg.t === 'reject')).toEqual([]);
    await Promise.all([adaSocket.close(), benSocket.close()]);
  });

  it('rejects malformed changes and assigning a stranger', async () => {
    const { adaSocket, benSocket, board } = await pair();
    const card = Object.values(board.cards)[0]!;
    const stranger = await new Person(server).asGuest();

    adaSocket.send({ t: 'op', cid: 'bad-1', op: { type: 'card.update', id: card.id, patch: { title: '' } } });
    expect((await adaSocket.next('reject', (msg) => msg.cid === 'bad-1')).reason).toBe('Invalid change');

    const cid = adaSocket.op({ type: 'card.update', id: card.id, patch: { assigneeId: stranger.userId } });
    expect((await adaSocket.next('reject', (msg) => msg.cid === cid)).reason).toBe('That person is not on this board');

    adaSocket.send({ nonsense: true });
    adaSocket.ws.send('not json');
    adaSocket.send({ t: 'ping' });
    await adaSocket.next('pong');
    expect(benSocket.received.filter((msg) => msg.t === 'op')).toEqual([]);
    await Promise.all([adaSocket.close(), benSocket.close()]);
  });

  it('shares cursors and who is editing, and announces arrivals and departures', async () => {
    const { ada, ben, adaSocket, benSocket } = await pair();
    const join = await adaSocket.next('peer.join');
    expect(join.peer).toMatchObject({ userId: ben.userId, cursor: null, editing: null });

    adaSocket.send({ t: 'presence', cursor: { x: 120, y: 80 }, editing: 'some-card' });
    const presence = await benSocket.next('presence');
    expect(presence).toMatchObject({ cursor: { x: 120, y: 80 }, editing: 'some-card' });

    // Someone arriving later sees the current cursor straight away.
    const late = ben.open(ada.boardId);
    const init = await late.next('init');
    expect(init.peers.find((peer) => peer.userId === ada.userId)).toMatchObject({
      cursor: { x: 120, y: 80 },
      editing: 'some-card',
    });

    await adaSocket.close();
    const leave = await benSocket.next('peer.leave');
    expect(leave.connId).toBe(presence.connId);
    await Promise.all([benSocket.close(), late.close()]);
  });

  it('disconnects a client that floods the server', async () => {
    const guest = await new Person(server).asGuest();
    const socket = guest.open();
    await socket.next('init');
    for (let i = 0; i < 150; i++) socket.send({ t: 'ping' });
    expect(await socket.closed).toBe(CLOSE.rateLimited);
  });
});

describe('reconnecting', () => {
  it('sends only the missed changes to a client that was briefly away', async () => {
    const guest = await new Person(server).asGuest();
    const first = guest.open();
    const { board } = await first.next('init');
    const column = sortedColumns(board)[0]!;
    first.op({ type: 'column.rename', id: column.id, title: 'One' });
    first.op({ type: 'column.rename', id: column.id, title: 'Two' });
    first.op({ type: 'column.rename', id: column.id, title: 'Three' });
    await first.next('op', (msg) => msg.seq === 3);

    const second = guest.open(guest.boardId, { since: 1 });
    const catchup = await second.next('catchup');
    expect(catchup.ops.map((op) => op.seq)).toEqual([2, 3]);
    expect(second.received.some((msg) => msg.t === 'init')).toBe(false);

    const upToDate = guest.open(guest.boardId, { since: 3 });
    expect((await upToDate.next('catchup')).ops).toEqual([]);

    // A client claiming to be ahead of the server (the database was reset) gets a full snapshot.
    const ahead = guest.open(guest.boardId, { since: 99 });
    expect((await ahead.next('init')).seq).toBe(3);
    await Promise.all([first.close(), second.close(), upToDate.close(), ahead.close()]);
  });

  it('saves every change, so the board survives everyone leaving', async () => {
    const guest = await new Person(server).asGuest();
    const first = guest.open();
    const { board } = await first.next('init');
    const [from, to] = sortedColumns(board);
    const card = cardsInColumn(board, from!.id)[0]!;

    first.op({ type: 'card.move', id: card.id, columnId: to!.id, pos: 'zz' });
    first.op({ type: 'card.update', id: card.id, patch: { labels: ['red', 'teal'], assigneeId: guest.userId } });
    first.op({ type: 'column.add', id: 'col-new', title: 'Later', pos: 'zz' });
    first.op({ type: 'card.add', id: 'card-new', columnId: 'col-new', title: 'Parked', pos: 'V' });
    first.op({ type: 'column.delete', id: from!.id });
    first.op({ type: 'board.rename', title: 'Renamed board' });
    await first.next('op', (msg) => msg.seq === 6);
    await first.close();

    // With nobody connected the room is dropped, so this reads back from the database.
    const second = guest.open();
    const init = await second.next('init');
    expect(init.seq).toBe(6);
    expect(init.board.title).toBe('Renamed board');
    expect(init.board.columns[from!.id]).toBeUndefined();
    expect(Object.values(init.board.cards).every((c) => c.columnId !== from!.id)).toBe(true);
    expect(init.board.cards[card.id]).toMatchObject({
      columnId: to!.id,
      pos: 'zz',
      labels: ['red', 'teal'],
      assigneeId: guest.userId,
    });
    expect(init.board.cards['card-new']).toMatchObject({ columnId: 'col-new', title: 'Parked' });
    expect(init.activity.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(init.activity.at(-1)!.summary).toBe('renamed the board to “Renamed board”');
    await second.close();
  });

  it('closes open sockets when the board is deleted', async () => {
    const guest = await new Person(server).asGuest();
    const socket = guest.open();
    await socket.next('init');
    await guest.request('DELETE', `/api/boards/${guest.boardId}`);
    expect(await socket.closed).toBe(CLOSE.notFound);
  });
});
