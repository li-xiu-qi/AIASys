import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/error/ErrorBoundary";
import { AuthProvider } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import "./index.css";

// 更新 HTML 内置 splash 的加载进度
const setProgress = (window as any).__setLoadingProgress;
if (setProgress) {
  setProgress(10, "正在加载界面...");
}

const root = createRoot(document.getElementById("root")!);

// 使用 requestAnimationFrame 确保 splash 进度更新先渲染
requestAnimationFrame(() => {
  if (setProgress) setProgress(30, "正在初始化组件...");

  root.render(
    <StrictMode>
      <ErrorBoundary>
        <ThemeProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
});
