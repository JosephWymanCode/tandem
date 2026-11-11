import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { COMMENT_MAX_LENGTH, commentBodySchema } from '@tandem/shared';
import { RateLimiter } from './auth';
import type { Repo, User } from './repo';
import type { RoomManager } from './rooms';

interface Deps {
  repo: Repo;
  rooms: RoomManager;
  requireUser: (request: FastifyRequest, reply: FastifyReply) => User | null;
}

const NOT_FOUND = { error: 'Board not found.' };

/** Comments one person may post per minute, across all boards. */
const POSTS_PER_MINUTE = 30;

/**
 * Comment threads on cards. Comments are not board operations: they are
 * saved straight away and then announced to everyone who has the board open.
 */
export function registerCommentRoutes(app: FastifyInstance, { repo, rooms, requireUser }: Deps): void {
  const postLimiter = new RateLimiter(POSTS_PER_MINUTE, 60_000);

  /** The signed-in user and their role, or null once a reply has been sent. */
  const member = (request: FastifyRequest, reply: FastifyReply, boardId: string) => {
    const user = requireUser(request, reply);
    if (!user) return null;
    const role = repo.getRole(boardId, user.id);
    if (role === null) {
      // Non-members cannot tell a board they are not on from one that does not exist.
      reply.code(404).send(NOT_FOUND);
      return null;
    }
    return { user, role };
  };

  app.get<{ Params: { boardId: string; cardId: string } }>(
    '/api/boards/:boardId/cards/:cardId/comments',
    async (request, reply) => {
      const { boardId, cardId } = request.params;
      if (!member(request, reply, boardId)) return;
      return { comments: repo.listComments(boardId, cardId) };
    },
  );

  app.post<{ Params: { boardId: string; cardId: string } }>(
    '/api/boards/:boardId/cards/:cardId/comments',
    async (request, reply) => {
      const { boardId, cardId } = request.params;
      const access = member(request, reply, boardId);
      if (!access) return;
      const body = commentBodySchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: `Write a comment of up to ${COMMENT_MAX_LENGTH} characters.` });
      }
      if (!repo.cardExists(boardId, cardId)) {
        // Also the case for a card added a moment ago whose change has not reached the server yet.
        return reply
          .code(404)
          .send({ error: 'This card is not on the board. If you just added it, try again in a moment.' });
      }
      if (!postLimiter.allow(access.user.id)) {
        return reply.code(429).send({ error: 'You are posting comments too quickly. Wait a minute and try again.' });
      }
      const comment = repo.addComment(boardId, cardId, access.user, body.data.body);
      rooms.broadcast(boardId, { t: 'comment.added', comment });
      return { comment };
    },
  );

  app.delete<{ Params: { boardId: string; commentId: string } }>(
    '/api/boards/:boardId/comments/:commentId',
    async (request, reply) => {
      const { boardId, commentId } = request.params;
      const access = member(request, reply, boardId);
      if (!access) return;
      const comment = repo.findComment(boardId, commentId);
      if (!comment) return reply.code(404).send({ error: 'This comment has already been deleted.' });
      if (comment.authorId !== access.user.id && access.role !== 'owner') {
        return reply.code(403).send({ error: 'Only the author or the board owner can delete this comment.' });
      }
      if (repo.deleteComment(boardId, commentId)) {
        rooms.broadcast(boardId, { t: 'comment.deleted', commentId, cardId: comment.cardId });
      }
      return { ok: true };
    },
  );
}
