import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { api, queryClient } from './api';
import { DataContext, ToastProvider } from './context';
import { Ledger, Student, Assignments, Analytics, Notifications } from './pages/overview';
import { CourseDetail } from './pages/courses';
import { SimilarityPanel } from './pages/similarity';
import { Expert } from './pages/expert';
import { ReviewWorkspace } from './pages/review';
import { Administration, Coordinator, Evals, Models } from './pages/management';
import { taskNames, type Bootstrap, type TaskType } from './types';

vi.mock('./api', async () => ({
  ...(await vi.importActual('./api')),
  api: vi.fn(async () => ({ ok: true })),
}));
const mockedApi = vi.mocked(api);
function fixture(): Bootstrap {
  const rubric = {
    id: 'rubric-1',
    version: 1,
    status: 'published',
    criteria: [
      {
        id: 'c1',
        title: 'HTTP server',
        description: 'Сервер корректно отвечает на запросы.',
        maxScore: 10,
        mode: 'llm' as const,
        required: true,
      },
    ],
  };
  const reviewer = {
    id: 'reviewer',
    name: 'Мария Смирнова',
    email: 'reviewer@test.local',
    role: 'reviewer' as const,
    status: 'active',
    courseIds: ['go'],
    capacityMinutes: 240,
    available: true,
  };
  const student = { ...reviewer, id: 'student', name: 'Артём Волков', role: 'student' as const };
  return {
    user: reviewer,
    users: [reviewer, student],
    courses: [{ id: 'go', title: 'Go', run: 'Осень 2026', expertId: 'expert', status: 'active' }],
    assignments: [
      {
        id: 'a1',
        courseId: 'go',
        code: 'ДЗ 1',
        title: 'HTTP-сервис',
        taskText: 'Создайте сервер.',
        dueAt: '2026-10-01T12:00:00Z',
        reviewDueAt: '2026-10-05T12:00:00Z',
        estimatedMinutes: 30,
        status: 'active',
        rubric,
        references: [],
        latePolicy: { enabled: false, type: 'fixed', value: 0, intervalDays: 1 },
        activeConfigVersion: 1,
      },
    ],
    submissions: [
      {
        id: 's1',
        assignmentId: 'a1',
        studentId: 'student',
        reviewerId: 'reviewer',
        prUrl: 'https://github.com/example/course/pull/1',
        attempt: 1,
        submittedAt: '2026-09-01T12:00:00Z',
        status: 'needs_human',
        headSha: 'abc123',
        reviewId: 'r1',
        artifacts: [
          {
            id: 'f1',
            path: 'main.go',
            mediaType: 'text/plain',
            parseStatus: 'parsed',
            segments: [{ id: 'l1', anchor: 'line:1', text: 'package main' }],
          },
        ],
      },
    ],
    reviews: [
      {
        id: 'r1',
        submissionId: 's1',
        reviewerId: 'reviewer',
        status: 'needs_human',
        configVersion: 1,
        rubric,
        results: [
          {
            criterionId: 'c1',
            suggestedScore: null,
            finalScore: null,
            confidence: 0,
            abstained: true,
            reason: 'Требуется решение ревьюера',
            confirmed: false,
            note: '',
          },
        ],
        annotations: [],
        feedback: '',
        feedbackStale: true,
        finalScore: null,
        draftScore: null,
        confirmedAt: null,
        activeMinutes: 0,
        revision: 1,
        integrity: { status: 'mock', decision: 'deferred', level: null, message: '' },
      },
    ],
    models: [],
    configs: [
      {
        id: 'config-1',
        assignmentId: 'a1',
        version: 1,
        status: 'published',
        tasks: Object.fromEntries(
          Object.keys(taskNames).map((task) => [
            task,
            {
              modelId: 'model-1',
              prompt: 'Проверь критерий по подтверждаемым фрагментам.',
              temperature: 0.2,
              topP: 0.9,
              maxOutputTokens: 4000,
            },
          ]),
        ) as Bootstrap['configs'][number]['tasks'],
        thresholds: { abstain: 0.6, critic: 0.6 },
        createdAt: '2026-09-01T00:00:00Z',
        publishedAt: '2026-09-01T00:00:00Z',
      },
    ],
    evals: [],
    notifications: [],
    audit: [],
    flags: [],
    settings: { maxFileMb: 10, maxFiles: 100, maxReviewTokens: 16000, mode: 'dev_demo' },
    debug: false,
  };
}
function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}
function mount(element: React.ReactNode, data = fixture(), path = '/') {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <DataContext.Provider value={data}>
            <Routes>
              <Route path="/review/:id" element={element} />
              <Route path="/courses/:id" element={element} />
              <Route path="/expert/:id" element={element} />
              <Route path="*" element={element} />
            </Routes>
            <Location />
          </DataContext.Provider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  mockedApi.mockResolvedValue({ ok: true });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

describe('основные рабочие кабинеты', () => {
  it.each([
    ['ведомость', <Ledger />, 'Ведомость'],
    ['задания', <Assignments />, 'Задания и критерии'],
    ['координатор', <Coordinator />, 'Распределение работ'],
    ['администратор', <Administration />, 'Сотрудники и доступ'],
    ['модели', <Models />, 'Модели и настройки'],
    ['аналитика', <Analytics />, 'Аналитика'],
    ['eval', <Evals />, 'Тестирование агента'],
    ['уведомления', <Notifications />, 'Уведомления'],
  ])('%s отображается без измеренных метрик модели', (_, page, title) => {
    mount(page);
    expect(screen.getByRole('heading', { level: 1, name: String(title) })).toBeTruthy();
  });
  it('студент не получает неподтверждённый feedback', () => {
    const data = fixture();
    data.user = data.users[1];
    data.reviews = [];
    mount(<Student />, data);
    expect(screen.getByRole('heading', { name: 'Мои задания' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Результат/ })).toBeNull();
  });
});

describe('подключение Gemma', () => {
  it('создаёт Google-модель с серверной переменной ключа и JSON по инструкции', async () => {
    mount(<Models />);
    await userEvent.click(screen.getByRole('button', { name: 'Подключить модель' }));
    expect((screen.getByLabelText('Провайдер') as HTMLSelectElement).value).toBe('gemini');
    expect((screen.getByLabelText('Base URL') as HTMLInputElement).value).toBe(
      'https://generativelanguage.googleapis.com/v1beta',
    );
    expect((screen.getByLabelText('Имя модели у провайдера') as HTMLInputElement).value).toBe(
      'gemma-4-31b-it',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/admin/models',
        expect.objectContaining({
          provider: 'gemini',
          modelName: 'gemma-4-31b-it',
          apiKeyEnv: 'GEMINI_API_KEY',
          capabilities: expect.objectContaining({ jsonSchema: false, jsonMode: false }),
        }),
        'POST',
      ),
    );
  });
  it('сохраняет отключённый JSON mode при редактировании существующей Gemma', async () => {
    const data = fixture();
    data.models = [
      {
        id: 'model-1',
        name: 'Gemma',
        provider: 'gemini',
        group: 'balanced',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        modelName: 'gemma-4-31b-it',
        apiKeyEnv: 'GEMINI_API_KEY',
        enabled: true,
        secretPresent: false,
        health: 'missing',
        defaultParams: {
          temperature: 0.2,
          maxOutputTokens: 4000,
          timeoutSeconds: 90,
          maxRetries: 2,
        },
        capabilities: { jsonSchema: false, jsonMode: false, maxContextTokens: 32000 },
      },
    ];
    mount(<Models />, data);
    await userEvent.click(screen.getByRole('button', { name: 'Настроить' }));
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/admin/models/model-1',
        expect.objectContaining({
          provider: 'gemini',
          apiKeyEnv: 'GEMINI_API_KEY',
          capabilities: expect.objectContaining({ jsonSchema: false, jsonMode: false }),
        }),
        'PATCH',
      ),
    );
  });
});

describe('контроль решений ревьюера', () => {
  it('повторяет загрузку после ошибки импорта и открывает новую проверку', async () => {
    const data = fixture();
    data.submissions[0].artifacts = [];
    data.submissions[0].error = 'Ошибка загрузки GitHub';
    mockedApi.mockResolvedValue({ reviewId: 'retry-review' });
    mount(<ReviewWorkspace />, data, '/review/r1');
    await userEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }));
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        `/submissions/${data.submissions[0].id}/reprocess`,
        {},
        'POST',
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/review/retry-review'),
    );
  });
  it('показывает ограниченность контекста PR', () => {
    const data = fixture();
    data.submissions[0].snapshotComplete = false;
    data.submissions[0].snapshotScope = 'pull_request';
    mount(<ReviewWorkspace />, data, '/review/r1');
    expect(screen.getByText('Контекст ограничен')).toBeTruthy();
  });
  it('не подтверждает работу без явно проверенных оценок', () => {
    mount(<ReviewWorkspace />, fixture(), '/review/r1');
    expect(
      (screen.getByRole('button', { name: 'Подтвердить проверку' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('spinbutton', { name: 'Оценка: HTTP server' }) as HTMLInputElement).value,
    ).toBe('');
  });
  it('подтверждает ручную оценку без чекбокса', async () => {
    const user = userEvent.setup();
    mount(<ReviewWorkspace />, fixture(), '/review/r1');
    await user.type(screen.getByRole('spinbutton', { name: 'Оценка: HTTP server' }), '7');
    expect(screen.queryByRole('checkbox', {name: 'Оценка проверена'})).toBeNull();
    await user.tab();
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/reviews/r1/criteria/c1',
        { finalScore: 7, confirmed: true },
        'PATCH',
      ),
    );
  });
  it('не отправляет устаревшую обратную связь', () => {
    const data = fixture();
    data.reviews[0].results[0].confirmed = true;
    data.reviews[0].results[0].finalScore = 8;
    data.reviews[0].feedback = 'Старый текст';
    mount(<ReviewWorkspace />, data, '/review/r1');
    expect(
      (screen.getByRole('button', { name: 'Подтвердить проверку' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
  it('показывает снижение за просрочку до подтверждения результата', async () => {
    const data = fixture();
    Object.assign(data.reviews[0], { feedbackStale: false, feedback: 'Проверено', latePenalty: 2 });
    Object.assign(data.reviews[0].results[0], { finalScore: 10, confirmed: true });
    mount(<ReviewWorkspace />, data, '/review/r1');
    expect(screen.getByText('По критериям: 10 · Снижение за просрочку: 2 · Итог: 8')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить проверку' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
  it('после повторного анализа переходит к новой проверке', async () => {
    mockedApi.mockImplementation(async (path) =>
      path.endsWith('/pre-review') ? { reviewId: 'r2' } : { ok: true },
    );
    mount(<ReviewWorkspace />, fixture(), '/review/r1');
    await userEvent.click(screen.getByRole('button', { name: 'Повторить анализ' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/review/r2'));
  });
});

describe('редактор заданий', () => {
  it('создаёт первую рубрику через POST, когда в задании нет версии', async () => {
    const user = userEvent.setup();
    const data = fixture();
    data.user = { ...data.user, role: 'expert' };
    data.assignments[0].rubric = { id: '', version: 0, status: 'draft', criteria: [] };
    mount(<Expert />, data, '/expert/a1');
    await user.click(screen.getByRole('button', { name: 'Критерии' }));
    await user.click(screen.getByRole('button', { name: 'Критерий' }));
    await user.type(screen.getByLabelText('Критерий'), 'Проверка HTTP');
    await user.click(screen.getByRole('button', { name: 'Сохранить черновик' }));
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/assignments/a1/rubrics',
        expect.objectContaining({ criteria: expect.any(Array) }),
        'POST',
      ),
    );
  });
  it('не редактирует опубликованную конфигурацию на месте', async () => {
    const data = fixture();
    data.user = { ...data.user, role: 'expert' };
    mount(<Expert />, data, '/expert/a1');
    await userEvent.click(screen.getByRole('button', { name: 'Настройки агента' }));
    expect((screen.getByLabelText(/Промпт этапа/) as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /^Сохранить$/ })).toBeNull();
  });
});

describe('курсы и сходство кода', () => {
  it('студент открывает своё задание из курса без служебных вкладок', async () => {
    const data = fixture();
    data.user = data.users[1];
    mockedApi.mockResolvedValue({
      course: data.courses[0],
      studentCount: 1,
      assignmentCount: 1,
      total: 1,
      counts: { checking: 1 },
      completionPercent: 0,
      points: [],
      weakCriteria: [],
      assignments: [
        {
          id: 'a1',
          code: 'ДЗ 1',
          title: 'HTTP-сервис',
          dueAt: '2026-10-01',
          reviewDueAt: '2026-10-05',
          counts: { checking: 1 },
          total: 1,
          waitingMinutes: 30,
          rows: [
            {
              studentId: 'student',
              studentName: 'Артём',
              state: 'checking',
              status: 'in_review',
              submissionId: 's1',
              reviewId: null,
              submittedAt: '2026-09-01',
              attempt: 2,
              score: null,
              maxScore: 10,
              lateDays: -30,
              agentNotes: [],
              similarityComments: ['Поясните выбранный алгоритм.'],
            },
          ],
        },
      ],
    });
    mount(<CourseDetail />, data, '/courses/go');
    expect(await screen.findByRole('heading', { name: 'HTTP-сервис' })).toBeTruthy();
    expect(screen.getByText('Поясните выбранный алгоритм.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Моя работа' }).getAttribute('href')).toBe(
      '/student?course=go&assignment=a1',
    );
    expect(screen.queryByRole('button', { name: 'Сходство кода' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Успеваемость' })).toBeNull();
  });
  it('отправляет решение JPlag с комментарием, не вызывая изменения оценки', async () => {
    const report = {
      id: 'run1',
      status: 'completed',
      language: 'go',
      createdAt: '2026-09-05',
      engine: 'JPlag 6.3.0',
      submissionCount: 2,
      sources: [],
      excludedIds: [],
      failedSubmissions: [],
      pairs: [
        {
          id: 'pair1',
          leftId: 's1',
          rightId: 's2',
          leftName: 'Анна',
          rightName: 'Борис',
          averagePercent: 85,
          maxPercent: 90,
          matchCount: 1,
          matches: [
            {
              left: { path: 'main.go', start: 1, end: 1, code: 'package main' },
              right: { path: 'main.go', start: 1, end: 1, code: 'package main' },
            },
          ],
          decision: { status: 'pending', comment: '' },
        },
      ],
    };
    mockedApi.mockImplementation(async (path) =>
      path.includes('/assignments/')
        ? { installed: true, languages: ['go'], runs: [report] }
        : report,
    );
    mount(<SimilarityPanel assignments={[{ id: 'a1', code: 'ДЗ 1', title: 'HTTP-сервис' }]} />);
    await userEvent.click(await screen.findByText('Совпавшие фрагменты и решение'));
    expect(screen.getAllByText('package main').length).toBe(2);
    await userEvent.selectOptions(screen.getByLabelText('Решение проверяющего'), 'confirmed');
    const field = screen.getByLabelText('Комментарий для обоих студентов');
    expect((field as HTMLTextAreaElement).required).toBe(true);
    await userEvent.type(field, 'Объясните этот фрагмент.');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить решение' }));
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/similarity/run1/pairs/pair1',
        { status: 'confirmed', comment: 'Объясните этот фрагмент.' },
        'PATCH',
      ),
    );
    expect(
      mockedApi.mock.calls.some(
        ([path]) => path.includes('/criteria') || path.includes('/confirm'),
      ),
    ).toBe(false);
  });
});

describe('категории замечаний в коде', () => {
  it('после выделения сразу выбирает категорию и сохраняет её с диапазоном', async () => {
    const interaction = userEvent.setup();
    const data = fixture();
    data.submissions[0].artifacts[0].segments.push({
      id: 'l2',
      anchor: 'line:2',
      text: 'func main() {}',
    });
    mount(<ReviewWorkspace />, data, '/review/r1');
    await interaction.click(screen.getByRole('button', { name: /package main/ }));
    await interaction.keyboard('{Shift>}');
    await interaction.click(screen.getByRole('button', { name: /func main/ }));
    await interaction.keyboard('{/Shift}');
    await interaction.click(screen.getByRole('button', { name: 'Требование задания' }));
    expect((screen.getByLabelText('Категория') as HTMLSelectElement).value).toBe('requirement');
    await interaction.type(screen.getByLabelText('Комментарий'), 'Добавьте обработку сигнала.');
    await interaction.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/reviews/r1/annotations',
        expect.objectContaining({
          category: 'requirement',
          anchor: expect.objectContaining({ start: 'line:1', end: 'line:2' }),
        }),
        'POST',
      ),
    );
  });
  it('подсвечивает весь диапазон, пересечения категорий и исключает отклонённые заметки', () => {
    const data = fixture();
    data.submissions[0].artifacts[0].segments.push(
      { id: 'l2', anchor: 'line:2', text: 'func main() {}' },
      { id: 'l3', anchor: 'line:3', text: '// end' },
    );
    data.reviews[0].annotations = [
      {
        id: 'n1',
        criterionId: null,
        category: 'logic',
        source: 'reviewer',
        status: 'accepted',
        message: 'Логика',
        visibleToStudent: true,
        anchor: { artifactId: 'f1', path: 'main.go', start: 'line:1', end: 'line:2', quote: '' },
      },
      {
        id: 'n2',
        criterionId: null,
        category: 'quality',
        source: 'reviewer',
        status: 'accepted',
        message: 'Стиль',
        visibleToStudent: true,
        anchor: { artifactId: 'f1', path: 'main.go', start: 'line:2', end: 'line:2', quote: '' },
      },
      {
        id: 'n3',
        criterionId: null,
        category: 'positive',
        source: 'ai',
        status: 'rejected',
        message: 'Хорошо',
        visibleToStudent: true,
        anchor: { artifactId: 'f1', path: 'main.go', start: 'line:3', end: 'line:3', quote: '' },
      },
    ];
    mount(<ReviewWorkspace />, data, '/review/r1');
    expect(screen.getByRole('button', { name: /package main/ }).className).toContain(
      'category-logic',
    );
    const second = screen.getByRole('button', { name: /func main/ });
    expect(second.className).toContain('annotated');
    expect(second.querySelectorAll('.category-dot').length).toBe(2);
    expect(screen.getByRole('button', { name: /\/\/ end/ }).className).not.toContain('annotated');
  });
});
