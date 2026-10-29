import test from "node:test";
import assert from "node:assert/strict";
import { authRateLimit } from "../middleware/rateLimit.js";

function responseMock() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("authentication rate limiter allows requests up to the configured maximum", () => {
  const limit = authRateLimit({ windowMs: 60_000, max: 2 });
  const req = { ip: `test-allow-${Date.now()}` };
  let calls = 0;
  const next = () => { calls += 1; };
  limit(req, responseMock(), next);
  limit(req, responseMock(), next);
  assert.equal(calls, 2);
});

test("authentication rate limiter returns 429 after the configured maximum", () => {
  const limit = authRateLimit({ windowMs: 60_000, max: 1 });
  const req = { ip: `test-block-${Date.now()}` };
  let calls = 0;
  const next = () => { calls += 1; };
  limit(req, responseMock(), next);
  const res = responseMock();
  limit(req, res, next);
  assert.equal(calls, 1);
  assert.equal(res.statusCode, 429);
  assert.match(res.body.message, /Too many authentication attempts/);
});
