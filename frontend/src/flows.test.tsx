import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { api, queryClient } from './api';
import { DataContext, ToastProvider } from './context';
import { Ledger, Student, Assignments, Analytics, Notifications } from './pages/overview';
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
  it('передаёт введённую оценку вместе с явным подтверждением', async () => {
    const user = userEvent.setup();
    mount(<ReviewWorkspace />, fixture(), '/review/r1');
    await user.type(screen.getByRole('spinbutton', { name: 'Оценка: HTTP server' }), '7');
    await user.click(screen.getByRole('checkbox', { name: 'Оценка проверена' }));
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
