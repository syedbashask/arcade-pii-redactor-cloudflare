# Arcade Post-Execution PII Redactor

This standalone Node.js server ports the phone-number redaction behavior from [Sachith Sharma's Cloudflare Worker](https://github.com/sachitharcade-hub/arcade-pii-redactor-cloudflare/tree/9c2ae5976b7791b677c596ba120616eba64f804d). It uses Node's built-in HTTP server and has zero npm dependencies.

## Run on a Mac

Install a supported [Node.js LTS release](https://nodejs.org/en/download) (version 24 or newer). Open Terminal in this folder and run:

```sh
node -v
npm test
npm start
```

The default URL is `http://127.0.0.1:3000`. Open a second Terminal window and run this example with synthetic data:

```sh
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1:3000/post \
  -H 'Content-Type: application/json' \
  -d '{"execution_id":"exec_demo","tool":{"name":"ListContacts","toolkit":"Example","version":"1.0.0"},"context":{"user_id":"demo-user"},"success":true,"output":{"records":[{"Phone":"202-555-0100","note":"Call +1 202 555 0101"}]}}'
```

The health response is `{"status":"healthy"}`. The webhook response is:

```json
{"code":"OK","override":{"output":{"records":[{"Phone":"[PHONE REDACTED]","note":"Call [PHONE REDACTED]"}]}}}
```

## How it works

1. `POST /post` reads the JSON request Arcade sends after tool execution.
2. It walks `output` recursively. Known phone fields such as `MobilePhone` are masked, and strings are scanned using the original Worker's phone-number heuristic.
3. It returns `code: OK` with the redacted result under `override.output`. With absent or null output and absent content, it returns just `{"code":"OK"}`.
4. If Arcade provides `content`, the server also masks phone-like text in text blocks and embedded text resources. This follows Arcade's guidance for results that include separate content blocks. The health endpoint uses Arcade's documented `healthy` status.

The original heuristic can miss phone formats and match some non-phone numbers. Redaction covers recognized phone fields and phone-like text in output values and supported text blocks. Images, audio, resource URLs, and result metadata are outside this coverage. The service does not log request bodies.

## Windows VM hosting requirements

- Install Node.js LTS (24 or newer) and copy the project folder to the VM. Run `npm test` and `npm start` from that folder. The application needs no database or npm dependencies.
- Run Node under the team's Windows service manager so it starts at boot and restarts after failure. Set `HOST` and `PORT` in the service configuration as needed. Keeping Node on `127.0.0.1:3000` works when the HTTPS reverse proxy is on the same VM.
- Provide a DNS name and HTTPS endpoint that Arcade can reach, for example through the team's reverse proxy or load balancer with a trusted TLS certificate. Allow the required inbound HTTPS traffic and forward `/post` and `/health` to Node. Preserve the Authorization header when forwarding.
- Store a shared secret as `ARCADE_WEBHOOK_TOKEN` in the service environment and configure the same bearer token in Arcade's extension. The server verifies it on `POST /post`. The health endpoint returns status only and accepts unauthenticated probes.
- Register the **Post-Execution Hook** in Arcade with the HTTPS `/post` URL, configure the `/health` URL if using health checks, and select fail-closed behavior if webhook failure must prevent delivery of unredacted output. Verify the integration with a synthetic tool result before using it with real data. Requests above 1 MiB receive HTTP 413.

References: [Arcade Webhook API](https://docs.arcade.dev/en/references/contextual-access-webhook-api) · [Arcade implementation and authentication guide](https://docs.arcade.dev/en/operate/governance/contextual-access/build-your-own)
