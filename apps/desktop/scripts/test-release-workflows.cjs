// Auto-update metadata must come from the same build as the .exe: only "Build AI Stoica Windows" may publish latest.yml and .blockmap.
const assert = require("assert"), fs = require("fs"), path = require("path");
const dir = path.join(__dirname, "..", "..", "..", ".github", "workflows");
const read = (name) => fs.readFileSync(path.join(dir, name), "utf8");

const build = read("windows-build.yml");
assert(/gh release (upload|create) \$tag @files/.test(build) && build.includes('"$dir/latest.yml"') && build.includes("*.blockmap"), "windows-build.yml must publish the .exe, latest.yml and .blockmap together");

const zip = read("ai-stoica-windows-zip.yml");
const zipRelease = zip.split(/\r?\n/).filter((line) => /gh release (upload|create)/.test(line));
assert(zipRelease.length > 0, "ZIP workflow release step not found");
for (const line of zipRelease) {
  assert(!/latest|blockmap/i.test(line), "ZIP workflow must not upload latest.yml or .blockmap (its build differs from the published .exe): " + line.trim());
}

console.log("Release workflow checks OK");
