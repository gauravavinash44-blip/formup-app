/** Unit tests for the pure TypeScript logic (no native modules needed). */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: { strict: true, esModuleInterop: true } }] },
};
