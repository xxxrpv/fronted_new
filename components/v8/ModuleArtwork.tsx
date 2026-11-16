"use client";
import CinematicArtwork from "./CinematicArtwork";
import type { ModuleId } from "../../lib/v8/module-workspace";
export default function ModuleArtwork({
  module,
  priority = false,
}: {
  module: ModuleId;
  priority?: boolean;
}) {
  return <CinematicArtwork module={module} priority={priority} />;
}
