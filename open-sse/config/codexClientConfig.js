const version = process.env.CODEX_CLI_VERSION?.trim() || "0.153.4";
const originator = process.env.CODEX_CLI_ORIGINATOR?.trim() || "codex_exec";

export const CODEX_CLIENT_CONFIG = Object.freeze({
  version,
  originator,
  userAgent: process.env.CODEX_CLI_USER_AGENT?.trim()
    || `${originator}/${version} (codex_exec; ${version})`,
  betaFeatures: "remote_compaction_v2",
  turnMetadata: Object.freeze({
    agentName: process.env.CODEX_AGENT_NAME?.trim() || "/root",
    threadSource: "user",
    sandbox: "seccomp",
    sandboxMode: "read-only",
    autoReviewEnabled: false,
    nodeReplAutoReviewRequired: false,
    nodeReplDisabled: false,
  }),
});
