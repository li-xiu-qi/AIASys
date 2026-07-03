"""AIASys 内部短 ID 生成器。

为工作区、会话/对话等需要作为目录名的实体生成 URL/文件名安全的短 ID。
所有生成入口统一在此，避免散落在各 service 中直接使用 uuid4。
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from pathlib import Path


def generate_workspace_id(parent: Path) -> str:
    """生成工作区目录 ID，并在 parent 下做碰撞检查。

    结果：时间戳前缀 + 4 字符随机后缀，形如 `20260703-120530-a3f1`。
    既保证可读性/排序性，又保留足够随机性避免高频创建冲突。
    """
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    for _ in range(10):
        suffix = secrets.token_hex(2)
        candidate = f"{timestamp}-{suffix}"
        if not (parent / candidate).exists():
            return candidate
    raise RuntimeError("无法生成可用的 workspace_id")


def generate_session_id(parent: Path) -> str:
    """生成会话/对话目录 ID，并在 parent 下做碰撞检查。

    结果：16 字符十六进制（64 bit），比 uuid4 短 20 字符，显著降低 Windows 路径长度。
    """
    for _ in range(10):
        candidate = secrets.token_hex(8)
        if not (parent / candidate).exists():
            return candidate
    raise RuntimeError("无法生成可用的 session_id")


def generate_conversation_id(parent: Path) -> str:
    """conversation_id 与 session_id 共用同一命名空间（目录级）。"""
    return generate_session_id(parent)
