import { z } from 'zod';

export const COMMENT_MAX_LENGTH = 2000;

/** A comment on a card. Comments are not board operations: they are saved and sent on their own. */
export interface Comment {
  id: string;
  cardId: string;
  authorId: string;
  /** The author's name when the comment was posted. */
  authorName: string;
  body: string;
  createdAt: number;
}

export const commentBodySchema = z.object({ body: z.string().trim().min(1).max(COMMENT_MAX_LENGTH) });
