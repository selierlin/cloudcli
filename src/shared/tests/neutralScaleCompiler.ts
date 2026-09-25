import { join } from 'node:path';

/**
 * Node-side half of the neutral-scale equivalence proof.
 *
 * Kept apart from `neutralScale.ts` on purpose: that module is pure data and is
 * bundled into the browser fixture at `tests/theme-tokens`, so anything
 * importing `node:path` or Tailwind's compiler from it breaks the fixture. This
 * module is only ever loaded by Vitest.
 */

/**
 * The modifier shapes the migration actually has to survive. ~120 migrated
 * classes carry one, and the token form is the only reason they can: Tailwind
 * renders `bg-gray-800/50` as `rgb(31 41 55 / 0.5)` but `bg-n-gray-800/50` as
 * `hsl(var(--n-gray-800) / 0.5)` — the alpha has to be interpolated *inside*
 * the `hsl()` call for the token to survive.
 */
export const MODIFIER_SHAPES = [
  { suffix: '', alpha: null },
  { suffix: '/50', alpha: '0.5' },
  { suffix: '/[0.025]', alpha: '0.025' },
] as const;

/** The utilities this line of work rewrites, one per declaration family. */
export const MIGRATED_UTILITIES = ['bg', 'text', 'border'] as const;

/**
 * The `RegExp` source matching the CSS selector Tailwind writes for a class:
 * first the class gets CSS-escaped (`bg-n-gray-800/50` -> `bg-n-gray-800\/50`),
 * then that literal text is regex-escaped, backslashes included — conflating
 * the two escapes is what makes `\/` silently match a bare `/`.
 */
const selectorPattern = (name: string) =>
  name
    .replace(/[^a-zA-Z0-9-]/g, (char) => `\\${char}`)
    .replace(/[.*+?^${}()|[\]\\/]/g, (char) => `\\${char}`);

/**
 * What Tailwind emits for given class names, as `class -> declaration text`.
 *
 * This closes the chain in `neutralScale.test.ts` at the far end: the earlier
 * links prove a token *holds* the literal's value, this proves the class that
 * consumes it *declares* that value. A bulk rename could satisfy every value
 * check and still emit nothing (class not generated) or drop the alpha
 * (modifier not interpolated), so the shape is compiled rather than assumed —
 * with the real `tailwind.config.js`, through Tailwind's own PostCSS plugin.
 */
export async function compileUtilities(classes: string[]): Promise<Map<string, string>> {
  const [postcssModule, tailwindModule, loadConfigModule] = await Promise.all([
    import('postcss'),
    import('tailwindcss'),
    import('tailwindcss/loadConfig.js'),
  ]);

  const postcss = (postcssModule.default ?? postcssModule) as unknown as (
    plugins: unknown[],
  ) => { process: (input: string, options: { from: undefined }) => Promise<{ css: string }> };
  const tailwind = (tailwindModule.default ?? tailwindModule) as unknown as (
    config: unknown,
  ) => unknown;
  const loadConfig = (loadConfigModule.default ?? loadConfigModule) as unknown as (
    path: string,
  ) => unknown;

  const config = await loadConfig(join(process.cwd(), 'tailwind.config.js'));
  const result = await postcss([
    tailwind({ ...(config as object), content: [{ raw: classes.join(' '), extension: 'html' }] }),
  ]).process('@tailwind utilities;', { from: undefined });

  const rules = new Map<string, string>();
  for (const name of classes) {
    // Anchored at `{` so `bg-n-gray-100` cannot match `bg-n-gray-100\/50`.
    const rule = new RegExp(`\\.${selectorPattern(name)}\\s*\\{([^}]*)\\}`).exec(result.css);
    if (!rule) throw new Error(`tailwind emitted no rule for .${name}`);
    rules.set(name, rule[1].trim());
  }
  return rules;
}
