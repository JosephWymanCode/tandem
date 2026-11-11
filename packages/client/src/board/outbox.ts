/**
 * Paces outgoing messages. The server closes a connection that sends more
 * than 100 messages in a second, and a single undo can restore a column with
 * hundreds of cards, so operations go out at no more than `limit` per
 * `windowMs`, in order. Cursor and presence updates stay well inside the rest.
 */
export interface Outbox<T> {
  push: (message: T) => void;
  /** Forgets everything not yet sent (the connection dropped; pending changes are re-sent on reconnect). */
  clear: () => void;
}

export function createOutbox<T>(
  send: (message: T) => void,
  { limit = 60, windowMs = 1000, now = () => Date.now() } = {},
): Outbox<T> {
  const queue: T[] = [];
  let sentAt: number[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const drain = () => {
    timer = undefined;
    while (queue.length > 0) {
      const time = now();
      sentAt = sentAt.filter((at) => time - at < windowMs);
      if (sentAt.length >= limit) {
        timer = setTimeout(drain, sentAt[0]! + windowMs - time);
        return;
      }
      sentAt.push(time);
      send(queue.shift()!);
    }
  };

  return {
    push: (message) => {
      queue.push(message);
      if (timer === undefined) drain();
    },
    clear: () => {
      queue.length = 0;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
