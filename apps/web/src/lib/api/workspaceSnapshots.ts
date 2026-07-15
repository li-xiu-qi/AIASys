import { API_ENDPOINTS } from "@/config/api";
import { apiRequest } from "@/lib/api/httpClient";

export type SnapshotSource = "manual" | "execution_batch" | "auto_switch_backup";
export type SnapshotSwitchMode = "soft" | "hard";

export interface WorkspaceSnapshot {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  created_at: string;
  created_by: string;
  source: SnapshotSource;
  source_detail: string | null;
  file_count: number;
}

export interface WorkspaceSnapshotDetail extends WorkspaceSnapshot {
  files: Record<string, string | null>;
}

export interface WorkspaceSnapshotListResponse {
  workspace_id: string;
  snapshots: WorkspaceSnapshot[];
  total: number;
}

export interface CreateSnapshotPayload {
  title: string;
  description?: string | null;
}

export interface ApplySnapshotPayload {
  mode?: SnapshotSwitchMode;
}

export interface ApplySnapshotResponse {
  success: boolean;
  snapshot_id: string;
  backup_snapshot_id: string;
  restored_files: string[];
  deleted_files: string[];
  unchanged_files: string[];
  skipped_files: string[];
}

export interface DiffSnapshotItem {
  file_path: string;
  snapshot_entry_id: string | null;
  current_entry_id: string | null;
}

export interface DiffSnapshotResponse {
  snapshot_id: string;
  workspace_id: string;
  changes: DiffSnapshotItem[];
}

export function listWorkspaceSnapshots(
  workspaceId: string,
  options: { limit?: number; offset?: number; source?: SnapshotSource | null } = {},
) {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined) params.set("offset", String(options.offset));
  if (options.source) params.set("source", options.source);
  const query = params.toString();
  return apiRequest<WorkspaceSnapshotListResponse>(
    `${API_ENDPOINTS.WORKSPACE_SNAPSHOTS(workspaceId)}${query ? `?${query}` : ""}`,
    { method: "GET" },
  );
}

export function getWorkspaceSnapshot(workspaceId: string, snapshotId: string) {
  return apiRequest<WorkspaceSnapshotDetail>(
    API_ENDPOINTS.WORKSPACE_SNAPSHOT(workspaceId, snapshotId),
    { method: "GET" },
  );
}

export function createWorkspaceSnapshot(
  workspaceId: string,
  payload: CreateSnapshotPayload,
) {
  return apiRequest<WorkspaceSnapshot>(
    API_ENDPOINTS.WORKSPACE_SNAPSHOTS(workspaceId),
    {
      method: "POST",
      body: payload,
    },
  );
}

export function applyWorkspaceSnapshot(
  workspaceId: string,
  snapshotId: string,
  payload: ApplySnapshotPayload = {},
) {
  return apiRequest<ApplySnapshotResponse>(
    API_ENDPOINTS.WORKSPACE_SNAPSHOT_APPLY(workspaceId, snapshotId),
    {
      method: "POST",
      body: payload,
    },
  );
}

export function diffWorkspaceSnapshot(workspaceId: string, snapshotId: string) {
  return apiRequest<DiffSnapshotResponse>(
    API_ENDPOINTS.WORKSPACE_SNAPSHOT_DIFF(workspaceId, snapshotId),
    { method: "GET" },
  );
}

export function deleteWorkspaceSnapshot(workspaceId: string, snapshotId: string) {
  return apiRequest<{ success: boolean; snapshot_id: string }>(
    API_ENDPOINTS.WORKSPACE_SNAPSHOT(workspaceId, snapshotId),
    { method: "DELETE" },
  );
}
