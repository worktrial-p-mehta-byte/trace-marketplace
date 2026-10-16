export {
  analyzeTrace,
  heuristicLabeler,
  isCorrection,
  isTestCommand,
  testRunPassed,
  testRunResult,
  type TestRunResult,
  FAILURE_CODES,
  OUTCOME_CODES,
  SIGNAL_CODES,
  type FailureCode,
  type Labeler,
  type TraceAnalysis,
} from "./labels";
export {
  detectLanguage,
  detectFramework,
  filePathsOf,
  commandsOf,
  KNOWN_LANGUAGES,
  KNOWN_FRAMEWORKS,
} from "./detect";
export {
  DOMAINS,
  DOMAIN_IDS,
  DOMAIN_BY_ID,
  detectDomains,
  domainName,
  type DomainDef,
  type DomainId,
  type DomainScore,
  type DomainDetection,
} from "./domains";
export {
  registerLabel,
  labelDef,
  labelName,
  labelDescription,
  labelsOfKind,
  type LabelDef,
  type LabelKindId,
} from "./registry";
export {
  enrichTrace,
  comboKeyOf,
  shapeTraits,
  type Enrichment,
  type ExtractOptions,
  type TraceTraits,
} from "./traits";
export {
  checkAuthenticity,
  finalCheck,
  type Authenticity,
  type AuthenticityCheck,
  type AuthenticityLevel,
  type ReportedTraits,
} from "./authenticity";
