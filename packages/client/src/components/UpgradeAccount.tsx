import { useState, type FormEvent } from 'react';
import { ApiError, api, type User } from '../api';
import { useSession } from '../session';
import './UpgradeAccount.css';

/** Shown to guests on the boards page: turns the guest session into a full account, keeping its boards. */
export function UpgradeAccount({ user }: { user: User }) {
  const setUser = useSession((state) => state.setUser);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.upgrade({ name, email, password });
      // The notice is only rendered for guests, so it goes away with this update.
      setUser(result.user);
    } catch (caught) {
      // Another tab may have finished the upgrade already: pick up the account it made.
      if (caught instanceof ApiError && caught.status === 400) {
        const fresh = await api.me().catch(() => null);
        if (fresh && !fresh.user.isGuest) {
          setUser(fresh.user);
          return;
        }
      }
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  };

  return (
    <section className="upgrade" aria-labelledby="upgrade-heading">
      <h2 id="upgrade-heading">You are using a guest session</h2>
      <p>
        Guest boards can only be reached from this browser. If you log out or clear its data, you lose your way back to
        them.
      </p>

      {!open ? (
        <button className="button button-dark" onClick={() => setOpen(true)}>
          Create an account to keep your boards
        </button>
      ) : (
        <form className="auth-form upgrade-form" onSubmit={(event) => void submit(event)}>
          <label>
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
              maxLength={40}
              autoFocus
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              maxLength={254}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              maxLength={200}
              required
            />
            <span className="field-hint">At least 8 characters.</span>
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="upgrade-actions">
            <button className="button button-dark" disabled={busy}>
              {busy ? 'Creating account…' : 'Create account'}
            </button>
            <button type="button" className="button button-quiet" disabled={busy} onClick={() => {
                setOpen(false);
                setError(null);
              }}
            >
              Not now
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
