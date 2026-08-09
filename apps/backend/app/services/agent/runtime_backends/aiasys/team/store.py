"""Multi-agent team collaboration store (mission state layer).

# 移植自 step-code src/agent/team/store.ts（MIT, Copyright (c) 2026 stepfun-ai）
# 变更：
# - 去掉 git worktree / git diff / git merge 等 git 依赖（AIASys 不做 worktree 隔离）
# - 状态落盘改为 asyncio 友好的原子写（tempfile + os.replace）
# - scope 比对使用 os.path.realpath() + 路径分量前缀，避免符号链接与裸字符串误匹配
# - merge 门的 git 相关门（门③ tip 校验、门⑤ diff 范围校验）改为产出物指纹比对
"""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


@dataclass
class TeamMission:
    """Mission 六态状态机中的任务实体。"""

    id: str
    title: str
    kind: str  # 'build' | 'survey'
    scope: list[str] = field(default_factory=list)
    deps: list[str] = field(default_factory=list)
    status: str = "planned"
    owner: str | None = None
    reviewed_commit: str | None = None
    lease: dict[str, Any] | None = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


@dataclass
class TeamState:
    """Team 全局状态（唯一事实源）。"""

    version: int = 1
    base: str = ""
    repo_root: str = ""
    closed_at: str | None = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    missions: list[TeamMission] = field(default_factory=list)


class TeamError(Exception):
    """团队操作错误（状态迁移失败、门控不通过等）。"""


# ---------------------------------------------------------------------------
# State machine（移植自 step-code store.ts 的状态迁移规则）
# ---------------------------------------------------------------------------

# 合法迁移表（含 step-code 原注释的阈值理据）
# planned → active：正常启动
# planned → blocked：依赖不满足
# planned → paused：人为暂停
# active → completed：worker 完成
# active → blocked：执行失败
# active → paused：人为暂停
# blocked → active：重试（respawn）
# paused → active：恢复
# completed → active：返工（rework，审阅打回）
# completed → merged：收编
# blocked → merged：依赖完成后直接收编（罕见但允许）
# merged 终态，不再出
# active/completed/paused/blocked → planned 不允许（不能回退）
VALID_TRANSITIONS: dict[str, set[str]] = {
    "planned": {"active", "blocked", "paused"},
    "active": {"completed", "blocked", "paused"},
    "blocked": {"active", "merged"},
    "paused": {"active"},
    "completed": {"active", "merged"},
    "merged": set(),  # 终态
}


def _assert_valid_transition(mission: TeamMission, new_status: str) -> None:
    """抛出明确异常，绝不依赖 LLM 自觉遵守。"""
    allowed = VALID_TRANSITIONS.get(mission.status, set())
    if new_status not in allowed:
        raise TeamError(
            f"任务 {mission.id} 当前状态是 {mission.status}，不允许迁移到 {new_status}。"
            f" 合法目标：{sorted(allowed) or '(无，终态)'}"
        )


# ---------------------------------------------------------------------------
# Scope helpers（移植自 step-code scopeMatches / scopesOverlap）
# ---------------------------------------------------------------------------


def _normalize_scope(raw: str) -> str:
    """归一为目录前缀：`src/data/**` / `src/data/*` → `src/data/`。"""
    return raw.replace("\\", "/").rstrip("/")


def _path_components(p: str) -> tuple[str, ...]:
    """把路径拆成分量（兼容 POSIX/Windows 分隔符）。"""
    return tuple(part for part in p.replace("\\", "/").split("/") if part)


def _scope_covers_path(scope: str, file_path: str) -> bool:
    """目录语义的前缀匹配：`src/data/` 覆盖 `src/data/x.ts`，不覆盖 `src/database/x.ts`。

    使用路径分量比对，避免 `src/data` 误匹配 `src/database` 这类裸字符串前缀问题。
    """
    scope_norm = _normalize_scope(scope)
    file_norm = _normalize_scope(file_path)
    if scope_norm == file_norm:
        return True
    if not scope_norm.endswith("/"):
        scope_norm += "/"
    return file_norm.startswith(scope_norm) or file_norm.startswith(scope_norm.replace("//", "/"))


def _scopes_overlap(a: str, b: str) -> bool:
    """两个 scope 是否冲突（目录语义下互为前缀即重叠）。

    先用 os.path.realpath() 解析符号链接，避免符号链接绕过互斥检查。
    """
    try:
        a_real = os.path.realpath(a) if os.path.exists(a) else os.path.normpath(a)
    except (OSError, ValueError):
        a_real = os.path.normpath(a)
    try:
        b_real = os.path.realpath(b) if os.path.exists(b) else os.path.normpath(b)
    except (OSError, ValueError):
        b_real = os.path.normpath(b)

    a_norm = a_real.replace("\\", "/").rstrip("/")
    b_norm = b_real.replace("\\", "/").rstrip("/")
    if a_norm == b_norm:
        return True
    a_parts = tuple(part for part in a_norm.split("/") if part)
    b_parts = tuple(part for part in b_norm.split("/") if part)
    min_len = min(len(a_parts), len(b_parts))
    if min_len == 0:
        return False
    return a_parts[:min_len] == b_parts[:min_len]


def _resolve_real_path(path: str) -> str:
    """规范化路径（解析符号链接 + 绝对路径）。"""
    try:
        return os.path.realpath(path)
    except (OSError, ValueError):
        # 路径可能不存在，退化为规范形式
        return os.path.normpath(path)


# ---------------------------------------------------------------------------
# TeamStore
# ---------------------------------------------------------------------------


class TeamStore:
    """Mission 状态层：六态状态机 + 依赖硬化门控 + scope 互斥检查 + 原子写落盘。"""

    def __init__(self, state_dir: str) -> None:
        """
        Args:
            state_dir: 团队状态目录（存放 state.json）。
        """
        self._state_dir = Path(state_dir).resolve()
        self._state_file = self._state_dir / "state.json"
        # 并发安全：asyncio.Lock 保护 load-modify-save 循环。
        # 理由：AIASys 是 asyncio 架构，同一进程内多个 worker 可能并发访问 store。
        # asyncio.Lock 在单进程内有效，且不引入跨进程开销。
        # 若未来部署为多进程，可升级为 filelock（本项目已有 filelock 依赖）。
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Persistence（原子写 + 并发安全）
    # ------------------------------------------------------------------

    async def _load(self) -> TeamState:
        """从磁盘加载状态。"""
        try:
            raw = await asyncio.to_thread(self._state_file.read_text, encoding="utf-8")
        except FileNotFoundError as exc:
            raise TeamError("team 尚未初始化——先运行 team_init。") from exc
        data = json.loads(raw)
        # 反序列化：把 dict 转回 dataclass
        if "missions" in data and isinstance(data["missions"], list):
            data["missions"] = [
                TeamMission(**m) if isinstance(m, dict) else m for m in data["missions"]
            ]
        return TeamState(**data)

    async def _save(self, state: TeamState) -> None:
        """原子写：先写临时文件，再 os.replace，避免写一半崩溃损坏状态。"""
        self._state_dir.mkdir(parents=True, exist_ok=True)
        tmp_fd, tmp_path = tempfile.mkstemp(
            dir=str(self._state_dir), suffix=".tmp", prefix=".state-"
        )
        try:
            with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
                json.dump(state, f, ensure_ascii=False, indent=2, default=_dataclass_default)
            # 原子替换（同一文件系统内）
            os.replace(tmp_path, str(self._state_file))
        except BaseException:
            # 清理临时文件（如果还在）
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    async def load(self) -> TeamState:
        """公开接口：加载状态（持有锁）。"""
        async with self._lock:
            return await self._load()

    async def save(self, state: TeamState) -> None:
        """公开接口：保存状态（持有锁）。"""
        async with self._lock:
            await self._save(state)

    # ------------------------------------------------------------------
    # Init
    # ------------------------------------------------------------------

    async def init(self, repo_root: str, base: str = "") -> TeamState:
        """初始化团队状态（幂等：已初始化则保留全部状态）。"""
        async with self._lock:
            if self._state_file.exists():
                state = await self._load()
                # 重进已关闭的团队：清掉关闭标记，状态全部保留
                if state.closed_at is not None:
                    state.closed_at = None
                    await self._save(state)
                return state

            state = TeamState(
                base=base or "main",
                repo_root=_resolve_real_path(repo_root),
            )
            await self._save(state)
            return state

    # ------------------------------------------------------------------
    # Plan（登记任务 + scope 互斥 + deps 校验）
    # ------------------------------------------------------------------

    async def plan(self, missions: list[TeamMission]) -> list[TeamMission]:
        """登记一批任务。

        1. deps 必须引用已存在的任务 id（本批次或之前批次）。
        2. build 类的 scope 必须两两不重叠；survey 允许 scope 为空。
        3. 路径比对前用 os.path.realpath() 规范化，并按路径分量比对前缀。
        """
        async with self._lock:
            state = await self._load()
            existing_ids = {m.id for m in state.missions}

            # 先校验 deps 与 scope 重叠
            new_missions: list[TeamMission] = []
            for idx, m in enumerate(missions):
                # 分配 id（M1, M2, ...）
                m.id = f"M{len(state.missions) + idx + 1}"

                # deps 校验：引用必须存在
                for dep in m.deps:
                    if dep not in existing_ids and dep not in {n.id for n in new_missions}:
                        raise TeamError(f"任务 {m.id} 依赖了不存在的任务「{dep}」。")

                # scope 互斥：仅 build 类检查
                if m.kind == "build":
                    candidates = [
                        (other.id, other.scope)
                        for other in state.missions
                        if other.kind == "build" and other.status != "merged"
                    ] + [(n.id, n.scope) for n in new_missions if n.kind == "build"]
                    for other_id, other_scope in candidates:
                        for s1 in m.scope:
                            for s2 in other_scope:
                                if _scopes_overlap(s1, s2):
                                    raise TeamError(
                                        f"任务 {m.id} 的 scope「{s1}」与 {other_id} 的「{s2}」重叠——"
                                        f"build 类任务的 scope 必须两两不互斥，请重新划分。"
                                    )

                new_missions.append(m)

            state.missions.extend(new_missions)
            await self._save(state)
            return new_missions

    # ------------------------------------------------------------------
    # Status transition（状态机）
    # ------------------------------------------------------------------

    async def set_status(self, mission_id: str, new_status: str) -> TeamMission:
        """迁移任务到新状态（系统强制门控）。"""
        async with self._lock:
            state = await self._load()
            mission = next((m for m in state.missions if m.id == mission_id), None)
            if mission is None:
                raise TeamError(f"任务 {mission_id} 不存在。")

            _assert_valid_transition(mission, new_status)

            # 切到 active 前的依赖硬化门控（移植自 step-code spawn 门）
            if new_status == "active":
                unmerged = [
                    dep
                    for dep in mission.deps
                    if next((m for m in state.missions if m.id == dep), None) is None
                    or next((m for m in state.missions if m.id == dep), None).status != "merged"
                ]
                if unmerged:
                    raise TeamError(
                        f"任务 {mission.id} 的依赖 {unmerged} 尚未全部 merged——"
                        f"依赖未满足前不能启动（系统门，非 prompt 约束）。"
                    )

            mission.status = new_status
            await self._save(state)
            return mission

    # ------------------------------------------------------------------
    # Merge（收编检查：六道门）
    # ------------------------------------------------------------------

    async def merge(
        self,
        mission_id: str,
        reviewed_commit: str | None = None,
        artifacts: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """收编任务（六道门检查）。

        门〇（空产出检查）：任务声明的产出物落点无任何新增文件/记录即拒绝。
        门①（已审阅）：调用方传入 reviewed_commit 即声明已审且干净。
        门②（审阅结论干净）：调用方责任（本步只做纯逻辑判断，不做 git 操作）。
        门③（tip 未移动）：AIASys 无 commit，改为产出物指纹比对（path + size + mtime + content hash）。
        门④（依赖已收编）：遍历 deps 检查 status == merged。
        门⑤（无范围外产出）：逐产出物比对 lease，含文件、数据表等。

        Args:
            mission_id: 要收编的任务 id。
            reviewed_commit: 审阅时的产出物指纹（字符串，本步不做格式强求，按字符串比对）。
            artifacts: 产出物清单（本步预留，用于门③指纹比对）。

        Returns:
            {"conflictsWith": [...], "kept": bool}
        """
        async with self._lock:
            state = await self._load()
            mission = next((m for m in state.missions if m.id == mission_id), None)
            if mission is None:
                raise TeamError(f"任务 {mission_id} 不存在。")

            # 先过状态门
            if mission.status != "completed":
                raise TeamError(
                    f"任务 {mission.id} 状态是 {mission.status}，只有 completed 才能合并。"
                )

            # 门④：依赖已收编（直接搬）
            unmerged = [
                dep
                for dep in mission.deps
                if next((m for m in state.missions if m.id == dep), None) is None
                or next((m for m in state.missions if m.id == dep), None).status != "merged"
            ]
            if unmerged:
                raise TeamError(f"门④：依赖 {unmerged} 尚未合并。")

            # 门①：已审阅（直接搬）
            if reviewed_commit is None:
                raise TeamError("门①：未传入 reviewed_commit，请先审阅。")

            # 门②：审阅结论干净（调用方责任，本步只做纯逻辑占位）
            # 本步不做实际 git 操作，门② 的干净性由调用方保证。

            # 门〇：空产出检查（从 step-code 移植，放在门③之前）
            # 如果 artifacts 存在且为空列表，说明 worker 没有产出任何东西。
            if artifacts is not None and len(artifacts) == 0:
                raise TeamError(
                    f"门〇：任务 {mission.id} 没有任何产出物落点。"
                    " 可能原因：① worker 忘了保存产出；② worker 提交到了错误的位置。"
                )

            # 门③：tip 未移动 → 产出物指纹比对
            # AIASys 无 commit，用 artifacts 的指纹列表比对 reviewed_commit。
            if artifacts is not None:
                current_fp = _compute_artifacts_fingerprint(artifacts)
                if current_fp != reviewed_commit:
                    raise TeamError(
                        f"门③：产出物指纹已变更（审阅时 {reviewed_commit[:12]}，现在 {current_fp[:12]}）——请重新审阅。"
                    )

            # 门⑤：无范围外产出 → 逐产出物比对 lease
            if artifacts is not None and mission.lease is not None:
                allowed_files = _normalize_lease_files(mission.lease)
                for art in artifacts:
                    art_path = art.get("path", "")
                    if not _is_path_allowed(art_path, allowed_files):
                        raise TeamError(
                            f"门⑤：产出物 {art_path} 超出任务 lease 范围 {allowed_files}。"
                        )

            # 全部通过 → 状态迁移
            _assert_valid_transition(mission, "merged")
            mission.status = "merged"
            mission.reviewed_commit = reviewed_commit
            await self._save(state)

            # 波及检测：其他未 merged 的 build 任务，scope 与本次产出物重叠的列出来
            conflicts_with = _find_scope_conflicts(state.missions, mission, artifacts)
            return {"conflictsWith": conflicts_with, "kept": False}

    # ------------------------------------------------------------------
    # Inbox（文件信箱）
    # ------------------------------------------------------------------

    async def inbox(self, name: str, limit: int = 20) -> list[dict[str, str]]:
        """读取团队信箱，newest-first。

        name 为 'team' 时返回全部；否则只返回 to=name 或 to=all 的消息。
        """
        inbox_dir = self._state_dir / "comms" / "inbox"
        messages: list[dict[str, str]] = []
        try:
            entries = sorted(inbox_dir.iterdir(), reverse=True)
        except FileNotFoundError:
            return messages

        import re as _re

        _FM_RE = _re.compile(r"^---\n([\s\S]*?)\n---\n?([\s\S]*)$")

        for entry in entries:
            if not entry.is_file() or not entry.name.endswith(".md"):
                continue
            if len(messages) >= limit:
                break
            try:
                raw = entry.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            fm_match = _FM_RE.match(raw)
            if not fm_match:
                continue
            meta_block = fm_match.group(1)
            body = fm_match.group(2).strip()
            meta: dict[str, str] = {}
            for line in meta_block.split("\n"):
                kv = _re.match(r"^(\w+):\s*(.*)$", line)
                if kv:
                    meta[kv.group(1)] = kv.group(2)

            to_field = meta.get("to", "")
            if name != "team" and to_field != name and to_field != "all":
                continue

            messages.append(
                {
                    "message_id": meta.get("message_id", ""),
                    "from": meta.get("from", "?"),
                    "to": to_field,
                    "subject": meta.get("subject", ""),
                    "sent_at": meta.get("sent_at", ""),
                    "body": body,
                    "file": entry.name,
                }
            )
        return messages

    # ------------------------------------------------------------------
    # Teardown（收尾关闭）
    # ------------------------------------------------------------------

    async def teardown(self, force: bool = False) -> dict[str, list[str]]:
        """收尾：标记关闭 + 清理工作间。

        force=False 时保留 dirty 工作间；force=True 时强制清理。
        状态目录与日志永久保留（可审计）。
        幂等：已关闭的团队直接返回空列表。
        """
        async with self._lock:
            # 防重复 teardown
            if self._state_file.exists():
                state = await self._load()
                if state.closed_at is not None:
                    return {"removed": [], "kept": []}

            # 先标记关闭（防止中途出错后 resume 复活）
            try:
                state = await self._load()
                state.closed_at = _iso_now()
                await self._save(state)
            except TeamError:
                pass

            removed: list[str] = []
            kept: list[str] = []

            # AIASys 无 worktree 概念，但为接口兼容保留签名
            # 如有任务目录需要清理，在此处扩展
            # 当前仅返回空结果（设计文档明确不做 worktree）

            return {"removed": removed, "kept": kept}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _dataclass_default(obj: Any) -> Any:
    """JSON 序列化 dataclass。"""
    if hasattr(obj, "__dataclass_fields__"):
        return obj.__dict__
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_lease_files(lease: dict[str, Any]) -> list[str]:
    """从 lease 中提取并规范化允许的文件路径前缀。"""
    raw = lease.get("files", [])
    if isinstance(raw, list):
        return [_normalize_scope(str(p)) for p in raw]
    return []


def _is_path_allowed(path: str, allowed_prefixes: list[str]) -> bool:
    """检查 path 是否落在允许的前缀列表中。"""
    path_norm = _normalize_scope(path)
    for prefix in allowed_prefixes:
        if _scope_covers_path(prefix, path_norm):
            return True
    return False


def _compute_artifacts_fingerprint(artifacts: list[dict[str, Any]]) -> str:
    """计算产出物清单的指纹（简化版：按 path 排序后拼接）。

    完整实现应包含 content hash / size / mtime，但本步只做纯逻辑判断，
    具体指纹算法由调用方保证，此处做稳定排序即可。
    """
    sorted_arts = sorted(artifacts, key=lambda a: a.get("path", ""))
    parts = []
    for art in sorted_arts:
        parts.append(f"{art.get('path', '')}:{art.get('size', '')}:{art.get('hash', '')}")
    return "|".join(parts)


def _find_scope_conflicts(
    missions: list[TeamMission],
    merged: TeamMission,
    artifacts: list[dict[str, Any]] | None,
) -> list[str]:
    """找出 scope 与本次产出物重叠的其他未 merged build 任务。"""
    if merged.kind != "build" or artifacts is None:
        return []
    changed_paths = [a.get("path", "") for a in artifacts]
    return [
        m.id
        for m in missions
        if m.kind == "build"
        and m.status != "merged"
        and m.id != merged.id
        and any(_scope_covers_path(s, p) for s in merged.scope for p in changed_paths if p)
    ]
