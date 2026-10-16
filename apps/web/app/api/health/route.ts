import { NextResponse } from "next/server";
import { getSystemStatus } from "@/lib/status";

export const dynamic = "force-dynamic";

export function GET() {
  const status = getSystemStatus();
  // Public endpoint (load balancers, container health checks): no file paths
  // or error details, just whether the app can serve.
  const ok = status.database.ok;
  return NextResponse.json(
    {
      ok,
      database: { ok, tables: status.database.tables },
      traceSchemaVersion: status.traceSchemaVersion,
    },
    { status: ok ? 200 : 503 },
  );
}
