"use client";
import { useEffect, useRef, useState } from "react";
import type { ModuleId } from "../../lib/v8/module-workspace";
import type { createShowcase } from "./showcase-engine";
import "./cinematic.css";
const prompt = "设计一套仓储机器人，完成巡检、搬运与设备操作。";
const machineNames = {
  quadruped: "四足机器人",
  mobile: "移动机器人",
  arm: "工业机械臂",
};
type Phase = {
  chapter: number;
  stage: string;
  machine: keyof typeof machineNames;
  progress: number;
};
type Engine = Awaited<ReturnType<typeof createShowcase>>;
/** Real model construction, articulated locomotion and scene assembly, rendered locally. */
export default function CinematicArtwork({
  module = "embodex",
  journey = false,
  priority = false,
}: {
  module?: ModuleId;
  journey?: boolean;
  priority?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>({
    chapter: 0,
    stage: "输入需求",
    machine: "quadruped",
    progress: 0,
  });
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let active = true;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(motion.matches);
    update();
    motion.addEventListener("change", update);
    let started = false;
    const start = () => {
      if (started || !active) return;
      started = true;
      void import("./showcase-engine")
        .then(async ({ createShowcase: create }) => {
          if (!active) return;
          const handle = await create(container, {
            module,
            journey,
            onReady: () => {
              if (active) setReady(true);
            },
            onPhase: (value) => {
              if (active) setPhase(value);
            },
          });
          if (!active) {
            handle.dispose();
            return;
          }
          engine.current = handle;
          await handle.ready;
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          start();
          observer.disconnect();
        }
      },
      { rootMargin: "160px" },
    );
    if (priority) start();
    else observer.observe(container);
    return () => {
      active = false;
      observer.disconnect();
      engine.current?.dispose();
      engine.current = null;
      motion.removeEventListener("change", update);
    };
  }, [module, journey, priority]);
  const typed = reduced
    ? prompt
    : prompt.slice(
        0,
        Math.min(
          prompt.length,
          Math.floor(phase.progress * prompt.length * 1.6),
        ),
      );
  return (
    <div
      className={`mx-art mx-cinematic ${journey ? "mx-journey" : ""}`}
      data-dynamic-module={journey ? "journey" : module}
      data-preview-ready={ready}
      data-motion-kind="articulated-3d"
      data-scene={phase.machine}
      data-phase={phase.stage}
    >
      <div
        ref={host}
        className="mx-three-host"
        role="img"
        aria-label={`${machineNames[phase.machine]} · ${phase.stage}`}
      />
      {!ready && (
        <div className="mx-cinematic-loading" role="status">
          {failed ? "三维演示未能载入" : "载入三维演示…"}
        </div>
      )}
      {journey ? (
        <>
          <div
            className={`mx-journey-prompt ${phase.chapter === 0 ? "visible" : ""}`}
            aria-hidden={phase.chapter !== 0}
          >
            <span className="mx-prompt-symbol" aria-hidden="true">
              ✦
            </span>
            <p>
              {typed || "　"}
              <i />
            </p>
            <span className="mx-prompt-send" aria-hidden="true">
              ↑
            </span>
          </div>
          <div className="mx-journey-controls">
            <div className="mx-journey-dots" aria-label="演示阶段">
              {["需求输入", "机器人设计", "场景仿真", "真机部署"].map(
                (name, i) => (
                  <button
                    key={name}
                    type="button"
                    aria-label={name}
                    aria-current={phase.chapter === i ? "step" : undefined}
                    onClick={() => engine.current?.jump(i)}
                  >
                    <i />
                  </button>
                ),
              )}
            </div>
            <button
              type="button"
              className="mx-motion-toggle"
              aria-label={paused ? "播放动态演示" : "暂停动态演示"}
              onClick={() => {
                engine.current?.pause(!paused);
                setPaused(!paused);
              }}
            >
              {paused ? (
                <svg viewBox="0 0 20 20">
                  <path d="m7 4 9 6-9 6Z" />
                </svg>
              ) : (
                <svg viewBox="0 0 20 20">
                  <path d="M7 4v12M13 4v12" />
                </svg>
              )}
            </button>
          </div>
        </>
      ) : (
        <div className="mx-showcase-caption">
          <span>{machineNames[phase.machine]}</span>
          <strong>{phase.stage}</strong>
        </div>
      )}
    </div>
  );
}
