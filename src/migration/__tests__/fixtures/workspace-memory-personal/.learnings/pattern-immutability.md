# Pattern: Immutability in TypeScript

Always create new objects, never mutate existing ones. Use Object.freeze
at construction time. Use readonly on all class fields and type aliases.
This prevents hidden side effects and enables safe concurrency.
