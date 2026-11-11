import { AuthPanel } from '../components/AuthPanel';
import { Wordmark } from '../components/Avatar';
import { HeroDemo } from '../components/HeroDemo';
import { ThemeToggle } from '../components/ThemeToggle';

export function Home() {
  return (
    <main className="home">
      <section className="home-intro">
        <Wordmark />
        <h1>One board. Everyone on it at once.</h1>
        <p className="home-lede">
          Tandem is a kanban board for teams. Move a card and your teammates watch it land. You see their cursors,
          who is editing what, and every change as it happens.
        </p>
        <AuthPanel guestLabel="Try it as a guest" />
      </section>
      <section className="home-stage">
        <HeroDemo />
        <p className="home-caption">
          Open your board in two windows to see it for yourself, or share the invite link with someone.
        </p>
      </section>
      <ThemeToggle corner />
    </main>
  );
}
