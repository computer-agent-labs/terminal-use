import {defineConfig} from 'vitest/config'

// What runs on Windows: the tests that don't need a POSIX shell (pure logic,
// the emulator and renderer, the skills extension) plus tests/windows, which
// drives PowerShell and cmd.exe end to end. Everything else in tests/ types
// into /bin/sh.
export default defineConfig({
  test: {
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/terminal.test.ts',
      'tests/integration/render.test.ts',
      'tests/integration/renderPixels.test.ts',
      'tests/mcp/skills.test.ts',
      'tests/windows/**/*.test.ts'
    ],
    globalSetup: ['tests/globalSetup.ts'],
    pool: 'forks',
    testTimeout: 60000,
    hookTimeout: 30000
  }
})
