import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ArrowRight, Check, HelpCircle, Inbox, LoaderCircle, X } from 'lucide-react';
import { statusLabels } from '../types';

export function Button({
  children,
  variant = 'secondary',
  busy,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
  busy?: boolean;
}) {
  return (
    <button {...props} disabled={busy || props.disabled} className={`btn ${variant} ${className}`}>
      {busy && <LoaderCircle size={16} className="spin" />}
      {children}
    </button>
  );
}
export function Help({ text }: { text: string }) {
  const id = useId();
  return (
    <span className="help">
      <button type="button" aria-label="Справка" aria-describedby={id}>
        <HelpCircle size={15} />
      </button>
      <span role="tooltip" id={id}>
        {text}
      </span>
    </span>
  );
}
export function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Status({ value }: { value: string }) {
  const tone = /confirmed|feedback_sent|completed|published|accepted|active|^ok$/.test(value)
    ? 'green'
    : /error|failed|rejected|disabled/.test(value)
      ? 'red'
      : /human|pending|draft|queued/.test(value)
        ? 'yellow'
        : 'blue';
  return <Badge tone={tone}>{statusLabels[value] || value}</Badge>;
}
export function PageTitle({
  title,
  eyebrow,
  help,
  actions,
}: {
  title: string;
  eyebrow?: string;
  help?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-title">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <div className="row">
          <h1>{title}</h1>
          {help && <Help text={help} />}
        </div>
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}
export function Empty({
  title = 'Пока нет данных',
  detail,
  action,
}: {
  title?: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <Inbox size={30} strokeWidth={1.4} />
      <h3>{title}</h3>
      {detail && <p>{detail}</p>}
      {action}
    </div>
  );
}
export function Metric({
  label,
  value,
  detail,
  tone = '',
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: string;
}) {
  return (
    <div className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <span>
        <label htmlFor={id}>{label}</label>
        {hint && <Help text={hint} />}
      </span>
      {Children.map(children, (child) =>
        isValidElement(child) &&
        typeof child.type === 'string' &&
        ['input', 'textarea', 'select'].includes(child.type)
          ? cloneElement(child as ReactElement<{ id?: string }>, { id })
          : child,
      )}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    ref.current?.showModal();
    const el = ref.current;
    return () => {
      el?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? 'wide' : ''}
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button onClick={onClose} aria-label="Закрыть" className="icon-button">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" /> Загрузка…
    </div>
  );
}
export function ErrorState({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <Card>
      <Empty
        title="Не удалось загрузить данные"
        detail={error instanceof Error ? error.message : 'Повторите запрос'}
        action={
          <Button onClick={retry}>
            Повторить <ArrowRight size={16} />
          </Button>
        }
      />
    </Card>
  );
}
export function Saved({ busy }: { busy?: boolean }) {
  return (
    <span className="save-state">
      {busy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
      {busy ? 'Сохраняем…' : 'Сохранено'}
    </span>
  );
}
export function formatDate(value?: string | null, time = false) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'short',
        ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
      }).format(d);
}
export function dateInput(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function initials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((x) => x[0])
    .join('');
}
export function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const text =
    '\ufeff' +
    rows
      .map((row) =>
        row
          .map((cell) => {
            let value = String(cell ?? '');
            if (/^[=+@\-\t\r]/.test(value)) value = "'" + value;
            return '"' + value.replaceAll('"', '""') + '"';
          })
          .join(';'),
      )
      .join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
