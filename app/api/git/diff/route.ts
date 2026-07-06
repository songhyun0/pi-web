import { NextResponse } from "next/server";
import { getGitDiff } from "@/lib/git-changes";
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
    const url = new URL(req.url);
    const cwd = url.searchParams.get("cwd");
    const filePath = url.searchParams.get("path");
    if (!cwd) return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    if (!filePath) return NextResponse.json({ error: "path is required" }, { status: 400 });

    const denied = await checkCwdAllowed(cwd);
    if (denied) return denied;

    const result = await getGitDiff(cwd, filePath);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const tooLarge = /stdout maxBuffer length exceeded|maxBuffer/i.test(message);
    return NextResponse.json({ error: tooLarge ? "Diff is too large to display" : message }, { status: tooLarge ? 413 : 500 });
  }
}
