"use client";
import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { ModuleId } from "../../lib/v8/module-workspace";

/** A real pointer-following card, including its image, rather than a browser drag thumbnail. */
export function useModuleDrag(
  onDrop: (id: ModuleId) => void,
  onHover: (active: boolean) => void,
) {
  const cleanupRef = useRef<(() => void) | null>(null);
  const draggedRef = useRef<ModuleId | null>(null);
  const dropRef = useRef(onDrop);
  const hoverRef = useRef(onHover);
  dropRef.current = onDrop;
  hoverRef.current = onHover;
  useEffect(() => () => cleanupRef.current?.(), []);
  const start = (event: ReactPointerEvent<HTMLElement>, module: ModuleId) => {
    draggedRef.current = null;
    const target = event.target as HTMLElement;
    if (
      event.button !== 0 ||
      (target.closest("button,a,input") &&
        !target.closest(".mx-module-surface"))
    )
      return;
    // Cards remain tappable on touch screens without taking over vertical scrolling.
    if (event.pointerType === "touch") return;
    cleanupRef.current?.();
    const card = event.currentTarget;
    const bounds = card.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY };
    const offset = { x: start.x - bounds.left, y: start.y - bounds.top };
    const pointerId = event.pointerId;
    let ghost: HTMLElement | null = null;
    let over = false;
    const composer = document.querySelector<HTMLElement>(".mx-composer");
    const cleanup = () => {
      ghost?.remove();
      card.classList.remove("mx-drag-source");
      document.body.classList.remove("mx-is-dragging");
      hoverRef.current(false);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("blur", cancel);
      if (card.hasPointerCapture(pointerId))
        card.releasePointerCapture(pointerId);
      cleanupRef.current = null;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (!ghost && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 7)
        return;
      e.preventDefault();
      if (!ghost) {
        draggedRef.current = module;
        card.setPointerCapture(pointerId);
        ghost = card.cloneNode(true) as HTMLElement;
        ghost.classList.add("mx-drag-ghost");
        ghost.classList.remove("mx-drag-source");
        ghost.setAttribute("aria-hidden", "true");
        ghost.inert = true;
        ghost
          .querySelectorAll("[id]")
          .forEach((el) => el.removeAttribute("id"));
        Object.assign(ghost.style, {
          position: "fixed",
          left: "0",
          top: "0",
          width: `${bounds.width}px`,
          height: `${bounds.height}px`,
          margin: "0",
          pointerEvents: "none",
          zIndex: "1000",
          transition: "none",
        });
        const originals = card.querySelectorAll("canvas");
        ghost.querySelectorAll("canvas").forEach((canvas, index) => {
          const original = originals[index];
          canvas.width = original.width;
          canvas.height = original.height;
          canvas.getContext("2d")?.drawImage(original, 0, 0);
        });
        card.closest(".mx-workspace")!.appendChild(ghost);
        card.classList.add("mx-drag-source");
        document.body.classList.add("mx-is-dragging");
      }
      ghost.style.transform = `translate3d(${e.clientX - offset.x}px,${e.clientY - offset.y}px,0) scale(1.015)`;
      const rect = composer?.getBoundingClientRect();
      over = Boolean(
        rect &&
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom,
      );
      hoverRef.current(over);
      if (e.clientY > innerHeight - 65) window.scrollBy(0, 10);
      if (e.clientY < 65) window.scrollBy(0, -10);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const commit = ghost && over;
      cleanup();
      if (commit) dropRef.current(module);
    };
    const cancel = () => cleanup();
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") cleanup();
    };
    cleanupRef.current = cleanup;
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("keydown", escape);
    window.addEventListener("blur", cancel);
  };
  const captureClick = (
    event: ReactMouseEvent<HTMLElement>,
    module: ModuleId,
  ) => {
    // The release click of a completed/cancelled drag must not toggle selection again.
    if (draggedRef.current === module && event.detail !== 0) {
      event.preventDefault();
      event.stopPropagation();
    }
    draggedRef.current = null;
  };
  return { start, captureClick };
}
