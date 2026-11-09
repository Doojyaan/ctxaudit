/**
 * Context window presets.
 *
 * These are the windows agents actually get in practice, not the marketing
 * numbers. The gap is the point: B-10 reports a product layer capping a 1.05M
 * model at 372K. Reporting against the model spec would be a lie.
 */

export interface WindowPreset {
  id: string;
  label: string;
  tokens: number;
  note: string;
}

export const WINDOWS: WindowPreset[] = [
  { id: 'claude-200k', label: 'Claude (200k)', tokens: 200_000, note: 'Claude Sonnet/Opus standard window' },
  { id: 'claude-1m', label: 'Claude (1M beta)', tokens: 1_000_000, note: '1M context beta' },
  { id: 'gpt-128k', label: 'GPT-4 class (128k)', tokens: 128_000, note: '128k models' },
  { id: 'codex-353k', label: 'Codex app effective (353k)', tokens: 353_400, note: 'B-10: catalog-capped 372K, 353.4K effective' },
  { id: 'gemini-1m', label: 'Gemini (1M)', tokens: 1_000_000, note: 'Gemini 1M window' },
  { id: 'small-32k', label: 'Small (32k)', tokens: 32_000, note: 'Local models, small windows' },
  { id: 'small-8k', label: 'Local (8k)', tokens: 8_000, note: 'Older or heavily quantized local models' },
];

export const DEFAULT_WINDOW = 'claude-200k';

export function resolveWindow(idOrTokens: string): { label: string; tokens: number } | null {
  const preset = WINDOWS.find((w) => w.id === idOrTokens);
  if (preset) return { label: preset.label, tokens: preset.tokens };

  // Allow a raw number so people can audit against a custom cap.
  const asNumber = Number(idOrTokens);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return { label: `${asNumber.toLocaleString('en-US')} tokens`, tokens: Math.floor(asNumber) };
  }
  return null;
}
