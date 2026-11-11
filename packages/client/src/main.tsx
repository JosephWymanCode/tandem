import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/instrument-sans';
import './styles.css';
import { useSession } from './session';
import { Home } from './pages/Home';
import { Boards } from './pages/Boards';
import { Join } from './pages/Join';
import { BoardPage } from './pages/BoardPage';

function App() {
  const ready = useSession((state) => state.ready);
  const user = useSession((state) => state.user);
  const landing = useSession((state) => state.landing);
  const load = useSession((state) => state.load);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ready) return <div className="splash" role="status" aria-label="Loading" />;

  return (
    <Routes>
      <Route path="/" element={user ? <Navigate to={landing ?? '/boards'} replace /> : <Home />} />
      <Route path="/boards" element={user ? <Boards /> : <Navigate to="/" replace />} />
      <Route path="/b/:boardId" element={user ? <BoardPage /> : <Navigate to="/" replace />} />
      <Route path="/join/:token" element={<Join />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
