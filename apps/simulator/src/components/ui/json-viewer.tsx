"use client";

import { useState } from "react";

interface JsonViewerProps {
  data: unknown;
  level?: number;
  isLast?: boolean;
}

/* ── Syntax color tokens ── */
const colors = {
  key: "text-indigo-300",
  string: "text-emerald-400",
  number: "text-amber-400",
  boolean: "text-sky-400",
  null: "text-slate-500",
  brace: "text-slate-400",
  comma: "text-slate-600",
  dots: "text-slate-500",
  count: "text-slate-600",
  guide: "border-white/6",
} as const;

export function JsonViewer({
  data,
  level = 0,
  isLast = true,
}: JsonViewerProps) {
  const [expanded, setExpanded] = useState(level < 2);

  const isObject = data !== null && typeof data === "object";
  const isArray = Array.isArray(data);
  const isEmpty = isObject && Object.keys(data as object).length === 0;
  const comma = isLast ? "" : ",";

  /* ─── Primitives ─── */
  if (!isObject) {
    let cls: string = colors.string;
    if (typeof data === "number") cls = colors.number;
    else if (typeof data === "boolean") cls = colors.boolean;
    else if (data === null || data === undefined) cls = colors.null;

    const display: string =
      typeof data === "string"
        ? `"${data}"`
        : data === null
          ? "null"
          : String(data);

    return (
      <span className={`${cls} font-mono`}>
        {display}
        <span className={colors.comma}>{comma}</span>
      </span>
    );
  }

  /* ─── Empty objects / arrays ─── */
  if (isEmpty) {
    return (
      <span className={`${colors.brace} font-mono`}>
        {isArray ? "[ ]" : "{ }"}
        <span className={colors.comma}>{comma}</span>
      </span>
    );
  }

  const entries = Object.keys(data as object);
  const open = isArray ? "[" : "{";
  const close = isArray ? "]" : "}";

  return (
    <div className="font-mono text-[11px] leading-[1.7]">
      {/* ── Toggle line: ▸ { ... } 5 items ── */}
      <span
        className="inline-flex items-center cursor-pointer hover:bg-white/5 rounded -ml-0.5 px-0.5 transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded(!expanded);
        }}
      >
        {/* Triangle toggle — perfectly aligned with text baseline */}
        <span
          className={`inline-flex items-center justify-center w-4 h-4 ${colors.dots} select-none`}
        >
          {expanded ? "▾" : "▸"}
        </span>

        <span className={colors.brace}>{open}</span>

        {!expanded && (
          <>
            <span className={`${colors.dots} mx-0.5`}>…</span>
            <span className={colors.brace}>
              {close}
              <span className={colors.comma}>{comma}</span>
            </span>
            <span className={`${colors.count} text-[9px] ml-1.5 italic`}>
              {entries.length} {entries.length === 1 ? "item" : "items"}
            </span>
          </>
        )}
      </span>

      {/* ── Expanded children ── */}
      {expanded && (
        <div className={`ml-4 pl-3 border-l ${colors.guide}`}>
          {entries.map((key, i) => {
            const val = (data as Record<string, unknown>)[key];
            const last = i === entries.length - 1;

            return (
              <div key={key} className="flex">
                {/* Key (objects only) */}
                {!isArray && (
                  <span className={`${colors.key} shrink-0 mr-1.5 select-text`}>
                    &quot;{key}&quot;
                    <span className={colors.brace}>:</span>{" "}
                  </span>
                )}

                {/* Value */}
                <span className="min-w-0 break-all">
                  <JsonViewer data={val} level={level + 1} isLast={last} />
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Close brace ── */}
      {expanded && (
        <span className={`${colors.brace} pl-4`}>
          {close}
          <span className={colors.comma}>{comma}</span>
        </span>
      )}
    </div>
  );
}
