/**
 * Gate for Peck fork divergence ownership: every path that differs from the
 * pinned upstream merge-base must match one classified group declared here,
 * and each group is documented in `docs/peck-fork.md`.
 *
 * The manifest below is the enforcement authority; the documentation table is
 * its reviewed human counterpart. A path matching no group fails the gate with
 * the update locations named. No network access: only local `git` reads.
 * @see ../docs/peck-fork.md
 * @module scripts/verify-peck-fork
 */

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

/**
 * Upstream commit this fork's divergence is measured against. Refresh after
 * every upstream sync: `git fetch upstream && git merge-base upstream/master HEAD`.
 */
export const UPSTREAM_MERGE_BASE = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'

/** Who owns a diverged path class and how an upstream sync treats it. */
export type ForkPathOwner = 'peck' | 'upstream-shared'

/** One classified class of divergent paths. */
export interface ForkPathGroup {
  /** Stable identifier used in gate output and as the docs table row key. */
  id: string
  /** Human-readable category title mirrored by the docs table. */
  title: string
  /** `peck` for wholly fork-owned path space; `upstream-shared` for files upstream also owns. */
  owner: ForkPathOwner
  /** Repo-relative glob patterns (`/` separators; `*`, `?`, `**`) owned by this group. */
  patterns: string[]
  /** When this divergence is upstreamed or retired instead of maintained. */
  retirement: string
}

/**
 * The classification manifest. Group order decides precedence: the first
 * group whose pattern matches a path owns it, so wholly peck-owned spaces
 * are listed before broader upstream-shared prefixes.
 */
export const FORK_PATH_GROUPS: readonly ForkPathGroup[] = [
  {
    id: 'agent-notes',
    title: 'Agent Notes (fork decision records)',
    owner: 'peck',
    patterns: ['.agents/notes/**'],
    retirement: 'Fork process and architecture decisions stay until archived; generic fixes are offered upstream through GitHub Discussions rather than fork-side edits to upstream documents.',
  },
  {
    id: 'fork-ci',
    title: 'Fork CI workflow adjustments',
    owner: 'peck',
    patterns: ['.github/workflows/*.yml', '.github/AGENTS.md', 'scripts/ci-workflow.spec.ts'],
    retirement: 'Reverts toward the upstream workflows once their trigger budgets and runner labels work for the fork.',
  },
  {
    id: 'fork-runbooks',
    title: 'Fork runbooks and status documents',
    owner: 'peck',
    patterns: ['IN_FLIGHT.md', 'PECK_DEPLOYMENT_TRAPS.md', 'PECK_HARNESS_BUILD_PLAN.md'],
    retirement: 'Deleted when the fork distribution plan completes and fork-specific operational knowledge no longer differs from upstream documentation.',
  },
  {
    id: 'repo-metadata',
    title: 'Repository security metadata',
    owner: 'peck',
    patterns: ['.gitleaksignore'],
    retirement: 'Entries drop when the flagged false positive disappears from the scanned files.',
  },
  {
    id: 'generated-references',
    title: 'Regenerated references and paired counterparts',
    owner: 'upstream-shared',
    patterns: [
      'THIRD_PARTY_NOTICES.md',
      'docs/config-catalog.*',
      'docs/event-producer-consumer.*',
      'docs/persistence-catalog.*',
      'docs/subsystems/extensions.*',
      'docs/subsystems/user-questions.*',
      'packages/core/scope/src/scoped-events.generated.ts',
    ],
    retirement: 'Never retired separately: the generators re-derive these files from whatever the diverged sources contain.',
  },
  {
    id: 'peck-packages',
    title: 'Peck-owned packages',
    owner: 'peck',
    patterns: [
      'packages/interaction/telegram-answerer/**',
      'packages/llm/llm-claude-cli/**',
      'packages/session/session-metered-receipt/**',
      'packages/session/session-usage/**',
    ],
    retirement: 'Offered upstream as whole packages through GitHub Discussions if upstream adopts the capability; otherwise permanent fork payload.',
  },
  {
    id: 'shared-runtime-features',
    title: 'Feature work on upstream-shared packages',
    owner: 'upstream-shared',
    patterns: [
      'packages/core/agent/**',
      'packages/core/session/src/known-event-types.ts',
      'packages/client/ui-agent-preset/**',
      'packages/extensions/cordis-host-runner/**',
      'packages/extensions/tool-cordis/**',
      'packages/host/apiproxy/**',
      'packages/interaction/README.*',
      'packages/interaction/tool-ask-user/**',
      'packages/interaction/user-questions/**',
      'packages/plan/plan-mode/tests/plan-mode.spec.ts',
      'packages/session/README.*',
    ],
    retirement: 'Each change either lands upstream through GitHub Discussions when generic, or is deliberately re-applied across every upstream sync.',
  },
  {
    id: 'fork-branding',
    title: 'Fork naming and visual identity',
    owner: 'upstream-shared',
    patterns: [
      'apps/cli/config/agent-presets/cordis/agent.cordis.yml',
      'apps/web/index.html',
      'apps/web/public/**',
      'apps/web/tests/**',
      'packages/bundle/web-app/**',
      'packages/client/ui-brand-official/**',
      'packages/client/ui-conversation/**',
      'packages/client/ui-primitives/**',
      'packages/client/ui-theme/**',
      'packages/core/system-prompt/src/index.ts',
      'scripts/client-build-environment.client.spec.ts',
      'scripts/client-build-environment.ts',
    ],
    retirement: 'Never upstreamed; re-applied across every sync while the product runs under the Peck name.',
  },
  {
    id: 'workspace-registration',
    title: 'Workspace and gate registration of peck packages',
    owner: 'upstream-shared',
    patterns: [
      'pnpm-lock.yaml',
      'tsconfig.base.json',
      'tsconfig.host.json',
      'scripts/gen-cordis-catalog.ts',
      'scripts/verify-package-readme-model-experience.ts',
    ],
    retirement: 'Regenerates or re-applies whenever peck-package membership changes; never upstreamed on its own.',
  },
  {
    id: 'fork-inventory-gate',
    title: 'Fork inventory gate and its registration',
    owner: 'peck',
    patterns: [
      'docs/peck-fork.i18n.yaml',
      'docs/peck-fork.md',
      'docs/peck-fork.zh.md',
      'package.json',
      'scripts/run-gates.ts',
      'scripts/verify-peck-fork.spec.ts',
      'scripts/verify-peck-fork.ts',
    ],
    retirement: 'Permanent fork plumbing; retiring it means upstream adopted the divergence gate itself.',
  },
]

/**
 * Compile one repo-relative glob into an anchored regular expression.
 *
 * Supported syntax covers the manifest's needs: `*` matches within one path
 * segment, `?` matches one non-separator character, a `**` segment matches
 * zero or more whole segments, and a trailing `**` matches everything below
 * the prefix. All other characters match literally.
 * @param pattern - glob using `/` separators, relative to the repository root.
 * @returns anchored expression equivalent for normalized forward-slash paths.
 */
export function globToRegExp(pattern: string): RegExp {
  const segments = pattern.split('/')
  let source = ''
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1
    if (segment === '**') {
      source += last ? '.*' : '(?:[^/]+/)*'
      return
    }
    for (const character of segment) {
      if (character === '*') source += '[^/]*'
      else if (character === '?') source += '[^/]'
      else source += character.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
    if (!last) source += '/'
  })
  return new RegExp(`^${source}$`)
}

interface CompiledGroup {
  group: ForkPathGroup
  expressions: RegExp[]
}

/** Result of classifying a diverged-path list against the manifest. */
export interface ForkClassification {
  /** Paths with their owning group, in input order. */
  classified: Array<{ path: string; group: ForkPathGroup }>
  /** Paths no group claims; each fails the gate. */
  unclassified: string[]
}

/**
 * Classify diverged paths by first-match precedence over the group list.
 * @param paths - repo-relative paths with `/` separators (ingestion normalizes separators).
 * @param groups - ordered classification manifest.
 * @returns every input path exactly once, split into classified and unclassified.
 */
export function classifyForkPaths(paths: readonly string[], groups: readonly ForkPathGroup[]): ForkClassification {
  const compiled: CompiledGroup[] = groups.map(group => ({
    group,
    expressions: group.patterns.map(pattern => globToRegExp(pattern)),
  }))
  const classified: ForkClassification['classified'] = []
  const unclassified: string[] = []
  for (const path of paths) {
    const owner = compiled.find(entry => entry.expressions.some(expression => expression.test(path)))
    if (owner === undefined) unclassified.push(path)
    else classified.push({ path, group: owner.group })
  }
  return { classified, unclassified }
}

/**
 * Parse `git diff --name-only` output into repository-relative paths.
 * @param stdout - raw command output, possibly with CRLF endings and a trailing newline.
 * @returns one normalized path per changed entry, blanks removed.
 */
export function parseDiffPaths(stdout: string): string[] {
  return stdout
    .split('\n')
    .map(line => line.replace(/\r$/, '').trim())
    .filter(line => line !== '')
    .map(line => line.split('\\').join('/'))
}

/** Minimal process outcome the gate needs from a git invocation. */
export interface GitOutcome {
  exitCode: number
  stdout: string
  stderr: string
}

/** Injectable git boundary so tests cover gate behavior without a real repository. */
export type GitRunner = (args: string[]) => GitOutcome

function defaultGitRunner(args: string[]): GitOutcome {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
  if (result.error !== undefined) {
    return { exitCode: -1, stdout: '', stderr: `failed to run git: ${result.error.message}` }
  }
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

/** Outcome of one gate execution. */
export interface ForkGateResult {
  /** Whether every diverged path is classified against a known merge-base. */
  ok: boolean
  /** Actionable failures; empty when {@link ForkGateResult.ok} is true. */
  failures: string[]
  /** One-line pass summary naming the merge-base and classified count. */
  summary: string
}

/**
 * Run the full divergence check: verify the recorded merge-base resolves in
 * history, list the diverged paths, and classify them against the manifest.
 * @param options - merge-base and manifest to enforce; git boundary override for tests.
 * @returns collected failures, or a summary when the tree classifies cleanly.
 */
export function runForkGate(options: {
  mergeBase: string
  groups: readonly ForkPathGroup[]
  git?: GitRunner
}): ForkGateResult {
  const git = options.git ?? defaultGitRunner
  const mergeBase = options.mergeBase

  const resolved = git(['rev-parse', '--verify', '--quiet', `${mergeBase}^{commit}`])
  if (resolved.exitCode !== 0 || resolved.stdout.trim() === '') {
    return {
      ok: false,
      failures: [
        `recorded upstream merge-base ${mergeBase} is missing from history.`
        + ' After an upstream sync refresh it in BOTH places:'
        + ' UPSTREAM_MERGE_BASE in scripts/verify-peck-fork.ts and the baseline section in docs/peck-fork.md'
        + ' (git fetch upstream && git merge-base upstream/master HEAD).',
      ],
      summary: '',
    }
  }

  const diff = git(['diff', '--name-only', `${mergeBase}...HEAD`])
  if (diff.exitCode !== 0) {
    return {
      ok: false,
      failures: [`git diff --name-only ${mergeBase}...HEAD failed: ${diff.stderr.trim()}`],
      summary: '',
    }
  }

  const paths = parseDiffPaths(diff.stdout)
  const { classified, unclassified } = classifyForkPaths(paths, options.groups)
  if (unclassified.length > 0) {
    return {
      ok: false,
      failures: unclassified.map(path =>
        `${path} is not covered by the fork-divergence inventory.`
        + ' Add it to the matching group in FORK_PATH_GROUPS (scripts/verify-peck-fork.ts)'
        + ' and document the group in the "Ownership groups" table of docs/peck-fork.md.',
      ),
      summary: '',
    }
  }

  return {
    ok: true,
    failures: [],
    summary: `${String(classified.length)} diverged path(s) since ${mergeBase.slice(0, 12)} classified into ${String(options.groups.length)} group(s).`,
  }
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const result = runForkGate({ mergeBase: UPSTREAM_MERGE_BASE, groups: FORK_PATH_GROUPS })
  if (!result.ok) {
    process.stderr.write('verify-peck-fork: fork-divergence inventory incomplete:\n')
    for (const failure of result.failures) process.stderr.write(`  ${failure}\n`)
    process.exit(1)
  }
  process.stdout.write(`verify-peck-fork: ${result.summary}\n`)
}
