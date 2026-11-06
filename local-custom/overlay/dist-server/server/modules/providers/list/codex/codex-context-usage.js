// A session's cumulative token spend is not its current context occupancy.
// Read only the last model request; absent measurements remain unknown.
export function readCodexContextUsed(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const total = usage.total_tokens ?? usage.totalTokens;
  if (valid(total)) return total;
  const input = usage.input_tokens ?? usage.inputTokens;
  const output = usage.output_tokens ?? usage.outputTokens;
  return valid(input) && valid(output) ? input + output : null;
}
