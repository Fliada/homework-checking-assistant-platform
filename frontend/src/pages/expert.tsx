import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Archive,
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  FlaskConical,
  Plus,
  Save,
  Send,
  Trash2,
} from 'lucide-react';
import { useAction, useData } from '../context';
import {
  Badge,
  Button,
  Card,
  dateInput,
  Empty,
  Field,
  formatDate,
  Help,
  Modal,
  PageTitle,
  Status,
} from '../components/ui';
import {
  taskNames,
  type AgentConfig,
  type Assignment,
  type Criterion,
  type TaskType,
} from '../types';

export function Expert() {
  const { id } = useParams();
  const data = useData();
  const assignment = data.assignments.find((a) => a.id === id);
  const [tab, setTab] = useState('task');
  const canEdit = ['expert', 'admin', 'owner'].includes(data.user.role);
  if (!assignment)
    return (
      <Card>
        <Empty
          title="Задание недоступно"
          action={<Link to="/assignments">К списку заданий</Link>}
        />
      </Card>
    );
  const tabs = [
    ['task', 'Условие и сроки'],
    ['rubric', 'Критерии'],
    ['references', 'Материалы'],
    ...(canEdit
      ? [
          ['agent', 'Настройки агента'],
          ['quality', 'Предложения'],
        ]
      : []),
  ];
  return (
    <>
      <Link className="row small" to="/assignments">
        <ArrowLeft size={15} />
        Все задания
      </Link>
      <PageTitle
        title={assignment.title}
        eyebrow={`${data.courses.find((c) => c.id === assignment.courseId)?.title} · ${assignment.code}`}
        actions={<Status value={assignment.status} />}
      />
      <div className="tabs">
        {tabs.map(([key, text]) => (
          <button className={tab === key ? 'active' : ''} key={key} onClick={() => setTab(key)}>
            {text}
          </button>
        ))}
      </div>
      {tab === 'task' && (
        <AssignmentForm key={assignment.id} assignment={assignment} canEdit={canEdit} />
      )}
      {tab === 'rubric' && (
        <RubricEditor
          key={`${assignment.id}-${assignment.rubricDraft?.id || assignment.rubric.id}`}
          assignment={assignment}
          canEdit={canEdit}
        />
      )}
      {tab === 'references' && <References assignment={assignment} canEdit={canEdit} />}
      {tab === 'agent' && canEdit && <ConfigVersions assignment={assignment} />}
      {tab === 'quality' && canEdit && <Flags assignment={assignment} />}
    </>
  );
}
function AssignmentForm({ assignment: a, canEdit }: { assignment: Assignment; canEdit: boolean }) {
  const { run, busy } = useAction();
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await run(
      `/assignments/${a.id}`,
      {
        title: form.get('title'),
        code: form.get('code'),
        taskText: form.get('taskText'),
        dueAt: new Date(String(form.get('dueAt'))).toISOString(),
        reviewDueAt: new Date(String(form.get('reviewDueAt'))).toISOString(),
        estimatedMinutes: Number(form.get('estimatedMinutes')),
      },
      'PATCH',
    );
  }
  async function late(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await run(
      `/assignments/${a.id}/late-policy`,
      {
        enabled: f.get('enabled') === 'on',
        type: f.get('type'),
        value: Number(f.get('value')),
        intervalDays: Number(f.get('intervalDays')),
      },
      'POST',
      'Правило просрочки сохранено',
    );
  }
  return (
    <div className="grid two">
      <Card>
        <h2>Задание</h2>
        <form onSubmit={save} className="form-stack">
          <Field label="Название">
            <input name="title" defaultValue={a.title} required disabled={!canEdit} />
          </Field>
          <Field label="Код">
            <input name="code" defaultValue={a.code} required disabled={!canEdit} />
          </Field>
          <Field label="Условие">
            <textarea
              name="taskText"
              defaultValue={a.taskText}
              rows={15}
              required
              disabled={!canEdit}
            />
          </Field>
          <div className="grid two">
            <Field label="Срок сдачи">
              <input
                type="datetime-local"
                name="dueAt"
                defaultValue={dateInput(a.dueAt)}
                required
                disabled={!canEdit}
              />
            </Field>
            <Field label="Срок проверки">
              <input
                type="datetime-local"
                name="reviewDueAt"
                defaultValue={dateInput(a.reviewDueAt)}
                required
                disabled={!canEdit}
              />
            </Field>
          </div>
          <Field label="Время на проверку, минут">
            <input
              type="number"
              name="estimatedMinutes"
              defaultValue={a.estimatedMinutes}
              min={1}
              max={1440}
              required
              disabled={!canEdit}
            />
          </Field>
          {canEdit && (
            <div className="form-actions">
              <Button type="submit" variant="primary" busy={busy}>
                <Save size={15} />
                Сохранить
              </Button>
            </div>
          )}
        </form>
      </Card>
      <div className="stack">
        <Card>
          <h2>
            Просрочка сдачи
            <Help text="Правило применяется только к опозданию студента. Просрочка ревьюера и сигналы ИИ не меняют оценку." />
          </h2>
          <form onSubmit={late} className="form-stack">
            <label className="check-label">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={a.latePolicy.enabled}
                disabled={!canEdit}
              />
              Применять снижение оценки
            </label>
            <Field label="Тип снижения">
              <select name="type" defaultValue={a.latePolicy.type} disabled={!canEdit}>
                <option value="fixed">Фиксированные баллы</option>
                <option value="percent">Процент от набранного балла</option>
              </select>
            </Field>
            <div className="grid two">
              <Field label="Значение">
                <input
                  type="number"
                  name="value"
                  defaultValue={a.latePolicy.value}
                  min={0}
                  max={100}
                  step="0.5"
                  required
                  disabled={!canEdit}
                />
              </Field>
              <Field label="За каждые дни просрочки">
                <input
                  type="number"
                  name="intervalDays"
                  defaultValue={a.latePolicy.intervalDays}
                  min={1}
                  max={365}
                  required
                  disabled={!canEdit}
                />
              </Field>
            </div>
            {canEdit && (
              <Button type="submit" busy={busy}>
                Сохранить правило
              </Button>
            )}
          </form>
        </Card>
        <Card>
          <h2>Версии</h2>
          <dl className="detail-list">
            <div>
              <dt>Рубрика</dt>
              <dd>
                v{a.rubric.version} <Status value={a.rubric.status} />
              </dd>
            </div>
            <div>
              <dt>Конфигурация агента</dt>
              <dd>{a.activeConfigVersion ? `v${a.activeConfigVersion}` : 'Не опубликована'}</dd>
            </div>
            <div>
              <dt>Материалы</dt>
              <dd>{a.references.length}</dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  );
}
function RubricEditor({ assignment: a, canEdit }: { assignment: Assignment; canEdit: boolean }) {
  const { run, busy } = useAction();
  const rubric = a.rubricDraft || a.rubric;
  const editable = canEdit && rubric.status === 'draft';
  const [criteria, setCriteria] = useState<Criterion[]>(structuredClone(rubric.criteria));
  const [dirty, setDirty] = useState(false);
  function update(id: string, value: Partial<Criterion>) {
    setCriteria((cs) => cs.map((c) => (c.id === id ? { ...c, ...value } : c)));
    setDirty(true);
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    const response = await run(
      rubric.id ? `/rubrics/${rubric.id}` : `/assignments/${a.id}/rubrics`,
      { criteria },
      rubric.id ? 'PATCH' : 'POST',
      'Черновик рубрики сохранён',
    );
    if (response) setDirty(false);
  }
  return (
    <Card>
      <div className="row between wrap">
        <div className="row">
          <h2 style={{ margin: 0 }}>Рубрика v{rubric.version}</h2>
          <Status value={rubric.status} />
          <Help text="Опубликованная рубрика не меняется. Новая версия применяется к новым проверкам; прежние результаты сохраняют свою рубрику." />
        </div>
        {canEdit && !editable && (
          <Button
            onClick={() =>
              run(
                `/assignments/${a.id}/rubrics`,
                { criteria: a.rubric.criteria },
                'POST',
                'Черновик создан',
              )
            }
            busy={busy}
          >
            <Copy size={15} />
            Новая версия
          </Button>
        )}
      </div>
      <form onSubmit={save}>
        <div className="section-gap">
          {criteria.length ? (
            criteria.map((c) => (
              <div key={c.id} className="criterion-editor">
                <Field label="Критерий">
                  <input
                    value={c.title}
                    required
                    onChange={(e) => update(c.id, { title: e.target.value })}
                    disabled={!editable}
                  />
                </Field>
                <Field label="Баллы">
                  <input
                    type="number"
                    min={0.5}
                    max={1000}
                    step="0.5"
                    value={c.maxScore}
                    required
                    onChange={(e) => update(c.id, { maxScore: Number(e.target.value) })}
                    disabled={!editable}
                  />
                </Field>
                <Field label="Способ проверки">
                  <select
                    value={c.mode}
                    onChange={(e) => update(c.id, { mode: e.target.value as Criterion['mode'] })}
                    disabled={!editable}
                  >
                    <option value="llm">Модель</option>
                    <option value="deterministic_or_llm">CI или модель</option>
                    <option value="deterministic">CI / проверка кодом</option>
                    <option value="human">Человек</option>
                    <option value="external">Внешний источник</option>
                  </select>
                </Field>
                {editable && (
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={`Удалить критерий ${c.title}`}
                    onClick={() => {
                      setCriteria((cs) => cs.filter((x) => x.id !== c.id));
                      setDirty(true);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
                <div className="description grid two">
                  <Field label="Описание">
                    <textarea
                      value={c.description}
                      onChange={(e) => update(c.id, { description: e.target.value })}
                      disabled={!editable}
                    />
                  </Field>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={c.required}
                      onChange={(e) => update(c.id, { required: e.target.checked })}
                      disabled={!editable}
                    />
                    Обязательный критерий
                  </label>
                </div>
              </div>
            ))
          ) : (
            <Empty title="Добавьте критерии оценки" />
          )}
        </div>
        <div className="row between section-gap">
          <strong className="small">
            Всего: {criteria.reduce((s, c) => s + c.maxScore, 0)} баллов
          </strong>
          {editable && (
            <Button
              type="button"
              onClick={() => {
                setCriteria((cs) => [
                  ...cs,
                  {
                    id: crypto.randomUUID(),
                    title: '',
                    description: '',
                    maxScore: 1,
                    mode: 'llm',
                    required: true,
                  },
                ]);
                setDirty(true);
              }}
            >
              <Plus size={15} />
              Критерий
            </Button>
          )}
        </div>
        {editable && (
          <div className="form-actions">
            <Button type="submit" busy={busy} disabled={!criteria.length || !dirty}>
              <Save size={15} />
              Сохранить черновик
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={dirty || !criteria.length || !rubric.id}
              busy={busy}
              onClick={() =>
                run(`/rubrics/${rubric.id}/publish`, {}, 'POST', 'Новая рубрика опубликована')
              }
            >
              <Send size={15} />
              Опубликовать
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}
function ConfigVersions({ assignment }: { assignment: Assignment }) {
  const { configs } = useData();
  const { run, busy } = useAction();
  const versions = configs
    .filter((c) => c.assignmentId === assignment.id)
    .sort((a, b) => b.version - a.version);
  const [version, setVersion] = useState<number | null>(null);
  const config = versions.find((c) => c.version === version) || versions[0];
  return (
    <div className="stack">
      <Card>
        <div className="row between wrap">
          <div>
            <h2 style={{ marginBottom: 5 }}>
              Конфигурация агента
              <Help text="Каждый этап использует отдельную модель, промпт и параметры. Проверка сохраняет версию конфигурации, с которой была запущена." />
            </h2>
            <span className="small muted">
              Активная версия:{' '}
              {assignment.activeConfigVersion ? `v${assignment.activeConfigVersion}` : 'нет'}
            </span>
          </div>
          <div className="row">
            <select
              aria-label="Версия конфигурации"
              value={config?.version || ''}
              onChange={(e) => setVersion(Number(e.target.value))}
            >
              {versions.map((v) => (
                <option key={v.id} value={v.version}>
                  v{v.version} · {v.status}
                </option>
              ))}
            </select>
            <Button
              busy={busy}
              onClick={async () => {
                const c = await run<AgentConfig>(
                  `/assignments/${assignment.id}/agent-config/versions`,
                  {},
                  'POST',
                  'Черновик конфигурации создан',
                );
                if (c) setVersion(c.version);
              }}
            >
              <Copy size={15} />
              Новая версия
            </Button>
          </div>
        </div>
      </Card>
      {config ? (
        <ConfigEditor key={config.id} config={config} />
      ) : (
        <Card>
          <Empty
            title="Настройте агента для задания"
            detail="Создайте первую версию и выберите модели из каталога."
          />
        </Card>
      )}
      <Card>
        <h2>История версий</h2>
        <div className="version-list">
          {versions.map((v) => (
            <div key={v.id} className="version-row">
              <button className="small" onClick={() => setVersion(v.version)}>
                <b>Версия {v.version}</b>
              </button>
              <Status value={v.status} />
              <span className="date">{formatDate(v.publishedAt || v.createdAt, true)}</span>
              {v.status !== 'published' && v.status !== 'archived' && (
                <Button
                  className="sm"
                  busy={busy}
                  onClick={() =>
                    run(
                      `/assignments/${assignment.id}/agent-config/versions/${v.version}/archive`,
                      {},
                      'POST',
                      'Версия архивирована',
                    )
                  }
                >
                  <Archive size={13} />В архив
                </Button>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
function ConfigEditor({ config }: { config: AgentConfig }) {
  const { models } = useData();
  const { run, busy } = useAction();
  const [tasks, setTasks] = useState(structuredClone(config.tasks));
  const [thresholds, setThresholds] = useState(structuredClone(config.thresholds));
  const [task, setTask] = useState<TaskType>('criterion_evaluation');
  const [dirty, setDirty] = useState(false);
  const editable = ['draft', 'evaluated'].includes(config.status);
  const current = tasks[task];
  const path = `/assignments/${config.assignmentId}/agent-config/versions/${config.version}`;
  function update(values: Partial<typeof current>) {
    setTasks((t) => ({ ...t, [task]: { ...t[task], ...values } }));
    setDirty(true);
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    const response = await run(
      path,
      { tasks, thresholds },
      'PATCH',
      'Настройки черновика сохранены',
    );
    if (response) setDirty(false);
  }
  return (
    <Card>
      <form onSubmit={save}>
        <div className="row between" style={{ marginBottom: 24 }}>
          <div className="row">
            <h2 style={{ margin: 0 }}>Версия {config.version}</h2>
            <Status value={config.status} />
          </div>
          {dirty && <Badge tone="yellow">Есть несохранённые изменения</Badge>}
        </div>
        <div className="config-layout">
          <div className="task-tabs">
            {Object.entries(taskNames).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={task === key ? 'active' : ''}
                onClick={() => setTask(key as TaskType)}
              >
                {label}
                <small>
                  {key === 'integrity_reasoning'
                    ? 'Не подключено'
                    : models.find((m) => m.id === tasks[key as TaskType]?.modelId)?.name ||
                      'Выберите модель'}
                </small>
              </button>
            ))}
          </div>
          {task === 'integrity_reasoning' ? (
            <Empty
              title="Модуль выявления ИИ не подключён"
              detail="Настройки этого этапа будут доступны после подключения модуля."
            />
          ) : current ? (
            <div className="form-stack">
              <Field label="Модель">
                <select
                  value={current.modelId}
                  required
                  onChange={(e) => update({ modelId: e.target.value })}
                  disabled={!editable}
                >
                  <option value="">Выберите модель</option>
                  {models
                    .filter((m) => m.enabled || m.id === current.modelId)
                    .map((m) => (
                      <option key={m.id} value={m.id} disabled={!m.enabled}>
                        {m.name} · {m.group}
                        {m.enabled ? '' : ' · отключена'}
                      </option>
                    ))}
                </select>
              </Field>
              {current.modelId && !models.find((m) => m.id === current.modelId)?.enabled && (
                <div className="notice red">
                  Модель отключена. Выберите доступную модель перед публикацией.
                </div>
              )}
              <Field
                label="Промпт этапа"
                hint="Системные правила и контекст работы добавляются на сервере. Здесь задаются инструкции конкретного этапа."
              >
                <textarea
                  className="config-prompt"
                  value={current.prompt}
                  required
                  disabled={!editable}
                  onChange={(e) => update({ prompt: e.target.value })}
                />
              </Field>
              <div className="grid three">
                <Field label="Temperature">
                  <input
                    type="number"
                    value={current.temperature}
                    min={0}
                    max={2}
                    step="0.1"
                    disabled={!editable}
                    onChange={(e) => update({ temperature: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Top P">
                  <input
                    type="number"
                    value={current.topP}
                    min={0.01}
                    max={1}
                    step="0.05"
                    disabled={!editable}
                    onChange={(e) => update({ topP: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Макс. токенов">
                  <input
                    type="number"
                    value={current.maxOutputTokens}
                    min={128}
                    max={32768}
                    step={128}
                    disabled={!editable}
                    onChange={(e) => update({ maxOutputTokens: Number(e.target.value) })}
                  />
                </Field>
              </div>
            </div>
          ) : (
            <Empty title="Этап не настроен" />
          )}
        </div>
        <div className="grid two section-gap">
          <Field
            label="Порог воздержания"
            hint="Если уверенность ниже порога, агент оставляет решение ревьюеру."
          >
            <input
              type="number"
              min={0}
              max={1}
              step="0.05"
              value={thresholds.abstain}
              disabled={!editable}
              onChange={(e) => {
                setThresholds((t) => ({ ...t, abstain: Number(e.target.value) }));
                setDirty(true);
              }}
            />
          </Field>
          <Field label="Порог дополнительной проверки">
            <input
              type="number"
              min={0}
              max={1}
              step="0.05"
              value={thresholds.critic}
              disabled={!editable}
              onChange={(e) => {
                setThresholds((t) => ({ ...t, critic: Number(e.target.value) }));
                setDirty(true);
              }}
            />
          </Field>
        </div>
        {editable && (
          <div className="form-actions">
            <Button type="submit" busy={busy} disabled={!dirty}>
              <Save size={15} />
              Сохранить
            </Button>
            <Button
              type="button"
              busy={busy}
              disabled={dirty}
              onClick={() =>
                run(`${path}/eval`, { repetitions: 3 }, 'POST', 'Тестирование запущено')
              }
            >
              <FlaskConical size={15} />
              Проверить на примерах
            </Button>
            <Button
              type="button"
              busy={busy}
              variant="primary"
              disabled={dirty}
              onClick={() => run(`${path}/publish`, {}, 'POST', 'Конфигурация опубликована')}
            >
              <Send size={15} />
              Опубликовать
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}
function References({ assignment, canEdit }: { assignment: Assignment; canEdit: boolean }) {
  const { run, busy } = useAction();
  const [add, setAdd] = useState(false);
  const names: Record<string, string> = {
    reference: 'Эталон',
    weak: 'Слабое',
    medium: 'Среднее',
    good: 'Хорошее',
    guide: 'Инструкция',
  };
  return (
    <>
      <Card>
        <div className="row between">
          <h2 style={{ margin: 0 }}>
            Материалы задания
            <Help text="Эталон необязателен. Слабое, среднее и хорошее решения используются для калибровки и тестирования агента." />
          </h2>
          {canEdit && (
            <Button onClick={() => setAdd(true)}>
              <Plus size={15} />
              Добавить
            </Button>
          )}
        </div>
        {assignment.references.length ? (
          assignment.references.map((r) => (
            <div className="reference-row" key={r.id}>
              <Badge tone="purple">{names[r.type]}</Badge>
              <div className="grow">
                <b>{r.name}</b>
                <a
                  className="small"
                  style={{ display: 'block', marginTop: 5 }}
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {r.url}
                  <ExternalLink size={11} />
                </a>
              </div>
              {canEdit && (
                <Button
                  className="sm"
                  aria-label={`Удалить ${r.name}`}
                  busy={busy}
                  onClick={() =>
                    run(
                      `/assignments/${assignment.id}/references/${r.id}`,
                      undefined,
                      'DELETE',
                      'Материал удалён',
                    )
                  }
                >
                  <Trash2 size={15} />
                </Button>
              )}
            </div>
          ))
        ) : (
          <Empty
            title="Материалы не добавлены"
            detail="Можно начать с одной рубрики и добавить калибровочные примеры позже."
          />
        )}
      </Card>
      {add && (
        <Modal title="Добавить материал" onClose={() => setAdd(false)}>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const response = await run(
                `/assignments/${assignment.id}/references`,
                Object.fromEntries(new FormData(e.currentTarget)),
                'POST',
                'Материал добавлен',
              );
              if (response) setAdd(false);
            }}
          >
            <Field label="Тип">
              <select name="type">
                {Object.entries(names).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Название">
              <input name="name" required />
            </Field>
            <Field label="Ссылка на файл или каталог GitHub">
              <input name="url" type="url" required placeholder="https://github.com/…" />
            </Field>
            <div className="form-actions">
              <Button type="button" onClick={() => setAdd(false)}>
                Отмена
              </Button>
              <Button type="submit" variant="primary" busy={busy}>
                Добавить
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function Flags({ assignment }: { assignment: Assignment }) {
  const { flags } = useData();
  const { run, busy } = useAction();
  const filtered = flags.filter((f) => f.assignmentId === assignment.id);
  return (
    <Card>
      <h2>Предложения ревьюеров</h2>
      {filtered.length ? (
        filtered.map((f) => (
          <article className="annotation" key={f.id}>
            <div className="row between">
              <b className="small">
                {assignment.rubric.criteria.find((c) => c.id === f.criterionId)?.title || 'Задание'}
              </b>
              <Status value={f.status} />
            </div>
            <p>{f.message}</p>
            <div className="row between">
              <small className="muted">{formatDate(f.createdAt, true)}</small>
              {f.status === 'pending' && (
                <div className="row">
                  <Button
                    className="sm"
                    busy={busy}
                    onClick={() =>
                      run(
                        `/expert/rubric-flags/${f.id}/decision`,
                        { decision: 'accepted' },
                        'POST',
                        'Предложение принято в работу',
                      )
                    }
                  >
                    <Check size={13} />
                    Принять
                  </Button>
                  <Button
                    className="sm"
                    busy={busy}
                    onClick={() =>
                      run(
                        `/expert/rubric-flags/${f.id}/decision`,
                        { decision: 'rejected' },
                        'POST',
                        'Предложение отклонено',
                      )
                    }
                  >
                    Отклонить
                  </Button>
                </div>
              )}
            </div>
          </article>
        ))
      ) : (
        <Empty
          title="Предложений пока нет"
          detail="Ревьюеры могут предложить уточнение критерия во время проверки работы."
        />
      )}
    </Card>
  );
}
