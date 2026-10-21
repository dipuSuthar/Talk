# Azure DevOps pipelines

Two independent YAML pipelines in one repo. Each triggers **only** when its own folder changes.

| File | Triggers on | Flow |
|---|---|---|
| `client-pipeline.yml` | `client/**` | scan → lint → SonarQube → build → bundle check → SBOM → **staging** (+ZAP) → **production** (approval) |
| `server-pipeline.yml` | `server/**` | scan → tests+coverage → SonarQube → image → image scan → SBOM → push → **staging** (+ZAP) → **production** (approval) |

## Security gates (any finding fails the build)

| Gate | Tool | Where |
|---|---|---|
| Committed secrets (full git history) | gitleaks | both |
| Vulnerable dependencies, secrets, misconfig | Trivy `fs` + `npm audit` | both |
| Dockerfile security lint | hadolint | both |
| SAST + quality gate + coverage | SonarQube | both |
| No lifecycle scripts during install | `npm ci --ignore-scripts` | both |
| No source maps / secret strings in shipped bundle | bundle hygiene step | client |
| Image vulnerabilities (scanned **before** push) | Trivy `image` | server |
| SBOM (CycloneDX) published per build | Trivy | both |
| DAST on staging | OWASP ZAP baseline | both |
| Manual approval before production | Environment checks | both |
| Repo token not left on the agent | `persistCredentials: false` | both |

## One-time setup

1. **SonarQube**: install the *SonarQube* extension in your Azure DevOps org. Create projects `talk-server` and `talk-client`, a token, and a Quality Gate. In *Project settings → Service connections* add a **SonarQube** connection and put its name in `sonarConnection`.
2. **Service connections**: an Azure Resource Manager connection (prefer *workload identity federation*, scoped to the resource group, not the whole subscription) and a Docker Registry connection for ACR. Put the names in the `variables:` block.
3. **Environments** (*Pipelines → Environments*): create `talk-staging` and `talk-production`. Add **Approvals and checks** on `talk-production` (and optionally *Branch control: main only*).
4. **Create the pipelines**: *Pipelines → New pipeline → Azure Repos Git → Existing Azure Pipelines YAML file*, once for each file. (Classic pipelines can't import YAML; these replace your classic build + release pair.)
5. **Branch policy on `main`**: require PR + reviewers, and add **Build validation** for each pipeline with path filters `/client/*` and `/server/*`. Azure Repos ignores `pr:` in YAML, so this is how PRs get scanned.
6. **Secrets**: never put app secrets in pipelines. `MONGO_URL`, `JWT_ACCESS_SECRET`, `JWT_MEDIA_SECRET` live in App Service *Configuration* as Key Vault references.
7. Replace the placeholders in `variables:` (app names, storage accounts, URLs).

## Azure resources these pipelines assume

- **Server**: App Service for Containers with *Web sockets On*, *Always On*, **1 instance**, `WEBSITES_PORT=7000`, `COOKIE_SECURE=true`, `TRUST_PROXY=1`, and an **Azure Files share mounted at `/data/uploads`** (otherwise uploaded media is lost on deploy). Use MongoDB Atlas or Cosmos DB for MongoDB (vCore).
- **Client**: storage account with *Static website* (index + error document = `index.html`).
- **Front Door** in front of both: `/*` → storage, and `/api/*`, `/socket.io/*`, `/uploads/*` → App Service (caching off). The app expects everything on one domain.

## Tool versions

Pinned in `variables:` (`gitleaksVersion`, `trivyVersion`, `hadolintVersion`). Bump them deliberately.
