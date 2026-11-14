import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const compiler = process.env.FLATC ?? "flatc";
const version = execFileSync(compiler, ["--version"], { encoding: "utf8" }).trim();
if (version !== "flatc version 25.9.23") throw new Error(`Expected flatc 25.9.23, got ${version}`);
const check = process.argv.includes("--check");
const temporary = mkdtempSync(join(tmpdir(), "data-wind-protocol-"));

// Keep the upstream implementation; make its safety contracts explicit per AGENTS.md.
function annotateRust(source) {
  const lines = [];
  for (const original of source.replaceAll("// Safety:", "// SAFETY:").split("\n")) {
    const indent = original.match(/^\s*/)[0];
    if (original.includes("pub unsafe fn init_from_table") && !lines.slice(-4).some((line) => line.includes("# Safety"))) {
      lines.push(`${indent}/// # Safety`, `${indent}/// The table must have been verified against this generated schema type.`);
    }
    if (/\bunsafe\s*\{/.test(original)) {
      const comments = [];
      for (let i = lines.length - 1; i >= 0 && /^\s*(\/\/.*)?$/.test(lines[i]); i -= 1) comments.push(lines[i]);
      if (!comments.some((line) => line.includes("SAFETY:"))) {
        let reason = "The unsafe caller supplies a schema-verified, in-bounds location.";
        if (original.includes("emplace_scalar")) reason = "Push reserves enough writable bytes for this scalar.";
        else if (original.includes("from_raw_parts")) reason = "This generated struct is a fully initialized fixed-size byte array.";
        else if (original.includes("init_from_table")) reason = "The verified union tag selects this generated payload table.";
        else if (original.includes("root_unchecked")) reason = "The caller of this unsafe function must supply a verified buffer.";
        lines.push(`${indent}// SAFETY: ${reason}`);
      }
    }
    lines.push(original);
  }
  return lines.join("\n")
    .replaceAll("-> Result<CommandResponse,", "-> Result<CommandResponse<'_>,")
    .replaceAll("-> CommandResponse {", "-> CommandResponse<'_> {");
}

function files(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = join(prefix, entry.name);
    return entry.isDirectory() ? files(join(directory, entry.name), name) : [name];
  });
}

try {
  // project_snapshot.fbs 仅前端消费（IndexedDB 存储格式），且 include 了线协议 schema，
  // 因此 ts 一并编译两份 schema；rust 只吃引擎契约 command_response.fbs。
  // 线协议自 Bevy 迁移后下沉在 data-wind-cpu（engine 经 data_wind_cpu::protocol 复用）。
  for (const [language, destination, schemas] of [
    ["rust", "engine-rs/data-wind-cpu/src/generated", ["command_response.fbs"]],
    ["ts", "frontend/src/protocol/generated", ["command_response.fbs", "project_snapshot.fbs"]],
  ]) {
    const output = join(temporary, language);
    mkdirSync(output);
    execFileSync(compiler, [`--${language}`, "-o", output, ...schemas.map((name) => join(root, "protocol", name))], { stdio: "pipe" });
    if (language === "rust") {
      const generated = join(output, "command_response_generated.rs");
      writeFileSync(generated, annotateRust(readFileSync(generated, "utf8")));
      execFileSync("rustfmt", ["--edition", "2024", generated]);
      // rustfmt may split an inline unsafe expression into a struct field.
      writeFileSync(generated, annotateRust(readFileSync(generated, "utf8")));
      execFileSync("rustfmt", ["--edition", "2024", generated]);
    }
    for (const name of files(output)) {
      const target = join(root, destination, name);
      const content = readFileSync(join(output, name));
      if (check) {
        if (!content.equals(readFileSync(target))) throw new Error(`Generated file is stale: ${relative(root, target)}`);
      } else {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content);
      }
    }
  }
  console.log(check ? "Protocol bindings match the schema." : "Generated Rust and TypeScript protocol bindings.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
