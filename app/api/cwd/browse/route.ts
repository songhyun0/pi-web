import { NextResponse } from "next/server";
import fs from "fs";
import { homedir } from "os";
import path from "path";
import { normalizeCwd } from "@/lib/cwd";

export const runtime = "nodejs";

interface DirectoryEntry {
  name: string;
  path: string;
  modified: string;
}

const MAX_DIRECTORY_ENTRIES = 1000;

function safeNormalize(rawPath: string | null): string {
  const candidate = rawPath?.trim() || homedir();
  return normalizeCwd(candidate);
}

function readDirectoryEntries(cwd: string): DirectoryEntry[] {
  const names = fs.readdirSync(cwd);
  const entries: DirectoryEntry[] = [];

  for (const name of names) {
    const fullPath = path.join(cwd, name);
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isDirectory()) continue;
      entries.push({
        name,
        path: fullPath,
        modified: stat.mtime.toISOString(),
      });
    } catch {
      // Ignore directories the current process cannot stat.
    }
  }

  return entries
    .sort((a, b) => {
      const aHidden = a.name.startsWith(".");
      const bHidden = b.name.startsWith(".");
      if (aHidden !== bHidden) return aHidden ? 1 : -1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, MAX_DIRECTORY_ENTRIES);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const cwd = safeNormalize(url.searchParams.get("cwd"));

    let stat: fs.Stats;
    try {
      stat = fs.statSync(cwd);
    } catch {
      return NextResponse.json({ error: `Directory does not exist: ${cwd}` }, { status: 404 });
    }

    if (!stat.isDirectory()) {
      return NextResponse.json({ error: `Path is not a directory: ${cwd}` }, { status: 400 });
    }

    const parent = path.dirname(cwd);
    const root = path.parse(cwd).root;

    return NextResponse.json({
      cwd,
      parent: cwd === root || parent === cwd ? null : parent,
      entries: readDirectoryEntries(cwd),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
