# Conquarrow online edge — operator notes

Personal AWS only. **Never** point this stack at employer / Versatile credentials.
There is **no AWS CLI profile on the work laptop**; deploys are GitHub Actions
OIDC from `hochgi/conquarrow` `main`.

Account (personal): the 12-digit id on the IAM role ARN.
Region: **eu-central-1** (Frankfurt). ACM certs for the APIs must be in this
region.

## Already done (console)

- GitHub OIDC provider `token.actions.githubusercontent.com`
- Role assumed by Actions (secret `AWS_ROLE_ARN` on **hochgi/conquarrow** only)
- Trust `sub` must be the **immutable** claim (repo created after 15 July 2026):

```
repo:hochgi@881075/conquarrow@1326690080:ref:refs/heads/main
```

The legacy `repo:hochgi/conquarrow:ref:refs/heads/main` will not match. In the
role's **trust policy** (not the permissions policy), `Condition` should be:

```json
"Condition": {
    "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:hochgi@881075/conquarrow@1326690080:ref:refs/heads/main"
    }
}
```

## First deploy

Push `infra/**` or `packages/online-api/**` to `hochgi` `main`, or run the **api**
workflow (`workflow_dispatch`). Stack name: `conquarrow-online`. The workflow
runs `sam build --build-in-source` so the Move/Online Lambdas can bundle Pages
`chooseMove` from `packages/web`. It no-ops on the Pages fork.

Outputs `HealthUrl` and `WsUrl` are `execute-api` URLs until custom domains exist.
`GET` that HealthUrl — no Google token. Expect `{ "ok": true, "service": "conquarrow" }`.

Game play is `GET` / `POST /games/{groupHash}/{gameNumber}` (and `…/moves`, and `GET …/log?since=N` for move-log replay). The P16 stub `POST /moves` is gone (404).

P17 routes (`/me`, `/my-games`, `/invites` and accept/revoke/start) need repository
variable `GOOGLE_CLIENT_IDS` — comma-separated OAuth client ids accepted as ID
token `aud` (Pages origin and localhost). Empty rejects every bearer.

## Custom domains (after the stack exists)

Do this in the **isolated personal** browser, region Frankfurt.

### ACM (two certs, same region as the APIs)

1. ACM → Request public certificate.
2. Names:
   - `api.games.hochgi.com`
   - `ws.games.hochgi.com`  
   (one cert per name is simplest; a single cert with both SANs is also fine —
   then the same ARN goes to both SAM parameters.)
3. Validation: **DNS**.
4. ACM shows CNAME records (`_abc123.api.games.hochgi.com` → ACM value).
5. In **Namecheap** (not Route53): add those **ACM validation CNAMEs**.
6. Wait until the cert status is **Issued**. Copy the cert ARN(s).

Do **not** create a Route53 hosted zone for `games.hochgi.com`. Pages already
uses Namecheap → GitHub. A hosted zone would fight that.

### Namecheap — API targets

After a deploy, CloudFormation outputs (or API Gateway → Custom domain names)
show target hostnames like `d-xxxx.execute-api.eu-central-1.amazonaws.com`.

Add CNAMEs (still Namecheap):

| Host | Value |
|---|---|
| `api.games` | HTTP API custom-domain target (after SAM has the cert) |
| `ws.games` | WebSocket custom-domain target |

### CAA (needed because `games` CNAMEs to GitHub Pages)

GitHub Pages publishes CAA that does not list Amazon. Put CAA on the API
hostnames themselves (`api.games` / `ws.games`, tag `issue`, value `amazon.com`).
You cannot put CAA on Host `games` (CNAME cannot share a name with other records).
When the traffic CNAMEs for `api.games` / `ws.games` go in, **delete those CAA
rows** — CNAME and CAA cannot occupy the same Host. Keep the `_….api.games`
validation CNAMEs.

### Feed certs into SAM

Repository **variables** (not secrets) on `hochgi/conquarrow`:

- `HTTP_CERTIFICATE_ARN`
- `WS_CERTIFICATE_ARN`

Same ARN is fine when one cert covers both names. Empty skips custom domains.
Then Actions → **api** → Run workflow. Outputs `HttpDomainTarget` / `WsDomainTarget`
are the Namecheap traffic CNAME values.

Public URLs once mapped:

- `https://api.games.hochgi.com/conquarrow/health`
- `wss://ws.games.hochgi.com/conquarrow`

## Do not

- `aws configure` / extra profiles on the work laptop
- Access keys in GitHub secrets
- Put `AWS_ROLE_ARN` on `shalevhoch/conquarrow`
- NS-delegate `games.hochgi.com` to Route53
