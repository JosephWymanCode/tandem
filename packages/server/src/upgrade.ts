import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { hashPassword } from './auth';
import type { Repo, User } from './repo';
import type { RoomManager } from './rooms';

export interface UpgradeDeps {
  repo: Repo;
  rooms: RoomManager;
  /** The sign-up body schema, so an upgraded account obeys the same rules as a new one. */
  body: z.ZodType<{ email: string; name: string; password: string }>;
  currentUser: (request: FastifyRequest) => User | null;
  /** Applies the shared auth rate limit; returns true once it has answered with 429. */
  limited: (request: FastifyRequest, reply: FastifyReply) => boolean;
  /** Issues a new session cookie for the user. */
  startSession: (reply: FastifyReply, userId: string) => void;
}

// Same wording as sign-up in app.ts.
const EMAIL_TAKEN = 'An account with this email already exists. Log in instead.';
const INVALID = 'Enter a name, a valid email and a password of at least 8 characters.';
const ALREADY_ACCOUNT = 'You already have an account.';

/**
 * Turns a guest session into a full account. The user row is updated in
 * place, so the user id, and with it every board, membership, card assignment,
 * comment and activity entry, stays as it was.
 */
export function registerUpgrade(app: FastifyInstance, deps: UpgradeDeps): void {
  const { repo, rooms } = deps;

  app.post('/api/auth/upgrade', async (request, reply) => {
    if (deps.limited(request, reply)) return;
    const current = deps.currentUser(request);
    if (!current) return reply.code(401).send({ error: 'Sign in to continue' });
    if (!current.isGuest) return reply.code(400).send({ error: ALREADY_ACCOUNT });

    const body = deps.body.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: INVALID });
    if (repo.findUserByEmail(body.data.email)) return reply.code(409).send({ error: EMAIL_TAKEN });

    // Hashing takes a while, so the email or the guest may have been claimed
    // by another request in the meantime; the update itself decides.
    const passwordHash = await hashPassword(body.data.password);
    const result = repo.upgradeGuest(current.id, { email: body.data.email, name: body.data.name, passwordHash });
    if (result === 'email-taken') return reply.code(409).send({ error: EMAIL_TAKEN });
    if (result === 'not-guest') return reply.code(400).send({ error: ALREADY_ACCOUNT });

    // Every guest session ended with the upgrade, so a copy of the old cookie
    // cannot reach the new account; this browser gets a fresh one.
    deps.startSession(reply, result.id);
    // The display name changed: refresh it on every open board this person is on or connected to.
    rooms.userChanged(result);
    return { user: result };
  });
}
