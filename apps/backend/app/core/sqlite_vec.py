"""
sqlite-vec 扩展加载封装

根据当前操作系统和架构自动选择正确的预编译二进制文件。
"""

import os
import platform
import sqlite3
import sys
from pathlib import Path
from typing import Optional

from app.utils.path_utils import as_system_path

VENDOR_DIR = Path(__file__).resolve().parents[2] / "vendor" / "sqlite-vec"


_EXTENSION_NAMES = {
    ("Linux", "x86_64"): ("linux-x86_64", "vec0.so"),
    ("Linux", "AMD64"): ("linux-x86_64", "vec0.so"),
    ("Darwin", "x86_64"): ("macos-x86_64", "vec0.dylib"),
    ("Darwin", "arm64"): ("macos-aarch64", "vec0.dylib"),
    ("Darwin", "aarch64"): ("macos-aarch64", "vec0.dylib"),
    ("Windows", "x86_64"): ("windows-x86_64", "vec0.dll"),
    ("Windows", "AMD64"): ("windows-x86_64", "vec0.dll"),
}


def _get_extension_path() -> Optional[Path]:
    system = platform.system()
    machine = platform.machine()
    key = (system, machine)
    if key not in _EXTENSION_NAMES:
        return None
    subdir, filename = _EXTENSION_NAMES[key]
    path = VENDOR_DIR / subdir / filename
    if path.exists():
        return path
    return None


def _resolve_load_path(ext_path: Path) -> str:
    r"""返回传给 sqlite3 load_extension 的路径字符串。

    Windows 上 LoadLibraryExW 与 \\?\ 长路径前缀不兼容，
    不能走 as_system_path()；但需要规范化路径分隔符为反斜杠，
    并通过 os.add_dll_directory 将扩展所在目录加入 DLL 搜索路径，
    确保 vec0.dll 的依赖（如有）能被正确找到。
    """
    if sys.platform == "win32":
        # 将扩展所在目录加入 DLL 搜索路径（Python 3.8+ 安全语义）
        os.add_dll_directory(str(ext_path.parent))
        # 规范化为反斜杠，避免混用分隔符导致 LoadLibraryExW 失败
        return os.path.normpath(str(ext_path))
    return str(ext_path)


def load_vec_extension(conn: sqlite3.Connection) -> None:
    """在 sqlite3 连接上加载 sqlite-vec 扩展。"""
    ext_path = _get_extension_path()
    if ext_path is None:
        system = platform.system()
        machine = platform.machine()
        raise RuntimeError(
            f"sqlite-vec 扩展不支持当前平台: {system} {machine}. "
            f"支持的组合: {list(_EXTENSION_NAMES.keys())}"
        )
    load_path = _resolve_load_path(ext_path)
    conn.enable_load_extension(True)
    conn.load_extension(load_path)
    conn.enable_load_extension(False)


def ensure_vec_extension(db_path: Path) -> sqlite3.Connection:
    r"""打开 SQLite 数据库并加载 sqlite-vec 扩展。

    数据库路径走 as_system_path() 以兼容 Windows 长路径。
    扩展路径不使用 \\?\ 前缀（LoadLibraryExW 不兼容），见 _resolve_load_path。
    """
    # mkdir 走 as_system_path 以兼容 Windows 长路径
    os.makedirs(as_system_path(db_path.parent), exist_ok=True)
    # SQLite 的 Windows VFS 支持 \\?\ 前缀，可安全用于长路径
    conn = sqlite3.connect(as_system_path(db_path))
    load_vec_extension(conn)
    return conn
