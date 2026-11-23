/** Used by Codex history, live events and the usage API to retain optional usage details.
 * Cached input is included in input; reasoning is included in output. Never add
 * either subset to the total, and never turn an absent measurement into zero.
 */
export function readCodexUsageDetails(usage: unknown) {
  const row = usage && typeof usage === 'object' ? usage as Record<string, unknown> : {};
  const number = (...keys: string[]): number | undefined => {
    for (const key of keys) {
      const value = row[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
    }
    return undefined;
  };
  const inputTokens = number('input_tokens', 'inputTokens');
  const outputTokens = number('output_tokens', 'outputTokens');
  const cacheReadTokens = number('cached_input_tokens', 'cachedInputTokens', 'cache_read_input_tokens');
  const cacheCreationTokens = number('cache_write_input_tokens', 'cacheWriteInputTokens', 'cache_creation_input_tokens');
  const reasoningTokens = number('reasoning_output_tokens', 'reasoningOutputTokens');
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheCreationTokens !== undefined ? { cacheCreationTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
  };
}
