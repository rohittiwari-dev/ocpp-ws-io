import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import Image from "next/image";

// fill this with your actual GitHub info, for example:
export const gitConfig = {
  user: "rohittiwari-dev",
  repo: "ocpp-ws-io",
  branch: "main",
};

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-2 group">
          <Image
            src="/logo.svg"
            alt="OCPP WS IO"
            width={28}
            height={28}
            className="transition-transform group-hover:scale-105"
          />
          <span className="font-bold tracking-tight text-fd-foreground">
            ocpp-ws-io
          </span>
        </span>
      ),
    },
    links: [
      {
        text: "Documentation",
        url: "/docs",
        active: "nested-url",
      },
      {
        text: "Packages",
        url: "/docs/packages",
        active: "nested-url",
      },
      {
        text: "Simulator",
        url: "https://ocpp.rohittiwari.me",
        active: "nested-url",
      },
      {
        text: "Blog",
        url: "/blog",
        active: "nested-url",
      },
    ],
    githubUrl: `https://github.com/rohittiwari-dev/ocpp-ws-io`,
  };
}
