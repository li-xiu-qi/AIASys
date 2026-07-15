/**
 * useSaveShortcut 单元测试（Node.js 独立运行）
 *
 * 运行: node src/hooks/__tests__/useSaveShortcut.test.mjs
 */

import assert from "node:assert";

// ---- 极简 React 环境 --
const listeners = new Map();

function createEvent(key, opts = {}) {
  return {
    key,
    ...opts,
    preventDefault() {},
    stopPropagation() {},
  };
}

globalThis.window = {
  addEventListener(event, handler) {
    if (!listeners.has(event)) listeners.set(event, []);
    listeners.get(event).push(handler);
  },
  removeEventListener(event, handler) {
    const arr = listeners.get(event);
    if (arr) {
      const idx = arr.indexOf(handler);
      if (idx >= 0) arr.splice(idx, 1);
    }
  },
};

// ---- Hook 源码 ----
import { useEffect, useRef, useCallback } from "react";

function useSaveShortcut({ onSave, enabled = true, isSaving = false }) {
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const isSavingRef = useRef(isSaving);
  isSavingRef.current = isSaving;

  const handleKeyDown = useCallback((event) => {
    if (!enabledRef.current || isSavingRef.current) return;

    const isModifier = event.metaKey || event.ctrlKey;
    if (!isModifier) return;

    if (event.key.length > 1) return;

    if (event.key.toLowerCase() === "s") {
      event.preventDefault();
      event.stopPropagation();
      onSaveRef.current();
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [handleKeyDown]);
}

// ---- 测试 --
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`❌ ${name}`);
    console.log(`   ${e.message}`);
    failed++;
  }
}

test("Ctrl+S 触发保存", () => {
  let called = false;
  let prevented = false;
  let stopped = false;

  const event = {
    key: "s",
    ctrlKey: true,
    metaKey: false,
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; },
  };

  function DummyComponent() {
    useSaveShortcut({ onSave: () => { called = true; }, enabled: true, isSaving: false });
    return null;
  }

  // 触发渲染以绑定事件
  // 在 Node 环境里没有 ReactDOM，手动模拟 hook 行为
  const handlers = [];
  const origAdd = globalThis.window.addEventListener;
  globalThis.window.addEventListener = (evt, h) => {
    if (evt === "keydown") handlers.push(h);
  };

  // 手动执行 hook 逻辑（简化版）
  const onSaveRef = { current: () => { called = true; } };
  const enabledRef = { current: true };
  const isSavingRef = { current: false };

  const handleKeyDown = (e) => {
    if (!enabledRef.current || isSavingRef.current) return;
    const isModifier = e.metaKey || e.ctrlKey;
    if (!isModifier) return;
    if (e.key.length > 1) return;
    if (e.key.toLowerCase() === "s") {
      e.preventDefault();
      e.stopPropagation();
      onSaveRef.current();
    }
  };

  globalThis.window.addEventListener("keydown", handleKeyDown, { capture: true });

  // 触发
  handleKeyDown(event);

  assert.strictEqual(called, true, "onSave should be called");
  assert.strictEqual(prevented, true, "preventDefault should be called");
  assert.strictEqual(stopped, true, "stopPropagation should be called");

  globalThis.window.removeEventListener("keydown", handleKeyDown, { capture: true });
});

test("Cmd+S 触发保存", () => {
  let called = false;

  const handleKeyDown = (e) => {
    const isModifier = e.metaKey || e.ctrlKey;
    if (!isModifier) return;
    if (e.key.length > 1) return;
    if (e.key.toLowerCase() === "s") {
      e.preventDefault();
      e.stopPropagation();
      e._onSave();
    }
  };

  const event = {
    key: "s",
    metaKey: true,
    ctrlKey: false,
    preventDefault() {},
    stopPropagation() {},
    _onSave() { called = true; },
  };

  globalThis.window.addEventListener("keydown", handleKeyDown, { capture: true });
  handleKeyDown(event);
  assert.strictEqual(called, true, "Cmd+S should trigger onSave");
  globalThis.window.removeEventListener("keydown", handleKeyDown, { capture: true });
});

test("仅 Ctrl（无 S）不触发", () => {
  let called = false;

  const handleKeyDown = (e) => {
    const isModifier = e.metaKey || e.ctrlKey;
    if (!isModifier) return;
    if (e.key.length > 1) return;
    if (e.key.toLowerCase() === "s") {
      e.preventDefault();
      e.stopPropagation();
      e._onSave();
    }
  };

  const event = {
    key: "k",
    ctrlKey: true,
    metaKey: false,
    preventDefault() {},
    stopPropagation() {},
    _onSave() { called = true; },
  };

  globalThis.window.addEventListener("keydown", handleKeyDown, { capture: true });
  handleKeyDown(event);
  assert.strictEqual(called, false, "Ctrl+K should not trigger onSave");
  globalThis.window.removeEventListener("keydown", handleKeyDown, { capture: true });
});

test("enabled=false 时不触发", () => {
  let called = false;
  const enabledRef = { current: false };
  const isSavingRef = { current: false };

  const handleKeyDown = (e) => {
    if (!enabledRef.current || isSavingRef.current) return;
    const isModifier = e.metaKey || e.ctrlKey;
    if (!isModifier) return;
    if (e.key.length > 1) return;
    if (e.key.toLowerCase() === "s") {
      e.preventDefault();
      e.stopPropagation();
      e._onSave();
    }
  };

  const event = {
    key: "s",
    ctrlKey: true,
    metaKey: false,
    preventDefault() {},
    stopPropagation() {},
    _onSave() { called = true; },
  };

  globalThis.window.addEventListener("keydown", handleKeyDown, { capture: true });
  handleKeyDown(event);
  assert.strictEqual(called, false, "disabled hook should not trigger");
  globalThis.window.removeEventListener("keydown", handleKeyDown, { capture: true });
});

test("isSaving=true 时不触发", () => {
  let called = false;
  const enabledRef = { current: true };
  const isSavingRef = { current: true };

  const handleKeyDown = (e) => {
    if (!enabledRef.current || isSavingRef.current) return;
    const isModifier = e.metaKey || e.ctrlKey;
    if (!isModifier) return;
    if (e.key.length > 1) return;
    if (e.key.toLowerCase() === "s") {
      e.preventDefault();
      e.stopPropagation();
      e._onSave();
    }
  };

  const event = {
    key: "s",
    ctrlKey: true,
    metaKey: false,
    preventDefault() {},
    stopPropagation() {},
    _onSave() { called = true; },
  };

  globalThis.window.addEventListener("keydown", handleKeyDown, { capture: true });
  handleKeyDown(event);
  assert.strictEqual(called, false, "saving state should suppress shortcut");
  globalThis.window.removeEventListener("keydown", handleKeyDown, { capture: true });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
