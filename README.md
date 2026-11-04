# reasonfrom-kit

Publish any repository to [reasonfrom.com](https://reasonfrom.com).

Content repos don't need to know how the site works, and the site doesn't need to know how each repo is laid out. They share one contract: a **bundle**. A repo converts its own layout into a bundle, and the site renders every bundle with one design.

```
any repo ── reasonfrom-kit ──► bundle (validated, deterministic) ──► reasonfrom.com
```

**Status:** contract v1, validator, three adapters (`readme-outline`, `curriculum-days`, `agent-skills`), CLI, GitHub Action, and local preview.

## Operating the whole system

Architecture, automation, and how to set everything up on a new machine: **[docs/SYSTEM.md in the site repo](https://github.com/arunveersingh/arunveersingh.github.io/blob/main/docs/SYSTEM.md)**.

## The contract

Read **[SPEC.md](./SPEC.md)**. In short:

1. Metadata is JSON and prose is markdown, never mixed.
2. Bundles are deterministic: same commit, same bytes.
3. Bundles are self-contained: prose links only to `https://…`, `rf:<id>` (another item) or `rf-asset:<path>`.
4. The site owns state and presentation. Bundles say what content *is*, not when it reached the site or how it looks.

The authoritative schema is [`src/schema/v1.mjs`](./src/schema/v1.mjs) (zod). [`schema/v1/*.json`](./schema/v1/) is generated JSON Schema for editors and docs. A valid example is in [`examples/minimal/`](./examples/minimal/).

## Publish a repo

**1. Opt in** by committing `reasonfrom.yml` at the repo root:

```yaml
publish: true
courses:
  - layout: readme-outline          # README outline + day-NN.md lessons
    path: courses/make-ai-fail-safely
skills:
  - layout: agent-skills            # <path>/<name>/SKILL.md (Agent Skills spec)
    path: skills
    evals: evals/skills             # optional: <name>.md case files
```

**2. Add the workflow.** Copy [`examples/source-workflow.yml`](./examples/source-workflow.yml) to `.github/workflows/reasonfrom.yml`. A PR fails if its content would not publish cleanly, and a merge to `main` notifies the site.

**3. Merge.** The site builds the bundle from your commit, renders it in the site design, and deploys.

## How the pieces fit

| Piece | Job |
|---|---|
| **Adapters** (`src/adapters/`) | Turn a repo layout into contract items. `readme-outline` reproduces the site's old `sync-course.mjs` output exactly: 240 of 240 fields, bodies and assets identical on the real course. `agent-skills` reads `SKILL.md` frontmatter |
| **Link router** (`src/links.mjs`) | Relative links become `rf:` (to an item), `rf-asset:` (to a file) or an absolute GitHub URL. **A broken relative link fails the PR** |
| **Validator** | Checks the result against the contract |
| **Action** (`action.yml`) | Runs the check on PRs and notifies the site on merge |

The site builds bundles itself from `{repo, sha}` in its lockfile, so a source repo never uploads anything. Because bundles are deterministic, the site's build is as reproducible as a stored artifact would be.

## CLI

```bash
npx reasonfrom check <repo-dir>                 # build + validate, leave nothing behind (CI)
npx reasonfrom bundle <repo-dir> --out DIR      # build + validate, keep the bundle
npx reasonfrom validate <bundle-dir>            # validate an existing bundle
npx reasonfrom preview <repo-dir> --site <site> # render locally in the real site design (private ok)
#   flags: --repo owner/name  --sha <40 hex>  --config <file>
#   exit 0 valid · 1 invalid · 2 usage

npm test            # 49 contract + adapter tests
npm run schema      # regenerate schema/v1/*.json
npm run example     # regenerate examples/minimal/
```

## Privacy

A bundle declares `"publish": true`, and a source that hasn't opted in doesn't produce one. The site also checks its own allowlist and confirms the source repo is public before rendering anything. Private repositories can't be published by accident.

## License

[Apache 2.0](./LICENSE)
