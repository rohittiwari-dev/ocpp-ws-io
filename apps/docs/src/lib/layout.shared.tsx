import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

// fill this with your actual GitHub info, for example:
export const gitConfig = {
  user: "rohittiwari-dev",
  repo: "ocpp-ws-io",
  branch: "main",
};

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: "OCPP WS IO",
    },
    links: [
      {
        text: "Documentation",
        url: "/docs",
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
