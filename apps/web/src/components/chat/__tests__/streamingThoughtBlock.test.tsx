import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  StreamingThoughtBlock,
  formatThinkDuration,
  lastContentLine,
} from "../StreamingThoughtBlock";

// 组件内部只取 session?.token，mock 掉 AuthContext 避免拉进整个认证栈
vi.mock("@/contexts/AuthContext", () => ({
  useAuthContext: () => ({ session: null }),
}));

// ChartAwareMarkdown 依赖 markdown/chart 渲染链，这里只测折叠行为与计时显示，
// 换成原样渲染的替身；内容文本照进 DOM，断言强度不减。
vi.mock("../ChartAwareMarkdown", () => ({
  ChartAwareMarkdown: ({ content }: { content: string }) => (
    <div data-testid="markdown">{content}</div>
  ),
}));

/**
 * StreamingThoughtBlock 的折叠行为契约（借鉴 grok-build ThinkingBlock 三态）：
 * 1. streaming 结束 → 用户没动过 → 自动折叠，标题定格「思考过程 · Xs」；
 * 2. 用户手动展开过 → 结束时保持展开；
 * 3. 折叠态显示最后一行预览，内容随时更新。
 */

describe("formatThinkDuration", () => {
  it("小于 60 秒显示秒数", () => {
    expect(formatThinkDuration(2300)).toBe("2.3s");
  });
  it("超过 60 秒显示分秒", () => {
    expect(formatThinkDuration(83_000)).toBe("1m 23s");
  });
});

describe("lastContentLine", () => {
  it("取最后一行非空内容", () => {
    expect(lastContentLine("第一行\n\n第二行\n")).toBe("第二行");
  });
  it("全空返回 undefined", () => {
    expect(lastContentLine("  \n\n")).toBeUndefined();
  });
});

describe("StreamingThoughtBlock 折叠行为", () => {
  it("streaming 结束后自动折叠并定格用时", async () => {
    const { rerender } = render(
      <StreamingThoughtBlock initialContent="一些思考" isStreaming />,
    );
    // 流式中：内容可见
    expect(screen.queryByTestId("markdown")).not.toBeNull();

    rerender(<StreamingThoughtBlock initialContent="一些思考" isStreaming={false} />);

    await waitFor(() => {
      expect(screen.queryByTestId("markdown")).toBeNull();
    });
    expect(screen.queryByText(/思考过程 · \d/)).not.toBeNull();
  });

  it("用户手动展开后，结束时保持展开", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <StreamingThoughtBlock initialContent="一些思考" isStreaming />,
    );
    // 用户先折叠再展开，即「表过态」
    await user.click(screen.getByRole("button"));
    await user.click(screen.getByRole("button"));
    expect(screen.queryByTestId("markdown")).not.toBeNull();

    rerender(<StreamingThoughtBlock initialContent="一些思考" isStreaming={false} />);

    // 结束后仍展开
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("markdown")).not.toBeNull();
  });

  it("折叠态显示最后一行预览", () => {
    render(
      <StreamingThoughtBlock
        initialContent={"第一行思考\n最终的结论行"}
        isStreaming={false}
        defaultOpen={false}
      />,
    );
    expect(screen.queryByText("最终的结论行")).not.toBeNull();
    expect(screen.queryByTestId("markdown")).toBeNull();
  });

  it("历史恢复（无 streaming 经历）不显示用时", () => {
    render(
      <StreamingThoughtBlock initialContent="旧思考" isStreaming={false} defaultOpen={false} />,
    );
    expect(screen.queryByText("思考过程")).not.toBeNull();
    expect(screen.queryByText(/思考过程 · /)).toBeNull();
  });

  it("无内容且不 streaming 时不渲染", () => {
    const { container } = render(
      <StreamingThoughtBlock initialContent="" isStreaming={false} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
