import { useEffect } from "react";

interface UseWorkspacePageEffectsParams {
  apiBaseUrl: string;
  sessionId?: string;
  chatItemCount: number;
  setIsRightSidebarOpen: (
    open: boolean | ((prev: boolean) => boolean),
  ) => void;
}

export function useWorkspacePageEffects({
  apiBaseUrl,
  sessionId,
  chatItemCount,
  setIsRightSidebarOpen,
}: UseWorkspacePageEffectsParams) {
  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      if (event.key === "Escape") {
        // 如果焦点在输入框/文本域中，不触发侧栏切换（让输入框自行处理 Escape）
        const active = document.activeElement;
        if (
          active &&
          (active.tagName === "INPUT" ||
            active.tagName === "TEXTAREA" ||
            active.isContentEditable ||
            active.getAttribute("contenteditable") === "true")
        ) {
          return;
        }
        // 如果有模态对话框/弹窗打开，不触发侧栏切换
        if (
          document.querySelector(
            '[role="dialog"]:not([aria-hidden="true"]), [data-state="open"]',
          )
        ) {
          return;
        }
        setIsRightSidebarOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [setIsRightSidebarOpen]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!sessionId || chatItemCount > 0) {
        return;
      }

      const blob = new Blob([JSON.stringify({ sessionId, empty: true })], {
        type: "application/json",
      });
      navigator.sendBeacon(`${apiBaseUrl}/api/sessions/mark-draft-for-cleanup`, blob);
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [apiBaseUrl, chatItemCount, sessionId]);
}
