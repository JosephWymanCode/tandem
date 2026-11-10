import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword, RateLimiter, readCookie, verifyPassword } from '../src/auth';
import { Person, startServer, type Server } from './helpers';

let server: Server;
beforeEach(async () => {
  server = await startServer();
});
afterEach(async () => {
  await server.app.close();
});

describe('accounts', () => {
  it('signs up, stays signed in, logs out and logs back in', async () => {
    const person = new Person(server);
    const signup = await person.request('POST', '/api/auth/signup', {
      email: 'Ada@Example.com',
      name: 'Ada',
      password: 'correct horse',
    });
    expect(signup.status).toBe(200);
    expect(signup.body.user).toMatchObject({ email: 'ada@example.com', name: 'Ada', isGuest: false });
    expect(signup.body.user.passwordHash).toBeUndefined();
    expect(person.cookie).toMatch(/^sid=/);

    expect((await person.request('GET', '/api/me')).body.user.name).toBe('Ada');

    await person.request('POST', '/api/auth/logout');
    expect((await person.request('GET', '/api/me')).status).toBe(401);

    const login = await person.request('POST', '/api/auth/login', {
      email: 'ada@example.com',
      password: 'correct horse',
    });
    expect(login.status).toBe(200);
    expect((await person.request('GET', '/api/me')).status).toBe(200);
  });

  it('refuses a duplicate email, a weak password and a wrong password', async () => {
    const person = new Person(server);
    const details = { email: 'ada@example.com', name: 'Ada', password: 'correct horse' };
    await person.request('POST', '/api/auth/signup', details);

    expect((await new Person(server).request('POST', '/api/auth/signup', details)).status).toBe(409);
    expect(
      (await new Person(server).request('POST', '/api/auth/signup', { ...details, email: 'b@example.com', password: 'short' }))
        .status,
    ).toBe(400);
    expect(
      (await new Person(server).request('POST', '/api/auth/login', { email: details.email, password: 'wrong password' }))
        .status,
    ).toBe(401);
    expect(
      (await new Person(server).request('POST', '/api/auth/login', { email: 'nobody@example.com', password: 'whatever1' }))
        .status,
    ).toBe(401);
  });

  it('gives a guest a starter board', async () => {
    const guest = await new Person(server).asGuest();
    const { body } = await guest.request('GET', '/api/boards');
    expect(body.boards).toHaveLength(1);
    expect(body.boards[0]).toMatchObject({ id: guest.boardId, role: 'owner', memberCount: 1 });
    expect(body.boards[0].cardCount).toBeGreaterThan(5);
  });
});

describe('boards', () => {
  it('requires a session', async () => {
    expect((await new Person(server).request('GET', '/api/boards')).status).toBe(401);
    expect((await new Person(server).request('POST', '/api/boards', { title: 'X' })).status).toBe(401);
  });

  it('creates boards and lets only the owner delete them', async () => {
    const owner = await new Person(server).asGuest();
    const other = await new Person(server).asGuest();
    const created = await owner.request('POST', '/api/boards', { title: 'Roadmap' });
    const boardId = created.body.boardId as string;
    expect((await owner.request('GET', '/api/boards')).body.boards).toHaveLength(2);

    // A stranger cannot tell the board exists.
    expect((await other.request('DELETE', `/api/boards/${boardId}`)).status).toBe(404);

    const invite = (await owner.open(boardId).next('init')).inviteToken;
    await other.request('POST', `/api/invites/${invite}/join`);
    expect((await other.request('DELETE', `/api/boards/${boardId}`)).status).toBe(403);

    expect((await owner.request('DELETE', `/api/boards/${boardId}`)).status).toBe(200);
    expect((await owner.request('GET', '/api/boards')).body.boards).toHaveLength(1);
  });

  it('lets someone join through an invite link', async () => {
    const owner = await new Person(server).asGuest();
    const friend = await new Person(server).asGuest();
    const socket = owner.open();
    const { inviteToken } = await socket.next('init');

    expect((await friend.request('GET', `/api/invites/${inviteToken}`)).body.title).toBe('Website relaunch');
    expect((await friend.request('GET', '/api/invites/not-a-token')).status).toBe(404);

    const joined = await friend.request('POST', `/api/invites/${inviteToken}/join`);
    expect(joined.body.boardId).toBe(owner.boardId);

    // People already on the board are told about the new member.
    const members = await socket.next('members');
    expect(members.members.map((member) => member.id)).toContain(friend.userId);
    await socket.close();
  });
});

describe('auth helpers', () => {
  it('hashes passwords with a unique salt and verifies them', async () => {
    const first = await hashPassword('correct horse');
    const second = await hashPassword('correct horse');
    expect(first).not.toBe(second);
    expect(await verifyPassword('correct horse', first)).toBe(true);
    expect(await verifyPassword('wrong', first)).toBe(false);
    expect(await verifyPassword('correct horse', 'garbage')).toBe(false);
  });

  it('reads a cookie from a raw header', () => {
    expect(readCookie('theme=dark; sid=abc123; x=1', 'sid')).toBe('abc123');
    expect(readCookie('theme=dark', 'sid')).toBeNull();
    expect(readCookie(undefined, 'sid')).toBeNull();
  });

  it('rate limits within a window and recovers after it', () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('a', 10)).toBe(true);
    expect(limiter.allow('a', 20)).toBe(false);
    expect(limiter.allow('b', 20)).toBe(true);
    expect(limiter.allow('a', 1500)).toBe(true);
  });
});
