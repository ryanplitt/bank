import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'] },

  js.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'smart'],
    },
  },

  // Server, shared and build configs: Node environment.
  {
    files: [
      'BankGame/server/**/*.js',
      'BankGame/shared/**/*.js',
      '**/vite.config.js',
      'eslint.config.js',
      'vitest.config.js',
    ],
    languageOptions: { globals: { ...globals.node } },
  },

  // Client: browser environment, React rules.
  {
    files: ['BankGame/client/src/**/*.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // The modern JSX transform means React need not be in scope.
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },

  // Tests run under Node with Vitest globals.
  {
    files: ['**/*.test.js', '**/*.test.jsx'],
    languageOptions: { globals: { ...globals.node } },
  },
];
