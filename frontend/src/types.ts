export type Role =
  'student' | 'reviewer' | 'coordinator' | 'expert' | 'moderator' | 'admin' | 'owner' | 'pending';
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: string;
  courseIds: string[];
  capacityMinutes: number;
  available: boolean;
}
export interface Course {
  id: string;
  title: string;
  run: string;
  expertId: string;
  status: string;
}
export interface Criterion {
  id: string;
  title: string;
  description: string;
  maxScore: number;
  mode: 'llm' | 'human' | 'external' | 'deterministic' | 'deterministic_or_llm';
  required: boolean;
}
export interface Rubric {
  id: string;
  version: number;
  status: string;
  criteria: Criterion[];
}
export interface Reference {
  id: string;
  type: 'reference' | 'weak' | 'medium' | 'good' | 'guide';
  name: string;
  url: string;
}
export interface Assignment {
  id: string;
  courseId: string;
  code: string;
  title: string;
  taskText: string;
  dueAt: string;
  reviewDueAt: string;
  estimatedMinutes: number;
  status: string;
  rubric: Rubric;
  rubricDraft?: Rubric | null;
  references: Reference[];
  latePolicy: { enabled: boolean; type: 'fixed' | 'percent'; value: number; intervalDays: number };
  activeConfigVersion: number | null;
}
export interface Segment {
  id: string;
  anchor: string;
  text: string;
}
export interface Artifact {
  id: string;
  path: string;
  mediaType: string;
  parseStatus: string;
  segments: Segment[];
}
export interface Submission {
  id: string;
  assignmentId: string;
  studentId: string;
  reviewerId: string | null;
  prUrl: string;
  attempt: number;
  submittedAt: string;
  status: string;
  headSha: string;
  snapshotScope?: 'repository' | 'pull_request' | null;
  snapshotComplete?: boolean | null;
  artifacts: Artifact[];
  error?: string | null;
  reviewId?: string | null;
}
export interface CriterionResult {
  criterionId: string;
  suggestedScore: number | null;
  finalScore: number | null;
  confidence: number;
  abstained: boolean;
  reason: string;
  confirmed: boolean;
  note: string;
}
export interface SourceAnchor {
  artifactId: string;
  path: string;
  start: string;
  end: string;
  quote: string;
}
export interface Annotation {
  id: string;
  criterionId: string | null;
  category: string;
  source: 'ai' | 'reviewer';
  status: 'pending' | 'accepted' | 'edited' | 'rejected';
  message: string;
  visibleToStudent: boolean;
  anchor: SourceAnchor;
}
export interface Review {
  id: string;
  submissionId: string;
  reviewerId: string | null;
  status: string;
  configVersion: number | null;
  rubric: Rubric;
  results: CriterionResult[];
  annotations: Annotation[];
  feedback: string;
  feedbackStale: boolean;
  finalScore: number | null;
  draftScore: number | null;
  confirmedAt: string | null;
  activeMinutes: number;
  revision?: number;
  latePenalty?: number;
  scoreBeforePenalty?: number;
  integrity: {
    status: string;
    decision: string;
    level: string | null;
    message: string;
    aiScore?: number | null;
    ai_score?: number | null;
    signals?: IntegritySignal[];
    highlights?: IntegrityHighlight[];
  };
}
export interface IntegrityHighlight {
  id: string;
  signalId?: string;
  signal_id?: string;
  artifactId?: string;
  artifact_id?: string;
  path: string;
  kind: string;
  startLine?: number;
  start_line?: number;
  endLine?: number;
  end_line?: number;
  aiScore?: number;
  ai_score?: number;
  level: string;
  status: string;
  message: string;
  reasons?: string[];
}
export interface IntegritySignal {
  id: string;
  artifactId?: string;
  artifact_id?: string;
  path: string;
  kind: string;
  blockName?: string;
  block_name?: string;
  startLine?: number;
  start_line?: number;
  endLine?: number;
  end_line?: number;
  classification: string;
  aiScore?: number;
  ai_score?: number;
  level: string;
  status: string;
  message: string;
}
export interface ModelEndpoint {
  id: string;
  name: string;
  provider: string;
  group: string;
  baseUrl: string;
  modelName: string;
  apiKeyEnv: string;
  enabled: boolean;
  secretPresent: boolean;
  health: string;
  defaultParams: {
    temperature: number;
    maxOutputTokens: number;
    timeoutSeconds: number;
    maxRetries: number;
  };
  capabilities: { jsonSchema: boolean; jsonMode?: boolean; maxContextTokens: number };
}
export const taskNames = {
  artifact_triage: 'Выбор контекста',
  criterion_evaluation: 'Оценка критериев',
  annotation_generation: 'Создание замечаний',
  integrity_reasoning: 'Выявление ИИ',
  review_critic: 'Проверка черновика',
  feedback_compose: 'Сборка обратной связи',
};
export type TaskType = keyof typeof taskNames;
export interface TaskConfig {
  modelId: string;
  prompt: string;
  temperature: number;
  topP: number;
  maxOutputTokens: number;
}
export interface AgentConfig {
  id: string;
  assignmentId: string;
  version: number;
  status: 'draft' | 'evaluated' | 'published' | 'archived';
  tasks: Record<TaskType, TaskConfig>;
  thresholds: { abstain: number; critic: number };
  createdAt: string;
  publishedAt: string | null;
}
export interface EvalRun {
  exampleCount?: number;
  logs?: { time: string; event: string; level?: string; repetition?: number; stage?: string; criterion?: string; error?: string; completed?: number; total?: number }[];
  id: string;
  assignmentId: string;
  configVersion: number;
  repetitions: number;
  status: string;
  createdAt: string;
  error: string | null;
  metrics: {
    orderingAccuracy?: number;
    stability?: number;
    anchorValidity?: number;
    abstainRate?: number;
    latencySeconds?: number;
    totalTokens?: number;
  };
  outputs: {
    example: string;
    repetition: number;
    score: number | null;
    modelId: string;
    error?: string;
  }[];
}
export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  href: string;
}
export interface AuditEvent {
  id: string;
  actorId: string;
  action: string;
  entityId: string;
  createdAt: string;
}
export interface RubricFlag {
  id: string;
  assignmentId: string;
  criterionId: string;
  message: string;
  status: string;
  createdAt: string;
}
export interface Settings {
  maxFileMb: number;
  maxFiles: number;
  maxReviewTokens: number;
  mode: string;
}
export interface Bootstrap {
  user: User;
  users: User[];
  courses: Course[];
  assignments: Assignment[];
  submissions: Submission[];
  reviews: Review[];
  models: ModelEndpoint[];
  configs: AgentConfig[];
  evals: EvalRun[];
  notifications: Notification[];
  audit: AuditEvent[];
  flags: RubricFlag[];
  settings: Settings;
  debug: boolean;
}
export const roleLabels: Record<Role, string> = {
  student: 'Студент',
  reviewer: 'Ревьюер',
  coordinator: 'Координатор',
  expert: 'Эксперт',
  moderator: 'Модератор',
  admin: 'Администратор',
  owner: 'Владелец',
  pending: 'Ожидает роли',
};
export const statusLabels: Record<string, string> = {
  not_submitted: 'Не сдано',
  submitted: 'Отправлено',
  ingesting: 'Загрузка файлов',
  llm_processing: 'AI-анализ',
  ready: 'Готово к проверке',
  pre_review_running: 'AI-анализ',
  draft_ready: 'Черновик готов',
  assigned: 'Назначено',
  in_review: 'На проверке',
  confirmed: 'Проверено',
  feedback_sent: 'Результат готов',
  needs_human: 'Нужна ручная проверка',
  configuration_error: 'Ошибка конфигурации',
  failed: 'Ошибка',
  queued: 'В очереди',
  running: 'Выполняется',
  completed: 'Завершено',
  draft: 'Черновик',
  evaluated: 'Проверено на примерах',
  published: 'Опубликовано',
  archived: 'Архив',
  active: 'Активно',
  pending: 'Ожидает решения',
  accepted: 'Принято',
  rejected: 'Отклонено',
  edited: 'Изменено',
  disabled: 'Отключено',
  ok: 'Доступно',
  missing: 'Не настроено',
  unknown: 'Не проверено',
  unavailable: 'Нет соединения',
  blocked: 'Недоступно в этом режиме',
  unsupported: 'Генерация не поддерживается',
  invalid_response: 'Некорректный ответ API',
  http_401: 'Ключ не принят',
  http_403: 'Нет доступа к модели',
  http_404: 'Модель не найдена',
  http_429: 'Лимит запросов исчерпан',
  needs_role: 'Ожидает роли',
};
