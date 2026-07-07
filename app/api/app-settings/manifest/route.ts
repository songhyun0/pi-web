import { NextResponse } from "next/server";
import { readAppSettings } from "@/lib/app-settings-store";

export const dynamic = "force-dynamic";

function toShortName(name: string): string {
  return name.length > 24 ? `${name.slice(0, 23)}…` : name;
}

export async function GET() {
  const displayName = readAppSettings().displayName;

  return NextResponse.json({
    name: displayName,
    short_name: toShortName(displayName),
    description: "Pi Coding Agent Web Interface",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#23454B",
    theme_color: "#23454B",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any maskable",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
  }, {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
