/**
 * Rewrites relative links in prose into the contract's link forms.
 *
 * Adapters register routes (repo path → rf:<id> or rf-asset:<path>). Every
 * other relative link becomes an absolute GitHub URL. A relative link to a
 * path that does not exist is an error — a broken link caught in the PR, not
 * on the live site.
 */
import { stat } from 'node:fs/promises';
import { join, posix } from 'node:path';

export class LinkRouter {
  /** @param {{ root: string, repo: string, ref: string }} opts */
  constructor({ root, repo, ref }) {
    this.root = root;
    this.repo = repo;
    this.ref = ref;
    /** @type {Map<string, string>} repo path → rf target */
    this.routes = new Map();
    /** rf-asset paths referenced by prose, with their repo source path */
    this.usedAssets = new Map();
    this.errors = [];
  }

  /** Map a repo path (file or dir, no trailing slash) to an rf: target. */
  route(repoPath, target) {
    this.routes.set(repoPath.replace(/\/+$/, ''), target);
  }

  async #kind(repoPath) {
    try {
      return (await stat(join(this.root, repoPath))).isDirectory() ? 'tree' : 'blob';
    } catch {
      return null;
    }
  }

  /** Resolve one href found in the file at `fromRepoPath`. */
  async resolve(href, fromRepoPath) {
    const trimmed = href.trim();
    if (/^(https?:|mailto:|#|rf:|rf-asset:)/.test(trimmed)) return href;
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return href; // other schemes: leave; validator decides
    const hashAt = trimmed.indexOf('#');
    const rawPath = hashAt === -1 ? trimmed : trimmed.slice(0, hashAt);
    const hash = hashAt === -1 ? '' : trimmed.slice(hashAt);
    if (!rawPath) return href;
    const fromDir = posix.dirname(fromRepoPath);
    const target = decodeURIComponent(
      posix.normalize(rawPath.startsWith('/') ? rawPath.slice(1) : posix.join(fromDir, rawPath)),
    ).replace(/\/+$/, '');
    if (target.startsWith('..')) {
      this.errors.push({ file: fromRepoPath, message: `link "${href}" points outside the repository` });
      return href;
    }
    const routed = this.routes.get(target);
    if (routed) {
      if (routed.startsWith('rf-asset:')) this.usedAssets.set(routed.slice('rf-asset:'.length), target);
      return `${routed}${hash}`;
    }
    const kind = await this.#kind(target);
    if (!kind) {
      this.errors.push({ file: fromRepoPath, message: `broken relative link "${href}" (no ${target} in repo)` });
      return href;
    }
    const encoded = target.split('/').map(encodeURIComponent).join('/');
    return `https://github.com/${this.repo}/${kind}/${this.ref}/${encoded}${hash}`;
  }

  /** Rewrite every markdown link, reference definition, and HTML src/href. */
  async rewrite(md, fromRepoPath) {
    const jobs = [];
    const collect = (re, pick) => {
      for (const m of md.matchAll(re)) jobs.push({ index: m.index, full: m[0], href: pick(m) });
    };
    collect(/(!?\[[^\]]*\]\(\s*<?)([^)\s>]+)/g, (m) => m[2]);
    collect(/^(\s*\[[^\]]+\]:\s*<?)(\S+?)(?=>?(?:\s|$))/gm, (m) => m[2]);
    collect(/(\b(?:src|href)\s*=\s*")([^"]*)/g, (m) => m[2]);
    collect(/(\b(?:src|href)\s*=\s*')([^']*)/g, (m) => m[2]);
    jobs.sort((a, b) => a.index - b.index);
    let out = '';
    let cursor = 0;
    for (const j of jobs) {
      if (j.index < cursor) continue;
      const hrefAt = j.index + j.full.length - j.href.length;
      const next = await this.resolve(j.href, fromRepoPath);
      out += md.slice(cursor, hrefAt) + next;
      cursor = hrefAt + j.href.length;
    }
    return out + md.slice(cursor);
  }
}
