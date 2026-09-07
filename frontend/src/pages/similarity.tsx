import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GitCompareArrows, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { useAction, useData } from '../context';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorState,
  Field,
  formatDate,
  Help,
  Loading,
  Status,
} from '../components/ui';

type Source = { path: string; start: number; end: number; code: string; truncated: boolean };
type Pair = {
  id: string;
  leftId: string;
  rightId: string;
  leftName: string;
  rightName: string;
  averagePercent: number;
  maxPercent: number;
  matchCount: number;
  matchesTruncated: boolean;
  matches?: { left: Source; right: Source }[];
  decision: { status: string; comment: string };
};
type Run = {
  id: string;
  status: string;
  language: string;
  createdAt: string;
  error: string | null;
  engine: string;
  submissionCount: number;
  sources: { id: string; files: number; partial: boolean; demo: boolean }[];
  excludedIds: string[];
  failedSubmissions: unknown[];
  pairs: Pair[];
};
const languageNames: Record<string, string> = {
  go: 'Go',
  python3: 'Python',
  java: 'Java',
  cpp: 'C / C++',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  csharp: 'C#',
  kotlin: 'Kotlin',
};
export function SimilarityPanel({
  assignments,
}: {
  assignments: { id: string; code: string; title: string }[];
}) {
  const { user } = useData();
  const { run, busy } = useAction();
  const [assignment, setAssignment] = useState(assignments[0]?.id || '');
  const [language, setLanguage] = useState('go');
  const [selectedRun, setSelectedRun] = useState('');
  const list = useQuery({
    queryKey: ['similarity', assignment, user.id],
    queryFn: () =>
      api<{ installed: boolean; languages: string[]; runs: Run[] }>(
        `/assignments/${assignment}/similarity`,
      ),
    enabled: !!assignment,
    refetchInterval: 5000,
  });
  const id = selectedRun || list.data?.runs[0]?.id;
  const detail = useQuery({
    queryKey: ['similarity', 'run', id, user.id],
    queryFn: () => api<Run>(`/similarity/${id}`),
    enabled: !!id,
    refetchInterval: 5000,
  });
  async function start() {
    const result = await run<Run>(
      `/assignments/${assignment}/similarity`,
      { language },
      'POST',
      'Сравнение запущено',
    );
    if (result) setSelectedRun(result.id);
  }
  if (list.isPending) return <Loading />;
  if (list.isError) return <ErrorState error={list.error} retry={() => list.refetch()} />;
  const active = list.data.runs.some((r) => ['running', 'queued'].includes(r.status));
  const report = detail.data;
  return (
    <Card className="similarity-panel">
      <div className="row">
        <GitCompareArrows size={23} />
        <h2>Сходство кода · JPlag</h2>
        <Help text="Сравниваются последние отправки разных студентов по одному заданию внутри потока. Процент отражает сходство токенов, а не вероятность списывания. Общий шаблон задания также может давать совпадения. Оценка автоматически не меняется." />
      </div>
      <div className="toolbar">
        <Field label="Задание">
          <select
            value={assignment}
            onChange={(e) => {
              setAssignment(e.target.value);
              setSelectedRun('');
            }}
          >
            {assignments.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Язык исходников">
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {list.data.languages.map((l) => (
              <option key={l} value={l}>
                {languageNames[l] || l}
              </option>
            ))}
          </select>
        </Field>
        <Button
          variant="primary"
          onClick={start}
          busy={busy || active}
          disabled={!list.data.installed}
        >
          Сравнить решения
        </Button>
      </div>
      {!list.data.installed && (
        <p className="inline-error">
          JPlag пока не установлен на сервере. Обратитесь к администратору.
        </p>
      )}
      {!!list.data.runs.length && (
        <div className="toolbar">
          <Field label="История сравнений">
            <select value={id} onChange={(e) => setSelectedRun(e.target.value)}>
              {list.data.runs.map((r) => (
                <option value={r.id} key={r.id}>
                  {formatDate(r.createdAt, true)} · {languageNames[r.language]} ·{' '}
                  {r.submissionCount} работ
                </option>
              ))}
            </select>
          </Field>
          {report && <Status value={report.status} />}
          <Button
            variant="ghost"
            onClick={() => {
              list.refetch();
              detail.refetch();
            }}
            aria-label="Обновить сравнение"
          >
            <RefreshCw size={16} />
          </Button>
        </div>
      )}
      {!id ? (
        <Empty
          title="Сравнений пока нет"
          detail="Выберите задание и язык, затем запустите сравнение."
        />
      ) : detail.isPending ? (
        <Loading />
      ) : detail.isError ? (
        <ErrorState error={detail.error} retry={() => detail.refetch()} />
      ) : (
        report && (
          <>
            {report.error && (
              <p className="inline-error" role="alert">
                {report.error}
              </p>
            )}
            {['running', 'queued'].includes(report.status) && (
              <Empty
                title="Сравниваем исходный код"
                detail="Результат появится автоматически. Можно продолжать работу с курсом."
              />
            )}
            {report.status === 'completed' && (
              <>
                <div className="course-mini-stats">
                  <span>{report.engine}</span>
                  <span>{report.sources.filter((s) => s.files > 0).length} работ с кодом</span>
                  <span>{report.pairs.length} пар</span>
                  {report.sources.some((s) => s.partial) && (
                    <Badge tone="yellow">
                      Неполные снимки{' '}
                      <Help text="В некоторых работах доступна только часть репозитория, например файлы PR. Процент относится к загруженным исходникам." />
                    </Badge>
                  )}
                  {report.sources.some((s) => s.demo) && (
                    <Badge tone="purple">Есть демонстрационные работы</Badge>
                  )}
                  {(report.excludedIds.length > 0 || report.failedSubmissions.length > 0) && (
                    <Badge tone="yellow">
                      Исключено работ: {report.excludedIds.length + report.failedSubmissions.length}
                      <Help text="Нет кода выбранного языка или JPlag не смог разобрать исходники. Эти работы не входят в сравнение." />
                    </Badge>
                  )}
                </div>
                {!report.pairs.length ? (
                  <Empty
                    title="Нет пар для отображения"
                    detail="Проверьте язык и объём доступных исходников."
                  />
                ) : (
                  report.pairs.map((pair) => (
                    <Comparison
                      key={`${report.id}-${pair.id}-${pair.decision.status}-${pair.decision.comment}`}
                      pair={pair}
                      runId={report.id}
                    />
                  ))
                )}
              </>
            )}
          </>
        )
      )}
    </Card>
  );
}
function Comparison({ pair, runId }: { pair: Pair; runId: string }) {
  const { run, busy } = useAction();
  const [status, setStatus] = useState(pair.decision.status);
  const [comment, setComment] = useState(pair.decision.comment);
  async function save(e: FormEvent) {
    e.preventDefault();
    await run(
      `/similarity/${runId}/pairs/${pair.id}`,
      { status, comment },
      'PATCH',
      'Решение сохранено',
    );
  }
  return (
    <article className="similarity-pair">
      <div className="row between wrap">
        <div>
          <h3>
            {pair.leftName} ↔ {pair.rightName}
          </h3>
          <span className="muted small">{pair.matchCount} совпавших фрагментов</span>
        </div>
        <div className="row">
          <strong className="similarity-score">{pair.averagePercent}%</strong>
          <Help
            text={`Среднее сходство по JPlag. Максимальная доля совпадений в одной из работ: ${pair.maxPercent}%. Сходство может объясняться общим шаблоном или условиями задания.`}
          />
          <Badge
            tone={
              pair.decision.status === 'confirmed'
                ? 'purple'
                : pair.decision.status === 'dismissed'
                  ? 'green'
                  : 'yellow'
            }
          >
            {pair.decision.status === 'confirmed'
              ? 'Нужен разбор со студентами'
              : pair.decision.status === 'dismissed'
                ? 'Совпадение объяснено'
                : 'Ожидает решения'}
          </Badge>
        </div>
      </div>
      <details>
        <summary>Совпавшие фрагменты и решение</summary>
        {pair.matches?.map((match, i) => (
          <div className="similarity-sources" key={i}>
            {(['left', 'right'] as const).map((side) => (
              <div key={side}>
                <h3>
                  {side === 'left' ? pair.leftName : pair.rightName} · {match[side].path}:
                  {match[side].start}–{match[side].end}
                </h3>
                <pre>
                  <code>{match[side].code}</code>
                </pre>
                {match[side].truncated && <small>Показаны первые 200 строк фрагмента</small>}
              </div>
            ))}
          </div>
        ))}
        {pair.matchesTruncated && <p className="muted small">Показана часть совпадений.</p>}
        <form className="form-stack" onSubmit={save}>
          <Field label="Решение проверяющего">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="pending">Ожидает решения</option>
              <option value="confirmed">Обсудить совпадения со студентами</option>
              <option value="dismissed">Совпадение объяснено</option>
            </select>
          </Field>
          <Field
            label={
              status === 'confirmed' ? 'Комментарий для обоих студентов' : 'Внутренний комментарий'
            }
            hint="При подтверждении этот текст увидят оба участника сравнения в своих курсах. Проценты и чужой код студентам не показываются. Автоматического штрафа нет."
          >
            <textarea
              required={status === 'confirmed'}
              maxLength={4000}
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </Field>
          <div>
            <Button type="submit" variant="primary" busy={busy}>
              Сохранить решение
            </Button>
          </div>
        </form>
      </details>
    </article>
  );
}
