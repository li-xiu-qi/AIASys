import type { SessionStatusInfo } from "../types";

export function mergeEffectiveSessionStatus(
  sessionId: string | undefined,
  sessionStatus: SessionStatusInfo | null,
  executionRecordsSummary: SessionStatusInfo | null,
): SessionStatusInfo | null {
  if (executionRecordsSummary?.session_id === sessionId && sessionId) {
    return {
      session_id: sessionId,
      ...executionRecordsSummary,
      ...(sessionStatus || {}),
    };
  }

  return sessionStatus;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();

  // 延迟清理，避免浏览器尚未开始下载时 blob URL 就被释放
  setTimeout(() => {
    window.URL.revokeObjectURL(url);
    link.remove();
  }, 100);
}

export function getDownloadFilename(
  response: Response,
  fallbackFilename: string,
): string {
  const contentDisposition = response.headers.get("content-disposition");
  const match = contentDisposition?.match(/filename="?([^"]+)"?/i);
  return match?.[1] || fallbackFilename;
}
