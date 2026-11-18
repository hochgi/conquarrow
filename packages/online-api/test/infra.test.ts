import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { handler as health } from '../src/health';
import { handler as ws } from '../src/ws';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const template = readFileSync(resolve(root, 'infra/template.yaml'), 'utf8');
const workflow = readFileSync(resolve(root, '.github/workflows/api.yml'), 'utf8');
const readme = readFileSync(resolve(root, 'infra/README.md'), 'utf8');

describe('online-infra — core', () => {
  it('HTTP health is unauthenticated and succeeds', async () => {
    const res = await health();
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, service: 'conquarrow' });
  });

  it('template maps HTTP health and WS under conquarrow when certs exist', () => {
    expect(template).toMatch(/Path: \/health/);
    expect(template).toMatch(/ApiMappingKey: conquarrow/);
    expect(template).toMatch(/DomainName: api\.games\.hochgi\.com/);
    expect(template).toMatch(/DomainName: ws\.games\.hochgi\.com/);
  });

  it('match bucket denies public access and Lambdas may write conquarrow/', () => {
    expect(template).toMatch(/BlockPublicAcls: true/);
    expect(template).toMatch(/BlockPublicPolicy: true/);
    expect(template).toMatch(/RestrictPublicBuckets: true/);
    expect(template).toMatch(/conquarrow\/\*/);
  });

  it('move Lambda has the 60s / 1024 MB burst budget', () => {
    expect(template).toMatch(/Timeout: 60/);
    expect(template).toMatch(/MemorySize: 1024/);
  });

  it('API workflow deploys from hochgi main via OIDC secret', () => {
    expect(workflow).toContain('secrets.AWS_ROLE_ARN');
    expect(workflow).toContain('vars.HTTP_CERTIFICATE_ARN');
    expect(workflow).toContain('vars.WS_CERTIFICATE_ARN');
    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain('sam deploy');
    expect(workflow).toContain('branches: [main]');
  });

  it('docs-only paths are not in the API deploy path filter', () => {
    expect(workflow).toContain('paths:');
    expect(workflow).not.toContain('SPEC.md');
    expect(workflow).toContain('infra/**');
    expect(workflow).toContain('packages/online-api/**');
  });
});

describe('online-infra — edge cases', () => {
  it('template and workflow do not name employer accounts', () => {
    const blob = `${template}\n${workflow}`.toLowerCase();
    expect(blob).not.toContain('versatile');
    expect(workflow).not.toContain('AKIA');
  });

  it("workflow does not trust the son's Pages fork to deploy AWS", () => {
    expect(workflow).not.toContain('shalevhoch');
    expect(readme).toContain('hochgi/conquarrow');
    expect(readme.toLowerCase()).toContain('do not');
  });

  it('operator README lists Namecheap CNAMEs and forbids a games Route53 zone', () => {
    expect(readme).toContain('api.games');
    expect(readme).toContain('ws.games');
    expect(readme).toContain('ACM validation');
    expect(readme).toContain('Do **not** create a Route53 hosted zone for `games.hochgi.com`');
  });

  it('health is defined; invite routes exist', async () => {
    expect(template).toContain('Path: /health');
    expect(template).toContain('Path: /invites');
  });

  it('WebSocket connect fails closed without a token', async () => {
    const res = await ws();
    expect(res.statusCode).toBe(401);
    expect(template).toContain('AWS::Serverless::WebSocketApi');
    expect(template).toContain('$connect:');
    expect(template).toContain('$disconnect:');
  });
});
