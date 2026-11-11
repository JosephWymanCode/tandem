/** A looping picture of two people moving cards on the same board. Decorative, so hidden from screen readers. */
export function HeroDemo() {
  return (
    <div className="demo" aria-hidden="true">
      <div className="demo-lane">
        <p className="demo-lane-title">To do</p>
        <div className="demo-card">
          <i style={{ background: 'var(--label-amber)' }} />
          Launch post
        </div>
        <div className="demo-card demo-card-moving">
          <i style={{ background: 'var(--label-blue)' }} />
          Fix mobile signup
        </div>
        <div className="demo-card demo-card-shifting">User interviews</div>
      </div>
      <div className="demo-lane">
        <p className="demo-lane-title">In progress</p>
        <div className="demo-card">
          <i style={{ background: 'var(--label-teal)' }} />
          New onboarding
        </div>
        <div className="demo-slot" />
      </div>
      <div className="demo-lane">
        <p className="demo-lane-title">Done</p>
        <div className="demo-card">
          <i style={{ background: 'var(--label-green)' }} />
          Error reports
        </div>
        <div className="demo-card demo-card-typing">
          Launch date<span className="demo-caret" />
        </div>
      </div>

      <div className="demo-cursor demo-cursor-a">
        <CursorShape color="#3E63DD" />
        <span style={{ background: '#3E63DD' }}>Maya</span>
      </div>
      <div className="demo-cursor demo-cursor-b">
        <CursorShape color="#D6409F" />
        <span style={{ background: '#D6409F' }}>Idris</span>
      </div>
    </div>
  );
}

export function CursorShape({ color }: { color: string }) {
  return (
    <svg width="18" height="20" viewBox="0 0 18 20">
      <path d="M2 1.5 16 10.2l-6.4 1.3L6.4 18Z" fill={color} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
