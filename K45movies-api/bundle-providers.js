const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const providersDir = path.join(__dirname, "providers");
const outputDir = path.join(__dirname, "bundled");

// Provider modules merged into a single bundle, in export-merge order.
const MODULES = ["catalog", "posts", "meta", "stream", "episodes"];

// Directories under providers/ that are shared code, not consumable providers.
const EXCLUDE_DIRS = new Set(["extractors"]);

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const providers = fs
  .readdirSync(providersDir, { withFileTypes: true })
  .filter(
    (dirent) =>
      dirent.isDirectory() &&
      !dirent.name.startsWith(".") &&
      !EXCLUDE_DIRS.has(dirent.name),
  )
  .map((dirent) => dirent.name)
  .sort();

let bundled = 0;
let skipped = 0;

for (const provider of providers) {
  const providerPath = path.join(providersDir, provider);

  // Gracefully skip modules that don't exist (e.g. episodes.ts is optional).
  const present = MODULES.filter((mod) =>
    fs.existsSync(path.join(providerPath, `${mod}.ts`)),
  );

  if (present.length === 0) {
    skipped++;
    console.log(`⏭  Skipped (no modules): ${provider}`);
    continue;
  }

  // esbuild cannot emit a single `outfile` from multiple entry points, so we
  // synthesize one entry that merges every module's exports into `exports`.
  const contents = present
    .map((mod) => `Object.assign(exports, require('./${mod}.ts'));`)
    .join("\n");

  try {
    esbuild.buildSync({
      stdin: {
        contents,
        resolveDir: providerPath,
        sourcefile: `${provider}.entry.js`,
      },
      bundle: true,
      outfile: path.join(outputDir, `${provider}.js`),
      format: "cjs",
      platform: "browser",
      target: "es2015",
      external: [], // bundle everything, including dependencies
      logLevel: "warning",
    });

    bundled++;
    console.log(`✅ Bundled: ${provider} (${present.join(", ")})`);
  } catch (error) {
    console.error(`❌ Failed: ${provider}: ${error.message}`);
  }
}

console.log(
  `\n🎉 Bundled ${bundled} providers to /bundled` +
    (skipped ? ` (skipped ${skipped})` : ""),
);
