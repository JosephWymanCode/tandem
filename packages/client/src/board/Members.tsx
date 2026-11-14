import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { Avatar } from '../components/Avatar';
import { useBoard } from './store';
import './Members.css';

/** Which inline confirmation is open: a member's id, the invite reset, or leaving. */
type Confirming = { kind: 'remove'; userId: string } | { kind: 'reset' } | { kind: 'leave' } | null;

const message = (error: unknown) => (error instanceof ApiError ? error.message : 'Something went wrong. Try again.');

/** The people on the board, shown in the Share dialog. The owner can remove people and reset the link; others can leave. */
export function Members() {
  const boardId = useBoard((state) => state.board?.id);
  const members = useBoard((state) => state.members);
  const you = useBoard((state) => state.you?.userId);
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!boardId || !you) return null;
  const isOwner = members.some((member) => member.id === you && member.role === 'owner');

  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setConfirming(null);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  };

  const remove = (userId: string) => act(() => api.removeMember(boardId, userId).then(() => undefined));

  const resetInvite = () =>
    act(async () => {
      const { inviteToken } = await api.resetInvite(boardId);
      // Everyone else hears about it over the socket; this saves waiting for that.
      useBoard.setState({ inviteToken });
    });

  const leave = () =>
    act(async () => {
      await api.removeMember(boardId, you);
      void navigate('/boards');
    });

  const ask = (next: Confirming) => {
    setConfirming(next);
    setError(null);
  };
  const cancel = () => ask(null);

  return (
    <section className="members" aria-labelledby="members-title">
      <h3 id="members-title">People on this board</h3>
      <ul className="members-list">
        {members.map((member) => {
          const confirmingThis = confirming?.kind === 'remove' && confirming.userId === member.id;
          return (
            <li key={member.id}>
              <Avatar name={member.name} color={member.color} />
              <span className="members-name">
                {member.name}
                {member.id === you && <span className="members-you"> (you)</span>}
              </span>
              {member.role === 'owner' && <span className="members-role">Owner</span>}
              {isOwner &&
                member.id !== you &&
                (confirmingThis ? (
                  <span className="confirm members-confirm">
                    Remove {member.name}? They can join again with the invite link until you reset it.
                    <button className="button button-danger" disabled={busy} onClick={() => void remove(member.id)}>
                      Remove from board
                    </button>
                    <button className="button button-quiet" disabled={busy} onClick={cancel}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <button
                    className="button button-quiet"
                    aria-label={`Remove ${member.name}`}
                    onClick={() => ask({ kind: 'remove', userId: member.id })}
                  >
                    Remove
                  </button>
                ))}
            </li>
          );
        })}
      </ul>

      {isOwner ? (
        confirming?.kind === 'reset' ? (
          <div className="members-panel" role="group" aria-label="Reset invite link">
            <p>The current link will stop working at once. People already on the board stay on it.</p>
            <div className="members-panel-actions">
              <button className="button button-danger" disabled={busy} onClick={() => void resetInvite()}>
                Reset link
              </button>
              <button className="button button-quiet" disabled={busy} onClick={cancel}>
                Keep the current link
              </button>
            </div>
          </div>
        ) : (
          <button className="button button-quiet members-action" onClick={() => ask({ kind: 'reset' })}>
            Reset invite link
          </button>
        )
      ) : confirming?.kind === 'leave' ? (
        <div className="members-panel" role="group" aria-label="Leave board">
          <p>You will lose access to this board until someone sends you an invite link again.</p>
          <div className="members-panel-actions">
            <button className="button button-danger" disabled={busy} onClick={() => void leave()}>
              Leave this board
            </button>
            <button className="button button-quiet" disabled={busy} onClick={cancel}>
              Stay
            </button>
          </div>
        </div>
      ) : (
        <button className="button button-quiet members-action" onClick={() => ask({ kind: 'leave' })}>
          Leave board
        </button>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
