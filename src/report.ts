/**
 * Terminal rendering.
 *
 * Rules: the headline number comes first, always. Colour is never the only
 * carrier of meaning (so it survives piping and colour-blind terminals).
 */

import pc from 'picocolors';
import type { AuditReport } from './audit.js';

function bar(share: number, width = 24): string {
  const filled = Math.max(0, Math.min(width, Math.round(share * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function n(x: number): string {
  return x.toLocaleString('en-US');
}

/** Colour the headline by severity, but always print the number. */
function severityColor(share: number): (s: string) => string {
  if (share >= 0.25) return pc.red;
  if (share >= 0.1) return pc.yellow;
  return pc.green;
}

export function renderReport(report: AuditReport, opts: { verbose?: boolean } = {}): string {
  const out: string[] = [];
  const color = severityColor(report.preflightShare);

  out.push('');
  out.push(pc.bold('ctxaudit') + pc.dim(` — pre-flight context audit`));
  out.push(pc.dim(`  ${report.root}`));
  out.push('');

  // Headline: one number, front and centre.
  out.push(
    `  ${color(pc.bold(`${pct(report.preflightShare)}`))} of the context window is gone before you type.`,
  );
  out.push(
    `  ${pc.dim(bar(report.preflightShare))}  ${n(report.preflightTokens)} / ${n(report.window.tokens)} tokens`,
  );
  out.push(pc.dim(`  window: ${report.window.label} · tokenizer: ${report.profileNote}`));
  out.push('');

  if (report.items.length === 0) {
    out.push(pc.dim('  No agent configuration found in this directory.'));
    out.push('');
    return out.join('\n');
  }

  out.push(pc.bold('  Breakdown'));
  const labelWidth = Math.min(34, Math.max(...report.items.map((i) => i.label.length)));
  for (const item of report.items) {
    const label = item.label.padEnd(labelWidth);
    const share = pct(item.share).padStart(6);
    out.push(`  ${label}  ${n(item.tokens).padStart(8)}  ${share}  ${pc.dim(bar(item.share, 12))}`);
    if (opts.verbose) out.push(`  ${' '.repeat(labelWidth)}  ${pc.dim(item.detail)}`);
  }
  out.push('');

  if (report.mcpServers.length > 0 && opts.verbose) {
    out.push(pc.bold('  MCP servers'));
    for (const s of report.mcpServers) {
      const tag = s.confidence === 'measured' ? pc.green('measured') : pc.yellow(s.confidence);
      out.push(`  ${s.name.padEnd(labelWidth)}  ${n(s.tokens).padStart(8)}  ${tag}`);
      out.push(`  ${' '.repeat(labelWidth)}  ${pc.dim(s.basis)}`);
    }
    out.push('');
  }

  if (report.collisions.length > 0) {
    out.push(pc.bold('  Skill description collisions'));
    for (const c of report.collisions.slice(0, 5)) {
      out.push(
        `  ${pc.yellow(pct(c.similarity))}  ${c.a} ${pc.dim('↔')} ${c.b}`,
      );
      if (opts.verbose) out.push(`  ${' '.repeat(6)}  ${pc.dim('shared: ' + c.shared.join(', '))}`);
    }
    if (report.collisions.length > 5) {
      out.push(pc.dim(`  ... and ${report.collisions.length - 5} more`));
    }
    out.push('');
  }

  if (report.recommendations.length > 0) {
    out.push(pc.bold('  What to cut'));
    for (const r of report.recommendations) {
      const saves = r.saves > 0 ? pc.green(` −${n(r.saves)} tokens`) : '';
      out.push(`  • ${pc.bold(r.title)}${saves}`);
      out.push(`    ${pc.dim(r.detail)}`);
    }
    out.push('');
  }

  if (report.warnings.length > 0) {
    out.push(pc.bold('  Warnings'));
    for (const w of report.warnings) out.push(`  ${pc.yellow('!')} ${w}`);
    out.push('');
  }

  if (opts.verbose && report.missing.length > 0) {
    out.push(pc.dim(`  Not found: ${report.missing.join(', ')}`));
    out.push('');
  }

  return out.join('\n');
}
