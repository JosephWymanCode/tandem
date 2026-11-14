import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { Person, startServer, type Server } from './helpers';

let server: Server;
beforeEach(async () => {
  server = await startServer();
});
afterEach(async () => {
  await server.app.close();
});

const details = { name: 'Ada Lovelace', email: 'Ada@Example.com', password: 'correct horse' };
const EMAIL_TAKEN = 'An account with this email already exists. Log in instead.';

describe('upgrading a guest to an account', () => {
  it('keeps the same user, session and boards, and allows logging in afterwards', async () => {
    const guest = await new Person(server).asGuest();
    await guest.request('POST', '/api/boards', { title: 'Roadmap' });
    const before = (await guest.request('GET', '/api/boards')).body.boards;
    expect(before).toHaveLength(2);
    const cookie = guest.cookie;

    const upgraded = await guest.request('POST', '/api/auth/upgrade', details);
    expect(upgraded.status).toBe(200);
    expect(upgraded.body.user).toMatchObject({
      id: guest.userId,
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      isGuest: false,
    });
    expect(upgraded.body.user.passwordHash).toBeUndefined();

    // Still signed in, on a fresh session: the guest's token no longer works.
    expect(guest.cookie).toMatch(/^sid=/);
    expect(guest.cookie).not.toBe(cookie);
    const stale = new Person(server);
    stale.cookie = cookie;
    expect((await stale.request('GET', '/api/me')).status).toBe(401);
    expect((await guest.request('GET', '/api/me')).body.user).toMatchObject({ id: guest.userId, isGuest: false });
    expect((await guest.request('GET', '/api/boards')).body.boards).toEqual(before);

    await guest.request('POST', '/api/auth/logout');
    expect((await guest.request('GET', '/api/me')).status).toBe(401);

    const login = await guest.request('POST', '/api/auth/login', { email: 'ada@example.com', password: details.password });
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({ id: guest.userId, name: 'Ada Lovelace', isGuest: false });
    expect((await guest.request('GET', '/api/boards')).body.boards).toEqual(before);
    expect(
      (await new Person(server).request('POST', '/api/auth/login', { email: 'ada@example.com', password: 'wrong password' }))
        .status,
    ).toBe(401);
  });

  it('keeps card assignments, activity history and comments', async () => {
    const guest = await new Person(server).asGuest();
    const guestName = (await guest.request('GET', '/api/me')).body.user.name as string;
    const socket = guest.open();
    const init = await socket.next('init');
    const cardId = Object.keys(init.board.cards)[0]!;
    const cid = socket.op({ type: 'card.update', id: cardId, patch: { assigneeId: guest.userId } });
    await socket.next('op', (msg) => msg.cid === cid);
    await socket.close();
    const commentsPath = `/api/boards/${guest.boardId}/cards/${cardId}/comments`;
    expect((await guest.request('POST', commentsPath, { body: 'Posted as a guest' })).status).toBe(200);

    expect((await guest.request('POST', '/api/auth/upgrade', details)).status).toBe(200);

    const reopened = guest.open();
    const after = await reopened.next('init');
    expect(after.board.cards[cardId]!.assigneeId).toBe(guest.userId);
    expect(after.members).toEqual([expect.objectContaining({ id: guest.userId, name: 'Ada Lovelace', role: 'owner' })]);
    expect(after.activity.some((entry) => entry.by === guest.userId)).toBe(true);
    await reopened.close();

    // A comment keeps the name it was posted under but still belongs to the same person.
    const comments = (await guest.request('GET', commentsPath)).body.comments;
    expect(comments).toEqual([expect.objectContaining({ authorId: guest.userId, authorName: guestName })]);
    expect((await guest.request('DELETE', `/api/boards/${guest.boardId}/comments/${comments[0].id}`)).status).toBe(200);
  });

  it('requires a signed-in guest', async () => {
    expect((await new Person(server).request('POST', '/api/auth/upgrade', details)).status).toBe(401);

    const member = new Person(server);
    await member.request('POST', '/api/auth/signup', { ...details, email: 'full@example.com' });
    const refused = await member.request('POST', '/api/auth/upgrade', details);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe('You already have an account.');
    expect((await member.request('GET', '/api/me')).body.user.email).toBe('full@example.com');
  });

  it('cannot be done twice from the same session', async () => {
    const guest = await new Person(server).asGuest();
    expect((await guest.request('POST', '/api/auth/upgrade', details)).status).toBe(200);
    const again = await guest.request('POST', '/api/auth/upgrade', { ...details, email: 'other@example.com', name: 'Other' });
    expect(again.status).toBe(400);
    expect((await guest.request('GET', '/api/me')).body.user).toMatchObject({
      email: 'ada@example.com',
      name: 'Ada Lovelace',
    });
  });

  it('validates the details like sign-up does', async () => {
    const guest = await new Person(server).asGuest();
    for (const bad of [
      { ...details, password: 'short' },
      { ...details, email: 'not-an-email' },
      { ...details, name: '   ' },
      { email: details.email },
    ]) {
      const response = await guest.request('POST', '/api/auth/upgrade', bad);
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Enter a name, a valid email and a password of at least 8 characters.');
    }
    expect((await guest.request('GET', '/api/me')).body.user.isGuest).toBe(true);
  });

  it('refuses an email that already has an account, with the sign-up wording', async () => {
    expect((await new Person(server).request('POST', '/api/auth/signup', details)).status).toBe(200);

    const guest = await new Person(server).asGuest();
    const response = await guest.request('POST', '/api/auth/upgrade', { ...details, email: 'ADA@example.com' });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe(EMAIL_TAKEN);
    expect((await guest.request('GET', '/api/me')).body.user.isGuest).toBe(true);
  });

  it('lets only one of two guests racing for the same email win', async () => {
    const first = await new Person(server).asGuest();
    const second = await new Person(server).asGuest();
    const results = await Promise.all([
      first.request('POST', '/api/auth/upgrade', details),
      second.request('POST', '/api/auth/upgrade', { ...details, name: 'Second' }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(results.find((result) => result.status === 409)!.body.error).toBe(EMAIL_TAKEN);
    const guests = await Promise.all([first.request('GET', '/api/me'), second.request('GET', '/api/me')]);
    expect(guests.map((me) => me.body.user.isGuest).sort()).toEqual([false, true]);
  });

  it('lets only one of two simultaneous upgrades of the same guest win', async () => {
    const guest = await new Person(server).asGuest();
    const results = await Promise.all([
      guest.request('POST', '/api/auth/upgrade', details),
      guest.request('POST', '/api/auth/upgrade', { ...details, email: 'second@example.com', name: 'Second' }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 400]);
    const winner = results.find((result) => result.status === 200)!;
    expect((await guest.request('GET', '/api/me')).body.user).toEqual(winner.body.user);
  });

  it('is rate limited like the other auth routes', async () => {
    const app = await buildApp({ dbPath: ':memory:', authRateLimit: 2 });
    await app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const { port } = app.server.address() as AddressInfo;
      const limitedServer = { app, http: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}` };
      const guest = await new Person(limitedServer).asGuest();
      expect((await guest.request('POST', '/api/auth/upgrade', { ...details, password: 'short' })).status).toBe(400);
      expect((await guest.request('POST', '/api/auth/upgrade', details)).status).toBe(429);
      expect((await guest.request('GET', '/api/me')).body.user.isGuest).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('shows the new name to people on the same board, in the member list and on the live connection', async () => {
    const owner = await new Person(server).asGuest();
    const friend = await new Person(server).asGuest();
    const ownerSocket = owner.open();
    const { inviteToken } = await ownerSocket.next('init');
    await friend.request('POST', `/api/invites/${inviteToken}/join`);
    const friendSocket = friend.open(owner.boardId);
    const friendInit = await friendSocket.next('init');
    const joined = await ownerSocket.next('peer.join');

    expect((await friend.request('POST', '/api/auth/upgrade', details)).status).toBe(200);

    const members = await ownerSocket.next('members', (msg) =>
      msg.members.some((member) => member.id === friend.userId && member.name === 'Ada Lovelace'),
    );
    expect(members.members).toHaveLength(2);
    // The friend's own open connection is told too.
    await friendSocket.next('members', (msg) => msg.members.some((member) => member.name === 'Ada Lovelace'));

    // The already-open connection carries the new name: same connection id, new label.
    const renamed = await ownerSocket.next('peer.join', (msg) => msg.peer.name === 'Ada Lovelace');
    expect(renamed.peer.connId).toBe(joined.peer.connId);
    expect(renamed.peer.userId).toBe(friend.userId);

    // Changes made over that connection are credited to the new name.
    const cardId = Object.keys(friendInit.board.cards)[0]!;
    const cid = friendSocket.op({ type: 'card.update', id: cardId, patch: { title: 'Renamed' } });
    expect((await ownerSocket.next('op', (msg) => msg.cid === cid)).byName).toBe('Ada Lovelace');

    await ownerSocket.close();
    await friendSocket.close();
  });
});
