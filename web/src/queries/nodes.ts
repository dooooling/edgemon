import { useQuery } from '@tanstack/react-query';
import {
  fetchPublicNodes,
  fetchNodeHistory,
  fetchAdminNodes,
  fetchPublicConfig,
  checkAdminSession,
} from '../api/client';

export function usePublicNodesQuery() {
  return useQuery({
    queryKey: ['public-nodes'],
    queryFn: fetchPublicNodes,
    staleTime: 10000,
  });
}

export function usePublicConfigQuery() {
  return useQuery({
    queryKey: ['public-config'],
    queryFn: fetchPublicConfig,
    staleTime: 60000,
  });
}

export function useNodeHistoryQuery(nodeId: string, range: string) {
  return useQuery({
    queryKey: ['node-history', nodeId, range],
    queryFn: () => fetchNodeHistory(nodeId, range),
    staleTime: 30000,
    enabled: !!nodeId,
  });
}

export function useAdminSessionQuery() {
  return useQuery({
    queryKey: ['admin-session'],
    queryFn: checkAdminSession,
    staleTime: 30000,
  });
}

export function useAdminNodesQuery(enabled: boolean) {
  return useQuery({
    queryKey: ['admin-nodes'],
    queryFn: fetchAdminNodes,
    enabled,
  });
}
