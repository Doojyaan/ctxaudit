#!/usr/bin/env node
/**
 * ctxaudit CLI.
 *
 * Exit codes are part of the contract (used by the --budget CI check):
 *   0  audit ran, within budget
 *   1  audit failed (bad input, unknown window)
 *   2  audit ran, budget exceeded
 */

import { Command } from 'commander';
import { audit } from './audit.js';
import { renderReport } from './report.js';
import { PROFILES, type ProfileName } from './tokens.js';
import { WINDOWS, DEFAULT_WINDOW } from './windows.js';

const program = new Command();

program
  .name('ctxaudit')
  .description('Find out how much of your agent\'s context window is burned before you type.')
  .version('0.1.0')
  .argument('[dir]', 'directory to audit', '.')
  .option('-p, --profile <name>', `tokenizer profile: ${Object.keys(PROFILES).join(' | ')}`, 'o200k')
  .option('-w, --window <id|tokens>', `context window preset or raw token count (default: ${DEFAULT_WINDOW})`)
  .option('-j, --json', 'output JSON instead of a report', false)
  .option('-v, --verbose', 'show details for every line item', false)
  .option(
    '-b, --budget <percent>',
    'exit 2 if pre-flight usage exceeds this percent of the window',
  )
  .option('--list-windows', 'print available window presets and exit', false)
  .action(async (dir: string, options: Record<string, unknown>) => {
    if (options.listWindows) {
      for (const w of WINDOWS) {
        console.log(`${w.id.padEnd(14)} ${String(w.tokens).padStart(9)}  ${w.note}`);
      }
      return;
    }

    const profile = options.profile as ProfileName;
    if (!(profile in PROFILES)) {
      console.error(`Unknown profile "${profile}". Choose one of: ${Object.keys(PROFILES).join(', ')}`);
      process.exit(1);
    }

    let report;
    try {
      report = await audit(dir, {
        profile,
        window: (options.window as string | undefined) ?? DEFAULT_WINDOW,
      });
    } catch (e) {
      console.error(`ctxaudit: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }

    if (options.json) {
      // Strip the internal skillBodyTokens helper from public JSON.
      const { skillBodyTokens, ...publicReport } = report as typeof report & { skillBodyTokens?: number };
      void skillBodyTokens;
      console.log(JSON.stringify(publicReport, null, 2));
    } else {
      console.log(renderReport(report, { verbose: Boolean(options.verbose) }));
    }

    if (options.budget !== undefined) {
      const limit = Number(options.budget);
      if (!Number.isFinite(limit) || limit <= 0) {
        console.error('--budget must be a positive number');
        process.exit(1);
      }
      const usedPercent = report.preflightShare * 100;
      if (usedPercent > limit) {
        console.error(
          `\nctxaudit: pre-flight uses ${usedPercent.toFixed(1)}% of the window, over the ${limit}% budget.`,
        );
        process.exit(2);
      }
    }
  });

program.parseAsync(process.argv).catch((e: unknown) => {
  console.error(`ctxaudit: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
