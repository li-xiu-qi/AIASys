import { useEffect, useRef, useCallback } from "react";

export interface UseSaveShortcutOptions {
  /** 保存回调 */
  onSave: () => void | Promise<void>;
  /** 是否启用快捷键 */
  enabled?: boolean;
  /** 是否正在保存中（保存中时忽略快捷键） */
  isSaving?: boolean;
}

/**
 * 全局保存快捷键：拦截 Ctrl+S / Cmd+S，调用 onSave。
 *
 * 对标 VSCode / Obsidian 行为：
 * - Windows/Linux 使用 Ctrl+S
 * - macOS 使用 Cmd(⌘)+S
 * - 保存中时忽略重复触发
 */
export function useSaveShortcut({
  onSave,
  enabled = true,
  isSaving = false,
}: UseSaveShortcutOptions) {
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const isSavingRef = useRef(isSaving);
  isSavingRef.current = isSaving;

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabledRef.current || isSavingRef.current) return;

    const isModifier = event.metaKey || event.ctrlKey;
    if (!isModifier) return;

    // 忽略只有修饰键按下的情况
    if (event.key.length > 1) return;

    if (event.key.toLowerCase() === "s") {
      event.preventDefault();
      event.stopPropagation();
      void onSaveRef.current();
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [handleKeyDown]);
}
