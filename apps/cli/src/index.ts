import { TRACE_SCHEMA_VERSION } from "@tm/schema";

const HELP = `tracemkt — share scrubbed agent sessions on Trace Marketplace

Usage:
  tracemkt share [folder]   Scrub sessions locally, review, and upload approved ones (coming in S1)
  tracemkt --version        Print version information
  tracemkt --help           Show this help

Raw sessions never leave your machine; only scrubbed traces you approve are uploaded.`;

const [cmd] = process.argv.slice(2);

if (cmd === "--version" || cmd === "-v") {
  console.log(`tracemkt 0.1.0 (trace schema v${TRACE_SCHEMA_VERSION})`);
} else if (cmd === "share") {
  console.log("The share command arrives in milestone S1. For now, use the website's Share page.");
  process.exitCode = 1;
} else {
  console.log(HELP);
}
