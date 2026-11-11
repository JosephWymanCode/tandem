import { existsSync } from 'node:fs';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { CLOSE, LIMITS, initialKeys } from '@tandem/shared';
import { randomUUID } from 'node:crypto';
import { RateLimiter, guestName, hashPassword, readCookie, verifyPassword } from './auth';
import { openDb } from './db';
import { Repo, type User } from './repo';
import { RoomManager } from './rooms';
import { createStarterBoard } from './seed';

export interface AppOptions {
  dbPath: string;
  /** Folder holding the built frontend. Skipped if it does not exist (as in development). */
  clientDist?: string;
  production?: boolean;
  /** Sign-up and log-in attempts allowed per address per minute. */
  authRateLimit?: number;
  logger?: boolean;
}

const SESSION_COOKIE = 'sid';
const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

const signupBody = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  name: z.string().trim().min(1).max(40),
  password: z.string().min(8).max(200),
});
const loginBody = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().max(200),
});
const boardBody = z.object({ title: z.string().trim().min(1).max(LIMITS.titleLength) });

export async function buildApp(options: AppOptions) {
  const db = openDb(options.dbPath);
  const repo = new Repo(db);
  const rooms = new RoomManager(repo);
  const authLimiter = new RateLimiter(options.authRateLimit ?? 30, 60_000);

  const app = Fastify({ logger: options.logger ?? false, trustProxy: true, bodyLimit: 16 * 1024 });
  await app.register(cookie);

  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; frame-ancestors 'none'",
    );
  });

  const currentUser = (request: FastifyRequest): User | null => {
    const token = request.cookies[SESSION_COOKIE];
    return token ? repo.findUserBySession(token) : null;
  };

  const requireUser = (request: FastifyRequest, reply: FastifyReply): User | null => {
    const user = currentUser(request);
    if (!user) reply.code(401).send({ error: 'Sign in to continue' });
    return user;
  };

  const startSession = (reply: FastifyReply, userId: string) => {
    reply.setCookie(SESSION_COOKIE, repo.createSession(userId), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: options.production ?? false,
      maxAge: SESSION_MAX_AGE_S,
    });
  };

  const limited = (request: FastifyRequest, reply: FastifyReply): boolean => {
    if (authLimiter.allow(request.ip)) return false;
    reply.code(429).send({ error: 'Too many attempts. Wait a minute and try again.' });
    return true;
  };

  // ---- Auth ---------------------------------------------------------------

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/me', async (request, reply) => {
    const user = requireUser(request, reply);
    if (user) return { user };
  });

  app.post('/api/auth/signup', async (request, reply) => {
    if (limited(request, reply)) return;
    const body = signupBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Enter a name, a valid email and a password of at least 8 characters.' });
    }
    if (repo.findUserByEmail(body.data.email)) {
      return reply.code(409).send({ error: 'An account with this email already exists. Log in instead.' });
    }
    const user = repo.createUser({
      email: body.data.email,
      name: body.data.name,
      passwordHash: await hashPassword(body.data.password),
      isGuest: false,
    });
    const boardId = createStarterBoard(repo, user.id);
    startSession(reply, user.id);
    return { user, boardId };
  });

  app.post('/api/auth/login', async (request, reply) => {
    if (limited(request, reply)) return;
    const body = loginBody.safeParse(request.body);
    const found = body.success ? repo.findUserByEmail(body.data.email) : null;
    const valid =
      body.success && found?.passwordHash ? await verifyPassword(body.data.password, found.passwordHash) : false;
    if (!found || !valid) return reply.code(401).send({ error: 'Email or password is incorrect.' });
    startSession(reply, found.id);
    const user: User = { id: found.id, email: found.email, name: found.name, color: found.color, isGuest: false };
    return { user };
  });

  app.post('/api/auth/guest', async (request, reply) => {
    if (limited(request, reply)) return;
    const user = repo.createUser({ email: null, name: guestName(), passwordHash: null, isGuest: true });
    const boardId = createStarterBoard(repo, user.id);
    startSession(reply, user.id);
    return { user, boardId };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) repo.deleteSession(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // ---- Boards -------------------------------------------------------------

  app.get('/api/boards', async (request, reply) => {
    const user = requireUser(request, reply);
    if (user) return { boards: repo.listBoards(user.id) };
  });

  app.post('/api/boards', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const body = boardBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Give the board a name.' });
    const keys = initialKeys(3);
    const columns = ['To do', 'In progress', 'Done'].map((title, index) => ({
      id: randomUUID(),
      title,
      pos: keys[index]!,
    }));
    return { boardId: repo.createBoard(user.id, body.data.title, { columns, cards: [] }) };
  });

  app.delete<{ Params: { id: string } }>('/api/boards/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const role = repo.getRole(request.params.id, user.id);
    if (role === null) return reply.code(404).send({ error: 'Board not found.' });
    if (role !== 'owner') return reply.code(403).send({ error: 'Only the owner can delete this board.' });
    repo.deleteBoard(request.params.id);
    rooms.closeBoard(request.params.id);
    return { ok: true };
  });

  // ---- Invites ------------------------------------------------------------

  app.get<{ Params: { token: string } }>('/api/invites/:token', async (request, reply) => {
    const board = repo.findBoardByInvite(request.params.token);
    if (!board) return reply.code(404).send({ error: 'This invite link is not valid any more.' });
    return { title: board.title };
  });

  app.post<{ Params: { token: string } }>('/api/invites/:token/join', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const board = repo.findBoardByInvite(request.params.token);
    if (!board) return reply.code(404).send({ error: 'This invite link is not valid any more.' });
    if (repo.addMember(board.id, user.id)) rooms.membersChanged(board.id);
    return { boardId: board.id };
  });

  // ---- Live boards --------------------------------------------------------

  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });

  app.server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    // Browsers attach cookies to cross-site WebSocket requests, so the Origin
    // header is the only thing stopping another site from opening a socket as
    // the visitor.
    const origin = request.headers.origin;
    if (origin) {
      let sameHost: boolean;
      try {
        sameHost = new URL(origin).host === request.headers.host;
      } catch {
        sameHost = false;
      }
      if (!sameHost) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      // Accept first, then close with a code: a browser cannot read the
      // status of a refused upgrade, but it can read a close code.
      const token = readCookie(request.headers.cookie, SESSION_COOKIE);
      const user = token ? repo.findUserBySession(token) : null;
      if (!user) {
        ws.close(CLOSE.unauthenticated, 'Sign in to continue');
        return;
      }
      const boardId = url.searchParams.get('board') ?? '';
      if (repo.getRole(boardId, user.id) === null) {
        ws.close(CLOSE.forbidden, 'You are not on this board');
        return;
      }
      const sinceParam = url.searchParams.get('since');
      const since = sinceParam !== null && /^\d{1,12}$/.test(sinceParam) ? Number(sinceParam) : null;
      rooms.connect(ws, user, boardId, since);
    });
  });

  app.addHook('onClose', async () => {
    rooms.stop();
    wss.close();
    db.close();
  });

  // ---- Frontend -----------------------------------------------------------

  const clientDist = options.clientDist;
  const hasClient = clientDist !== undefined && existsSync(clientDist);
  if (hasClient) {
    await app.register(fastifyStatic, {
      root: clientDist,
      setHeaders(response, path) {
        if (path.includes('assets')) response.header('Cache-Control', 'public, max-age=31536000, immutable');
      },
    });
  }

  app.setNotFoundHandler((request, reply) => {
    // Any non-API page request gets the app shell; the client router takes it from there.
    if (hasClient && request.method === 'GET' && !request.url.startsWith('/api')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not found' });
  });

  return app;
}
