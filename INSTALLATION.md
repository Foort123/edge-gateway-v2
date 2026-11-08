# Installation

## Prerequisites

- Node.js 20 or newer for the test suite.
- A GitHub account that can access `Foort123/edge-gateway-v2`.
- A Cloudflare account with Pages enabled and the Cloudflare GitHub app
  authorized to read this repository.
- A VLESS client that supports WebSocket with TLS, such as Hiddify.

## Local source setup

```sh
git clone https://github.com/Foort123/edge-gateway-v2.git
cd edge-gateway-v2
npm test
```

There are no runtime npm dependencies and no build step. Pages serves the
`public` directory and discovers the Function under `functions/`.

## Generate an access UUID

Use Node.js to generate a fresh UUID v4:

```sh
node -e "console.log(crypto.randomUUID())"
```

Store it in Cloudflare Pages as the secret `ACCESS_UUID`. Do not place a live
credential in this repository or in a shell command that may be saved to
history. See [CONFIGURATION.md](CONFIGURATION.md).

For local unit tests, the test suite uses a dedicated non-production UUID in
its fixtures. It has no relationship to the deployed credential.
