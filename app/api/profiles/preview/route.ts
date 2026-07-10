import { NextResponse } from "next/server";
import { postProfilePreviewApiResult } from "../../../../lib/profile-preview";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Invalid JSON request body: ${message}` }, { status: 400 });
  }

  const result = await postProfilePreviewApiResult(body);
  return NextResponse.json(result.body, { status: result.status });
}
