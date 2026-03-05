import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { ReactNode } from "react";
import { LandingHeader } from "@/components/landing/header";
import { baseOptions } from "@/lib/layout.shared";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <HomeLayout
      {...baseOptions()}
      nav={{
        component: <LandingHeader />,
      }}
    >
      {children}
    </HomeLayout>
  );
}
