"use client";

import { useId } from "react";
import {
  parseRequirementBrief,
  REQUIREMENT_BRIEF_FIELDS,
  serializeRequirementsPurpose,
  serializeRequirementsConstraints,
  type RequirementBrief,
} from "../../lib/v8/requirements-brief";
import "./RequirementsBrief.css";

export default function RequirementsBrief({
  purpose,
  constraints,
  onPurposeChange,
  onConstraintsChange,
}: {
  purpose: string;
  constraints: string;
  onPurposeChange: (value: string) => void;
  onConstraintsChange: (value: string) => void;
}) {
  const id = useId();
  const brief = parseRequirementBrief(purpose, constraints);
  const change = (key: keyof RequirementBrief, value: string) => {
    const next = { ...brief, [key]: value };
    if (
      key === "purposeNotes" ||
      REQUIREMENT_BRIEF_FIELDS.some(
        (field) => field.key === key && field.group === "purpose",
      )
    )
      onPurposeChange(serializeRequirementsPurpose(next));
    else onConstraintsChange(serializeRequirementsConstraints(next));
  };
  const groups = [
    { title: "任务与场景", keys: ["task", "site", "payload"], open: true },
    {
      title: "运行与安全",
      keys: ["workspace", "performance", "environment", "safety"],
      open: false,
    },
    { title: "对接与验收", keys: ["integration", "acceptance"], open: false },
  ];
  return (
    <div className="vrequirement-brief">
      {groups.map((group) => (
        <details
          key={group.title}
          open={group.open}
          className="vrequirement-group"
        >
          <summary>
            {group.title}
            <span>
              {
                group.keys.filter((key) =>
                  brief[key as keyof RequirementBrief].trim(),
                ).length
              }
              /{group.keys.length}
            </span>
          </summary>
          <div className="vrequirement-fields">
            {REQUIREMENT_BRIEF_FIELDS.filter((field) =>
              group.keys.includes(field.key),
            ).map((field) => (
              <label key={field.key} htmlFor={`${id}-${field.key}`}>
                <span>{field.label}</span>
                <textarea
                  id={`${id}-${field.key}`}
                  aria-label={field.label}
                  rows={2}
                  value={brief[field.key]}
                  onChange={(event) => change(field.key, event.target.value)}
                  placeholder={field.placeholder}
                />
              </label>
            ))}
          </div>
        </details>
      ))}
      <details
        className="vrequirement-group vrequirement-notes"
        open={Boolean(brief.purposeNotes || brief.constraintNotes)}
      >
        <summary>
          补充说明<span>选填</span>
        </summary>
        <div className="vrequirement-fields">
          <label htmlFor={`${id}-purpose-notes`}>
            <span>其他用途说明</span>
            <textarea
              id={`${id}-purpose-notes`}
              aria-label="其他用途说明"
              rows={2}
              value={brief.purposeNotes}
              onChange={(event) => change("purposeNotes", event.target.value)}
              placeholder="其他任务背景或使用方式"
            />
          </label>
          <label htmlFor={`${id}-constraint-notes`}>
            <span>其他约束说明</span>
            <textarea
              id={`${id}-constraint-notes`}
              aria-label="其他约束说明"
              rows={2}
              value={brief.constraintNotes}
              onChange={(event) =>
                change("constraintNotes", event.target.value)
              }
              placeholder="其他限制、偏好或待确认条件"
            />
          </label>
        </div>
      </details>
    </div>
  );
}
