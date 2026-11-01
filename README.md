# reasonfrom-kit

Publish any repository to [reasonfrom.com](https://reasonfrom.com).

Content repos don't need to know how the site works, and the site doesn't need to know how each repo is laid out. They share one contract: a **bundle**. A repo converts its own layout into a bundle, and the site renders every bundle with one design.

```
any repo ── reasonfrom-kit ──► bundle (validated, deterministic) ──► reasonfrom.com
```

**Status:** contract v1 and its validator (milestone M1). Adapters and the GitHub Action (M2) and local preview (M7) come next.

## The contract

Read **[SPEC.md](./SPEC.md)**. In short:

1. Metadata is JSON and prose is markdown, never mixed.
2. Bundles are deterministic: same commit, same bytes.
3. Bundles are self-contained: prose links only to `https://…`, `rf:<id>` (another item) or `rf-asset:<path>`.
4. The site owns state and presentation. Bundles say what content *is*, not when it reached the site or how it looks.

The authoritative schema is [`src/schema/v1.mjs`](./src/schema/v1.mjs) (zod). [`schema/v1/*.json`](./schema/v1/) is generated JSON Schema for editors and docs. A valid example is in [`examples/minimal/`](./examples/minimal/).

## Use

```bash
npm install
npx reasonfrom validate path/to/bundle     # exit 0 valid · 1 invalid · 2 usage
npm test                                    # contract tests
npm run schema                              # regenerate schema/v1/*.json
npm run example                             # regenerate examples/minimal/
```

## Privacy

A bundle declares `"publish": true`, and a source that hasn't opted in doesn't produce one. The site also checks its own allowlist and confirms the source repo is public before rendering anything. Private repositories can't be published by accident.

## License

[Apache 2.0](./LICENSE)
