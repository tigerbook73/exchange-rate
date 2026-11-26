import { mkdir, writeFile, readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

// Generated once, never overwrite keys used by existing browser subscriptions.
await mkdir(".wrangler", { recursive: true });
const target = ".wrangler/push-website-secrets.json";
let keys, invite;
try {
  const existing = JSON.parse(await readFile(target, "utf8"));
  keys = JSON.parse(existing.PUSH_VAPID_KEYS);
  invite = existing.PUSH_INVITE_CODE;
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  keys = {
    subject: "https://icbc-rate.tigerbook.top",
    publicKey: Buffer.from(
      await crypto.subtle.exportKey("raw", pair.publicKey),
    ).toString("base64url"),
    privateKey: privateJwk.d,
  };
  invite = randomBytes(18).toString("base64url");
  await writeFile(
    target,
    JSON.stringify(
      { PUSH_VAPID_KEYS: JSON.stringify(keys), PUSH_INVITE_CODE: invite },
      null,
      2,
    ) + "\n",
    { mode: 0o600, flag: "wx" },
  );
}
await writeFile(
  ".wrangler/push-collector-secrets.json",
  JSON.stringify({ PUSH_VAPID_KEYS: JSON.stringify(keys) }, null, 2) + "\n",
  { mode: 0o600 },
);
for (const [path, values] of [
  [
    ".dev.vars",
    { PUSH_VAPID_KEYS: JSON.stringify(keys), PUSH_INVITE_CODE: invite },
  ],
  ["collector/.dev.vars", { PUSH_VAPID_KEYS: JSON.stringify(keys) }],
]) {
  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const additions = Object.entries(values).filter(
    ([key]) => !new RegExp(`^${key}=`, "m").test(existing),
  );
  if (additions.length)
    await writeFile(
      path,
      existing +
        (existing.endsWith("\n") || !existing ? "" : "\n") +
        additions
          .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
          .join("\n") +
        "\n",
      { mode: 0o600 },
    );
}
console.log(
  "Push keys and invite code stored in .wrangler/push-website-secrets.json (private, ignored by Git).",
);
console.log(
  "Collector secrets: .wrangler/push-collector-secrets.json. Missing local .dev.vars entries added without replacing existing values.",
);
