# Agents

Personal Codex plugins shared between Windows and macOS.

| Plugin | Source | Contents |
| --- | --- | --- |
| `agents-ledger` | This repository | `plan-work-ledger`, `run-work-ledger` |
| `jev-review` | Submodule of [Eriyc/jev-review](https://github.com/Eriyc/jev-review) | Jev skill and MCP server |

The marketplace is [`.agents/plugins/marketplace.json`](.agents/plugins/marketplace.json). Jev stays a separate plugin so its MCP server and version can update independently. Its submodule tracks the fork's `main` branch; a clone uses the commit pinned by this repository until that pin is updated.

## Install on another computer

Install Git, Codex, and [Bun](https://bun.sh/) (required by Jev). Then:

```bash
git clone --recurse-submodules https://github.com/Eriyc/agents.git
codex plugin marketplace add /absolute/path/to/agents
```

Open the Codex desktop plugin directory, choose the **Agents** marketplace, and install **Work Ledger** and **Jev Review**. Use the local checkout as the marketplace source so Git initializes the Jev submodule. Do not copy or sync Codex's plugin cache or machine-specific `config.toml`.

## Update

On either computer, pull this repository and its pinned submodule:

```bash
git pull --recurse-submodules
git submodule update --init --recursive
```

Restart Codex after pulling. If an installed plugin still shows old content, refresh or reinstall it from the **Agents** marketplace.

To advance the Jev pin intentionally:

```bash
git submodule update --remote plugins/jev-review
git add plugins/jev-review
git commit -m "chore: update Jev Review"
git push
```

Edit ledger skills in `plugins/agents-ledger/skills/`, then bump both ledger plugin manifests' `version` before publishing a release. Keep secrets, credentials, and machine-specific paths out of this public repository.
