import type { Metadata } from "next";

import { SettingsPanel } from "@/components/settings/SettingsPanel";

export const metadata: Metadata = {
  title: "Connection",
};

export default function SettingsPage() {
  return <SettingsPanel />;
}
