import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLOSE } from '@tandem/shared';
import { Person, startServer, type Server } from './helpers';

let server: Server;
beforeEach(async () => {
  server = await startServer();
});
afterEach(async () => {
  await server.app.close();
});

/** Ada owns a board; Ben and Cy have joined it through the invite link. */
async function team() {
  const ada = await new Person(server).asGuest();
  const ben = await new Person(server).asGuest();
  const cy = await new Person(server).asGuest();
  const socket = ada.open();
  const init = await socket.next('init');
  await socket.close();
  for (const person of [ben, cy]) await person.request('POST', `/api/invites/${init.inviteToken}/join`);
  const cards = Object.values(init.board.cards);
  return { ada, ben, cy, boardId: ada.boardId, inviteToken: init.inviteToken, cards };
}

const remove = (by: Person, boardId: string, userId: string) =>
  by.request('DELETE', `/api/boards/${boardId}/members/${userId}`);

describe('removing people', () => {
  it('lets the owner remove someone, closing their sockets and telling everyone else', async () => {
    const { ada, ben, cy, boardId } = await team();
    const adaSocket = ada.open(boardId);
    const benSocket = ben.open(boardId);
    const benSecondTab = ben.open(boardId);
    const cySocket = cy.open(boardId);
    await Promise.all([adaSocket, benSocket, benSecondTab, cySocket].map((socket) => socket.next('init')));

    expect(await remove(ada, boardId, ben.userId)).toMatchObject({ status: 200, body: { ok: true } });
    expect(await benSocket.closed).toBe(CLOSE.forbidden);
    expect(await benSecondTab.closed).toBe(CLOSE.forbidden);

    const members = await cySocket.next('members');
    expect(members.members.map((member) => member.id)).toEqual([ada.userId, cy.userId]);
    await adaSocket.next('members');

    // They cannot come back in, and the board is gone from their list.
    expect(await ben.open(boardId).closed).toBe(CLOSE.forbidden);
    expect((await ben.request('GET', '/api/boards')).body.boards.map((b: { id: string }) => b.id)).not.toContain(
      boardId,
    );
    expect((await remove(ben, boardId, cy.userId)).status).toBe(404);
    await Promise.all([adaSocket.close(), cySocket.close()]);
  });

  it('unassigns their cards through the open board, for everyone and after reload', async () => {
    const { ada, ben, cy, boardId, cards } = await team();
    const adaSocket = ada.open(boardId);
    const cySocket = cy.open(boardId);
    await Promise.all([adaSocket.next('init'), cySocket.next('init')]);
    const [first, second, third] = cards;
    adaSocket.op({ type: 'card.update', id: first!.id, patch: { assigneeId: ben.userId } });
    adaSocket.op({ type: 'card.update', id: second!.id, patch: { assigneeId: ben.userId } });
    adaSocket.op({ type: 'card.update', id: third!.id, patch: { assigneeId: cy.userId } });
    await cySocket.next('op', (msg) => msg.seq === 3);

    await remove(ada, boardId, ben.userId);
    const unassigned = await Promise.all([
      cySocket.next('op', (msg) => msg.seq === 4),
      cySocket.next('op', (msg) => msg.seq === 5),
    ]);
    // Each change carries nothing but the assignee, and is attributed to the person who removed them.
    const clear = (id: string) => ({ type: 'card.update', id, patch: { assigneeId: null } });
    expect(unassigned.map((event) => event.op)).toEqual(
      expect.arrayContaining([clear(first!.id), clear(second!.id)]),
    );
    expect(unassigned.every((event) => event.by === ada.userId)).toBe(true);
    expect(cySocket.received.filter((msg) => msg.t === 'op')).toHaveLength(5);

    await Promise.all([adaSocket.close(), cySocket.close()]);
    const reopened = ada.open(boardId);
    const init = await reopened.next('init');
    expect(init.seq).toBe(5);
    expect(init.board.cards[first!.id]!.assigneeId).toBeNull();
    expect(init.board.cards[second!.id]!.assigneeId).toBeNull();
    expect(init.board.cards[third!.id]!.assigneeId).toBe(cy.userId);
    expect(init.activity.at(-1)!.summary).toMatch(/^changed the assignee of /);
    await reopened.close();
  });

  it('unassigns their cards in the database when nobody has the board open', async () => {
    const { ada, ben, boardId, cards } = await team();
    const setup = ada.open(boardId);
    await setup.next('init');
    setup.op({ type: 'card.update', id: cards[0]!.id, patch: { assigneeId: ben.userId } });
    await setup.next('op', (msg) => msg.seq === 1);
    await setup.close();

    expect((await remove(ada, boardId, ben.userId)).status).toBe(200);
    const reopened = ada.open(boardId);
    const init = await reopened.next('init');
    expect(init.seq).toBe(2);
    expect(init.board.cards[cards[0]!.id]!.assigneeId).toBeNull();
    expect(init.members.map((member) => member.id)).not.toContain(ben.userId);

    // A client that was away while it happened is sent the change when it catches up.
    const returning = ada.open(boardId, { since: 1 });
    const catchup = await returning.next('catchup');
    expect(catchup.ops.map((event) => event.op)).toEqual([
      { type: 'card.update', id: cards[0]!.id, patch: { assigneeId: null } },
    ]);
    await Promise.all([reopened.close(), returning.close()]);
  });

  it('lets a member leave but not remove anyone else', async () => {
    const { ada, ben, cy, boardId } = await team();
    const benSocket = ben.open(boardId);
    await benSocket.next('init');

    const refused = await remove(ben, boardId, cy.userId);
    expect(refused.status).toBe(403);
    expect((await remove(ben, boardId, ada.userId)).status).toBe(403);

    expect((await remove(ben, boardId, ben.userId)).status).toBe(200);
    expect(await benSocket.closed).toBe(CLOSE.forbidden);
    expect((await remove(ben, boardId, ben.userId)).status).toBe(404);
    expect((await ada.request('GET', '/api/boards')).body.boards[0].memberCount).toBe(2);
  });

  it('keeps the owner on the board', async () => {
    const { ada, boardId } = await team();
    const leaving = await remove(ada, boardId, ada.userId);
    expect(leaving.status).toBe(400);
    expect(leaving.body.error).toMatch(/owner cannot leave/);
    expect(await ada.request('GET', '/api/boards').then((r) => r.body.boards[0].role)).toBe('owner');
  });

  it('answers 404 for strangers, unknown boards and people not on the board', async () => {
    const { ada, ben, boardId } = await team();
    const stranger = await new Person(server).asGuest();
    expect((await remove(stranger, boardId, ben.userId)).status).toBe(404);
    expect((await remove(stranger, boardId, stranger.userId)).status).toBe(404);
    expect((await remove(ada, 'no-such-board', ben.userId)).status).toBe(404);
    expect((await remove(ada, boardId, stranger.userId)).status).toBe(404);
    expect((await new Person(server).request('DELETE', `/api/boards/${boardId}/members/${ben.userId}`)).status).toBe(
      401,
    );
  });
});

describe('resetting the invite link', () => {
  it('replaces the token for everyone connected, and only the new one works', async () => {
    const { ada, ben, boardId, inviteToken } = await team();
    const benSocket = ben.open(boardId);
    await benSocket.next('init');

    const reset = await ada.request('POST', `/api/boards/${boardId}/invite/reset`);
    expect(reset.status).toBe(200);
    const fresh = reset.body.inviteToken as string;
    expect(fresh).toMatch(/^[\w-]{16}$/);
    expect(fresh).not.toBe(inviteToken);
    expect((await benSocket.next('invite')).inviteToken).toBe(fresh);

    const newcomer = await new Person(server).asGuest();
    expect((await newcomer.request('GET', `/api/invites/${inviteToken}`)).status).toBe(404);
    expect((await newcomer.request('POST', `/api/invites/${inviteToken}/join`)).status).toBe(404);
    expect(await newcomer.request('POST', `/api/invites/${fresh}/join`)).toMatchObject({
      status: 200,
      body: { boardId },
    });

    // Someone connecting later is given the new token.
    const late = ada.open(boardId);
    expect((await late.next('init')).inviteToken).toBe(fresh);
    await Promise.all([benSocket.close(), late.close()]);
  });

  it('is for the owner only', async () => {
    const { ben, boardId } = await team();
    const stranger = await new Person(server).asGuest();
    expect((await ben.request('POST', `/api/boards/${boardId}/invite/reset`)).status).toBe(403);
    expect((await stranger.request('POST', `/api/boards/${boardId}/invite/reset`)).status).toBe(404);
  });
});
