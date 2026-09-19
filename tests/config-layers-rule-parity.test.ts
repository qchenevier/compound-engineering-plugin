import { readFile, access } from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"

const REPO_ROOT = path.join(import.meta.dir, "..")
const FIXTURE = path.join(REPO_ROOT, "tests", "fixtures", "ce-config-layers-rule.md")

// These are the only sentences allowed to describe a two-repo-layer check.
// They decide first-run routing, not an ordinary-key value read (R12a).
const FIRST_RUN_EXCEPTIONS = new Map([
  [
    "skills/ce-product-pulse/SKILL.md",
    "First-run detection checks only the two repo layers",
  ],
  [
    "skills/ce-sweep/SKILL.md",
    "`feedback_sources` is unset in both repo layers",
  ],
  [
    "skills/ce-sweep/references/interview.md",
    "`feedback_sources` unset in both the local override file and `config.yaml`",
  ],
])

const TWO_LAYER_ONLY_PHRASES = [
  /two repo(?: CE config)? (?:files|layers)/i,
  /both repo layers/i,
  /unset in both the local override file and `config\.yaml`/i,
  /local then tracked/i,
  /local file first, then from `config\.yaml`/i,
  /read both files when they exist/i,
  /local wins when set, then this file, then the skill default/i,
  /across local then tracked/i,
]
const REPO_LAYER_ORDER = /config\.local\.yaml[^.\n]{0,40}\bthen\b[^.\n]{0,40}config\.yaml/i

// Ordinary-key cascade is byte-duplicated into every independent reader
// (skills cannot import siblings). Canonical text lives once in the fixture.
const CONSUMERS = [
  "skills/ce-plan/references/output-mode.md",
  "skills/ce-brainstorm/SKILL.md",
  "skills/ce-ideate/SKILL.md",
  "skills/ce-product-pulse/SKILL.md",
  "skills/ce-sweep/SKILL.md",
  // ce-commit-push-pr resolves the ordinary keys at Step 4, in the reference
  // the body mandates before composition.
  "skills/ce-commit-push-pr/references/compose.md",
  // The Step 5 babysit handoff is a separate reader: `auto_babysit` is consumed
  // there, and a run that reached the gate on Step 4's memory alone handed off
  // against a standing `auto_babysit: false` (#1601).
  "skills/ce-commit-push-pr/references/apply-and-handoff.md",
  // ce-work resolves the ordinary engine keys inside the reference its route-resolution
  // gate mandates before any implementation write.
  "skills/ce-work/references/execution-engines.md",
  "skills/ce-promote/references/spiral-cli.md",
  "skills/ce-code-review/references/cross-model-review.md",
  "skills/ce-doc-review/references/cross-model-review.md",
]

const START = "<!-- ce-config-layers:start -->"
const END = "<!-- ce-config-layers:end -->"

async function canonicalBlock(): Promise<string> {
  const fixture = await readFile(FIXTURE, "utf8")
  const start = fixture.indexOf(START)
  const end = fixture.indexOf(END)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return fixture.slice(start, end + END.length)
}

describe("config-layers rule shared-asset parity", () => {
  test("the fixture defines a single delimited block", async () => {
    const block = await canonicalBlock()
    expect(block.startsWith(START)).toBe(true)
    expect(block.endsWith(END)).toBe(true)
    const fixture = await readFile(FIXTURE, "utf8")
    expect(fixture.split(START).length).toBe(2)
    expect(fixture.split(END).length).toBe(2)
  })

  test("every independent reader contains the canonical block verbatim", async () => {
    const block = await canonicalBlock()
    for (const rel of CONSUMERS) {
      const p = path.join(REPO_ROOT, rel)
      await access(p)
      const content = await readFile(p, "utf8")
      expect(content, `${rel} is missing the config-layers block`).toContain(block)
    }
  })

  test("the canonical block pins its load-bearing clauses", async () => {
    const block = await canonicalBlock()
    expect(block).toContain(
      "<repo-root>/.compound-engineering/config.local.yaml`, then `config.yaml`, then `~/.compound-engineering/config.yaml",
    )
    expect(block).toContain("Missing directories or files and unreadable files are skipped")
    expect(block).toContain("Gitignore does not change resolution")
    expect(block).toContain("invalid value continues to the next layer")
    expect(block).toContain("including an empty list or map")
    expect(block).toContain("Do not** use this rule for `docs_root`")
    expect(block).toContain("or `packs:` (repo-only)")
  })

  test("ordinary-key value reads never stop after the two repo layers", async () => {
    const violations: string[] = []
    for (const rel of new Bun.Glob("skills/**/*").scanSync(REPO_ROOT)) {
      const content = await readFile(path.join(REPO_ROOT, rel), "utf8")
      for (const [index, line] of content.split("\n").entries()) {
        if (FIRST_RUN_EXCEPTIONS.get(rel) && line.includes(FIRST_RUN_EXCEPTIONS.get(rel)!)) {
          continue
        }
        const twoLayerOnly = TWO_LAYER_ONLY_PHRASES.some((pattern) => pattern.test(line))
        const repoOrder = REPO_LAYER_ORDER.test(line)
        if (!twoLayerOnly && !repoOrder) continue
        if (!twoLayerOnly && line.includes("~/.compound-engineering/config.yaml")) continue
        violations.push(`${rel}:${index + 1}: ${line.trim()}`)
      }
    }
    expect(violations).toEqual([])
  })

  test("cross-model peer resolution continues past an invalid local scalar", async () => {
    for (const rel of [
      "skills/ce-code-review/references/cross-model-review.md",
      "skills/ce-doc-review/references/cross-model-review.md",
    ]) {
      const content = await readFile(path.join(REPO_ROOT, rel), "utf8")
      expect(content, rel).toContain("invalid value continues to the next layer")
      expect(content, rel).not.toContain("first active value wins")
    }
  })

  test("pulse and sweep first-run checks only repo layers while value reads use all layers", async () => {
    const pulse = await readFile(path.join(REPO_ROOT, "skills/ce-product-pulse/SKILL.md"), "utf8")
    const pulseInterview = await readFile(
      path.join(REPO_ROOT, "skills/ce-product-pulse/references/interview.md"),
      "utf8",
    )
    const sweep = await readFile(path.join(REPO_ROOT, "skills/ce-sweep/SKILL.md"), "utf8")
    const sweepInterview = await readFile(
      path.join(REPO_ROOT, "skills/ce-sweep/references/interview.md"),
      "utf8",
    )
    expect(pulse).toContain(
      "First-run detection checks only the two repo layers, `config.local.yaml` and `config.yaml`; the home layer is read for the value but never counts toward this check",
    )
    expect(pulse).toContain("re-apply the ordinary-key rule above")
    expect(pulseInterview).toContain(
      "Subsequent runs re-read those keys from repo `config.local.yaml`, then repo `config.yaml`, then `~/.compound-engineering/config.yaml`",
    )
    expect(pulse).not.toContain("unset after cascade")
    expect(pulse).not.toContain("or config file missing")
    expect(sweep).toContain(
      "`feedback_sources` is unset in both repo layers, `config.local.yaml` and `config.yaml`",
    )
    expect(sweep).toContain(
      "The home layer is read for the value but never counts toward this first-run check",
    )
    expect(sweepInterview).toContain(
      "`feedback_sources` unset in both the local override file and `config.yaml`",
    )
    expect(sweepInterview).toContain(
      "Later runs re-read those keys from repo `config.local.yaml`, then repo `config.yaml`, then `~/.compound-engineering/config.yaml`",
    )
    expect(sweep).not.toContain("unset after cascade")
    expect(sweep).not.toContain("Config file missing")
  })
})
