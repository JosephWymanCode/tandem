import './comments.css';

/** The number of comments, shown on the face of a card that has any. */
export function CommentCount({ count }: { count: number }) {
  const label = count === 1 ? '1 comment' : `${count} comments`;
  return (
    <span className="comment-count" title={label} aria-label={label}>
      <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      {count}
    </span>
  );
}
