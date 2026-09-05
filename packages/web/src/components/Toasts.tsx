import * as React from 'react';
import { createPortal } from 'react-dom';
import { BellRing, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';

export interface ToastItem {
  id: string;
  title: string;
  body?: string;
  objectId?: string | null;
}

interface ToastContextValue {
  push: (t: Omit<ToastItem, 'id'>) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToasts(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToasts must be used within ToastProvider');
  return ctx;
}

/** In-app toast host + context. Used for notifications while the app is
 *  open — works in the Electron shell where OS push isn't available. */
export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const navigate = useNavigate();
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  const remove = (id: string): void => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  };

  const push = React.useCallback((t: Omit<ToastItem, 'id'>): void => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    window.setTimeout(() => {
      setToasts((ts) => ts.filter((x) => x.id !== id));
    }, 6000);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      {createPortal(
        <div className="fixed bottom-24 sm:bottom-4 left-4 right-4 sm:left-auto sm:right-4 z-[100] flex flex-col gap-2 sm:w-[320px] sm:max-w-[calc(100vw-2rem)]">
          {toasts.map((t) => (
            <div
              key={t.id}
              role="alert"
              className="animate-in slide-in-from-bottom-2 rounded-xl border border-border-default bg-surface-0 shadow-xl overflow-hidden"
            >
              <div className="flex items-start gap-3 px-3.5 py-3">
                <div className="w-7 h-7 rounded-lg bg-accent/15 text-accent-text flex items-center justify-center shrink-0">
                  <BellRing className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-text-primary leading-snug">{t.title}</div>
                  {t.body ? (
                    <div className="text-[12px] text-text-tertiary mt-0.5 line-clamp-2">{t.body}</div>
                  ) : null}
                  {t.objectId ? (
                    <button
                      type="button"
                      onClick={() => {
                        navigate(`/objects/${t.objectId}`);
                        remove(t.id);
                      }}
                      className="mt-1 text-[11px] font-medium text-accent-text hover:underline"
                    >
                      Open
                    </button>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => remove(t.id)}
                  aria-label="Dismiss"
                  className={cn('text-text-quaternary hover:text-text-primary transition shrink-0')}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
