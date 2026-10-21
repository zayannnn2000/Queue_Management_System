// One colour per service category, used on the timeline, the room pills and the service filter.
// Each has a solid (bars, dots), a pale (fills) and an ink (text on pale, ≥ 4.5:1) value.
// A service stores only its colour key (lib/queue.ts SERVICE_COLOR_KEYS); the values live here.

import { type Settings, serviceColorKey } from "@/lib/queue";

export interface ServiceColor {
  solid: string;
  pale: string;
  ink: string;
}

const PALETTE: Record<string, ServiceColor> = {
  lilac: { solid: "#7656a6", pale: "#efe8fa", ink: "#4e3478" },
  teal: { solid: "#2f8f86", pale: "#e1f3f1", ink: "#1d5c56" },
  rose: { solid: "#c2456b", pale: "#fbe7ee", ink: "#8a2747" },
  amber: { solid: "#b7791f", pale: "#fbf0dc", ink: "#7a4f0f" },
  blue: { solid: "#3b6fb6", pale: "#e5eefa", ink: "#264b80" },
  green: { solid: "#4c8a3a", pale: "#e7f2e1", ink: "#2f5a22" },
  coral: { solid: "#d0643f", pale: "#fbe9e1", ink: "#8f3c1f" },
  plum: { solid: "#9a4a8c", pale: "#f6e6f2", ink: "#6a2c5f" },
  olive: { solid: "#7f7a2a", pale: "#f1f0dc", ink: "#545018" },
  slate: { solid: "#615a6e", pale: "#efecf3", ink: "#3b3645" },
};

export function serviceColor(settings: Settings, serviceId: string): ServiceColor {
  return PALETTE[serviceColorKey(settings.services.find((s) => s.id === serviceId))] ?? PALETTE.slate;
}
