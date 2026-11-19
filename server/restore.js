"use strict";
// Restore a backup made by the vault (server/vault.js; /me → Data & backups).
//
//   node server/restore.js <backup file> --dry-run     what the file holds; nothing is changed
//   node server/restore.js <backup file> --yes         put its records back
//   node server/restore.js <backup file> --yes --only=cold,item      only some kinds: doc, item, cold, log
//
// STOP THE SERVER FIRST (pm2 stop <name>). The running server keeps its own copy of many records in memory and would
// write them back over what was restored. The store is the one the server uses: MongoDB when MONGO_URI is set (in the
// environment or server/.env), the files under server/data otherwise.
//
// What happens: the file is read through first — a file that is cut short changes nothing. Then every document, list item
// and recorded session in it replaces the one with the same name (anything the backup does not hold is left alone). A log
// is restored only into an empty log, so entries are never doubled. The two key files are not in a backup: if they were
// lost too, secrets saved in the settings (API keys, tokens) cannot be read and are entered again.

const path = require("path");

async function main(argv) {
  const args = argv.filter((a) => !a.startsWith("--"));
  const flag = (name) => argv.includes(`--${name}`);
  const onlyArg = argv.find((a) => a.startsWith("--only="));
  const only = onlyArg
    ? onlyArg
        .slice(7)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;
  if (!args.length || (only && only.some((k) => !["doc", "item", "cold", "log"].includes(k)))) {
    console.error("Usage: node server/restore.js <backup file> (--dry-run | --yes) [--only=doc,item,cold,log]");
    return 2;
  }
  const file = path.resolve(args[0]);
  const { restore, inspect } = require("./vault");
  const seen = await inspect(file);
  console.log(`${path.basename(file)}: made ${seen.meta ? seen.meta.at : "?"} from a ${seen.meta ? seen.meta.store : "?"} store`);
  console.log(`  ${seen.counts.doc} records, ${seen.counts.item} list items in ${seen.names.item.length} lists, ${seen.counts.cold} recorded sessions, ${seen.counts.log} log entries`);
  if (!seen.whole) {
    console.error("  This file is incomplete (it has no proper end). Nothing was changed.");
    return 1;
  }
  if (flag("dry-run") || !flag("yes")) {
    console.log(flag("dry-run") ? "  Dry run: nothing was changed." : "  Nothing was changed. Stop the server, then run again with --yes to restore.");
    return 0;
  }
  require("./env").loadEnv();
  const { openDocs } = require("./docs");
  const docs = await openDocs({
    dir: path.join(__dirname, "data"),
    log: console,
  });
  try {
    const r = await restore(file, docs, { only });
    console.log(`  Restored into the ${docs.kind} store: ${r.done.doc} records, ${r.done.item} list items, ${r.done.cold} recorded sessions, ${r.done.log} log entries.`);
    if (r.done.skippedLogs.length) console.log(`  Left alone (already has entries): ${r.done.skippedLogs.join(", ")}`);
    console.log("  Start the server again.");
  } finally {
    await docs.close();
  }
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`Restore failed: ${err && err.message ? err.message : err}`);
      process.exit(1);
    },
  );
}

module.exports = { main };
