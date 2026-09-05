import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import {
  Bell,
  BookOpen,
  ChartNoAxesCombined,
  ClipboardList,
  FlaskConical,
  Github,
  LogOut,
  Menu,
  Settings2,
  ShieldCheck,
  Users,
  Workflow,
  X,
} from 'lucide-react';
import { api, clearSession, hasSession, setSession } from './api';
import { DataContext, useAction, useData } from './context';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorState,
  Field,
  initials,
  Loading,
  PageTitle,
} from './components/ui';
import { roleLabels, type Bootstrap, type Role, type User } from './types';
import { Ledger, Student, Assignments, Notifications, Analytics } from './pages/overview';
import { Courses, CourseDetail } from './pages/courses';
import { ReviewWorkspace } from './pages/review';
import { Expert } from './pages/expert';
import { Administration, Models, Coordinator, Evals } from './pages/management';

const home: Record<Role, string> = {
  student: '/courses',
  reviewer: '/ledger',
  coordinator: '/coordinator',
  expert: '/courses',
  moderator: '/notifications',
  admin: '/admin',
  owner: '/admin',
  pending: '/profile',
};
const nav = [
  {
    path: '/courses',
    title: 'Курсы',
    icon: BookOpen,
    roles: ['student', 'reviewer', 'expert', 'coordinator', 'admin', 'owner'],
  },
  {
    path: '/ledger',
    title: 'Ведомость',
    icon: ClipboardList,
    roles: ['reviewer', 'expert', 'coordinator', 'admin', 'owner'],
  },
  { path: '/student', title: 'Мои задания', icon: BookOpen, roles: ['student'] },
  {
    path: '/coordinator',
    title: 'Распределение',
    icon: Users,
    roles: ['coordinator', 'admin', 'owner'],
  },
  {
    path: '/assignments',
    title: 'Задания и критерии',
    icon: BookOpen,
    roles: ['expert', 'reviewer', 'coordinator', 'admin', 'owner'],
  },
  {
    path: '/evals',
    title: 'Тестирование агента',
    icon: FlaskConical,
    roles: ['expert', 'admin', 'owner'],
  },
  {
    path: '/analytics',
    title: 'Аналитика',
    icon: ChartNoAxesCombined,
    roles: ['reviewer', 'coordinator', 'expert', 'admin', 'owner'],
  },
  { path: '/admin', title: 'Сотрудники', icon: ShieldCheck, roles: ['admin', 'owner'] },
  { path: '/models', title: 'Модели и настройки', icon: Settings2, roles: ['admin', 'owner'] },
  {
    path: '/notifications',
    title: 'Уведомления',
    icon: Bell,
    roles: ['student', 'reviewer', 'coordinator', 'expert', 'moderator', 'admin', 'owner'],
  },
];
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <div>
        Avito <span>Education</span>
        <small>Проверка домашних работ</small>
      </div>
    </div>
  );
}

export function App() {
  const [signedIn, setSignedIn] = useState(hasSession());
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api<{ debug: boolean }>('/health'),
    retry: false,
  });
  const data = useQuery({
    queryKey: ['bootstrap'],
    queryFn: () => api<Bootstrap>('/bootstrap'),
    enabled: signedIn,
    refetchInterval: signedIn ? 8000 : false,
  });
  useEffect(() => {
    const expired = () => setSignedIn(false);
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, []);
  if (!signedIn)
    return (
      <Auth
        debug={health.data?.debug === true}
        online={!!health.data}
        onLogin={() => setSignedIn(true)}
      />
    );
  if (data.isPending) return <Loading />;
  if (data.isError)
    return (
      <div className="standalone">
        <ErrorState error={data.error} retry={() => data.refetch()} />
        <Button
          onClick={() => {
            clearSession();
            setSignedIn(false);
          }}
        >
          Вернуться ко входу
        </Button>
      </div>
    );
  return (
    <DataContext.Provider value={data.data}>
      <Shell
        onLogout={async () => {
          const refreshToken = sessionStorage.getItem('reviewer.refresh');
          try {
            if (refreshToken) await api('/auth/logout', { refreshToken });
          } catch {
            /* Local session is cleared even if the server is unavailable. */
          } finally {
            clearSession();
            setSignedIn(false);
          }
        }}
      />
    </DataContext.Provider>
  );
}
function Auth({
  debug,
  online,
  onLogin,
}: {
  debug: boolean;
  online: boolean;
  onLogin: () => void;
}) {
  const [mode, setMode] = useState<'login' | 'student' | 'employee'>('login');
  const { busy, run } = useAction();
  const navigate = useNavigate();
  async function enter(path: string, body: unknown) {
    const result = await run<{ accessToken: string; refreshToken: string; user: User }>(
      path,
      body,
      'POST',
      '',
    );
    if (result) {
      setSession(result);
      onLogin();
      navigate(home[result.user.role]);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    await enter(mode === 'login' ? '/auth/login' : `/auth/register/${mode}`, values);
  }
  return (
    <div className="auth-layout">
      <div className="auth-intro">
        <Brand />
        <div>
          <span className="eyebrow">Рабочее пространство</span>
          <h1>
            Проверка
            <br />
            домашних работ
          </h1>
          <div className="auth-visual">
            <div>
              <ClipboardList />
              <span>Работа получена</span>
              <Badge tone="blue">GitHub PR</Badge>
            </div>
            <div>
              <Workflow />
              <span>Черновик ревью</span>
              <span className="visual-dots">•••</span>
            </div>
            <div>
              <ShieldCheck />
              <span>Решение ревьюера</span>
              <Badge tone="green">Подтверждено</Badge>
            </div>
          </div>
        </div>
        <small>Avito Education · AI Reviewer</small>
      </div>
      <div className="auth-form">
        <Card>
          <h2>{mode === 'login' ? 'Вход в платформу' : 'Создание аккаунта'}</h2>
          <div className="tabs">
            <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
              Войти
            </button>
            <button className={mode !== 'login' ? 'active' : ''} onClick={() => setMode('student')}>
              Регистрация
            </button>
          </div>
          <form onSubmit={submit} className="form-stack">
            {mode !== 'login' && (
              <>
                <Field label="Тип аккаунта">
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as 'student' | 'employee')}
                  >
                    <option value="student">Студент</option>
                    <option value="employee">Сотрудник</option>
                  </select>
                </Field>
                <Field label="Имя и фамилия">
                  <input name="name" required autoComplete="name" maxLength={100} />
                </Field>
              </>
            )}
            <Field label="Электронная почта">
              <input type="email" name="email" required autoComplete="email" />
            </Field>
            <Field label="Пароль">
              <input
                type="password"
                name="password"
                required
                minLength={mode === 'login' ? 1 : 10}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
              {mode !== 'login' && <small>Не менее 10 символов</small>}
            </Field>
            {mode === 'employee' && (
              <p className="muted small">После регистрации администратор назначит вам роль.</p>
            )}
            <Button type="submit" variant="primary" busy={busy}>
              {mode === 'login' ? 'Войти' : 'Создать аккаунт'}
            </Button>
          </form>
          {!online && (
            <p className="inline-error" role="status">
              Сервер недоступен. Проверьте, что сервис API запущен.
            </p>
          )}
          {debug && (
            <div className="debug-login">
              <Badge tone="purple">DEBUG</Badge>
              <p>Открыть демонстрационный аккаунт</p>
              <div className="debug-roles">
                {(['reviewer', 'student', 'coordinator', 'expert', 'admin', 'owner'] as Role[]).map(
                  (role) => (
                    <Button
                      key={role}
                      disabled={busy}
                      onClick={() => enter('/auth/debug', { role })}
                    >
                      {roleLabels[role]}
                    </Button>
                  ),
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
function Shell({ onLogout }: { onLogout: () => void }) {
  const data = useData();
  const { user, debug } = data;
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const [menu, setMenu] = useState(false);
  const allowed = nav.filter((n) => n.roles.includes(user.role));
  const unread = data.notifications.filter((n) => !n.read).length;
  function guard(path: string, element: React.ReactNode) {
    return allowed.some((x) => x.path === path) ? (
      element
    ) : (
      <Navigate to={home[user.role]} replace />
    );
  }
  async function switchRole(role: string) {
    const result = await run<{ accessToken: string; refreshToken: string; user: User }>(
      '/auth/debug',
      { role },
      'POST',
      '',
    );
    if (result) {
      setSession(result);
      navigate(home[result.user.role]);
    }
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="icon-button mobile-menu"
          aria-label={menu ? 'Закрыть меню' : 'Открыть меню'}
          onClick={() => setMenu(!menu)}
        >
          {menu ? <X /> : <Menu />}
        </button>
        <Link to={home[user.role]} className="brand-link">
          <Brand />
        </Link>
        <div className="topbar-right">
          {debug && (
            <div className="debug-switch">
              <Badge tone="purple">DEBUG</Badge>
              <select
                aria-label="Роль в debug"
                value={user.role}
                disabled={busy}
                onChange={(e) => switchRole(e.target.value)}
              >
                {Object.entries(roleLabels)
                  .filter(([k]) => k !== 'pending')
                  .map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
              </select>
            </div>
          )}
          <Link
            className="icon-button notification-button"
            aria-label={`Уведомления: ${unread} непрочитанных`}
            to="/notifications"
          >
            <Bell size={21} />
            {unread > 0 && <i>{unread}</i>}
          </Link>
          <Link to="/profile" className="user-chip">
            <span className="avatar">{initials(user.name)}</span>
            <span>
              <b>{user.name}</b>
              <small>{roleLabels[user.role]}</small>
            </span>
          </Link>
        </div>
      </header>
      <aside className={`sidebar ${menu ? 'open' : ''}`}>
        <div className="eyebrow">Рабочий кабинет</div>
        <nav>
          {allowed.map((n) => (
            <NavLink to={n.path} key={n.path} onClick={() => setMenu(false)}>
              <n.icon size={19} />
              <span>{n.title}</span>
              {n.path === '/notifications' && unread > 0 && <b className="nav-count">{unread}</b>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <a
            href="https://github.com/ai-talent-hub-avito/homework_examples"
            target="_blank"
            rel="noreferrer"
          >
            <Github size={17} /> Примеры заданий
          </a>
          <button onClick={onLogout}>
            <LogOut size={17} /> Выйти
          </button>
        </div>
      </aside>
      <main className="main" id="main">
        <Routes>
          <Route path="/" element={<Navigate to={home[user.role]} replace />} />
          <Route path="/courses" element={guard('/courses', <Courses />)} />
          <Route path="/courses/:id" element={guard('/courses', <CourseDetail />)} />
          <Route path="/ledger" element={guard('/ledger', <Ledger />)} />
          <Route path="/review/:id" element={guard('/ledger', <ReviewWorkspace />)} />
          <Route path="/student" element={guard('/student', <Student />)} />
          <Route path="/assignments" element={guard('/assignments', <Assignments />)} />
          <Route path="/expert/:id" element={guard('/assignments', <Expert />)} />
          <Route path="/coordinator" element={guard('/coordinator', <Coordinator />)} />
          <Route path="/admin" element={guard('/admin', <Administration />)} />
          <Route path="/models" element={guard('/models', <Models />)} />
          <Route path="/evals" element={guard('/evals', <Evals />)} />
          <Route path="/analytics" element={guard('/analytics', <Analytics />)} />
          <Route path="/notifications" element={guard('/notifications', <Notifications />)} />
          <Route path="/profile" element={<Profile onLogout={onLogout} />} />
          <Route
            path="*"
            element={
              <Card>
                <Empty
                  title="Страница не найдена"
                  action={<Link to={home[user.role]}>В рабочий кабинет</Link>}
                />
              </Card>
            }
          />
        </Routes>
      </main>
    </div>
  );
}
function Profile({ onLogout }: { onLogout: () => void }) {
  const { user, debug } = useData();
  return (
    <>
      <PageTitle title="Профиль" />
      <Card>
        <div className="profile-head">
          <span className="avatar large">{initials(user.name)}</span>
          <div>
            <h2>{user.name}</h2>
            <p>{user.email}</p>
            <Badge tone="purple">{roleLabels[user.role]}</Badge>
          </div>
        </div>
        {user.role === 'pending' && (
          <Empty
            title="Ожидаем назначения роли"
            detail="Администратор назначит доступ к рабочему кабинету. Страница обновляется автоматически."
          />
        )}
        <dl className="detail-list">
          <div>
            <dt>Аккаунт</dt>
            <dd>{user.status === 'active' ? 'Активен' : user.status}</dd>
          </div>
          <div>
            <dt>Режим</dt>
            <dd>{debug ? 'Разработка' : 'Рабочая среда'}</dd>
          </div>
        </dl>
        <Button onClick={onLogout}>
          <LogOut size={16} />
          Выйти из аккаунта
        </Button>
      </Card>
    </>
  );
}
