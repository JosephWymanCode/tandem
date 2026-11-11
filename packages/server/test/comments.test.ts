import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cardsInColumn, sortedColumns, type BoardState } from '@tandem/shared';
import { openDb } from '../src/db';
import { Repo } from '../src/repo';
import { createStarterBoard } from '../src/seed';
import { Person, startServer, type Server, type Socket } from './helpers';

let server: Server;
let sockets: Socket[] = [];
beforeEach(async () => {
  server = await startServer();
});
afterEach(async () => {
  await Promise.all(sockets.map((socket) => socket.close()));
  sockets = [];
  await server.app.close();
});

/** Opens a socket that is closed again after the test. */
function connect(person: Person, ...args: Parameters<Person['open']>) {
  const socket = person.open(...args);
  sockets.push(socket);
  return socket;
}

const firstCard = (board: BoardState) => cardsInColumn(board, sortedColumns(board)[0]!.id)[0]!;
const commentsPath = (boardId: string, cardId: string) => `/api/boards/${boardId}/cards/${cardId}/comments`;

/** Ada owns a board, Ben has joined it, and both have it open. */
async function pair() {
  const ada = await new Person(server).asGuest();
  const ben = await new Person(server).asGuest();
  const adaSocket = connect(ada);
  const init = await adaSocket.next('init');
  await ben.request('POST', `/api/invites/${init.inviteToken}/join`);
  const benSocket = connect(ben, ada.boardId);
  await benSocket.next('init');
  const card = firstCard(init.board);
  return { ada, ben, adaSocket, benSocket, board: init.board, card, path: commentsPath(ada.boardId, card.id) };
}

describe('comments', () => {
  it('posts and lists comments oldest first, and tells everyone on the board', async () => {
    const { ada, ben, benSocket, card, path } = await pair();

    const first = await ada.request('POST', path, { body: '  Who owns this?\nAsking for a friend.  ' });
    expect(first.status).toBe(200);
    expect(first.body.comment).toMatchObject({
      cardId: card.id,
      authorId: ada.userId,
      body: 'Who owns this?\nAsking for a friend.',
    });
    const added = await benSocket.next('comment.added');
    expect(added.comment).toEqual(first.body.comment);

    await ben.request('POST', path, { body: 'I do.' });
    const list = await ben.request('GET', path);
    expect(list.status).toBe(200);
    expect(list.body.comments.map((comment: { body: string }) => comment.body)).toEqual([
      'Who owns this?\nAsking for a friend.',
      'I do.',
    ]);
  });

  it('refuses empty, overlong and malformed comments, and cards that do not exist', async () => {
    const { ada, path } = await pair();
    expect((await ada.request('POST', path, { body: '   ' })).status).toBe(400);
    expect((await ada.request('POST', path, { body: 'x'.repeat(2001) })).status).toBe(400);
    expect((await ada.request('POST', path, { body: 42 })).status).toBe(400);
    expect((await ada.request('POST', path, {})).status).toBe(400);
    expect((await ada.request('POST', path, { body: 'x'.repeat(2000) })).status).toBe(200);
    expect((await ada.request('POST', commentsPath(ada.boardId, 'no-such-card'), { body: 'Hi' })).status).toBe(404);
  });

  it('slows down someone posting too quickly', async () => {
    const { ada, path } = await pair();
    for (let i = 0; i < 30; i++) expect((await ada.request('POST', path, { body: `#${i}` })).status).toBe(200);
    expect((await ada.request('POST', path, { body: 'One more' })).status).toBe(429);
  });

  it('keeps comments from people who are not on the board', async () => {
    const { ada, path } = await pair();
    await ada.request('POST', path, { body: 'Private' });
    const stranger = await new Person(server).asGuest();
    expect((await stranger.request('GET', path)).status).toBe(404);
    expect((await stranger.request('POST', path, { body: 'Hello' })).status).toBe(404);
    expect((await new Person(server).request('GET', path)).status).toBe(401);
    // A card on someone else's board cannot be reached through your own board either.
    const ownPath = commentsPath(stranger.boardId, path.split('/')[5]!);
    expect((await stranger.request('GET', ownPath)).body.comments).toEqual([]);
    expect((await stranger.request('POST', ownPath, { body: 'Hello' })).status).toBe(404);
  });

  it('lets the author or the board owner delete a comment, and nobody else', async () => {
    const { ada, ben, adaSocket, benSocket, card, path } = await pair();
    const bens = (await ben.request('POST', path, { body: 'Mine' })).body.comment;
    const adas = (await ada.request('POST', path, { body: 'The owner’s' })).body.comment;

    const outsider = await new Person(server).asGuest();
    expect((await outsider.request('DELETE', `/api/boards/${ada.boardId}/comments/${bens.id}`)).status).toBe(404);
    expect((await ben.request('DELETE', `/api/boards/${ada.boardId}/comments/${adas.id}`)).status).toBe(403);

    // The owner may delete anyone's comment.
    expect((await ada.request('DELETE', `/api/boards/${ada.boardId}/comments/${bens.id}`)).status).toBe(200);
    const deleted = await benSocket.next('comment.deleted');
    expect(deleted).toEqual({ t: 'comment.deleted', commentId: bens.id, cardId: card.id });
    expect((await ada.request('DELETE', `/api/boards/${ada.boardId}/comments/${bens.id}`)).status).toBe(404);

    // The author may delete their own.
    const again = (await ben.request('POST', path, { body: 'Again' })).body.comment;
    expect((await ben.request('DELETE', `/api/boards/${ada.boardId}/comments/${again.id}`)).status).toBe(200);
    await adaSocket.next('comment.deleted', (msg) => msg.commentId === again.id);

    const list = await ada.request('GET', path);
    expect(list.body.comments.map((comment: { id: string }) => comment.id)).toEqual([adas.id]);
  });

  it('sends comment counts when a connection is made, both in full and on catching up', async () => {
    const { ada, board, card, path } = await pair();
    await ada.request('POST', path, { body: 'One' });
    await ada.request('POST', path, { body: 'Two' });
    const other = cardsInColumn(board, sortedColumns(board)[0]!.id)[1]!;
    await ada.request('POST', commentsPath(ada.boardId, other.id), { body: 'Three' });

    const fresh = connect(ada);
    const init = await fresh.next('init');
    expect(init.commentCounts).toEqual({ [card.id]: 2, [other.id]: 1 });

    const returning = connect(ada, ada.boardId, { since: init.seq });
    const catchup = await returning.next('catchup');
    expect(catchup.commentCounts).toEqual({ [card.id]: 2, [other.id]: 1 });
  });

  it('removes comments with their card, with their column, and with the board', async () => {
    const { ada, adaSocket, board, card, path } = await pair();
    await ada.request('POST', path, { body: 'Goes with the card' });

    adaSocket.op({ type: 'card.delete', id: card.id });
    await adaSocket.next('op', (msg) => msg.op.type === 'card.delete');
    expect((await ada.request('GET', path)).body.comments).toEqual([]);

    const column = sortedColumns(board)[1]!;
    const inColumn = cardsInColumn(board, column.id)[0]!;
    await ada.request('POST', commentsPath(ada.boardId, inColumn.id), { body: 'Goes with the column' });
    adaSocket.op({ type: 'column.delete', id: column.id });
    await adaSocket.next('op', (msg) => msg.op.type === 'column.delete');
    expect((await ada.request('GET', commentsPath(ada.boardId, inColumn.id))).body.comments).toEqual([]);

    const remaining = cardsInColumn(board, sortedColumns(board)[2]!.id)[0]!;
    await ada.request('POST', commentsPath(ada.boardId, remaining.id), { body: 'Goes with the board' });
    const counted = await connect(ada).next('init');
    expect(counted.commentCounts).toEqual({ [remaining.id]: 1 });

  });
});

describe('comment storage', () => {
  it('removes a board’s comments when the board is deleted', () => {
    const db = openDb(':memory:');
    const repo = new Repo(db);
    const user = repo.createUser({ email: null, name: 'Ada', passwordHash: null, isGuest: true });
    const keep = createStarterBoard(repo, user.id);
    const doomed = createStarterBoard(repo, user.id);
    const cardOf = (boardId: string) => Object.keys(repo.loadBoard(boardId)!.state.cards)[0]!;
    repo.addComment(keep, cardOf(keep), user, 'Stays');
    repo.addComment(doomed, cardOf(doomed), user, 'Goes');

    repo.deleteBoard(doomed);
    const rows = db.prepare('SELECT board_id, body FROM comments').all();
    expect(rows).toEqual([{ board_id: keep, body: 'Stays' }]);
    db.close();
  });
});
