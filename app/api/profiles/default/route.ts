import { NextResponse } from "next/server";
import { patchDefaultProfileApiResult } from "@/lib/profile-store";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const statusCode = typeof error === "object" && error !== null && "statusCode" in error
    ? Number((error as { statusCode?: unknown }).statusCode)
    : 500;
  return NextResponse.json({ error: message }, { status: Number.isFinite(statusCode) ? statusCode : 500 });
}

function jsonResult(result: { status: number; body: unknown }) {
  return NextResponse.json(result.body, { status: result.status });
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    return jsonResult(await patchDefaultProfileApiResult(body));
  } catch (error) {
    return errorResponse(error);
  }
}
