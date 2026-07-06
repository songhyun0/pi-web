import { NextResponse } from "next/server";
import { getGitChanges } from "@/lib/git-changes";
import { getAllowedFileRoots, isFilePathAllowed } from "@/lib/file-access";

async function checkCwdAllowed(cwd: string): Promise<NextResponse | null> {
  const allowedRoots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, allowedRoots)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  return null;
}

export async function GET(req: Request) {
  try {
    const cwd = new URL(req.url).searchParams.get("cwd");
    if (!cwd) return NextResponse.json({ error: "cwd is required" }, { status: 400 });

    const denied = await checkCwdAllowed(cwd);
    if (denied) return denied;

    const changes = await getGitChanges(cwd);
    return NextResponse.json(changes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
