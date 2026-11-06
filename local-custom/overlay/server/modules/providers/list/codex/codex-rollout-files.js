import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import {Readable} from 'node:stream';
import {createZstdDecompress} from 'node:zlib';
import {AppError} from '../../../../shared/utils.js';

// Resolve compression/decompression transitions without changing native files.
export async function resolveCodexRolloutPath(filePath) {
  const plain = filePath.endsWith('.zst') ? filePath.slice(0, -4) : filePath;
  for (const candidate of filePath.endsWith('.zst') ? [filePath, plain] : [plain, plain + '.zst']) {
    try { if ((await fsp.stat(candidate)).isFile()) return await fsp.realpath(candidate); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const error = new Error(`Codex transcript unavailable: ${filePath}`);
  error.code = 'ENOENT'; throw error;
}

// Byte boundaries in history_base refer to uncompressed bytes, including when
// an ancestor was subsequently compressed. Never apply them to the .zst size.
export function createCodexArtifactStream(filePath, {endByteOffset} = {}) {
  let source, decoded;
  const output = Readable.from((async function* () {
    const resolved = await resolveCodexRolloutPath(filePath);
    source = fs.createReadStream(resolved);
    decoded = resolved.endsWith('.zst') ? source.pipe(createZstdDecompress()) : source;
    if (decoded !== source) source.on('error', error => decoded.destroy(error));
    let consumed = 0;
    try {
      if (endByteOffset === 0) return;
      for await (const chunk of decoded) {
        const remaining = endByteOffset === undefined ? chunk.length : endByteOffset - consumed;
        const selected = chunk.subarray(0, Math.min(chunk.length, remaining));
        consumed += selected.length;
        if (selected.length) yield selected;
        if (endByteOffset !== undefined && consumed >= endByteOffset) break;
      }
      if (endByteOffset !== undefined && consumed < endByteOffset) {
        throw new AppError('The source transcript is shorter than the Codex fork snapshot.', {code: 'CODEX_HISTORY_SOURCE_INVALID', statusCode: 502});
      }
    } catch (error) {
      if (error instanceof AppError || !resolved.endsWith('.zst')) throw error;
      throw new AppError('Unable to decompress Codex history: ' + error.message, {code: 'CODEX_HISTORY_SOURCE_INVALID', statusCode: 502});
    } finally { decoded.destroy(); source.destroy(); }
  })(), {objectMode: false});
  output.once('close', () => {decoded?.destroy(); source?.destroy();});
  return output;
}

export async function* readCodexArtifactLines(filePath, options) {
  const input = createCodexArtifactStream(filePath, options);
  const reader = readline.createInterface({input, crlfDelay: Infinity});
  try { for await (const line of reader) yield line; }
  finally { reader.close(); input.destroy(); }
}

export async function findCodexRolloutFiles(root) {
  const files = [];
  async function visit(directory) {
    let entries;
    try { entries = await fsp.readdir(directory, {withFileTypes: true}); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && /\.jsonl(?:\.zst)?$/.test(entry.name)) files.push(file);
    }
  }
  await visit(root);
  return files;
}

// Codex appends renames to this index: the latest timestamp wins. Keep all
// previous names so a stale imported label can be refreshed without replacing
// an unrelated name deliberately assigned in CloudCLI.
export async function readCodexSessionNames(filePath) {
  const names = new Map();
  try {
    const input = fs.createReadStream(filePath);
    const reader = readline.createInterface({input, crlfDelay: Infinity});
    try {
      for await (const line of reader) {
        let row; try {row = JSON.parse(line);} catch {continue;}
        if (typeof row.id !== 'string' || typeof row.thread_name !== 'string' || !row.thread_name.trim()) continue;
        const previous = names.get(row.id);
        const timestamp = Date.parse(row.updated_at) || 0;
        const priorNames = previous?.priorNames || new Set();
        priorNames.add(row.thread_name);
        names.set(row.id, !previous || timestamp >= previous.timestamp
          ? {name: row.thread_name, timestamp, priorNames} : {...previous, priorNames});
      }
    } finally {reader.close(); input.destroy();}
  } catch (error) {if (error.code !== 'ENOENT') throw error;}
  return names;
}
