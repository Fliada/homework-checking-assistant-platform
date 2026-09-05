import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, BookOpen, Check, Clock } from 'lucide-react';
import { api } from '../api';
import { useData } from '../context';
import {
  Badge,
  Card,
  Empty,
  ErrorState,
  formatDate,
  Help,
  Loading,
  Metric,
  PageTitle,
  Status,
} from '../components/ui';
import { SimilarityPanel } from './similarity';
import type { Course, Review } from '../types';

type Counts = {
  completed?: number;
  checking?: number;
  attention?: number;
  missing?: number;
  overdue?: number;
};
type AgentNote = { text: string; detail: string; tone: string };
type ProgressRow = {
  studentId: string;
  studentName: string;
  state: string;
  status: string;
  overdue: boolean;
  submissionId: string | null;
  reviewId: string | null;
  submittedAt: string | null;
  attempt: number;
  score: number | null;
  maxScore: number | null;
  lateDays: number | null;
  agentNotes: AgentNote[];
  similarityComments: string[];
};
type HomeworkProgress = {
  id: string;
  code: string;
  title: string;
  dueAt: string;
  reviewDueAt: string;
  counts: Counts;
  total: number;
  waitingMinutes: number;
  rows: ProgressRow[];
};
export type CourseProgress = {
  course: Course;
  studentCount: number;
  assignmentCount: number;
  total: number;
  counts: Counts;
  completionPercent: number;
  assignments: HomeworkProgress[];
  points: {
    student: string;
    assignmentId: string;
    code: string;
    scorePercent: number;
    lateDays: number | null;
    reviewId: string | null;
  }[];
  weakCriteria: { assignment: string; title: string; averagePercent: number; count: number }[];
};
export function AgentNotes({ notes, review }: { notes?: AgentNote[]; review?: Review }) {
  const items =
    notes ??
    (review
      ? [
          ...review.results
            .filter(
              (r) =>
                !r.confirmed &&
                !['confirmed', 'feedback_sent'].includes(review.status) &&
                (r.abstained || (r.confidence > 0 && r.confidence < 0.6)),
            )
            .map((r) => ({
              text: `${r.abstained ? 'Нужно решение человека' : 'Низкая уверенность'}: ${review.rubric.criteria.find((c) => c.id === r.criterionId)?.title || 'критерий'}`,
              detail: r.reason,
              tone: 'yellow',
            })),
          ...review.annotations
            .filter((a) => a.source === 'ai' && a.status !== 'rejected')
            .map((a) => ({ text: a.message, detail: a.message, tone: 'blue' })),
        ]
      : []);
  const visible = items.length
    ? items
    : review?.results
        .filter((r) => r.reason)
        .slice(0, 2)
        .map((r) => ({
          text: r.reason,
          detail: r.reason,
          tone: r.confidence >= 0.8 ? 'green' : 'blue',
        })) || [];
  return (
    <div className="agent-notes">
      {visible.length ? (
        visible.slice(0, 3).map((n, i) => (
          <span key={i} title={n.detail}>
            <Badge tone={n.tone}>{n.text.length > 150 ? `${n.text.slice(0, 150)}…` : n.text}</Badge>
          </span>
        ))
      ) : (
        <span className="muted small">Пока нет замечаний</span>
      )}
    </div>
  );
}
function ProgressBar({ counts, total }: { counts: Counts; total: number }) {
  return (
    <div
      className="course-progress-bar"
      role="img"
      aria-label={`Проверено ${counts.completed || 0} из ${total}, проверяется ${(counts.checking || 0) + (counts.attention || 0)}`}
    >
      {(['completed', 'checking', 'attention'] as const).map((k) => (
        <span
          key={k}
          className={k}
          style={{ width: `${total ? ((counts[k] || 0) / total) * 100 : 0}%` }}
        />
      ))}
    </div>
  );
}
export function Courses() {
  const { user } = useData();
  const query = useQuery({
    queryKey: ['courses', user.id],
    queryFn: () => api<CourseProgress[]>('/courses/progress'),
    refetchInterval: 8000,
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} retry={() => query.refetch()} />;
  return (
    <>
      <PageTitle
        title={user.role === 'student' ? 'Мои курсы' : 'Курсы и потоки'}
        eyebrow="Учебные программы"
        help="Прогресс считается по последней попытке каждого задания. Задание выполнено после подтверждения проверки человеком."
      />
      {!query.data.length ? (
        <Card>
          <Empty
            title="Курсы ещё не назначены"
            detail="После зачисления здесь появятся задания и прогресс обучения."
          />
        </Card>
      ) : (
        <div className="grid two course-grid">
          {query.data.map((p) => (
            <Card key={p.course.id} className="course-card">
              <div className="row between">
                <span className="course-icon">
                  <BookOpen size={24} />
                </span>
                <Badge tone="blue">Поток {p.course.run}</Badge>
              </div>
              <h2>
                <Link to={`/courses/${p.course.id}`}>{p.course.title}</Link>
              </h2>
              <div className="row between">
                <span className="muted">
                  {p.assignmentCount} заданий
                  {user.role !== 'student' ? ` · ${p.studentCount} студентов` : ''}
                </span>
                <strong>{p.completionPercent}%</strong>
              </div>
              <ProgressBar counts={p.counts} total={p.total} />
              <div className="course-mini-stats">
                <span>
                  <Check size={16} /> {p.counts.completed || 0} выполнено
                </span>
                <span>
                  <Clock size={16} /> {(p.counts.checking || 0) + (p.counts.attention || 0)}{' '}
                  проверяется
                </span>
                <span>{p.counts.missing || 0} не сдано</span>
              </div>
              <div className="row between">
                <span className="small muted">
                  {p.counts.overdue
                    ? `Не сдано в срок: ${p.counts.overdue}`
                    : 'Сроки и результаты по заданиям'}
                </span>
                <Link className="btn primary" to={`/courses/${p.course.id}`}>
                  Открыть курс <ArrowRight size={16} />
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
export function CourseDetail() {
  const { id } = useParams();
  const { user } = useData();
  const [tab, setTab] = useState('homework');
  const [selected, setSelected] = useState('all');
  const query = useQuery({
    queryKey: ['course-progress', id, user.id],
    queryFn: () => api<CourseProgress>(`/courses/${id}/progress`),
    refetchInterval: 8000,
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} retry={() => query.refetch()} />;
  const p = query.data;
  const student = user.role === 'student';
  const assignments = p.assignments.filter((a) => selected === 'all' || a.id === selected);
  const canSimilarity = ['expert', 'reviewer', 'admin', 'owner'].includes(user.role);
  return (
    <>
      <Link to="/courses" className="back-link">
        ← Все курсы
      </Link>
      <PageTitle
        title={p.course.title}
        eyebrow={`Поток ${p.course.run}`}
        help="Каждая ячейка — последняя отправка студента. Повторные попытки доступны в работе. Черновые оценки не входят в статистику успеваемости."
      />
      <div className="grid four">
        <Metric
          label="Выполнено"
          value={`${p.counts.completed || 0} / ${p.total}`}
          detail={<ProgressBar counts={p.counts} total={p.total} />}
          tone="green"
        />
        <Metric
          label="Проверяется"
          value={(p.counts.checking || 0) + (p.counts.attention || 0)}
          detail={
            p.counts.attention ? `Нужен разбор: ${p.counts.attention}` : 'Ожидаем итоговое решение'
          }
          tone="blue"
        />
        <Metric
          label="Не сдано"
          value={p.counts.missing || 0}
          detail={`Из них просрочено: ${p.counts.overdue || 0}`}
          tone="red"
        />
        <Metric
          label="Прогресс курса"
          value={`${p.completionPercent}%`}
          detail={
            student
              ? `${p.assignmentCount} домашних заданий`
              : `${p.studentCount} студентов в потоке`
          }
          tone="purple"
        />
      </div>
      {!student && (
        <div className="toolbar section-gap">
          <div className="pill-tabs">
            {[
              ['homework', 'Задания'],
              ['cohort', 'Поток'],
              ['analytics', 'Успеваемость'],
              ...(canSimilarity ? [['similarity', 'Сходство кода']] : []),
            ].map(([key, label]) => (
              <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
                {label}
              </button>
            ))}
          </div>
          <span className="spacer" />
          {tab !== 'similarity' && (
            <select
              aria-label="Задание курса"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="all">Все задания</option>
              {p.assignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.title}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {!p.assignments.length ? (
        <Card className="section-gap">
          <Empty title="Задания ещё не опубликованы" />
        </Card>
      ) : student ? (
        <div className="student-course-list section-gap">
          {p.assignments.map((a) => {
            const r = a.rows[0];
            return (
              <Card key={a.id} className="student-homework">
                <div className={`homework-step ${r?.state === 'completed' ? 'completed' : ''}`}>
                  {r?.state === 'completed' ? <Check /> : a.code}
                </div>
                <div className="homework-body">
                  <div className="row between wrap">
                    <h2>{a.title}</h2>
                    <Status value={r?.status || 'not_submitted'} />
                  </div>
                  <div className="course-mini-stats">
                    <span>Сдать до {formatDate(a.dueAt)}</span>
                    {r?.submittedAt && (
                      <span>
                        Отправлено {formatDate(r.submittedAt)} · попытка {r.attempt}
                      </span>
                    )}
                    {r?.score !== null && (
                      <b>
                        {r?.score} / {r?.maxScore} баллов
                      </b>
                    )}
                  </div>
                  {r?.overdue && <Badge tone="red">Срок сдачи прошёл</Badge>}
                  {r?.similarityComments.map((c, i) => (
                    <div className="human-similarity-comment" key={i}>
                      <b>Комментарий проверяющего</b>
                      <p>{c}</p>
                    </div>
                  ))}
                </div>
                <Link className="btn" to={`/student?course=${p.course.id}&assignment=${a.id}`}>
                  {r?.state === 'completed'
                    ? 'Результат'
                    : r?.submissionId
                      ? 'Моя работа'
                      : 'Сдать работу'}{' '}
                  <ArrowRight size={15} />
                </Link>
              </Card>
            );
          })}
        </div>
      ) : tab === 'analytics' ? (
        <CourseCharts
          progress={{
            ...p,
            assignments,
            points: p.points.filter((pt) => selected === 'all' || pt.assignmentId === selected),
            weakCriteria: p.weakCriteria.filter(
              (c) => selected === 'all' || assignments.some((a) => a.code === c.assignment),
            ),
          }}
        />
      ) : tab === 'similarity' ? (
        <SimilarityPanel assignments={p.assignments} />
      ) : tab === 'cohort' ? (
        <Card className="flush">
          <div className="table-wrap">
            <table className="cohort-matrix">
              <thead>
                <tr>
                  <th>Студент</th>
                  {assignments.map((a) => (
                    <th key={a.id}>
                      {a.code}
                      <small>{a.title}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(assignments[0]?.rows || []).map((row) => (
                  <tr key={row.studentId}>
                    <td>
                      <b>{row.studentName}</b>
                    </td>
                    {assignments.map((a) => {
                      const r = a.rows.find((x) => x.studentId === row.studentId)!;
                      return (
                        <td key={a.id}>
                          {r.reviewId ? (
                            <Link to={`/review/${r.reviewId}`}>
                              <Status value={r.status} />
                              {r.score !== null && (
                                <small>
                                  {r.score} / {r.maxScore}
                                </small>
                              )}
                            </Link>
                          ) : (
                            <Status value={r.status} />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="course-homeworks">
          {assignments.map((a) => (
            <AssignmentCohort key={a.id} assignment={a} />
          ))}
        </div>
      )}
    </>
  );
}
function AssignmentCohort({ assignment: a }: { assignment: HomeworkProgress }) {
  const [filter, setFilter] = useState('all');
  const rows = a.rows.filter((r) => filter === 'all' || r.state === filter);
  return (
    <Card className="flush">
      <div className="card-head">
        <div>
          <h2>
            {a.code} · {a.title}
          </h2>
          <span className="muted small">
            Сдать до {formatDate(a.dueAt)} · проверить до {formatDate(a.reviewDueAt)}
          </span>
        </div>
        <select
          aria-label={`Статус ${a.code}`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">Все студенты</option>
          <option value="completed">Выполнено</option>
          <option value="checking">Проверяется</option>
          <option value="attention">Нужен разбор</option>
          <option value="missing">Не сдано</option>
        </select>
      </div>
      <div className="assignment-kpis">
        <span>
          <b>
            {a.counts.completed || 0} / {a.total}
          </b>{' '}
          проверено
        </span>
        <span>
          <b>{(a.counts.checking || 0) + (a.counts.attention || 0)}</b> ждут проверки{' '}
          <Help
            text={`Оценка оставшейся нагрузки: ${(a.waitingMinutes / 60).toFixed(1)} ч. Рассчитывается по нормативу времени задания.`}
          />
        </span>
        <span>
          <b>{a.counts.missing || 0}</b> не сдали
        </span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Студент</th>
              <th>Сдано</th>
              <th>Статус / балл</th>
              <th>
                Что заметил агент{' '}
                <Help text="Краткая сводка из критериев и замечаний агента. До подтверждения ревьюером это черновик." />
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.studentId}>
                <td>
                  <b>{r.studentName}</b>
                  {r.attempt > 0 && <small>Попытка {r.attempt}</small>}
                </td>
                <td>
                  {formatDate(r.submittedAt || '')}
                  {r.lateDays !== null && r.lateDays > 0 && (
                    <small>
                      <Badge tone="yellow">+{Math.ceil(r.lateDays)} дн.</Badge>
                    </small>
                  )}
                  {r.overdue && <Badge tone="red">Просрочено</Badge>}
                </td>
                <td>
                  <Status value={r.status} />
                  {r.score !== null && (
                    <small>
                      <b>{r.score}</b> / {r.maxScore}
                    </small>
                  )}
                </td>
                <td>
                  <AgentNotes notes={r.agentNotes} />
                </td>
                <td>
                  {r.reviewId && (
                    <Link className="btn sm" to={`/review/${r.reviewId}`}>
                      Открыть
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty title="Нет работ с таким статусом" />}
      </div>
    </Card>
  );
}
export function CourseCharts({ progress: p }: { progress: CourseProgress }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const points = p.points.filter((pt) => pt.lateDays !== null);
  const lo = Math.min(-1, ...points.map((p) => p.lateDays!));
  const hi = Math.max(1, ...points.map((p) => p.lateDays!));
  const x = (v: number) => 65 + ((v - lo) / (hi - lo)) * 615;
  return (
    <div className="course-charts">
      <Card>
        <div className="row">
          <h2>Разброс результатов</h2>
          <Help text="Каждая точка — последняя проверенная работа. По горизонтали: дни относительно дедлайна, по вертикали: итоговый балл в процентах. Нажмите точку, чтобы открыть доступное вам ревью." />
        </div>
        {!points.length ? (
          <Empty title="Пока нет проверенных работ с дедлайном" />
        ) : (
          <>
            <svg
              viewBox="0 0 720 330"
              className="scatter-chart"
              role="group"
              aria-label="Итоговый балл и срок сдачи"
            >
              <text x="65" y="17">
                Балл, %
              </text>
              {[0, 25, 50, 75, 100].map((v) => (
                <g key={v}>
                  <line
                    x1="65"
                    x2="680"
                    y1={270 - v * 2.3}
                    y2={270 - v * 2.3}
                    className="chart-grid"
                  />
                  <text x="52" y={275 - v * 2.3} textAnchor="end">
                    {v}
                  </text>
                </g>
              ))}
              <line x1={x(0)} x2={x(0)} y1="34" y2="270" className="deadline-line" />
              <text x={x(0)} y="293" textAnchor="middle">
                Дедлайн
              </text>
              <text x="65" y="293">
                {lo} дн.
              </text>
              <text x="680" y="293" textAnchor="end">
                +{hi} дн.
              </text>
              <text x="370" y="320" textAnchor="middle">
                Срок сдачи относительно дедлайна
              </text>
              {points.map((pt, i) => {
                const title = `${pt.student} · ${pt.code}: ${pt.scorePercent}%, ${pt.lateDays! > 0 ? '+' : ''}${pt.lateDays} дн.`;
                const dot = (
                  <circle
                    cx={x(pt.lateDays!)}
                    cy={270 - pt.scorePercent * 2.3}
                    r={hovered === i ? 8 : 6}
                    className={pt.scorePercent < 60 ? 'low-score' : 'normal-score'}
                  >
                    <title>{title}</title>
                  </circle>
                );
                return (
                  <g
                    key={i}
                    onMouseEnter={() => setHovered(i)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(i)}
                    onBlur={() => setHovered(null)}
                  >
                    {pt.reviewId ? (
                      <Link to={`/review/${pt.reviewId}`} aria-label={title}>
                        {dot}
                      </Link>
                    ) : (
                      <g tabIndex={0} aria-label={title}>
                        {dot}
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
            <div className="chart-caption" aria-live="polite">
              {hovered !== null
                ? `${points[hovered].student} · ${points[hovered].code} · ${points[hovered].scorePercent}%`
                : `${points.length} проверенных работ · наведите на точку или выберите её клавишей Tab`}
            </div>
          </>
        )}
      </Card>
      <Card>
        <h2>
          Где задерживается поток{' '}
          <Help text="Доли последних попыток среди всех студентов потока. Серый — не сдано, синий — проверка, жёлтый — нужен разбор, зелёный — выполнено." />
        </h2>
        <div className="chart-legend">
          <span className="completed">Выполнено</span>
          <span className="checking">Проверяется</span>
          <span className="attention">Нужен разбор</span>
          <span className="missing">Не сдано</span>
        </div>
        {[...p.assignments]
          .sort(
            (a, b) =>
              (b.counts.missing || 0) / (b.total || 1) - (a.counts.missing || 0) / (a.total || 1),
          )
          .map((a) => (
            <div className="bottleneck" key={a.id}>
              <div className="row between">
                <b>
                  {a.code} · {a.title}
                </b>
                <span>
                  {a.counts.completed || 0}/{a.total}
                </span>
              </div>
              <ProgressBar counts={a.counts} total={a.total} />
              <small className="muted">
                Не сдано: {a.counts.missing || 0} · на проверке:{' '}
                {(a.counts.checking || 0) + (a.counts.attention || 0)} · просрочено:{' '}
                {a.counts.overdue || 0}
              </small>
            </div>
          ))}
      </Card>
      <Card>
        <h2>
          Критерии, которые даются сложнее{' '}
          <Help text="Средняя доля набранных баллов по последним подтверждённым проверкам. Рядом указано число работ; низкий результат на малой выборке требует отдельного разбора." />
        </h2>
        {p.weakCriteria.length ? (
          <div className="weak-criteria">
            {p.weakCriteria.slice(0, 10).map((c, i) => (
              <div key={i}>
                <span>
                  {c.assignment} · {c.title}
                  <small>{c.count} работ</small>
                </span>
                <div className="criterion-bar">
                  <span style={{ width: `${Math.max(0, Math.min(100, c.averagePercent))}%` }} />
                </div>
                <b>{c.averagePercent}%</b>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="Нужны подтверждённые оценки по критериям" />
        )}
      </Card>
    </div>
  );
}
