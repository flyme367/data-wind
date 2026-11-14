import { useEffect, useRef, useState } from "react";
import { Terminal } from "@icon-park/react";
import { installSystemLogCapture, useDebugLog, type DebugChannel } from "../data/debugLog";

const TABS: { key: DebugChannel; label: string }[] = [
  { key: "dev", label: "二次开发输出" },
  { key: "system", label: "系统信息输出" },
];

/** 画布底部调试控制台（对齐山海鲸 4.7.13 调试面板）：二次开发输出 / 系统信息输出两个页签。 */
export default function DebugConsole({ onClose }: { onClose: () => void }) {
  const [channel, setChannel] = useState<DebugChannel>("dev");
  const entries = useDebugLog(channel);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(installSystemLogCapture, []);
  useEffect(() => { const el = bodyRef.current; if (el) el.scrollTop = el.scrollHeight; }, [entries, channel]);
  return (
    <section className="board-debug-console" aria-label="调试面板">
      <header className="board-debug-console-header">
        <Terminal size={13} aria-hidden="true" />
        {TABS.map((tab) => (
          <button key={tab.key} type="button" role="tab" aria-selected={channel === tab.key}
            className={`board-debug-tab ${channel === tab.key ? "is-active" : ""}`}
            onClick={() => setChannel(tab.key)}>{tab.label}</button>
        ))}
        <button type="button" className="board-debug-close" aria-label="关闭调试面板" onClick={onClose}>×</button>
      </header>
      <div className="board-debug-console-body" ref={bodyRef}>
        {entries.length === 0 ? <p className="board-debug-empty">暂无输出</p> : entries.map((entry) => (
          <div key={entry.id} className={`board-debug-entry is-${entry.level}`}>
            <time>{entry.time}</time>
            <span>{entry.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
