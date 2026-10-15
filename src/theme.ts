import type { Theme } from "./a11y";

export type RGB = [number, number, number];

/** Colors for things drawn in JS (canvas city, SVG pins, charts). CSS tokens in styles.css mirror these. */
export interface Pal {
  dark: boolean;
  red: string; amber: string; green: string; teal: string; accent: string; vol: string; volOff: string; onCol: string;
  heat: [string, string]; heatBlend: "screen" | "multiply";
  city: City;
  chart: { grid: string; axis: string; muted: string; pink: string };
}
export interface City {
  night: boolean;
  slabTop: string; slabRing: string; slabSide: [string, string]; strata: string; dropShadow: string;
  park: string; parkEdge: string; water: string; waterEdge: string;
  walk: string; road: [string, string, string, string]; lane: string; laneAlpha: number;
  roofs: string[]; roofEdge: string;
  walls: { lit: RGB; shade: RGB }[];
  win: string; winAlpha: number; neon: string[];
  shadow: string; shadowAlpha: number;
  tree: [string, string]; trunk: string;
  label: string; halo: string;
  cars: string[]; lamp: string | null;
}

const LIGHT: Pal = {
  dark: false,
  red: "#dc2626", amber: "#d97706", green: "#16a34a", teal: "#0d9488", accent: "#7c3aed", vol: "#db2777", volOff: "#a8a29e", onCol: "#ffffff",
  heat: ["#f59e0b", "#ef4444"], heatBlend: "multiply",
  city: {
    night: false,
    slabTop: "#ebede1", slabRing: "#7c3aed", slabSide: ["#dccbae", "#b39c79"], strata: "rgba(120,92,52,.25)", dropShadow: "rgba(60,45,30,.26)",
    park: "#bfe0a9", parkEdge: "#97c97c", water: "#b3dde2", waterEdge: "#84c3cb",
    walk: "#fbf9f5", road: ["#a9a49b", "#b6b1a8", "#c5c0b8", "#d7d2ca"], lane: "#ffffff", laneAlpha: 0.9,
    roofs: ["#ffffff", "#f8f6f2", "#f3f0ea", "#f8efe5"], roofEdge: "rgba(120,108,92,.35)",
    walls: [{ lit: [243, 240, 234], shade: [186, 177, 166] }, { lit: [232, 229, 240], shade: [168, 161, 186] }, { lit: [246, 227, 211], shade: [198, 160, 134] }],
    win: "#6f6658", winAlpha: 0.3, neon: [],
    shadow: "#4a3a2c", shadowAlpha: 0.2,
    tree: ["#6dbb5c", "#4f9c48"], trunk: "#8a6a4a",
    label: "#57534e", halo: "rgba(255,255,255,.92)",
    cars: ["#ef4444", "#7c3aed", "#f59e0b", "#ffffff", "#0f766e"], lamp: null,
  },
  chart: { grid: "#e7e5e4", axis: "#78716c", muted: "#a8a29e", pink: "#db2777" },
};

const DARK: Pal = {
  dark: true,
  red: "#ff5d6c", amber: "#ffb43f", green: "#34e3a0", teal: "#2dd4bf", accent: "#a78bfa", vol: "#f472b6", volOff: "#6b6475", onCol: "#1a1033",
  heat: ["#ff9a2e", "#ff3b4e"], heatBlend: "screen",
  city: {
    night: true,
    slabTop: "#1c1a20", slabRing: "#a78bfa", slabSide: ["#25212b", "#0e0d11"], strata: "rgba(167,139,250,.16)", dropShadow: "rgba(0,0,0,.6)",
    park: "#1c3a2a", parkEdge: "#2f6b4a", water: "#15313f", waterEdge: "#2b6170",
    walk: "#2a2730", road: ["#111014", "#141317", "#18161c", "#201e25"], lane: "#ffcf8a", laneAlpha: 0.35,
    roofs: ["#37323f", "#322d3a", "#3c3646"], roofEdge: "rgba(210,195,245,.22)",
    walls: [{ lit: [64, 58, 72], shade: [32, 29, 38] }, { lit: [58, 52, 78], shade: [29, 26, 42] }, { lit: [76, 60, 58], shade: [38, 30, 30] }],
    win: "#ffd27a", winAlpha: 0.6, neon: ["#ffb43f", "#c4b5fd", "#f472b6", "#34e3a0"],
    shadow: "#000000", shadowAlpha: 0.35,
    tree: ["#2f7a52", "#1f5a3c"], trunk: "#4a3a2c",
    label: "#ffcf9a", halo: "rgba(14,13,16,.85)",
    cars: ["#ffd23f", "#c4b5fd", "#ffffff", "#ff7a8a"], lamp: "#ffcf7a",
  },
  chart: { grid: "rgba(210,195,245,.12)", axis: "#9a94a3", muted: "#8a8494", pink: "#f472b6" },
};

export const palette = (t: Theme): Pal => (t === "dark" ? DARK : LIGHT);

export const tooltipStyle = {
  contentStyle: { background: "var(--card)", border: "1px solid var(--line-2)", borderRadius: 10, color: "var(--ink)", fontSize: 12, boxShadow: "var(--shadow-md)" },
  labelStyle: { color: "var(--ink-2)" },
};
