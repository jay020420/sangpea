import type { Metadata } from "next";
import { PdpMakerClient } from "./PdpMakerClient";

export const metadata: Metadata = {
  title: "Codex PDP Maker",
  description: "Codex OAuth based local PDP generation and redesign tool",
  icons: {
    icon: "/pdp-maker/icon.svg",
    shortcut: "/pdp-maker/icon.svg"
  }
};

export default function PdpMakerPage() {
  return <PdpMakerClient />;
}
