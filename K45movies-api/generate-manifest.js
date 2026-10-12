const fs = require("fs");
const path = require("path");

const providersDir = path.join(__dirname, "providers");
const outputFile = path.join(__dirname, "manifest.json");

// Must match bundle-providers.js so every manifest entry has a real bundle.
const MODULES = ["catalog", "posts", "meta", "stream", "episodes"];
const EXCLUDE_DIRS = new Set(["extractors"]);
const VERSION = "1.0.0";

// Turn a folder id like "4khdhub" / "netflixMirror" into a display name.
function humanize(id) {
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
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
  .filter((id) =>
    MODULES.some((mod) =>
      fs.existsSync(path.join(providersDir, id, `${mod}.ts`)),
    ),
  )
  .sort()
  .map((id) => ({
    id,
    name: humanize(id),
    version: VERSION,
    description: null,
    bundleUrl: `bundled/${id}.js`,
    icon: null,
  }));

const manifest = {
  version: VERSION,
  updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  providers,
};

fs.writeFileSync(outputFile, JSON.stringify(manifest, null, 2) + "\n");
console.log(`✅ Wrote manifest.json with ${providers.length} providers`);
