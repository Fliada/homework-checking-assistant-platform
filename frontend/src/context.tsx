import { createContext, useContext, useState, type ReactNode } from 'react';
import { api, queryClient } from './api';
import type { Bootstrap } from './types';
export const DataContext = createContext<Bootstrap | null>(null);
export function useData() {
  const data = useContext(DataContext);
  if (!data) throw new Error('Missing data provider');
  return data;
}
const ToastContext = createContext<(message: string, error?: boolean) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; text: string; error: boolean }[]>([]);
  function toast(text: string, error = false) {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 9000 : 4500);
  }
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.error ? 'error' : ''}`}
            role={t.error ? 'alert' : 'status'}
          >
            {t.text}
            <button
              onClick={() => setToasts((a) => a.filter((x) => x.id !== t.id))}
              aria-label="Скрыть уведомление"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export function useAction() {
  const toast = useContext(ToastContext);
  const [busy, setBusy] = useState(false);
  async function run<T = unknown>(
    path: string,
    body?: unknown,
    method?: string,
    message = 'Изменения сохранены',
  ): Promise<T | undefined> {
    setBusy(true);
    try {
      const result = await api<T>(path, body, method);
      await Promise.all(
        ['bootstrap', 'courses', 'course-progress', 'similarity'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      );
      if (message) toast(message);
      return result;
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Не удалось выполнить действие', true);
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, toast };
}
