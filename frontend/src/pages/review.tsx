import { useReviewSimilarity } from '../reviewSimilarity';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  CheckCheck,
  ExternalLink,
  Flag,
  GitPullRequest,
  MessageSquarePlus,
  Pencil,
  RefreshCw,
  ShieldQuestion,
  X,
} from 'lucide-react';
import { useAction, useData } from '../context';
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  formatDate,
  Help,
  Modal,
  PageTitle,
  Status,
} from '../components/ui';
import { api } from '../api';
import {
  annotationCategories,
  annotationCategory,
  segmentAnnotations,
  type AnnotationCategory,
} from '../annotationCategories';

import {
  highlightMatchesSegment,
  segmentMatchesCompletion,
  shouldShowSegment,
  visibleHighlights,
  type SourceFilter,
} from '../agentNotes';
import { highlightLine, isCodePath, languageForPath } from '../syntaxHighlight';
import {
  expandArtifactLines,
  highlightMatchesLine,
  lineAnnotations,
  lineCategories,
} from '../sourceLines';
import type { Annotation, Artifact, CriterionResult, IntegrityHighlight, Review, Rubric, SourceAnchor } from '../types';

export function ReviewWorkspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const data = useData();
  const { run, busy, toast } = useAction();
  const review = data.reviews.find((r) => r.id === id);
  const submission = data.submissions.find((s) => s.id === review?.submissionId);
  const assignment = data.assignments.find((a) => a.id === submission?.assignmentId);
  const [fileId, setFileId] = useState('');
  const similarity = useReviewSimilarity(assignment?.id, submission?.id, submission?.artifacts.find(f => f.id === fileId) || submission?.artifacts[0]);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [tab, setTab] = useState('criteria');
  const [newCategory, setNewCategory] = useState<AnnotationCategory>('logic');
  const [annotation, setAnnotation] = useState<Annotation | 'new' | null>(null);
  const [flag, setFlag] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [feedbackDirty, setFeedbackDirty] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  useEffect(() => {
    setFeedback(review?.feedback || '');
    setFeedbackDirty(false);
  }, [review?.feedback, id]);
  useEffect(() => {
    setFileId('');
    setSelection(null);
  }, [id]);
  useEffect(() => {
    if (!id) return;
    api(`/reviews/${id}/open`, {}).catch(() => {});
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible')
        api(`/reviews/${id}/heartbeat`, {}).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [id]);
  if (!review || !submission || !assignment)
    return (
      <Card>
        <Empty
          title="Работа не найдена или недоступна"
          action={<Link to="/ledger">Вернуться в ведомость</Link>}
        />
      </Card>
    );
  const aiSuggestions = [...new Set(review.annotations.filter(a => a.source === 'ai' && a.status !== 'rejected').map(a => (a.advice || a.message).trim()).filter(Boolean))];
  const locked = ['confirmed', 'feedback_sent'].includes(review.status);
  const canDecide =
    !locked && (review.reviewerId === data.user.id || ['admin', 'owner'].includes(data.user.role));
  const file = submission.artifacts.find((f) => f.id === fileId) || submission.artifacts[0];
  const fileHighlights = visibleHighlights(review.integrity.highlights, file?.id || '', sourceFilter);
  const lineRows = file && file.reviewScope !== 'added_lines' && isCodePath(file.path) ? expandArtifactLines(file) : [];
  const selectedAnchor: SourceAnchor | null =
    file && selection && !file.segments.slice(selection.start, selection.end + 1).some(s => s.diffKind === 'removed')
      ? lineRows.length
        ? (() => {
            const startRow = lineRows[selection.start];
            const endRow = lineRows[selection.end] || startRow;
            if (!startRow) return null;
            return {
              artifactId: file.id,
              path: file.path,
              start: startRow.anchor,
              end: endRow.anchor,
              quote: lineRows
                .slice(selection.start, selection.end + 1)
                .map((row) => row.text)
                .join('\n'),
            };
          })()
        : {
            artifactId: file.id,
            path: file.path,
            start: file.segments[selection.start]?.anchor || '',
            end: file.segments[selection.end]?.anchor || '',
            quote: file.segments
              .slice(selection.start, selection.end + 1)
              .map((s) => s.text)
              .join('\n'),
          }
      : null;
  function jump(anchor: SourceAnchor) {
    const target = submission!.artifacts.find(
      (f) => f.id === anchor.artifactId || f.path === anchor.path,
    );
    if (!target) return;
    setFileId(target.id);
    const rows = target.reviewScope !== 'added_lines' && isCodePath(target.path) ? expandArtifactLines(target) : [];
    const lineMatch = anchor.start.match(/^line:(\d+)/);
    if (rows.length && lineMatch) {
      const lineNo = Number(lineMatch[1]);
      const rowIndex = rows.findIndex((row) => row.lineNo === lineNo);
      if (rowIndex >= 0) {
        setSelection({ start: rowIndex, end: rowIndex });
        setTimeout(
          () =>
            document
              .getElementById(`line-${target.id}-${lineNo}`)
              ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
          30,
        );
        return;
      }
    }
    const start = target.segments.findIndex((s) => s.anchor === anchor.start);
    const end = target.segments.findIndex((s) => s.anchor === anchor.end);
    if (start >= 0) {
      setSelection({ start, end: Math.max(start, end) });
      setTimeout(
        () =>
          document
            .getElementById(`segment-${target.id}-${start}`)
            ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
        30,
      );
    }
  }
  const max = review.rubric.criteria.reduce((n, c) => n + c.maxScore, 0);
  const rawScore = review.results.reduce((n, r) => n + (r.finalScore ?? 0), 0);
  const final = Math.max(0, rawScore - (review.latePenalty || 0));
  const remaining = review.results.filter((r) => !r.confirmed || r.finalScore === null).length;
  const pending = review.annotations.filter((a) => a.status === 'pending').length;
  const aiScore = review.integrity.aiScore ?? review.integrity.ai_score;
  async function compose() {
    const result = await run<{ feedback: string }>(
      `/reviews/${id}/feedback/compose`,
      {},
      'POST',
      'Обратная связь собрана',
    );
    if (result) {
      setFeedback(result.feedback);
      setFeedbackDirty(false);
      setTab('feedback');
    }
  }
  async function sendFinal() {
    const result = await run(
      `/reviews/${id}/confirm`,
      { feedback, revision: review?.revision },
      'POST',
      'Проверка подтверждена. Результат доступен студенту.',
    );
    if (result) setConfirm(false);
  }
  return (
    <>
      <Link className="row small" to="/ledger">
        <ArrowLeft size={15} />
        Ведомость
      </Link>
      <PageTitle
        title={data.users.find((u) => u.id === submission.studentId)?.name || 'Проверка работы'}
        eyebrow={`${assignment.code} · ${assignment.title}`}
        actions={
          <>
            <Status value={review.status} />
            {canDecide && (
              <Button
                busy={busy}
                onClick={async () => {
                  const next = await run<{ reviewId: string }>(
                    `/submissions/${submission.id}/${submission.artifacts.length ? 'pre-review' : 'reprocess'}`,
                    {},
                    'POST',
                    submission.artifacts.length
                      ? 'Новый прогон запущен'
                      : 'Повторная загрузка запущена',
                  );
                  if (next) navigate(`/review/${next.reviewId}`, { replace: true });
                }}
              >
                <RefreshCw size={15} />
                {submission.artifacts.length ? 'Повторить анализ' : 'Повторить загрузку'}
              </Button>
            )}
          </>
        }
      />
      <div className="review-meta">
        <a href={submission.prUrl} target="_blank" rel="noreferrer" className="row">
          <GitPullRequest size={15} />
          GitHub PR
          <ExternalLink size={12} />
        </a>
        <span>Попытка {submission.attempt}</span>
        <span>Сдано {formatDate(submission.submittedAt, true)}</span>
        <span>Проверить до {formatDate(assignment.reviewDueAt)}</span>
        <span>
          Рубрика v{review.rubric.version} · Агент{' '}
          {review.configVersion ? `v${review.configVersion}` : 'не настроен'}
        </span>
        {submission.headSha && <code>{submission.headSha.slice(0, 7)}</code>}
        {submission.snapshotComplete === false && (
          <span className="row">
            <Badge tone="yellow">Контекст ограничен</Badge>
            <Help text="Загружены файлы, изменённые в PR. Остальной код репозитория не включён. Если критерий требует отсутствующего контекста, оцените его вручную после просмотра репозитория." />
          </span>
        )}
      </div>
      {submission.error && (
        <div className="notice yellow" style={{ marginBottom: 20 }}>
          {submission.error}
        </div>
      )}
      <div className="workspace">
        <div className="source-pane">
          <Card className="flush">
            <div className="card-head">
              <h2>Работа студента</h2>
              <Badge>{submission.artifacts.length} файлов</Badge>
            </div>
            <div className="file-tabs" aria-label="Файлы работы">
              {submission.artifacts.map((f) => (
                <button
                  key={f.id}
                  className={file?.id === f.id ? 'active' : ''}
                  onClick={() => {
                    setFileId(f.id);
                    setSelection(null);
                  }}
                  title={f.path}
                >
                  {f.path.split('/').pop()}
                </button>
              ))}
            </div>
            <div className="source-filters" aria-label="Фильтры просмотра">
              {(
                [
                  ['all', 'все'],
                  ['signals', 'только сигналы'],
                  ['completion', 'только «завершение»'],
                  ['open', 'скрыть подтверждённые'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={sourceFilter === key ? 'active' : ''}
                  onClick={() => setSourceFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            {file ? (
              <>
                <div className="source-toolbar">
                  <span className="mono">{file.path}</span>
                  <Badge
                    tone={
                      file.parseStatus === 'parsed' || file.parseStatus === 'ok'
                        ? 'green'
                        : 'yellow'
                    }
                  >
                    {file.segments.length
                      ? `${file.segments.length} фрагментов`
                      : 'Нужен просмотр вручную'}
                  </Badge>
                </div>
                <ArtifactView
                  file={file}
                  selection={selection}
                  onSelect={(i, shift) =>
                    setSelection(
                      shift && selection
                        ? { start: Math.min(selection.start, i), end: Math.max(selection.start, i) }
                        : { start: i, end: i },
                    )
                  }
                  onRangeSelect={(start, end) => setSelection({ start, end })}
                  annotations={[...review.annotations, ...similarity.annotations]}
                  highlights={fileHighlights}
                  sourceFilter={sourceFilter}
                  language={languageForPath(file.path)}
                  syntax={isCodePath(file.path)}
                />
                {selectedAnchor && canDecide && (
                  <div
                    className="selection-actions"
                    role="toolbar"
                    aria-label="Категория замечания к выделенному коду"
                  >
                    <div className="row between">
                      <b>
                        {selectedAnchor.start.startsWith('line:') ? 'Строки ' : 'Фрагменты '}
                        {selectedAnchor.start.replace('line:', '')} —{' '}
                        {selectedAnchor.end.replace('line:', '')}
                      </b>
                      <button
                        className="icon-button"
                        aria-label="Снять выделение"
                        onClick={() => setSelection(null)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="row wrap">
                      {Object.entries(annotationCategories)
                        .filter(([key]) => key !== 'comment')
                        .map(([key, label]) => (
                          <button
                            key={key}
                            className={`category-chip category-${key}`}
                            onClick={() => {
                              setNewCategory(key as AnnotationCategory);
                              setAnnotation('new');
                            }}
                          >
                            <span className="category-dot" />
                            {label}
                          </button>
                        ))}
                    </div>
                  </div>
                )}
                <div className="source-footer row between">
                  <span>
                    Выделите код мышью или выберите строки с Shift{' '}
                    <Help text="Замечание привязывается ко всему выделенному диапазону строк или фрагментов. После выделения выберите категорию." />
                  </span>
                  <Button
                    className="sm"
                    disabled={!selectedAnchor || !canDecide}
                    onClick={() => setAnnotation('new')}
                  >
                    <MessageSquarePlus size={14} />
                    Заметка
                  </Button>
                </div>
              </>
            ) : (
              <Empty
                title="Файлы ещё не загружены"
                detail="После обработки PR здесь появится содержимое работы."
              />
            )}
          </Card>
          <Card className="section-gap">
            <div className="row between">
              <h3>Условие и критерии</h3>
              <Link className="small" to={`/expert/${assignment.id}`}>
                Открыть задание
                <ExternalLink size={12} />
              </Link>
            </div>
            <details>
              <summary className="small muted">Показать условие</summary>
              <div className="rendered-markdown section-gap"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{img: () => null}}>{assignment.taskText}</ReactMarkdown></div>
            </details>
          </Card>
        </div>
        <div className="review-panel">
          {(review.latePenalty || 0) > 0 && (
            <div className="notice yellow">
              По критериям: {rawScore} · Снижение за просрочку: {review.latePenalty} · Итог: {final}
            </div>
          )}
          <Card>
            <div className="review-score">
              <div>
                <h2>{locked ? 'Итоговая оценка' : 'Оценка по критериям'}</h2>
                <span className="small muted">
                  {locked
                    ? formatDate(review.confirmedAt, true)
                    : `${review.results.length - remaining} из ${review.results.length} подтверждено`}
                </span>
              </div>
              <strong>
                {locked ? review.finalScore : final}
                <small> / {max}</small>
              </strong>
            </div>
          </Card>
          <Card>
            <div className="tabs">
              <button
                className={tab === 'criteria' ? 'active' : ''}
                onClick={() => setTab('criteria')}
              >
                Критерии
              </button>
              <button
                className={tab === 'annotations' ? 'active' : ''}
                onClick={() => setTab('annotations')}
              >
                Заметки {pending > 0 && <Badge tone="yellow">{pending}</Badge>}
              </button>
              <button
                className={tab === 'feedback' ? 'active' : ''}
                onClick={() => setTab('feedback')}
              >
                Итог
              </button>
              <button
                className={tab === 'integrity' ? 'active' : ''}
                onClick={() => setTab('integrity')}
              >
                ИИ
              </button>
            </div>
            {tab === 'criteria' && (
              <>
                {review.results.length ? (
                  review.results.map((result) => (
                    <ScoreRow
                      key={result.criterionId}
                      result={result}
                      displayThreshold={review.displayThreshold ?? 0.6}
                      artifacts={submission.artifacts}
                      onJump={jump}
                      rubric={review.rubric}
                      reviewId={review.id}
                      disabled={!canDecide}
                    />
                  ))
                ) : (
                  <Empty
                    title="Нет критериев"
                    detail="Эксперт должен опубликовать рубрику задания."
                  />
                )}
                {canDecide && (
                  <Button variant="ghost" className="sm" onClick={() => setFlag(true)}>
                    <Flag size={13} />
                    Предложить правку критерия
                  </Button>
                )}
              </>
            )}
            {tab === 'annotations' && (
              <>
                <div className="row between">
                  <span className="small muted">{review.annotations.length} замечаний</span>
                  <Button
                    className="sm"
                    disabled={!selectedAnchor || !canDecide}
                    onClick={() => setAnnotation('new')}
                  >
                    <PlusIcon />
                    Добавить
                  </Button>
                </div>
                {review.annotations.length ? (
                  review.annotations.map((a) => (
                    <article
                      key={a.id}
                      className={`annotation ${a.status} category-${annotationCategory(a.category)}`}
                    >
                      <div className="row between">
                        <Badge tone={a.source === 'ai' ? 'purple' : 'blue'}>
                          {a.source === 'ai' ? 'Агент' : 'Ревьюер'}
                        </Badge>
                        <Status value={a.status} />
                      </div>
                      <span className={`category-label category-${annotationCategory(a.category)}`}>
                        <span className="category-dot" />
                        {annotationCategories[annotationCategory(a.category)]}
                      </span>
                      <p>{a.message}</p>
                      <button className="anchor-link" onClick={() => jump(a.anchor)}>
                        {a.anchor.path} · {a.anchor.start}
                        {a.anchor.end !== a.anchor.start ? ` — ${a.anchor.end}` : ''}
                      </button>
                      <small className="muted" style={{ display: 'block', margin: '7px 0' }}>
                        {review.rubric.criteria.find((c) => c.id === a.criterionId)?.title ||
                          'Общее замечание'}
                        {a.visibleToStudent ? ' · В обратную связь' : ' · Только сотрудникам'}
                      </small>
                      {canDecide && (
                        <div className="row wrap">
                          <Button
                            className="sm"
                            disabled={busy || a.status === 'accepted'}
                            onClick={() =>
                              run(
                                `/reviews/${id}/annotations/${a.id}`,
                                { status: 'accepted' },
                                'PATCH',
                                '',
                              )
                            }
                          >
                            <Check size={12} />
                            Принять
                          </Button>
                          <Button className="sm" onClick={() => setAnnotation(a)}>
                            <Pencil size={12} />
                            Изменить
                          </Button>
                          <Button
                            className="sm"
                            disabled={busy || a.status === 'rejected'}
                            onClick={() =>
                              run(
                                `/reviews/${id}/annotations/${a.id}`,
                                { status: 'rejected' },
                                'PATCH',
                                '',
                              )
                            }
                          >
                            <X size={12} />
                            Отклонить
                          </Button>
                        </div>
                      )}
                    </article>
                  ))
                ) : (
                  <Empty
                    title="Заметок пока нет"
                    detail="Выберите фрагмент работы, чтобы добавить замечание."
                  />
                )}
              </>
            )}
            {tab === 'feedback' && (
              <div className="form-stack">
                {!locked && aiSuggestions.length > 0 && <section>
                  <h3>Предложения ИИ<Help text="Советы из текущих замечаний агента. Добавьте подходящие в обратную связь и сохраните текст." /></h3>
                  {aiSuggestions.map((suggestion, i) => <div className="ai-feedback-suggestion" key={i}>
                    <p>{suggestion}</p>
                    {canDecide && <Button className="sm" disabled={feedback.includes(suggestion)} onClick={() => {
                      setFeedback(previous => [previous.trim(), suggestion].filter(Boolean).join('\n\n'));
                      setFeedbackDirty(true);
                    }}>{feedback.includes(suggestion) ? 'Добавлено' : 'Добавить в итог'}</Button>}
                  </div>)}
                </section>}
                {!locked && (
                  <>
                    <div className="row between">
                      <h3 style={{ margin: 0 }}>
                        Обратная связь
                        <Help text="Текст собирается из подтверждённых видимых замечаний и окончательных оценок. После правок критериев его нужно собрать заново." />
                      </h3>
                      <Button
                        className="sm"
                        busy={busy}
                        disabled={!canDecide || remaining > 0}
                        onClick={compose}
                      >
                        Собрать
                      </Button>
                    </div>
                    {review.feedbackStale && (
                      <div className="notice yellow">
                        Оценки или замечания изменились. Соберите обратную связь заново.
                      </div>
                    )}
                  </>
                )}
                <textarea
                  aria-label="Обратная связь студенту"
                  className="summary-editor"
                  value={feedback}
                  onChange={(e) => {
                    setFeedback(e.target.value);
                    setFeedbackDirty(true);
                  }}
                  disabled={!canDecide}
                  placeholder="Подтвердите оценки и замечания, затем соберите обратную связь."
                />
                {canDecide && feedbackDirty && (
                  <Button
                    busy={busy}
                    onClick={async () => {
                      const response = await run(
                        `/reviews/${id}/feedback`,
                        { feedback },
                        'PATCH',
                        'Текст сохранён',
                      );
                      if (response) setFeedbackDirty(false);
                    }}
                  >
                    Сохранить текст
                  </Button>
                )}
              </div>
            )}
            {tab === 'integrity' && (
              <div className="integrity-panel">
                {review.integrity.status === 'unavailable' ? (
                  <div className="integrity-placeholder">
                    <ShieldQuestion size={32} color="#a486c5" />
                    <Badge tone="yellow">Недоступно</Badge>
                    <h3>Выявление использования ИИ</h3>
                    <p>{review.integrity.message || 'Codect не установлен на сервере.'}</p>
                  </div>
                ) : !review.integrity.signals?.length ? (
                  <div className="integrity-placeholder">
                    <ShieldQuestion size={32} color="#a486c5" />
                    <Badge tone="green">Чисто</Badge>
                    <h3>Выявление использования ИИ</h3>
                    <p>{review.integrity.message || 'Явных признаков ИИ-кода не обнаружено.'}</p>
                  </div>
                ) : (
                  <>
                    <div className="row between section-gap">
                      <div>
                        <Badge tone={review.integrity.level === 'high' ? 'red' : 'yellow'}>
                          {review.integrity.level === 'high'
                            ? 'Высокий риск'
                            : review.integrity.level === 'medium'
                              ? 'Средний риск'
                              : 'Низкий риск'}
                        </Badge>
                        {aiScore != null && (
                          <p className="integrity-overall">
                            Итоговая оценка ИИ: <strong>{(aiScore * 100).toFixed(0)}%</strong>
                          </p>
                        )}
                        <p className="small muted">{review.integrity.message}</p>
                      </div>
                    </div>
                    {review.integrity.signals.map((signal) => {
                      const start = signal.startLine ?? signal.start_line ?? 0;
                      const end = signal.endLine ?? signal.end_line ?? start;
                      const name = signal.blockName ?? signal.block_name ?? signal.path;
                      return (
                        <div className="integrity-signal" key={signal.id}>
                          <div className="row between">
                            <button
                              type="button"
                              className="anchor-link"
                              onClick={() =>
                                jump({
                                  artifactId: signal.artifactId || signal.artifact_id || '',
                                  path: signal.path,
                                  start:
                                    signal.kind === 'text'
                                      ? `paragraph:${start}`
                                      : `line:${start}`,
                                  end:
                                    signal.kind === 'text' ? `paragraph:${end}` : `line:${end}`,
                                  quote: signal.message,
                                })
                              }
                            >
                              {signal.path}:{start}
                              {end !== start ? `–${end}` : ''}
                            </button>
                            <Badge
                              tone={
                                signal.status === 'accepted'
                                  ? 'green'
                                  : signal.status === 'rejected'
                                    ? 'red'
                                    : 'yellow'
                              }
                            >
                              {signal.status === 'pending'
                                ? 'Ожидает решения'
                                : signal.status === 'accepted'
                                  ? 'Подтверждено'
                                  : signal.status === 'rejected'
                                    ? 'Отклонено'
                                    : signal.status}
                            </Badge>
                          </div>
                          <p className="small">{name}</p>
                          <p>{signal.message}</p>
                          <p className="small muted">
                            {signal.classification}
                            {signal.aiScore ?? signal.ai_score
                              ? ` · AI ${((signal.aiScore ?? signal.ai_score ?? 0) * 100).toFixed(0)}%`
                              : ''}
                          </p>
                          {!locked && canDecide && signal.status === 'pending' && (
                            <div className="row">
                              <Button
                                className="sm"
                                variant="ghost"
                                busy={busy}
                                onClick={() =>
                                  run(
                                    `/reviews/${id}/integrity/${signal.id}/decision`,
                                    { status: 'rejected' },
                                    'POST',
                                    'Сигнал отклонён',
                                  )
                                }
                              >
                                Не ИИ
                              </Button>
                              <Button
                                className="sm"
                                variant="primary"
                                busy={busy}
                                onClick={() =>
                                  run(
                                    `/reviews/${id}/integrity/${signal.id}/decision`,
                                    { status: 'accepted' },
                                    'POST',
                                    'Сигнал подтверждён',
                                  )
                                }
                              >
                                Подтвердить
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </Card>
          {!locked && (
            <div className="review-final">
              <p>
                {!canDecide
                  ? 'Решение доступно назначенному ревьюеру.'
                  : remaining
                    ? `Подтвердите оценки по ${remaining} критериям.`
                    : pending
                      ? `Примите или отклоните ${pending} замечаний.`
                      : !feedback || review.feedbackStale
                        ? 'Соберите актуальную обратную связь во вкладке «Итог».'
                        : 'Оценка и обратная связь будут доступны студенту.'}
              </p>
              <Button
                variant="success"
                busy={busy}
                disabled={
                  !canDecide ||
                  remaining > 0 ||
                  pending > 0 ||
                  !feedback.trim() ||
                  review.feedbackStale
                }
                onClick={() => setConfirm(true)}
              >
                <CheckCheck size={17} />
                Подтвердить проверку
              </Button>
            </div>
          )}
          {locked && (
            <div className="notice">
              <Check size={14} /> Проверка подтверждена {formatDate(review.confirmedAt, true)}.
            </div>
          )}
        </div>
      </div>
      {annotation && (
        <AnnotationForm
          annotation={annotation}
          initialCategory={newCategory}
          anchor={selectedAnchor}
          review={review}
          onClose={() => setAnnotation(null)}
        />
      )}
      {flag && (
        <Modal title="Предложить правку" onClose={() => setFlag(false)}>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const fields = Object.fromEntries(new FormData(e.currentTarget));
              const response = await run(
                `/reviews/${id}/flags`,
                fields,
                'POST',
                'Предложение отправлено эксперту',
              );
              if (response) setFlag(false);
            }}
          >
            <Field label="Критерий">
              <select name="criterionId">
                {review.rubric.criteria.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Что нужно уточнить">
              <textarea name="message" />
            </Field>
            <p className="muted small">Предложение попадёт в следующую версию рубрики.</p>
            <Button variant="primary" busy={busy} type="submit">
              Отправить
            </Button>
          </form>
        </Modal>
      )}
      {confirm && (
        <Modal title="Подтвердить результат?" onClose={() => setConfirm(false)}>
          <div className="review-score">
            <h2>Итоговая оценка</h2>
            <strong>
              {final}
              <small> / {max}</small>
            </strong>
          </div>
          <p className="small muted">
            Студент получит этот результат и текст обратной связи. Подтверждённая проверка станет
            доступна только для чтения.
          </p>
          <div className="feedback">{feedback}</div>
          <div className="form-actions">
            <Button onClick={() => setConfirm(false)}>Вернуться</Button>
            <Button variant="success" busy={busy} onClick={sendFinal}>
              Подтвердить
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
function PlusIcon() {
  return <MessageSquarePlus size={13} />;
}
function ArtifactView({
  file,
  selection,
  onSelect,
  onRangeSelect,
  annotations,
  highlights,
  sourceFilter,
  language,
  syntax,
}: {
  file: Artifact;
  selection: { start: number; end: number } | null;
  onSelect: (index: number, shift: boolean) => void;
  onRangeSelect: (start: number, end: number) => void;
  annotations: Annotation[];
  highlights: IntegrityHighlight[];
  sourceFilter: SourceFilter;
  language: string | null;
  syntax: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const rangeSelected = useRef(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  useEffect(() => setCategoryFilter('all'), [file.id, selection?.start, selection?.end]);
  const lineMode = file.reviewScope !== 'added_lines' && isCodePath(file.path);
  const rows = lineMode ? expandArtifactLines(file) : [];
  function captureSelection() {
    const native = window.getSelection();
    if (!native || native.isCollapsed || !root.current) return;
    function rowIndex(node: Node | null) {
      const element = node instanceof Element ? node : node?.parentElement;
      const line = element?.closest<HTMLElement>('[data-line-index]');
      return line && root.current?.contains(line) ? Number(line.dataset.lineIndex) : null;
    }
    const from = rowIndex(native.anchorNode),
      to = rowIndex(native.focusNode);
    if (from === null || to === null) return;
    if (!lineMode && file.segments.slice(Math.min(from,to), Math.max(from,to)+1).some(s => s.diffKind === 'removed')) return;
    rangeSelected.current = true;
    onRangeSelect(Math.min(from, to), Math.max(from, to));
  }
  if (!file.segments.length) {
    return (
      <Empty
        title="Предпросмотр недоступен"
        detail="Откройте исходный PR для ручной проверки файла."
      />
    );
  }
  return (
    <>
      <div className="annotation-legend" aria-label="Цвета категорий">
        <button type="button" className="category-label" aria-pressed={categoryFilter === 'all'} onClick={() => setCategoryFilter('all')}>Все</button>
        {Object.entries(annotationCategories).map(([key, label]) => (
          <button type="button" aria-label={`Фильтр: ${label}`} aria-pressed={categoryFilter === key} onClick={() => setCategoryFilter(categoryFilter === key ? 'all' : key)} key={key} className={`category-label category-${key}`}>
            <span className="category-dot" />
            {label}
          </button>
        ))}
        {highlights.some((h) => h.status === 'pending') && (
          <span className="category-label category-ai">
            <span className="category-dot" />
            сигнал ИИ
          </span>
        )}
      </div>
      <div
        ref={root}
        className={`source-code${syntax ? ' syntax-highlighted' : ''}`}
        aria-label={`Содержимое ${file.path}`}
        onMouseDown={() => {
          rangeSelected.current = false;
        }}
        onMouseUp={captureSelection}
        onKeyUp={captureSelection}
      >
        {lineMode
          ? rows.map((row, i) => {
              const linked = lineAnnotations(file, row, annotations);
              const categories = lineCategories(file, row, annotations);
              const category = Object.keys(annotationCategories).find((c) =>
                categories.includes(c as AnnotationCategory),
              );
              const aiHighlight = highlights.find((h) => highlightMatchesLine(h, row.lineNo));
              if (categoryFilter !== 'all' && !linked.some(a => annotationCategory(a.category) === categoryFilter)) return null;
              const linkedCompletion = linked.some((a) =>
                /graceful|shutdown|context|заверш/i.test(a.message),
              );
              if (
                !shouldShowSegment(row.text, row.anchor, highlights, sourceFilter, linkedCompletion)
              ) {
                return null;
              }
              const selected = !!selection && i >= selection.start && i <= selection.end;
              return (
                <div
                  role="button"
                  tabIndex={0}
                  id={`line-${file.id}-${row.lineNo}`}
                  data-line-index={i}
                  key={row.key}
                  className={`source-line ${category ? `annotated category-${category}` : ''} ${aiHighlight ? `ai-highlight ai-${aiHighlight.level}` : ''} ${selected ? 'selected' : ''}`}
                  title={aiHighlight?.message}
                  onClick={(e) => {
                    if (rangeSelected.current) {
                      rangeSelected.current = false;
                      return;
                    }
                    onSelect(i, e.shiftKey);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(i, e.shiftKey);
                    }
                  }}
                  aria-pressed={selected}
                >
                  <span className="line-no" title={row.anchor}>
                    {row.lineNo}
                    <span className="line-category-dots">
                      {categories.map((c) => (
                        <i
                          key={c}
                          className={`category-dot category-${c}`}
                          title={annotationCategories[c]}
                          aria-label={annotationCategories[c]}
                        />
                      ))}
                    </span>
                  </span>
                  <SimilarityHints annotations={linked}>
                  <span
                    className="source-text"
                    {...(syntax && language
                      ? { dangerouslySetInnerHTML: { __html: highlightLine(row.text || ' ', language) } }
                      : { children: row.text || ' ' })}
                  /></SimilarityHints>
                </div>
              );
            })
          : file.segments.map((segment, i) => {
              const linked = segmentAnnotations(file, i, annotations);
              const categories = [...new Set(linked.map((a) => annotationCategory(a.category)))];
              const category = Object.keys(annotationCategories).find((c) =>
                categories.includes(c as AnnotationCategory),
              );
              const aiHighlight = highlights.find((h) => highlightMatchesSegment(h, segment.anchor));
              if (categoryFilter !== 'all' && !linked.some(a => annotationCategory(a.category) === categoryFilter)) return null;
              const linkedCompletion = linked.some((a) =>
                /graceful|shutdown|context|заверш/i.test(a.message),
              );
              if (
                !shouldShowSegment(segment.text, segment.anchor, highlights, sourceFilter, linkedCompletion)
              ) {
                return null;
              }
              const selected = !!selection && i >= selection.start && i <= selection.end;
              return (
                <div
                  role="button"
                  tabIndex={0}
                  id={`segment-${file.id}-${i}`}
                  data-line-index={i}
                  key={segment.id || i}
                  className={`source-line diff-${segment.diffKind || 'none'} ${category ? `annotated category-${category}` : ''} ${aiHighlight ? `ai-highlight ai-${aiHighlight.level}` : ''} ${selected ? 'selected' : ''}`}
                  title={aiHighlight?.message}
                  onClick={(e) => {
                    if (segment.diffKind === 'removed') return;
                    if (rangeSelected.current) {
                      rangeSelected.current = false;
                      return;
                    }
                    onSelect(i, e.shiftKey);
                  }}
                  onKeyDown={(e) => {
                    if (segment.diffKind !== 'removed' && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      onSelect(i, e.shiftKey);
                    }
                  }}
                  aria-pressed={selected}
                >
                  {segment.diffKind && <span className="diff-marker" aria-label={segment.diffKind}>{segment.diffKind === 'added' ? '+' : segment.diffKind === 'removed' ? '−' : ' '}</span>}
                  <span className="line-no" title={segment.anchor}>
                    {segment.diffKind ? `${segment.oldLine ?? ''} │ ${segment.newLine ?? ''}` : segment.anchor
                      .replace('line:', '')
                      .replace('paragraph:', '¶ ')
                      .replace('page:', 'с. ')}
                    <span className="line-category-dots">
                      {categories.map((c) => (
                        <i
                          key={c}
                          className={`category-dot category-${c}`}
                          title={annotationCategories[c]}
                          aria-label={annotationCategories[c]}
                        />
                      ))}
                    </span>
                  </span>
                  <SimilarityHints annotations={linked}>
                  <span
                    className="source-text"
                    {...(syntax && language
                      ? { dangerouslySetInnerHTML: { __html: highlightLine(segment.text || ' ', language) } }
                      : { children: segment.text || ' ' })}
                  /></SimilarityHints>
                </div>
              );
            })}
      </div>
    </>
  );
}

function SimilarityHints({annotations,children}: {annotations: Annotation[];children:ReactNode}) {
  const [open,setOpen] = useState(false);
  const matches = annotations.filter(a => a.category === 'similarity');
  const urls = [...new Set(matches.map(a => a.relatedUrl).filter((url): url is string => !!url?.startsWith('https://github.com/')))];
  return <span className={`source-text-wrap ${matches.length ? 'similarity-code' : ''}`} role={urls.length ? 'button' : undefined} tabIndex={urls.length ? 0 : undefined} aria-expanded={urls.length ? open : undefined}
    onBlur={e => {if(!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);}}
    onClick={e => {if(urls.length && window.getSelection()?.isCollapsed !== false){e.stopPropagation();setOpen(!open);}}}
    onKeyDown={e => {if(e.key==='Escape'){e.stopPropagation();setOpen(false);} if(e.target !== e.currentTarget) return; if(urls.length && (e.key==='Enter' || e.key===' ')){e.preventDefault();e.stopPropagation();setOpen(!open);}}}>
    {children}
    {open && urls.length > 0 && <span className="similarity-popup" onClick={e=>e.stopPropagation()}>
      {urls.map((url,i) => <a key={url} href={url} target="_blank" rel="noreferrer" style={{display:'block'}}>Работа другого студента{urls.length > 1 ? ` ${i+1}` : ''}</a>)}
    </span>}
  </span>;
}
function CriterionReason({reason,artifacts,onJump}: {reason:string;artifacts:Artifact[];onJump:(anchor:SourceAnchor)=>void}) {
  const targets: SourceAnchor[] = [];
  let text = reason;
  for (const file of artifacts) for (const segment of [...file.segments].sort((a,b)=>b.id.length-a.id.length)) {
    if (!segment.id || !text.includes(segment.id)) continue;
    const index=targets.length;
    targets.push({artifactId:file.id,path:file.path,start:segment.anchor,end:segment.anchor,quote:segment.text});
    text=text.split('`'+segment.id+'`').join(segment.id);
    text=text.split(segment.id).join(`[${file.path}:${segment.anchor.replace('line:','')}](#source-${index})`);
  }
  text=text.replace(/\(?сегмент[а-я]*\s+(?=\[)/gi,'').replace(/(\]\(#source-\d+\))\)/g,'$1');
  return <div className="rendered-markdown"><ReactMarkdown skipHtml components={{img:()=>null,a:({href,children}) => {
    const index=href?.match(/^#source-(\d+)$/)?.[1];
    return index !== undefined && targets[Number(index)] ? <button className="source-reference" onClick={()=>onJump(targets[Number(index)])}>{children}</button> : <span>{children}</span>;
  }}}>{text}</ReactMarkdown></div>;
}
function ScoreRow({
  artifacts, onJump,
  displayThreshold,
  result,
  rubric,
  reviewId,
  disabled,
}: {
  artifacts: Artifact[];
  onJump: (anchor: SourceAnchor) => void;
  displayThreshold: number;
  result: CriterionResult;
  rubric: Rubric;
  reviewId: string;
  disabled: boolean;
}) {
  const criterion = rubric.criteria.find((c) => c.id === result.criterionId)!;
  const hasAI = !result.abstained && result.suggestedScore !== null && result.confidence >= displayThreshold;
  const initial = result.finalScore ?? (hasAI ? result.suggestedScore : null);
  const [value, setValue] = useState(initial === null ? '' : String(initial));
  const [edited, setEdited] = useState(false);
  const { run, busy, toast } = useAction();
  useEffect(() => {
    setValue(initial === null ? '' : String(initial));
    setEdited(false);
  }, [initial]);
  async function save(confirmed: boolean) {
    const score = Number(value);
    if (value === '' || !Number.isFinite(score) || score < 0 || score > criterion.maxScore) {
      toast(`Укажите оценку от 0 до ${criterion.maxScore}`, true);
      return;
    }
    await run(
      `/reviews/${reviewId}/criteria/${result.criterionId}`,
      { finalScore: score, confirmed },
      'PATCH',
      '',
    );
  }
  return (
    <div className={`criterion-result ${hasAI ? 'criterion-ai' : 'criterion-manual'}`}>
      <header>
        <div>
          <h3>
            {criterion.title}
            <Help text={criterion.description || criterion.title} />
          </h3>
          <span className="small muted">
            {`ИИ: ${result.aiSuggestedScore ?? result.suggestedScore ?? '—'} баллов · уверенность ${Math.round(result.confidence * 100)}%${!hasAI ? ' · Оцените вручную' : ''}`}
          </span>
        </div>
        <div className="score-input">
          <input
            type="number"
            aria-label={`Оценка: ${criterion.title}`}
            value={value}
            min={0}
            max={criterion.maxScore}
            step="0.5"
            disabled={disabled || busy}
            onChange={(e) => { setValue(e.target.value); setEdited(true); }}
            onBlur={(e) => {
              if ((e.relatedTarget as HTMLInputElement)?.type === 'checkbox') return;
              if (edited && value !== '') save(true);
            }}
          />
          <span>/ {criterion.maxScore}</span>
        </div>
      </header>
      <CriterionReason reason={result.reason} artifacts={artifacts} onJump={onJump} />
      {(result.evidenceAnchors || []).map((anchor,i) => <button key={i} className="source-reference" onClick={()=>onJump(anchor)}>{anchor.path}:{anchor.start.replace('line:','')}{anchor.end !== anchor.start ? `–${anchor.end.replace('line:','')}` : ''}</button>)}
      {hasAI && <label className="check-label">
        <input
          type="checkbox"
          checked={edited || result.confirmed}
          disabled={disabled || busy || value === ''}
          onChange={(e) => save(e.target.checked)}
        />
        Оценка проверена
      </label>}
    </div>
  );
}
function AnnotationForm({
  annotation,
  initialCategory,
  anchor,
  review,
  onClose,
}: {
  annotation: Annotation | 'new';
  initialCategory: AnnotationCategory;
  anchor: SourceAnchor | null;
  review: Review;
  onClose: () => void;
}) {
  const { run, busy } = useAction();
  const existing = annotation === 'new' ? null : annotation;
  const [useSelection, setUseSelection] = useState(!existing);
  const effective = useSelection ? anchor : existing?.anchor;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = {
      message: form.get('message'),
      criterionId: form.get('criterionId') || null,
      category: form.get('category'),
      visibleToStudent: form.get('visible') === 'on',
      anchor: effective,
      status: existing ? 'edited' : 'accepted',
    };
    const response = await run(
      `/reviews/${review.id}/annotations${existing ? `/${existing.id}` : ''}`,
      body,
      existing ? 'PATCH' : 'POST',
      'Заметка сохранена',
    );
    if (response) onClose();
  }
  return (
    <Modal title={existing ? 'Редактировать заметку' : 'Новая заметка'} onClose={onClose}>
      <form onSubmit={save} className="form-stack">
        <div className="notice mono">
          {effective?.path} · {effective?.start} — {effective?.end}
        </div>
        {existing && anchor && (
          <label className="check-label">
            <input
              type="checkbox"
              checked={useSelection}
              onChange={(e) => setUseSelection(e.target.checked)}
            />
            Привязать к выделенному фрагменту
          </label>
        )}
        <Field label="Критерий">
          <select name="criterionId" defaultValue={existing?.criterionId || ''}>
            <option value="">Общее замечание</option>
            {review.rubric.criteria.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Категория">
          <select
            name="category"
            defaultValue={existing ? annotationCategory(existing.category) : initialCategory}
          >
            {Object.entries(annotationCategories).map(([key, label]) => (
              <option value={key} key={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Комментарий">
          <textarea name="message" defaultValue={existing?.message || ''} rows={5} />
        </Field>
        <label className="check-label">
          <input
            type="checkbox"
            name="visible"
            defaultChecked={existing?.visibleToStudent ?? true}
          />
          Включить в обратную связь студенту
        </label>
        <div className="form-actions">
          <Button type="button" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!effective}>
            Сохранить
          </Button>
        </div>
      </form>
    </Modal>
  );
}
