import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Repo, User } from './repo';
import type { RoomManager } from './rooms';

interface Deps {
  repo: Repo;
  rooms: RoomManager;
  requireUser: (request: FastifyRequest, reply: FastifyReply) => User | null;
}

/**
 * Managing who is on a board: the owner can remove people and reset the
 * invite link; anyone else can leave.
 */
export function registerMemberRoutes(app: FastifyInstance, { repo, rooms, requireUser }: Deps): void {
  /** The signed-in user and their role on the board, or null once a reply has been sent. */
  const member = (request: FastifyRequest, reply: FastifyReply, boardId: string) => {
    const user = requireUser(request, reply);
    if (!user) return null;
    const role = repo.getRole(boardId, user.id);
    if (role === null) {
      // Non-members cannot tell a board they are not on from one that does not exist.
      reply.code(404).send({ error: 'Board not found.' });
      return null;
    }
    return { user, role };
  };

  app.delete<{ Params: { boardId: string; userId: string } }>(
    '/api/boards/:boardId/members/:userId',
    async (request, reply) => {
      const { boardId, userId } = request.params;
      const access = member(request, reply, boardId);
      if (!access) return;
      const leaving = userId === access.user.id;
      if (!leaving && access.role !== 'owner') {
        return reply.code(403).send({ error: 'Only the owner can remove people from this board.' });
      }
      const target = leaving ? access.role : repo.getRole(boardId, userId);
      if (target === null) return reply.code(404).send({ error: 'That person is not on this board.' });
      if (target === 'owner') {
        return reply.code(400).send({
          error: leaving
            ? 'The owner cannot leave the board. Delete the board instead.'
            : 'The owner cannot be removed from the board.',
        });
      }
      if (repo.removeMember(boardId, userId)) rooms.memberRemoved(boardId, userId, access.user);
      return { ok: true };
    },
  );

  app.post<{ Params: { boardId: string } }>('/api/boards/:boardId/invite/reset', async (request, reply) => {
    const { boardId } = request.params;
    const access = member(request, reply, boardId);
    if (!access) return;
    if (access.role !== 'owner') return reply.code(403).send({ error: 'Only the owner can reset the invite link.' });
    const inviteToken = repo.resetInviteToken(boardId);
    rooms.inviteReset(boardId, inviteToken);
    return { inviteToken };
  });
}
