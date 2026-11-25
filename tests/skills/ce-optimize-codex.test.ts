import { afterEach, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const SKILL = path.join(process.cwd(), "skills/ce-optimize")
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "ce-optimize-codex-"))
  roots.push(root)
  const workspace = path.join(root, "experiment worktree")
  const brief = path.join(root, "experiment brief.md")
  const bin = path.join(root, "bin")
  const record = path.join(root, ".config", "cosma", "codex-agent-launcher")
  const launcher = path.join(root, "fake launcher")
  const trace = path.join(root, "launcher-calls")
  const legacyArgs = path.join(root, "codex-argv")
  mkdirSync(workspace)
  mkdirSync(bin)
  mkdirSync(path.dirname(record), { recursive: true })
  writeFileSync(path.join(workspace, ".git"), "")
  writeFileSync(brief, "Test a single hypothesis.\n")
  writeFileSync(path.join(bin, "codex"), `#!/bin/sh
printf '%s\\n' "$@" > "$TEST_LEGACY_ARGS"
cat
`, { mode: 0o700 })
  writeFileSync(launcher, `#!/bin/sh
printf '%s\\n' "$1" >> "$TEST_LAUNCHER_TRACE"
case "$1" in
  start) [ "$3" = "$TEST_WORKSPACE" ] && [ "$5" = "$TEST_BRIEF" ] && echo exp-job ;;
  wait) echo '{"status":"completed"}' ;;
  result) echo '{"exit_status":0,"final_answer":"implemented","reviews":[],"refusals":[]}' ;;
  *) exit 99 ;;
esac
`, { mode: 0o700 })
  const run = (extraEnv: NodeJS.ProcessEnv = {}) => spawnSync(
    "bash", [path.join(SKILL, "scripts/codex-experiment.sh"), workspace, brief],
    {
      cwd: workspace, encoding: "utf8", timeout: 5000,
      env: {
        ...process.env, HOME: root, PATH: `${bin}:${process.env.PATH}`,
        CE_CODEX_MANAGED: "", CE_CODEX_MANAGED_LAUNCHER: "", CODEX_SANDBOX: "", CODEX_SESSION_ID: "",
        TEST_LAUNCHER_TRACE: trace, TEST_LEGACY_ARGS: legacyArgs, TEST_WORKSPACE: workspace, TEST_BRIEF: brief,
        ...extraEnv,
      },
    },
  )
  return { run, record, launcher, trace, legacyArgs, workspace }
}

test("ce-optimize submits a managed experiment through the launcher and returns its report", () => {
  const { run, record, launcher, trace, legacyArgs } = fixture()
  writeFileSync(record, `${launcher}\n`)
  const result = run({ CODEX_SESSION_ID: "outer-session" })
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({
    exit_status: 0, final_answer: "implemented", reviews: [], refusals: [],
  })
  expect(readFileSync(trace, "utf8")).toBe("start\nwait\nresult\n")
  expect(existsSync(legacyArgs)).toBe(false)
})

test("ce-optimize reports a missing managed launcher without calling standalone Codex", () => {
  const { run, record, launcher, legacyArgs } = fixture()
  writeFileSync(record, `${launcher}.missing\n`)
  const result = run()
  expect(result.status).toBe(2)
  expect(result.stderr).toContain("managed Codex launcher missing")
  expect(existsSync(legacyArgs)).toBe(false)
})

test("ce-optimize standalone dispatch keeps Codex sandboxed and sends the brief on stdin", () => {
  const { run, workspace, legacyArgs } = fixture()
  const result = run()
  expect(result.status).toBe(0)
  expect(result.stdout).toBe("Test a single hypothesis.\n")
  expect(readFileSync(legacyArgs, "utf8").trimEnd().split("\n")).toEqual([
    "exec", "--sandbox", "workspace-write", "--skip-git-repo-check", "-C", workspace, "-",
  ])
  expect(run({ CODEX_SESSION_ID: "outer-session" }).status).toBe(3)
})

test("ce-optimize removes the Codex posture that disabled approvals and the sandbox", () => {
  const schema = readFileSync(path.join(SKILL, "references/optimize-spec-schema.yaml"), "utf8")
  const loop = readFileSync(path.join(SKILL, "references/loop.md"), "utf8")
  expect(schema).not.toMatch(/^\s+- yolo\b/m)
  expect(loop).toContain("scripts/codex-experiment.sh")
})

test("both managed Codex launcher helpers are byte-identical", () => {
  const asset = "scripts/managed-codex.py"
  expect(readFileSync(path.join(SKILL, asset), "utf8")).toBe(
    readFileSync(path.join(process.cwd(), "skills/ce-work", asset), "utf8"),
  )
})
