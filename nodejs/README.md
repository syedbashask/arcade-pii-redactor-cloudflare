# Arcade Post-Execution PII Redactor

Standalone Node.js 24+ server. Run `npm test` and `npm start` in this directory. The webhook receives `POST /post` and masks phone numbers in tool outputs. `GET /health` reports service health. For Windows VM hosting, run Node as a service, use an HTTPS reverse proxy, and set `ARCADE_WEBHOOK_TOKEN` to match Arcade’s bearer token.
