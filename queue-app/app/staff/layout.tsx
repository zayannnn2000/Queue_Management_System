import { AppShell } from "@/components/app-shell";

export default function StaffLayout({ children }: LayoutProps<"/staff">) {
  return <AppShell>{children}</AppShell>;
}
