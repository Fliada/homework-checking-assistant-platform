import { useState, type FormEvent } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { AgentNotes } from './courses';
import {
  ArrowRight,
  Bell,
  CheckCheck,
  Download,
  ExternalLink,
  FileText,
  GitPullRequest,
  Plus,
  RefreshCw,
  Search,
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
import type { Assignment, Submission } from '../types';

const complete = (status: string) => ['confirmed', 'feedback_sent'].includes(status);
export function Ledger() {
  const data = useData();
  const { run, busy } = useAction();
  const [course, setCourse] = useState('all');
  const [assignment, setAssignment] = useState('all');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('attention');
  const [view, setView] = useState('list');
  const assignments = data.assignments.filter((a) => course === 'all' || a.courseId === course);
  const latestSubmissions = data.submissions.filter(
    (s) =>
      !data.submissions.some(
        (other) =>
          other.studentId === s.studentId &&
          other.assignmentId === s.assignmentId &&
          other.attempt > s.attempt,
      ),
  );
  const filtered = latestSubmissions.filter(
    (s) =>
      assignments.some((a) => a.id === s.assignmentId) &&
      (assignment === 'all' || s.assignmentId === assignment) &&
      (status === 'all' ||
        (status === 'done'
          ? complete(s.status)
          : status === 'todo'
            ? !complete(s.status)
            : s.status === status)) &&
      (data.users.find((u) => u.id === s.studentId)?.name || '')
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const urgent = (s: Submission) => {
    const review = data.reviews.find((r) => r.submissionId === s.id);
    return (
      (complete(s.status) ? -100 : 0) +
      (s.error ? 20 : 0) +
      (review?.results.filter((r) => r.abstained).length || 0) * 2 +
      (new Date(
        data.assignments.find((a) => a.id === s.assignmentId)?.reviewDueAt || '',
      ).getTime() < Date.now()
        ? 5
        : 0)
    );
  };
  const rows = [...filtered].sort((a, b) =>
    sort === 'attention'
      ? urgent(b) - urgent(a)
      : sort === 'newest'
        ? +new Date(b.submittedAt) - +new Date(a.submittedAt)
        : +new Date(data.assignments.find((x) => x.id === a.assignmentId)!.reviewDueAt) -
          +new Date(data.assignments.find((x) => x.id === b.assignmentId)!.reviewDueAt),
  );
  const active = filtered.filter((s) => !complete(s.status));
  const overdue = active.filter(
    (s) =>
      +new Date(data.assignments.find((a) => a.id === s.assignmentId)!.reviewDueAt) < Date.now(),
  );
  function exportRows() {
    downloadCsv('Ведомость.csv', [
      [
        'Студент',
        'Задание',
        'Попытка',
        'Статус',
        'Черновой балл',
        'Итоговый балл',
        'Срок проверки',
        'PR',
      ],
      ...rows.map((s) => {
        const a = data.assignments.find((a) => a.id === s.assignmentId)!;
        const r = data.reviews.find((r) => r.id === s.reviewId);
        return [
          data.users.find((u) => u.id === s.studentId)?.name,
          a.title,
          s.attempt,
          s.status,
          r?.draftScore,
          r?.finalScore,
          a.reviewDueAt,
          s.prUrl,
        ];
      }),
    ]);
  }
  return (
    <>
      <PageTitle
        title="Ведомость"
        eyebrow="Проверка домашних работ"
        help="Очередь внимания поднимает работы без уверенной оценки и с истекающим сроком проверки."
        actions={
          <Button onClick={exportRows}>
            <Download size={16} />
            Экспорт CSV
          </Button>
        }
      />
      <div className="grid four">
        <Metric
          label="Ожидают проверки"
          value={active.length}
          detail="в выбранной области"
          tone="blue"
        />
        <Metric
          label="Нужен разбор"
          value={
            active.filter(
              (s) =>
                /human|error/.test(s.status) ||
                data.reviews.find((r) => r.id === s.reviewId)?.results.some((r) => r.abstained),
            ).length
          }
          detail="есть вопросы по критериям"
          tone="purple"
        />
        <Metric label="Просрочены" value={overdue.length} detail="по сроку проверки" tone="red" />
        <Metric
          label="Проверено"
          value={filtered.filter((s) => complete(s.status)).length}
          detail="решение подтверждено"
          tone="green"
        />
      </div>
      <div className="section-gap toolbar">
        <select
          aria-label="Курс"
          value={course}
          onChange={(e) => {
            setCourse(e.target.value);
            setAssignment('all');
          }}
        >
          <option value="all">Все курсы</option>
          {data.courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title} · {c.run}
            </option>
          ))}
        </select>
        <select
          aria-label="Задание"
          value={assignment}
          onChange={(e) => setAssignment(e.target.value)}
        >
          <option value="all">Все задания</option>
          {assignments.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} · {a.title}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <div className="pill-tabs">
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
            Очередь
          </button>
          <button className={view === 'matrix' ? 'active' : ''} onClick={() => setView('matrix')}>
            По студентам
          </button>
        </div>
      </div>
      <Card className="flush">
        <div className="card-head">
          <div className="search-field">
            <Search size={16} />
            <input
              aria-label="Поиск студента"
              placeholder="Найти студента"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="row wrap">
            <select
              aria-label="Статус работы"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">Все статусы</option>
              <option value="todo">На проверку</option>
              <option value="done">Проверенные</option>
              <option value="needs_human">Нужна ручная проверка</option>
              <option value="configuration_error">Ошибка конфигурации</option>
            </select>
            <select aria-label="Сортировка" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="attention">По приоритету</option>
              <option value="due">По дедлайну</option>
              <option value="newest">Сначала новые</option>
            </select>
          </div>
        </div>
        {!rows.length ? (
          <Empty title="Работы не найдены" detail="Измените фильтры или дождитесь новых сдач." />
        ) : view === 'matrix' ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Студент</th>
                  {assignments.map((a) => (
                    <th key={a.id}>{a.code}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.users
                  .filter((u) => rows.some((s) => s.studentId === u.id))
                  .map((u) => (
                    <tr key={u.id}>
                      <td>
                        <b>{u.name}</b>
                      </td>
                      {assignments.map((a) => {
                        const s = rows
                          .filter((s) => s.studentId === u.id && s.assignmentId === a.id)
                          .sort((a, b) => b.attempt - a.attempt)[0];
                        const r = data.reviews.find((r) => r.id === s?.reviewId);
                        return (
                          <td key={a.id}>
                            {s ? (
                              r ? (
                                <Link to={`/review/${r.id}`}>
                                  {r.finalScore ?? r.draftScore ?? '—'} /{' '}
                                  {r.rubric.criteria.reduce((n, c) => n + c.maxScore, 0)}
                                  <small>
                                    <Status value={s.status} />
                                  </small>
                                </Link>
                              ) : (
                                <Status value={s.status} />
                              )
                            ) : (
                              <span className="muted">Не сдано</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Студент / задание</th>
                  <th>Статус</th>
                  <th>
                    Балл{' '}
                    <Help text="До подтверждения показан только черновой балл. Пустая оценка требует решения ревьюера." />
                  </th>
                  <th>Проверить до</th>
                  <th>Ревьюер</th>
                  <th>
                    Что заметил агент{' '}
                    <Help text="Замечания агента и критерии, требующие решения человека. Это черновик до подтверждения ревьюером." />
                  </th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const a = data.assignments.find((a) => a.id === s.assignmentId)!;
                  const r = data.reviews.find((r) => r.id === s.reviewId);
                  const u = data.users.find((u) => u.id === s.studentId);
                  return (
                    <tr key={s.id}>
                      <td>
                        <div className="person">
                          <span className="avatar">{initials(u?.name || '?')}</span>
                          <div>
                            <b>{u?.name || 'Студент'}</b>
                            <small>
                              {a.code} · {a.title} · попытка {s.attempt}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <Status value={s.status} />
                        {s.error && <small className="inline-error">{s.error}</small>}
                      </td>
                      <td>
                        <b>{r?.finalScore ?? r?.draftScore ?? '—'}</b>
                        <span className="muted">
                          {' '}
                          / {a.rubric.criteria.reduce((n, c) => n + c.maxScore, 0)}
                        </span>
                        <small>{complete(s.status) ? 'Итоговый' : 'Черновик'}</small>
                      </td>
                      <td>
                        <span
                          className={
                            +new Date(a.reviewDueAt) < Date.now() && !complete(s.status)
                              ? 'inline-error'
                              : ''
                          }
                        >
                          {formatDate(a.reviewDueAt)}
                        </span>
                        <small>Сдано {formatDate(s.submittedAt)}</small>
                      </td>
                      <td>
                        {data.users.find((u) => u.id === s.reviewerId)?.name || 'Не назначен'}
                      </td>
                      <td>
                        <AgentNotes review={r} />
                      </td>
                      <td>
                        {r ? (
                          <Link className="btn sm" to={`/review/${r.id}`}>
                            Открыть <ArrowRight size={14} />
                          </Link>
                        ) : /error|human|failed/.test(s.status) ? (
                          <Button
                            className="sm"
                            busy={busy}
                            onClick={() =>
                              run(
                                `/submissions/${s.id}/reprocess`,
                                {},
                                'POST',
                                'Повторная загрузка запущена',
                              )
                            }
                          >
                            <RefreshCw size={14} />
                            Повторить
                          </Button>
                        ) : (
                          <span className="muted small">Ожидаем файлы</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-footer">
          <span>{rows.length} работ</span>
          <span>Данные обновляются автоматически</span>
        </div>
      </Card>
    </>
  );
}
export function Assignments() {
  const data = useData();
  const [course, setCourse] = useState('all');
  const [newAssignment, setNewAssignment] = useState(false);
  const [newCourse, setNewCourse] = useState(false);
  const { run, busy } = useAction();
  const canEdit = ['expert', 'admin', 'owner'].includes(data.user.role);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget));
    const result = await run(
      newCourse ? '/courses' : `/courses/${form.courseId}/assignments`,
      form,
      'POST',
      newCourse ? 'Курс создан' : 'Задание создано',
    );
    if (result) {
      setNewAssignment(false);
      setNewCourse(false);
    }
  }
  return (
    <>
      <PageTitle
        title="Задания и критерии"
        eyebrow="Учебные программы"
        actions={
          canEdit && (
            <>
              <Button onClick={() => setNewCourse(true)}>
                <Plus size={16} />
                Курс
              </Button>
              <Button
                variant="primary"
                onClick={() => setNewAssignment(true)}
                disabled={!data.courses.length}
              >
                <Plus size={16} />
                Задание
              </Button>
            </>
          )
        }
      />
      <div className="toolbar">
        <select aria-label="Курс" value={course} onChange={(e) => setCourse(e.target.value)}>
          <option value="all">Все курсы</option>
          {data.courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title} · {c.run}
            </option>
          ))}
        </select>
      </div>
      {data.assignments.length ? (
        <div className="grid three">
          {data.assignments
            .filter((a) => course === 'all' || a.courseId === course)
            .map((a) => (
              <Card key={a.id} className="assignment-card">
                <div className="row between">
                  <Badge tone="purple">{a.code}</Badge>
                  <Status value={a.status} />
                </div>
                <h2>{a.title}</h2>
                <span className="muted small">
                  {data.courses.find((c) => c.id === a.courseId)?.title}
                </span>
                <div className="meta">
                  <span>
                    Сдача до<b>{formatDate(a.dueAt)}</b>
                  </span>
                  <span>
                    Проверка до<b>{formatDate(a.reviewDueAt)}</b>
                  </span>
                </div>
                <div className="assignment-bottom">
                  <span className="muted small">
                    {a.rubric.criteria.length} критериев ·{' '}
                    {a.rubric.criteria.reduce((n, c) => n + c.maxScore, 0)} баллов
                  </span>
                  <Link to={`/expert/${a.id}`} className="btn sm">
                    {canEdit ? 'Настроить' : 'Открыть'}
                    <ArrowRight size={14} />
                  </Link>
                </div>
              </Card>
            ))}
        </div>
      ) : (
        <Card>
          <Empty title="Добавьте первое задание" />
        </Card>
      )}
      {(newAssignment || newCourse) && (
        <Modal
          title={newCourse ? 'Новый курс' : 'Новое задание'}
          onClose={() => {
            setNewAssignment(false);
            setNewCourse(false);
          }}
        >
          <form onSubmit={create} className="form-stack">
            {!newCourse && (
              <Field label="Курс">
                <select name="courseId" required>
                  {data.courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Название">
              <input name="title" required maxLength={160} />
            </Field>
            {newCourse ? (
              <>
                <Field label="Поток">
                  <input name="run" placeholder="Осень 2026" required />
                </Field>
                {['admin', 'owner'].includes(data.user.role) && (
                  <Field label="Ответственный эксперт">
                    <select name="expertId" required>
                      <option value="">Выберите эксперта</option>
                      {data.users
                        .filter((u) => ['expert', 'admin', 'owner'].includes(u.role))
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}
              </>
            ) : (
              <>
                <Field label="Код задания">
                  <input name="code" placeholder="GO / task1" required />
                </Field>
                <div className="grid two">
                  <Field label="Срок сдачи">
                    <input name="dueAt" type="datetime-local" required />
                  </Field>
                  <Field label="Срок проверки">
                    <input name="reviewDueAt" type="datetime-local" required />
                  </Field>
                </div>
                <Field label="Условие">
                  <textarea name="taskText" required rows={5} />
                </Field>
              </>
            )}
            <div className="form-actions">
              <Button
                onClick={() => {
                  setNewAssignment(false);
                  setNewCourse(false);
                }}
                type="button"
              >
                Отмена
              </Button>
              <Button busy={busy} variant="primary" type="submit">
                Создать
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
export function Student() {
  const data = useData();
  const [params] = useSearchParams();
  const visibleAssignments = data.assignments.filter(
    (a) =>
      (!params.get('course') || a.courseId === params.get('course')) &&
      (!params.get('assignment') || a.id === params.get('assignment')),
  );
  const { run, busy } = useAction();
  const [selected, setSelected] = useState<Assignment | null>(null);
  const [details, setDetails] = useState<Assignment | null>(null);
  const [result, setResult] = useState<Submission | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const response = await run(
      '/submissions/github',
      { assignmentId: selected!.id, prUrl: form.get('prUrl') },
      'POST',
      'Работа отправлена на проверку',
    );
    if (response) setSelected(null);
  }
  const own = data.submissions.filter((s) => s.studentId === data.user.id);
  const latest = own.filter(
    (s) =>
      visibleAssignments.some((a) => a.id === s.assignmentId) &&
      !own.some((other) => other.assignmentId === s.assignmentId && other.attempt > s.attempt),
  );
  const done = latest.filter((s) => complete(s.status));
  const r = data.reviews.find((r) => r.id === result?.reviewId);
  return (
    <>
      {params.get('course') && (
        <Link className="back-link" to={`/courses/${params.get('course')}`}>
          ← К курсу
        </Link>
      )}
      <PageTitle
        title="Мои задания"
        eyebrow={data.courses.map((c) => c.title).join(' · ') || 'Учебные программы'}
      />
      <div className="grid three">
        <Metric label="Всего заданий" value={visibleAssignments.length} tone="purple" />
        <Metric
          label="На проверке"
          value={latest.filter((s) => !complete(s.status)).length}
          tone="blue"
        />
        <Metric label="Результатов получено" value={done.length} tone="green" />
      </div>
      <div className="grid two section-gap">
        {visibleAssignments.map((a) => {
          const attempts = own
            .filter((s) => s.assignmentId === a.id)
            .sort((a, b) => b.attempt - a.attempt);
          const latest = attempts[0];
          const review = data.reviews.find((r) => r.id === latest?.reviewId);
          return (
            <Card key={a.id} className="assignment-card">
              <div className="row between">
                <Badge tone="purple">{a.code}</Badge>
                {latest ? <Status value={latest.status} /> : <Badge>Не сдано</Badge>}
              </div>
              <h2>{a.title}</h2>
              <div className="meta">
                <span>
                  Сдать до<b>{formatDate(a.dueAt, true)}</b>
                </span>
                <span>
                  Результат до<b>{formatDate(a.reviewDueAt)}</b>
                </span>
              </div>
              <div className="timeline">
                {['Задание', 'Сдано', 'Проверка', 'Результат'].map((t, i) => (
                  <div
                    key={t}
                    className={
                      i === 0 || (latest && (i < 3 || complete(latest.status))) ? 'done' : ''
                    }
                  >
                    {t}
                  </div>
                ))}
              </div>
              {latest?.error && <div className="notice yellow">{latest.error}</div>}
              {latest && (
                <div className="row between">
                  <a href={latest.prUrl} target="_blank" rel="noreferrer" className="row small">
                    <GitPullRequest size={15} />
                    Попытка {latest.attempt}
                    <ExternalLink size={12} />
                  </a>
                  {complete(latest.status) && (
                    <strong>
                      {review?.finalScore ?? '—'} /{' '}
                      {a.rubric.criteria.reduce((n, c) => n + c.maxScore, 0)}
                    </strong>
                  )}
                </div>
              )}
              <div className="assignment-bottom row wrap">
                <Button variant="ghost" onClick={() => setDetails(a)}>
                  <FileText size={15} />
                  Условие
                </Button>
                {latest && complete(latest.status) ? (
                  <div className="row">
                    <Button onClick={() => setSelected(a)}>Доработать</Button>
                    <Button variant="primary" onClick={() => setResult(latest)}>
                      Результат
                      <ArrowRight size={14} />
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="primary"
                    disabled={!!latest && !/failed|error|human/.test(latest.status)}
                    onClick={() => setSelected(a)}
                  >
                    <GitPullRequest size={15} />
                    {latest ? 'Повторить отправку' : 'Сдать работу'}
                  </Button>
                )}
              </div>
              {attempts.length > 1 && (
                <details className="small">
                  <summary>Предыдущие попытки ({attempts.length - 1})</summary>
                  {attempts.slice(1).map((s) => (
                    <div className="row between section-gap" key={s.id}>
                      <span>
                        Попытка {s.attempt} · {formatDate(s.submittedAt)}
                      </span>
                      <Status value={s.status} />
                      {complete(s.status) && (
                        <Button className="sm" onClick={() => setResult(s)}>
                          Результат
                        </Button>
                      )}
                    </div>
                  ))}
                </details>
              )}
            </Card>
          );
        })}
      </div>
      {!data.assignments.length && (
        <Card>
          <Empty
            title="Задания пока не назначены"
            detail="После добавления в учебную группу здесь появятся задания и сроки сдачи."
          />
        </Card>
      )}
      {selected && (
        <Modal title={`Сдать ${selected.code}`} onClose={() => setSelected(null)}>
          <form onSubmit={submit} className="form-stack">
            <p className="small">{selected.title}</p>
            <Field label="Ссылка на GitHub Pull Request">
              <input
                type="url"
                name="prUrl"
                required
                pattern="https://github\.com/[^/]+/[^/]+/pull/[0-9]+/?"
                placeholder="https://github.com/organization/repository/pull/1"
              />
              <small>Работа оценивается по рубрике выбранного задания.</small>
            </Field>
            <div className="form-actions">
              <Button type="button" onClick={() => setSelected(null)}>
                Отмена
              </Button>
              <Button variant="primary" busy={busy} type="submit">
                Отправить
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {details && (
        <Modal title={details.title} wide onClose={() => setDetails(null)}>
          <div className="task-text">{details.taskText}</div>
          <h3 className="section-gap">Критерии · версия {details.rubric.version}</h3>
          {details.rubric.criteria.map((c) => (
            <div className="criterion-result" key={c.id}>
              <header>
                <h3>{c.title}</h3>
                <Badge>{c.maxScore} бал.</Badge>
              </header>
              <p>{c.description}</p>
            </div>
          ))}
        </Modal>
      )}
      {result && (
        <Modal title="Результат проверки" wide onClose={() => setResult(null)}>
          {r && complete(result.status) ? (
            <>
              <div className="review-score">
                <div>
                  <h2>{data.assignments.find((a) => a.id === result.assignmentId)?.title}</h2>
                  <p className="small muted">
                    Попытка {result.attempt} · {formatDate(r.confirmedAt)}
                  </p>
                </div>
                <strong>
                  {r.finalScore}
                  <small> / {r.rubric.criteria.reduce((s, c) => s + c.maxScore, 0)}</small>
                </strong>
              </div>
              <div className="feedback">{r.feedback}</div>
              <h3 className="section-gap">По критериям</h3>
              {r.results.map((cr) => (
                <div className="row between criterion-result" key={cr.criterionId}>
                  <span className="small">
                    {r.rubric.criteria.find((c) => c.id === cr.criterionId)?.title}
                  </span>
                  <b>
                    {cr.finalScore} /{' '}
                    {r.rubric.criteria.find((c) => c.id === cr.criterionId)?.maxScore}
                  </b>
                </div>
              ))}
            </>
          ) : (
            <Empty title="Результат ещё не подтверждён" />
          )}
        </Modal>
      )}
    </>
  );
}
export function Notifications() {
  const { notifications } = useData();
  const { run, busy } = useAction();
  const [onlyUnread, setOnlyUnread] = useState(false);
  const visible = notifications.filter((n) => !onlyUnread || !n.read);
  return (
    <>
      <PageTitle
        title="Уведомления"
        eyebrow="События платформы"
        actions={
          <Button
            busy={busy}
            disabled={!notifications.some((n) => !n.read)}
            onClick={() => run('/notifications/read-all', {}, 'POST', 'Уведомления прочитаны')}
          >
            <CheckCheck size={16} />
            Прочитать все
          </Button>
        }
      />
      <div className="toolbar">
        <label className="check-label">
          <input
            type="checkbox"
            checked={onlyUnread}
            onChange={(e) => setOnlyUnread(e.target.checked)}
          />
          Только непрочитанные
        </label>
        <span className="spacer" />
        <Badge tone="purple">В сервисе</Badge>
      </div>
      <Card className="flush">
        {visible.length ? (
          visible.map((n) => (
            <article className={`notification ${n.read ? '' : 'unread'}`} key={n.id}>
              <span className={n.read ? 'read-dot' : 'unread-dot'} />
              <div>
                <h3>{n.title}</h3>
                <p>{n.message}</p>
                <time>{formatDate(n.createdAt, true)}</time>
              </div>
              <div className="actions">
                {n.href && (
                  <Link className="btn sm" to={n.href}>
                    Открыть
                    <ArrowRight size={13} />
                  </Link>
                )}
                {!n.read && (
                  <Button
                    className="sm"
                    busy={busy}
                    onClick={() => run(`/notifications/${n.id}/read`, {}, 'POST', '')}
                  >
                    <CheckCheck size={14} />
                  </Button>
                )}
              </div>
            </article>
          ))
        ) : (
          <Empty
            title="Новых уведомлений нет"
            detail="Здесь появятся назначения работ, результаты проверки и изменения конфигурации."
            action={<Bell size={20} />}
          />
        )}
      </Card>
    </>
  );
}
export function Analytics() {
  const data = useData();
  const [course, setCourse] = useState('all');
  const assignments = data.assignments.filter((a) => course === 'all' || a.courseId === course);
  const submissions = data.submissions.filter((s) =>
    assignments.some((a) => a.id === s.assignmentId),
  );
  const reviews = data.reviews.filter((r) => submissions.some((s) => s.id === r.submissionId));
  const final = reviews.filter((r) => complete(r.status));
  const annotations = reviews.flatMap((r) => r.annotations);
  const results = reviews.flatMap((r) => r.results);
  const decided = results.filter((r) => r.confirmed && r.suggestedScore !== null);
  const edited = decided.filter((r) => r.finalScore !== r.suggestedScore);
  const cycle = final
    .map(
      (r) =>
        (+new Date(r.confirmedAt!) -
          +new Date(submissions.find((s) => s.id === r.submissionId)!.submittedAt)) /
        3600000,
    )
    .sort((a, b) => a - b);
  const p50 = cycle.length ? cycle[Math.floor((cycle.length - 1) * 0.5)] : null;
  const p90 = cycle.length ? cycle[Math.ceil((cycle.length - 1) * 0.9)] : null;
  return (
    <>
      <PageTitle
        title="Аналитика"
        eyebrow="Процесс и качество проверки"
        help="Метрики рассчитаны по сохранённым проверкам. Пока проверок нет, значения не подменяются прогнозами."
      />
      <div className="toolbar">
        <select
          aria-label="Курс для аналитики"
          value={course}
          onChange={(e) => setCourse(e.target.value)}
        >
          <option value="all">Все курсы</option>
          {data.courses.map((c) => (
            <option value={c.id} key={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <span className="small muted">{final.length} завершённых проверок</span>
      </div>
      <div className="grid four">
        <Metric
          label="От сдачи до результата · P50"
          value={p50 === null ? '—' : `${p50.toFixed(1)} ч`}
          tone="blue"
        />
        <Metric
          label="От сдачи до результата · P90"
          value={p90 === null ? '—' : `${p90.toFixed(1)} ч`}
          tone="purple"
        />
        <Metric
          label="Правки оценок"
          value={decided.length ? `${Math.round((edited.length / decided.length) * 100)}%` : '—'}
          detail={`${edited.length} из ${decided.length} решений`}
        />
        <Metric
          label="Воздержания агента"
          value={
            results.length
              ? `${Math.round((results.filter((r) => r.abstained).length / results.length) * 100)}%`
              : '—'
          }
          detail="критерии без уверенной оценки"
        />
      </div>
      <div className="grid two section-gap">
        <Card>
          <h2>Движение работ</h2>
          {[
            ['Получено', submissions.length],
            ['Черновик / проверка', reviews.filter((r) => !complete(r.status)).length],
            ['Нужен человек', submissions.filter((s) => /human|error/.test(s.status)).length],
            ['Подтверждено', final.length],
          ].map(([label, count]) => (
            <div className="distribution-row" key={label}>
              <span>{label}</span>
              <div className="progress">
                <i
                  style={{ width: `${(Number(count) / Math.max(1, submissions.length)) * 100}%` }}
                />
              </div>
              <strong>{count}</strong>
            </div>
          ))}
        </Card>
        <Card>
          <h2>Решения по замечаниям</h2>
          {[
            ['Принято', 'accepted'],
            ['Изменено', 'edited'],
            ['Отклонено', 'rejected'],
            ['Ожидает решения', 'pending'],
          ].map(([label, status]) => {
            const count = annotations.filter((a) => a.status === status).length;
            return (
              <div className="distribution-row" key={status}>
                <span>{label}</span>
                <div className="progress green">
                  <i style={{ width: `${(count / Math.max(1, annotations.length)) * 100}%` }} />
                </div>
                <strong>{count}</strong>
              </div>
            );
          })}
        </Card>
      </div>
      <Card className="section-gap flush">
        <div className="card-head">
          <h2>Согласованность по критериям</h2>
          <Help text="Сравнение предложенной и окончательной оценки помогает найти критерии, требующие уточнения." />
        </div>
        {decided.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Критерий</th>
                  <th>Решений</th>
                  <th>Изменено</th>
                  <th>Средняя разница</th>
                </tr>
              </thead>
              <tbody>
                {assignments.flatMap((a) =>
                  a.rubric.criteria.map((c) => {
                    const group = decided.filter((r) => r.criterionId === c.id);
                    return group.length ? (
                      <tr key={`${a.id}-${c.id}`}>
                        <td>
                          <b>{c.title}</b>
                          <small>{a.code}</small>
                        </td>
                        <td>{group.length}</td>
                        <td>
                          {Math.round(
                            (group.filter((r) => r.finalScore !== r.suggestedScore).length /
                              group.length) *
                              100,
                          )}
                          %
                        </td>
                        <td>
                          {(
                            group.reduce((s, r) => s + r.finalScore! - r.suggestedScore!, 0) /
                            group.length
                          ).toFixed(2)}
                        </td>
                      </tr>
                    ) : null;
                  }),
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Пока нет подтверждённых оценок"
            detail="После проверки работ появятся расхождения с черновиком агента."
          />
        )}
      </Card>
    </>
  );
}
