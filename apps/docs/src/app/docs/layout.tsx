import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";

export default function Layout({ children }: LayoutProps<"/docs">) {
  const { ...options } = baseOptions();
  return (
    <DocsLayout
      {...options}
      tree={source.getPageTree()}
      sidebar={{
        enabled: true,
        collapsible: true,
      }}
      githubUrl="https://github.com/rohittiwari-dev/ocpp-ws-io"
    >
      {children}
    </DocsLayout>
  );
}
