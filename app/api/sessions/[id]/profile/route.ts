import { NextResponse } from "next/server";
import {
  getSessionProfileApiResultSerialized,
  switchExistingSessionProfileApiResult,
} from "@/lib/existing-session-profile-application";
import { resolveSessionPath } from "@/lib/session-reader";

function jsonResult(result: { status: number; body: unknown }): NextResponse {
  return NextResponse.json(result.body, { status: result.status });
}


export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    return jsonResult(await getSessionProfileApiResultSerialized(id, { resolveSessionPath }));
  } catch (error) {
    const status = typeof (error as { statusCode?: unknown }).statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : 500;
    const diagnostics = (error as { diagnostics?: unknown }).diagnostics;
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      ...(diagnostics ? { diagnostics } : {}),
    }, { status });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({})) as { profileRef?: unknown };
    return jsonResult(await switchExistingSessionProfileApiResult(id, body, { resolveSessionPath }));
  } catch (error) {
    const status = typeof (error as { statusCode?: unknown }).statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : 500;
    const diagnostics = (error as { diagnostics?: unknown }).diagnostics;
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      ...(diagnostics ? { diagnostics } : {}),
    }, { status });
  }
}
