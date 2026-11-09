/**
 * Public API. Everything the CLI does is available programmatically.
 */

export { audit, type AuditReport, type AuditOptions, type LineItem, type Recommendation } from './audit.js';
export { discover, type DiscoveredFile, type DiscoveryResult, type SourceKind } from './discover.js';
export { countTokens, PROFILES, DEFAULT_PROFILE, type ProfileName, type CountResult } from './tokens.js';
export { estimateMcpCost, type McpServerCost, type Confidence } from './mcp.js';
export {
  analyzeSkill,
  splitFrontmatter,
  findCollisions,
  tokenizeDescription,
  type SkillInfo,
  type Collision,
} from './skills.js';
export { WINDOWS, DEFAULT_WINDOW, resolveWindow, type WindowPreset } from './windows.js';
export { renderReport } from './report.js';
