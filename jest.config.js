export default {
  testEnvironment: 'node',
  transform: {},
  testMatch: ['**/tests/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/_parked/'],
  collectCoverageFrom: ['src/**/*.js'],
  coveragePathIgnorePatterns: ['/node_modules/'],
  verbose: true,
  testTimeout: 10000
};
