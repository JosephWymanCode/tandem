import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type BoardSummary } from '../api';
import { Avatar, Wordmark } from '../components/Avatar';
import { ExportBoard, ImportBoard } from '../components/BoardTransfer';
import { ThemeToggle } from '../components/ThemeToggle';
import { UpgradeAccount } from '../components/UpgradeAccount';
import { useSession } from '../session';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

export function Boards() {
  const navigate = useNavigate();
  const user = useSession((state) => state.user)!;
  const logout = useSession((state) => state.logout);
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .boards()
      .then((result) => {
        if (!cancelled) setBoards(result.boards);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load your boards.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    try {
      const { boardId } = await api.createBoard(title);
      navigate(`/b/${boardId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the board.');
    }
  };

  const remove = async (id: string) => {
    try {
      await api.deleteBoard(id);
      setBoards((current) => current?.filter((board) => board.id !== id) ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete the board.');
    }
    setConfirming(null);
  };

  return (
    <div className="page">
      <header className="page-bar">
        <Wordmark />
        <div className="page-bar-user">
          <ThemeToggle />
          <Avatar name={user.name} color={user.color} />
          <span>{user.name}</span>
          <button className="button button-quiet" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </header>

      <main className="boards">
        <h1>Your boards</h1>

        {user.isGuest && <UpgradeAccount user={user} />}

        <form className="new-board" onSubmit={(event) => void create(event)}>
          <label htmlFor="new-board-title">New board</label>
          <div className="new-board-row">
            <input
              id="new-board-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Name it after the project"
              maxLength={120}
            />
            <button className="button button-primary" disabled={!title.trim()}>
              Create board
            </button>
          </div>
        </form>

        <ImportBoard />

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        {boards === null && !error && <p role="status">Loading your boards…</p>}
        {boards?.length === 0 && <p>You have no boards yet. Create one above to get started.</p>}

        <ul className="board-list">
          {boards?.map((board) => (
            <li key={board.id}>
              <Link to={`/b/${board.id}`} className="board-link">
                <strong>{board.title}</strong>
                <span>
                  {plural(board.cardCount, 'card')},{' '}
                  {board.memberCount === 1 ? 'only you' : `${board.memberCount} people`}
                  {board.role === 'member' && ', shared with you'}
                </span>
              </Link>
              <ExportBoard boardId={board.id} title={board.title} />
              {board.role === 'owner' &&
                (confirming === board.id ? (
                  <span className="confirm">
                    Delete for everyone?
                    <button className="button button-danger" onClick={() => void remove(board.id)}>
                      Delete board
                    </button>
                    <button className="button button-quiet" onClick={() => setConfirming(null)}>
                      Keep it
                    </button>
                  </span>
                ) : (
                  <button className="button button-quiet" onClick={() => setConfirming(board.id)}>
                    Delete
                  </button>
                ))}
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
