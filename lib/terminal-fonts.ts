import { existsSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import path from "path";

export interface TerminalFontFace {
  cssFamily: string;
  sourceFamily: string;
  url: string;
  weight: number;
  style: "normal" | "italic";
}

const FONT_EXTENSIONS = new Set([".ttf", ".otf", ".ttc", ".otc"]);

function fontDirs(): string[] {
  const home = homedir();
  const dirs = [
    path.join(home, "Library", "Fonts"),
    "/Library/Fonts",
    "/System/Library/Fonts",
    path.join(home, ".local", "share", "fonts"),
    path.join(home, ".fonts"),
  ];
  return [...new Set(dirs)].filter((dir) => existsSync(dir));
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function listFontFiles(): string[] {
  const out: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > 3) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        visit(full, depth + 1);
      } else if (stat.isFile() && FONT_EXTENSIONS.has(path.extname(entry).toLowerCase())) {
        out.push(full);
      }
    }
  };

  for (const dir of fontDirs()) visit(dir, 0);
  return out;
}

function scoreFontFile(filePath: string, family: string, weight: number, style: "normal" | "italic"): number {
  const base = path.basename(filePath, path.extname(filePath));
  const normalizedBase = normalizeName(base);
  const normalizedFamily = normalizeName(family);
  if (!normalizedBase.includes(normalizedFamily)) return -1;

  const wantsBold = weight >= 600;
  const hasBold = /bold/i.test(base);
  const hasSemiBold = /semibold/i.test(base);
  const hasMedium = /medium/i.test(base);
  const hasLight = /light/i.test(base);
  const hasItalic = /italic/i.test(base);
  const hasRegular = /regular/i.test(base);

  let score = 100;
  if (style === "italic") score += hasItalic ? 35 : -25;
  else score += hasItalic ? -25 : 10;

  if (wantsBold) {
    if (hasBold) score += 35;
    else if (hasSemiBold || hasMedium) score += 10;
    else if (hasRegular) score -= 8;
    if (hasLight) score -= 25;
  } else {
    if (hasRegular) score += 25;
    if (hasBold || hasSemiBold || hasMedium || hasLight) score -= 15;
  }

  if (/mono/i.test(base) && /mono/i.test(family)) score += 15;
  if (/nerd/i.test(base)) score += 10;
  if (/retina/i.test(base)) score -= 8;
  if (/propo/i.test(base) && !/propo/i.test(family)) score -= 30;
  return score;
}

export function findTerminalFontFile(family: string, weight = 400, style: "normal" | "italic" = "normal"): string | null {
  let best: { file: string; score: number } | null = null;
  for (const file of listFontFiles()) {
    const score = scoreFontFile(file, family, weight, style);
    if (score < 0) continue;
    if (!best || score > best.score) best = { file, score };
  }
  return best?.file ?? null;
}

function configuredFamilies(families: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const family of families) {
    const trimmed = family.trim();
    if (!trimmed) continue;
    const key = normalizeName(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function buildTerminalFontFaces(families: string[]): TerminalFontFace[] {
  const faces: TerminalFontFace[] = [];
  configuredFamilies(families).forEach((family, index) => {
    const variants: Array<{ weight: number; style: "normal" | "italic" }> = [
      { weight: 400, style: "normal" },
      { weight: 700, style: "normal" },
      { weight: 400, style: "italic" },
      { weight: 700, style: "italic" },
    ];

    const emitted = new Set<string>();
    for (const variant of variants) {
      const fontFile = findTerminalFontFile(family, variant.weight, variant.style);
      if (!fontFile) continue;
      const dedupe = `${fontFile}:${variant.weight}:${variant.style}`;
      if (emitted.has(dedupe)) continue;
      emitted.add(dedupe);
      faces.push({
        cssFamily: `PiGhosttyFont${index}`,
        sourceFamily: family,
        url: `/api/terminal/font?family=${encodeURIComponent(family)}&weight=${variant.weight}&style=${variant.style}`,
        weight: variant.weight,
        style: variant.style,
      });
    }
  });
  return faces;
}

export function fontContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".ttf" || ext === ".ttc") return "font/ttf";
  if (ext === ".otf" || ext === ".otc") return "font/otf";
  return "application/octet-stream";
}
