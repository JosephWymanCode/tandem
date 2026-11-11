import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useSession } from '../session';

type Mode = 'login' | 'signup';

/** Guest button plus log-in and sign-up forms. `onDone` runs once the person is signed in. */
export function AuthPanel({ onDone, guestLabel }: { onDone?: () => void; guestLabel: string }) {
  const setUser = useSession((state) => state.setUser);
  const [mode, setMode] = useState<Mode>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const run = async (action: () => Promise<{ user: Parameters<typeof setUser>[0]; boardId?: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      // Signing in re-renders the app at once, so the destination travels with it.
      setUser(result.user, result.boardId ? `/b/${result.boardId}` : null);
      onDone?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(() => (mode === 'login' ? api.login({ email, password }) : api.signup({ name, email, password })));
  };

  return (
    <div className="auth">
      <button className="button button-primary button-large" disabled={busy} onClick={() => void run(api.guest)}>
        {guestLabel}
      </button>
      <p className="auth-hint">No sign-up needed. You get a board of your own to try.</p>

      <div className="auth-switch" role="tablist" aria-label="Account">
        <button role="tab" aria-selected={mode === 'login'} onClick={() => setMode('login')}>
          Log in
        </button>
        <button role="tab" aria-selected={mode === 'signup'} onClick={() => setMode('signup')}>
          Create account
        </button>
      </div>

      <form onSubmit={submit} className="auth-form">
        {mode === 'signup' && (
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={40} />
          </label>
        )}
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'signup' ? 8 : undefined}
            required
          />
          {mode === 'signup' && <span className="field-hint">At least 8 characters.</span>}
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button button-dark" disabled={busy}>
          {mode === 'login' ? 'Log in' : 'Create account'}
        </button>
      </form>
    </div>
  );
}
