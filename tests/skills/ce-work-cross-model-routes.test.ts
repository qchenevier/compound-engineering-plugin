import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"

setDefaultTimeout(20_000)

// cross-model-work.sh honors CROSS_MODEL_EFFORT_OVERRIDE; make a clean
// environment the suite-wide default so an ambient export cannot leak into
// baseline assertions. Tests that exercise the override set it explicitly.
delete process.env.CROSS_MODEL_EFFORT_OVERRIDE

const SCRIPT = path.join(process.cwd(), "skills/ce-work/scripts/cross-model-work.sh")
const CONTROLLER = path.join(process.cwd(), "skills/ce-work/scripts/unit-workspace.py")
const SCHEMA = path.join(process.cwd(), "skills/ce-work/references/implementation-result-schema.json")
const ROUTES = ["codex", "claude", "grok-cli", "cursor", "composer", "grok-cursor", "opencode"] as const
const ROUTE_CONTRACTS = {
  codex: { target: "codex", harness: "codex", intermediaries: [], model: "auto", restriction: "adapter-enforced" },
  claude: { target: "claude", harness: "claude", intermediaries: [], model: "auto", restriction: "cooperative" },
  "grok-cli": { target: "grok", harness: "grok", intermediaries: [], model: "auto", restriction: "cooperative" },
  cursor: { target: "cursor", harness: "cursor-agent", intermediaries: [], model: "auto", restriction: "adapter-enforced" },
  composer: { target: "composer", harness: "cursor-agent", intermediaries: ["cursor"], model: "composer-2.5-fast", restriction: "adapter-enforced" },
  "grok-cursor": { target: "grok", harness: "cursor-agent", intermediaries: ["cursor"], model: "cursor-grok-4.6-high", restriction: "adapter-enforced" },
  opencode: { target: "opencode", harness: "opencode", intermediaries: [], model: "auto", restriction: "cooperative" },
} as const
const roots: string[] = []
const templateRoots: string[] = []
let seedCanonical: string | null = null

function temp(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of [...roots, ...templateRoots]) rmSync(dir, { recursive: true, force: true })
})

function seedCanonicalRepo(): string {
  if (seedCanonical) return seedCanonical
  const root = mkdtempSync(path.join(tmpdir(), "ce-work-route-template-"))
  templateRoots.push(root)
  const canonical = path.join(root, "canonical")
  mkdirSync(canonical)
  mkdirSync(path.join(canonical, "docs", "plans"), { recursive: true })
  writeFileSync(path.join(canonical, "README.md"), "seed\n")
  writeFileSync(path.join(canonical, "docs", "plans", "plan.md"), "# Test plan\n")
  spawnSync("git", ["init", "-q", canonical])
  spawnSync("git", ["-C", canonical, "config", "user.email", "test@example.com"])
  spawnSync("git", ["-C", canonical, "config", "user.name", "Test"])
  spawnSync("git", ["-C", canonical, "add", "."])
  spawnSync("git", ["-C", canonical, "commit", "-qm", "seed"])
  seedCanonical = canonical
  return canonical
}

function fixture() {
  const root = temp("ce-work-route-")
  const canonical = path.join(root, "canonical")
  const packet = path.join(root, "packet.md")
  const capture = path.join(root, "capture")
  const runs = path.join(root, "runs")
  mkdirSync(root, { recursive: true })
  mkdirSync(capture)
  writeFileSync(packet, "Implement U3 only.\n")
  cpSync(seedCanonicalRepo(), canonical, { recursive: true })
  return {
    root,
    canonical,
    workspace: canonical,
    resultDir: path.join(root, "unprepared-result"),
    packet,
    packetSource: packet,
    capture,
    runs,
    prepared: null as null | { authorization_path: string; workspace: string; packet_path: string; result_dir: string },
  }
}

function fakeBin(route: typeof ROUTES[number], capture: string, response?: string) {
  const bin = temp("ce-work-bin-")
  const binary = route === "grok-cli" ? "grok" : route === "grok-cursor" || route === "cursor" || route === "composer" ? "cursor-agent" : route
  const final = response ?? '{"terminal_status":"completed","summary":"implemented","changed_files":["result.txt"],"evidence":["focused test passed"],"scope_expansion":null}'
  const script = `#!/bin/sh
set -eu
if [ "\${1:-}" = "--list-models" ]; then
  env | sort > '${capture}/probe-env'
  cat <<'MODELS'
composer-2.5-fast - Composer 2.5 Fast
composer-next-fast - Composer Next Fast
cursor-grok-4.6-high - Cursor Grok 4.6
claude-sonnet-5-low - Sonnet 5 1M Low
MODELS
  exit 0
fi
printf '%s\\n' "$@" > '${capture}/argv'
printf '%s' "$PWD" > '${capture}/pwd'
env | sort > '${capture}/env'
cat > '${capture}/stdin'
printf 'READY\\n' > result.txt
case '${route}' in
  codex)
    out=''
    previous=''
    for arg in "$@"; do
      if [ "$previous" = '-o' ]; then out="$arg"; fi
      previous="$arg"
    done
    printf '%s\\n' '{"type":"item.completed"}'
    printf '%s\\n' '${final.replaceAll("'", "'\\''")}' > "$out"
    ;;
  claude)
    printf '%s\\n' '{"type":"system","subtype":"init","model":"claude-fable-5"}'
    printf '%s\\n' '${final.replaceAll("'", "'\\''")}'
    ;;
  cursor|composer|grok-cursor)
    model='Cursor Grok 4.6'
    [ '${route}' = composer ] && model='Composer 2.5 Fast'
    printf '%s\\n' "{\\"type\\":\\"system\\",\\"subtype\\":\\"init\\",\\"model\\":\\"$model\\"}"
    printf '%s\\n' '${final.replaceAll("'", "'\\''")}'
    ;;
  grok-cli)
    printf '%s\\n' '{"type":"activity","message":"editing"}'
    printf '%s\\n' '${final.replaceAll("'", "'\\''")}'
    ;;
  opencode)
    printf '%s\\n' '{"type":"step_start"}'
    printf '%s\\n' '{"type":"text","part":{"type":"text","text":${JSON.stringify(final)}}}'
    printf '%s\\n' '{"type":"step_finish","part":{"reason":"stop"}}'
    ;;
esac
`
  writeFileSync(path.join(bin, binary), script)
  chmodSync(path.join(bin, binary), 0o755)
  return bin
}

function prepareDispatch(
  route: typeof ROUTES[number],
  f: ReturnType<typeof fixture>,
  env: NodeJS.ProcessEnv = process.env,
  expectedPacketDigest = createHash("sha256").update(readFileSync(f.packet)).digest("hex"),
  authorizationOverrides: Record<string, unknown> = {},
  forgedAuthorization = false,
  workerPrefix: string[] = [],
) {
  const contract = ROUTE_CONTRACTS[route]
  if (!f.prepared) {
    const runId = "route-run"
    const unitId = "U3"
    const attemptId = "attempt-1"
    const plan = path.join(f.canonical, "docs", "plans", "plan.md")
    const planDigest = createHash("sha256").update(readFileSync(plan)).digest("hex")
    const controllerEnv = { ...process.env, CE_WORK_RUNS_ROOT: f.runs }
    const invoke = (...args: string[]) => {
      const proc = spawnSync("python3", [CONTROLLER, ...args], { encoding: "utf8", env: controllerEnv })
      expect(proc.status).toBe(0)
      const lines = proc.stdout.trim().split("\n")
      return JSON.parse(lines[1])
    }
    invoke(
      "init", "--run-id", runId, "--repo", f.canonical, "--plan", plan, "--plan-digest", planDigest,
      "--binding-json", JSON.stringify({ mode: "prefer", target: contract.target, model: forgedAuthorization ? null : authorizationOverrides.model_requested ?? null, source: "test" }),
      "--egress-json", JSON.stringify({ sanction_source: "test", route, intermediaries: [...contract.intermediaries], exposed_material: [unitId], restrictions: [] }),
    )
    const base = spawnSync("git", ["-C", f.canonical, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim()
    f.prepared = invoke(
      "prepare", "--run-id", runId, "--unit-id", unitId, "--attempt-id", attemptId,
      "--base", base, "--packet", f.packetSource, "--activity-posture", "incremental",
    )
    f.workspace = f.prepared.workspace
    f.packet = f.prepared.packet_path
    f.resultDir = f.prepared.result_dir
  }
  let authorization = f.prepared.authorization_path
  if (forgedAuthorization) {
    const forged = { ...JSON.parse(readFileSync(authorization, "utf8")), ...authorizationOverrides }
    authorization = path.join(f.root, `authorization-forged-${Math.random().toString(16).slice(2)}.json`)
    writeFileSync(authorization, `${JSON.stringify(forged)}\n`, { mode: 0o600 })
    chmodSync(authorization, 0o600)
  }
  const jobId = `job-${Math.random().toString(16).slice(2)}`
  const jobDir = path.join(f.runs, "route-run", "jobs", jobId)
  mkdirSync(jobDir, { mode: 0o700 })
  chmodSync(jobDir, 0o700)
  const adapterArgv = [SCRIPT, authorization, f.workspace, f.packet, expectedPacketDigest, f.resultDir]
  writeFileSync(path.join(jobDir, "meta.json"), `${JSON.stringify({
    job_id: jobId,
    skill: "ce-work",
    run_id: "route-run",
    label: "U3",
    input_digest: expectedPacketDigest,
    worker_argv: [...workerPrefix, ...adapterArgv],
    result_path: path.join(f.resultDir, "implementation-result.json"),
  })}\n`, { mode: 0o600 })
  return {
    command: [...workerPrefix, ...adapterArgv],
    env: { ...env, CE_CODEX_MANAGED: env.CE_CODEX_MANAGED ?? "off", CE_WORK_RUNS_ROOT: f.runs, CE_PEER_JOB_ID: jobId },
  }
}

function run(...args: Parameters<typeof prepareDispatch>) {
  const [, f] = args
  const { command, env } = prepareDispatch(...args)
  const proc = spawnSync(command[0], command.slice(1), {
    encoding: "utf8",
    env,
    timeout: 15_000,
  })
  const resultPath = path.join(f.resultDir, "implementation-result.json")
  return {
    code: proc.status ?? -1,
    stderr: proc.stderr ?? "",
    result: existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, "utf8")) : null,
  }
}

function emit(route: string, env: NodeJS.ProcessEnv = process.env) {
  return spawnSync("bash", [SCRIPT, "--emit-adapter", route], { encoding: "utf8", env })
}

// The script honors CROSS_MODEL_EFFORT_OVERRIDE, so default-posture assertions
// must not inherit an ambient override from the suite's own environment.
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.CROSS_MODEL_EFFORT_OVERRIDE
  env.CE_CODEX_MANAGED = "off"
  delete env.CE_CODEX_MANAGED_LAUNCHER
  return env
}

function launcherFixture(f: ReturnType<typeof fixture>, mode: "success" | "start-failure" | "running" = "success") {
  const home = path.join(f.root, "home")
  const record = path.join(home, ".config", "cosma", "codex-agent-launcher")
  const launcher = path.join(f.root, "managed launcher.py")
  const trace = path.join(f.capture, "launcher.jsonl")
  const worker = {
    terminal_status: "completed", summary: "implemented", changed_files: ["result.txt"],
    evidence: ["focused test passed"], scope_expansion: null,
  }
  const finalAnswer = ["```json", JSON.stringify(worker), "```"].join("\n")
  mkdirSync(path.dirname(record), { recursive: true })
  writeFileSync(record, `${launcher}\n`)
  writeFileSync(launcher, `import json, os, sys, time
from pathlib import Path

trace = Path(${JSON.stringify(trace)})
argv = sys.argv[1:]
command = argv[0]
mode = ${JSON.stringify(mode)}
previous = trace.read_text() if trace.exists() else ""
with trace.open("a") as log:
    log.write(json.dumps({"argv": argv, "runtime": os.getenv("XDG_RUNTIME_DIR"), "bus": os.getenv("DBUS_SESSION_BUS_ADDRESS")}) + "\\n")

if command == "start":
    cwd = Path(argv[argv.index("--cwd") + 1])
    brief = Path(argv[argv.index("--brief-file") + 1]).read_text()
    assert "Implement U3 only." in brief
    print("fake-job")
    if mode == "start-failure":
        sys.exit(1)
    (cwd / "result.txt").write_text("READY\\n")
elif command == "wait":
    assert argv[1] == "fake-job" or argv[-1] == "fake-job"
    assert 0 < float(argv[argv.index("--max-secs") + 1]) <= 60
    if mode == "running":
        time.sleep(0.1)
    print(json.dumps({"status": "running" if mode == "running" or '"wait"' not in previous else "completed"}))
elif command == "result":
    report = {
        "exit_status": 1 if mode == "start-failure" else 0,
        "failure": {"stage": "schema check", "cause": "fake version mismatch"} if mode == "start-failure" else None,
        "final_answer": ${JSON.stringify(finalAnswer)},
        "reviews": [{"command": ${JSON.stringify(JSON.stringify({ ...worker, summary: "review text is not the final answer" }))}}],
        "refusals": [{"status": "denied"}],
    }
    print(json.dumps(report))
elif command == "stop":
    assert argv[1:] == ["fake-job"]
    print(json.dumps({"status": "stopped"}))
else:
    sys.exit(99)
`, { mode: 0o600 })
  const calls = (): { argv: string[]; runtime: string; bus: string }[] => existsSync(trace)
    ? readFileSync(trace, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : []
  const bin = fakeBin("codex", f.capture)
  const env = {
    ...cleanEnv(), HOME: home, PATH: `${bin}:${process.env.PATH}`, CE_CODEX_MANAGED: "",
    XDG_RUNTIME_DIR: path.join(f.root, "runtime"), DBUS_SESSION_BUS_ADDRESS: "unix:path=/fake/bus",
  }
  return { record, launcher, calls, env }
}

describe("ce-work Codex launcher selection", () => {
  test("a missing recorded launcher is an unavailable startup with a named cause", () => {
    const f = fixture()
    const { env, launcher } = launcherFixture(f)
    rmSync(launcher)
    const result = run("codex", f, env)
    expect(result.code).toBe(2)
    expect(result.result).toMatchObject({
      terminal_status: "unavailable", actual_route: null, failure_reason: expect.stringContaining("managed Codex launcher missing"),
    })
    expect(existsSync(path.join(f.capture, "argv"))).toBe(false)
  })

  test("the managed launcher inherits the bus, model, and effort and yields the usual result receipt", () => {
    const f = fixture()
    const { calls, env } = launcherFixture(f)
    const result = run("codex", f, { ...env, CROSS_MODEL_EFFORT_OVERRIDE: "max" }, undefined, { model_requested: "gpt-5.6-sol" })
    expect(result.code).toBe(0)
    expect(result.result).toMatchObject({
      terminal_status: "completed", summary: "implemented", actual_route: "codex", model_requested: "gpt-5.6-sol",
      model_actual: "unverified", model_receipt_status: "unverified", changed_files: ["result.txt"],
    })
    const received = calls()
    expect(received.map(({ argv }) => argv[0])).toEqual(["start", "wait", "wait", "result"])
    expect(received[0]).toMatchObject({ runtime: env.XDG_RUNTIME_DIR, bus: env.DBUS_SESSION_BUS_ADDRESS })
    const argv = received[0].argv
    expect(argv[argv.indexOf("--cwd") + 1]).toBe(realpathSync(f.workspace))
    expect(argv[argv.indexOf("--model") + 1]).toBe("gpt-5.6-sol")
    expect(argv[argv.indexOf("--effort") + 1]).toBe("max")
    expect(received.flatMap(({ argv }) => argv)).not.toContain("--ignore-user-config")
    expect(received.flatMap(({ argv }) => argv)).not.toContain("--ignore-rules")
    const introspection = emit("codex", env)
    expect(introspection.status).toBe(0)
    expect(introspection.stdout).not.toMatch(/--ignore-user-config|--ignore-rules/)
    expect(existsSync(path.join(f.capture, "argv"))).toBe(false)
    expect(readFileSync(result.result.raw_log, "utf8")).toContain('"refusals"')
  })

  test("an explicit launcher overrides the record and preserves a failed start's report", () => {
    const f = fixture()
    const { calls, env, launcher, record } = launcherFixture(f, "start-failure")
    writeFileSync(record, `${launcher}.missing\n`)
    const result = run("codex", f, { ...env, CE_CODEX_MANAGED_LAUNCHER: launcher })
    expect(result.code).toBe(2)
    expect(result.result.terminal_status).toBe("unavailable")
    expect(result.result.failure_reason).toContain("fake version mismatch")
    expect(result.result.failure_reason).toContain("schema check")
    expect(calls().map(({ argv }) => argv[0])).toEqual(["start", "result"])
    expect(existsSync(path.join(f.capture, "argv"))).toBe(false)
  })

  test.each(["no record", "explicit off"])("standalone keeps its argv and stripped environment with %s", (mode) => {
    const f = fixture()
    const { calls, env, launcher, record } = launcherFixture(f)
    if (mode === "no record") rmSync(record)
    const standaloneEnv = mode === "no record" ? env : { ...env, CE_CODEX_MANAGED: "off", CE_CODEX_MANAGED_LAUNCHER: launcher }
    const result = run("codex", f, standaloneEnv)
    expect(result.code).toBe(0)
    expect(result.result.terminal_status).toBe("completed")
    expect(emit("codex", standaloneEnv).stdout).toBe(
      "codex exec --ignore-user-config --ignore-rules --ephemeral -s workspace-write -C <workspace> --json -o <raw-result> -c model_reasoning_effort=high - \n",
    )
    expect(readFileSync(path.join(f.capture, "env"), "utf8")).not.toMatch(/XDG_RUNTIME_DIR|DBUS_SESSION_BUS_ADDRESS/)
    expect(calls()).toEqual([])
  })

  test.each(["SIGTERM", "SIGINT", "SIGHUP"] as const)("%s stops the detached managed job", async (signal) => {
    if (process.platform === "win32") return
    const f = fixture()
    const { calls, env } = launcherFixture(f, "running")
    const dispatch = prepareDispatch("codex", f, env)
    const child = Bun.spawn(dispatch.command, { env: dispatch.env, stdout: "ignore", stderr: "ignore" })
    try {
      const deadline = Date.now() + 5000
      while (child.exitCode === null && Date.now() < deadline && !calls().some(({ argv }) => argv[0] === "wait")) {
        await Bun.sleep(20)
      }
      expect(calls().some(({ argv }) => argv[0] === "wait")).toBe(true)
      child.kill(signal)
      const stopDeadline = Date.now() + 5000
      while (child.exitCode === null && Date.now() < stopDeadline) await Bun.sleep(20)
      expect(child.exitCode).toBe(143)
      expect(calls().filter(({ argv }) => argv[0] === "stop").map(({ argv }) => argv)).toEqual([["stop", "fake-job"]])
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL")
      await child.exited
    }
  })
})

describe("ce-work fixed write routes", () => {
  test("production argv uses the qualified noninteractive write posture", () => {
    for (const route of ROUTES) expect(emit(route, cleanEnv()).status).toBe(0)

    const codex = emit("codex", cleanEnv()).stdout
    expect(codex).toContain("exec")
    expect(codex).toContain("--ephemeral")
    expect(codex).toContain("-s workspace-write")
    expect(codex).toContain("-C <workspace>")
    expect(codex).toContain("-c model_reasoning_effort=high")

    const claude = emit("claude", cleanEnv()).stdout
    expect(claude).toContain("--safe-mode")
    expect(claude).toContain("--permission-mode bypassPermissions")
    expect(claude).toContain("--tools Read,Write,Edit,Bash")
    expect(claude).toContain("--allowed-tools Bash(*)")
    expect(claude).toContain("--no-session-persistence")
    expect(claude).not.toContain("--model")

    const grok = emit("grok-cli", cleanEnv()).stdout
    expect(grok).toContain("--cwd <workspace>")
    expect(grok).toContain("--permission-mode acceptEdits")
    expect(grok).toContain("--no-memory")
    expect(grok).toContain("--no-subagents")
    expect(grok).not.toContain("--model")

    for (const route of ["cursor", "composer", "grok-cursor"]) {
      const command = emit(route, cleanEnv()).stdout
      expect(command).toContain("--sandbox enabled")
      expect(command).toContain("--workspace <workspace>")
      expect(command).toContain("--output-format stream-json")
    }
    expect(emit("cursor", cleanEnv()).stdout).not.toContain("--model")
    expect(emit("composer", cleanEnv()).stdout).toContain("--model composer-2.5-fast")
    expect(emit("grok-cursor", cleanEnv()).stdout).toContain("--model cursor-grok-4.6-high")
    const opencode = emit("opencode", cleanEnv()).stdout
    expect(opencode).toContain("opencode run")
    expect(opencode).toContain("--dir <workspace>")
    expect(opencode).toContain("--format json")
    expect(opencode).toContain("--auto")
    expect(opencode).toContain("--file <prompt-file>")
    expect(opencode).not.toContain("--model")
  })

  test("CROSS_MODEL_EFFORT_OVERRIDE retunes the effort-taking routes and stays off by default", () => {
    const withOverride = (route: string, value: string) =>
      emit(route, { ...cleanEnv(), CROSS_MODEL_EFFORT_OVERRIDE: value })

    expect(emit("codex", cleanEnv()).stdout).toContain("-c model_reasoning_effort=high")
    expect(withOverride("codex", "xhigh").stdout).toContain("-c model_reasoning_effort=xhigh")
    expect(withOverride("codex", "minimal").stdout).toContain("-c model_reasoning_effort=minimal")
    const codexMax = withOverride("codex", "max")
    expect(codexMax.status).toBe(0)
    expect(codexMax.stdout).toContain("-c model_reasoning_effort=max")
    expect(codexMax.stdout).not.toContain("model_reasoning_effort=high")

    expect(emit("claude", cleanEnv()).stdout).toContain("--effort high")
    expect(withOverride("claude", "low").stdout).toContain("--effort low")
    expect(withOverride("claude", "max").stdout).toContain("--effort max")

    expect(emit("grok-cli", cleanEnv()).stdout).toContain("--effort high")
    expect(withOverride("grok-cli", "medium").stdout).toContain("--effort medium")
  })

  test("CROSS_MODEL_EFFORT_OVERRIDE rejects tiers the route cannot honor, failing closed before dispatch", () => {
    const rejected = (route: string, value: string) => {
      const proc = emit(route, { ...cleanEnv(), CROSS_MODEL_EFFORT_OVERRIDE: value })
      expect(proc.status).toBe(2)
      expect(proc.stderr).toContain(`effort override '${value}' not compatible with route '${route}'`)
    }

    rejected("codex", "ultra") // codex tops out at max
    rejected("codex", "none")
    rejected("claude", "minimal")
    rejected("grok-cli", "xhigh")
    rejected("grok-cli", "max")
    // routes with no effort knob reject any override rather than silently ignoring it
    rejected("cursor", "high")
    rejected("composer", "high")
    rejected("grok-cursor", "high")
    // opencode is effort-bearing through --variant, but only for its own enum
    rejected("opencode", "bogus")
  })

  test("per-route effort allow-lists match the review adapters", () => {
    const allowLists = (script: string) =>
      readFileSync(script, "utf8")
        .split("\n")
        .filter((line) => /^\s+(claude|codex|grok-cli|opencode):[a-z]+(\|\1:[a-z]+)*\) ;;$/.test(line))
        .map((line) => line.trim())
    const work = allowLists(SCRIPT)
    expect(work).toHaveLength(4)
    expect(work).toContain("codex:minimal|codex:low|codex:medium|codex:high|codex:xhigh|codex:max) ;;")
    for (const review of [
      "skills/ce-code-review/scripts/cross-model-adversarial-review.sh",
      "skills/ce-doc-review/scripts/cross-model-doc-review.sh",
    ]) {
      expect(allowLists(path.join(process.cwd(), review))).toEqual(work)
    }
  })

  test("opencode carries the override through --variant, matching the review adapters", () => {
    const out = emit("opencode", { ...cleanEnv(), CROSS_MODEL_EFFORT_OVERRIDE: "max" }).stdout
    expect(out).toContain("--variant max")
    expect(emit("opencode", cleanEnv()).stdout).not.toContain("--variant")
  })

  test.each(ROUTES)("%s receives one workspace and bounded packet", (route) => {
    const f = fixture()
    const bin = fakeBin(route, f.capture)
    const result = run(
      route,
      f,
      {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        ...(route === "grok-cursor" ? { CE_WORK_CURSOR_INTERMEDIARY_SANCTIONED: "1" } : {}),
      },
    )
    expect(result.code).toBe(0)
    expect(readFileSync(path.join(f.capture, "pwd"), "utf8")).toBe(realpathSync(f.workspace))
    const stdin = readFileSync(path.join(f.capture, "stdin"), "utf8")
    expect(stdin).toContain("Implement U3 only.")
    expect(stdin).toContain("Leave the completed working tree uncommitted")
    expect(stdin).toContain("`git add`")
    expect(stdin).toContain("`git commit`")
    if (route === "codex") {
      expect(stdin).toContain("host-owned")
      expect(stdin).toContain("Socket binds")
      expect(stdin).toContain("EPERM")
    } else {
      expect(stdin).not.toContain("Socket binds")
      expect(stdin).not.toContain("EPERM")
    }
    if (route === "cursor" || route === "composer" || route === "grok-cursor") {
      expect(readFileSync(path.join(f.capture, "argv"), "utf8")).not.toContain("Implement U3 only.")
    }
    expect(readFileSync(path.join(f.capture, "env"), "utf8")).toContain("PYTHONDONTWRITEBYTECODE=1")
    expect(readFileSync(path.join(f.workspace, "result.txt"), "utf8")).toBe("READY\n")
    expect(result.result.terminal_status).toBe("completed")
    expect(result.result.requested_route).toBe(route)
    expect(result.result.actual_route).toBe(route)
    expect(result.result.activity_posture).toBe("incremental")
    expect(result.result.packet_digest).toBe(createHash("sha256").update(readFileSync(f.packet)).digest("hex"))
    expect(realpathSync(result.result.raw_log)).toBe(path.join(realpathSync(f.resultDir), "adapter.log"))
    if (route === "codex" || route === "grok-cli" || route === "opencode") {
      expect(result.result.model_actual).toBe("unverified")
      expect(result.result.model_receipt_status).toBe("unverified")
    } else {
      expect(result.result.model_actual).not.toBe("unverified")
      expect(result.result.model_receipt_status).toBe("verified")
    }
  })

  test("Cursor accepts a controller-bounded explicit model while Composer stays family-locked", () => {
    const cursor = emit("cursor", {
      ...process.env,
      CE_WORK_MODEL_OVERRIDE_TARGET: "cursor",
      CE_WORK_MODEL_OVERRIDE: "claude-sonnet-5-low",
    })
    expect(cursor.status).toBe(0)
    expect(cursor.stdout).toContain("--model claude-sonnet-5-low")

    for (const reserved of ["composer", "composer-2.5-fast", "grok-4.6", "cursor-grok-4.6-high"]) {
      const rejected = emit("cursor", {
        ...process.env,
        CE_WORK_MODEL_OVERRIDE_TARGET: "cursor",
        CE_WORK_MODEL_OVERRIDE: reserved,
      })
      expect(rejected.status).toBe(2)
      expect(rejected.stderr).toContain("not compatible")
    }

    const composer = emit("composer", {
      ...process.env,
      CE_WORK_MODEL_OVERRIDE_TARGET: "composer",
      CE_WORK_MODEL_OVERRIDE: "gpt-5.6-sol",
    })
    expect(composer.status).toBe(2)
    expect(composer.stderr).toContain("not compatible")

    const compatible = emit("composer", {
      ...process.env,
      CE_WORK_MODEL_OVERRIDE_TARGET: "composer",
      CE_WORK_MODEL_OVERRIDE: "composer-next-fast",
    })
    expect(compatible.status).toBe(0)
    expect(compatible.stdout).toContain("--model composer-next-fast")
  })

  test("Cursor model probes use the credential-sanitized route environment", () => {
    const f = fixture()
    const bin = fakeBin("cursor", f.capture)
    const cursorAgent = path.join(bin, "cursor-agent")
    writeFileSync(
      cursorAgent,
      readFileSync(cursorAgent, "utf8").replace("model='Cursor Grok 4.6'", "model='Sonnet 5 1M Low'"),
    )
    chmodSync(cursorAgent, 0o755)
    const cursorConfig = path.join(f.root, "cursor-config")
    const apiSecret = "SENTINEL-api-secret-credential"
    const result = run(
      "cursor",
      f,
      {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CURSOR_CONFIG_DIR: cursorConfig,
        OPENAI_API_KEY: apiSecret,
      },
      undefined,
      { model_requested: "claude-sonnet-5-low" },
    )

    expect(result.code).toBe(0)
    const probeEnv = readFileSync(path.join(f.capture, "probe-env"), "utf8")
    const dispatchEnv = readFileSync(path.join(f.capture, "env"), "utf8")
    for (const observed of [probeEnv, dispatchEnv]) {
      expect(observed).toContain(`CURSOR_CONFIG_DIR=${cursorConfig}`)
      expect(observed).not.toContain("OPENAI_API_KEY=")
      expect(observed).not.toContain(apiSecret)
    }
    expect(result.result.model_actual).toBe("Sonnet 5 1M Low")
    expect(result.result.model_receipt_status).toBe("verified")
  })

  test("Claude dispatch preserves USER for Keychain auth without forwarding credential variables", () => {
    const f = fixture()
    const bin = fakeBin("claude", f.capture)
    const user = "ce-work-keychain-user"
    const apiSecret = "SENTINEL-claude-api-secret"
    const oauthSecret = "SENTINEL-claude-oauth-secret"
    const result = run("claude", f, {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      USER: user,
      ANTHROPIC_API_KEY: apiSecret,
      CLAUDE_CODE_OAUTH_TOKEN: oauthSecret,
    })

    expect(result.code).toBe(0)
    const dispatchEnv = readFileSync(path.join(f.capture, "env"), "utf8")
    expect(dispatchEnv).toContain(`USER=${user}`)
    expect(dispatchEnv).not.toContain("ANTHROPIC_API_KEY=")
    expect(dispatchEnv).not.toContain("CLAUDE_CODE_OAUTH_TOKEN=")
    expect(dispatchEnv).not.toContain(apiSecret)
    expect(dispatchEnv).not.toContain(oauthSecret)
  })

  test("target-scoped model overrides do not make unrelated route probes unavailable", () => {
    const composerOverride = {
      ...process.env,
      CE_WORK_MODEL_OVERRIDE_TARGET: "composer",
      CE_WORK_MODEL_OVERRIDE: "composer-next-fast",
    }

    const codex = emit("codex", composerOverride)
    expect(codex.status).toBe(0)
    expect(codex.stdout).not.toContain("--model")
    expect(codex.stdout).not.toContain("composer-next-fast")
    expect(emit("composer", composerOverride).stdout).toContain("--model composer-next-fast")
  })

  test("malformed model override bindings remain unavailable", () => {
    for (const env of [
      { CE_WORK_MODEL_OVERRIDE: "composer-next-fast" },
      { CE_WORK_MODEL_OVERRIDE_TARGET: "composer" },
      { CE_WORK_MODEL_OVERRIDE_TARGET: "unknown", CE_WORK_MODEL_OVERRIDE: "composer-next-fast" },
    ]) {
      const rejected = emit("codex", { ...process.env, ...env })
      expect(rejected.status).toBe(2)
      expect(rejected.stderr).toContain("not compatible")
    }
  })

  test.each([
    ["cursor", "claude-sonnet-5-low"],
    ["claude", "sonnet"],
    ["grok-cli", "grok-4.6"],
  ] as const)("production %s dispatch honors explicit model %s while defaults stay harness-configured", (route, model) => {
    const f = fixture()
    const bin = fakeBin(route, f.capture)
    const result = run(
      route,
      f,
      { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      undefined,
      { model_requested: model },
    )
    expect(result.code).toBe(0)
    expect(readFileSync(path.join(f.capture, "argv"), "utf8")).toContain(model)
    expect(result.result.model_requested).toBe(model)
  })

  test("production dispatch derives the model from controller authorization, not ambient overrides", () => {
    const f = fixture()
    const bin = fakeBin("composer", f.capture)
    const digest = createHash("sha256").update(readFileSync(f.packet)).digest("hex")
    const result = run(
      "composer",
      f,
      {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CE_WORK_MODEL_OVERRIDE_TARGET: "composer",
        CE_WORK_MODEL_OVERRIDE: "gpt-forged",
      },
      digest,
      { model_requested: "composer-next-fast" },
    )
    expect(result.code).toBe(0)
    const argv = readFileSync(path.join(f.capture, "argv"), "utf8")
    expect(argv).toContain("composer-next-fast")
    expect(argv).not.toContain("gpt-forged")
    expect(result.result.model_requested).toBe("composer-next-fast")
  })

  test.each([
    ["route mismatch", "codex", { route: "claude" }],
    ["Composer family mismatch", "composer", { model_requested: "gpt-5.6-sol" }],
    ["Cursor Composer model", "cursor", { model_requested: "composer-2.5-fast" }],
    ["Cursor unqualified Grok model", "cursor", { model_requested: "grok-4.6" }],
    ["Cursor Grok route model", "cursor", { model_requested: "cursor-grok-4.6-high" }],
    ["adapter-unsafe model token", "cursor", { model_requested: "model@beta" }],
  ] as const)("forged %s authorization is rejected before CLI invocation", (_name, route, overrides) => {
    const f = fixture()
    const bin = fakeBin(route, f.capture)
    const digest = createHash("sha256").update(readFileSync(f.packet)).digest("hex")
    const result = run(route, f, { ...process.env, PATH: `${bin}:${process.env.PATH}` }, digest, overrides, true)
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("controller authorization rejected")
    expect(result.result).toBeNull()
    expect(existsSync(path.join(f.capture, "argv"))).toBe(false)
    expect(existsSync(path.join(f.capture, "stdin"))).toBe(false)
  })

  test("controller handshake rejects hand-authored, cross-attempt, and cross-unit authorization", () => {
    for (const overrides of [
      {},
      { attempt_id: "attempt-2" },
      { unit_id: "U4" },
    ]) {
      const f = fixture()
      const bin = fakeBin("codex", f.capture)
      const digest = createHash("sha256").update(readFileSync(f.packet)).digest("hex")
      const result = run("codex", f, { ...process.env, PATH: `${bin}:${process.env.PATH}` }, digest, overrides, true)
      expect(result.code).toBe(2)
      expect(result.stderr).toContain("controller dispatch authorization failed")
      expect(result.result).toBeNull()
      expect(existsSync(path.join(f.capture, "argv"))).toBe(false)
      expect(existsSync(path.join(f.capture, "stdin"))).toBe(false)
    }
  })

  test("controller handshake rejects a shell-prefixed runner argv before CLI invocation", () => {
    const f = fixture()
    const bin = fakeBin("codex", f.capture)
    const digest = createHash("sha256").update(readFileSync(f.packet)).digest("hex")
    const result = run("codex", f, { ...process.env, PATH: `${bin}:${process.env.PATH}` }, digest, {}, false, ["bash"])

    expect(result.code).toBe(2)
    expect(result.stderr).toContain("controller dispatch authorization failed")
    expect(result.result).toBeNull()
    expect(existsSync(path.join(f.capture, "argv"))).toBe(false)
  })

  test("Grok through Cursor requires its controller-sanctioned intermediary", () => {
    const f = fixture()
    const bin = fakeBin("grok-cursor", f.capture)
    const blocked = run(
      "grok-cursor",
      f,
      { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      createHash("sha256").update(readFileSync(f.packet)).digest("hex"),
      { intermediaries: [] },
      true,
    )
    expect(blocked.code).toBe(2)
    expect(blocked.stderr).toContain("authorization")
    expect(blocked.result).toBeNull()
    expect(existsSync(path.join(f.capture, "argv"))).toBe(false)

    const allowed = run("grok-cursor", f, { ...process.env, PATH: `${bin}:${process.env.PATH}` })
    expect(allowed.code).toBe(0)
  })

  test("a quiet route reports no activity before byte growth", () => {
    const quiet = fixture()
    const quietBin = temp("ce-work-bin-")
    writeFileSync(path.join(quietBin, "claude"), `#!/bin/sh
cat > '${quiet.capture}/stdin'
sleep 1.1
exit 7
`)
    chmodSync(path.join(quietBin, "claude"), 0o755)
    const quietResult = run("claude", quiet, {
      ...process.env,
      PATH: `${quietBin}:${process.env.PATH}`,
      CE_WORK_ACTIVITY_POLL_SECS: "1",
    })
    expect(quietResult.code).toBe(1)
    expect(quietResult.stderr).not.toContain("output-updated")
  })

  test("raw route output is capped", () => {
    const noisy = fixture()
    const noisyBin = temp("ce-work-bin-")
    writeFileSync(path.join(noisyBin, "claude"), `#!/bin/sh
cat > '${noisy.capture}/stdin'
printf '%02048d' 0
`)
    chmodSync(path.join(noisyBin, "claude"), 0o755)
    const noisyResult = run("claude", noisy, {
      ...process.env,
      PATH: `${noisyBin}:${process.env.PATH}`,
      CE_WORK_MAX_RAW_BYTES: "256",
    })
    expect(noisyResult.code).toBe(1)
    expect(noisyResult.result.terminal_status).toBe("unavailable")
    expect(noisyResult.result.failure_reason).toContain("exceeded 256 bytes")
    expect(statSync(path.join(noisy.resultDir, "adapter.log")).size).toBeLessThanOrEqual(256)
  })

  test("an app-bundled codex CLI off PATH satisfies the codex route (issue #1272)", () => {
    const f = fixture()
    const bin = fakeBin("codex", f.capture)
    const bundle = path.join(temp("ce-work-bundle-"), "Codex.app", "Contents", "Resources")
    mkdirSync(bundle, { recursive: true })
    copyFileSync(path.join(bin, "codex"), path.join(bundle, "codex"))
    chmodSync(path.join(bundle, "codex"), 0o755)
    // Hide any real codex from PATH without losing co-located tools: drop dirs
    // that contain codex, then re-expose the tools the worker needs via symlinks.
    const realDirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)
    const tools = temp("ce-work-tools-")
    for (const tool of ["python3", "python", "git", "jq", "bash", "sh", "env"]) {
      const dir = realDirs.find((d) => existsSync(path.join(d, tool)))
      if (dir) symlinkSync(path.join(dir, tool), path.join(tools, tool))
    }
    const pathWithoutCodex = [tools, ...realDirs.filter((d) => !existsSync(path.join(d, "codex")))].join(path.delimiter)
    const result = run("codex", f, { ...process.env, PATH: pathWithoutCodex, CROSS_MODEL_CODEX_APP_DIRS: bundle })
    expect(result.result.terminal_status).toBe("completed")
    expect(existsSync(path.join(f.capture, "argv"))).toBe(true)
  })

  test.each(["claude", "grok-cli", "opencode"] as const)("%s is unavailable when enforceable confinement is required", (route) => {
    const f = fixture()
    const bin = fakeBin(route, f.capture)
    const result = run(route, f, {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      CE_WORK_REQUIRE_ENFORCED_CONFINEMENT: "1",
    })
    expect(result.code).toBe(2)
    expect(result.result.terminal_status).toBe("unavailable")
    expect(result.result.failure_reason).toContain("cooperative")
    expect(existsSync(path.join(f.capture, "argv"))).toBe(false)
  })
})

describe("ce-work adapter results, identity, and secret handling", () => {
  test("packet bytes must match the controller-provided digest before egress", () => {
    const f = fixture()
    const expected = createHash("sha256").update(readFileSync(f.packet)).digest("hex")
    writeFileSync(f.packet, "Implement a different and broader unit.\n")
    const bin = fakeBin("claude", f.capture)
    const result = run("claude", f, { ...process.env, PATH: `${bin}:${process.env.PATH}` }, expected)
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("packet digest")
    expect(existsSync(path.join(f.capture, "argv"))).toBe(false)
    expect(result.result).toBeNull()
  })

  test("worker output cannot forge host-owned route and identity receipts", () => {
    const f = fixture()
    const response = JSON.stringify({
      terminal_status: "completed",
      summary: "implemented",
      changed_files: ["result.txt"],
      evidence: ["focused test passed"],
      scope_expansion: null,
      requested_route: "codex",
      actual_route: "codex",
      target: "codex",
      harness: "codex",
      intermediaries: [],
      model_requested: "gpt-forged",
      model_actual: "gpt-forged",
      model_receipt_status: "verified",
    })
    const bin = fakeBin("claude", f.capture, response)
    const result = run("claude", f, { ...process.env, PATH: `${bin}:${process.env.PATH}` })
    expect(result.code).toBe(1)
    expect(result.result.terminal_status).toBe("failed")
    expect(result.result.failure_reason).toContain("schema")
    expect(result.result.requested_route).toBe("claude")
    expect(result.result.actual_route).toBe("claude")
    expect(result.result.target).toBe("claude")
    expect(result.result.harness).toBe("claude")
    expect(result.result.model_requested).toBe("auto")
    expect(result.result.model_actual).toBe("claude-fable-5")
  })

  test("a route failure returns evidence without changing recipient", () => {
    const f = fixture()
    const bin = fakeBin("grok-cli", f.capture)
    writeFileSync(path.join(bin, "grok"), `#!/bin/sh\nprintf '%s\\n' "$@" > '${f.capture}/argv'\nprintf 'quota exhausted\\n' >&2\nexit 7\n`)
    chmodSync(path.join(bin, "grok"), 0o755)
    const cursorMarker = path.join(f.capture, "cursor-invoked")
    writeFileSync(path.join(bin, "cursor-agent"), `#!/bin/sh\n: > '${cursorMarker}'\n`)
    chmodSync(path.join(bin, "cursor-agent"), 0o755)
    const result = run("grok-cli", f, { ...process.env, PATH: `${bin}:${process.env.PATH}` })
    expect(result.code).toBe(1)
    expect(result.result.terminal_status).toBe("failed")
    expect(result.result.failure_reason).toContain("exit 7")
    expect(readFileSync(path.join(f.resultDir, "adapter.log"), "utf8")).toContain("quota exhausted")
    expect(existsSync(cursorMarker)).toBe(false)
  })

  test.each(["adapter-log", "result-dir"] as const)(
    "refuses a worker-substituted %s symlink without touching its outside target",
    (substitution) => {
      const f = fixture()
      const bin = temp("ce-work-bin-")
      const expectedResultDir = path.join(f.runs, "route-run", "units", "U3", "result")
      const outsideDir = path.join(f.root, "outside")
      const outsideLog = path.join(outsideDir, "adapter.log")
      mkdirSync(outsideDir)
      writeFileSync(outsideLog, "outside evidence\n", { mode: 0o644 })
      chmodSync(outsideLog, 0o644)
      const substitute = substitution === "adapter-log"
        ? `ln -s '${outsideLog}' '${expectedResultDir}/adapter.log'`
        : `mv '${expectedResultDir}' '${expectedResultDir}.original'\nln -s '${outsideDir}' '${expectedResultDir}'`
      writeFileSync(path.join(bin, "claude"), `#!/bin/sh
set -eu
cat > '${f.capture}/stdin'
${substitute}
printf '%s\n' '{"type":"system","subtype":"init","model":"claude-fable-5"}'
printf '%s\n' '{"terminal_status":"completed","summary":"done","changed_files":[],"evidence":[],"scope_expansion":null}'
`)
      chmodSync(path.join(bin, "claude"), 0o755)

      const result = run("claude", f, { ...process.env, PATH: `${bin}:${process.env.PATH}` })

      expect(result.code).toBe(2)
      expect(result.stderr).toContain("adapter log retention refused")
      expect(readFileSync(outsideLog, "utf8")).toBe("outside evidence\n")
      expect(statSync(outsideLog).mode & 0o777).toBe(0o644)
    },
  )

  test.each([
    ["normal", 0],
    ["launched-route failure", 7],
  ] as const)(
    "the %s receipt path fails closed when an exited cooperative route swaps the result dir after log retention",
    (_receiptPath, routeExit) => {
      const f = fixture()
      const bin = temp("ce-work-bin-")
      const expectedResultDir = path.join(f.runs, "route-run", "units", "U3", "result")
      const originalResultDir = `${expectedResultDir}.original`
      const outsideDir = path.join(f.root, "outside")
      const outsideResult = path.join(outsideDir, "implementation-result.json")
      const publishStarted = path.join(f.capture, "receipt-publication-started")
      const swapDone = path.join(f.capture, "result-dir-swap-done")
      const python3 = spawnSync("which", ["python3"], { encoding: "utf8" }).stdout.trim()
      mkdirSync(outsideDir)
      writeFileSync(outsideResult, '{"sentinel":"outside"}\n', { mode: 0o644 })
      chmodSync(outsideResult, 0o644)

      writeFileSync(path.join(bin, "python3"), `#!/bin/sh
set -eu
case "\${2:-}" in
  *"result receipt publication refused"*)
    : > '${publishStarted}'
    attempts=0
    while [ ! -e '${swapDone}' ]; do
      attempts=$((attempts + 1))
      [ "$attempts" -lt 500 ] || exit 97
      sleep 0.01
    done
    ;;
esac
exec '${python3}' "$@"
`)
      chmodSync(path.join(bin, "python3"), 0o755)
      writeFileSync(path.join(bin, "claude"), `#!/bin/sh
set -eu
cat > '${f.capture}/stdin'
(
  while [ ! -e '${publishStarted}' ]; do sleep 0.01; done
  mv '${expectedResultDir}' '${originalResultDir}'
  ln -s '${outsideDir}' '${expectedResultDir}'
  : > '${swapDone}'
) </dev/null >/dev/null 2>&1 &
printf '%s\n' '{"type":"system","subtype":"init","model":"claude-fable-5"}'
printf '%s\n' '{"terminal_status":"completed","summary":"done","changed_files":[],"evidence":[],"scope_expansion":null}'
exit ${routeExit}
`)
      chmodSync(path.join(bin, "claude"), 0o755)

      const result = run("claude", f, { ...process.env, PATH: `${bin}:${process.env.PATH}` })

      expect(result.code).toBe(2)
      expect(result.stderr).toContain("result receipt publication refused")
      expect(readFileSync(outsideResult, "utf8")).toBe('{"sentinel":"outside"}\n')
      expect(statSync(outsideResult).mode & 0o777).toBe(0o644)
      expect(existsSync(path.join(originalResultDir, "implementation-result.json"))).toBe(false)
      expect(readFileSync(path.join(originalResultDir, "adapter.log"), "utf8")).toContain("terminal_status")
    },
  )

  test("scope expansion is terminalized for host handling", () => {
    const f = fixture()
    const response = '{"terminal_status":"scope_expansion","summary":"shared contract needed","changed_files":[],"evidence":[],"scope_expansion":{"requested_paths":["shared.ts"],"reason":"required by unit"}}'
    const bin = fakeBin("claude", f.capture, response)
    const result = run("claude", f, { ...process.env, PATH: `${bin}:${process.env.PATH}` })
    expect(result.code).toBe(0)
    expect(result.result.terminal_status).toBe("scope_expansion")
    expect(result.result.scope_expansion.requested_paths).toEqual(["shared.ts"])
  })

  test("blocked output is terminalized for host handling", () => {
    const f = fixture()
    const response = '{"terminal_status":"blocked","summary":"needs host input","changed_files":[],"evidence":["dependency unavailable"],"scope_expansion":null}'
    const bin = fakeBin("claude", f.capture, response)
    const result = run("claude", f, { ...process.env, PATH: `${bin}:${process.env.PATH}` })
    expect(result.code).toBe(0)
    expect(result.result).toMatchObject({
      terminal_status: "blocked",
      summary: "needs host input",
      evidence: ["dependency unavailable"],
    })
  })

  test.each([
    ["claude-fable-5", "verified"],
    ["claude-fable-5\\u001b[1m", "verified"],
    ["claude-opus-4-8", "mismatch"],
    ["", "unverified"],
  ] as const)("Claude served-model receipt %s normalizes as %s", (served, receipt) => {
    const f = fixture()
    const bin = fakeBin("claude", f.capture)
    const body = `#!/bin/sh
cat > '${f.capture}/stdin'
printf 'READY\\n' > result.txt
${served ? `printf '%s\\n' '{"type":"system","subtype":"init","model":"${served}"}'` : "printf '%s\\n' '{\"type\":\"activity\"}'"}
printf '%s\\n' '{"terminal_status":"completed","summary":"done","changed_files":["result.txt"],"evidence":[],"scope_expansion":null}'
`
    writeFileSync(path.join(bin, "claude"), body)
    chmodSync(path.join(bin, "claude"), 0o755)
    const result = run(
      "claude",
      f,
      { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      undefined,
      { model_requested: "fable" },
    )
    expect(result.result.model_actual).toBe(served ? served.replace("\\u001b[1m", "") : "unverified")
    expect(result.result.model_receipt_status).toBe(receipt)
  })

  test.each([
    ["Sonnet 5 300K Low No Thinking", "verified"],
    ["Sonnet 5 300K High No Thinking", "mismatch"],
  ] as const)("Cursor explicit-model display receipt %s normalizes as %s", (served, receipt) => {
    const f = fixture()
    const response = '{"terminal_status":"completed","summary":"done","changed_files":["result.txt"],"evidence":[],"scope_expansion":null}'
    const bin = fakeBin("cursor", f.capture, response)
    const script = path.join(bin, "cursor-agent")
    const body = readFileSync(script, "utf8").replace("model='Cursor Grok 4.6'", `model='${served}'`)
    writeFileSync(script, body)
    chmodSync(script, 0o755)
    const result = run(
      "cursor",
      f,
      { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      undefined,
      { model_requested: "claude-sonnet-5-low" },
    )
    expect(result.result.model_actual).toBe(served)
    expect(result.result.model_receipt_status).toBe(receipt)
  })

  test("sentinel values are removed from environment, prompt, result, log, and argv", () => {
    const sentinelPrefix = "SENTINEL-credential"
    const sentinel = "SENTINEL-credential-123"
    const sentinelSuffix = "-123"
    const f = fixture()
    writeFileSync(f.packet, `Implement U3. Token: ${sentinel}\n`)
    const redactions = path.join(f.root, "redactions")
    writeFileSync(redactions, `${sentinelPrefix}\n${sentinel}\n${sentinelPrefix}\n`)
    const response = `{"terminal_status":"completed","summary":"saw ${sentinel}","changed_files":["result.txt"],"evidence":[],"scope_expansion":null}`
    const bin = fakeBin("codex", f.capture, response)
    const result = run("codex", f, {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      CE_WORK_REDACT_FILE: redactions,
      SENTINEL_ENV: sentinel,
    })
    expect(result.code).toBe(0)
    for (const file of ["argv", "stdin", "env"]) {
      expect(readFileSync(path.join(f.capture, file), "utf8")).not.toContain(sentinel)
      expect(readFileSync(path.join(f.capture, file), "utf8")).not.toContain(sentinelSuffix)
    }
    for (const file of readdirSync(f.resultDir)) {
      expect(readFileSync(path.join(f.resultDir, file), "utf8")).not.toContain(sentinel)
      expect(readFileSync(path.join(f.resultDir, file), "utf8")).not.toContain(sentinelSuffix)
      expect(statSync(path.join(f.resultDir, file)).mode & 0o777).toBe(0o600)
    }
    expect(statSync(f.resultDir).mode & 0o777).toBe(0o700)
    expect(JSON.stringify(result.result)).not.toContain(sentinel)
    expect(result.result.summary).toBe("saw [REDACTED]")
    expect(readFileSync(path.join(f.capture, "stdin"), "utf8")).toContain("[REDACTED]")
  })

  test("raw output is redacted before retained evidence is capped", () => {
    const maxRawBytes = 256
    const sentinel = "BOUNDARY-SECRET-credential-123"
    const sentinelPrefix = sentinel.slice(0, 8)
    const f = fixture()
    const redactions = path.join(f.root, "redactions")
    writeFileSync(redactions, `${sentinel}\n`)
    const bin = temp("ce-work-bin-")
    const prefix = "x".repeat(maxRawBytes - sentinelPrefix.length)
    writeFileSync(path.join(bin, "claude"), `#!/bin/sh
cat > '${f.capture}/stdin'
printf '%s' '${prefix}${sentinel}${"y".repeat(maxRawBytes)}'
`)
    chmodSync(path.join(bin, "claude"), 0o755)

    const result = run("claude", f, {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      CE_WORK_MAX_RAW_BYTES: String(maxRawBytes),
      CE_WORK_REDACT_FILE: redactions,
    })

    expect(result.code).toBe(1)
    expect(result.result.terminal_status).toBe("unavailable")
    expect(result.result.failure_reason).toContain(`exceeded ${maxRawBytes} bytes`)
    const log = readFileSync(path.join(f.resultDir, "adapter.log"), "utf8")
    expect(Buffer.byteLength(log)).toBe(maxRawBytes)
    expect(log).not.toContain(sentinel)
    expect(log).not.toContain(sentinelPrefix)
    expect(log).toContain("[REDAC")
  })

  test("oversized raw output still publishes the bounded limit receipt under pipefail", () => {
    const maxRawBytes = 256
    const f = fixture()
    const bin = temp("ce-work-bin-")
    writeFileSync(path.join(bin, "claude"), `#!/bin/sh
cat > '${f.capture}/stdin'
python3 -c 'import sys; sys.stdout.buffer.write(b"x" * 65536)'
`)
    chmodSync(path.join(bin, "claude"), 0o755)

    const result = run("claude", f, {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      CE_WORK_MAX_RAW_BYTES: String(maxRawBytes),
      CE_WORK_ACTIVITY_POLL_SECS: "1",
    })

    expect(result.code).toBe(1)
    expect(result.result.terminal_status).toBe("unavailable")
    expect(result.result.failure_reason).toBe(`fixed route raw output exceeded ${maxRawBytes} bytes`)
    expect(result.stderr).not.toContain("result dir or adapter log identity changed")
    expect(statSync(path.join(f.resultDir, "adapter.log")).size).toBe(maxRawBytes)
  })

  test("malformed terminal output is a schema failure with a redacted log", () => {
    const f = fixture()
    const bin = fakeBin("cursor", f.capture, "not-json")
    const result = run("cursor", f, { ...process.env, PATH: `${bin}:${process.env.PATH}` })
    expect(result.code).toBe(1)
    expect(result.result.terminal_status).toBe("failed")
    expect(result.result.failure_reason).toContain("schema")
    expect(existsSync(path.join(f.resultDir, "adapter.log"))).toBe(true)
  })

  test("the worker result schema pins terminal and scope-expansion shapes", () => {
    const schema = JSON.parse(readFileSync(SCHEMA, "utf8"))
    expect(schema.$schema).toContain("json-schema")
    expect(schema.required).toContain("terminal_status")
    expect(schema.properties.terminal_status.enum).toEqual(["completed", "blocked", "scope_expansion"])
    expect(schema.additionalProperties).toBe(false)
  })
})
