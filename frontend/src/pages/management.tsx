import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  Download,
  FlaskConical,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useAction, useData } from '../context';
import {
  Badge,
  Button,
  Card,
  downloadCsv,
  Empty,
  Field,
  formatDate,
  Help,
  initials,
  Metric,
  Modal,
  PageTitle,
  Status,
} from '../components/ui';
import { roleLabels, type EvalRun, type ModelEndpoint, type Role, type User } from '../types';

export function Administration() {
  const data = useData();
  const { run, busy } = useAction();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [edit, setEdit] = useState<User | null>(null);
  const [role, setRole] = useState<Role>('pending');
  const [scopes, setScopes] = useState<string[]>([]);
  const [tab, setTab] = useState('users');
  const employees = data.users.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()),
  );
  function open(user: User) {
    setEdit(user);
    setRole(user.role);
    setScopes([...user.courseIds]);
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    if (role === 'admin' && edit.role !== 'admin') {
      const result = await run(`/owner/admins/${edit.id}`, {}, 'POST', 'Администратор назначен');
      if (!result) return;
    } else if (edit.role === 'admin' && role !== 'admin') {
      const result = await run(
        `/owner/admins/${edit.id}`,
        undefined,
        'DELETE',
        'Права администратора сняты',
      );
      if (!result) return;
    }
    const result = await run(
      `/admin/employees/${edit.id}/roles`,
      { role, courseIds: scopes },
      'PATCH',
      'Роль и доступ обновлены',
    );
    if (result) setEdit(null);
  }
  return (
    <>
      <PageTitle
        title="Сотрудники и доступ"
        eyebrow="Администрирование"
        help="У каждого пользователя одна роль. Только владелец платформы может назначить администратора."
      />
      <div className="grid three">
        <Metric
          label="Сотрудников"
          value={data.users.filter((u) => u.role !== 'student').length}
          tone="purple"
        />
        <Metric
          label="Ожидают назначения"
          value={data.users.filter((u) => u.role === 'pending').length}
          tone="blue"
        />
        <Metric label="Учебных программ" value={data.courses.length} />
      </div>
      <div className="tabs section-gap">
        <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>
          Пользователи
        </button>
        <button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>
          Журнал действий
        </button>
      </div>
      {tab === 'users' ? (
        <>
          <div className="toolbar">
            <div className="search-field">
              <Search size={16} />
              <input
                aria-label="Поиск пользователя"
                placeholder="Имя или почта"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              aria-label="Фильтр по роли"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">Все роли</option>
              {Object.entries(roleLabels).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <Card className="flush">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Пользователь</th>
                    <th>Роль</th>
                    <th>Доступ к курсам</th>
                    <th>Статус</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {employees
                    .filter((u) => filter === 'all' || u.role === filter)
                    .map((u) => (
                      <tr key={u.id}>
                        <td>
                          <div className="person">
                            <span className="avatar">{initials(u.name)}</span>
                            <div>
                              <b>{u.name}</b>
                              <small>{u.email}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <Badge
                            tone={
                              u.role === 'pending'
                                ? 'yellow'
                                : u.role === 'admin' || u.role === 'owner'
                                  ? 'purple'
                                  : 'blue'
                            }
                          >
                            {roleLabels[u.role]}
                          </Badge>
                        </td>
                        <td>
                          {u.role === 'admin' || u.role === 'owner'
                            ? 'Все курсы'
                            : u.courseIds
                                .map((id) => data.courses.find((c) => c.id === id)?.title)
                                .filter(Boolean)
                                .join(', ') || 'Не назначены'}
                        </td>
                        <td>
                          <Status value={u.status} />
                        </td>
                        <td>
                          <Button
                            className="sm"
                            disabled={
                              u.role === 'owner' ||
                              u.id === data.user.id ||
                              (u.role === 'admin' && data.user.role !== 'owner')
                            }
                            onClick={() => open(u)}
                          >
                            <Pencil size={13} />
                            Доступ
                          </Button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {!employees.length && <Empty title="Пользователи не найдены" />}
          </Card>
        </>
      ) : (
        <Card className="flush">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Время</th>
                  <th>Пользователь</th>
                  <th>Действие</th>
                  <th>Объект</th>
                </tr>
              </thead>
              <tbody>
                {[...data.audit].reverse().map((a) => (
                  <tr key={a.id}>
                    <td>{formatDate(a.createdAt, true)}</td>
                    <td>{data.users.find((u) => u.id === a.actorId)?.name || 'Система'}</td>
                    <td>{auditLabels[a.action] || a.action}</td>
                    <td className="mono small">{a.entityId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.audit.length && <Empty title="В журнале пока нет событий" />}
        </Card>
      )}
      {edit && (
        <Modal title={`Доступ · ${edit.name}`} onClose={() => setEdit(null)}>
          <form onSubmit={save} className="form-stack">
            <Field label="Роль">
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {Object.entries(roleLabels)
                  .filter(
                    ([key]) => key !== 'owner' && (key !== 'admin' || data.user.role === 'owner'),
                  )
                  .map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
              </select>
            </Field>
            {role !== 'admin' && (
              <div>
                <h3>Учебные программы</h3>
                <div className="stack">
                  {data.courses.map((c) => (
                    <label className="check-label" key={c.id}>
                      <input
                        type="checkbox"
                        checked={scopes.includes(c.id)}
                        onChange={(e) =>
                          setScopes(
                            e.target.checked
                              ? [...scopes, c.id]
                              : scopes.filter((id) => id !== c.id),
                          )
                        }
                      />
                      {c.title} · {c.run}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="form-actions">
              <Button type="button" onClick={() => setEdit(null)}>
                Отмена
              </Button>
              <Button type="submit" variant="primary" busy={busy}>
                <ShieldCheck size={15} />
                Сохранить доступ
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
const auditLabels: Record<string, string> = {
  'user.roles_changed': 'Изменена роль',
  'review.confirmed': 'Подтверждена проверка',
  'rubric.published': 'Опубликована рубрика',
  'agent_config.published': 'Опубликована конфигурация',
  'model_endpoint.updated': 'Изменена модель',
  'submission.created': 'Работа отправлена',
  'review.assigned': 'Назначен ревьюер',
};

export function Models() {
  const data = useData();
  const { run, busy, toast } = useAction();
  const [edit, setEdit] = useState<ModelEndpoint | 'new' | null>(null);
  const [disable, setDisable] = useState<ModelEndpoint | null>(null);
  const [tab, setTab] = useState('models');
  const [group, setGroup] = useState('all');
  const affected = disable
    ? data.configs.filter(
        (c) =>
          c.status === 'published' &&
          Object.entries(c.tasks).some(
            ([type, task]) => type !== 'integrity_reasoning' && task.modelId === disable.id,
          ),
      )
    : [];
  return (
    <>
      <PageTitle
        title="Модели и настройки"
        eyebrow="Инфраструктура платформы"
        actions={
          <Button variant="primary" onClick={() => setEdit('new')}>
            <Plus size={16} />
            Подключить модель
          </Button>
        }
      />
      <div className="tabs">
        <button className={tab === 'models' ? 'active' : ''} onClick={() => setTab('models')}>
          Каталог моделей
        </button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
          Лимиты платформы
        </button>
      </div>
      {tab === 'models' ? (
        <>
          <div className="toolbar">
            <select
              aria-label="Группа моделей"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
            >
              <option value="all">Все группы</option>
              <option value="cheap">Быстрые</option>
              <option value="balanced">Сбалансированные</option>
              <option value="heavy">Сложные задачи</option>
            </select>
            <span className="spacer" />
            <span className="small muted">
              {data.models.filter((m) => m.enabled).length} активных моделей
            </span>
          </div>
          <div className="grid two">
            {data.models
              .filter((m) => group === 'all' || m.group === group)
              .map((m) => (
                <Card key={m.id} className="model-card">
                  <div className="row between">
                    <div>
                      <h3>{m.name}</h3>
                      <code>
                        {m.provider} / {m.modelName}
                      </code>
                    </div>
                    <Badge tone={m.enabled ? 'green' : ''}>
                      {m.enabled ? 'Включена' : 'Отключена'}
                    </Badge>
                  </div>
                  <dl className="detail-list">
                    <div>
                      <dt>Endpoint</dt>
                      <dd className="mono small">{m.baseUrl}</dd>
                    </div>
                    <div>
                      <dt>Группа</dt>
                      <dd>{m.group}</dd>
                    </div>
                    <div>
                      <dt>
                        Ключ{' '}
                        <Help text="Платформа хранит только имя переменной окружения. Значение API-ключа задаётся на сервере и не передаётся в браузер." />
                      </dt>
                      <dd>
                        <code>{m.apiKeyEnv || 'Без ключа'}</code>
                        <Badge tone={m.secretPresent ? 'green' : 'yellow'}>
                          {m.secretPresent ? 'Настроен' : 'Не задан'}
                        </Badge>
                      </dd>
                    </div>
                    <div>
                      <dt>Соединение</dt>
                      <dd>
                        <Status value={m.health || 'missing'} />
                      </dd>
                    </div>
                  </dl>
                  <footer>
                    <Button onClick={() => setEdit(m)}>
                      <Pencil size={13} />
                      Настроить
                    </Button>
                    <Button
                      busy={busy}
                      onClick={async () => {
                        const result = await run<{
                          ok?: boolean;
                          message?: string;
                          health?: string;
                        }>(`/admin/models/${m.id}/probe`, {}, 'POST', '');
                        if (result)
                          toast(
                            result.message ||
                              (result.ok || result.health === 'ok'
                                ? 'Соединение установлено'
                                : 'Соединение недоступно'),
                            !result.ok && result.health !== 'ok',
                          );
                      }}
                    >
                      <RefreshCw size={13} />
                      Проверить
                    </Button>
                    <Button
                      variant={m.enabled ? 'ghost' : 'secondary'}
                      onClick={() =>
                        m.enabled
                          ? setDisable(m)
                          : run(
                              `/admin/models/${m.id}`,
                              { enabled: true },
                              'PATCH',
                              'Модель включена',
                            )
                      }
                      busy={busy}
                    >
                      {m.enabled ? <Pause size={13} /> : <Play size={13} />}
                      {m.enabled ? 'Отключить' : 'Включить'}
                    </Button>
                  </footer>
                </Card>
              ))}
          </div>
          {!data.models.length && (
            <Card>
              <Empty
                title="Подключите первую модель"
                detail="Добавьте Gemma через Google AI Studio или другую модель. Ключ доступа указывается в окружении сервера."
              />
            </Card>
          )}
        </>
      ) : (
        <Card>
          <h2>Глобальные лимиты</h2>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              await run(
                '/admin/settings',
                {
                  maxFileMb: Number(f.get('maxFileMb')),
                  maxFiles: Number(f.get('maxFiles')),
                  maxReviewTokens: Number(f.get('maxReviewTokens')),
                },
                'PATCH',
              );
            }}
          >
            <div className="grid three">
              <Field label="Размер одного файла, МБ">
                <input
                  type="number"
                  min={1}
                  max={100}
                  name="maxFileMb"
                  defaultValue={data.settings.maxFileMb}
                  required
                />
              </Field>
              <Field label="Файлов в работе">
                <input
                  type="number"
                  min={1}
                  max={1000}
                  name="maxFiles"
                  defaultValue={data.settings.maxFiles}
                  required
                />
              </Field>
              <Field label="Токенов на проверку">
                <input
                  type="number"
                  min={1000}
                  max={1000000}
                  name="maxReviewTokens"
                  defaultValue={data.settings.maxReviewTokens}
                  required
                />
              </Field>
            </div>
            <div className="notice">
              Режим обработки: <b>{data.settings.mode}</b>
            </div>
            <div className="form-actions">
              <Button variant="primary" busy={busy} type="submit">
                Сохранить лимиты
              </Button>
            </div>
          </form>
        </Card>
      )}
      {edit && <ModelForm model={edit} onClose={() => setEdit(null)} />}
      {disable && (
        <Modal title={`Отключить ${disable.name}?`} onClose={() => setDisable(null)}>
          <p className="small">
            Завершённые проверки сохранят свои настройки. Новые запуски с этой моделью потребуют
            изменения конфигурации.
          </p>
          <h3>Затронутые конфигурации: {affected.length}</h3>
          {affected.map((c) => (
            <p key={c.id} className="small">
              <Link to={`/expert/${c.assignmentId}`}>
                {data.assignments.find((a) => a.id === c.assignmentId)?.title} · v{c.version}
              </Link>
            </p>
          ))}
          <div className="form-actions">
            <Button onClick={() => setDisable(null)}>Отмена</Button>
            <Button
              variant="danger"
              busy={busy}
              onClick={async () => {
                const r = await run(
                  `/admin/models/${disable.id}/disable`,
                  {},
                  'POST',
                  'Модель отключена',
                );
                if (r) setDisable(null);
              }}
            >
              Отключить
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
const providerPresets: Record<
  string,
  { label: string; baseUrl: string; apiKeyEnv: string; modelName: string; format: string }
> = {
  gemini: {
    label: 'Gemma · Google AI Studio',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeyEnv: 'GEMINI_API_KEY',
    modelName: 'gemma-4-31b-it',
    format: 'text',
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    modelName: 'gpt-4.1-mini',
    format: 'schema',
  },
  openai_compatible: {
    label: 'OpenAI-совместимый API',
    baseUrl: '',
    apiKeyEnv: 'MODEL_API_KEY',
    modelName: '',
    format: 'json',
  },
  lm_studio: {
    label: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    apiKeyEnv: 'LM_STUDIO_API_KEY',
    modelName: '',
    format: 'json',
  },
  vllm: { label: 'vLLM', baseUrl: '', apiKeyEnv: 'VLLM_API_KEY', modelName: '', format: 'json' },
  ollama: {
    label: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    apiKeyEnv: 'OLLAMA_API_KEY',
    modelName: '',
    format: 'json',
  },
  private: {
    label: 'Приватный API',
    baseUrl: '',
    apiKeyEnv: 'MODEL_API_KEY',
    modelName: '',
    format: 'json',
  },
};

function ModelForm({ model, onClose }: { model: ModelEndpoint | 'new'; onClose: () => void }) {
  const m = model === 'new' ? null : model;
  const { run, busy } = useAction();
  const [connection, setConnection] = useState(() => ({
    provider: m?.provider || 'gemini',
    name: m?.name || providerPresets.gemini.label,
    baseUrl: m?.baseUrl || providerPresets.gemini.baseUrl,
    modelName: m?.modelName || providerPresets.gemini.modelName,
    apiKeyEnv: m?.apiKeyEnv || 'GEMINI_API_KEY',
    format: m
      ? m.capabilities.jsonSchema
        ? 'schema'
        : (m.capabilities.jsonMode ?? m.provider !== 'gemini')
          ? 'json'
          : 'text'
      : 'text',
  }));
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      name: f.get('name'),
      provider: f.get('provider'),
      group: f.get('group'),
      baseUrl: f.get('baseUrl'),
      modelName: f.get('modelName'),
      apiKeyEnv: f.get('apiKeyEnv'),
      enabled: f.get('enabled') === 'on',
      defaultParams: {
        temperature: Number(f.get('temperature')),
        maxOutputTokens: Number(f.get('maxOutputTokens')),
        timeoutSeconds: Number(f.get('timeoutSeconds')),
        maxRetries: Number(f.get('maxRetries')),
      },
      capabilities: {
        jsonSchema: connection.format === 'schema',
        jsonMode: connection.format !== 'text',
        maxContextTokens: Number(f.get('maxContextTokens')),
      },
    };
    const r = await run(
      `/admin/models${m ? `/${m.id}` : ''}`,
      body,
      m ? 'PATCH' : 'POST',
      'Модель сохранена',
    );
    if (r) onClose();
  }
  return (
    <Modal title={m ? 'Настроить модель' : 'Подключить модель'} wide onClose={onClose}>
      <form onSubmit={save} className="form-stack">
        <div className="grid two">
          <Field label="Название в каталоге">
            <input
              name="name"
              value={connection.name}
              onChange={(e) => setConnection({ ...connection, name: e.target.value })}
              required
            />
          </Field>
          <Field label="Провайдер">
            <select
              name="provider"
              value={connection.provider}
              onChange={(e) => {
                const preset = providerPresets[e.target.value];
                setConnection({
                  provider: e.target.value,
                  name: preset.label,
                  baseUrl: preset.baseUrl,
                  modelName: preset.modelName,
                  apiKeyEnv: preset.apiKeyEnv,
                  format: preset.format,
                });
              }}
            >
              {Object.entries(providerPresets).map(([p, preset]) => (
                <option key={p} value={p}>
                  {preset.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Base URL">
          <input
            type="url"
            name="baseUrl"
            value={connection.baseUrl}
            onChange={(e) => setConnection({ ...connection, baseUrl: e.target.value })}
            required
          />
        </Field>
        <div className="grid two">
          <Field label="Имя модели у провайдера">
            <input
              name="modelName"
              value={connection.modelName}
              onChange={(e) => setConnection({ ...connection, modelName: e.target.value })}
              placeholder="Имя из каталога провайдера"
              required
            />
          </Field>
          <Field label="Группа">
            <select name="group" defaultValue={m?.group || 'balanced'}>
              <option value="cheap">cheap · быстрая</option>
              <option value="balanced">balanced · сбалансированная</option>
              <option value="heavy">heavy · сложные задачи</option>
            </select>
          </Field>
        </div>
        <Field
          label="Переменная окружения с ключом"
          hint="Например GEMINI_API_KEY. Сам секрет задаётся в .env сервера и никогда не вводится в этой форме."
        >
          <input
            name="apiKeyEnv"
            value={connection.apiKeyEnv}
            onChange={(e) => setConnection({ ...connection, apiKeyEnv: e.target.value })}
            pattern="[A-Z][A-Z0-9_]*"
            required
          />
        </Field>
        <div className="grid three">
          <Field label="Temperature по умолчанию">
            <input
              type="number"
              name="temperature"
              defaultValue={m?.defaultParams.temperature ?? 0.2}
              min={0}
              max={2}
              step="0.1"
              required
            />
          </Field>
          <Field label="Макс. выходных токенов">
            <input
              type="number"
              name="maxOutputTokens"
              defaultValue={m?.defaultParams.maxOutputTokens || 4000}
              min={128}
              max={32768}
              required
            />
          </Field>
          <Field label="Размер контекста">
            <input
              type="number"
              name="maxContextTokens"
              defaultValue={m?.capabilities.maxContextTokens || 32768}
              min={1024}
              max={1000000}
              required
            />
          </Field>
        </div>
        <div className="grid two">
          <Field label="Таймаут, секунд">
            <input
              name="timeoutSeconds"
              type="number"
              defaultValue={m?.defaultParams.timeoutSeconds || 90}
              min={5}
              max={600}
              required
            />
          </Field>
          <Field label="Повторов при ошибке">
            <input
              name="maxRetries"
              type="number"
              defaultValue={m?.defaultParams.maxRetries ?? 2}
              min={0}
              max={5}
              required
            />
          </Field>
        </div>
        <Field
          label="Формат ответа"
          hint="Для Gemma оставьте JSON по инструкции: сервер проверит структуру и доказательства в ответе. Режимы JSON и JSON Schema включайте только при их поддержке API выбранной модели."
        >
          <select
            name="responseFormat"
            value={connection.format}
            onChange={(e) => setConnection({ ...connection, format: e.target.value })}
          >
            <option value="text">JSON по инструкции</option>
            <option value="json">JSON mode</option>
            <option value="schema">JSON Schema</option>
          </select>
        </Field>
        <div className="row wrap">
          <label className="check-label">
            <input type="checkbox" name="enabled" defaultChecked={m?.enabled ?? true} />
            Включена
          </label>
        </div>
        <div className="form-actions">
          <Button type="button" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            Сохранить
          </Button>
        </div>
      </form>
    </Modal>
  );
}

interface Plan {
  assignments: { submissionId: string; reviewerId: string }[];
  unassignedIds: string[];
}
export function Coordinator() {
  const data = useData();
  const { run, busy } = useAction();
  const [course, setCourse] = useState('all');
  const [capacity, setCapacity] = useState<User | null>(null);
  const [assign, setAssign] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const assignments = data.assignments.filter((a) => course === 'all' || a.courseId === course);
  const submissions = data.submissions.filter(
    (s) =>
      !['confirmed', 'feedback_sent'].includes(s.status) &&
      assignments.some((a) => a.id === s.assignmentId),
  );
  const reviewers = data.users.filter(
    (u) => u.role === 'reviewer' && (course === 'all' || u.courseIds.includes(course)),
  );
  const load = (id: string) =>
    data.submissions
      .filter((s) => s.reviewerId === id && !['confirmed', 'feedback_sent'].includes(s.status))
      .reduce(
        (n, s) =>
          n + (data.assignments.find((a) => a.id === s.assignmentId)?.estimatedMinutes || 0),
        0,
      );
  const reviewerName = (id: string) => data.users.find((u) => u.id === id)?.name || '—';
  return (
    <>
      <PageTitle
        title="Распределение работ"
        eyebrow="Кабинет координатора"
        help="Работы распределяются по доступности, курсам и оставшемуся времени ревьюера. Перед применением можно проверить предложение."
        actions={
          <Button
            variant="primary"
            busy={busy}
            onClick={async () => {
              const p = await run<Plan>(
                '/coordinator/assignments/rebalance',
                { preview: true, courseId: course === 'all' ? null : course },
                'POST',
                '',
              );
              if (p) setPlan(p);
            }}
          >
            <Users size={16} />
            Распределить работы
          </Button>
        }
      />
      <div className="grid four">
        <Metric label="На проверке" value={submissions.length} tone="blue" />
        <Metric
          label="Не назначено"
          value={submissions.filter((s) => !s.reviewerId).length}
          tone="purple"
        />
        <Metric
          label="Просрочены"
          value={
            submissions.filter(
              (s) =>
                +new Date(assignments.find((a) => a.id === s.assignmentId)!.reviewDueAt) <
                Date.now(),
            ).length
          }
          tone="red"
        />
        <Metric
          label="Свободное время"
          value={`${Math.round((reviewers.filter((u) => u.available).reduce((n, u) => n + Math.max(0, u.capacityMinutes - load(u.id)), 0) / 60) * 10) / 10} ч`}
          tone="green"
        />
      </div>
      <div className="toolbar section-gap">
        <select
          aria-label="Курс для распределения"
          value={course}
          onChange={(e) => setCourse(e.target.value)}
        >
          <option value="all">Все курсы</option>
          {data.courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </div>
      <div className="grid three">
        {reviewers.map((u) => (
          <Card key={u.id} className="workload-card">
            <div className="person">
              <span className="avatar">{initials(u.name)}</span>
              <div>
                <b className="small">{u.name}</b>
                <small className="muted" style={{ display: 'block', fontSize: 10 }}>
                  {u.available ? 'Доступен для назначения' : 'Недоступен'}
                </small>
              </div>
            </div>
            <div className="hours">
              {(load(u.id) / 60).toFixed(1)}
              <span> / {(u.capacityMinutes / 60).toFixed(1)} ч</span>
            </div>
            <div className={`progress ${load(u.id) > u.capacityMinutes ? 'red' : 'green'}`}>
              <i style={{ width: `${(load(u.id) / Math.max(1, u.capacityMinutes)) * 100}%` }} />
            </div>
            <footer>
              <small>
                {load(u.id) > u.capacityMinutes
                  ? 'Превышена нагрузка'
                  : `${Math.max(0, u.capacityMinutes - load(u.id))} мин свободно`}
              </small>
              <Button className="sm" onClick={() => setCapacity(u)}>
                <Settings2 size={13} />
                Нагрузка
              </Button>
            </footer>
          </Card>
        ))}
      </div>
      <Card className="flush section-gap">
        <div className="card-head">
          <h2>Работы</h2>
          <label className="check-label">
            <input
              type="checkbox"
              checked={onlyUnassigned}
              onChange={(e) => setOnlyUnassigned(e.target.checked)}
            />
            Только неназначенные
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Студент / задание</th>
                <th>Срок проверки</th>
                <th>Оценка времени</th>
                <th>Ревьюер</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {submissions
                .filter((s) => !onlyUnassigned || !s.reviewerId)
                .map((s) => {
                  const a = assignments.find((a) => a.id === s.assignmentId)!;
                  return (
                    <tr key={s.id}>
                      <td>
                        <b>{reviewerName(s.studentId)}</b>
                        <small>
                          {a.code} · {a.title}
                        </small>
                      </td>
                      <td>
                        {formatDate(a.reviewDueAt)}
                        {+new Date(a.reviewDueAt) < Date.now() && (
                          <small>
                            <Badge tone="red">Просрочено</Badge>
                          </small>
                        )}
                      </td>
                      <td>{a.estimatedMinutes} мин</td>
                      <td>
                        {s.reviewerId ? (
                          reviewerName(s.reviewerId)
                        ) : (
                          <Badge tone="yellow">Не назначен</Badge>
                        )}
                      </td>
                      <td>
                        <Button className="sm" onClick={() => setAssign(s.id)}>
                          {s.reviewerId ? 'Переназначить' : 'Назначить'}
                          <ArrowRight size={13} />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        {!submissions.length && <Empty title="Нет работ для распределения" />}
      </Card>
      {capacity && (
        <Modal title={`Нагрузка · ${capacity.name}`} onClose={() => setCapacity(null)}>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const r = await run(
                `/coordinator/reviewers/${capacity.id}`,
                {
                  capacityMinutes: Number(f.get('capacityMinutes')),
                  available: f.get('available') === 'on',
                },
                'PATCH',
              );
              if (r) setCapacity(null);
            }}
          >
            <Field label="Доступное время в неделю, минут">
              <input
                type="number"
                name="capacityMinutes"
                defaultValue={capacity.capacityMinutes}
                min={0}
                max={10080}
                required
              />
            </Field>
            <label className="check-label">
              <input type="checkbox" name="available" defaultChecked={capacity.available} />
              Доступен для назначения
            </label>
            <div className="form-actions">
              <Button type="submit" variant="primary" busy={busy}>
                Сохранить
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {assign && (
        <Modal title="Назначить ревьюера" onClose={() => setAssign(null)}>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const r = await run(
                `/coordinator/submissions/${assign}/assign`,
                { reviewerId: f.get('reviewerId') },
                'POST',
                'Ревьюер назначен',
              );
              if (r) setAssign(null);
            }}
          >
            <Field label="Ревьюер">
              <select name="reviewerId" required>
                <option value="">Выберите ревьюера</option>
                {reviewers
                  .filter(
                    (u) =>
                      u.available &&
                      u.courseIds.includes(
                        assignments.find(
                          (a) => a.id === submissions.find((s) => s.id === assign)?.assignmentId,
                        )?.courseId || '',
                      ),
                  )
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} · {Math.max(0, u.capacityMinutes - load(u.id))} мин свободно
                    </option>
                  ))}
              </select>
            </Field>
            <div className="form-actions">
              <Button type="button" onClick={() => setAssign(null)}>
                Отмена
              </Button>
              <Button type="submit" variant="primary" busy={busy}>
                Назначить
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {plan && (
        <Modal title="Предложение по распределению" wide onClose={() => setPlan(null)}>
          {plan.assignments.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Работа</th>
                    <th>Назначить</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.assignments.map((p) => {
                    const s = data.submissions.find((s) => s.id === p.submissionId);
                    return (
                      <tr key={p.submissionId}>
                        <td>
                          {reviewerName(s?.studentId || '')}
                          <small>
                            {data.assignments.find((a) => a.id === s?.assignmentId)?.code}
                          </small>
                        </td>
                        <td>{reviewerName(p.reviewerId)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="Нет подходящих назначений"
              detail="Проверьте доступность ревьюеров и свободное время."
            />
          )}
          {plan.unassignedIds.length > 0 && (
            <p className="notice yellow section-gap">
              Останутся без назначения: {plan.unassignedIds.length}. Не хватает доступного времени
              или подходящих ревьюеров.
            </p>
          )}
          <div className="form-actions">
            <Button onClick={() => setPlan(null)}>Закрыть</Button>
            <Button
              variant="primary"
              disabled={!plan.assignments.length}
              busy={busy}
              onClick={async () => {
                const r = await run(
                  '/coordinator/assignments/rebalance',
                  { assignments: plan.assignments },
                  'POST',
                  'Распределение применено',
                );
                if (r) setPlan(null);
              }}
            >
              <Check size={15} />
              Применить
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function Evals() {
  const data = useData();
  const { run, busy } = useAction();
  const [assignmentId, setAssignmentId] = useState(data.assignments[0]?.id || '');
  const [version, setVersion] = useState('');
  const [repetitions, setRepetitions] = useState(3);
  const [details, setDetails] = useState<string | null>(null);
  const configs = data.configs.filter(
    (c) => c.assignmentId === assignmentId && c.status !== 'archived',
  );
  const selected = data.evals.find((e) => e.id === details);
  const [filter, setFilter] = useState('all');
  const rows = data.evals.filter((e) => filter === 'all' || e.assignmentId === filter);
  const latest = rows.find((e) => e.status === 'completed');
  async function start(e: FormEvent) {
    e.preventDefault();
    await run(
      '/evals',
      { assignmentId, configVersion: Number(version || configs[0]?.version), repetitions },
      'POST',
      'Тестирование запущено',
    );
  }
  const pct = (v?: number) => (v === undefined || v === null ? '—' : `${Math.round(v * 100)}%`);
  return (
    <>
      <PageTitle
        title="Тестирование агента"
        eyebrow="Калибровочные примеры"
        help="Запуск оценивает слабое, среднее и хорошее решения по одной рубрике несколько раз. Метрики появятся только после реального завершения."
      />
      <Card>
        <form onSubmit={start} className="toolbar" style={{ margin: 0, alignItems: 'flex-end' }}>
          <Field label="Задание">
            <select
              value={assignmentId}
              required
              onChange={(e) => {
                setAssignmentId(e.target.value);
                setVersion('');
              }}
            >
              {data.assignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Версия конфигурации">
            <select
              value={version || configs[0]?.version || ''}
              required
              onChange={(e) => setVersion(e.target.value)}
            >
              {!configs.length && <option value="">Нет конфигурации</option>}
              {configs.map((c) => (
                <option key={c.id} value={c.version}>
                  v{c.version} · {c.status}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Повторов">
            <input
              type="number"
              min={1}
              max={10}
              value={repetitions}
              onChange={(e) => setRepetitions(Number(e.target.value))}
              style={{ width: 85 }}
              required
            />
          </Field>
          <span className="spacer" />
          <Button
            variant="primary"
            busy={busy}
            disabled={!configs.length || !assignmentId}
            type="submit"
          >
            <Play size={15} />
            Запустить тест
          </Button>
        </form>
      </Card>
      <div className="grid four section-gap">
        <Metric
          label="Порядок уровней"
          value={pct(latest?.metrics.orderingAccuracy)}
          tone="purple"
          detail="слабое < среднее < хорошее"
        />
        <Metric
          label="Разброс оценки"
          value={latest?.metrics.stability?.toFixed(2) ?? '—'}
          detail="между повторами"
        />
        <Metric
          label="Валидные ссылки на фрагменты"
          value={pct(latest?.metrics.anchorValidity)}
          tone="green"
        />
        <Metric label="Воздержания" value={pct(latest?.metrics.abstainRate)} />
      </div>
      {!latest && (
        <div className="notice section-gap">Нет завершённых запусков. Метрики ещё не измерены.</div>
      )}
      <div className="toolbar section-gap">
        <h2 style={{ margin: 0 }}>История запусков</h2>
        <span className="spacer" />
        <select
          aria-label="Фильтр запусков"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">Все задания</option>
          {data.assignments.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code}
            </option>
          ))}
        </select>
      </div>
      <Card className="flush">
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Задание / дата</th>
                  <th>Конфигурация</th>
                  <th>Повторы</th>
                  <th>Статус</th>
                  <th>Порядок уровней</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <b>{data.assignments.find((a) => a.id === e.assignmentId)?.code}</b>
                      <small>{formatDate(e.createdAt, true)}</small>
                    </td>
                    <td>v{e.configVersion}</td>
                    <td>{e.repetitions} × 3 уровня</td>
                    <td>
                      <Status value={e.status} />
                      {e.error && <small className="inline-error">{e.error}</small>}
                    </td>
                    <td>{pct(e.metrics.orderingAccuracy)}</td>
                    <td>
                      <Button className="sm" onClick={() => setDetails(e.id)}>
                        Подробнее
                        <ArrowRight size={13} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Запусков пока нет"
            detail="Добавьте материалы трёх уровней и настройте модели для задания."
          />
        )}
      </Card>
      {selected && <EvalDetails evaluation={selected} onClose={() => setDetails(null)} />}
    </>
  );
}
function EvalDetails({ evaluation: e, onClose }: { evaluation: EvalRun; onClose: () => void }) {
  const data = useData();
  return (
    <Modal
      title={`Тест · ${data.assignments.find((a) => a.id === e.assignmentId)?.code} · v${e.configVersion}`}
      wide
      onClose={onClose}
    >
      <div className="row between">
        <Status value={e.status} />
        <Button
          className="sm"
          disabled={!e.outputs.length}
          onClick={() =>
            downloadCsv(`eval-${e.id}.csv`, [
              ['Уровень', 'Повтор', 'Балл', 'Модель', 'Ошибка'],
              ...e.outputs.map((o) => [o.example, o.repetition, o.score, o.modelId, o.error]),
            ])
          }
        >
          <Download size={13} />
          CSV
        </Button>
      </div>
      {e.error && <div className="notice red section-gap">{e.error}</div>}
      {e.outputs.length ? (
        <div className="table-wrap section-gap">
          <table>
            <thead>
              <tr>
                <th>Уровень</th>
                <th>Повтор</th>
                <th>Оценка</th>
                <th>Модель</th>
              </tr>
            </thead>
            <tbody>
              {e.outputs.map((o, i) => (
                <tr key={i}>
                  <td>
                    {(
                      { weak: 'Слабое', medium: 'Среднее', good: 'Хорошее' } as Record<
                        string,
                        string
                      >
                    )[o.example] || o.example}
                    {o.error && <small>{o.error}</small>}
                  </td>
                  <td>{o.repetition}</td>
                  <td>{o.score ?? 'Воздержание'}</td>
                  <td>{data.models.find((m) => m.id === o.modelId)?.name || o.modelId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title={
            e.status === 'running' || e.status === 'queued'
              ? 'Тест выполняется'
              : 'Результатов пока нет'
          }
        />
      )}
      <dl className="detail-list">
        <div>
          <dt>Время выполнения</dt>
          <dd>{e.metrics.latencySeconds ? `${e.metrics.latencySeconds.toFixed(1)} с` : '—'}</dd>
        </div>
        <div>
          <dt>Использовано токенов</dt>
          <dd>{e.metrics.totalTokens ?? '—'}</dd>
        </div>
      </dl>
    </Modal>
  );
}
