---
name: devteam:image
description: Image planning, context preparation, and evidence recording for a workspace set
argument-hint: "<plan|prepare|record> [--root <path>] [--set <workspace-set>] [--profile <build-profile>] [--run <id>] [--output <path>] [--image <ref>] [--digest <digest>]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---
<objective>
Show the build contract, target image, source heads, gates, and patch safety before an image build; prepare dry-run build contexts; record completed image build evidence.
</objective>

<context>
$ARGUMENTS
</context>

<process>
**Step 1**: Discover CLI tool and load config:
```bash
DEVTEAM_BIN="${HOME}/.claude/plugins/marketplaces/devteam/lib/devteam.cjs"
[ -f "$DEVTEAM_BIN" ] || DEVTEAM_BIN=$(ls ~/.claude/plugins/cache/devteam/devteam/*/lib/devteam.cjs 2>/dev/null | head -1)
[ -n "$DEVTEAM_BIN" ] || { echo "ERROR: devteam.cjs not found" >&2; exit 1; }
INIT=$(node "$DEVTEAM_BIN" init image)
```

If `$INIT` contains `"feature": null` and `"available_features"`, prompt the user to select a feature with AskUserQuestion, then re-run: `INIT=$(node "$DEVTEAM_BIN" init image --feature $SELECTED)`

**Step 2**: Execute:
Run `node \"$DEVTEAM_BIN\" image plan $ARGUMENTS` unless the user explicitly asks for `prepare` or `record`. Display mode, builder, target image, source_heads, recipe, strategy, gates, missing fields, unsafe_patch_files, notes, and next_action. Treat `command` as optional because new build profiles are contracts first.

`image prepare` may materialize a local `.devteam/image-contexts` context with `Dockerfile.devteam`, `patch-manifest.json`, `source-heads.json`, `verify.sh`, and overlay files. It must not run Docker or push images.

Do not execute remote builds unless the user explicitly asks.

Use `--run <id>` to show whether the run has current passing `sync`, `test`, and optional `publish` evidence before image build.

After a build completes, record the resulting image:
```bash
node "$DEVTEAM_BIN" image record --root <workspace> --run <run-id> \
  --status passed --image <registry/name:tag> --digest <sha256:...> \
  --command "build command ..." --log "/path/to/build.log"
```

If `image record` includes `--profile <build-profile>`, devteam also binds that
build profile to the run by updating `.devteam/runs/<id>/session.json`
`profiles.build`. This lets a run that started as `--no-build` become an
image-validation run after an optional track-level image build is actually
recorded.

If `--set` or `DEVTEAM_TRACK` selects a track, `image record` refuses to append
evidence to a run from a different track unless `--allow-cross-track` is passed.
Image-build evidence is also head-guarded; use `--allow-stale-head` only when
recording a build for an older run snapshot is intentional.
</process>
