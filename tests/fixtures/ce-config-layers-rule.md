<!-- ce-config-layers:start -->
**Resolve ordinary CE yaml keys by layer.**

- **Read** `<repo-root>/.compound-engineering/config.local.yaml`, then `config.yaml`, then `~/.compound-engineering/config.yaml` (`<repo-root>` = `git rev-parse --show-toplevel`). Missing directories or files and unreadable files are skipped. Gitignore does not change resolution.
- **Win** with the first active (non-commented) value. For scalars, empty is unset; an invalid value continues to the next layer, then the skill default. For lists and maps, a present key — including an empty list or map — replaces the whole key.
- **Do not** use this rule for `docs_root` (`config.yaml` only) or `packs:` (repo-only).
<!-- ce-config-layers:end -->
