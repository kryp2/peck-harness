import { describe, expect, it } from 'vitest'
import {
  classifyForkPaths,
  FORK_PATH_GROUPS,
  type ForkPathGroup,
  globToRegExp,
  parseDiffPaths,
  runForkGate,
} from './verify-peck-fork.ts'

const MERGE_BASE = 'b150a55100000000000000000000000000000000'

/** Two-group manifest with disjoint spaces for classification fixtures. */
const FIXTURE_GROUPS: ForkPathGroup[] = [
  { id: 'owned', title: 'Owned', owner: 'peck', patterns: ['vendor/**', 'docs/guide.*'], retirement: 'never' },
  { id: 'shared', title: 'Shared', owner: 'upstream-shared', patterns: ['packages/*/src/index.ts'], retirement: 're-applied' },
]

describe('globToRegExp', () => {
  it('matches an exact path and rejects near misses', () => {
    const expression = globToRegExp('IN_FLIGHT.md')
    expect(expression.test('IN_FLIGHT.md')).toBe(true)
    expect(expression.test('a/IN_FLIGHT.md')).toBe(false)
    expect(expression.test('IN_FLIGHT.md.bak')).toBe(false)
  })

  it('keeps * within one segment while ** crosses segments', () => {
    expect(globToRegExp('docs/*.md').test('docs/a.md')).toBe(true)
    expect(globToRegExp('docs/*.md').test('docs/sub/a.md')).toBe(false)
    expect(globToRegExp('vendor/**').test('vendor/pkg/src/index.ts')).toBe(true)
    expect(globToRegExp('vendor/**').test('vendor/pkg/index.ts')).toBe(true)
  })

  it('lets a mid-pattern ** match zero segments', () => {
    const expression = globToRegExp('a/**/b.ts')
    expect(expression.test('a/b.ts')).toBe(true)
    expect(expression.test('a/x/y/b.ts')).toBe(true)
    expect(expression.test('a/x/b.ts/c')).toBe(false)
  })

  it('matches every sibling of an extension wildcard without crossing directories', () => {
    const expression = globToRegExp('docs/config-catalog.*')
    expect(expression.test('docs/config-catalog.md')).toBe(true)
    expect(expression.test('docs/config-catalog.zh.md')).toBe(true)
    expect(expression.test('docs/config-catalog.i18n.yaml')).toBe(true)
    expect(expression.test('docs/config-catalog/x.md')).toBe(false)
  })

  it('escapes regular-expression metacharacters in literal positions', () => {
    const expression = globToRegExp('weird+(name)/file.ts')
    expect(expression.test('weird+(name)/file.ts')).toBe(true)
    expect(expression.test('weirdxxxx(name)/file.ts')).toBe(false)
  })

  it('supports ? as one non-separator character', () => {
    expect(globToRegExp('a/?c.ts').test('a/bc.ts')).toBe(true)
    expect(globToRegExp('a/?c.ts').test('a/bbc.ts')).toBe(false)
    expect(globToRegExp('a/?c.ts').test('a/x/c.ts')).toBe(false)
  })
})

describe('classifyForkPaths', () => {
  it('classifies every synthetic path when all match', () => {
    const result = classifyForkPaths(['vendor/pkg/a.ts', 'docs/guide.zh.md', 'packages/demo/src/index.ts'], FIXTURE_GROUPS)
    expect(result.unclassified).toEqual([])
    expect(result.classified.map(entry => entry.group.id)).toEqual(['owned', 'owned', 'shared'])
  })

  it('fails by listing exactly the unclassified paths in input order', () => {
    const paths = ['vendor/a.ts', 'mystery/new-file.ts', 'another/orphan.ts', 'packages/demo/src/index.ts']
    const result = classifyForkPaths(paths, FIXTURE_GROUPS)
    expect(result.unclassified).toEqual(['mystery/new-file.ts', 'another/orphan.ts'])
    expect(result.classified.map(entry => entry.path)).toEqual(['vendor/a.ts', 'packages/demo/src/index.ts'])
  })

  it('assigns overlapping matches to the earliest group', () => {
    const groups: ForkPathGroup[] = [
      { id: 'specific', title: 'Specific', owner: 'peck', patterns: ['apps/web/tests/**'], retirement: 'never' },
      { id: 'broad', title: 'Broad', owner: 'upstream-shared', patterns: ['apps/web/**'], retirement: 're-applied' },
    ]
    const result = classifyForkPaths(['apps/web/tests/a.e2e.ts'], groups)
    expect(result.classified[0]?.group.id).toBe('specific')
  })

  it('leaves the real manifest internally consistent', () => {
    const ids = FORK_PATH_GROUPS.map(group => group.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const group of FORK_PATH_GROUPS) {
      expect(group.patterns.length).toBeGreaterThan(0)
      for (const pattern of group.patterns) {
        expect(pattern.includes('\\')).toBe(false)
        expect(pattern.startsWith('/')).toBe(false)
      }
    }
  })
})

describe('parseDiffPaths', () => {
  it('normalizes separators, CRLF endings, and blank lines', () => {
    expect(parseDiffPaths('a\\b.ts\r\nc/d.ts\n\n')).toEqual(['a/b.ts', 'c/d.ts'])
    expect(parseDiffPaths('')).toEqual([])
  })
})

function fixtureGit(diffPaths: string[]) {
  return (args: string[]) => {
    if (args[0] === 'rev-parse') return { exitCode: 0, stdout: `${MERGE_BASE}\n`, stderr: '' }
    if (args[0] === 'diff') return { exitCode: 0, stdout: `${diffPaths.join('\n')}\n`, stderr: '' }
    return { exitCode: -1, stdout: '', stderr: `unexpected args ${String(args[0])}` }
  }
}

describe('runForkGate', () => {
  it('passes a controlled diff whose every path is classified', () => {
    const result = runForkGate({
      mergeBase: MERGE_BASE,
      groups: FIXTURE_GROUPS,
      git: fixtureGit(['vendor/a.ts', 'packages/demo/src/index.ts']),
    })
    expect(result.ok).toBe(true)
    expect(result.failures).toEqual([])
    expect(result.summary).toContain('2 diverged path(s)')
    expect(result.summary).toContain(MERGE_BASE.slice(0, 12))
    expect(result.summary).toContain('2 group(s)')
  })

  it('fails naming an unclassified path and both update locations', () => {
    const result = runForkGate({
      mergeBase: MERGE_BASE,
      groups: FIXTURE_GROUPS,
      git: fixtureGit(['vendor/a.ts', 'unknown/path.ts']),
    })
    expect(result.ok).toBe(false)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toContain('unknown/path.ts')
    expect(result.failures[0]).toContain('scripts/verify-peck-fork.ts')
    expect(result.failures[0]).toContain('docs/peck-fork.md')
  })

  it('fails clearly when the recorded merge-base is missing from history', () => {
    const git = (args: string[]) => {
      if (args[0] === 'rev-parse') return { exitCode: 1, stdout: '', stderr: '' }
      return { exitCode: 0, stdout: '', stderr: '' }
    }
    const result = runForkGate({ mergeBase: MERGE_BASE, groups: FIXTURE_GROUPS, git })
    expect(result.ok).toBe(false)
    expect(result.failures[0]).toContain(`${MERGE_BASE} is missing from history`)
    expect(result.failures[0]).toContain('UPSTREAM_MERGE_BASE')
    expect(result.failures[0]).toContain('docs/peck-fork.md')
  })

  it('propagates a failed diff command with its stderr', () => {
    const git = (args: string[]) => {
      if (args[0] === 'rev-parse') return { exitCode: 0, stdout: `${MERGE_BASE}\n`, stderr: '' }
      return { exitCode: 128, stdout: '', stderr: 'fatal: bad object' }
    }
    const result = runForkGate({ mergeBase: MERGE_BASE, groups: FIXTURE_GROUPS, git })
    expect(result.ok).toBe(false)
    expect(result.failures[0]).toContain('fatal: bad object')
  })
})
