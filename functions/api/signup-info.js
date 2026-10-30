import { json, mailDomain } from '../../lib/http.js';
export async function onRequestGet({ env }) {
  return json({
    ok: true,
    allow_register: true,
    require_invite: Boolean(env.INVITE_CODE),
    domain: mailDomain(env) || null,
  });
}
