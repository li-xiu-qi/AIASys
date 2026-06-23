import { AlertCircle, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface NewTaskProgressBannerProps {
  showProgress: boolean;
  isError: boolean;
  stageLabel: string;
  errorMessage?: string | null;
  progress?: number;
  message?: string;
}

export function NewWorkspaceProgressBanner({
  showProgress,
  isError,
  stageLabel,
  errorMessage,
  progress,
  message,
}: NewTaskProgressBannerProps) {
  if (!showProgress && !isError) {
    return null;
  }

  const hasProgress = typeof progress === "number" && progress >= 0;

  return (
    <div
      className={cn(
        "mt-6 rounded-lg border px-4 py-3",
        isError
          ? "border-destructive/40 bg-destructive/5"
          : "border-border bg-muted dark:border-foreground dark:bg-foreground/70",
      )}
    >
      <div className="flex items-start gap-3">
        {isError ? (
          <AlertCircle className="mt-0.5 h-4 w-4 text-destructive" />
        ) : (
          <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-muted-foreground dark:text-muted-foreground" />
        )}
        <div className="flex-1 space-y-2">
          <div
            className={cn(
              "text-sm font-medium",
              isError ? "text-destructive" : "text-foreground",
            )}
          >
            {isError ? "新任务初始化失败" : (message || stageLabel)}
            {!isError && hasProgress && (
              <span className="ml-2 text-xs text-muted-foreground">
                {progress}%
              </span>
            )}
          </div>
          {!isError && hasProgress && (
            <Progress value={Math.max(progress, 2)} className="h-1.5" />
          )}
          {!isError && !hasProgress && (
            <p className="text-xs text-muted-foreground">
              {stageLabel || "正在初始化..."}
            </p>
          )}
          {isError && (
            <p className="text-xs text-muted-foreground">
              {errorMessage || "请检查当前工作区创建状态后重试。"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
