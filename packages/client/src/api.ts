export interface User {
  id: string;
  email: string | null;
  name: string;
  color: string;
  isGuest: boolean;
}

export interface BoardSummary {
  id: string;
  title: string;
  role: 'owner' | 'member';
  memberCount: number;
  cardCount: number;
  createdAt: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new ApiError(data.error ?? 'Something went wrong. Try again.', response.status);
  return data as T;
}

export const api = {
  me: () => request<{ user: User }>('GET', '/api/me'),
  signup: (input: { name: string; email: string; password: string }) =>
    request<{ user: User; boardId: string }>('POST', '/api/auth/signup', input),
  login: (input: { email: string; password: string }) => request<{ user: User }>('POST', '/api/auth/login', input),
  guest: () => request<{ user: User; boardId: string }>('POST', '/api/auth/guest'),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),
  boards: () => request<{ boards: BoardSummary[] }>('GET', '/api/boards'),
  createBoard: (title: string) => request<{ boardId: string }>('POST', '/api/boards', { title }),
  deleteBoard: (id: string) => request<{ ok: true }>('DELETE', `/api/boards/${id}`),
  invite: (token: string) => request<{ title: string }>('GET', `/api/invites/${token}`),
  join: (token: string) => request<{ boardId: string }>('POST', `/api/invites/${token}/join`),
};
