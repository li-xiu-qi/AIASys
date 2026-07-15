"""工作区快照服务。

在文件历史之上提供轻量"版本"能力：
- 手动保存当前工作区状态为一个快照；
- 每次 Agent 执行批次结束时自动生成快照；
- 支持软切换（只恢复快照中存在的文件）和硬重置（完全对齐快照）。

快照本身只记录"路径 -> file_history_entry_id"的引用集合，不复制文件内容。
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import shutil
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

import filelock

from app.services.file_history import (
    EXCLUDED_TOP_LEVEL_NAMES,
    FileHistoryEntry,
    file_history_service,
)
from app.utils.path_utils import as_system_path

logger = logging.getLogger(__name__)

SnapshotSource = Literal["manual", "execution_batch", "auto_switch_backup"]
SwitchMode = Literal["soft", "hard"]

SNAPSHOTS_DIR = Path(".aiasys/snapshots")
SNAPSHOTS_INDEX = "index.json"


@dataclass(slots=True)
class WorkspaceSnapshot:
    """工作区快照。"""

    id: str
    workspace_id: str
    title: str
    description: str | None
    created_at: str
    created_by: str
    source: SnapshotSource
    source_detail: str | None
    files: dict[str, str | None]


@dataclass(slots=True)
class SwitchResult:
    """切换快照结果。"""

    restored_files: list[str]
    deleted_files: list[str]
    unchanged_files: list[str]
    skipped_files: list[str]
    backup_snapshot_id: str | None


class WorkspaceSnapshotService:
    """工作区快照服务。"""

    def __init__(self) -> None:
        self._lock_cache: dict[str, filelock.FileLock] = {}

    def _snapshots_root(self, workspace_root: Path) -> Path:
        return workspace_root / SNAPSHOTS_DIR

    def _index_path(self, workspace_root: Path) -> Path:
        return self._snapshots_root(workspace_root) / SNAPSHOTS_INDEX

    def _get_index_lock(self, workspace_root: Path) -> filelock.FileLock:
        lock_path = self._snapshots_root(workspace_root) / "index.lock"
        key = str(lock_path)
        lock = self._lock_cache.get(key)
        if lock is None:
            lock = filelock.FileLock(as_system_path(lock_path))
            self._lock_cache[key] = lock
        return lock

    def _new_snapshot_id(self) -> str:
        timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
        return f"wsnap_{timestamp}_{secrets.token_hex(6)}"

    def _normalize_relative_path(self, relative_path: str | Path) -> str:
        normalized = Path(str(relative_path).replace("\\", "/"))
        if (
            not str(relative_path).strip()
            or normalized.is_absolute()
            or any(part == ".." for part in normalized.parts)
        ):
            raise ValueError("无效的文件路径")
        return normalized.as_posix()

    def _should_skip_path(self, relative_path: str) -> bool:
        parts = Path(relative_path).parts
        if not parts:
            return True
        return any(part in EXCLUDED_TOP_LEVEL_NAMES for part in parts)

    def _iter_visible_files(
        self,
        workspace_root: Path,
    ) -> list[tuple[str, Path]]:
        """遍历工作区内应纳入快照的可见文件。"""
        results: list[tuple[str, Path]] = []
        workspace_sys_root = as_system_path(workspace_root)
        if not os.path.isdir(workspace_sys_root):
            return results

        for current_dir, dir_names, file_names in os.walk(workspace_sys_root, topdown=True):
            current_path = Path(current_dir)
            rel_parts = current_path.relative_to(workspace_sys_root).parts
            if any(part in EXCLUDED_TOP_LEVEL_NAMES for part in rel_parts):
                dir_names[:] = []
                continue
            dir_names[:] = sorted(
                d
                for d in dir_names
                if d not in EXCLUDED_TOP_LEVEL_NAMES
                and not os.path.islink(as_system_path(current_path / d))
            )
            for file_name in sorted(file_names):
                file_path = current_path / file_name
                file_sys_path = as_system_path(file_path)
                if os.path.islink(file_sys_path) or not os.path.isfile(file_sys_path):
                    continue
                relative = file_path.relative_to(workspace_sys_root).as_posix()
                if self._should_skip_path(relative):
                    continue
                results.append((relative, file_path))
        return results

    def _ensure_history_entry_for_file(
        self,
        workspace_root: Path,
        relative_path: str,
        source: SnapshotSource,
        source_detail: str | None,
    ) -> FileHistoryEntry | None:
        """确保文件当前内容在历史索引中有一条可引用的 entry。

        如果最新 entry 的 sha256 与当前文件一致则复用，否则新建一条
        operation="before_snapshot" 的历史记录。
        """
        absolute_path = workspace_root / relative_path
        absolute_sys_path = as_system_path(absolute_path)
        if not os.path.isfile(absolute_sys_path) or os.path.islink(absolute_sys_path):
            return None

        with open(absolute_sys_path, "rb") as f:
            content = f.read()
        current_digest = hashlib.sha256(content).hexdigest()

        entries = file_history_service.list_entries(workspace_root, relative_path)
        if entries:
            latest = entries[0]
            if latest.sha256 == current_digest:
                return latest

        entry = file_history_service.record_file_before_change(
            workspace_root,
            relative_path,
            operation="before_snapshot",
            source="snapshot_service",
            source_detail=source_detail,
        )
        return entry

    def create_snapshot(
        self,
        workspace_root: Path,
        workspace_id: str,
        *,
        title: str,
        created_by: str,
        source: SnapshotSource = "manual",
        source_detail: str | None = None,
        description: str | None = None,
    ) -> WorkspaceSnapshot:
        """创建一个新快照。"""
        snapshot_id = self._new_snapshot_id()
        files: dict[str, str | None] = {}

        for relative_path, _ in self._iter_visible_files(workspace_root):
            entry = self._ensure_history_entry_for_file(
                workspace_root,
                relative_path,
                source,
                source_detail,
            )
            files[relative_path] = entry.id if entry is not None else None

        snapshot = WorkspaceSnapshot(
            id=snapshot_id,
            workspace_id=workspace_id,
            title=title,
            description=description,
            created_at=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            created_by=created_by,
            source=source,
            source_detail=source_detail,
            files=files,
        )

        with self._get_index_lock(workspace_root):
            index = self._read_index(workspace_root)
            index["snapshots"].insert(0, snapshot.id)
            self._write_snapshot_file(workspace_root, snapshot)
            self._write_index(workspace_root, index)

        return snapshot

    def get_snapshot(self, workspace_root: Path, snapshot_id: str) -> WorkspaceSnapshot:
        snapshot = self._read_snapshot_file(workspace_root, snapshot_id)
        if snapshot is None:
            raise FileNotFoundError("快照不存在")
        return snapshot

    def list_snapshots(
        self,
        workspace_root: Path,
        *,
        limit: int = 50,
        offset: int = 0,
        source: SnapshotSource | None = None,
    ) -> list[WorkspaceSnapshot]:
        """按创建时间倒序列出快照。"""
        with self._get_index_lock(workspace_root):
            index = self._read_index(workspace_root)
        snapshot_ids = index.get("snapshots", [])
        if source is not None:
            snapshot_ids = [
                sid
                for sid in snapshot_ids
                if self._read_snapshot_file(workspace_root, sid, fast=True).source == source
            ]
        result: list[WorkspaceSnapshot] = []
        for sid in snapshot_ids[offset : offset + limit]:
            snapshot = self._read_snapshot_file(workspace_root, sid)
            if snapshot is not None:
                result.append(snapshot)
        return result

    def delete_snapshot(self, workspace_root: Path, snapshot_id: str) -> None:
        """删除快照。只删除 manifest，不删除底层 file_history。"""
        with self._get_index_lock(workspace_root):
            index = self._read_index(workspace_root)
            if snapshot_id not in index.get("snapshots", []):
                raise FileNotFoundError("快照不存在")
            index["snapshots"] = [sid for sid in index["snapshots"] if sid != snapshot_id]
            self._write_index(workspace_root, index)
            snapshot_path = self._snapshot_file_path(workspace_root, snapshot_id)
            try:
                os.unlink(as_system_path(snapshot_path))
            except OSError:
                logger.warning("删除快照文件失败: %s", snapshot_path)

    def apply_snapshot(
        self,
        workspace_root: Path,
        workspace_id: str,
        snapshot_id: str,
        *,
        mode: SwitchMode = "soft",
        actor: str,
    ) -> SwitchResult:
        """切换/重置到指定快照。"""
        snapshot = self.get_snapshot(workspace_root, snapshot_id)

        # 先自动备份当前状态
        backup_title = f"切换前备份：{snapshot.title or snapshot_id}"
        backup = self.create_snapshot(
            workspace_root,
            workspace_id,
            title=backup_title,
            created_by=actor,
            source="auto_switch_backup",
            source_detail=snapshot.id,
        )

        current_files = {relative for relative, _ in self._iter_visible_files(workspace_root)}
        snapshot_files = set(snapshot.files.keys())

        restored_files: list[str] = []
        deleted_files: list[str] = []
        unchanged_files: list[str] = []
        skipped_files: list[str] = []

        def _delete_with_history(relative_path: str) -> None:
            target_path = workspace_root / relative_path
            target_sys_path = as_system_path(target_path)
            if os.path.isdir(target_sys_path) and not os.path.islink(target_sys_path):
                file_history_service.record_tree_before_change(
                    workspace_root,
                    relative_path,
                    operation="before_delete",
                    source="snapshot_service",
                    source_detail=f"hard_reset_to:{snapshot.id}",
                )
                shutil.rmtree(target_sys_path)
            else:
                file_history_service.record_file_before_change(
                    workspace_root,
                    relative_path,
                    operation="before_delete",
                    source="snapshot_service",
                    source_detail=f"hard_reset_to:{snapshot.id}",
                )
                os.unlink(target_sys_path)

        # 恢复快照中存在的文件
        for relative_path, entry_id in snapshot.files.items():
            if entry_id is None:
                if mode == "hard" and relative_path in current_files:
                    _delete_with_history(relative_path)
                    deleted_files.append(relative_path)
                else:
                    unchanged_files.append(relative_path)
                continue

            try:
                file_history_service.restore_entry(
                    workspace_root,
                    entry_id,
                    source="snapshot_service",
                    source_detail=f"apply:{snapshot.id}",
                )
                restored_files.append(relative_path)
            except FileNotFoundError:
                skipped_files.append(relative_path)

        # hard 模式下删除快照中没有的文件
        if mode == "hard":
            for relative_path in current_files - snapshot_files:
                _delete_with_history(relative_path)
                deleted_files.append(relative_path)
            self._cleanup_empty_directories(workspace_root)

        return SwitchResult(
            restored_files=restored_files,
            deleted_files=deleted_files,
            unchanged_files=unchanged_files,
            skipped_files=skipped_files,
            backup_snapshot_id=backup.id,
        )

    def diff_snapshot(
        self,
        workspace_root: Path,
        snapshot_id: str,
    ) -> list[tuple[str, str | None, str | None]]:
        """返回快照与当前工作区的路径级差异。

        返回 (relative_path, snapshot_entry_id, current_entry_id) 列表。
        snapshot_entry_id 为 None 表示快照中该路径不存在；
        current_entry_id 为 None 表示当前工作区中该路径不存在。
        """
        snapshot = self.get_snapshot(workspace_root, snapshot_id)
        current_map: dict[str, str | None] = {}
        for relative_path, _ in self._iter_visible_files(workspace_root):
            entry = self._ensure_history_entry_for_file(
                workspace_root,
                relative_path,
                source="manual",
                source_detail="diff_snapshot",
            )
            current_map[relative_path] = entry.id if entry is not None else None

        all_paths = sorted(set(snapshot.files.keys()) | set(current_map.keys()))
        result: list[tuple[str, str | None, str | None]] = []
        for path in all_paths:
            snapshot_entry = snapshot.files.get(path)
            current_entry = current_map.get(path)
            if snapshot_entry != current_entry:
                result.append((path, snapshot_entry, current_entry))
        return result

    def _cleanup_empty_directories(self, workspace_root: Path) -> None:
        """删除工作区下空的可见目录（只清理叶子，不删被排除的目录）。"""
        workspace_sys_root = as_system_path(workspace_root)
        if not os.path.isdir(workspace_sys_root):
            return
        for current_dir, dir_names, file_names in os.walk(workspace_sys_root, topdown=False):
            current_path = Path(current_dir)
            rel_parts = current_path.relative_to(workspace_sys_root).parts
            if any(part in EXCLUDED_TOP_LEVEL_NAMES for part in rel_parts):
                continue
            if current_path == workspace_root:
                continue
            if not dir_names and not file_names:
                try:
                    os.rmdir(as_system_path(current_path))
                except OSError:
                    pass

    def _snapshot_file_path(self, workspace_root: Path, snapshot_id: str) -> Path:
        return self._snapshots_root(workspace_root) / f"{snapshot_id}.json"

    def _write_snapshot_file(
        self,
        workspace_root: Path,
        snapshot: WorkspaceSnapshot,
    ) -> None:
        path = self._snapshot_file_path(workspace_root, snapshot.id)
        os.makedirs(as_system_path(path.parent), exist_ok=True)
        payload = {
            "version": 1,
            "id": snapshot.id,
            "workspace_id": snapshot.workspace_id,
            "title": snapshot.title,
            "description": snapshot.description,
            "created_at": snapshot.created_at,
            "created_by": snapshot.created_by,
            "source": snapshot.source,
            "source_detail": snapshot.source_detail,
            "files": snapshot.files,
        }
        temp_path = path.with_suffix(".tmp")
        temp_sys_path = as_system_path(temp_path)
        try:
            with open(temp_sys_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            os.replace(temp_sys_path, as_system_path(path))
        except Exception:
            try:
                os.remove(temp_sys_path)
            except OSError:
                logger.warning("Failed to clean up temp file: %s", temp_sys_path)
            raise

    def _read_snapshot_file(
        self,
        workspace_root: Path,
        snapshot_id: str,
        *,
        fast: bool = False,
    ) -> WorkspaceSnapshot | None:
        path = self._snapshot_file_path(workspace_root, snapshot_id)
        sys_path = as_system_path(path)
        if not os.path.exists(sys_path):
            return None
        try:
            with open(sys_path, encoding="utf-8") as f:
                payload = json.load(f)
        except (json.JSONDecodeError, OSError):
            logger.warning("快照文件无法读取: %s", path)
            return None

        if fast:
            # 只解析元信息，不解析大 files 字典
            return WorkspaceSnapshot(
                id=payload.get("id", snapshot_id),
                workspace_id=payload.get("workspace_id", ""),
                title=payload.get("title", ""),
                description=payload.get("description"),
                created_at=payload.get("created_at", ""),
                created_by=payload.get("created_by", ""),
                source=payload.get("source", "manual"),
                source_detail=payload.get("source_detail"),
                files={},
            )

        files = payload.get("files")
        if not isinstance(files, dict):
            files = {}
        return WorkspaceSnapshot(
            id=payload.get("id", snapshot_id),
            workspace_id=payload.get("workspace_id", ""),
            title=payload.get("title", ""),
            description=payload.get("description"),
            created_at=payload.get("created_at", ""),
            created_by=payload.get("created_by", ""),
            source=payload.get("source", "manual"),
            source_detail=payload.get("source_detail"),
            files={k: v for k, v in files.items()},
        )

    def _read_index(self, workspace_root: Path) -> dict:
        path = self._index_path(workspace_root)
        sys_path = as_system_path(path)
        if not os.path.exists(sys_path):
            return {"version": 1, "snapshots": []}
        try:
            with open(sys_path, encoding="utf-8") as f:
                payload = json.load(f)
        except (json.JSONDecodeError, OSError):
            logger.warning("快照索引无法读取，按空索引处理: %s", path)
            return {"version": 1, "snapshots": []}
        if not isinstance(payload, dict):
            return {"version": 1, "snapshots": []}
        snapshots = payload.get("snapshots", [])
        if not isinstance(snapshots, list):
            snapshots = []
        return {"version": payload.get("version", 1), "snapshots": snapshots}

    def _write_index(self, workspace_root: Path, index: dict) -> None:
        path = self._index_path(workspace_root)
        os.makedirs(as_system_path(path.parent), exist_ok=True)
        temp_path = path.with_suffix(".tmp")
        temp_sys_path = as_system_path(temp_path)
        try:
            with open(temp_sys_path, "w", encoding="utf-8") as f:
                json.dump(index, f, ensure_ascii=False, indent=2)
            os.replace(temp_sys_path, as_system_path(path))
        except Exception:
            try:
                os.remove(temp_sys_path)
            except OSError:
                logger.warning("Failed to clean up temp file: %s", temp_sys_path)
            raise


workspace_snapshot_service = WorkspaceSnapshotService()
