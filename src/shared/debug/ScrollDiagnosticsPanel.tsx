import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { createPortal } from 'react-dom';

import { authenticatedFetch } from '@/shared/api';
import {
  buildScrollDiagnosticsReport,
  readScrollDiagnosticsStats,
  startScrollDiagnostics,
  stopScrollDiagnostics,
} from '@/shared/debug/scrollDiagnostics';
import type { ScrollDiagnosticsSummary } from '@/shared/debug/scrollDiagnostics';

/**
 * Floating control for the scroll diagnostics recorder, rendered by
 * `ChatMessagesPane` only while Settings → Diagnostics is on. It floats over the
 * transcript so the reader can start a recording, reproduce the symptom by
 * dragging, and post the sample back without leaving the session.
 *
 * Deliberately loaded through a dynamic import: nothing here is needed by a
 * reader who never turns the switch on.
 */

type UploadState =
  | { status: 'idle' }
  | { status: 'busy' }
  | { status: 'done'; path: string }
  | { status: 'error'; message: string };

const PANEL_STYLE: CSSProperties = {
  position: 'fixed',
  left: 8,
  bottom: '30%',
  zIndex: 2147483000,
  width: 236,
  padding: 10,
  borderRadius: 10,
  background: 'rgba(18, 18, 20, 0.92)',
  color: '#f2f2f4',
  font: '12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
  boxShadow: '0 6px 24px rgba(0, 0, 0, 0.35)',
};

const BUTTON_STYLE: CSSProperties = {
  padding: '5px 8px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.22)',
  background: 'rgba(255,255,255,0.08)',
  color: 'inherit',
  fontSize: 12,
  fontFamily: 'inherit',
};

export default function ScrollDiagnosticsPanel({ containerRef }: { containerRef: RefObject<HTMLDivElement> }) {
  const [expanded, setExpanded] = useState(false);
  const [recording, setRecording] = useState(false);
  const [stats, setStats] = useState<ScrollDiagnosticsSummary | null>(null);
  const [upload, setUpload] = useState<UploadState>({ status: 'idle' });
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!recording) return undefined;
    timerRef.current = window.setInterval(() => {
      setStats(readScrollDiagnosticsStats());
    }, 500);
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [recording]);

  // A recording owns the DOM (scroll API patches, observers, listeners), so it
  // must not outlive the panel that can stop it.
  useEffect(() => () => stopScrollDiagnostics(), []);

  const toggleRecording = useCallback(() => {
    if (recording) {
      stopScrollDiagnostics();
      setRecording(false);
      setStats(null);
      setUpload({ status: 'idle' });
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    startScrollDiagnostics(container);
    setRecording(true);
    setUpload({ status: 'idle' });
    setStats(readScrollDiagnosticsStats());
    // Collapse immediately: the panel sits over the transcript, and the run it
    // just started is the reader dragging the transcript by hand.
    setExpanded(false);
  }, [containerRef, recording]);

  const submit = useCallback(async () => {
    const report = buildScrollDiagnosticsReport();
    if (!report) {
      setUpload({ status: 'error', message: '还没有录制' });
      return;
    }
    setUpload({ status: 'busy' });
    try {
      const response = await authenticatedFetch('/api/system/client-diagnostics', {
        method: 'POST',
        body: JSON.stringify(report),
      });
      const payload = (await response.json().catch(() => null)) as
        | { path?: string; error?: string }
        | null;
      if (!response.ok) {
        setUpload({ status: 'error', message: payload?.error ?? `HTTP ${response.status}` });
        return;
      }
      setUpload({ status: 'done', path: payload?.path ?? '(服务端未返回路径)' });
    } catch (error) {
      setUpload({ status: 'error', message: error instanceof Error ? error.message : '未知错误' });
    }
  }, []);

  if (!expanded) {
    return createPortal(
      <button
        type="button"
        onClick={() => setExpanded(true)}
        style={{
          position: 'fixed',
          left: 8,
          bottom: '30%',
          zIndex: 2147483000,
          width: 34,
          height: 34,
          borderRadius: 17,
          border: '1px solid rgba(255,255,255,0.25)',
          background: recording ? 'rgba(200, 40, 40, 0.9)' : 'rgba(18, 18, 20, 0.75)',
          color: '#fff',
          fontSize: 12,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        诊
      </button>,
      document.body,
    );
  }

  return createPortal(
    <div style={PANEL_STYLE}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 12 }}>滚动诊断</strong>
        <button type="button" onClick={() => setExpanded(false)} style={BUTTON_STYLE}>
          收起
        </button>
      </div>

      <div style={{ marginTop: 6, opacity: 0.8 }}>
        {stats ? (
          <>
            <div>录制 {Math.round(stats.durationMs / 100) / 10}s · 帧 {stats.samples}</div>
            <div>
              最差帧 {stats.maxFrameMs}ms · p95 {stats.p95FrameMs}ms
            </div>
            <div>
              行挂载 {stats.rowMounts} / 卸载 {stats.rowUnmounts}
            </div>
            <div style={{ color: stats.headerFlips > 4 ? '#ff9f6e' : 'inherit' }}>
              吸顶条翻转 {stats.headerFlips} 次
            </div>
            <div style={{ color: stats.prependPages > 1 ? '#ff9f6e' : 'inherit' }}>
              加载更早 {stats.prependPages} 页
            </div>
            <div style={{ color: stats.visualJumps > 0 ? '#ff9f6e' : 'inherit' }}>
              内容位移 {stats.visualJumps} 次 · 最大 {stats.largestVisualJumpPx}px
            </div>
            <div style={{ opacity: 0.75 }}>
              写入同帧位移 {stats.writeFrameJumps} 次
            </div>
            <div style={{ color: stats.rowHeightChanges > 3 ? '#ff9f6e' : 'inherit' }}>
              行高突变 {stats.rowHeightChanges} 次
            </div>
            <div style={{ color: stats.snappedToBottomWhileTouching > 0 ? '#ff9f6e' : 'inherit' }}>
              触摸中跳变 {stats.jumpWhileTouching} 次 · 回底 {stats.snappedToBottomWhileTouching} 次
            </div>
          </>
        ) : (
          <div>未录制</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button
          type="button"
          onClick={toggleRecording}
          style={{
            ...BUTTON_STYLE,
            background: recording ? 'rgba(200,40,40,0.72)' : 'rgba(40,140,80,0.72)',
          }}
        >
          {recording ? '停止' : '开始录制'}
        </button>
        <button type="button" onClick={submit} disabled={upload.status === 'busy'} style={BUTTON_STYLE}>
          {upload.status === 'busy' ? '上报中…' : '上报'}
        </button>
      </div>

      {upload.status === 'done' && (
        <div style={{ marginTop: 8, color: '#8fe3a2', wordBreak: 'break-all' }}>
          已上报：{upload.path}
        </div>
      )}
      {upload.status === 'error' && (
        <div style={{ marginTop: 8, color: '#ff9f6e', wordBreak: 'break-all' }}>
          上报失败：{upload.message}
        </div>
      )}
    </div>,
    document.body,
  );
}
