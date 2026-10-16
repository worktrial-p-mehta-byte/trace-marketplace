import { NextResponse } from "next/server";
import { downloadable } from "@tm/core";
import { enrichTrace, exportTask, TaskExportError } from "@tm/enrich";
import { Trace } from "@tm/schema";
import { fail } from "@/lib/api";
import { getBlobs, getCurrentUser, getDb } from "@/lib/server";

/**
 * The licensed session as a replayable task (trace-task/v1): prompt, files,
 * commands, check and expected outcome. Same entitlement as the download;
 * open-source sessions only.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("Sign in first.", 401);
  const { id } = await params;
  const d = downloadable(getDb(), user, id);
  if (!d) return fail("You don't hold a licence for this trace.", 403);
  // A task is for replaying the session against an agent: evaluation or
  // training use. A research licence ("study, no training or evaluation")
  // covers the trace download, not this.
  if (!d.scopes.some((s) => s === "eval" || s === "training")) {
    return fail("Exporting a task needs an evaluation or training licence.", 403);
  }
  if (d.tier === 1) {
    return fail(
      "Signals-only sessions can't be exported as tasks: the prompt and files were never shared.",
      409,
    );
  }
  const raw = await getBlobs().get(d.blobKey);
  if (!raw) return fail("The stored trace is missing.", 404);
  const parsed = Trace.safeParse(JSON.parse(raw));
  if (!parsed.success) return fail("The stored trace can't be read.", 500);
  // The stored trace is the scrubbed open-source session: label it the same
  // way the server did when it was shared.
  const { labels, traits } = enrichTrace(parsed.data);
  try {
    const task = exportTask(parsed.data, { labels, traits, listingId: id, licenses: d.scopes });
    return new NextResponse(JSON.stringify(task, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="task-${id}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof TaskExportError) return fail(e.message, 409);
    throw e;
  }
}
