function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  const letters = words.length > 1 ? words[0]![0]! + words[words.length - 1]![0]! : name.slice(0, 2);
  return letters.toUpperCase();
}

export function Avatar({ name, color, size = 28 }: { name: string; color: string; size?: number }) {
  return (
    <span
      className="avatar"
      style={{ background: color, width: size, height: size, fontSize: Math.round(size * 0.4) }}
      title={name}
      aria-label={name}
      role="img"
    >
      {initials(name)}
    </span>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="currentColor" />
        <rect x="7" y="8" width="7" height="16" rx="2" fill="var(--sun)" />
        <rect x="18" y="8" width="7" height="10" rx="2" fill="var(--paper)" />
      </svg>
      Tandem
    </span>
  );
}
