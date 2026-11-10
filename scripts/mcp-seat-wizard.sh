#!/usr/bin/env bash
# Operator steps for the remote agent door. Not a test. No new Route53 zone.
set -euo pipefail

echo "conquarrow MCP seat — three steps only a human can do"
echo

echo "1. Google OAuth client (authorization code), not the GIS ID-token client."
echo "   Redirect URI: https://mcp.games.hochgi.com/oauth/callback"
echo "   Put the client id and secret in the MCP Lambda env. Do not commit them."
echo

echo "2. Namecheap CNAME."
echo "   Host: mcp.games"
echo "   Target: the new API Gateway regional domain (template output McpDomainTarget)."
echo "   No new Route53 zone."
echo

echo "3. AWS Budgets."
echo "   The ADR 0007 alert already covers this function."
echo "   Confirm the alert includes the MCP Lambda. Do not create a second budget."
echo

printf "Press enter when those three are done. "
read -r _
echo "Done."
