import { readFile } from 'node:fs/promises';
import { closeRealtime } from '../realtime/publisher.ts';
import { runImportCli } from './cli.ts';

const code = await runImportCli(process.argv.slice(2), {
  readBytes: async (path) => new Uint8Array(await readFile(path)),
  print: (line) => console.info(line),
});
await closeRealtime();
process.exit(code);
