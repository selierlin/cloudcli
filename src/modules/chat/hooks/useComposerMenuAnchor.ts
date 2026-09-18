import { useCallback, useEffect, useRef, useState } from 'react';

import type { ComposerMenuAnchor } from '@/shared/types';


const VIEWPORT_MARGIN = 8;
/** Inset from both edges of the phone sheet, matching the slash-command menu's own margin at that width. */
const SHEET_MARGIN = 16;
/** Fraction of the viewport height the phone sheet may cover, so the transcript stays readable behind it — the same share the slash-command menu takes. */
const SHEET_MAX_HEIGHT_RATIO = 0.54;
const MENU_GAP = 8;

/**
 * Positions a composer popover above its trigger, pinned to whichever edge
 * gives it its preferred width.
 *
 * Using an edge offset rather than a measured `left` lets the menu grow away
 * from that edge without measuring itself first, so it never paints in the wrong
 * spot for a frame. Pinning right suits the composer's right-hand tool cluster;
 * the left-hand cluster, where phones put the quick reply button, has room for
 * neither, so those menus stretch to both viewport margins — the sheet the
 * slash-command menu opens on a phone, and the only placement that gives them
 * the whole screen width instead of a clipped column beside the trigger.
 */
export function useComposerMenuAnchor(
  isOpen: boolean,
  onClose: () => void,
  preferredWidth = 320,
) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<ComposerMenuAnchor | null>(null);

  const updateAnchor = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const rightOffset = Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.right);
    const leftOffset = Math.max(VIEWPORT_MARGIN, rect.left);
    // Both anchors leave the same free span between the two viewport margins;
    // they just consume it from opposite ends.
    const roomPinnedRight = window.innerWidth - rightOffset - VIEWPORT_MARGIN;
    const roomPinnedLeft = window.innerWidth - leftOffset - VIEWPORT_MARGIN;

    const maxHeightAboveTrigger = rect.top - MENU_GAP - VIEWPORT_MARGIN;

    let side: ComposerMenuAnchor['side'];
    let offset: number;
    let maxHeight = Math.max(160, maxHeightAboveTrigger);
    let maxWidth: number;
    if (roomPinnedRight >= preferredWidth) {
      // The right-hand cluster's placement, and the historical one, so it wins
      // whenever it fits.
      side = 'right';
      offset = rightOffset;
      maxWidth = preferredWidth;
    } else if (roomPinnedLeft >= preferredWidth) {
      // Its mirror, for a trigger that leaves the room on its right instead.
      side = 'left';
      offset = leftOffset;
      maxWidth = preferredWidth;
    } else {
      // No room beside the trigger either way, which is a phone's left-hand
      // cluster: the last button ends about a third of the way across, leaving
      // less than the preferred width on both sides. Stretching to both viewport
      // margins buys it the whole screen width, and caps it at the same span so
      // it cannot run off either edge. `maxWidth` is deliberately unfloored: the
      // 200px floor this used to carry overrode the clamp exactly when the clamp
      // mattered, running the menu off-screen instead of shrinking.
      side = 'both';
      offset = SHEET_MARGIN;
      // A sheet this wide reads as a modal, so it takes a share of the screen
      // rather than every pixel above the composer: these lists run to fifteen
      // rows, and covering the transcript would hide the conversation the
      // snippet is being picked for.
      maxHeight = Math.max(
        160,
        Math.min(maxHeightAboveTrigger, window.innerHeight * SHEET_MAX_HEIGHT_RATIO),
      );
      maxWidth = window.innerWidth - SHEET_MARGIN * 2;
    }

    setAnchor({
      side,
      offset,
      bottom: window.innerHeight - rect.top + MENU_GAP,
      maxHeight,
      maxWidth,
    });
  }, [preferredWidth]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        onClose();
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onClose();
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', updateAnchor);
    window.addEventListener('scroll', updateAnchor, true);
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    updateAnchor();

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', updateAnchor);
      window.removeEventListener('scroll', updateAnchor, true);
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [isOpen, onClose, updateAnchor]);

  return { triggerRef, menuRef, anchor, updateAnchor };
}
