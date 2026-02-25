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
        <>
          <Image src="/logo.svg" alt="OCPP WS IO" width={28} height={28} />
          <span style={{ fontWeight: 700 }}>OCPP WS IO</span>
        </>
      ),
    },
    links: [
      {
        text: "Home",
        url: "/",
        active: "nested-url",
      },
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
