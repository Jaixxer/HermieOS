import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useServer } from '../server';

import type { ObjectSummary } from '../api';

export const scoutKeys = {
  all: ['subscriptions'] as const,
  metrics: (id: string) => ['scout-metrics', id] as const,
  runs: (id: string) => ['scout-runs', id] as const,
  findings: (id: string) => ['scout-findings', id] as const,
  opportunities: ['opportunities'] as const,
};

export const categoryKeys = {
  all: ['categories'] as const,
  active: ['categories', 'active'] as const,
};

export function useScouts() {
  const { connected } = useServer();
  return useQuery({
    queryKey: scoutKeys.all,
    queryFn: async () => (await api.subscriptions()).subscriptions,
    enabled: connected,
    refetchInterval: 30_000,
  });
}

export function useCategories() {
  const { connected } = useServer();
  return useQuery({
    queryKey: categoryKeys.active,
    queryFn: () => api.categories(),
    enabled: connected,
    refetchInterval: 60_000,
    select: (d) => d.categories,
  });
}

export function useFindings() {
  const { connected } = useServer();
  return useQuery({
    queryKey: ['findings-for-buckets'],
    queryFn: async () => {
      const types = ['opportunity', 'discovery', 'research', 'project', 'decision', 'learning_path'];
      const results = await Promise.all(
        types.map((type) => api.listObjects({ type, limit: 200 }).then((r) => r.objects)),
      );
      const seen = new Set<string>();
      const out: ObjectSummary[] = [];
      for (const list of results) {
        for (const o of list) {
          if (seen.has(o.id)) continue;
          seen.add(o.id);
          out.push(o);
        }
      }
      return out;
    },
    enabled: connected,
    refetchInterval: 60_000,
  });
}

export { useQueryClient };
