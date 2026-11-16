"use client";

import { createContext, useContext } from "react";
import type { Project } from "./types";

export const ModuleWorkspaceContext = createContext<{
  projectIds: string[] | null;
  scopeLabel: string;
  simulationAvailable: boolean;
  openWorkspace: () => void;
  onDesignCreated: (project: Project) => void;
  openSimulation: (project: Project, packageKey: string) => Promise<void>;
} | null>(null);

export const useModuleWorkspace = () => useContext(ModuleWorkspaceContext);
