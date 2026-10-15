import { NextResponse } from "next/server";
import { getSystemStatus } from "@/lib/status";

export const dynamic = "force-dynamic";

export function GET() {
  const status = getSystemStatus();
  return NextResponse.json(status, { status: status.database.ok ? 200 : 503 });
}
