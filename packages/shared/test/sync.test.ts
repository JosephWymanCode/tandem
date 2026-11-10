import { describe, expect, it } from 'vitest';
import { applyOp, cardsInColumn, type BoardState, type Op } from '../src/model';
import { applyLocal, applyReject, applyRemote, createSync, type SyncState } from '../src/sync';

function board(): BoardState {
  return {
    id: 'b1',
    title: 'Board',
    columns: {
      todo: { id: 'todo', title: 'To do', pos: 'G' },
      done: { id: 'done', title: 'Done', pos: 'V' },
    },
    cards: {
      c1: { id: 'c1', columnId: 'todo', title: 'First', description: '', labels: [], assigneeId: null, pos: 'G' },
    },
  };
}

function local(state: SyncState, cid: string, op: Op): SyncState {
  const next = applyLocal(state, { cid, op });
  if (!next) throw new Error('local op was not valid');
  return next;
}

function remote(state: SyncState, seq: number, cid: string, op: Op): SyncState {
  const result = applyRemote(state, { seq, cid, op });
  if (result.status !== 'applied') throw new Error(`expected applied, got ${result.status}`);
  return result.state;
}

describe('optimistic sync', () => {
  it('shows a local change at once and keeps it pending', () => {
    const state = local(createSync(board(), 0), 'a1', { type: 'card.move', id: 'c1', columnId: 'done', pos: 'V' });
    expect(state.view.cards.c1?.columnId).toBe('done');
    expect(state.confirmed.cards.c1?.columnId).toBe('todo');
    expect(state.pending).toHaveLength(1);
  });

  it('clears the pending entry when the server echoes it back', () => {
    const op: Op = { type: 'card.move', id: 'c1', columnId: 'done', pos: 'V' };
    let state = local(createSync(board(), 0), 'a1', op);
    state = remote(state, 1, 'a1', op);
    expect(state.pending).toHaveLength(0);
    expect(state.confirmed.cards.c1?.columnId).toBe('done');
    expect(state.seq).toBe(1);
  });

  it('rolls back when the server rejects', () => {
    let state = local(createSync(board(), 0), 'a1', { type: 'card.delete', id: 'c1' });
    expect(state.view.cards.c1).toBeUndefined();
    state = applyReject(state, 'a1');
    expect(state.view.cards.c1).toBeDefined();
    expect(state.pending).toHaveLength(0);
  });

  it('replays pending changes on top of other people’s changes', () => {
    let state = local(createSync(board(), 0), 'a1', {
      type: 'card.update',
      id: 'c1',
      patch: { title: 'Mine' },
    });
    state = remote(state, 1, 'other', { type: 'card.update', id: 'c1', patch: { description: 'Theirs' } });
    expect(state.view.cards.c1).toMatchObject({ title: 'Mine', description: 'Theirs' });
    expect(state.pending).toHaveLength(1);
  });

  it('drops a pending change whose target someone else deleted', () => {
    let state = local(createSync(board(), 0), 'a1', {
      type: 'card.update',
      id: 'c1',
      patch: { title: 'Mine' },
    });
    state = remote(state, 1, 'other', { type: 'card.delete', id: 'c1' });
    expect(state.view.cards.c1).toBeUndefined();
    expect(state.pending).toHaveLength(0);
  });

  it('ignores duplicates and reports gaps', () => {
    const op: Op = { type: 'board.rename', title: 'New' };
    const state = remote(createSync(board(), 0), 1, 'x', op);
    expect(applyRemote(state, { seq: 1, cid: 'x', op }).status).toBe('duplicate');
    expect(applyRemote(state, { seq: 3, cid: 'y', op }).status).toBe('gap');
  });

  it('keeps unacknowledged changes across a reconnect snapshot', () => {
    const before = local(createSync(board(), 0), 'a1', {
      type: 'card.add',
      id: 'c2',
      columnId: 'todo',
      title: 'Offline card',
      pos: 'V',
    });
    const fresh = { ...board(), title: 'Renamed while offline' };
    const after = createSync(fresh, 5, before.pending);
    expect(after.view.title).toBe('Renamed while offline');
    expect(after.view.cards.c2?.title).toBe('Offline card');
  });
});

describe('convergence', () => {
  it('two clients end up identical whatever order their changes reach the server', () => {
    const opsA: Op[] = [
      { type: 'card.add', id: 'a-card', columnId: 'todo', title: 'From A', pos: 'V' },
      { type: 'card.move', id: 'c1', columnId: 'done', pos: 'V' },
      { type: 'column.rename', id: 'todo', title: 'Backlog' },
    ];
    const opsB: Op[] = [
      { type: 'card.add', id: 'b-card', columnId: 'todo', title: 'From B', pos: 'V' },
      { type: 'card.update', id: 'c1', patch: { title: 'Edited by B' } },
      { type: 'column.delete', id: 'done' },
    ];

    for (const interleave of [
      [0, 1, 0, 1, 0, 1],
      [1, 1, 1, 0, 0, 0],
      [0, 0, 1, 0, 1, 1],
    ]) {
      let a = createSync(board(), 0);
      let b = createSync(board(), 0);
      opsA.forEach((op, i) => {
        a = applyLocal(a, { cid: `a${i}`, op }) ?? a;
      });
      opsB.forEach((op, i) => {
        b = applyLocal(b, { cid: `b${i}`, op }) ?? b;
      });

      // The server applies changes in arrival order and rejects the ones that no longer fit.
      let server = board();
      let seq = 0;
      const queues = [opsA.map((op, i) => ({ cid: `a${i}`, op })), opsB.map((op, i) => ({ cid: `b${i}`, op }))];
      for (const who of interleave) {
        const item = queues[who]!.shift()!;
        const result = applyOp(server, item.op);
        if (result.ok) {
          server = result.state;
          seq++;
          const ra = applyRemote(a, { seq, ...item });
          const rb = applyRemote(b, { seq, ...item });
          expect(ra.status).toBe('applied');
          expect(rb.status).toBe('applied');
          a = ra.state;
          b = rb.state;
        } else if (who === 0) {
          a = applyReject(a, item.cid);
        } else {
          b = applyReject(b, item.cid);
        }
      }

      expect(a.pending).toHaveLength(0);
      expect(b.pending).toHaveLength(0);
      expect(a.view).toEqual(server);
      expect(b.view).toEqual(server);
      // Two cards given the same position still sort the same way everywhere.
      expect(cardsInColumn(a.view, 'todo')).toEqual(cardsInColumn(b.view, 'todo'));
    }
  });
});
