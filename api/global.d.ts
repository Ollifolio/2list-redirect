// global.d.ts — Dummy-Type für process.env in Edge Functions
// Diese Datei sorgt dafür, dass TypeScript keine Fehler wie
// "Cannot find name 'process'" ausgibt, obwohl Edge Functions
// keine klassische Node.js-Umgebung sind.

declare global {
  const process: {
    env: Record<string, string | undefined>;
  };
}

// Export leer, damit Datei als Modul behandelt wird
export {};
