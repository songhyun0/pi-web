import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { findTerminalFontFile, fontContentType } from "@/lib/terminal-fonts";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const family = new URL(req.url).searchParams.get("family")?.trim();
  if (!family) return NextResponse.json({ error: "family is required" }, { status: 400 });

  const weightRaw = Number.parseInt(new URL(req.url).searchParams.get("weight") || "400", 10);
  const weight = Number.isFinite(weightRaw) ? weightRaw : 400;
  const style = new URL(req.url).searchParams.get("style") === "italic" ? "italic" : "normal";

  const fontPath = findTerminalFontFile(family, weight, style);
  if (!fontPath) return NextResponse.json({ error: "font not found" }, { status: 404 });

  const bytes = await readFile(fontPath);
  return new Response(bytes, {
    headers: {
      "Content-Type": fontContentType(fontPath),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
