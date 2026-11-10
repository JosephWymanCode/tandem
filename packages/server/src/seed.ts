import { randomUUID } from 'node:crypto';
import { initialKeys, type Card, type Column, type Label } from '@tandem/shared';
import type { Repo } from './repo';

type SeedCard = { title: string; description?: string; labels?: Label[] };

const SEED: { title: string; cards: SeedCard[] }[] = [
  {
    title: 'Start here',
    cards: [
      {
        title: 'Open this board in a second window',
        description:
          'Put the two windows side by side. Everything you do in one shows up in the other straight away, including your cursor.',
        labels: ['blue'],
      },
      {
        title: 'Drag me to another column',
        description: 'Cards and whole columns can be dragged. Other people see the move as it lands.',
        labels: ['green'],
      },
      {
        title: 'Invite someone with the Share button',
        description: 'Anyone with the invite link can join this board, as a guest or with an account.',
        labels: ['violet'],
      },
    ],
  },
  {
    title: 'To do',
    cards: [
      { title: 'Write the launch announcement', labels: ['amber'] },
      {
        title: 'Check pricing page on small phones',
        description: 'The plan comparison table overflows below 360px wide.',
        labels: ['red'],
      },
      { title: 'Book the user interviews for next week' },
    ],
  },
  {
    title: 'In progress',
    cards: [
      {
        title: 'Redesign the onboarding checklist',
        description: 'Cut it from seven steps to four. Draft is in the design file.',
        labels: ['teal', 'blue'],
      },
      { title: 'Move image uploads to background jobs', labels: ['amber'] },
    ],
  },
  {
    title: 'Done',
    cards: [
      { title: 'Set up error reporting', labels: ['green'] },
      { title: 'Agree the launch date' },
    ],
  },
];

/** Gives a new user a board that explains itself, so nobody lands on an empty screen. */
export function createStarterBoard(repo: Repo, ownerId: string): string {
  const columns: Column[] = [];
  const cards: Omit<Card, 'assigneeId'>[] = [];
  const columnKeys = initialKeys(SEED.length);

  SEED.forEach((seedColumn, columnIndex) => {
    const columnId = randomUUID();
    columns.push({ id: columnId, title: seedColumn.title, pos: columnKeys[columnIndex]! });
    const cardKeys = initialKeys(seedColumn.cards.length);
    seedColumn.cards.forEach((seedCard, cardIndex) => {
      cards.push({
        id: randomUUID(),
        columnId,
        title: seedCard.title,
        description: seedCard.description ?? '',
        labels: seedCard.labels ?? [],
        pos: cardKeys[cardIndex]!,
      });
    });
  });

  return repo.createBoard(ownerId, 'Website relaunch', { columns, cards });
}
