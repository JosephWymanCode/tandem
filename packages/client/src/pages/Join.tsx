import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { AuthPanel } from '../components/AuthPanel';
import { Wordmark } from '../components/Avatar';
import { ThemeToggle } from '../components/ThemeToggle';
import { useSession } from '../session';

export function Join() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const user = useSession((state) => state.user);
  const [title, setTitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const join = useCallback(async () => {
    try {
      const { boardId } = await api.join(token);
      navigate(`/b/${boardId}`, { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not join this board.');
    }
  }, [token, navigate]);

  useEffect(() => {
    let cancelled = false;
    api
      .invite(token)
      .then((invite) => {
        if (cancelled) return;
        setTitle(invite.title);
        // Someone already signed in goes straight through.
        if (useSession.getState().user) void join();
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not open this invite.');
      });
    return () => {
      cancelled = true;
    };
  }, [token, join]);

  return (
    <main className="join">
      <Wordmark />
      <ThemeToggle corner />
      {error ? (
        <>
          <h1>This invite can’t be used</h1>
          <p className="home-lede">{error}</p>
          <Link className="button button-dark" to="/">
            Go to Tandem
          </Link>
        </>
      ) : title === null || user ? (
        <p className="home-lede" role="status">
          Opening the board…
        </p>
      ) : (
        <>
          <h1>Join “{title}”</h1>
          <p className="home-lede">You’ve been invited to work on this board. Pick how you want to join.</p>
          <AuthPanel guestLabel="Join as a guest" onDone={() => void join()} />
        </>
      )}
    </main>
  );
}
