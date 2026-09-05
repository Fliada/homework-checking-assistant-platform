import { useEffect, useState, type FormEvent } from 'react';
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
import type { Annotation, Artifact, CriterionResult, Review, Rubric, SourceAnchor } from '../types';

export function ReviewWorkspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const data = useData();
  const { run, busy, toast } = useAction();
  const review = data.reviews.find((r) => r.id === id);
  const submission = data.submissions.find((s) => s.id === review?.submissionId);
  const assignment = data.assignments.find((a) => a.id === submission?.assignmentId);
  const [fileId, setFileId] = useState('');
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [tab, setTab] = useState('criteria');
  const [annotation, setAnnotation] = useState<Annotation | 'new' | null>(null);
  const [flag, setFlag] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [feedbackDirty, setFeedbackDirty] = useState(false);
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
  const locked = ['confirmed', 'feedback_sent'].includes(review.status);
  const canDecide =
    !locked && (review.reviewerId === data.user.id || ['admin', 'owner'].includes(data.user.role));
  const file = submission.artifacts.find((f) => f.id === fileId) || submission.artifacts[0];
  const max = review.rubric.criteria.reduce((n, c) => n + c.maxScore, 0);
  const rawScore = review.results.reduce((n, r) => n + (r.finalScore ?? 0), 0);
  const final = Math.max(0, rawScore - (review.latePenalty || 0));
  const remaining = review.results.filter((r) => !r.confirmed || r.finalScore === null).length;
  const pending = review.annotations.filter((a) => a.status === 'pending').length;
  const selectedAnchor: SourceAnchor | null =
    file && selection
      ? {
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
                  annotations={review.annotations}
                />
                <div className="source-footer row between">
                  <span>Выберите фрагмент · Shift для диапазона</span>
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
              <div className="task-text section-gap">{assignment.taskText}</div>
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
                    <article key={a.id} className={`annotation ${a.status}`}>
                      <div className="row between">
                        <Badge tone={a.source === 'ai' ? 'purple' : 'blue'}>
                          {a.source === 'ai' ? 'Агент' : 'Ревьюер'}
                        </Badge>
                        <Status value={a.status} />
                      </div>
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
              <div className="integrity-placeholder">
                <ShieldQuestion size={32} color="#a486c5" />
                <Badge tone="purple">Не подключено</Badge>
                <h3>Выявление использования ИИ</h3>
                <p>Результатов анализа пока нет.</p>
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
              <textarea name="message" required />
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
  annotations,
}: {
  file: Artifact;
  selection: { start: number; end: number } | null;
  onSelect: (index: number, shift: boolean) => void;
  annotations: Annotation[];
}) {
  return file.segments.length ? (
    <div className="source-code" aria-label={`Содержимое ${file.path}`}>
      {file.segments.map((segment, i) => (
        <button
          id={`segment-${file.id}-${i}`}
          key={segment.id || i}
          className={`source-line ${annotations.some((a) => a.anchor.artifactId === file.id && a.anchor.start === segment.anchor && a.status !== 'rejected') ? 'annotated' : ''} ${selection && i >= selection.start && i <= selection.end ? 'selected' : ''}`}
          onClick={(e) => onSelect(i, e.shiftKey)}
          aria-pressed={!!selection && i >= selection.start && i <= selection.end}
        >
          <span className="line-no" title={segment.anchor}>
            {segment.anchor
              .replace('line:', '')
              .replace('paragraph:', '¶ ')
              .replace('page:', 'с. ')}
          </span>
          <span>{segment.text || ' '}</span>
        </button>
      ))}
    </div>
  ) : (
    <Empty
      title="Предпросмотр недоступен"
      detail="Файл не содержит поддерживаемого текстового слоя. Откройте оригинал в GitHub и оцените критерии вручную."
    />
  );
}
function ScoreRow({
  result,
  rubric,
  reviewId,
  disabled,
}: {
  result: CriterionResult;
  rubric: Rubric;
  reviewId: string;
  disabled: boolean;
}) {
  const criterion = rubric.criteria.find((c) => c.id === result.criterionId)!;
  const [value, setValue] = useState(result.finalScore === null ? '' : String(result.finalScore));
  const { run, busy, toast } = useAction();
  useEffect(() => {
    setValue(result.finalScore === null ? '' : String(result.finalScore));
  }, [result.finalScore]);
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
    <div className="criterion-result">
      <header>
        <div>
          <h3>
            {criterion.title}
            <Help text={criterion.description || criterion.title} />
          </h3>
          <span className="small muted">
            {result.abstained
              ? 'Оцените вручную'
              : `Предложено: ${result.suggestedScore ?? '—'} · уверенность ${Math.round(result.confidence * 100)}%`}
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
            onChange={(e) => setValue(e.target.value)}
            onBlur={(e) => {
              if ((e.relatedTarget as HTMLInputElement)?.type === 'checkbox') return;
              if (value !== '' && Number(value) !== result.finalScore) save(false);
            }}
          />
          <span>/ {criterion.maxScore}</span>
        </div>
      </header>
      <p>{result.reason}</p>
      <label className="check-label">
        <input
          type="checkbox"
          checked={result.confirmed}
          disabled={disabled || busy || value === ''}
          onChange={(e) => save(e.target.checked)}
        />
        Оценка проверена
      </label>
    </div>
  );
}
function AnnotationForm({
  annotation,
  anchor,
  review,
  onClose,
}: {
  annotation: Annotation | 'new';
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
          <select name="category" defaultValue={existing?.category || 'logic'}>
            <option value="logic">Логика</option>
            <option value="quality">Качество кода</option>
            <option value="requirement">Требование задания</option>
            <option value="positive">Сильная сторона</option>
            <option value="question">Вопрос</option>
          </select>
        </Field>
        <Field label="Комментарий">
          <textarea name="message" required defaultValue={existing?.message || ''} rows={5} />
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
