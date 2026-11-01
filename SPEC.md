# Reason From bundle — contract v1

A **bundle** is how any repository publishes content to reasonfrom.com. The repo turns its own layout into a bundle, and the site renders bundles. The site never parses a repo's layout, so adding a repo needs no change to the site.

Source of truth: [`src/schema/v1.mjs`](./src/schema/v1.mjs). JSON Schema exports in [`schema/v1/`](./schema/v1/) are generated from it, for documentation only.

## Layout

```
bundle/
  manifest.json                              index of everything, with hashes
  items/<type>/<slug...>.json                metadata (JSON only)
  items/<type>/<slug...>.md                  prose (markdown only, optional)
  assets/<path>                              images, svgs, slides
```

**Rule 1: metadata is JSON and prose is markdown, never mixed.** Markdown files have no frontmatter.

**Rule 2: a bundle is deterministic.** The same source commit always produces byte-identical bundles: keys are sorted, line endings are LF, and there are no timestamps. The site's lockfile and its shadow comparison depend on this.

**Rule 3: a bundle is self-contained.** Prose may link only to:

| Link | Meaning |
|---|---|
| `https://…`, `http://…`, `mailto:…`, `#anchor` | external, or an anchor on the same page |
| `rf:<id>` | another item, in this bundle or any other published bundle |
| `rf-asset:<path>` | a file under this bundle's `assets/` |

A relative path such as `./day-05.md` is invalid. Only the adapter knows the repo's layout, so it must convert every relative link: to `rf:`, to `rf-asset:`, or to an absolute GitHub URL. The same rule applies to HTML `src="…"` and `href="…"`.

**Rule 4: the site owns state and presentation.** A bundle says what content *is*. Dates of first appearance on the site, page layout, slide grids and styling all belong to the site. The bundle never carries them.

## Ids

```
course/<course-slug>
lesson/<course-slug>/<lesson-slug>
skill/<skill-name>
```

Slugs are kebab-case: `^[a-z0-9]+(-[a-z0-9]+)*$`. Ids are global across all bundles. The site rejects duplicates, and its registry decides which repository may publish which id prefixes.

## manifest.json

```json
{
  "schema": 1,
  "publish": true,
  "source": { "repo": "arunveersingh/ai", "sha": "<40 hex>", "url": "https://github.com/arunveersingh/ai" },
  "items":  [{ "id": "course/make-ai-fail-safely", "type": "course", "meta": "items/course/make-ai-fail-safely.json", "sha256": "…" }],
  "assets": [{ "path": "make-ai-fail-safely/day-01.svg", "sha256": "…", "bytes": 1234 }]
}
```

`items[].sha256` covers the metadata file and its markdown body (if any). `publish` must be `true`. A source that hasn't opted in doesn't produce a bundle.

## Item types

### course
| Field | Type | Notes |
|---|---|---|
| `id`, `type` | `course/<slug>`, `"course"` | |
| `title`, `tagline` | string | |
| `source_url` | url | where the course is authored |
| `cover` | asset path, optional | |
| `external_url` | url, optional | if set, the course is hosted elsewhere and the site links to it; no lessons are expected |
| `outline.unit` | `"day"` \| `"lesson"` \| `"module"` | |
| `outline.line_label` | string, optional | label for each entry's one-liner (e.g. `"Failure"`) |
| `outline.phases[]` | `{ label, from, to, question? }` | contiguous and ordered, covering every entry |
| `outline.entries[]` | `{ n, title, line?, phase }` | `n` is 1..N in order; `phase` matches a phase label |

### lesson
| Field | Type | Notes |
|---|---|---|
| `id`, `type` | `lesson/<course>/<slug>`, `"lesson"` | |
| `course` | course id | must exist in the same bundle |
| `n` | int ≥ 1 | must match an outline entry |
| `title`, `description` | string | `description` ≤ 220 chars |
| `phase` | string | must equal the outline entry's phase |
| `line` | string, optional | must equal the outline entry's line when both are set |
| `time` | string, optional | e.g. `"~15 min"` |
| `publish_at` | `YYYY-MM-DD`, optional | the site hides the lesson before this date |
| `body` | path to `.md` | required |

### skill
| Field | Type | Notes |
|---|---|---|
| `id`, `type` | `skill/<name>`, `"skill"` | |
| `name` | slug | equals the id's last segment |
| `description` | string | ≤ 1024 chars (the Agent Skills limit) |
| `version` | string | |
| `resource` | one of `truth ownership intent attention authority capability originality self meta` | |
| `symptom` | string | |
| `license` | string | |
| `source_url` | url | the SKILL.md on GitHub |
| `evals` | `{ cases, url }`, optional | |
| `body` | path to `.md` | the skill body, without frontmatter |

## Versioning

`schema` is an integer. Adding an optional field leaves v1 unchanged. Removing, renaming or tightening a field requires v2, and the site supports both until every source has migrated.
