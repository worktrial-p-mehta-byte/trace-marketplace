export {
  analyzeTrace,
  heuristicLabeler,
  isCorrection,
  isTestCommand,
  testRunPassed,
  FAILURE_CODES,
  OUTCOME_CODES,
  SIGNAL_CODES,
  type FailureCode,
  type Labeler,
  type TraceAnalysis,
} from "./labels";
export { detectLanguage, detectFramework, filePathsOf, commandsOf } from "./detect";
export {
  enrichTrace,
  comboKeyOf,
  type Enrichment,
  type ExtractOptions,
  type TraceTraits,
} from "./traits";
