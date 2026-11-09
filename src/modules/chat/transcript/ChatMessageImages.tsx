import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { useIsExportingTranscript } from '@/modules/chat/context/TranscriptRenderContext';
import { api } from '@/shared/api';
import type { ChatImage } from '@/shared/types';

type ChatMessageImagesProps = {
  images: ChatImage[];
  projectId?: string | null;
};

/**
 * Resolves one chat image to a displayable src. Inline data URLs are used
 * directly; path-based attachments are fetched as blobs (a bare <img src>
 * cannot carry the auth header) — first from the global assets route
 * (`~/.cloudcli/assets`), then from the project files route as a fallback for
 * sessions recorded before attachments moved to the global store.
 */
function useChatImageSrc(image: ChatImage, projectId?: string | null): { src: string | null; failed: boolean } {
  const [src, setSrc] = useState<string | null>(image.data || null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (image.data) {
      setSrc(image.data);
      setFailed(false);
      return;
    }

    const imagePath = image.path;
    if (!imagePath) {
      setSrc(null);
      setFailed(true);
      return;
    }

    const filename = imagePath.split(/[\\/]/).pop() || '';
    let objectUrl: string | null = null;
    const controller = new AbortController();

    const candidateRequests: Array<() => Promise<Response>> = [
      () => api.assets.image(filename, { signal: controller.signal }),
      ...(projectId
        ? [() => api.readFileBlob(projectId, imagePath, { signal: controller.signal })]
        : []),
    ];

    const load = async () => {
      setFailed(false);
      for (const requestCandidate of candidateRequests) {
        try {
          const response = await requestCandidate();
          if (!response.ok) {
            continue;
          }
          const blob = await response.blob();
          objectUrl = URL.createObjectURL(blob);
          setSrc(objectUrl);
          return;
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            return;
          }
        }
      }
      setSrc(null);
      setFailed(true);
    };

    void load();

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [image.data, image.path, projectId]);

  return { src, failed };
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const TAP_SLOP = 8;
const DOUBLE_TAP_WINDOW = 300;
// Longer than DOUBLE_TAP_WINDOW so a slow second click still registers as a
// double-click instead of the pending single click closing the lightbox.
const SINGLE_TAP_DELAY = DOUBLE_TAP_WINDOW + 20;

type Point = { x: number; y: number };

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Fullscreen image overlay in the claude.ai style: dark backdrop, centered
 * image, closes on backdrop click, close button, or Escape.
 *
 * The image itself can be inspected: pinch or wheel to zoom (1×–4×), drag to
 * pan while zoomed, double-click to toggle zoom on desktop. Tapping the image
 * follows the native photo-viewer convention — a tap at 1× closes the
 * lightbox, a tap while zoomed resets back to fit first.
 *
 * Used by chat's ChatMessageImages and ComposerAttachment to expand a
 * thumbnail to full size.
 */
export function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const { t } = useTranslation();
  const imgRef = useRef<HTMLImageElement>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [animate, setAnimate] = useState(false);

  // Mirrors of the transform state so native/pointer handlers always read the
  // current values without being re-created on every frame.
  const scaleRef = useRef(1);
  const offsetRef = useRef<Point>({ x: 0, y: 0 });
  const pointers = useRef<Map<number, Point>>(new Map());
  const gesture = useRef({
    mode: 'none' as 'none' | 'pan' | 'pinch',
    moved: 0,
    panPointer: { x: 0, y: 0 },
    panOffset: { x: 0, y: 0 },
    pinchDistance: 1,
    pinchScale: 1,
    pinchOffset: { x: 0, y: 0 },
    pinchMidpoint: { x: 0, y: 0 },
  });
  const tapTimer = useRef<number | null>(null);
  const lastTapAt = useRef(0);

  const applyTransform = useCallback((nextScale: number, nextOffset: Point, animated = false) => {
    scaleRef.current = nextScale;
    offsetRef.current = nextOffset;
    setAnimate(animated);
    setScale(nextScale);
    setOffset(nextOffset);
  }, []);

  // Keep the scaled image from being dragged fully out of the viewport.
  const clampOffset = useCallback((nextScale: number, nextOffset: Point): Point => {
    const element = imgRef.current;
    if (!element || nextScale <= 1) {
      return { x: 0, y: 0 };
    }
    const maxX = Math.max(0, (element.offsetWidth * nextScale - window.innerWidth) / 2);
    const maxY = Math.max(0, (element.offsetHeight * nextScale - window.innerHeight) / 2);
    return {
      x: clamp(nextOffset.x, -maxX, maxX),
      y: clamp(nextOffset.y, -maxY, maxY),
    };
  }, []);

  // Zoom keeping the content point under `point` anchored on screen.
  const zoomAt = useCallback(
    (targetScale: number, point: Point, animated = false) => {
      const currentScale = scaleRef.current;
      const currentOffset = offsetRef.current;
      const nextScale = clamp(targetScale, MIN_SCALE, MAX_SCALE);
      if (nextScale === currentScale) {
        return;
      }
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      const ratio = nextScale / currentScale;
      const nextOffset =
        nextScale <= 1
          ? { x: 0, y: 0 }
          : clampOffset(nextScale, {
              x: (point.x - centerX) * (1 - ratio) + currentOffset.x * ratio,
              y: (point.y - centerY) * (1 - ratio) + currentOffset.y * ratio,
            });
      applyTransform(nextScale, nextOffset, animated);
    },
    [applyTransform, clampOffset],
  );

  const resetZoom = useCallback(() => {
    applyTransform(1, { x: 0, y: 0 }, true);
  }, [applyTransform]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  // Wheel has to be non-passive to prevent the page from scrolling behind the
  // overlay. Trackpad pinch arrives here as a ctrl+wheel.
  useEffect(() => {
    const element = imgRef.current;
    if (!element) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
      zoomAt(scaleRef.current * factor, { x: event.clientX, y: event.clientY });
    };
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, [zoomAt]);

  useEffect(() => {
    return () => {
      if (tapTimer.current !== null) {
        window.clearTimeout(tapTimer.current);
      }
    };
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLImageElement>) => {
    if (tapTimer.current !== null) {
      window.clearTimeout(tapTimer.current);
      tapTimer.current = null;
    }
    setAnimate(false);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is best-effort; pointer math still works without it.
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 1) {
      gesture.current.mode = 'pan';
      gesture.current.moved = 0;
      gesture.current.panPointer = { x: event.clientX, y: event.clientY };
      gesture.current.panOffset = { ...offsetRef.current };
    } else if (pointers.current.size === 2) {
      const [first, second] = [...pointers.current.values()];
      gesture.current.mode = 'pinch';
      // A two-finger gesture never counts as a tap, even if it barely moves.
      gesture.current.moved = Number.POSITIVE_INFINITY;
      gesture.current.pinchDistance = distance(first, second) || 1;
      gesture.current.pinchScale = scaleRef.current;
      gesture.current.pinchOffset = { ...offsetRef.current };
      gesture.current.pinchMidpoint = midpoint(first, second);
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLImageElement>) => {
    if (!pointers.current.has(event.pointerId)) {
      return;
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const current = gesture.current;

    if (current.mode === 'pinch' && pointers.current.size >= 2) {
      const [first, second] = [...pointers.current.values()];
      const nextScale = clamp(
        current.pinchScale * (distance(first, second) / current.pinchDistance),
        MIN_SCALE,
        MAX_SCALE,
      );
      const mid = midpoint(first, second);
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      const ratio = nextScale / current.pinchScale;
      let x = (current.pinchMidpoint.x - centerX) * (1 - ratio) + current.pinchOffset.x * ratio;
      let y = (current.pinchMidpoint.y - centerY) * (1 - ratio) + current.pinchOffset.y * ratio;
      // Let the midpoint drift with the fingers so two-finger panning works.
      x += mid.x - current.pinchMidpoint.x;
      y += mid.y - current.pinchMidpoint.y;
      const nextOffset = nextScale <= 1 ? { x: 0, y: 0 } : clampOffset(nextScale, { x, y });
      applyTransform(nextScale, nextOffset);
      return;
    }

    if (current.mode === 'pan') {
      const point = pointers.current.get(event.pointerId);
      if (!point) {
        return;
      }
      const dx = point.x - current.panPointer.x;
      const dy = point.y - current.panPointer.y;
      current.moved = Math.max(current.moved, Math.hypot(dx, dy));
      if (scaleRef.current > 1) {
        applyTransform(
          scaleRef.current,
          clampOffset(scaleRef.current, { x: current.panOffset.x + dx, y: current.panOffset.y + dy }),
        );
      }
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLImageElement>) => {
    if (!pointers.current.delete(event.pointerId)) {
      return;
    }
    const current = gesture.current;

    // Dropping from two fingers to one continues as a pan, never a tap.
    if (pointers.current.size === 1) {
      const [remaining] = [...pointers.current.values()];
      current.mode = 'pan';
      current.moved = Number.POSITIVE_INFINITY;
      current.panPointer = { ...remaining };
      current.panOffset = { ...offsetRef.current };
      return;
    }

    if (pointers.current.size > 0) {
      return;
    }

    const wasTap = current.mode === 'pan' && current.moved < TAP_SLOP;
    current.mode = 'none';
    if (!wasTap) {
      return;
    }

    if (event.pointerType === 'mouse') {
      // Wait out the double-click window before acting on a single click, so a
      // double-click can zoom instead of closing.
      const now = Date.now();
      if (now - lastTapAt.current < DOUBLE_TAP_WINDOW) {
        lastTapAt.current = 0;
        if (scaleRef.current > 1) {
          resetZoom();
        } else {
          zoomAt(DOUBLE_TAP_SCALE, { x: event.clientX, y: event.clientY }, true);
        }
        return;
      }
      lastTapAt.current = now;
      if (tapTimer.current !== null) {
        window.clearTimeout(tapTimer.current);
      }
      tapTimer.current = window.setTimeout(() => {
        tapTimer.current = null;
        if (scaleRef.current > 1) {
          resetZoom();
        } else {
          onClose();
        }
      }, SINGLE_TAP_DELAY);
      return;
    }

    // Touch and pen act immediately: pinch is the primary zoom gesture there,
    // so a tap does not need to wait for a double-tap.
    if (scaleRef.current > 1) {
      resetZoom();
    } else {
      onClose();
    }
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLImageElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) {
      gesture.current.mode = 'none';
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex touch-none items-center justify-center overflow-hidden bg-overlay/80 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t('chat:misc.closeImagePreview')}
        className="absolute right-4 top-4 z-20 rounded-full bg-n-white/10 p-2 text-n-white transition-colors hover:bg-n-white/20"
      >
        <X className="h-5 w-5" />
      </button>
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        draggable={false}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onTransitionEnd={() => setAnimate(false)}
        className="max-h-[90vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
        style={{
          transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
          transformOrigin: 'center center',
          transition: animate ? 'transform 200ms cubic-bezier(0.2, 0, 0.2, 1)' : 'none',
          touchAction: 'none',
          cursor: scale > 1 ? 'grab' : 'zoom-in',
          willChange: 'transform',
        }}
      />
    </div>,
    document.body,
  );
}

function ChatMessageImage({ image, projectId }: { image: ChatImage; projectId?: string | null }) {
  const { t } = useTranslation();
  const { src, failed } = useChatImageSrc(image, projectId);
  const isExporting = useIsExportingTranscript();
  const [expanded, setExpanded] = useState(false);
  const alt = image.name || 'Attached image';

  if (!src) {
    // A document has no effect loop, so a path the exporter could not read
    // would pulse forever. The name is the honest fallback: it still tells the
    // reader what was attached. The live view keeps the spinner until a load
    // actually fails.
    if (failed || isExporting) {
      return (
        <div className="flex h-28 w-28 items-center justify-center rounded-xl border border-border/50 bg-muted px-2 text-center text-[10px] text-muted-foreground">
          {alt}
        </div>
      );
    }
    return <div className="h-28 w-28 animate-pulse rounded-xl border border-border/50 bg-muted" />;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label={t('chat:misc.expandImage', { name: alt })}
        className="block overflow-hidden rounded-xl border border-border/50 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/60"
      >
        <img
          src={src}
          alt={alt}
          className="h-28 w-28 cursor-zoom-in object-cover transition-transform duration-200 hover:scale-105"
        />
      </button>
      {expanded && <ImageLightbox src={src} alt={alt} onClose={() => setExpanded(false)} />}
    </>
  );
}

/**
 * Image attachments for a user turn, rendered claude.ai-style: standalone
 * rounded square cards shown above the message bubble. Each thumbnail
 * expands to a fullscreen lightbox on click.
 *
 * Rendered by chat's MessageComponent for the images attached to a user turn.
 */
export default function ChatMessageImages({ images, projectId }: ChatMessageImagesProps) {
  if (!images || images.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {images.map((image, index) => (
        <ChatMessageImage key={image.path || image.name || index} image={image} projectId={projectId} />
      ))}
    </div>
  );
}
