import { useEffect, useRef, useCallback } from 'react';
import type { SSEProgressEvent } from '../types';

const BASE = (import.meta.env.VITE_API_URL || '') + '/api/v1';

interface UseSSEOptions {
  jobId: string | null;
  onEvent: (event: SSEProgressEvent) => void;
  onError?: (err: Event) => void;
  enabled?: boolean;
}

export function useSSEProgress({ jobId, onEvent, onError, enabled = true }: UseSSEOptions) {
  const esRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    if (!jobId || !enabled) return;
    if (esRef.current) {
      esRef.current.close();
    }

    const url = `${BASE}/jobs/${jobId}/progress`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data) as SSEProgressEvent;
        onEventRef.current(payload);
        // Auto-close on terminal states
        if (payload.event_type === 'stream_end' || ['completed', 'failed', 'finalized'].includes(payload.status)) {
          es.close();
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = (err) => {
      onError?.(err);
      es.close();
    };
  }, [jobId, enabled, onError]);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
    };
  }, [connect]);

  const disconnect = useCallback(() => {
    esRef.current?.close();
  }, []);

  return { connect, disconnect };
}
