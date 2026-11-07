# schemas/ — deterministic contracts

JSON Schema (draft 2020-12) definitions that make lifecycle operations deterministic instead of
interpretive. Validated in the workspace with ajv; in target projects via `lib/validate.mjs`.

| Schema | Validates | Arrives in |
|---|---|---|
| `forge.schema.json` (`$defs/forgeManifest`) | `.forge/forge.yaml` | MVP1 (W1.0) |
| `forge.schema.json` (`$defs/forgeFrontmatter`) | `FORGE.md` YAML frontmatter (§9) | MVP1 (W1.0) |
| `adapter-capability.schema.json` | `.forge/adapters/<adapter>.yaml` | MVP1 (W1.0) |
| `spec-manifest.schema.json` | active change `manifest.yaml` (scale, dev_loop) | MVP2 (W2.0) |
| `spec-delta.schema.json` | `spec-delta.yaml` (baseline operations) | MVP3 (W3.0) |
| `baseline-capability.schema.json` | `product/current/capabilities/*/spec.yaml` | MVP3 (W3.0) |
| `traceability.schema.json` | `traceability.yaml` | MVP3 (W3.0) |
| `archive-state-machine.schema.json` | lifecycle states/transitions (incl. `rejected` — gap L3) | MVP3 (W3.0) |
| `grading.schema.json` | eval harness grader output | MVP5 (W5.2) |
| `run-manifest.schema.json` | execution evidence (`run-manifest/v1`) | W9.0 |
| `benchmark-case.schema.json` | canonical eval benchmark cases | W9.2 |
| `red-evidence.schema.json` | observed-Red evidence for `type: bugfix` changes (`evidence/red/*.json`) | W10.x |
| `liaison-message.schema.json` | one line of `.forge/liaison/<channel>/log/<sender>.jsonl` | liaison Onda 1 |
| `liaison-config.schema.json` | `.forge/liaison/liaison.yaml` (self, canais, participantes) | liaison Onda 1 |

**Consolidation decision (W1.0, plan review):** the project doc tree (§8) lists both
`adapter.schema.json` and `adapter-capability.schema.json` (§10.6) — a redundancy in the doc.
They are consolidated into a single `adapter-capability.schema.json`, which validates the
adapter declaration files. Recorded here per docs/plans/01 v1.1.
