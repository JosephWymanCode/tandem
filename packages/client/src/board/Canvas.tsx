import { useMemo, useRef, useState, type PointerEvent } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { cardsInColumn, keyBetween, sortedColumns, type BoardState, type Member, type Peer } from '@tandem/shared';
import { CursorShape } from '../components/HeroDemo';
import { CardFace } from './Card';
import { FilterEmpty } from './FilterBar';
import { dropPosition, isFiltering, matches, useFilter } from './filter';
import { Lane, LaneGhost } from './Lane';
import { useBoard } from './store';

type Items = Record<string, string[]>;

interface DragState {
  type: 'card' | 'column';
  id: string;
  /** Card order while a card is in flight. A snapshot, so other people's changes do not shuffle things mid-drag. */
  items: Items;
}

const findContainer = (id: string, items: Items): string | undefined =>
  id in items ? id : Object.keys(items).find((columnId) => items[columnId]!.includes(id));

/**
 * Columns only collide with columns. A card prefers the card under the
 * pointer, then the column under the pointer (so empty columns accept drops).
 */
const collisions: CollisionDetection = (args) => {
  if (args.active.data.current?.type === 'column') {
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((c) => c.data.current?.type === 'column'),
    });
  }
  const pointer = pointerWithin(args);
  const hits = pointer.length > 0 ? pointer : rectIntersection(args);
  const card = hits.find((hit) => hit.data?.droppableContainer.data.current?.type === 'card');
  return card ? [card] : hits.slice(0, 1);
};

function AddColumn({ lastPos }: { lastPos: string | null }) {
  const dispatch = useBoard((state) => state.dispatch);
  const [title, setTitle] = useState<string | null>(null);

  const add = () => {
    const next = title?.trim();
    if (next) {
      dispatch({ type: 'column.add', id: crypto.randomUUID(), title: next, pos: keyBetween(lastPos, null) });
    }
    setTitle(null);
  };

  if (title === null) {
    return (
      <button className="lane-new" onClick={() => setTitle('')}>
        Add a column
      </button>
    );
  }
  return (
    <div className="lane lane-new-form">
      <input
        autoFocus
        value={title}
        maxLength={120}
        placeholder="Column name"
        aria-label="New column name"
        onChange={(event) => setTitle(event.target.value)}
        onBlur={add}
        onKeyDown={(event) => {
          if (event.key === 'Enter') add();
          if (event.key === 'Escape') setTitle(null);
        }}
      />
    </div>
  );
}

function Cursors({ peers }: { peers: Peer[] }) {
  return (
    <>
      {peers.map((peer) =>
        peer.cursor ? (
          <div
            key={peer.connId}
            className="cursor"
            style={{ transform: `translate(${peer.cursor.x}px, ${peer.cursor.y}px)` }}
            aria-hidden="true"
          >
            <CursorShape color={peer.color} />
            <span style={{ background: peer.color }}>{peer.name}</span>
          </div>
        ) : null,
      )}
    </>
  );
}

export function Canvas({
  board,
  members,
  peers,
  onOpenCard,
}: {
  board: BoardState;
  members: Member[];
  peers: Peer[];
  onOpenCard: (id: string) => void;
}) {
  const dispatch = useBoard((state) => state.dispatch);
  const setCursor = useBoard((state) => state.setCursor);
  const setEditing = useBoard((state) => state.setEditing);
  const surface = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const columns = useMemo(() => sortedColumns(board), [board]);
  const settled = useMemo<Items>(
    () => Object.fromEntries(columns.map((c) => [c.id, cardsInColumn(board, c.id).map((card) => card.id)])),
    [board, columns],
  );
  const items = drag?.type === 'card' ? drag.items : settled;
  const idsIn = (columnId: string) => (items[columnId] ?? []).filter((id) => board.cards[id]);

  // A filter only hides cards for this person. The card in hand always stays in view.
  const filter = useFilter();
  const filtering = isFiltering(filter);
  const shown = (id: string) => {
    const card = board.cards[id];
    return card !== undefined && (!filtering || id === drag?.id || matches(card, filter));
  };
  const visibleIn = (columnId: string) => idsIn(columnId).filter(shown);
  const nothingShown = filtering && columns.every((column) => visibleIn(column.id).length === 0);

  // Which cards other people currently have open or in hand.
  const editors: Record<string, Peer> = {};
  for (const peer of peers) if (peer.editing) editors[peer.editing] = peer;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );

  const onDragStart = ({ active }: DragStartEvent) => {
    const type = active.data.current?.type === 'column' ? 'column' : 'card';
    setDrag({ type, id: String(active.id), items: settled });
    if (type === 'card') setEditing(String(active.id));
  };

  // Moving between columns happens here, as the card crosses over; reordering
  // inside one column is animated by the sortable list and resolved on drop.
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || active.data.current?.type !== 'card') return;
    const activeId = String(active.id);
    const overId = String(over.id);
    setDrag((current) => {
      if (!current) return current;
      const from = findContainer(activeId, current.items);
      const to = findContainer(overId, current.items);
      if (!from || !to || from === to) return current;

      const target = current.items[to]!;
      let index = target.length;
      if (!(overId in current.items)) {
        const overIndex = target.indexOf(overId);
        const translated = active.rect.current.translated;
        const below = translated ? translated.top > over.rect.top + over.rect.height / 2 : false;
        if (overIndex >= 0) index = overIndex + (below ? 1 : 0);
      }
      return {
        ...current,
        items: {
          ...current.items,
          [from]: current.items[from]!.filter((id) => id !== activeId),
          [to]: [...target.slice(0, index), activeId, ...target.slice(index)],
        },
      };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const current = drag;
    setDrag(null);
    setEditing(null);
    if (!current || !over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    if (current.type === 'column') {
      const order = columns.map((column) => column.id);
      const from = order.indexOf(activeId);
      const to = order.indexOf(overId);
      if (from < 0 || to < 0 || from === to) return;
      const next = arrayMove(order, from, to);
      dispatch({
        type: 'column.move',
        id: activeId,
        pos: keyBetween(board.columns[next[to - 1] ?? '']?.pos ?? null, board.columns[next[to + 1] ?? '']?.pos ?? null),
      });
      return;
    }

    const card = board.cards[activeId];
    const container = findContainer(activeId, current.items);
    if (!card || !container || !board.columns[container]) return;

    // Neighbours are the cards the person can see; hidden ones are accounted for below.
    let list = current.items[container]!.filter(shown);
    if (findContainer(overId, current.items) === container && overId !== activeId && !(overId in current.items)) {
      const from = list.indexOf(activeId);
      const to = list.indexOf(overId);
      if (from >= 0 && to >= 0) list = arrayMove(list, from, to);
    }
    const index = list.indexOf(activeId);
    if (index < 0) return;
    const before = list[index - 1];
    const after = list[index + 1];

    // Dropped back where it started: nothing to send.
    const original = (settled[card.columnId] ?? []).filter(shown);
    const originalIndex = original.indexOf(activeId);
    if (card.columnId === container && original[originalIndex - 1] === before && original[originalIndex + 1] === after) {
      return;
    }

    // Only this card changes: it goes directly under the card seen above it,
    // ahead of any cards a filter is hiding there.
    dispatch({
      type: 'card.move',
      id: activeId,
      columnId: container,
      pos: dropPosition(cardsInColumn(board, container), activeId, before ?? null),
    });
  };

  const onPointerMove = (event: PointerEvent) => {
    const rect = surface.current?.getBoundingClientRect();
    if (rect) setCursor({ x: Math.round(event.clientX - rect.left), y: Math.round(event.clientY - rect.top) });
  };

  const dragged = drag?.type === 'card' ? board.cards[drag.id] : undefined;
  const draggedColumn = drag?.type === 'column' ? board.columns[drag.id] : undefined;

  return (
    <div className="canvas">
      {nothingShown && <FilterEmpty />}
      <div className="surface" ref={surface} onPointerMove={onPointerMove} onPointerLeave={() => setCursor(null)}>
        <DndContext
          sensors={sensors}
          collisionDetection={collisions}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={() => {
            setDrag(null);
            setEditing(null);
          }}
        >
          <SortableContext items={columns.map((column) => column.id)} strategy={horizontalListSortingStrategy}>
            {columns.map((column) => (
              <Lane
                key={column.id}
                column={column}
                cardIds={visibleIn(column.id)}
                allCardIds={idsIn(column.id)}
                board={board}
                members={members}
                editors={editors}
                onOpenCard={onOpenCard}
              />
            ))}
          </SortableContext>
          <DragOverlay>
            {dragged && (
              <div className="card is-overlay">
                <CardFace card={dragged} assignee={members.find((member) => member.id === dragged.assigneeId)} />
              </div>
            )}
            {draggedColumn && <LaneGhost column={draggedColumn} cardIds={visibleIn(draggedColumn.id)} board={board} />}
          </DragOverlay>
        </DndContext>
        <AddColumn lastPos={columns[columns.length - 1]?.pos ?? null} />
        <Cursors peers={peers} />
      </div>
    </div>
  );
}
