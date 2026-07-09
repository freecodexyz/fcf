# AGENTS.md

Guidance for AI coding agents working in this repository. See
<https://agents.md/> for the file convention.

## Coding Guidelines

TypeScript conventions for this project. Rules are normative: **MUST** = enforced, **PREFER** = default unless there's a reason. Each rule has a minimal example. Consistency with existing code beats any rule below.

## Type safety

- **MUST** enable `strict` in tsconfig, plus `noUncheckedIndexedAccess` and `noImplicitReturns`.
- **MUST NOT** use `any`. Use `unknown` at boundaries, then narrow.
  ```ts
  // bad
  function parse(s: string): any { return JSON.parse(s); }
  // good
  function parse(s: string): unknown { return JSON.parse(s); }
  ```
- **MUST** annotate exported function signatures and public boundaries explicitly. Let inference handle locals.
- **MUST** validate all external input (args, env, config, network, `JSON.parse`) at the boundary with a runtime schema (e.g. Zod), so static types match reality.
  ```ts
  const User = z.object({ id: z.string(), name: z.string() });
  type User = z.infer<typeof User>;
  const user = User.parse(await res.json()); // throws on bad shape
  ```

## Modeling data — make illegal states unrepresentable

- **PREFER** discriminated unions over objects with many optional fields. Tag with a literal field.
  ```ts
  // bad: { status: string; data?: T; error?: string }
  type Req<T> =
    | { status: "loading" }
    | { status: "success"; data: T }
    | { status: "error"; error: string };
  ```
- **MUST** use exhaustive `switch` with a `never` guard on unions, so adding a variant is a compile error.
  ```ts
  default: return assertNever(x); // assertNever(x: never): never
  ```
- **PREFER** precise literal unions over open primitives: `"admin" | "guest"`, not `string`.
- **PREFER** `readonly` fields and `as const` by default; mutate deliberately.
- **PREFER** branded types for values that share a runtime type but not a meaning (IDs, units).
  ```ts
  type UserId = string & { readonly __brand: "UserId" };
  ```

## Errors and results

- **PREFER** returning a `Result` for *expected* failures; reserve `throw` for programmer error and unrecoverable states.
  ```ts
  type Result<T, E = Error> =
    | { ok: true; value: T }
    | { ok: false; error: E };
  ```
- **MUST** model a function's failure modes in its return type when they're part of the domain (not found, invalid, over-limit).

## Functions

- **MUST** keep functions single-responsibility and side-effect-free where possible. Push I/O and mutation to the edges; keep a pure core.
- **MUST** give exported functions explicit return types.
- **PREFER** a union parameter over overloads when the body is shared.

## Classes — use only when justified

- **MUST NOT** use a class when a function or type suffices. A class needs **identity + mutable state + an invariant to protect + behavior**. No state → function. No behavior → type.
  ```ts
  // bad: class Point { constructor(public x: number, public y: number) {} }
  type Point = { x: number; y: number };
  ```
- **MUST** justify every class by an invariant. Ask "what can't happen to an instance?" If the answer is "nothing," it shouldn't be a class. Getters+setters that just wrap a field are not encapsulation.
- **MUST** validate in a static factory when construction can fail; keep the constructor private and do no I/O in it.
  ```ts
  class Email {
    private constructor(readonly value: string) {}
    static create(s: string): Result<Email, "invalid"> {
      return s.includes("@") ? ok(new Email(s)) : err("invalid");
    }
  }
  ```
- **MUST NOT** do work in constructors (no I/O, no network, no throwing for expected conditions). Use named async factories: `Config.load()`, `User.fromDatabase()`.
- **MUST** use `#private` fields to protect invariants; expose read via getters, never a bare setter.
- **PREFER** "tell, don't ask": give the object an intent, let it enforce its own rules — don't pull data out to decide, then push a change back in.
  ```ts
  cart.checkout(); // returns Result — not: if (cart.total < limit) cart.status = ...
  ```
- **MUST** keep the public surface minimal. Default methods to private; promote only when a caller needs them.
- **PREFER** composition over inheritance. Reserve inheritance for genuinely different *behavior*; represent "kinds of" as a discriminated field built by different factories.
- **PREFER** `readonly` fields; keep the few mutable ones obvious.

## Dependency injection

- **MUST** inject dependencies (clock, store, logger) rather than constructing them internally, so logic is testable with fakes.
- **MUST** define interfaces from the *consumer's* view, listing only the methods it uses — not the full capability of what's passed in.
  ```ts
  interface SessionStore { save(id: string, exp: number): Promise<void>; }
  // not: constructor(private db: Database)  // 40 methods, uses one
  ```

## File & project structure

- **MUST** keep one primary export per file, and name the file after it: `Email.ts` → `Email`, `parseConfig.ts` → `parseConfig`.
- **MUST NOT** create `utils.ts` / `helpers.ts` / `misc/` grab-bags. If you can't name the file after its contents, the contents don't belong together.
- **MUST** enforce a one-directional dependency rule: delivery layer (CLI commands, HTTP routes) → core logic → nothing. Core **MUST NOT** import from I/O or delivery layers.
- **PREFER** casing that signals the export kind, applied consistently: `PascalCase` for files exporting a class/type, `camelCase` for files exporting functions. (Uniform `kebab-case` is also acceptable — pick one project-wide.)
- **PREFER** naming by domain role, not redundant technical suffix. Drop `Model`/`Impl`/`Class`; keep suffixes only when they disambiguate real roles (`User.ts`, `UserRepository.ts`, `UserSchema.ts`).
- **MUST** keep `index.ts` as a re-export doorway only — no logic.
- **MUST** avoid folder/file stutter: `config/loader.ts`, not `config/configLoader.ts`.
- **MUST** colocate tests with a matching name: `planner.ts` → `planner.test.ts`.

## Meta

- **MUST** match an existing convention over introducing a "better" second one. Predictability is the point; a codebase with two conventions is worse than either alone.