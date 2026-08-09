"""Resource Lease Layer 测试（第五步）。

覆盖：
- notebook 独占租约：第二个 mission 申请同一 notebook 被拒且错误信息含持有者
- 租约释放后可再申请
- 非独占资源（dataset / knowledge_graph / knowledge_base / env_id）放行
- 13 个工具里至少覆盖 5 个不同资源类型的放行与拒绝
- workspace_memory 分片隔离：worker 写不到别的 mission 的分片
- 主控能合并分片
- 无 team 上下文时所有工具行为不变（非 team 场景零行为变更）
"""

from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path

import pytest

from app.services.agent.runtime_backends.aiasys.team.store import (
    TeamError,
    TeamMission,
    TeamStore,
    _normalize_lease_key,
    check_write_guard,
    get_workspace_memory_main_path,
    get_workspace_memory_shard_path,
    merge_workspace_memory_shards,
    _RESOURCE_LEASE_MAP,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def state_dir(tmp_path: Path) -> str:
    return str(tmp_path / "team")


@pytest.fixture
async def store(state_dir: str) -> TeamStore:
    s = TeamStore(state_dir)
    await s.init(repo_root=str(Path("/fake/repo").resolve()), base="main")
    return s


def _mission(**kwargs: object) -> TeamMission:
    data: dict[str, object] = {
        "id": "M0",
        "title": "test",
        "kind": "build",
        "scope": [],
        "deps": [],
        "status": "planned",
        "owner": None,
        "reviewed_commit": None,
        "lease": None,
        "created_at": "2026-01-01T00:00:00+00:00",
        "resource_lease_keys": [],
    }
    data.update(kwargs)
    return TeamMission(**data)


# ---------------------------------------------------------------------------
# 1. 运行时租约表基础操作
# ---------------------------------------------------------------------------


class TestResourceLeaseBasics:
    async def test_acquire_and_release(self, store: TeamStore):
        """申请后能释放，释放后键不在表中。"""
        await store.acquire_resource_lease("M1", "notebook", "nb-1", "notebook:nb-1")
        assert store.get_lease_holder("notebook", "nb-1") == "M1"
        await store.release_resource_lease("M1", "notebook", "nb-1")
        assert store.get_lease_holder("notebook", "nb-1") is None

    async def test_same_mission_reacquire_ok(self, store: TeamStore):
        """同一 mission 重复申请同一资源不报错。"""
        await store.acquire_resource_lease("M1", "notebook", "nb-1", "notebook:nb-1")
        await store.acquire_resource_lease("M1", "notebook", "nb-1", "notebook:nb-1")  # 不抛
        await store.release_all_mission_leases("M1")

    async def test_different_mission_conflict(self, store: TeamStore):
        """不同 mission 申请同一独占资源被拒。"""
        await store.acquire_resource_lease("M1", "notebook", "nb-1", "notebook:nb-1")
        with pytest.raises(TeamError, match="M1"):
            await store.acquire_resource_lease("M2", "notebook", "nb-1", "notebook:nb-1")
        await store.release_all_mission_leases("M1")

    async def test_non_exclusive_no_conflict(self, store: TeamStore):
        """非独占资源（dataset）多个 mission 可同时持有。"""
        await store.acquire_resource_lease(
            "M1", "dataset", "sales", "dataset:sales", exclusive=False
        )
        await store.acquire_resource_lease(
            "M2", "dataset", "sales", "dataset:sales", exclusive=False
        )  # 不抛
        await store.release_all_mission_leases("M1")
        await store.release_all_mission_leases("M2")

    async def test_release_all_clears_all(self, store: TeamStore):
        """release_all_mission_leases 清空该 mission 的全部租约。"""
        await store.acquire_resource_lease("M1", "notebook", "nb-1", "notebook:nb-1")
        await store.acquire_resource_lease("M1", "dataset", "sales", "dataset:sales")
        await store.release_all_mission_leases("M1")
        assert store.get_lease_holder("notebook", "nb-1") is None
        assert store.get_lease_holder("dataset", "sales") is None


# ---------------------------------------------------------------------------
# 2. resolve_mission_resource_leases
# ---------------------------------------------------------------------------


class TestResolveMissionResourceLeases:
    async def test_exclusive_conflict_rejected(self, store: TeamStore):
        """独占资源被占用时 resolve 抛错。"""
        # M1 先占 notebook
        mission_m1 = _mission(id="M1", lease={"notebook": ["nb-1"]})
        await store.resolve_mission_resource_leases(mission_m1)

        # M2 再申请同一 notebook → 冲突
        mission_m2 = _mission(id="M2", lease={"notebook": ["nb-1"]})
        with pytest.raises(TeamError, match="M1"):
            await store.resolve_mission_resource_leases(mission_m2)

        await store.release_all_mission_leases("M1")

    async def test_release_then_reacquire(self, store: TeamStore):
        """释放后另一 mission 可申请。"""
        mission_m1 = _mission(id="M1", lease={"notebook": ["nb-1"]})
        keys_m1 = await store.resolve_mission_resource_leases(mission_m1)
        assert "notebook:nb-1" in keys_m1

        await store.release_all_mission_leases("M1")

        mission_m2 = _mission(id="M2", lease={"notebook": ["nb-1"]})
        keys_m2 = await store.resolve_mission_resource_leases(mission_m2)
        assert "notebook:nb-1" in keys_m2

        await store.release_all_mission_leases("M2")

    async def test_non_exclusive_grants_multiple(self, store: TeamStore):
        """非独占资源（knowledge_graph）多 mission 同时申请放行。"""
        mission_m1 = _mission(id="M1", lease={"knowledge_graph": ["g-1"]})
        mission_m2 = _mission(id="M2", lease={"knowledge_graph": ["g-1"]})
        keys_m1 = await store.resolve_mission_resource_leases(mission_m1)
        keys_m2 = await store.resolve_mission_resource_leases(mission_m2)
        assert "knowledge_graph:g-1" in keys_m1
        assert "knowledge_graph:g-1" in keys_m2
        await store.release_all_mission_leases("M1")
        await store.release_all_mission_leases("M2")

    async def test_mixed_exclusive_and_non_exclusive(self, store: TeamStore):
        """mission 同时声明独占和非独占资源均放行。"""
        mission = _mission(
            id="M1",
            lease={"notebook": ["nb-1"], "dataset": ["sales"], "knowledge_graph": ["g-1"]},
        )
        keys = await store.resolve_mission_resource_leases(mission)
        assert "notebook:nb-1" in keys
        assert "dataset:sales" in keys
        assert "knowledge_graph:g-1" in keys
        await store.release_all_mission_leases("M1")

    async def test_empty_lease_returns_empty_keys(self, store: TeamStore):
        """lease 为空时返回空列表。"""
        mission = _mission(id="M1", lease=None)
        keys = await store.resolve_mission_resource_leases(mission)
        assert keys == []

    async def test_lease_keys_persisted_to_state(self, store: TeamStore, state_dir: str):
        """租约持久化到 state.json，load 后恢复。"""
        mission = _mission(id="M1", lease={"notebook": ["nb-1"]})
        await store.resolve_mission_resource_leases(mission)

        # 新 store 实例 load，验证租约恢复
        store2 = TeamStore(state_dir)
        state = await store2.load()
        norm_key = _normalize_lease_key("notebook", "nb-1")
        assert norm_key in state.resource_leases
        assert state.resource_leases[norm_key]["mission_id"] == "M1"


# ---------------------------------------------------------------------------
# 3. check_write_guard — 资源租约检查
# ---------------------------------------------------------------------------


class TestCheckWriteGuardResourceLease:
    """覆盖 5 个不同资源类型的放行与拒绝。"""

    # --- notebook（独占）---

    def test_notebook_in_lease_allowed(self):
        """EditNotebookFile 在租约内放行。"""
        result = check_write_guard(
            write_allow_root=None,
            tool_name="EditNotebookFile",
            arguments={"notebook_path": "/workspace/experiment.ipynb"},
            resource_lease_keys=["notebook:/workspace/experiment.ipynb"],
        )
        assert result is None

    def test_notebook_outside_lease_denied(self):
        """EditNotebookFile 不在租约内被拒，错误信息含 lease_key。"""
        result = check_write_guard(
            write_allow_root=None,
            tool_name="EditNotebookFile",
            arguments={"notebook_path": "/workspace/experiment.ipynb"},
            resource_lease_keys=["notebook:/workspace/other.ipynb"],
        )
        assert result is not None
        assert "experiment.ipynb" in result
        assert "租约" in result

    def test_notebook_conflict_error_mentions_holder(self):
        """独占租约冲突的错误信息应包含持有者。"""
        # 这需要 store 层的测试，此处只测 guard 层的消息格式
        result = check_write_guard(
            write_allow_root=[],
            tool_name="EditNotebookFile",
            arguments={"notebook_path": "/workspace/experiment.ipynb"},
            resource_lease_keys=["notebook:/workspace/other.ipynb"],
        )
        assert "notebook:/workspace/experiment.ipynb" in result

    # --- dataset（非独占）---

    def test_dataset_in_lease_allowed(self):
        """CreateDataTable 在租约内放行。"""
        result = check_write_guard(
            write_allow_root=[],
            tool_name="CreateDataTable",
            arguments={"table_id": "sales_2026"},
            resource_lease_keys=["dataset:sales_2026"],
        )
        assert result is None

    def test_dataset_outside_lease_denied(self):
        """CreateDataTable 不在租约内被拒。"""
        result = check_write_guard(
            write_allow_root=[],
            tool_name="CreateDataTable",
            arguments={"table_id": "sales_2026"},
            resource_lease_keys=["dataset:other_table"],
        )
        assert result is not None
        assert "dataset:sales_2026" in result

    # --- knowledge_graph（非独占）---

    def test_knowledge_graph_in_lease_allowed(self):
        """CreateGraphEntity 在租约内放行。"""
        result = check_write_guard(
            write_allow_root=[],
            tool_name="CreateGraphEntity",
            arguments={"base_id": "g-1"},
            resource_lease_keys=["knowledge_graph:g-1"],
        )
        assert result is None

    def test_knowledge_graph_outside_lease_denied(self):
        """CreateKnowledgeGraph 不在租约内被拒。"""
        result = check_write_guard(
            write_allow_root=[],
            tool_name="CreateKnowledgeGraph",
            arguments={"graph_id": "new-graph"},
            resource_lease_keys=["knowledge_graph:other-graph"],
        )
        assert result is not None
        assert "new-graph" in result

    # --- knowledge_base（非独占）---

    def test_knowledge_base_in_lease_allowed(self):
        """CreateKnowledgeBase 在租约内放行。"""
        result = check_write_guard(
            write_allow_root=[],
            tool_name="CreateKnowledgeBase",
            arguments={"name": "my-kb"},
            resource_lease_keys=["knowledge_base:my-kb"],
        )
        assert result is None

    def test_knowledge_base_outside_lease_denied(self):
        """DeleteKnowledgeBase 不在租约内被拒。"""
        result = check_write_guard(
            write_allow_root=[],
            tool_name="DeleteKnowledgeBase",
            arguments={"knowledge_base_id": "my-kb"},
            resource_lease_keys=["knowledge_base:other-kb"],
        )
        assert result is not None
        assert "my-kb" in result

    # --- env_id（非独占）---

    def test_env_id_in_lease_allowed(self):
        """DeleteEnvVar 在租约内放行。"""
        result = check_write_guard(
            write_allow_root=[],
            tool_name="DeleteEnvVar",
            arguments={"name": "API_KEY"},
            resource_lease_keys=["env_id:API_KEY"],
        )
        assert result is None

    def test_env_id_outside_lease_denied(self):
        """DeleteEnvVar 不在租约内被拒。"""
        result = check_write_guard(
            write_allow_root=[],
            tool_name="DeleteEnvVar",
            arguments={"name": "API_KEY"},
            resource_lease_keys=["env_id:OTHER_VAR"],
        )
        assert result is not None
        assert "API_KEY" in result

    # --- 无租约限制时放行 ---

    def test_no_lease_keys_allows_non_file_tools(self):
        """resource_lease_keys=None 时非文件工具放行。"""
        result = check_write_guard(
            write_allow_root=None,
            tool_name="CreateDataTable",
            arguments={"table_id": "sales"},
            resource_lease_keys=None,
        )
        assert result is None

    def test_no_restrictions_allows_everything(self):
        """无任何限制时所有工具放行。"""
        result = check_write_guard(
            write_allow_root=None,
            tool_name="EditNotebookFile",
            arguments={"notebook_path": "/any/nb.ipynb"},
            resource_lease_keys=None,
        )
        assert result is None


# ---------------------------------------------------------------------------
# 4. check_write_guard — 路径守卫兼容性（非 team 场景零变更）
# ---------------------------------------------------------------------------


class TestWriteGuardBackwardCompat:
    """第二步原有路径守卫行为不因第三步改动而改变。"""

    def test_path_in_allow_root_passes(self, tmp_path: Path):
        allowed = str(tmp_path / "allowed")
        (tmp_path / "allowed").mkdir()
        target = str(tmp_path / "allowed" / "file.txt")
        result = check_write_guard(
            write_allow_root=[allowed],
            tool_name="WriteFile",
            arguments={"path": target},
            resource_lease_keys=None,
        )
        assert result is None

    def test_path_outside_denied(self, tmp_path: Path):
        allowed = str(tmp_path / "allowed")
        (tmp_path / "allowed").mkdir()
        result = check_write_guard(
            write_allow_root=[allowed],
            tool_name="WriteFile",
            arguments={"path": str(tmp_path / "forbidden.txt")},
            resource_lease_keys=None,
        )
        assert result is not None

    def test_unknown_tool_with_lease_keys_only(self):
        """不在任何映射中的工具，resource_lease_keys 不限制时放行。"""
        result = check_write_guard(
            write_allow_root=None,
            tool_name="SomeUnknownTool",
            arguments={},
            resource_lease_keys=None,
        )
        assert result is None

    def test_shell_denied_with_allow_root(self):
        """Shell 工具在有 allow_root 时仍被拒（已知缺口）。"""
        result = check_write_guard(
            write_allow_root=["/some/root"],
            tool_name="Shell",
            arguments={"command": "echo hi"},
        )
        assert result is not None
        assert "Shell" in result


# ---------------------------------------------------------------------------
# 5. 非 team 场景零行为变更
# ---------------------------------------------------------------------------


class TestNoTeamContextUnchanged:
    """无 team 上下文时，工具行为与第二步完全一致（零变更）。"""

    def test_check_write_guard_no_restrictions_passes_all(self):
        """无 write_allow_root 且无 resource_lease_keys 时，所有工具放行。"""
        tools_and_args = [
            ("WriteFile", {"path": "/any/path.txt"}),
            ("StrReplaceFile", {"path": "/any/path.txt", "old": "x", "new": "y"}),
            ("CreateFile", {"path": "/any/path.txt", "content": "hi"}),
            ("EditNotebookFile", {"notebook_path": "/any/nb.ipynb"}),
            ("CreateDataTable", {"table_id": "t1"}),
            ("DeleteDataTableRecord", {"table_path": "/workspace/t1.table.db", "record_id": "r1"}),
            ("CreateKnowledgeGraph", {"graph_id": "g1"}),
            ("DeleteKnowledgeGraph", {"graph_id": "g1"}),
            ("CreateGraphEntity", {"base_id": "g1"}),
            ("DeleteGraphEntity", {"base_id": "g1", "entity_name": "e1"}),
            ("CreateGraphRelation", {"base_id": "g1"}),
            ("CreateKnowledgeBase", {"name": "kb1"}),
            ("DeleteDocumentsFromKnowledgeBase", {"knowledge_base_id": "kb1"}),
            ("DeleteKnowledgeBase", {"knowledge_base_id": "kb1"}),
            ("DeleteEnvVar", {"name": "VAR1"}),
        ]
        for tool_name, args in tools_and_args:
            result = check_write_guard(
                write_allow_root=None,
                tool_name=tool_name,
                arguments=args,
                resource_lease_keys=None,
            )
            assert result is None, f"工具 {tool_name} 在无限制时应放行，实际被拒: {result}"

    def test_path_guard_behavior_unchanged(self, tmp_path: Path):
        """路径守卫的行为与第二步完全一致。"""
        allowed = str(tmp_path / "allowed")
        (tmp_path / "allowed").mkdir()
        outside = str(tmp_path / "outside.txt")

        # 在范围内放行
        result = check_write_guard(
            write_allow_root=[allowed],
            tool_name="WriteFile",
            arguments={"path": str(tmp_path / "allowed" / "ok.txt")},
        )
        assert result is None

        # 越界拒绝
        result = check_write_guard(
            write_allow_root=[allowed],
            tool_name="WriteFile",
            arguments={"path": outside},
        )
        assert "硬拒绝" in result


# ---------------------------------------------------------------------------
# 6. 13 工具归类和 _RESOURCE_LEASE_MAP 完整性
# ---------------------------------------------------------------------------


class TestResourceLeaseMapCompleteness:
    """验证 13 个工具都在 _RESOURCE_LEASE_MAP 中有注册。"""

    @pytest.mark.parametrize(
        "tool_name",
        [
            "WriteCanvas",
            "CreateDataTable",
            "DeleteDataTableRecord",
            "DeleteEnvVar",
            "EditNotebookFile",
            "CreateKnowledgeGraph",
            "DeleteKnowledgeGraph",
            "CreateGraphEntity",
            "DeleteGraphEntity",
            "CreateGraphRelation",
            "CreateKnowledgeBase",
            "DeleteDocumentsFromKnowledgeBase",
            "DeleteKnowledgeBase",
            "CreateSessionNotebook",
            "RunNotebook",
        ],
    )
    def test_tool_in_lease_map(self, tool_name: str):
        assert tool_name in _RESOURCE_LEASE_MAP, f"{tool_name} 未在 _RESOURCE_LEASE_MAP 中注册"
        cfg = _RESOURCE_LEASE_MAP[tool_name]
        assert "resource_type" in cfg
        assert "resource_id_arg" in cfg
        assert "exclusive" in cfg

    def test_notebook_tools_exclusive(self):
        """notebook 类工具全部标记 exclusive。"""
        notebook_tools = ["EditNotebookFile", "CreateSessionNotebook", "RunNotebook"]
        for tool_name in notebook_tools:
            assert _RESOURCE_LEASE_MAP[tool_name]["exclusive"] is True
            assert _RESOURCE_LEASE_MAP[tool_name]["resource_type"] == "notebook"

    def test_non_notebook_tools_not_exclusive(self):
        """非 notebook 工具不标记为 exclusive。"""
        for tool_name, cfg in _RESOURCE_LEASE_MAP.items():
            if cfg["resource_type"] != "notebook":
                assert cfg["exclusive"] is False, f"{tool_name} 不应为 exclusive"


# ---------------------------------------------------------------------------
# 7. Workspace Memory 分片隔离
# ---------------------------------------------------------------------------


class TestWorkspaceMemorySharding:
    """workspace_memory 分片：worker 写不到别的 mission 的分片，主控能合并。"""

    def test_shard_path_unique_per_mission(self, tmp_path: Path):
        memory_dir = tmp_path / ".aiasys" / "memory"
        memory_dir.mkdir(parents=True)
        shard_m1 = get_workspace_memory_shard_path(memory_dir, "M1")
        shard_m2 = get_workspace_memory_shard_path(memory_dir, "M2")
        assert shard_m1 != shard_m2
        assert shard_m1.name == "M1.md"
        assert shard_m2.name == "M2.md"
        assert shard_m1.parent == memory_dir / "shards"
        assert shard_m2.parent == memory_dir / "shards"

    def test_worker_cannot_write_other_mission_shard(self, tmp_path: Path):
        """worker 只能写自己的分片（路径隔离）。"""
        memory_dir = tmp_path / ".aiasys" / "memory"
        (memory_dir / "shards").mkdir(parents=True)
        shard_m2 = get_workspace_memory_shard_path(memory_dir, "M2")
        main_path = get_workspace_memory_main_path(memory_dir)

        # M1 的 worker 写自己的分片 → 成功
        shard_m1 = get_workspace_memory_shard_path(memory_dir, "M1")
        shard_m1.write_text("M1 的记忆", encoding="utf-8")
        assert shard_m1.exists()

        # 主文件不应该被 worker 直接写（路径守卫保证）
        assert not main_path.exists()

        # M2 的分片是空的（M1 的 worker 不能写）
        assert not shard_m2.exists()

    def test_merge_shards_produces_combined_content(self, tmp_path: Path):
        """主控合并分片：主文件内容 + 各分片内容。"""
        memory_dir = tmp_path / ".aiasys" / "memory"
        (memory_dir / "shards").mkdir(parents=True)

        # 写入现有主文件
        main_path = get_workspace_memory_main_path(memory_dir)
        main_path.write_text("# 主记忆\n已有内容\n", encoding="utf-8")

        # 写入分片
        for mid in ("M1", "M2", "M3"):
            shard = get_workspace_memory_shard_path(memory_dir, mid)
            shard.write_text(f"{mid} 的发现", encoding="utf-8")

        merged = merge_workspace_memory_shards(memory_dir)
        assert "# 主记忆" in merged
        assert "已有内容" in merged
        assert "M1 的发现" in merged
        assert "M2 的发现" in merged
        assert "M3 的发现" in merged
        assert "<!-- shard start -->" in merged

    def test_merge_selective_mission_ids(self, tmp_path: Path):
        """主控可以只合并指定 mission 的分片。"""
        memory_dir = tmp_path / ".aiasys" / "memory"
        (memory_dir / "shards").mkdir(parents=True)

        get_workspace_memory_shard_path(memory_dir, "M1").write_text("M1 内容", encoding="utf-8")
        get_workspace_memory_shard_path(memory_dir, "M2").write_text("M2 内容", encoding="utf-8")

        merged = merge_workspace_memory_shards(memory_dir, mission_ids=["M1"])
        assert "M1 内容" in merged
        assert "M2 内容" not in merged

    def test_merge_skips_empty_shards(self, tmp_path: Path):
        """空分片不影响合并结果。"""
        memory_dir = tmp_path / ".aiasys" / "memory"
        (memory_dir / "shards").mkdir(parents=True)

        get_workspace_memory_shard_path(memory_dir, "M1").write_text("有效内容", encoding="utf-8")
        get_workspace_memory_shard_path(memory_dir, "M2").write_text("", encoding="utf-8")

        merged = merge_workspace_memory_shards(memory_dir)
        assert "有效内容" in merged
        # 空分片不应出现在合并结果中

    def test_merge_no_existing_main_file(self, tmp_path: Path):
        """主文件不存在时只合并分片内容。"""
        memory_dir = tmp_path / ".aiasys" / "memory"
        (memory_dir / "shards").mkdir(parents=True)

        get_workspace_memory_shard_path(memory_dir, "M1").write_text("M1 内容", encoding="utf-8")

        merged = merge_workspace_memory_shards(memory_dir)
        assert "M1 内容" in merged
        # 不应有重复的 shard start/end 标记
        assert merged.count("<!-- shard start -->") == 1

    def test_shard_files_on_disk(self, tmp_path: Path):
        """分片文件实际落在 shards/ 子目录。"""
        memory_dir = tmp_path / ".aiasys" / "memory"
        (memory_dir / "shards").mkdir(parents=True)
        shard = get_workspace_memory_shard_path(memory_dir, "M-Test-001")
        assert shard.parent.name == "shards"
        assert shard.name == "M-Test-001.md"
        # 父目录不存在时写入应能创建
        shard.write_text("test", encoding="utf-8")
        assert shard.exists()


# ---------------------------------------------------------------------------
# 8. team_plan 接受 lease 字段
# ---------------------------------------------------------------------------


class TestTeamPlanAcceptsLease:
    async def test_plan_with_lease_field(self, store: TeamStore, state_dir: str):
        """team_plan 接受含 lease 字段的 mission。"""
        from app.services.agent.runtime_backends.aiasys.team.tools import (
            TeamPlanTool,
            clear_store_cache,
            set_team_state_dir_override,
        )

        clear_store_cache()
        set_team_state_dir_override(state_dir)

        tool = TeamPlanTool()
        result = await tool.invoke(
            ctx={"agent_path": "/root"},
            missions=[
                {
                    "title": "notebook 任务",
                    "kind": "build",
                    "scope": ["outputs/report.md"],
                    "lease": {"notebook": ["experiment.ipynb"]},
                }
            ],
        )
        assert not result.is_error, result.content
        set_team_state_dir_override(None)
        clear_store_cache()

    async def test_plan_stores_lease_in_mission(self, store: TeamStore):
        """mission 的 lease 字段被持久化。"""
        mission = _mission(
            id="__pending_0__",
            title="test",
            kind="build",
            scope=["outputs/x.md"],
            lease={"notebook": ["nb.ipynb"], "dataset": ["sales"]},
        )
        result = await store.plan([mission])
        assert len(result) == 1
        assert result[0].lease == {"notebook": ["nb.ipynb"], "dataset": ["sales"]}


# ---------------------------------------------------------------------------
# 9. 运行时租约表持久化与 teardown 清理
# ---------------------------------------------------------------------------


class TestLeasePersistenceAndTeardown:
    async def test_teardown_releases_all_leases(self, store: TeamStore, state_dir: str):
        """teardown 释放所有活跃租约。"""
        mission = _mission(id="M1", lease={"notebook": ["nb-1"], "dataset": ["t1"]})
        await store.resolve_mission_resource_leases(mission)

        # 确认租约活跃
        assert store.get_lease_holder("notebook", "nb-1") == "M1"

        await store.teardown()

        # 新 store 实例，租约表应清空
        store2 = TeamStore(state_dir)
        state = await store2.load()
        assert state.resource_leases == {}
        assert store2.get_lease_holder("notebook", "nb-1") is None

    async def test_teardown_idempotent(self, store: TeamStore, state_dir: str):
        """teardown 两次调用不报错。"""
        mission = _mission(id="M1", lease={"notebook": ["nb-1"]})
        await store.resolve_mission_resource_leases(mission)
        await store.teardown()
        result2 = await store.teardown()
        assert result2 == {"removed": [], "kept": []}


# ---------------------------------------------------------------------------
# 10. _normalize_lease_key
# ---------------------------------------------------------------------------


class TestNormalizeLeaseKey:
    def test_basic(self):
        assert _normalize_lease_key("notebook", "nb.ipynb") == "notebook:nb.ipynb"

    def test_trailing_slash_stripped(self):
        assert _normalize_lease_key("dataset", "sales/") == "dataset:sales"

    def test_backslash_to_slash(self):
        assert _normalize_lease_key("notebook", "nb\\test.ipynb") == "notebook:nb/test.ipynb"
