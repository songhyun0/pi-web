import { readFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";

export async function GET() {
  const wasmPath = path.join(process.cwd(), "node_modules", "ghostty-web", "ghostty-vt.wasm");
  const bytes = await readFile(wasmPath);
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/wasm",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
