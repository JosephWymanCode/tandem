import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Activity, Member, Peer } from '@tandem/shared';
import { Canvas } from '../board/Canvas';
import { CardDialog } from '../board/CardDialog';
import { useBoard, type ConnectionStatus } from '../board/store';
import { Avatar, Wordmark } from '../components/Avatar';
import { useSession } from '../session';

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function ago(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function Status({ status, pending }: { status: ConnectionStatus; pending: number }) {
  const text =
    status === 'live'
      ? pending > 0
        ? 'Saving…'
        : 'Live'
      : pending > 0
        ? `Offline, ${pending} change${pending === 1 ? '' : 's'} waiting`
        : 'Reconnecting…';
  return (
    <span className={`status status-${status === 'live' ? 'live' : 'away'}`} role="status">
      <i />
      {text}
    </span>
  );
}

function BoardTitle({ title }: { title: string }) {
  const dispatch = useBoard((state) => state.dispatch);
  const [draft, setDraft] = useState<string | null>(null);

  const save = () => {
    const next = draft?.trim();
    if (next && next !== title) dispatch({ type: 'board.rename', title: next });
    setDraft(null);
  };

  if (draft === null) {
    return (
      <h1>
        <button className="board-title" onClick={() => setDraft(title)} title="Rename board">
          {title}
        </button>
      </h1>
    );
  }
  return (
    <input
      className="board-title-input"
      autoFocus
      value={draft}
      maxLength={120}
      aria-label="Board name"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') save();
        if (event.key === 'Escape') setDraft(null);
      }}
    />
  );
}

function People({ members, peers, you }: { members: Member[]; peers: Peer[]; you: string }) {
  // One avatar per person, however many tabs they have open.
  const online = new Map<string, { name: string; color: string }>();
  const me = members.find((member) => member.id === you);
  if (me) online.set(me.id, me);
  for (const peer of peers) if (!online.has(peer.userId)) online.set(peer.userId, peer);
  const otherTabs = peers.filter((peer) => peer.userId === you).length;

  return (
    <div className="people" aria-label="People on this board now">
      {[...online.entries()].map(([id, person]) => (
        <Avatar key={id} name={id === you ? `${person.name} (you)` : person.name} color={person.color} />
      ))}
      <span className="people-count">
        {online.size === 1 && otherTabs === 0
          ? 'Only you'
          : online.size === 1
            ? `You, in ${otherTabs + 1} windows`
            : `${online.size} here now`}
      </span>
    </div>
  );
}

function ShareDialog({ token, onClose }: { token: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);
  const link = `${location.origin}/join/${token}`;

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the link is selectable as a fallback.
      dialog.current?.querySelector('input')?.select();
    }
  };

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby="share-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) dialog.current?.close();
      }}
    >
      <div className="dialog-body">
        <h2 id="share-title">Invite people to this board</h2>
        <p>Anyone with this link can join and edit, with an account or as a guest.</p>
        <div className="share-row">
          <input readOnly value={link} aria-label="Invite link" onFocus={(event) => event.currentTarget.select()} />
          <button className="button button-primary" onClick={() => void copy()}>
            {copied ? 'Link copied' : 'Copy link'}
          </button>
        </div>
        <div className="dialog-actions">
          <span />
          <button className="button button-dark" onClick={() => dialog.current?.close()}>
            Done
          </button>
        </div>
      </div>
    </dialog>
  );
}

function ActivityPanel({ activity, you, onClose }: { activity: Activity[]; you: string; onClose: () => void }) {
  const now = useNow(30_000);
  return (
    <aside className="activity" aria-label="Activity">
      <header>
        <h2>Activity</h2>
        <button className="button button-quiet" onClick={onClose}>
          Close
        </button>
      </header>
      {activity.length === 0 ? (
        <p className="activity-empty">Nothing yet. Changes to this board will be listed here as they happen.</p>
      ) : (
        <ol>
          {[...activity].reverse().map((entry) => (
            <li key={entry.seq}>
              <p>
                <strong>{entry.by === you ? 'You' : entry.byName}</strong> {entry.summary}
              </p>
              <time dateTime={new Date(entry.at).toISOString()}>{ago(entry.at, now)}</time>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

function Notice({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 5000);
    return () => clearTimeout(timer);
  }, [text, onDone]);
  return (
    <div className="notice" role="alert">
      {text}
      <button className="button button-quiet" onClick={onDone}>
        Dismiss
      </button>
    </div>
  );
}

export function BoardPage() {
  const { boardId = '' } = useParams();
  const user = useSession((state) => state.user)!;
  const setUser = useSession((state) => state.setUser);
  const connect = useBoard((state) => state.connect);
  const disconnect = useBoard((state) => state.disconnect);
  const clearNotice = useBoard((state) => state.clearNotice);
  const { status, closedReason, board, pendingCount, members, peers, inviteToken, activity, notice } = useBoard();

  const [openCard, setOpenCard] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [showActivity, setShowActivity] = useState(false);

  useEffect(() => {
    connect(boardId);
    return disconnect;
  }, [boardId, connect, disconnect]);

  useEffect(() => {
    if (board) document.title = `${board.title} | Tandem`;
    return () => {
      document.title = 'Tandem';
    };
  }, [board]);

  // The session ended (or the demo server restarted): go back to the start page.
  useEffect(() => {
    if (closedReason === 'signed-out') setUser(null);
  }, [closedReason, setUser]);

  if (status === 'closed') {
    return (
      <main className="join">
        <Wordmark />
        <h1>This board isn’t available</h1>
        <p className="home-lede">
          {closedReason === 'not-found'
            ? 'It has been deleted.'
            : 'You are not a member of this board. Ask someone on it for the invite link.'}
        </p>
        <Link className="button button-dark" to="/boards">
          Go to your boards
        </Link>
      </main>
    );
  }

  if (!board) return <div className="splash" role="status" aria-label="Opening the board" />;

  const peerList = Object.values(peers);
  const card = openCard ? board.cards[openCard] : undefined;

  return (
    <div className="board-page">
      <header className="board-bar">
        <Link to="/boards" className="board-back" aria-label="All boards">
          <Wordmark />
        </Link>
        <BoardTitle title={board.title} />
        <Status status={status} pending={pendingCount} />
        <div className="board-bar-end">
          <People members={members} peers={peerList} you={user.id} />
          <button className="button button-quiet" aria-pressed={showActivity} onClick={() => setShowActivity((v) => !v)}>
            Activity
          </button>
          <button className="button button-primary" onClick={() => setSharing(true)}>
            Share
          </button>
        </div>
      </header>

      <div className="board-main">
        <Canvas board={board} members={members} peers={peerList} onOpenCard={setOpenCard} />
        {showActivity && <ActivityPanel activity={activity} you={user.id} onClose={() => setShowActivity(false)} />}
      </div>

      {card && (
        <CardDialog
          key={card.id}
          card={card}
          columnTitle={board.columns[card.columnId]?.title ?? ''}
          members={members}
          others={peerList.filter((peer) => peer.editing === card.id)}
          onClose={() => setOpenCard(null)}
        />
      )}
      {sharing && inviteToken && <ShareDialog token={inviteToken} onClose={() => setSharing(false)} />}
      {notice && <Notice text={notice} onDone={clearNotice} />}
    </div>
  );
}
