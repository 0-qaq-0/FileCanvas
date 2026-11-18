import fs from 'node:fs';
import path from 'node:path';

// A small diagnostics log in the app data directory. It stays on this computer and holds error
// messages (which can name files), never file contents or API keys. Logging must never be the
// reason something fails, so every write swallows its own errors.
const MAX_BYTES = 1024 * 1024;

export class Log {
  readonly file: string;
  constructor(readonly directory: string) {
    this.file = path.join(directory, 'filecanvas.log');
  }
  write(level: 'info' | 'warn' | 'error', message: string, detail?: unknown) {
    try {
      fs.mkdirSync(this.directory, { recursive: true });
      this.rotate();
      const extra =
        detail === undefined ? '' : ` | ${detail instanceof Error ? detail.stack : String(detail)}`;
      fs.appendFileSync(
        this.file,
        `${new Date().toISOString()} ${level.toUpperCase()} ${message}${extra}\n`,
      );
    } catch {}
  }
  // One old file is kept, so the log never takes more than about twice MAX_BYTES.
  private rotate() {
    try {
      if (fs.statSync(this.file).size < MAX_BYTES) return;
      fs.renameSync(this.file, `${this.file}.1`);
    } catch {}
  }
}
