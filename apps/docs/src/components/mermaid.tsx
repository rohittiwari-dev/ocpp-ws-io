"use client";

import mermaid from "mermaid";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

export function Mermaid({ chart }: { chart: string }) {
  const [svg, setSvg] = useState<string>("");
  const { theme, systemTheme } = useTheme();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const currentTheme = theme === "system" ? systemTheme : theme;
    mermaid.initialize({
      startOnLoad: false,
      theme: currentTheme === "dark" ? "dark" : "default",
      securityLevel: "loose",
    });

    const renderChart = async () => {
      try {
        const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
        const { svg } = await mermaid.render(id, chart);
        setSvg(svg);
      } catch (error) {
        console.error("Failed to render mermaid chart:", error);
      }
    };

    renderChart();
  }, [chart, theme, systemTheme]);

  return (
    <div
      ref={ref}
      className="flex justify-center p-4 my-4 bg-muted/50 rounded-lg overflow-x-auto"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: safe as we control the content
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
